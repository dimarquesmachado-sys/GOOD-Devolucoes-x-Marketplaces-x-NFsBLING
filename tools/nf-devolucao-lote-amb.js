/* ============================================================
   NF DE DEVOLUÇÃO EM LOTE — AMBTotal
   ------------------------------------------------------------
   ⚠️ ESTE ARQUIVO EXISTE POR CAUSA DO CONTRATO ABAIXO. LEIA
   ANTES DE MEXER NA EXTENSAO (Toolbox, repo Mover-Pedidos).

   CONTRATO COM A BRIDGE — duas coisas que, se mudarem la, matam
   este script em silencio:

     1) `devolucaoId` e OPCIONAL na mensagem
        GOOD_BRIDGE_CRIAR_DEVOLUCAO. Sem card no Supabase a
        extensao so deixa de registrar — que e o certo aqui,
        porque NAO houve devolucao fisica, so nota duplicada.
        Se a Toolbox passar a EXIGIR o id, este script para de
        funcionar e o caso "emitir NF sem card" some junto.

     2) O campo `empresa` no payload. Default da extensao e
        'good'; 'ambtotal' roteia pra area /amb. Se o nome do
        campo ou o default mudarem, volta o risco de emitir na
        EMPRESA ERRADA (aconteceu em 19/08).

   Conferido em 28/08 contra a Toolbox: os dois seguem valendo,
   inclusive nos caminhos novos (registro do rascunho em falha,
   consumidor tardio, fila de retry). Registrado tambem como
   comentario fixo no PR #237 do Mover-Pedidos.

   Foi versionado aqui justamente porque, enquanto vivia solto
   num arquivo baixado, ninguem que mexesse na extensao tinha
   como descobrir que esta dependencia existia — nao aparecia em
   busca nenhuma. Ele so foi lembrado porque alguem lembrou.
   ------------------------------------------------------------
   Para as NFs de venda DUPLICADAS que a SEFAZ nao deixa mais
   cancelar (rejeicao 501 - intempestivo, passou de 20 dias).
   Em vez de cancelar, emite a NF de ENTRADA (devolucao) que
   anula o efeito da venda.

   ONDE COLAR: no painel de Devolucoes da AMB
     https://good-devolucoes-x-marketplaces-x-nfsbling.onrender.com/amb/painel
   NAO e no Bling. Tem que estar:
     - logado no painel como ADMIN (Diego ou Angelica)
     - no FIREFOX, com a extensao Bridge instalada
     - com o Bling da AMBTOTAL logado nesse mesmo navegador

   POR QUE AQUI: quem monta e emite a nota e a extensao Bridge,
   e ela so escuta no dominio do painel. Este script apenas
   repete, uma a uma, a MESMA chamada que o botao "Gerar NF"
   do card ja faz — sem card, porque aqui nao houve devolucao
   fisica, so nota duplicada.

   FLUXO EM 3 PASSOS, de proposito:
     1) devol.conferir()              -> so LE, monta a tabela
     2) devol.rascunho()              -> gera 1 RASCUNHO (nao emite)
     3) devol.emitir({jaConfirmei:true}) -> emite todas

   ⚠️ A extensao assume a empresa GOOD quando a chamada nao vem
   carimbada — foi o que emitiu nota na empresa errada em 19/08.
   Aqui o carimbo `empresa: 'ambtotal'` esta no ponto UNICO por
   onde todas as chamadas passam (enviarParaBridge).
   ============================================================ */
(() => {
  'use strict';

  // ---- as 83 notas: numero + data de emissao (AAAA-MM-DD) ----
  // A data acelera MUITO a busca no Bling (a rota varre /nfe por
  // pagina; com data ela sabe onde parar).
  // 83 notas: numero|idBling (id MEDIDO no Bling em 25/08, via listarNotasFiscais).
  // Com o id na mao NAO precisamos da rota resolver-id-nf, que varre /nfe pagina
  // por pagina e levava ~16s por nota -> estourava em 502 no Render.
  const FILA = `
  002725|26519159958  002721|26517693998  002720|26517471553  002719|26517333383
  002718|26517231093  002717|26517213410  002716|26517017534  002715|26516949667
  002714|26516758124  002713|26516159528  002712|26515600635  002710|26512844826
  002709|26512415661  002707|26512334320  002706|26511764091  002705|26511716282
  002704|26511622723  002703|26511564861  002702|26511374694  002701|26511285667
  002698|26511226878  002697|26510990328  002696|26510683772  002695|26510624510
  002694|26510268684  002693|26509461428  002691|26508567737  002690|26508445930
  002689|26508392061  002688|26508348330  002685|26507292387  002684|26506840967
  002683|26506712498  002682|26506011938  002681|26505736204  002679|26505582637
  002678|26505357794  002677|26505274279  002676|26505165921  002673|26503616729
  002670|26501846995  002669|26501501379  002667|26501376087  002666|26501036940
  002664|26500898364  002663|26500671688  002661|26500503633  002658|26500226761
  002655|26500058310  002653|26499761865  002652|26499607777  002650|26499047844
  002649|26498864436  002646|26498304631  002645|26497771818  002644|26496664686
  002643|26496405449  002642|26496392341  002640|26496225864  002639|26496201179
  002638|26495442615  002637|26495015492  002636|26494863550  002635|26494585143
  002634|26493509932  002630|26489991817  002629|26489987894  002628|26489743182
  002625|26489626793  002624|26489537031  002623|26489363066  002622|26489163256
  002621|26489117752  002620|26489079047  002618|26488680927  002616|26488446354
  002615|26488347793  002613|26488223225  002611|26487914192  002610|26487905568
  002609|26487894163  002607|26487773063  002605|26487385663
`;

  const PAUSA_MS = 2500;      // respiro entre notas (SEFAZ + cota do Bling)
  const TIMEOUT_BRIDGE = 110000;

  const estado = { itens: [], resultados: [], rodando: false };

  // Aceita "numero|idBling" (rapido, sem tocar no servidor) e tambem
  // "numero|AAAA-MM-DD" ou so "numero" (cai na rota resolver-id-nf).
  function lerFila(txt) {
    return String(txt).trim().split(/[\s,;]+/).filter(Boolean).map((par) => {
      const [num, seg] = par.split('|');
      const v = (seg || '').trim();
      const ehData = /^\d{4}-\d{2}-\d{2}$/.test(v);
      return {
        numero: String(num).trim(),
        idBling: (!ehData && /^\d{6,}$/.test(v)) ? v : null,
        data: ehData ? v : null,
      };
    });
  }

  // ---- ponte com a extensao (mesmo protocolo do painel) ----
  function bridgeInstalada() {
    return new Promise((resolve) => {
      let ok = false;
      function h(ev) {
        if (ev.source !== window) return;
        const t = ev.data && ev.data.tipo;
        if (t === 'GOOD_BRIDGE_PONG' || t === 'GOOD_BRIDGE_INSTALADA') {
          ok = true; window.removeEventListener('message', h); resolve(true);
        }
      }
      window.addEventListener('message', h);
      window.postMessage({ tipo: 'GOOD_BRIDGE_PING' }, '*');
      setTimeout(() => { if (!ok) { window.removeEventListener('message', h); resolve(false); } }, 1500);
    });
  }

  function enviarParaBridge(payload) {
    // PONTO UNICO: carimba a empresa aqui, nunca em quem chama.
    payload = Object.assign({}, payload || {}, { empresa: 'ambtotal' });
    return new Promise((resolve, reject) => {
      const requisicaoId = 'lote_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      let timer;
      function h(ev) {
        if (ev.source !== window) return;
        const d = ev.data || {};
        if (d.tipo !== 'GOOD_BRIDGE_RESPOSTA' || d.requisicaoId !== requisicaoId) return;
        window.removeEventListener('message', h); clearTimeout(timer);
        if (d.ok) resolve(d.resultado);
        else reject(new Error(d.erro || 'erro desconhecido na Bridge'));
      }
      window.addEventListener('message', h);
      window.postMessage({ tipo: 'GOOD_BRIDGE_CRIAR_DEVOLUCAO', requisicaoId, payload }, '*');
      timer = setTimeout(() => {
        window.removeEventListener('message', h);
        reject(new Error('timeout 110s — a NF PODE ter sido criada; confira no Bling antes de repetir'));
      }, TIMEOUT_BRIDGE);
    });
  }

  async function resolverId(item) {
    const qs = 'numero=' + encodeURIComponent(item.numero) +
               (item.data ? '&data=' + encodeURIComponent(item.data) : '');
    const r = await fetch('/amb/api/admin/resolver-id-nf?' + qs, { credentials: 'same-origin' });
    let d = null;
    try { d = await r.json(); } catch (e) { throw new Error('resposta ilegivel (HTTP ' + r.status + ')'); }
    if (!r.ok || !d.ok || !d.idBling) throw new Error(d && d.erro ? d.erro : 'nao achei o id da NF');
    return { idBling: String(d.idBling), idLoja: d.idLoja ? String(d.idLoja) : null };
  }

  // Depositos da AMB (medidos no proprio Bling, no select #opcoesDepositos):
  //   14889038488 = DEFEITOS
  //   14888917703 = Geral            <-- e este que a devolucao usa
  //   14889063674 = Magalu 206018666 (Fulfillment)
  //   14889063825 = Shopee 206017368 (Fulfillment)
  // FIXO no codigo de proposito: na 1a tentativa eu li de window.DEPOSITOS_AMB,
  // que o painel NAO expoe pro console -> caiu no "deposito da propria NF" e o
  // rascunho saiu no deposito errado. Nao dependemos mais do painel expor nada.
  const DEPOSITO_GERAL_AMB = '14888917703';

  function depositoEscolhido(opt) {
    if (opt && opt.idDeposito) return String(opt.idDeposito);
    const G = window.DEPOSITOS_AMB;
    if (G && G.geral) return String(G.geral);
    return DEPOSITO_GERAL_AMB;
  }

  const lote = {
    estado,

    async conferir(listaOpcional) {
      estado.itens = lerFila(listaOpcional || FILA);
      estado.resultados = [];
      const comId = estado.itens.filter((x) => x.idBling).length;
      console.log(estado.itens.length + ' nota(s) na fila — ' + comId + ' ja com id do Bling (nao precisa consultar).');

      if (!(await bridgeInstalada())) {
        console.warn('⚠️ A extensao Bridge NAO respondeu. Sem ela nao da pra gerar NF.');
        console.warn('   Confira: Firefox da AMB, extensao instalada, pagina recarregada (Ctrl+Shift+R).');
      }

      const prontos = [], ruins = [];
      for (let i = 0; i < estado.itens.length; i++) {
        const it = estado.itens[i];
        if (it.idBling) {
          // id ja veio na lista: nada de servidor, nada de espera.
          prontos.push({ numero: it.numero, idBling: it.idBling, idLoja: '(da propria NF)' });
          continue;
        }
        try {
          const { idBling, idLoja } = await resolverId(it);
          // rev2 (Codex): resolvido por NUMERO. A rota devolve a primeira NF
          // com aquele numero e NAO filtra por serie — a data so limita ate
          // onde ela pagina. Se o numero se repete em outra serie, isto aqui
          // pode ser a venda ERRADA, e a devolucao sairia contra ela.
          prontos.push({ numero: it.numero, idBling, idLoja: idLoja || '(sem loja)', porNumero: true });
        } catch (e) {
          ruins.push({ numero: it.numero, motivo: e.message });
        }
        if ((i + 1) % 10 === 0) console.log('   ...' + (i + 1) + '/' + estado.itens.length);
        await new Promise((r) => setTimeout(r, 250));
      }

      estado.prontos = prontos;
      estado.ruins = ruins;

      const porNumero = prontos.filter((p) => p.porNumero);
      if (porNumero.length) {
        console.warn('⚠️ ' + porNumero.length + ' NF(s) foram achadas pelo NUMERO, nao por id: ' +
          porNumero.map((p) => p.numero).join(', '));
        console.warn('   O numero se repete entre SERIES e a busca devolve a primeira que casa.');
        console.warn('   Confira cada uma no Bling (cliente e valor) antes de emitir.');
        console.warn('   Pra emitir mesmo assim: devol.emitir({ jaConfirmei:true, conferiSerie:true })');
      }

      console.log('PRONTAS PRA GERAR (' + prontos.length + '):');
      console.table(prontos);
      if (ruins.length) { console.log('NAO RESOLVIDAS (' + ruins.length + '):'); console.table(ruins); }

      const dep = depositoEscolhido();
      console.log('Deposito que sera usado: ' + (dep || '(o proprio da NF de venda)'));
      console.log('');
      console.log('PASSO 2 — teste seguro, gera UM RASCUNHO (nao emite nada):');
      console.log('   devol.rascunho()');
      return prontos.length;
    },

    // Gera UM rascunho (a primeira da fila, ou a que voce indicar pelo numero)
    async rascunho(numeroEspecifico) {
      if (!estado.prontos || !estado.prontos.length) return console.log('Rode devol.conferir() antes.');
      const alvo = numeroEspecifico
        ? estado.prontos.find((p) => p.numero === String(numeroEspecifico).trim())
        : estado.prontos[0];
      if (!alvo) return console.log('Nao achei ' + numeroEspecifico + ' entre as prontas.');

      console.log('Criando RASCUNHO da devolucao da NF ' + alvo.numero + ' (nao transmite pra SEFAZ)...');
      try {
        const r = await enviarParaBridge({
          idNFOriginal: alvo.idBling,
          idLoja: (alvo.idLoja && alvo.idLoja.indexOf('(') !== 0) ? alvo.idLoja : null,
          emitir: false,
          idDeposito: depositoEscolhido() || '',
        });
        // rev2: esta NF sai da fila do emitir(). O rascunho e pra VOCE abrir
        // no Bling, editar e emitir A MAO — se ela continuasse na fila, o
        // emitir() tentaria criar outra devolucao da MESMA venda e levaria a
        // recusa da protecao anti-duplicata, que aqui contava como falha.
        alvo.tratadaAMao = true;
        alvo.idRascunho = r.idNotaDevolucao;
        console.log('✅ RASCUNHO criado: NF ' + (r.numero || '?') + ' (id ' + r.idNotaDevolucao + ')');
        console.log('   👉 Esta NF saiu da fila do emitir() — voce emite ESTA no Bling, a mao.');
        console.log('   Abra no Bling, edite e valide:');
        console.log('   https://www.bling.com.br/notas.entrada.php#edit/' + r.idNotaDevolucao);
        console.log('');
        console.log('Se estiver certo, PASSO 3:');
        console.log("   devol.emitir({ jaConfirmei: true })");
        return r;
      } catch (e) {
        console.log('❌ FALHOU — ' + e.message);
        throw e;
      }
    },

    async emitir(opt) {
      opt = opt || {};
      if (!estado.prontos || !estado.prontos.length) return console.log('Rode devol.conferir() antes.');
      if (estado.rodando) return console.log('Ja tem um lote rodando.');

      const base = opt.somente
        ? estado.prontos.filter((p) => String(opt.somente).includes(p.numero))
        : estado.prontos;

      // rev2: quem virou rascunho voce resolve no Bling, a mao. Fica fora
      // da fila por padrao (opt.incluirRascunhos:true forca a inclusao).
      const aMao = base.filter((p) => p.tratadaAMao);
      const fila = opt.incluirRascunhos ? base.slice() : base.filter((p) => !p.tratadaAMao);
      if (aMao.length && !opt.incluirRascunhos) {
        console.log('PULANDO ' + aMao.length + ' NF(s) que viraram rascunho (voce emite no Bling): ' +
          aMao.map((p) => p.numero).join(', '));
      }
      if (!fila.length) return console.log('Nada a emitir — todas ja foram tratadas a mao.');

      // rev2 (Codex): emitir contra NF achada so pelo numero e risco de
      // devolver a venda errada. Exige um "eu conferi" explicito.
      const duvidosas = fila.filter((p) => p.porNumero);
      if (duvidosas.length && !opt.conferiSerie) {
        console.log('%cPAREI: ' + duvidosas.length + ' NF(s) desta fila foram achadas pelo NUMERO (serie nao conferida):',
          'color:#c00;font-weight:bold');
        console.log('   ' + duvidosas.map((p) => p.numero).join(', '));
        console.log('   Abra cada uma no Bling e confira cliente e valor. Se estiver certo:');
        console.log('   devol.emitir({ jaConfirmei:true, conferiSerie:true })');
        console.log('   (a fila com id do Bling embutido nao passa por aqui — ali o id ja e exato)');
        return;
      }

      if (!opt.jaConfirmei) {
        console.log('VOCE VAI EMITIR ' + fila.length + ' NF(s) DE DEVOLUCAO. ISSO VAI PRA SEFAZ E NAO TEM VOLTA.');
        console.log('Se e isso mesmo, rode: devol.emitir({ jaConfirmei: true })');
        return;
      }

      estado.rodando = true;
      estado.resultados = [];
      let falhasSeguidas = 0;

      for (let i = 0; i < fila.length; i++) {
        const p = fila[i];
        console.log('(' + (i + 1) + '/' + fila.length + ') devolucao da NF ' + p.numero + ' ...');
        try {
          const r = await enviarParaBridge({
            idNFOriginal: p.idBling,
            idLoja: (p.idLoja && p.idLoja.indexOf('(') !== 0) ? p.idLoja : null,
            emitir: true,
            idDeposito: depositoEscolhido(opt) || '',
          });
          const ok = !!(r && r.idNotaDevolucao);
          estado.resultados.push({
            nf_venda: p.numero, ok,
            nf_devolucao: (r && r.numero) || '', id: (r && r.idNotaDevolucao) || '',
            emitida: !!(r && r.emitida), erro: '',
          });
          console.log(ok ? '   OK — NF de devolucao ' + (r.numero || '?') : '   sem id de volta');
          falhasSeguidas = ok ? 0 : falhasSeguidas + 1;
        } catch (e) {
          const msg = String(e && e.message || e);

          // rev2: a protecao anti-duplicata da extensao ("esta NF ja possui
          // devolucao") NAO e falha — e nota JA RESOLVIDA, inclusive a que
          // voce emitiu a mao pelo rascunho. Contava como falha e, com duas
          // dessas seguidas, derrubava um lote que estava indo bem.
          if (/ja possui devolucao|anti-duplicata/i.test(msg)) {
            estado.resultados.push({ nf_venda: p.numero, ok: false, pulada: true, nf_devolucao: '', id: '', emitida: false, erro: 'ja tinha devolucao (pulada)' });
            console.log('   PULADA — ja tinha devolucao no Bling');
            falhasSeguidas = 0;
            await new Promise((r) => setTimeout(r, 800));
            continue;
          }

          // rev2 (Codex): o timeout da Bridge (90s) e INDETERMINADO — a
          // operacao no Bling pode terminar depois e criar/emitir a nota
          // assim mesmo. Seguir pra proxima em 2,5s sobrepoe operacoes
          // fiscais e um retry pode bater numa nota que ja saiu. Aqui o
          // lote PARA e a decisao volta pra pessoa.
          if (/timeout|tempo esgotado|nao respondeu/i.test(msg)) {
            estado.resultados.push({ nf_venda: p.numero, ok: false, indeterminado: true, nf_devolucao: '', id: '', emitida: false, erro: msg });
            console.log('%c   TIMEOUT — resultado INDETERMINADO nesta NF.', 'color:#c00;font-weight:bold');
            console.log('%c   PAREI o lote. Confira NO BLING se a devolucao da NF ' + p.numero + ' saiu antes de rodar de novo.', 'color:#c00;font-weight:bold');
            break;
          }

          estado.resultados.push({ nf_venda: p.numero, ok: false, nf_devolucao: '', id: '', emitida: false, erro: msg });
          console.log('   FALHOU — ' + msg);
          falhasSeguidas++;
        }

        if (falhasSeguidas >= 2) {
          console.log('PAREI: 2 falhas seguidas. Resolva a causa e rode de novo (as ja feitas nao repetem se voce tirar da lista).');
          break;
        }
        if (i < fila.length - 1) await new Promise((r) => setTimeout(r, PAUSA_MS));
      }

      estado.rodando = false;
      const okN = estado.resultados.filter((x) => x.ok).length;
      console.log('RESULTADO FINAL:');
      console.table(estado.resultados);
      console.log('Emitidas: ' + okN + ' | Falhas: ' + (estado.resultados.length - okN) +
                  ' | Nao tentadas: ' + (fila.length - estado.resultados.length));
      console.log('Para reaproveitar as que faltaram: devol.faltantes()');
    },

    // devolve a lista (numero|data) do que ainda nao saiu, pra rodar de novo
    faltantes() {
      const feitas = new Set(estado.resultados.filter((x) => x.ok).map((x) => x.nf_venda));
      const resto = (estado.itens || []).filter((i) => !feitas.has(i.numero));
      const txt = resto.map((i) => i.numero + (i.idBling ? '|' + i.idBling : (i.data ? '|' + i.data : ''))).join(',');
      console.log('Faltam ' + resto.length + ':');
      console.log(txt);
      return txt;
    },
  };

  window.devol = lote;
  console.log('Pronto. PASSO 1 (so leitura): devol.conferir()');
  console.log('Fila embutida: ' + lerFila(FILA).length + ' notas.');
  console.log('Para outra lista: devol.conferir("002605|2026-08-02,002607|2026-08-02")');
})();
