// js-AMB/painel-gerar-nf.js — modulo do painel unico (docs/MODULARIZACAO.md, fatia 4).
//
// MOVIDO de painel-AMB.html em b683, SEM EDICAO: o bloco final do <script> principal — a esteira
// (rotulo, contador, marcar todos, gerarDevolucaoSilenciosa, rodarEsteira, concluirSelecionadas), o
// retrofit de itens (carregarItensAntigos), lancarPorNF, confirmarGerarDevolucao e a montagem do XML
// da devolucao (montarXmlDevolucao, escapeXajax, formatarQtde, formatarValor).
// Carregado por <script src> ANTES do script principal; na carga so declara `retrofitAtivo`. Tudo aqui
// e chamado por clique, depois do painel inteiro carregado. No script principal, a marca
// `// @painel-modulo js-AMB/painel-gerar-nf.js#gerar-nf` fica no lugar de onde o bloco saiu.

// @secao gerar-nf
    function rotuloEsteira(secao) {
      return secao === 'aprovadas' ? 'btnEsteiraAprovadas' : 'btnEsteiraProblemas';
    }

    function atualizarContadorEsteira(secao) {
      const n = document.querySelectorAll(`.chk-esteira[data-secao="${secao}"]:checked`).length;
      const btnE = document.getElementById(rotuloEsteira(secao));
      const btnC = document.getElementById(secao === 'aprovadas' ? 'btnConcluirAprovadas' : 'btnConcluirProblemas');
      if (btnE && !(esteiraAtiva && esteiraSecao === secao)) btnE.textContent = `🏭 Emitir selecionadas (${n})`;
      if (btnC && !concluindoLote) btnC.textContent = `✅ Concluir selecionadas (${n})`;
    }

    function toggleTodasEsteira(secao, ligado) {
      document.querySelectorAll(`.chk-esteira[data-secao="${secao}"]`).forEach(c => { c.checked = ligado; });
      atualizarContadorEsteira(secao);
    }

    // Mesmo fluxo do modal, mas sem DOM: resolve id/idLoja -> Bridge
    // (gerar + emitir) -> registra. Lança erro com a mensagem original.
    async function gerarDevolucaoSilenciosa(devolucaoId, idNFBling, nfNumero, idDeposito, chaveNF) {
      const qs = idNFBling
        ? `id=${encodeURIComponent(idNFBling)}`
        : `numero=${encodeURIComponent(nfNumero || '')}&chave=${encodeURIComponent(chaveNF || '')}`;
      const rId = await fetch(`${window.APP_BASE || ''}/api/admin/resolver-id-nf?${qs}`);
      const dId = await rId.json();
      if (!dId.ok || !dId.idBling) {
        throw new Error(dId.erro || 'ID interno da NF não localizado no Bling');
      }

      const result = await chamarBlingViaBridge({
        idNFOriginal: String(dId.idBling),
        idLoja: dId.idLoja ? String(dId.idLoja) : null,
        emitir: true,
        // b303 - QUAL EMPRESA. A extensao usa isto pra pedir os IDs fiscais
        // certos (natureza de operacao e empresa) ao servidor. Sem este campo
        // ela assumiria 'good' — que era o unico comportamento que existia — e
        // a nota da AMB sairia com os dados da GOOD.
        // b540 - REVISAO DO PAINEL UNICO: era 'ambtotal' FIXO — na GOOD e na Girassol a emissao EM LOTE pedia os
        // dados fiscais da AMB. Agora a empresa DESTA tela, igual ao botao de um card so (que ja fazia certo).
        empresa: window.APP_EMPRESA || 'ambtotal',
        devolucaoId: String(devolucaoId),
        idDeposito: String(idDeposito || DEPOSITOS_AMB.geral || ''),   // b275
      });
      if (!result || !result.idNotaDevolucao) {
        throw new Error('Bling não retornou ID da devolução: ' + JSON.stringify(result || {}).slice(0, 150));
      }

      try {
        await fetch(`${window.APP_BASE || ''}/api/admin/registrar-devolucao-gerada/${devolucaoId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nf_devolucao_id_bling: String(result.idNotaDevolucao),
            nf_devolucao_numero: String(result.numero || ''),
          }),
        });
      } catch (e) { /* extensao ja registrou sozinha */ }

      return { numero: result.numero || '?', emitida: !!result.emitida };
    }

    async function rodarEsteira(secao) {
      const btn = document.getElementById(rotuloEsteira(secao));

      // Clicar de novo na esteira que esta rodando = PARAR
      if (esteiraAtiva && esteiraSecao === secao) {
        esteiraAtiva = false;
        if (btn) btn.textContent = '⏹ Parando...';
        return;
      }
      if (esteiraAtiva) {
        toast('Já tem uma esteira rodando na outra seção. Espere ou pare ela primeiro.', 'err');
        return;
      }

      const marcados = [...document.querySelectorAll(`.chk-esteira[data-secao="${secao}"]:checked`)];
      if (marcados.length === 0) {
        toast('Nenhum card selecionado. Marque os checkboxes "selecionar" (ou "todas") primeiro.', 'err');
        return;
      }
      // Só entram na esteira os que têm NF pra devolver; o resto é pulado.
      // FULL (série 2) NUNCA entra: a devolução é emitida pelo próprio ML.
      const fila = marcados
        .filter(c => (c.dataset.nfid || c.dataset.nfnum) && c.dataset.full !== '1'
          // b199.2 (Codex): caso vindo do card de estornadas NAO entra na
          // esteira. Ela manda `emitir: true`, e a devolucao sairia com os
          // itens da nota INTEIRA — o que este fluxo veio evitar.
          && c.dataset.sorascunho !== '1'
          && faltasDoCard(c.dataset.id).length === 0)   // b500: devolucao PARCIAL so em rascunho, nunca no lote
        .map(c => ({
          id: c.dataset.id,
          nfid: c.dataset.nfid || '',
          nfnum: c.dataset.nfnum || '',
          chave: c.dataset.chave || '',
        }));
      const puladosFull = marcados.filter(c => c.dataset.full === '1').length;
      // b574 - dono, 06/10: a mensagem dizia 'SEM NF' pra QUALQUER card pulado — inclusive o que tinha NF e foi pulado
      // por ser so-rascunho ou por a lista do que voltou nao bater com a da NF. Agora cada motivo com o seu numero.
      const temNF = (c) => !!(c.dataset.nfid || c.dataset.nfnum);
      const puladosSemNF = marcados.filter(c => c.dataset.full !== '1' && !temNF(c)).length;
      const puladosRascunho = marcados.filter(c => c.dataset.full !== '1' && temNF(c) && c.dataset.sorascunho === '1').length;
      const puladosParcial = marcados.filter(c => c.dataset.full !== '1' && temNF(c) && c.dataset.sorascunho !== '1'
        && faltasDoCard(c.dataset.id).length > 0).length;
      const pulados = puladosSemNF + puladosRascunho + puladosParcial;
      const linhaFull = puladosFull > 0 ? `🏬 ${puladosFull} card(s) FULL serão pulados (NF de devolução é emitida pelo próprio ML).\n` : '';
      const linhasPulados =
        (puladosSemNF > 0 ? `⚠️ ${puladosSemNF} selecionado(s) SEM NF serão pulados (rode o 🔎 Buscar NFs pra eles).\n` : '') +
        (puladosRascunho > 0 ? `📝 ${puladosRascunho} card(s) "só rascunho" (estornadas sem retorno) serão pulados — gere a NF pelo botão do card.\n` : '') +
        (puladosParcial > 0 ? `🧩 ${puladosParcial} card(s) com devolução PARCIAL (o que voltou não bate com a NF) serão pulados — gere em rascunho pelo botão do card.\n` : '');
      if (fila.length === 0) {
        toast(puladosFull > 0 && pulados === 0
          ? 'Só tem card FULL selecionado — a NF de devolução deles é emitida pelo próprio ML (selo 🏬).'
          : ('Nenhum card pode ir no lote: ' + (linhaFull + linhasPulados).replace(/\n/g, ' ').trim()), 'err');
        return;
      }

      if (!await verificarBridgeInstalada()) {
        toast('Extensão Bridge não detectada. Confira a aba do Bling logada e recarregue o painel (Ctrl+Shift+R).', 'err');
        return;
      }

      // v3.28: deposito escolhido no seletor da secao (padrao: Geral)
      const idDeposito = depositoDaSecao(secao);
      const depNome = depositoNome(idDeposito);
      const depGeral = !!DEPOSITOS_AMB.geral && idDeposito === DEPOSITOS_AMB.geral;   // b275

      const estimMin = Math.ceil(fila.length * 30 / 60);
      if (!(await confirmarPainel('🏭 Esteira — gerar e EMITIR as NFs de devolução',
        `🏭 ESTEIRA: gerar + EMITIR (SEFAZ) a NF de devolução de ${fila.length} card(s)?\n\n` +
        linhaFull +
        linhasPulados +
        (puladosFull > 0 || pulados > 0 ? `\n` : '') +
        `• 📦 Depósito do estoque: ${depNome}\n` +
        `• Um por vez (SEFAZ é serial) — de 10s a 1min+ cada, estimativa ~${estimMin || 1} min no total\n` +
        `• Precisa da aba do Bling aberta e logada (a tela vai "piscar" a cada card, é normal)\n` +
        `• Card que já tiver devolução no Bling será apenas VINCULADO\n` +
        (secao === 'problemas'
          ? (depGeral
            ? `• Depósito GERAL escolhido: cards ficam ABERTOS e no fim aviso quais lançamentos de estoque CANCELAR (mude pra DEFEITOS API pra não precisar cancelar)\n`
            : `• Estoque entra quarentenado em ${depNome}: nada a cancelar — cards emitidos serão CONCLUÍDOS automaticamente\n`)
          : `• Emitida/vinculada com sucesso = card marcado como CONCLUÍDO automaticamente\n`) +
        `• Pra PARAR: clique de novo no botão (o que já foi emitido, fica)`,
        '🏭 Emitir agora'))) return;

      esteiraAtiva = true;
      esteiraSecao = secao;
      const corOriginal = btn.style.background;
      btn.style.background = '#c62828';

      let emitidas = 0, vinculadas = 0, rascunhos = 0, falhas = 0;
      const erros = [];
      const lembretesEstoque = []; // problemas: cancelar lançamento de estoque

      // Marca concluído sem barulho (não-crítico: se falhar, o card só
      // fica aberto e dá pra concluir depois pelo botão de lote)
      async function concluirQuieto(id) {
        try {
          await fetch((window.APP_BASE || '') + '/api/admin/concluir/' + id, { method: 'PUT' });
        } catch (e) { console.warn('[Esteira] concluir falhou (nao critico):', id, e.message || e); }
      }

      // Produto com problema + depósito GERAL = manter aberto e lembrar de
      // CANCELAR o lançamento. Com DEFEITOS/quarentena escolhido, o estoque
      // já entra no lugar certo → conclui normalmente.
      const ehProblemas = secao === 'problemas';
      const manterAbertoProblemas = ehProblemas && depGeral;

      for (let i = 0; i < fila.length; i++) {
        if (!esteiraAtiva) break;
        const item = fila[i];
        btn.textContent = `⏹ Parar · ${i + 1}/${fila.length} (✅${emitidas} 🔗${vinculadas} ❌${falhas})`;
        try {
          const r = await gerarDevolucaoSilenciosa(item.id, item.nfid, item.nfnum, idDeposito, item.chave);
          if (r.emitida) {
            emitidas++;
            if (manterAbertoProblemas) {
              lembretesEstoque.push(r.numero || item.nfnum);
              console.log(`[Esteira] NF ${item.nfnum}: devolução ${r.numero} EMITIDA (estoque no Geral) — card ABERTO pra cancelar lançamento`);
            } else {
              await concluirQuieto(item.id); // ciclo fechado = concluído
              console.log(`[Esteira] NF ${item.nfnum}: devolução ${r.numero} EMITIDA (depósito ${depNome}) + card concluído`);
            }
          } else {
            rascunhos++; // SEFAZ não confirmou na hora: card fica aberto pra conferência
            console.log(`[Esteira] NF ${item.nfnum}: devolução ${r.numero} ficou como RASCUNHO — card mantido aberto`);
          }
        } catch (err) {
          const msg = String(err.message || err);
          if (msg.toLowerCase().includes('ja possui devolucao')) {
            // Card órfão: acha e vincula em vez de falhar
            try {
              const rV = await fetch(`${window.APP_BASE || ''}/api/admin/vincular-devolucao-existente/${item.id}`, { method: 'POST' });
              const dV = await rV.json();
              if (dV.ok) {
                vinculadas++;
                if (manterAbertoProblemas) {
                  lembretesEstoque.push(dV.nf_devolucao_numero || item.nfnum);
                  console.log(`[Esteira] NF ${item.nfnum}: devolução ${dV.nf_devolucao_numero} VINCULADA — card ABERTO (conferir estoque)`);
                } else {
                  await concluirQuieto(item.id);
                  console.log(`[Esteira] NF ${item.nfnum}: devolução ${dV.nf_devolucao_numero} já existia — VINCULADA + card concluído`);
                }
              } else {
                falhas++;
                erros.push(`NF ${item.nfnum || item.id}: já tem devolução mas não achei pra vincular (${(dV.erro || '').slice(0, 60)})`);
              }
            } catch (e2) {
              falhas++;
              erros.push(`NF ${item.nfnum || item.id}: ${msg.slice(0, 80)}`);
            }
          } else {
            falhas++;
            erros.push(`NF ${item.nfnum || item.id}: ${msg.slice(0, 100)}`);
          }
        }
        // Pausa entre cards (folga pro Bling e pra SEFAZ respirarem)
        if (i < fila.length - 1 && esteiraAtiva) {
          await new Promise(res => setTimeout(res, 2500));
        }
      }

      const parou = !esteiraAtiva && (emitidas + vinculadas + rascunhos + falhas) < fila.length;
      esteiraAtiva = false;
      esteiraSecao = null;
      btn.style.background = corOriginal;
      btn.textContent = '🏭 Emitir selecionadas (0)';

      if (erros.length > 0) console.warn('[Esteira] Falhas:', erros);
      if (lembretesEstoque.length > 0) console.warn('[Esteira] CANCELAR ESTOQUE das devoluções:', lembretesEstoque);
      toast(
        `${parou ? '⏹ Esteira PARADA' : '🏭 Esteira concluída'}: ✅ ${emitidas} emitida(s)` +
        ` · 🔗 ${vinculadas} vinculada(s)` +
        (rascunhos > 0 ? ` · 📝 ${rascunhos} rascunho(s) (card aberto pra conferir)` : '') +
        ` · ❌ ${falhas} falha(s)` +
        (manterAbertoProblemas && lembretesEstoque.length > 0
          ? ` — ⚠️ PRODUTO C/ PROBLEMA (depósito Geral): cancele o lançamento de estoque no Bling das devoluções ${lembretesEstoque.join(', ')} (cards mantidos abertos)`
          : ((emitidas + vinculadas) > 0 ? ` — concluídas automaticamente ✅ (estoque: ${depNome})` : '')) +
        (falhas > 0 ? ' (detalhes no console F12)' : ''),
        (falhas > 0 || (manterAbertoProblemas && lembretesEstoque.length > 0)) ? 'err' : 'ok'
      );
      carregar();
    }

    // v3.22 - CONCLUIR EM LOTE: marca todos os selecionados como concluídos.
    // Rápido (só Supabase, sem Bling), roda em série com pausa curta.
    async function concluirSelecionadas(secao) {
      if (esteiraAtiva) {
        toast('A esteira de emissão está rodando. Espere ou pare ela primeiro.', 'err');
        return;
      }
      if (concluindoLote) return;

      // b607 - porte da GOOD (painel antigo), perdido na unificacao: o caso que veio do card de ESTORNADAS so gerou
      // RASCUNHO — concluir em lote esconderia da fila antes de alguem validar a NF no Bling. Esses ficam de fora.
      const marcadosTodos = [...document.querySelectorAll(`.chk-esteira[data-secao="${secao}"]:checked`)];
      const marcados = marcadosTodos.filter((c) => c.dataset.sorascunho !== '1');
      const puladosRascunho = marcadosTodos.length - marcados.length;
      if (puladosRascunho > 0) {
        toast(puladosRascunho + ' caso(s) do card de estornadas foram pulados: '
          + 'conclua depois de validar a NF no Bling.', 'err');
      }
      if (marcados.length === 0) {
        if (puladosRascunho === 0) toast('Nenhum card selecionado. Marque os checkboxes "selecionar" (ou "todas") primeiro.', 'err');
        return;
      }
      const ids = marcados.map(c => c.dataset.id);

      if (!confirm(
        `✅ Marcar ${ids.length} card(s) como CONCLUÍDO?\n\n` +
        `Eles somem da lista principal (dá pra rever marcando "Mostrar concluídos").`
      )) return;

      concluindoLote = true;
      const btn = document.getElementById(secao === 'aprovadas' ? 'btnConcluirAprovadas' : 'btnConcluirProblemas');
      const txtOriginal = btn ? btn.textContent : '';
      let ok = 0, falha = 0;
      const erros = [];

      for (let i = 0; i < ids.length; i++) {
        if (btn) btn.textContent = `⏳ Concluindo ${i + 1}/${ids.length}...`;
        try {
          const r = await fetch((window.APP_BASE || '') + '/api/admin/concluir/' + ids[i], { method: 'PUT' });
          const d = await r.json();
          if (d.ok) ok++;
          else { falha++; erros.push(`${ids[i]}: ${d.erro || 'falha'}`); }
        } catch (e) {
          falha++;
          erros.push(`${ids[i]}: ${e.message || e}`);
        }
        if (i < ids.length - 1) await new Promise(res => setTimeout(res, 250));
      }

      concluindoLote = false;
      if (btn) btn.textContent = txtOriginal;
      if (erros.length > 0) console.warn('[Concluir lote] Falhas:', erros);
      toast(`✅ ${ok} concluída(s)` + (falha > 0 ? ` · ❌ ${falha} falha(s) (console F12)` : ''), falha > 0 ? 'err' : 'ok');
      carregar();
    }

    // v3.31 - RETROFIT DE ITENS: percorre os cards antigos (sem nf_itens)
    // e grava produtos/quantidades vindos do Bling — 1 por vez, com placar.
    // Clicar de novo PARA (o que já gravou, fica).
    let retrofitAtivo = false;
    async function carregarItensAntigos() {
      const btn = document.getElementById('btnCarregarItens');
      if (retrofitAtivo) {
        retrofitAtivo = false;
        btn.textContent = '⏹ Parando...';
        return;
      }

      const tudo = [
        ...(dados.aprovadas || []),
        ...(dados.problemas || []),
        ...(dados.divergentes || []),
      ];
      const fila = tudo.filter(d =>
        d.status !== 'concluido' &&
        !(Array.isArray(d.nf_itens) && d.nf_itens.length > 0) &&
        (d.nf_id_bling || (d.nf_chave && d.nf_numero))
      );
      if (fila.length === 0) {
        toast('Todos os cards já têm os itens gravados! ✅', 'ok');
        return;
      }

      const estim = Math.ceil(fila.length * 4 / 60);
      if (!confirm(`Carregar itens de ${fila.length} card(s) antigo(s)?\n\n~4s por card (busca no Bling), estimativa ${estim || 1} min.\nPra parar: clique de novo no botão.`)) return;

      retrofitAtivo = true;
      const corOriginal = btn.style.background;
      btn.style.background = '#c62828';
      let ok = 0, falha = 0;
      const erros = [];

      for (let i = 0; i < fila.length; i++) {
        if (!retrofitAtivo) break;
        const reg = fila[i];
        btn.textContent = `⏹ Parar · ${i + 1}/${fila.length} (✅${ok} ❌${falha})`;
        try {
          const r = await fetch(`${window.APP_BASE || ''}/api/admin/carregar-itens/${reg.id}`, { method: 'POST' });
          const d = await r.json();
          if (d.ok) ok++;
          else { falha++; erros.push(`NF ${reg.nf_numero || reg.id}: ${(d.erro || '').slice(0, 80)}`); }
        } catch (e) {
          falha++;
          erros.push(`NF ${reg.nf_numero || reg.id}: ${e.message || e}`);
        }
        if (i < fila.length - 1 && retrofitAtivo) {
          await new Promise(res => setTimeout(res, 900));
        }
      }

      const parou = !retrofitAtivo && (ok + falha) < fila.length;
      retrofitAtivo = false;
      btn.style.background = corOriginal;
      btn.textContent = '🧾 Carregar itens (antigos)';
      if (erros.length > 0) console.warn('[Retrofit itens] Falhas:', erros);
      toast(
        `${parou ? '⏹ Retrofit PARADO' : '🧾 Retrofit concluído'}: ✅ ${ok} card(s) com itens gravados · ❌ ${falha} falha(s)` +
        (falha > 0 ? ' (console F12)' : ''),
        falha > 0 ? 'err' : 'ok'
      );
      carregar();
    }

    // v3.25 - LANÇAR POR NF: cria cards em Aprovadas a partir dos números
    // das NFs de venda (série 1). O servidor busca cada NF no Bling e monta
    // o card completo (cliente, produto, valor, order, DANFE).
    async function lancarPorNF() {
      const btn = document.getElementById('btnLancarNF');
      const entrada = prompt(
        '➕ LANÇAR POR NF\n\n' +
        'Cole os números das NFs de VENDA (série 1), separados por espaço, vírgula ou linha.\n' +
        'Quantas quiser — vao em levas de 15, com progresso. Exemplo: 74241, 74655 74702\n\n' +
        'Guardas automáticas: NF já lançada é pulada · série 2 (FULL) é recusada.'
      );
      if (!entrada) return;

      let numeros = [...new Set((entrada.match(/\d{3,9}/g) || []))];
      if (numeros.length === 0) {
        toast('Nenhum número de NF reconhecido no texto colado.', 'err');
        return;
      }
      // ⚠️ b453 - SEM TETO. O dono: "15 e pouco". O teto existia porque a rota
      // faz 2 chamadas ao Bling por nota, numa requisicao so, com a tela
      // esperando — 100 notas travariam a tela por minutos. Agora o FRONT
      // divide em levas de 15 e chama a rota varias vezes, com progresso no
      // botao: a tela nao trava, cada leva respeita a cota, e o servidor nao
      // muda. O lote inteiro vai de uma vez.
      if (!confirm(`Lançar ${numeros.length} card(s) pelo número da NF?\n\n${numeros.join(', ')}\n\nO servidor busca cada NF no Bling (~5-15s por nota). Aguarde o resumo.`)) return;

      const txtOriginal = btn.textContent;
      btn.disabled = true;
      btn.textContent = `⏳ Lançando ${numeros.length} NF(s)...`;
      try {
        // b453: levas de 15, uma chamada por leva, progresso no botao
        const LEVA = 15;
        const totalLevas = Math.ceil(numeros.length / LEVA);
        let criadosTotal = 0;
        const resultadosTotal = [];
        // ⚠️ b454 (Codex, 2x P2) - E SE A LEVA 4 FALHAR? Antes, um erro de rede
        // no meio jogava pro catch de fora e PERDIA o que as levas 1-3 ja
        // tinham criado: nem alert, nem toast, nem recarregar. O dono veria
        // "Erro ao lançar" com 45 cards ja no banco, sem saber. Agora a leva
        // que falha vira um "pulado" com o motivo, e o resto segue.
        // E o contador so avanca DEPOIS que a leva volta — antes ele dizia
        // "15/100" enquanto a 1a leva nem tinha terminado.
        let feitas = 0;
        for (let i = 0; i < numeros.length; i += LEVA) {
          const leva = numeros.slice(i, i + LEVA);
          const nLeva = Math.floor(i / LEVA) + 1;
          btn.textContent = `⏳ Leva ${nLeva}/${totalLevas} (${feitas}/${numeros.length} NFs feitas)...`;
          try {
            const r = await fetch((window.APP_BASE || '') + '/api/admin/lancar-por-nf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ numeros: leva }),
            });
            const dl = await r.json();
            if (!dl.ok) throw new Error(dl.erro || `falha na leva ${nLeva}`);
            criadosTotal += Number(dl.criados || 0);
            resultadosTotal.push(...(dl.resultados || []));
          } catch (eLeva) {
            // a leva inteira vira "pulada", com o motivo — e o laco continua
            for (const num of leva) {
              resultadosTotal.push({ numero: num, ok: false,
                motivo: `leva ${nLeva} falhou: ${eLeva.message || eLeva}` });
            }
          }
          feitas += leva.length;
        }
        const d = { ok: true, criados: criadosTotal, resultados: resultadosTotal };
        const pulados = (d.resultados || []).filter(x => !x.ok);
        if (pulados.length > 0) console.warn('[Lançar por NF] Pulados:', pulados);
        // b449 - o motivo na tela (ver painel2)
        if (pulados.length > 0) {
          const linhas = pulados.map(x => `• NF ${x.numero}: ${x.motivo || 'sem motivo'}`);
          alert(`⚠️ ${pulados.length} nota(s) pulada(s):\n\n${linhas.join('\n')}`);
        }
        toast(
          `➕ ${d.criados} card(s) criado(s)` +
          (pulados.length > 0 ? ` · ⚠️ ${pulados.length} pulado(s)` : ''),
          pulados.length > 0 && d.criados === 0 ? 'err' : 'ok'
        );
        carregar();
      } catch (e) {
        toast('Erro ao lançar: ' + (e.message || e), 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = txtOriginal;
      }
    }

    async function confirmarGerarDevolucao(devolucaoId, idNFOriginalBling, nfNumero, emitir, chaveNF) {
      if (!idsFiscaisOk()) return;   // trava: ids da AMB ausentes
      // v3.28: le o deposito ANTES de trocar o conteudo do modal pelo spinner
      const depModalEl = document.getElementById('depModal');
      const idDeposito = (depModalEl && depModalEl.value) ? depModalEl.value : (DEPOSITOS_AMB.geral || '');   // b275
      const conteudo = document.getElementById('modalGerarConteudo');
      const acao = emitir ? 'Gerando + emitindo NF' : 'Criando rascunho';

      // Loading
      conteudo.innerHTML = `
        <h3 style="font-size:18px; margin-bottom:12px;">🧾 ${acao}...</h3>
        <div style="text-align:center; padding:30px;">
          <div class="spinner" style="display:inline-block; width:36px; height:36px; border:4px solid #f0f0f0; border-top-color:#1565c0; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
          <p id="statusGerar" style="margin-top:14px; color:#555; font-size:14px;">
            Falando com o Bling (via extensão)...
          </p>
        </div>
      `;

      try {
        // SEMPRE resolve idNF + idLoja no backend (que usa a API v3 oficial).
        // O idLoja e o ULTIMO segmento do obter-dados-devolucao - sem ele da 404.
        document.getElementById('statusGerar').textContent = 'Localizando a NF no Bling...';
        const qs = idNFOriginalBling
          ? `id=${encodeURIComponent(idNFOriginalBling)}`
          : `numero=${encodeURIComponent(nfNumero || '')}&chave=${encodeURIComponent(chaveNF || '')}`;
        const rId = await fetch(`${window.APP_BASE || ''}/api/admin/resolver-id-nf?${qs}`);
        const dId = await rId.json();
        if (!dId.ok || !dId.idBling) {
          throw new Error(dId.erro || 'Não consegui achar o ID interno dessa NF no Bling.');
        }
        idNFOriginalBling = dId.idBling;
        const idLoja = dId.idLoja || null;

        // Verifica se a extensao Bridge esta instalada/atualizada
        if (!await verificarBridgeInstalada()) {
          throw new Error(
            'Extensão de devoluções não detectada neste navegador (é a Toolbox 2.1+ — ou a "Devoluções Bridge" antiga). ' +
            'Confira se ela está instalada e ATIVA neste navegador, se o Bling está logado em outra aba, e tente de novo (ela pode ter carregado depois da página).'
          );
        }
        document.getElementById('statusGerar').textContent = 'Falando com o Bling (via extensão)...';

        // A Bridge faz TUDO: busca os dados de devolucao (com IDs reais dos itens),
        // valida duplicata, cria a NF e (se emitir) transmite pra SEFAZ.
        // devolucaoId vai junto: a extensao GRAVA o resultado sozinha no
        // sistema, mesmo se este painel desistir de esperar.
        const result = await chamarBlingViaBridge({
          idNFOriginal: String(idNFOriginalBling),
          idLoja: idLoja ? String(idLoja) : null,
          emitir: !!emitir,
          devolucaoId: String(devolucaoId),
          idDeposito: String(idDeposito),
        });

        if (!result || !result.idNotaDevolucao) {
          throw new Error('Bling nao retornou ID da NF: ' + JSON.stringify(result).slice(0, 200));
        }

        const idNFDevolucao = result.idNotaDevolucao;
        const numeroNF = result.numero || '?';
        const emitida = !!result.emitida;

        // Registra no Supabase pra nao gerar de novo (nao critico)
        document.getElementById('statusGerar').textContent = 'Registrando no sistema...';
        try {
          await fetch(`${window.APP_BASE || ''}/api/admin/registrar-devolucao-gerada/${devolucaoId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nf_devolucao_id_bling: String(idNFDevolucao),
              nf_devolucao_numero: String(numeroNF),
            }),
          });
        } catch (e) {
          console.warn('Falha ao registrar no Supabase (nao critico):', e);
        }

        // Mostra sucesso (rascunho x emitida)
        const linkBling = `https://www.bling.com.br/notas.entrada.php#edit/${idNFDevolucao}`;
        const tituloOk = emitida ? '✅ NF de devolução emitida!' : '✅ Rascunho criado!';
        const selo = emitida
          ? `<strong>NF nº ${escapeHtml(String(numeroNF))}</strong> emitida e <strong>autorizada pela SEFAZ</strong>. 🎉`
          : `<strong>NF nº ${escapeHtml(String(numeroNF))}</strong> criada como <strong>rascunho</strong> (ainda NÃO transmitida).`;
        const proximos = emitida
          ? 'Pronto! A devolução de entrada já está autorizada no Bling.'
          : 'Confira no Bling se o produto veio certo. Se estiver ok, dá pra emitir por lá — ou usar o botão "Gerar + Emitir".';
        conteudo.innerHTML = `
          <h3 style="font-size:18px; margin-bottom:12px; color:#2e7d32;">${tituloOk}</h3>
          <div style="background:#e8f5e9; padding:14px; border-radius:8px; margin-bottom:16px;">
            <div style="font-size:14px; color:#1b5e20;">${selo}</div>
            <div style="font-size:12px; color:#388e3c; margin-top:6px;">ID: ${idNFDevolucao}</div>
          </div>
          <p style="font-size:13px; color:#555; margin-bottom:16px;">${proximos}</p>
          <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
            <button class="btn btn-cinza" onclick="fecharModalGerarDevolucao()">Fechar</button>
            <a class="btn btn-verde" href="${linkBling}" target="_blank" onclick="setTimeout(fecharModalGerarDevolucao, 400)">
              🔗 Abrir no Bling
            </a>
          </div>
        `;
        _cardParaAtualizar = String(devolucaoId); // v3.28.1: atualiza so este card ao fechar
        toast((emitida ? 'NF emitida: nº ' : 'Rascunho criado: nº ') + numeroNF, 'ok');

      } catch (err) {
        console.error('Erro gerar devolucao:', err);
        window.marcarFeitaNoBling = async function (id) {
          // v4.00 - saida manual: a NF ja existe no Bling mas o app nao
          // conseguiu vincular. Antes o card ficava preso na fila e o Diego
          // reabria depois sem saber que ja estava resolvido.
          if (!confirm('Confirmar que a NF de devolução JÁ foi emitida no Bling?\n\nO card sai da fila e fica marcado como concluído.')) return;
          try {
            const r = await fetch((window.APP_BASE || '') + '/api/admin/concluir/' + id, { method: 'PUT' });
            const d2 = await r.json();
            if (d2 && d2.ok === false) { alert('Falhou: ' + (d2.erro || '')); return; }
            toast('Marcado como concluído', 'ok');
            fecharModalGerarDevolucao();
            carregar();
          } catch (e) { alert('Erro de conexão'); }
        };

        // v3.20.1: "ja possui devolucao" = a NF existe no Bling mas o card
        // ficou orfao (ex: timeout em tentativa anterior). Procura e vincula.
        if (String(err.message || '').toLowerCase().includes('ja possui devolucao')) {
          conteudo.innerHTML = `
            <h3 style="font-size:18px; margin-bottom:12px;">🔗 Devolução já existe no Bling</h3>
            <div style="text-align:center; padding:24px;">
              <div class="spinner" style="display:inline-block; width:32px; height:32px; border:4px solid #f0f0f0; border-top-color:var(--marca-texto); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
              <p style="margin-top:12px; color:#555; font-size:14px;">Localizando a NF de devolução no Bling pra vincular ao card...</p>
            </div>
          `;
          try {
            const rV = await fetch(`${window.APP_BASE || ''}/api/admin/vincular-devolucao-existente/${devolucaoId}`, { method: 'POST' });
            const dV = await rV.json();
            if (dV.ok) {
              conteudo.innerHTML = `
                <h3 style="font-size:18px; margin-bottom:12px; color:#2e7d32;">✅ Devolução vinculada!</h3>
                <div style="background:#e8f5e9; padding:14px; border-radius:8px; margin-bottom:16px; font-size:14px; color:#1b5e20;">
                  A NF de devolução <strong>nº ${escapeHtml(String(dV.nf_devolucao_numero || '?'))}</strong> já existia no Bling
                  (criada numa tentativa anterior) e agora está vinculada a este card.
                </div>
                <div style="display:flex; gap:8px; justify-content:flex-end;">
                  <button class="btn btn-verde" onclick="fecharModalGerarDevolucao(); carregar();">OK</button>
                </div>
              `;
              toast('Devolução nº ' + (dV.nf_devolucao_numero || '?') + ' vinculada!', 'ok');
              return;
            }
          } catch (e2) { /* cai no erro generico abaixo */ }
        }

        conteudo.innerHTML = `
          <h3 style="font-size:18px; margin-bottom:12px; color:#c62828;">❌ Erro ao gerar</h3>
          ${String(err.message || '').toLowerCase().includes('ja possui devolucao') ? `
            <div style="background:#e3f2fd; border:1px solid #90caf9; border-radius:8px; padding:12px; margin-bottom:14px; font-size:14px; color:#0d47a1;">
              A NF de devolução <b>já foi emitida no Bling</b> — o app só não conseguiu localizá-la pra vincular.
              Se você já gerou essa devolução, pode marcar o card como concluído aqui e ele sai da fila.
              <div style="margin-top:10px;">
                <button class="btn btn-verde" onclick="marcarFeitaNoBling(${devolucaoId})">✅ Já emiti no Bling — marcar como concluído</button>
              </div>
            </div>` : ''}
          <div style="background:#ffebee; padding:14px; border-radius:8px; margin-bottom:16px; font-size:13px; color:#b71c1c;">
            ${escapeHtml(err.message || String(err))}
          </div>
          <div style="font-size:13px; color:#555; margin-bottom:16px;">
            <strong>Possíveis causas:</strong><br>
            • A extensão de devoluções não está instalada ou está desativada<br>
            • Você não está logado no Bling em outra aba<br>
            • A NF original já tem todas devoluções emitidas<br>
            • Bling mudou o endpoint interno (raro)<br><br>
            <strong>Alternativa:</strong> abre a NF no Bling e gera devolução manualmente pelo menu de 3 pontos.
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end;">
            <button class="btn btn-cinza" onclick="fecharModalGerarDevolucao()">Fechar</button>
          </div>
        `;
        toast('Erro: ' + (err.message || err), 'err');
      }
    }

    // Monta o XML proprietario do framework xajax do Bling
    // Formato descoberto via captura de fetch real (30/04/2026)
    function montarXmlDevolucao(produtos, contato) {
      // produtos = [{ idBling, quantidade, valor }]
      // contato = { id, nome, tipo, cnpj, ie, indIEDest, rg, cep, cidade, idMunicipio, uf, endereco, enderecoNro, bairro, complemento, email, fone, celular, dataNascimento, nomePais, idPais }

      // Helper: monta um <e><k>...</k><v>...</v></e>
      function entry(key, valueXml) {
        return `<e><k>${escapeXajax(key)}</k><v>${valueXml}</v></e>`;
      }
      // Helper: valor leaf (texto simples, ja escapado)
      function leaf(value) {
        return escapeXajax(value == null ? '' : String(value));
      }

      // Bloco produtos: { idBling: { quantidade, valor } }
      const produtosXml = '<xjxobj>' + produtos.map(p => {
        const inner = '<xjxobj>' +
          entry('quantidade', leaf(formatarQtde(p.quantidade))) +
          entry('valor', leaf(formatarValor(p.valor))) +
        '</xjxobj>';
        return entry(String(p.idBling), inner);
      }).join('') + '</xjxobj>';

      // Bloco contato (mesma ordem que o Bling envia, por garantia)
      const contatoXml = '<xjxobj>' +
        entry('nome',           leaf(contato.nome)) +
        entry('id',             leaf(contato.id)) +
        entry('tipo',           leaf(contato.tipo || 'F')) +
        entry('cnpj',           leaf(contato.cnpj || contato.cpf || '')) +
        entry('ie',             leaf(contato.ie || '')) +
        entry('indIEDest',      leaf(contato.indIEDest || '9')) +
        entry('rg',             leaf(contato.rg || '')) +
        entry('nomePais',       leaf(contato.nomePais || '')) +
        entry('idPais',         leaf(contato.idPais || '')) +
        entry('cep',            leaf(contato.cep || '')) +
        entry('cidade',         leaf(contato.cidade || '')) +
        entry('idMunicipio',    leaf(contato.idMunicipio || '')) +
        entry('uf',             leaf(contato.uf || '')) +
        entry('endereco',       leaf(contato.endereco || '')) +
        entry('enderecoNro',    leaf(contato.enderecoNro || '')) +
        entry('bairro',         leaf(contato.bairro || '')) +
        entry('complemento',    leaf(contato.complemento || '')) +
        entry('email',          leaf(contato.email || '')) +
        entry('fone',           leaf(contato.fone || '')) +
        entry('celular',        leaf(contato.celular || '')) +
        entry('dataNascimento', leaf(contato.dataNascimento || '')) +
      '</xjxobj>';

      // Bloco raiz
      const xml = '<xjxobj>' +
        entry('produtos', produtosXml) +
        entry('contato', contatoXml) +
        entry('idNaturezaOperacao', leaf(GOOD_BLING.idNaturezaOperacao)) +
        entry('idEmpresaControl', leaf(GOOD_BLING.idEmpresaControl)) +
      '</xjxobj>';

      return xml;
    }

    // Escapa caracteres XML mas SEM tocar em UTF-8 (acentos passam direto)
    function escapeXajax(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    // Quantidade no formato Bling: virgula brasileira, 2 casas
    function formatarQtde(q) {
      const n = Number(q);
      if (!isFinite(n)) return '1,00';
      return n.toFixed(2).replace('.', ',');
    }

    // Valor unitario no formato Bling: virgula brasileira, 10 casas (decimais.price=10)
    function formatarValor(v) {
      const n = Number(v);
      if (!isFinite(n)) return '0,0000000000';
      return n.toFixed(10).replace('.', ',');
    }
