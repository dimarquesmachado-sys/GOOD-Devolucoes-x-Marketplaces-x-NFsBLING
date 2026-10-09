// ============================================================
// lib/rotas-admin-nf.js (v3.44)
// ------------------------------------------------------------
// Rotas administrativas de NF/devolucao (foto, itens, full-*,
// lancar-por-nf, buscar-nf, resolver-id-nf, preparar-devolucao,
// registrar, concluir, delete + debug/resgate-nf). Extraidas do
// server.js LITERAL - logica identica a producao.
//
// Uso:
//   const registrarRotasAdminNF = require('./lib/rotas-admin-nf');
//   registrarRotasAdminNF(app, {
//     supabase, requerAdmin, adminOk, sleep,
//     chamarBling, chamarML, buscarNFnoML,
//     buscarNFePorId, buscarNFBlindada,
//     resolverIdNFPorChave, mapItensNF,
//   });
// ============================================================

module.exports = function registrarRotasAdminNF(app, deps) {
  const {
    supabase, requerAdmin, adminOk, sleep,
    chamarBling, chamarML, buscarNFnoML,
    buscarNFePorId, buscarNFBlindada, naturezaDevolucaoDaEmpresa,   // b402
    resolverIdNFPorChave, mapItensNF,
    tabelaDevolucoes,
    buscarNFsPorNumero,   // b212 - usada pelo raio-x da busca por numero
    buscarNFnoBlingPorNumero,   // b159 - achar a NF pelo NUMERO (resolver-id-nf)
    buscarNfDevolucaoBling,   // b255
    nomesBatemNf,   // b316
    listarDepositos,   // b276 - lista VIVA de depositos desta empresa
  } = deps;

  // ═══════════════════════════════════════════════════════════════════
  // b144 - O NOME DA TABELA VEM DE FORA.
  // Este modulo nasceu como copia do lib/rotas-admin-nf.js da GOOD e
  // ficou com from(TAB) em 15 lugares - a tabela DA GOOD. Na
  // AMB a tabela e devolucoes_amb, entao TODA acao do painel batia numa
  // tabela que nao existe aqui e voltava "Registro nao encontrado" -
  // por isso o "Achar devolucao no Bling" nunca chegava nem a consultar
  // o Bling.
  // ═══════════════════════════════════════════════════════════════════
  const TAB = tabelaDevolucoes || 'devolucoes';
  // b544 - UNIFICACAO DAS ROTAS, passo 1: a coluna de data da tabela tambem vem de fora (AMB/Girassol: criado_em;
  // GOOD: created_at) — pra esta copia servir qualquer empresa.
  const COL_CRIADO = deps.colunaCriadoEm || 'criado_em';
  // b546 (Codex #449) - O MODELO tipo/status tambem vem de fora. AMB/Girassol: `tipo` = o que a peca e
  // ('devolucao'...) e `status` = a fila ('aprovado'/'problema'/'divergente'). GOOD: o CONTRARIO — o resultado da
  // triagem fica em `tipo` ('aprovado'...) e o card aberto tem `status: 'pendente'`.
  const TRIAGEM_NO_TIPO = !!deps.triagemNoTipo;
  const COL_RESULTADO = TRIAGEM_NO_TIPO ? 'tipo' : 'status';

app.get('/api/admin/foto/*', requerAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).send('Supabase nao configurado');
    const arquivo = String(req.params[0] || '')
      .replace(/\\/g, '/')
      .replace(/\.\./g, '')
      .replace(/^\/+/, '')
      .replace(/[^a-zA-Z0-9._/-]/g, '');
    if (!arquivo) return res.status(400).send('arquivo invalido');

    let buf = null;
    let tipo = null;
    let erroDownload = null;

    try {
      const { data, error } = await supabase.storage.from('fotos-problema').download(arquivo);
      if (!error && data) {
        buf = Buffer.from(await data.arrayBuffer());
        tipo = data.type || null;
      } else {
        erroDownload = error ? error.message : 'resposta vazia';
      }
    } catch (e) {
      erroDownload = e.message || String(e);
    }

    if (!buf) {
      const urlPub = `${SUPABASE_URL}/storage/v1/object/public/fotos-problema/` +
        arquivo.split('/').map(encodeURIComponent).join('/');
      const r2 = await fetch(urlPub);
      if (r2.ok) {
        buf = Buffer.from(await r2.arrayBuffer());
        tipo = r2.headers.get('content-type');
      } else {
        console.error('[FOTO]', arquivo, '| download:', erroDownload, '| publico: HTTP', r2.status);
        return res.status(404).send(`foto nao encontrada (download: ${erroDownload || '-'} | publico: HTTP ${r2.status})`);
      }
    }

    res.set('Content-Type', tipo || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=86400');
    return res.send(buf);
  } catch (e) {
    return res.status(500).send('erro: ' + (e.message || String(e)));
  }
});

// ============================================================
// v3.31 - RETROFIT: grava os itens da NF num card antigo (e o
// nf_id_bling, se faltava e a chave permitir descobrir).
app.post('/api/admin/carregar-itens/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  try {
    const { data: reg, error: errReg } = await supabase
      .from(TAB)
      .select('id, nf_id_bling, nf_numero, nf_chave, nf_itens')
      .eq('id', req.params.id)
      .single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    if (Array.isArray(reg.nf_itens) && reg.nf_itens.length > 0) {
      return res.json({ ok: true, ja_tinha: true, qtd: reg.nf_itens.length });
    }

    let idBling = reg.nf_id_bling ? String(reg.nf_id_bling) : null;
    let idDescoberto = false;
    if (!idBling && reg.nf_chave && reg.nf_numero) {
      idBling = await resolverIdNFPorChave(reg.nf_numero, reg.nf_chave);
      idDescoberto = !!idBling;
    }
    if (!idBling) {
      return res.status(404).json({ ok: false, erro: 'Card sem nf_id_bling e sem chave utilizavel pra localizar a NF' });
    }

    await sleep(400);
    const rFull = await buscarNFePorId(idBling);
    const nf = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
    if (!nf) return res.status(404).json({ ok: false, erro: 'NF nao encontrada no Bling (id ' + idBling + ')' });

    const itens = mapItensNF(nf) || [];
    const upd = { nf_itens: itens };
    if (idDescoberto) upd.nf_id_bling = idBling; // brinde: card ganha o link Bling
    const { error: errUpd } = await supabase.from(TAB).update(upd).eq('id', req.params.id);
    if (errUpd) return res.status(500).json({ ok: false, erro: 'Falhou ao gravar: ' + errUpd.message });

    return res.json({ ok: true, qtd: itens.length, id_descoberto: idDescoberto });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// b171 - RETROFIT AUTOMATICO MANSO dos itens da NF.
// Pedido do Diego: "fazer sempre, sem precisar acessar o painel,
// pra quando eu abrir ja entregar repescado". A rotina grava
// nf_itens nos cards ABERTOS que ainda nao tem, pra o painel nem
// precisar buscar no Bling na hora.
// SEGURANCA (licao do incidente do "salvando infinito"):
//   - 1 chamada leve por card (GET /nfe/{id}), teto de 15 por rodada
//   - pausa de 3s entre cards; roda no boot (+4min) e a cada 6h
//   - DUAS falhas seguidas = desiste da rodada inteira (limite/Bling fora)
//   - trava anti-reentrancia
// ============================================================
let RETRO_ITENS_RODANDO = false;
async function retrofitItensPendentes() {
  if (RETRO_ITENS_RODANDO || !supabase) return;
  RETRO_ITENS_RODANDO = true;
  try {
    const corte = new Date(Date.now() - 60 * 864e5).toISOString();
    const { data } = await supabase.from(TAB)
      .select('id, nf_id_bling, nf_numero, nf_chave, nf_itens, status, tipo, ' + COL_CRIADO)
      .in(COL_RESULTADO, ['aprovado', 'problema', 'divergente'])
      .gte(COL_CRIADO, corte)
      .order(COL_CRIADO, { ascending: false })
      .limit(60);
    const pendentes = (data || [])
      .filter(r => (!Array.isArray(r.nf_itens) || r.nf_itens.length === 0)
                && (r.nf_id_bling || (r.nf_chave && r.nf_numero)))
      .slice(0, 15);
    if (!pendentes.length) return;
    let feitos = 0, falhasSeguidas = 0;
    for (const reg of pendentes) {
      try {
        let idBling = reg.nf_id_bling ? String(reg.nf_id_bling) : null;
        let idDescoberto = false;
        if (!idBling) {
          idBling = await resolverIdNFPorChave(reg.nf_numero, reg.nf_chave);
          idDescoberto = !!idBling;
        }
        if (!idBling) continue;
        const rFull = await buscarNFePorId(idBling);
        const nf = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
        if (!nf) {
          falhasSeguidas++;
          if (falhasSeguidas >= 2) { console.log('[RETRO-ITENS] 2 falhas seguidas - desisto da rodada'); break; }
          continue;
        }
        falhasSeguidas = 0;
        const upd = { nf_itens: mapItensNF(nf) || [] };
        if (idDescoberto) upd.nf_id_bling = idBling;
        await supabase.from(TAB).update(upd).eq('id', reg.id);
        feitos++;
      } catch (e) {
        falhasSeguidas++;
        if (falhasSeguidas >= 2) { console.log('[RETRO-ITENS] 2 falhas seguidas - desisto da rodada'); break; }
      }
      await sleep(3000);
    }
    if (feitos) console.log(`[RETRO-ITENS] itens gravados em ${feitos} card(s) - o painel abre pronto`);
  } catch (e) {
    console.log('[RETRO-ITENS] rodada abortada:', e.message || e);
  } finally {
    RETRO_ITENS_RODANDO = false;
  }
}
setTimeout(retrofitItensPendentes, 4 * 60 * 1000);        // depois do pre-aquecimento
setInterval(retrofitItensPendentes, 6 * 60 * 60 * 1000);  // e a cada 6 horas

// ============================================================
// v3.29 - Itens completos de uma NF (pro expansor "▼ itens da NF")
app.get('/api/admin/nf-itens/:idBling', requerAdmin, async (req, res) => {
  try {
    const r = await buscarNFePorId(String(req.params.idBling).trim());
    const nf = (r.ok && r.data?.data) ? r.data.data : null;
    if (!nf) return res.status(404).json({ ok: false, erro: 'NF nao encontrada no Bling' });
    const itens = Array.isArray(nf.itens) ? nf.itens.map(it => ({
      titulo: it.descricao || null,
      sku: it.codigo || null,
      quantidade: it.quantidade || null,
      valor: it.valor || null,
    })) : [];
    return res.json({ ok: true, numero: nf.numero, serie: nf.serie, itens });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.26 - INTELIGÊNCIA FULL
// ============================================================
// (1) full-vincular: acha no Bling a NF de ENTRADA série 2 que o
//     ML emitiu pra devolução (janela da venda, match valor/nome,
//     confirma série na NF completa) e vincula ao card.
// (2) full-lancar-estoque: lança o estoque de entrada da devolução
//     vinculada, via API OFICIAL, no depósito GERAL (caso "voltou
//     pra matriz e está ok pra revenda").
// b276 (regra dele, 18/08: "id depositos sao diferentes... precisa sempre
// pegar isso") - ESTE ID ERA DA GOOD, dentro de uma rota da AMB. Sumiu:
// o deposito agora e validado contra a lista VIVA desta empresa
// (GET /depositos do Bling autenticado com as credenciais dela).

// ═══════════════════════════════════════════════════════════════════
// b143 - SONDA: mostra a NF de entrada CRUA, como o Bling devolve.
// Casar por NOME e ruim (cliente que compra 2x, homonimo, cadastro
// fiscal diferente do nome do ML). O certo e casar por algo UNICO -
// a chave da NF de venda referenciada na devolucao, ou o numero do
// pedido. Mas cada emissor preenche isso num campo diferente, e eu
// nao quero adivinhar: esta rota mostra o objeto inteiro pra a gente
// ver QUAL campo carrega o vinculo, e implementar em cima do dado.
//
//   /amb/api/admin/sonda-nf-entrada/26444189130
// ═══════════════════════════════════════════════════════════════════
app.get('/api/admin/sonda-nf-entrada/:id', requerAdmin, async (req, res) => {
  try {
    const r = await buscarNFePorId(req.params.id);
    const nf = (r.ok && r.data?.data) ? r.data.data : null;
    if (!nf) return res.status(404).json({ ok: false, erro: 'NF nao encontrada', bruto: r.data || null });
    res.json({
      ok: true,
      resumo: {
        numero: nf.numero, serie: nf.serie, tipo: nf.tipo,
        chave: nf.chaveAcesso,
        data: nf.dataEmissao,
        valor: nf.valorNota,
        contato: nf.contato ? { nome: nf.contato.nome, documento: nf.contato.numeroDocumento } : null,
        numero_loja: nf.numeroLoja || null,
        observacoes: nf.observacoes || null,
        notas_referenciadas: nf.notasReferenciadas || nf.notaReferenciada || null,
      },
      campos_no_topo: Object.keys(nf),
      nf_completa: nf,
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

app.post('/api/admin/full-vincular/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  try {
    const { data: reg, error: errReg } = await supabase
      .from(TAB).select('*').eq('id', req.params.id).single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    if (reg.nf_devolucao_id_bling) {
      return res.json({ ok: true, ja_tinha: true, nf_devolucao_numero: reg.nf_devolucao_numero });
    }

    // Confere que e FULL (serie 2 da NF de venda)
    const chaveV = String(reg.nf_chave || '').replace(/\D/g, '');
    // b216 (Codex): QUALQUER serie != 1 e Full.
    //
    // [stated] "cada marketplace com operação fullfilment vai ter 1 série
    // específica". A checagem so aceitava a 2 (ML Full) e recusava a serie
    // 3 da AMB — o dono via "este card nao e FULL" numa nota que o
    // marketplace emitiu, e caia no fluxo errado.
    const serieReg = String(reg.nf_serie || '').trim().replace(/^0+/, '')
      || String(reg.nf_chave || '').replace(/\D/g, '').substr(22, 3).replace(/^0+/, '');
    const ehFull = !!serieReg && serieReg !== '1';
    if (!ehFull) return res.status(400).json({ ok: false, erro: 'Este card nao e FULL (serie 1 = emissao da matriz) - use o Gerar NF Devolucao normal' });

    const f = (dt) => dt.toISOString().slice(0, 10);
    const base = reg.nf_data_emissao ? new Date(reg.nf_data_emissao) : (reg.created_at ? new Date(reg.created_at) : new Date(Date.now() - 60 * 864e5));
    const ini = f(new Date(base.getTime() - 5 * 864e5));   // b141 - 5 dias de folga
    const fim = f(new Date(Date.now() + 864e5));

    const nomeBusca = String(reg.buyer_nome || '').trim().toLowerCase();
    // b141 - casar por PEDACOS do nome. O nome do card vem do ML e o da NF
    // vem do cadastro fiscal - quase nunca sao identicos ("Monica Rosrigues"
    // no card, "Monica Maria Rodrigues" na nota). O includes() da string
    // inteira falhava sempre nesses casos.
    const pedacos = nomeBusca.split(/\s+/).filter(w => w.length >= 4);
    const valorEsperado = (Number(reg.produto_valor_unit) || 0) * (Number(reg.produto_qtd) || 1);

    // Varre notas de ENTRADA na janela e junta candidatas por valor/nome
    let varridas = 0;                      // b141 - pro diagnostico
    const candidatos = [];
    /* b485 - caso real (02/10, Marcos Vieira Lima / PM1): a NF 49304 (devolucao do ML, serie 2,
       25/08) ESTAVA no Bling e o Achar disse "nenhuma serie 2". Dois furos: (1) pagina que falhava
       (429/5xx) encerrava a varredura em silencio e o resultado virava "nao existe"; (2) so as 6
       candidatas MAIS RECENTES eram conferidas — com nome comum (Lima, Marcos...) outras notas
       empurravam a certa pra fora. Agora: pagina que falha tenta de novo e, persistindo, a busca
       e INCOMPLETA (nunca "nao existe"); a fila de candidatas vai pela forca do sinal. */
    // Codex #406 (P2): nome curto ("Ana Li") nao tem pedaco de 4 letras — o nome inteiro exato continua valendo
    const nomeBateComNF = (nomeNF) => (pedacos.length > 0 && pedacos.some(w => nomeNF.includes(w))) || (nomeBusca.length > 0 && nomeNF.includes(nomeBusca));
    // Codex #406 (P2): UM prazo pra rota inteira (a janela do Render e ~25s) — XML e detalhes dividem o mesmo relogio
    const LIMITE_VARREDURA = Date.now() + 22000;
    let incompleto = null;
    const MAX_PG = 20;
    for (let pg = 1; pg <= MAX_PG; pg++) {
      if (pg > 1) await sleep(400);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=0&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      // Codex #406 (P2): sem retentativa aqui — o chamarBling ja tem a dele (429 virava ate 12 chamadas por pagina)
      const r = await chamarBling(url, req._fundo ? { fundo: true } : undefined);   // Codex #410: automatico = fundo
      if (!r.ok) { incompleto = 'o Bling nao respondeu a pagina ' + pg + ' das notas de entrada (HTTP ' + (r.status || '?') + ')'; break; }
      if (pg === MAX_PG && (r.data?.data || []).length === 100) incompleto = 'a janela tem mais de ' + (MAX_PG * 100) + ' notas de entrada — so varri as ' + (MAX_PG * 100) + ' primeiras';
      const lista = r.data?.data || [];
      if (lista.length === 0) break;
      for (const nf of lista) {
        varridas++;
        const nomeNF = String(nf.contato?.nome || '').toLowerCase();
        // basta UM pedaco do nome bater (o sobrenome, normalmente)
        const bateNome = nomeBateComNF(nomeNF);
        const bateValor = valorEsperado > 0 && nf.valorNota != null &&
          Math.abs(Number(nf.valorNota) - valorEsperado) < 0.05;
        if (bateNome || bateValor) candidatos.push(nf);
      }
      if (lista.length < 100) break;
    }
    // b485 - a lista do Bling costuma trazer a chave: a serie sai dela SEM buscar o detalhe
    const serieDaLista = (nf) => { const ch = String(nf.chaveAcesso || '').replace(/\D/g, ''); return ch.length === 44 ? ch.substr(22, 3).replace(/^0+/, '') : ''; };
    const forcaPrevia = (nf) => {
      let pp = 0;
      // Codex #406 (P2): a serie da lista so FILTRA (acima); como pontuacao empurrava a certa sem chave pra fora
      if (valorEsperado > 0 && nf.valorNota != null && Math.abs(Number(nf.valorNota) - valorEsperado) < 0.05) pp += 2;
      const nn = String(nf.contato?.nome || '').toLowerCase();
      pp += pedacos.filter(w => nn.includes(w)).length;          // mais pedacos do nome = mais forte
      if (!pedacos.length && nomeBateComNF(nn)) pp += 1;
      return pp;
    };
    // serie CONHECIDA pela chave e diferente da do card nao e a devolucao do Full — sai antes do detalhe
    const totalCandidatas = candidatos.length;
    for (let ci = candidatos.length - 1; ci >= 0; ci--) {
      const sL = serieDaLista(candidatos[ci]);
      if (sL && (sL === '1' || (serieReg && sL !== serieReg))) candidatos.splice(ci, 1);
    }
    candidatos.sort((a, b) => (forcaPrevia(b) - forcaPrevia(a)) || (new Date(b.dataEmissao || 0) - new Date(a.dataEmissao || 0)));
    let naoVerificadas = 0;
    // Codex #406 (P2): o que o corte de 15 deixa de fora nao foi lido — sem achado, isso nunca vira 404 definitivo
    let cortadas = Math.max(0, candidatos.length - 15);

    // ═══════════════════════════════════════════════════════════════════
    // b143 - CASAR POR EVIDENCIA, NAO POR NOME.
    // A sonda mostrou que a NF de entrada do ML nao traz numeroPedidoLoja,
    // observacoes nem notasReferenciadas: o vinculo com a venda nao esta
    // em campo nenhum da API. Mas traz os ITENS (com o codigo do produto)
    // e o link do XML - e e no XML que mora a <refNFe>, a chave da nota de
    // VENDA que esta sendo devolvida.
    //
    // Pontos (nome vale pouco de proposito: cliente compra duas vezes,
    // existe homonimo, e o cadastro fiscal quase nunca bate com o ML):
    //   +6  o XML referencia a chave da NOSSA NF de venda   <- prova cabal
    //   +3  algum item tem o MESMO SKU do card
    //   +2  o valor da nota bate
    //   +1  um pedaco do nome bate
    // Exige 3: SKU sozinho basta, ou valor+nome. So nome (1) nao passa.
    // ═══════════════════════════════════════════════════════════════════
    const chaveVenda = String(reg.nf_chave || '').replace(/\D/g, '');
    const skuCard = String(reg.produto_sku || '').trim().toUpperCase();

    async function pontuar(nf) {
      let pts = 0; const porque = []; let evidencia = false; let xmlFalhou = false;   // Codex #406 (P1): prova da TRANSACAO (XML ou valor)
      if (skuCard && Array.isArray(nf.itens) &&
          nf.itens.some(it => String(it.codigo || '').trim().toUpperCase() === skuCard)) {
        pts += 3; porque.push('mesmo SKU');
      }
      if (valorEsperado > 0 && Math.abs(Number(nf.valorNota) - valorEsperado) < 0.05) {
        pts += 2; porque.push('mesmo valor'); evidencia = true;
      }
      const nomeNF2 = String(nf.contato?.nome || '').toLowerCase();
      if (nomeBateComNF(nomeNF2)) { pts += 1; porque.push('nome parecido'); }
      if (chaveVenda.length === 44 && nf.xml) {
        try {
          // Codex #406 (P2): XML com PRAZO — servidor que segura a conexao travava a rota inteira
          const restante = LIMITE_VARREDURA - Date.now();
          if (restante <= 500) throw new Error('prazo da varredura estourou');
          const rx = await fetch(nf.xml, { signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(Math.min(8000, restante)) : undefined });
          if (rx.ok) {
            const txt = await rx.text();
            if (txt.replace(/\D/g, '').includes(chaveVenda)) { pts += 6; porque.push('XML referencia a NF de venda'); evidencia = true; }
          }
        } catch (e) { xmlFalhou = true; /* sem o XML, decide pelos outros sinais — mas a busca fica INCOMPLETA */ }
      }
      return { pts, porque, evidencia, xmlFalhou, xml: porque.includes('XML referencia a NF de venda') };
    }

    // Confirma a serie 2 na NF completa (a lista pode nao trazer serie)
    let melhor = null;
    const aConferir = candidatos.slice(0, 15);
    for (let k = 0; k < aConferir.length; k++) {
      const cand = aConferir[k];
      // Codex #406 (P2): prazo estourado — o que sobrou nao foi lido (503 incompleto, nunca 404)
      if (Date.now() > LIMITE_VARREDURA) { cortadas += aConferir.length - k; break; }
      await sleep(400);
      const rFull = await buscarNFePorId(cand.id, req._fundo ? { fundo: true } : undefined);
      const nfc = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
      if (!nfc) { naoVerificadas++; continue; }      // b485: detalhe que nao veio = nao verificada (nao e 'nao e')
      const chaveD = String(nfc.chaveAcesso || '').replace(/\D/g, '');
      // b216: idem — serie != 1 e Full
      const sNF = String(nfc.serie || '').trim().replace(/^0+/, '')
        || String(nfc.chaveAcesso || '').replace(/\D/g, '').substr(22, 3).replace(/^0+/, '');
      // b216.1 (Codex): a serie da devolucao tem que ser a MESMA da venda.
      //
      // Eu tinha afrouxado pra "qualquer serie != 1" — mas se a conta tem
      // mais de uma serie de Full (ML, Amazon, Magalu), isso aceitaria a
      // nota de entrada de OUTRO canal com valor parecido. O vinculo sairia
      // errado, e e nota fiscal.
      //
      // `serieReg` e a serie do card (da venda). A entrada tem que bater.
      const serieOk = !!sNF && sNF !== '1' && (!serieReg || sNF === serieReg);
      if (!serieOk) continue;
      const p = await pontuar(nfc);
      if (p.xmlFalhou) naoVerificadas++;      // XML que nao veio pode ser justamente a prova
      /* Codex #406 (P1): SKU + um pedaco de nome nao prova que e a devolucao DESTA venda (Joao Silva x
         Maria Silva, mesmo produto) — so concorre quem tem prova da transacao: o XML citando a venda
         ou o valor batendo. Vincular nota alheia abriria lancamento de estoque em cima dela. */
      if (!p.evidencia) continue;
      if (!melhor || p.pts > melhor.pts) melhor = { nf: nfc, ...p };
      if (p.pts >= 9) break;                 // chave + SKU: nao ha o que melhorar
    }

    // Codex #406 (P1): busca incompleta so aceita prova cabal (XML) — a melhor nota pode estar na parte que nao li
    if (melhor && melhor.pts >= 3 && (!(incompleto || naoVerificadas > 0) || melhor.xml)) {
      const nf = melhor.nf;

      const { error: errUpd } = await supabase
        .from(TAB)
        .update({
          nf_devolucao_id_bling: String(nf.id),
          nf_devolucao_numero: String(nf.numero || ''),
        })
        .eq('id', req.params.id);
      if (errUpd) return res.status(500).json({ ok: false, erro: 'Achei a NF ' + nf.numero + ' mas falhou ao gravar: ' + errUpd.message });

      console.log(`[FULL-VINCULAR] ${req.params.id}: entrada serie 2 nº ${nf.numero} (id ${nf.id})`);
      return res.json({
        ok: true,
        nf_devolucao_numero: String(nf.numero || ''),
        nf_devolucao_id_bling: String(nf.id),
        casou_por: melhor.porque,          // b143 - por que essa e nao outra
        pontos: melhor.pts,
      });
    }

    // b485 - "nao sei" != "nao existe": busca que nao terminou nao conclui ausencia
    if (incompleto || naoVerificadas > 0 || cortadas > 0) {
      return res.status(503).json({ ok: false, incompleto: true,
        erro: 'Busca INCOMPLETA — ' + (incompleto || (naoVerificadas > 0 ? naoVerificadas + ' candidata(s) o Bling nao deixou conferir' : cortadas + ' candidata(s) ficaram fora do limite de 15 conferidas')) +
          '. Isso NAO quer dizer que a NF nao existe: tente de novo em instantes.',
        diag: { janela: { de: ini, ate: fim }, notas_de_entrada_varridas: varridas, candidatas: totalCandidatas, nao_verificadas: naoVerificadas } });
    }
    return res.status(404).json({
      ok: false,
      erro: `Nenhuma NF de entrada serie 2 correspondente na janela ${ini}..${fim} (${totalCandidatas} candidata(s), ${Math.min(candidatos.length, 15)} conferida(s)). Se ainda nao importou o XML no Bling, a Toolbox traz sozinha quando a vigia achar.`,
      // b141 - DIZ O QUE FEZ. Antes so avisava que nao achou, e nao dava pra
      // saber se a janela estava curta, se o nome nao bateu, se o valor nao
      // bateu, ou se o Bling nem devolveu notas de entrada.
      diag: {
        janela: { de: ini, ate: fim },
        notas_de_entrada_varridas: varridas,
        candidatas: totalCandidatas,
        melhor_pontuacao: (typeof melhor !== 'undefined' && melhor) ? { pontos: melhor.pts, sinais: melhor.porque, nf: melhor.nf?.numero } : null,
        procurei_por: {
          nome_do_card: reg.buyer_nome || null,
          pedacos_do_nome: pedacos,
          valor_esperado: valorEsperado || null,
        },
        dica: varridas === 0
          ? 'O Bling nao devolveu NENHUMA nota de entrada nessa janela - confira o periodo e o acesso do token'
          : (candidatos.length === 0
              ? 'Varri as notas mas nenhuma bateu por nome nem por valor - confira o valor do card e o nome na nota'
              : 'Havia candidatas, mas nenhuma era serie 2'),
      },
    });
  } catch (e) {
    console.error('[FULL-VINCULAR] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

app.post('/api/admin/full-lancar-estoque/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  try {
    // b482 - select('*'): as colunas estoque_lancado_em/estoque_deposito podem nao existir
    // nesta tabela; pedir por nome derrubaria a rota inteira ("column does not exist").
    const { data: reg, error: errReg } = await supabase
      .from(TAB).select('*').eq('id', req.params.id).single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    /* b482 - pedido do dono (02/10): devolucao do FULL nao gera NF (a do ML ja existe) — o que
       ele faz e LANCAR NO ESTOQUE pra revender. Lancar 2x DOBRA o estoque: se o card ja registra
       o lancamento, recusa com quando/onde (so passa com forcar:true, decisao consciente). */
    const forcar = !!(req.body && req.body.forcar === true);
    if (reg.estoque_lancado_em && !forcar) {
      const emAndamento = /^LANCANDO/.test(String(reg.estoque_deposito || ''));
      return res.status(409).json({ ok: false, ja_lancado: true, em_andamento: emAndamento,   // Codex #405: o painel oferece o 'lancar mesmo assim'
        erro: emAndamento
          ? 'ja ha um lancamento de estoque em andamento (ou interrompido) desta devolucao, desde ' + String(reg.estoque_lancado_em).slice(0, 16).replace('T', ' ') + ' — confira no Bling antes de lancar de novo'
          : 'o estoque desta devolucao JA foi lancado' + (reg.estoque_deposito ? ' no deposito ' + reg.estoque_deposito : '') +
            ' em ' + String(reg.estoque_lancado_em).slice(0, 16).replace('T', ' ') + ' — lancar de novo dobraria o estoque' });
    }
    if (!reg.nf_devolucao_id_bling) {
      return res.status(400).json({ ok: false, erro: 'Card sem devolucao vinculada - use o 🔗 Achar devolucao primeiro' });
    }

    // b276 - a whitelist antiga era de depositos DA GOOD: na AMB, qualquer
    // escolha do painel era rejeitada e caia no "padrao" — que tambem era da
    // GOOD. Ou seja, o lancamento ia pra um deposito INEXISTENTE nesta
    // empresa. Agora a lista vem do proprio Bling desta empresa.
    const pedidoDep = String(req.body?.idDeposito || '').trim();
    let deposito = null;
    let listaDeps = [];
    if (typeof listarDepositos === 'function') {
      try {
        const r = await listarDepositos(false);
        listaDeps = (r && r.depositos) || [];
      } catch (e) { listaDeps = []; }
    }
    if (listaDeps.length) {
      // b278 (review do Codex) - o painel esconde os depositos de FULL, mas o
      // SERVIDOR aceitava qualquer id que existisse no Bling: uma pagina
      // antiga ou requisicao adulterada lancaria devolucao dentro de um
      // fulfillment de marketplace. A regra de negocio vale aqui tambem.
      const ehFull = (d) => /full/i.test(String(d.descricao || ''));
      const utilizaveis = listaDeps.filter((d) => !ehFull(d));
      const valido = utilizaveis.some((d) => String(d.id) === pedidoDep);
      const geral = (utilizaveis.find((d) => d.padrao)
        || utilizaveis.find((d) => /geral/i.test(String(d.descricao || ''))) || {}).id || null;
      // b281 - se o admin ESCOLHEU um deposito e ele nao serve (nao existe
      // nesta empresa, ou e um Full), cair no Geral em silencio lanca a peca
      // num lugar que ninguem pediu — e o card fecha como se tivesse dado
      // certo. Recusa com o motivo escrito; o Geral so vale quando NADA foi
      // escolhido.
      if (pedidoDep && !valido) {
        const ehFullPedido = listaDeps.some((d) => String(d.id) === pedidoDep && ehFull(d));
        return res.status(400).json({
          ok: false,
          erro: ehFullPedido
            ? 'esse é um depósito de FULL do marketplace — devolução que chega na matriz não entra nele'
            : 'o depósito escolhido não existe nesta empresa — recarregue a página e escolha de novo',
        });
      }
      deposito = pedidoDep || geral;
    }
    if (!deposito) {
      // b277 (review do Codex) - SEM LISTA, NAO LANCA. Eu deixava passar o
      // id que o painel mandasse quando o GET de depositos falhava, mas o
      // GET falhar nao significa que o POST vai falhar: uma pagina antiga
      // (ou requisicao adulterada) poderia lancar num deposito que o painel
      // esconde de proposito — um Full, por exemplo. Esta rota MEXE EM
      // ESTOQUE; sem conseguir validar, recusar e a resposta certa.
      const motivo = listaDeps.length
        ? 'o deposito escolhido nao existe nesta empresa e nao achei o Geral dela'
        : 'nao consegui a lista de depositos desta empresa agora — sem ela nao lanço estoque';
      return res.status(503).json({ ok: false, erro: motivo + ' — tente de novo em instantes' });
    }

    /* Codex #404 (P1 x2): a checagem acima e LIDA — duas abas/admins/retentativas ao mesmo tempo
       passariam as duas e dobrariam o estoque. A trava de verdade e esta RESERVA condicional no
       banco (so 1 update acha estoque_lancado_em vazio). E ela exige as colunas: sem rastro
       duravel nao ha como recusar o 2o lancamento depois de um refresh — entao NAO lanca. */
    const marca = 'LANCANDO ' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let qRes = supabase.from(TAB).update({ estoque_lancado_em: new Date().toISOString(), estoque_deposito: marca }).eq('id', req.params.id);
    /* Codex #405 (P1, 3a rodada): o forcar:true tambem e compare-and-swap — so reserva se o card
       ainda esta como LIDO acima (mesma data/marca). Dois admins ou duplo clique no 'lancar mesmo
       assim': so um update acha o estado antigo, o outro cai no 409 abaixo e NAO chama o Bling. */
    qRes = reg.estoque_lancado_em ? qRes.eq('estoque_lancado_em', reg.estoque_lancado_em) : qRes.is('estoque_lancado_em', null);
    qRes = reg.estoque_deposito ? qRes.eq('estoque_deposito', reg.estoque_deposito) : qRes.is('estoque_deposito', null);
    const { data: reservou, error: errRes } = await qRes.select('id');
    if (errRes) {
      const sql = 'alter table public.' + TAB + ' add column if not exists estoque_lancado_em timestamptz, add column if not exists estoque_deposito text;';
      return res.status(503).json({ ok: false, falta_coluna: true, sql,
        erro: 'nao lancei: a tabela ' + TAB + ' ainda nao tem onde registrar o lancamento (sem isso, um 2o clique dobraria o estoque). Rode no Supabase: ' + sql });
    }
    if (!reservou || !reservou.length) {
      return res.status(409).json({ ok: false, ja_lancado: true, erro: 'outro lancamento desta devolucao comecou agora mesmo — atualize a pagina' });
    }
    const url = `https://api.bling.com.br/Api/v3/nfe/${reg.nf_devolucao_id_bling}/lancar-estoque/${deposito}`;
    /* Codex #405 (P1): a fila do Bling pode REJEITAR antes de enviar — o chamarBling da GOOD
       LANCA (e.filaEstourou) em vez de devolver; sem este try a rota caia no catch geral (500) com
       a reserva LANCANDO presa. Nao saiu nada = devolve a reserva; outra excecao = incerto. */
    let r;
    try { r = await chamarBling(url, { method: 'POST', data: {} }); }
    catch (eB) { r = { ok: false, status: 0, error: { error: { message: String((eB && eB.message) || eB) } }, filaEstourou: !!(eB && eB.filaEstourou) }; }
    if (!r.ok) {
      const detalhe = r.error?.error?.description || r.error?.error?.message || JSON.stringify(r.error || {}).slice(0, 180);
      /* Codex #404 (P1, 2a rodada): so devolve a reserva quando o Bling DEFINITIVAMENTE nao aplicou
         (a requisicao nem saiu, ou ele respondeu 4xx). Timeout / queda de conexao / 5xx podem ter
         chegado e lancado: devolver a reserva ali deixaria o retry dobrar o estoque. Nesses casos a
         marca LANCANDO fica (o 409 acima manda conferir no Bling; forcar:true e a decisao consciente). */
      const st = Number(r.status) || 0;
      const naoAplicou = r.filaEstourou === true || (st >= 400 && st < 500 && st !== 408);
      if (!naoAplicou) {
        return res.status(502).json({ ok: false, incerto: true,
          erro: 'o Bling nao confirmou o lancamento (' + (st ? 'HTTP ' + st : 'sem resposta') + ': ' + detalhe + ') — ele PODE ter lancado. Confira o estoque no Bling antes de tentar de novo; o card ficou marcado "em andamento" pra nao dobrar.' });
      }
      // o Bling NAO lancou: devolve a reserva (so se ainda for a minha)
      let liberou = false;
      try {
        const { error: eL } = await supabase.from(TAB).update({ estoque_lancado_em: null, estoque_deposito: null }).eq('id', req.params.id).eq('estoque_deposito', marca);
        liberou = !eL;   // Codex #405 (P2): o supabase devolve { error } em vez de lancar
      } catch (eL) { liberou = false; }
      const motivo = r.filaEstourou ? 'o Bling esta ocupado (fila cheia) — NADA foi lancado; tente de novo em instantes' : `Bling recusou (HTTP ${r.status}): ${detalhe}`;
      return res.status(r.filaEstourou ? 503 : 502).json({ ok: false, reserva_presa: !liberou,
        erro: motivo + (liberou ? '' : ' — a marca de "em andamento" NAO saiu do card; o Bling nao lancou, entao pode usar "lancar mesmo assim"') });
    }

    console.log(`[FULL-ESTOQUE] ${req.params.id}: estoque lancado (NF dev ${reg.nf_devolucao_numero}, deposito ${deposito})`);
    // b482 - marca no card (some o botao e a trava acima passa a valer). Se as colunas nao
    // existirem nesta tabela, o lancamento JA aconteceu no Bling: responde ok com o aviso.
    const depObj = listaDeps.find((d) => String(d.id) === String(deposito)) || null;
    const depNome = depObj ? depObj.descricao : String(deposito);
    let persistiu = false, aviso = null;
    try {
      const { error: errM } = await supabase.from(TAB)
        .update({ estoque_lancado_em: new Date().toISOString(), estoque_deposito: depNome })
        .eq('id', req.params.id);
      persistiu = !errM;
      // a reserva (LANCANDO...) continua no card: o 2o clique segue barrado mesmo se este update falhar
      if (errM) aviso = 'lancou no Bling; o card ficou marcado como "em andamento" (' + String(errM.message || errM).slice(0, 100) + ')';
    } catch (eM) { aviso = 'lancou no Bling; o card ficou marcado como "em andamento"'; }
    return res.json({ ok: true, nf_devolucao_numero: reg.nf_devolucao_numero, deposito, deposito_nome: depNome, persistiu, aviso });
  } catch (e) {
    console.error('[FULL-ESTOQUE] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.25 - LANÇAR POR NF: cria cards em "Aprovadas" a partir do
// número da NF de venda (série 1). Porta lateral pra devoluções
// que não passaram pela bipagem — depois a esteira 🏭 emite tudo.
// Guardas: pula série 2 (FULL), pula número já lançado.
// ============================================================
app.post('/api/admin/lancar-por-nf', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  const brutos = Array.isArray(req.body?.numeros) ? req.body.numeros : [];
  const numeros = [...new Set(brutos.map(n => String(n).replace(/\D/g, '')).filter(n => n.length >= 3))].slice(0, 15);
  if (numeros.length === 0) return res.status(400).json({ ok: false, erro: 'Nenhum numero de NF valido informado' });

  const resultados = [];
  let criados = 0;

  for (const num of numeros) {
    try {
      // 1) Ja existe card com essa NF?
      const candidatos = [...new Set([num, num.padStart(6, '0'), num.replace(/^0+/, '')])];
      const { data: jaTem } = await supabase
        .from(TAB)
        .select('id, status')
        .in('nf_numero', candidatos)
        .limit(1);
      if (jaTem && jaTem.length > 0) {
        // ⚠️ b450 - CARD ORFAO DO BUG ANTIGO: gravado com status 'pendente',
        // que nao existe no modelo da AMB (aprovado/problema/divergente) —
        // invisivel em toda tela. Em vez de recusar ("ja existe"), CONSERTO:
        // vira 'aprovado' e aparece. E o que o dono queria desde o 1o clique.
        // (so no modelo da AMB: na GOOD 'pendente' e o status NORMAL de um card aberto — nao mexe)
        if (!TRIAGEM_NO_TIPO && jaTem[0].status === 'pendente') {
          const { error: eFix } = await supabase.from(TAB)
            .update({ status: 'aprovado', tipo: 'devolucao' })
            .eq('id', jaTem[0].id);
          if (!eFix) {
            criados++;
            resultados.push({ numero: num, ok: true, id: jaTem[0].id,
              motivo: 'card orfao (status pendente) consertado — agora aparece em Aprovadas' });
            continue;
          }
        }
        resultados.push({ numero: num, ok: false, motivo: `ja existe card (${jaTem[0].status})` });
        continue;
      }

      // 2) Busca a NF no Bling (varredura por numero, tipo=1)
      const rBusca = await buscarNFnoBlingPorNumero(num, null, { maxPaginas: 30 });
      if (!rBusca.ok || !rBusca.match?.id) {
        resultados.push({ numero: num, ok: false, motivo: `NF nao achada no Bling (${rBusca.totalScanned || 0} varridas)` });
        continue;
      }
      await sleep(400);
      const rFull = await buscarNFePorId(rBusca.match.id);
      const nf = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
      if (!nf) {
        resultados.push({ numero: num, ok: false, motivo: 'falha ao ler NF completa' });
        continue;
      }

      // 3) Guarda FULL: QUALQUER serie != 1 e emissao do marketplace.
      //
      // b216 (Codex): so recusava a serie 2 (ML Full). A serie 3 da AMB
      // passava batido, e o sistema tentaria lancar uma devolucao que o
      // marketplace ja emite por conta propria.
      const serie = nf.serie != null ? String(nf.serie).trim().replace(/^0+/, '') : '';
      const chave = nf.chaveAcesso ? String(nf.chaveAcesso).replace(/\D/g, '') : '';
      const serieNF = serie || (chave.length === 44 ? chave.substr(22, 3).replace(/^0+/, '') : '');
      if (serieNF && serieNF !== '1') {
        resultados.push({ numero: num, ok: false,
          motivo: 'serie ' + serieNF + ' (FULL) - a devolucao e emitida pelo marketplace, nao lancar aqui' });
        continue;
      }

      // 4) Monta o card com os dados da propria NF
      const itens = Array.isArray(nf.itens) ? nf.itens : [];
      const it0 = itens[0] || {};
      const titulo = (it0.descricao || 'Produto da NF ' + num) + (itens.length > 1 ? ` (+${itens.length - 1} itens)` : '');

      const { data: novo, error: errIns } = await supabase
        .from(TAB)
        .insert([{
          shipment_id: 'manual-nf-' + num,
          order_id: nf.numeroPedidoLoja ? String(nf.numeroPedidoLoja) : null,
          pack_id: null,
          buyer_id: null,
          buyer_nome: nf.contato?.nome || null,
          buyer_nickname: null,
          pedido_bling_numero: null,
          produto_titulo: titulo,
          produto_mlb: null,
          produto_sku: it0.codigo || null,
          produto_qtd: it0.quantidade || null,
          produto_valor_unit: it0.valor || null,
          nf_numero: String(nf.numero),
          nf_serie: serie,
          nf_chave: nf.chaveAcesso || null,
          nf_valor: nf.valorNota || null,
          nf_data_emissao: nf.dataEmissao || null,
          nf_id_bling: String(nf.id),
          nf_link_danfe: nf.linkDanfe || (nf.chaveAcesso ? 'https://meudanfe.com.br/consulta/' + nf.chaveAcesso : null),
          nf_itens: mapItensNF(nf),
          // ⚠️ b450 - O MODELO DA AMB, NAO O DA GOOD. Esta rota foi portada da
          // GOOD, onde a devolucao tem `tipo: 'aprovado' + status: 'pendente'`.
          // Na AMB (e na Girassol) e o CONTRARIO: `tipo` diz o que a peca e
          // ('devolucao', 'recuperado', 'descartado') e `status` diz a fila
          // ('aprovado', 'problema', 'divergente'). A tela "Aprovadas" filtra
          // `status = 'aprovado'` — entao todo card lancado aqui nascia
          // INVISIVEL: existia (a 2a tentativa dizia "ja existe card
          // pendente") mas nunca aparecia. O dono achou na Girassol em 30/09;
          // na AMB nunca tinha funcionado.
          // b546 (Codex #449): na GOOD o modelo e o outro (tipo 'aprovado' + status 'pendente')
          tipo: TRIAGEM_NO_TIPO ? 'aprovado' : 'devolucao',
          status: TRIAGEM_NO_TIPO ? 'pendente' : 'aprovado',
          funcionario: req.usuario,
          problema_descricao: `[LANCAMENTO MANUAL por ${req.usuario}] card criado pelo nº da NF`,
        }])
        .select('id')
        .single();

      if (errIns) {
        resultados.push({ numero: num, ok: false, motivo: 'erro ao gravar: ' + errIns.message });
        continue;
      }
      criados++;
      resultados.push({ numero: num, ok: true, id: novo.id, cliente: nf.contato?.nome || null, valor: nf.valorNota || null });
      console.log(`[LANCAR-NF] card criado: NF ${nf.numero} (${nf.contato?.nome || '?'}) id=${novo.id}`);
    } catch (e) {
      resultados.push({ numero: num, ok: false, motivo: e.message || 'erro' });
    }
    await sleep(400);
  }

  return res.json({ ok: true, criados, resultados });
});

// ============================================================
// v3.20.1 - VINCULAR DEVOLUCAO JA EXISTENTE no Bling
// ============================================================
// Quando a NF de devolucao foi criada mas o resultado se perdeu
// (timeout do painel), o card fica "orfao". Esta rota procura a
// NF de ENTRADA (tipo=0) com a natureza de devolucao da GOOD na
// janela recente, casa por nome do comprador OU valor, e grava.
app.post('/api/admin/vincular-devolucao-existente/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  // b544 - a natureza de devolucao vem da FICHA DA EMPRESA (era a da GOOD escrita a mao: na AMB/Girassol esta rota
  // nunca achava a NF; e na GOOD so aceitava 1 das 2 naturezas da ficha). Sem natureza configurada, avisa —
  // 'nao sei qual natureza' nao e 'nao existe NF'.
  const NATUREZAS_DEVOLUCAO = String(naturezaDevolucaoDaEmpresa || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!NATUREZAS_DEVOLUCAO.length) {
    return res.status(500).json({ ok: false, erro: 'natureza de devolucao desta empresa nao configurada na ficha' });
  }
  try {
    const { data: reg, error: errReg } = await supabase
      .from(TAB)
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    if (reg.nf_devolucao_id_bling) {
      return res.json({ ok: true, ja_tinha: true, nf_devolucao_numero: reg.nf_devolucao_numero });
    }

    // Janela: da criacao do registro (menos 1 dia) ate amanha
    const f = (d) => d.toISOString().slice(0, 10);
    const iniData = reg.created_at ? new Date(new Date(reg.created_at).getTime() - 864e5) : new Date(Date.now() - 30 * 864e5);
    const ini = f(iniData);
    const fim = f(new Date(Date.now() + 864e5));

    const nomeBusca = String(reg.buyer_nome || '').trim().toLowerCase();
    // b141 - casar por PEDACOS do nome. O nome do card vem do ML e o da NF
    // vem do cadastro fiscal - quase nunca sao identicos ("Monica Rosrigues"
    // no card, "Monica Maria Rodrigues" na nota). O includes() da string
    // inteira falhava sempre nesses casos.
    const pedacos = nomeBusca.split(/\s+/).filter(w => w.length >= 4);
    const valorEsperado = (Number(reg.produto_valor_unit) || 0) * (Number(reg.produto_qtd) || 1);

    let varridas = 0;                      // b141 - pro diagnostico
    const candidatos = [];
    for (let pg = 1; pg <= 4; pg++) {
      if (pg > 1) await sleep(400);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=0&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) break;
      const lista = r.data?.data || [];
      if (lista.length === 0) break;
      for (const nf of lista) {
        if (!NATUREZAS_DEVOLUCAO.includes(String(nf.naturezaOperacao?.id || ''))) continue;
        varridas++;
        const nomeNF = String(nf.contato?.nome || '').toLowerCase();
        // basta UM pedaco do nome bater (o sobrenome, normalmente)
        const bateNome = pedacos.length > 0 && pedacos.some(w => nomeNF.includes(w));
        const bateValor = valorEsperado > 0 && nf.valorNota != null &&
          Math.abs(Number(nf.valorNota) - valorEsperado) < 0.05;
        if (bateNome || bateValor) candidatos.push(nf);
      }
      if (lista.length < 100) break;
    }

    if (candidatos.length === 0) {
      return res.status(404).json({ ok: false, erro: 'Nenhuma NF de devolucao correspondente achada no Bling (janela ' + ini + '..' + fim + ')' });
    }

    // Mais recente primeiro
    candidatos.sort((a, b) => new Date(b.dataEmissao || 0) - new Date(a.dataEmissao || 0));
    const nf = candidatos[0];

    const { error: errUpd } = await supabase
      .from(TAB)
      .update({
        nf_devolucao_id_bling: String(nf.id),
        nf_devolucao_numero: String(nf.numero || ''),
      })
      .eq('id', req.params.id);
    if (errUpd) return res.status(500).json({ ok: false, erro: 'Achei a NF ' + nf.numero + ' mas falhou ao gravar: ' + errUpd.message });

    console.log(`[VINCULAR-DEV] ${req.params.id}: NF devolucao ${nf.numero} (id ${nf.id}) vinculada (${candidatos.length} candidata(s))`);
    return res.json({ ok: true, nf_devolucao_numero: String(nf.numero || ''), nf_devolucao_id_bling: String(nf.id), candidatas: candidatos.length });
  } catch (e) {
    console.error('[VINCULAR-DEV] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.19.2 - RAIO-X do resgate de NF (dry-run, abre no navegador)
// b212 - RAIO-X DA BUSCA POR NUMERO DE NF. O Diego buscou a NF 2447 e a
// tela respondeu "nao localizada", mas a MESMA nota aparece quando ele
// busca pelo pack id do ML. A funcao ja aceita um `trace`; esta rota
// simplesmente expoe esse passo a passo, pra a causa aparecer em vez de
// eu adivinhar (filtro ?numero= nao honrado? serie? janela de datas?).
// GET /api/debug/nf-numero/:numero?k=ADMIN_KEY[&serie=1]
app.get('/api/debug/nf-numero/:numero', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, erro: 'so admin' });
  const trace = [];
  try {
    if (typeof buscarNFsPorNumero !== 'function') {
      return res.status(500).json({ ok: false, erro: 'buscarNFsPorNumero nao foi injetada nas deps' });
    }
    const achadas = await buscarNFsPorNumero(
      req.params.numero,
      req.query.serie || null,
      { trace, mesesAtras: Number(req.query.meses) || 18 },
    );
    if (achadas === null) {   // b472: o Bling nao respondeu — nao e "nao existe"
      return res.status(503).json({ ok: false, erro: 'o Bling nao respondeu (cota/429) — tente de novo em 1 minuto; isso NAO quer dizer que a NF nao existe', bling_indisponivel: true, trace });
    }
    res.json({ ok: true, numero: req.params.numero, achadas, passos: trace });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e), passos: trace });
  }
});

// b243 - RAIO-X DOS ITENS DA NF. A foto deveria vir pelo `produto.id` do
// item (vinculo estavel, imune a rename do SKU), mas a chamada da tela sai
// SEM `?produtoId=` — ou seja, o campo nao esta chegando. Em vez de adivinhar
// o nome do campo, esta rota mostra as CHAVES cruas que o Bling devolve em
// cada item, e o que ha dentro de `produto` quando existe.
// GET /api/debug/itens-nf/:idNF?k=ADMIN_KEY
app.get('/api/debug/itens-nf/:idNF', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, erro: 'so admin' });
  try {
    const r = await chamarBling(`/nfe/${encodeURIComponent(req.params.idNF)}`);
    const nf = (r.ok && r.data && r.data.data) || null;
    if (!nf) return res.status(404).json({ ok: false, erro: 'NF nao encontrada', status: r.status || null });
    const itens = Array.isArray(nf.itens) ? nf.itens : [];
    res.json({
      ok: true,
      nf: { id: nf.id, numero: nf.numero, serie: nf.serie },
      qtd_itens: itens.length,
      itens: itens.map(it => ({
        campos_do_item: Object.keys(it),
        codigo: it.codigo || null,
        descricao: it.descricao || null,
        tem_produto: !!it.produto,
        produto: it.produto ? { campos: Object.keys(it.produto), id: it.produto.id || null } : null,
        produtoId_solto: it.produtoId || null,
      })),
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

// b247 - SONDA: EXISTE NF DE DEVOLUCAO NO ML? (pedido do Diego, 14/08)
//
// Regra de negocio: devolucao Full do ML (serie 2) JA TEM a NF de devolucao
// emitida pelo proprio ML — o app nao deve gerar outra, senao ficam DUAS
// notas para a mesma volta. Mas o Full pode falhar e nao gerar; entao antes
// de decidir e preciso CONSTATAR (principio que ele prega: nao inferir pelo
// status, constatar pelo dado).
//
// Hoje ele confere a mao em vendedores.mercadolivre.com.br/emissor/vendas/
// {order_id}/faturas. Esta sonda testa os endpoints candidatos da API e
// mostra qual responde e o que traz — em vez de eu adivinhar o caminho.
// GET /api/debug/nf-ml/:orderId?k=ADMIN_KEY[&pack=PACK_ID][&shipment=SHIP_ID]
app.get('/api/debug/nf-ml/:orderId', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, erro: 'so admin' });
  const oid = String(req.params.orderId || '').replace(/\D/g, '');
  const pack = String(req.query.pack || '').replace(/\D/g, '');
  const ship = String(req.query.shipment || '').replace(/\D/g, '');
  // b250 (review do Codex) - se o /users/me falhar, o caminho que depende do
  // id do vendedor some da lista SEM AVISO, e o retorno pareceria dizer que
  // aquele endpoint nao serve. Agora a falha e reportada.
  let uid = '';
  let erroUid = null;
  try {
    const me = await chamarML('/users/me');
    uid = String((me.ok && me.data && me.data.id) || '');
    if (!uid) erroUid = { status: me.status || null, motivo: 'nao consegui o id do vendedor' };
  } catch (e) { erroUid = { motivo: String(e.message || e).slice(0, 200) }; }

  // b253 - o dado do Diego fechou a primeira metade: a tela do ML mostra
  // DUAS notas na venda 2000017624047456 ("Nota de devolucao no 5364" e
  // "NF-e de venda no 5161"), e /users/{uid}/invoices/orders/{oid} devolveu
  // SO A 5161. Ou seja, aquele caminho entrega apenas a nota de VENDA.
  // Estes candidatos procuram a de DEVOLUCAO — e o `?bruto=1` mostra a
  // resposta inteira (sem os blocos com dado pessoal) quando for preciso
  // enxergar um campo que o resumo nao previu.
  const alvos = [
    uid ? `/users/${uid}/invoices/orders/${oid}` : null,
    uid ? `/users/${uid}/invoices/orders/${oid}?document_type=return` : null,
    uid ? `/users/${uid}/invoices/orders/${oid}/returns` : null,
    uid ? `/users/${uid}/invoices/returns/orders/${oid}` : null,
    uid ? `/users/${uid}/invoices?order_id=${oid}` : null,
    pack ? (uid ? `/users/${uid}/invoices/packs/${pack}` : null) : null,
    `/orders/${oid}/returns`,
    ship ? `/shipments/${ship}/invoice_data?siteId=MLB` : null,
  ].filter(Boolean);

  // b248 (review do Codex) - a sonda existe pra responder UMA pergunta:
  // "ha NF de devolucao?". Cortar o JSON em 600 caracteres podia mostrar so
  // a nota de VENDA e sugerir que nao ha devolucao — exatamente o erro que
  // a rota deveria evitar. Entao: resumir CADA documento (poucos campos), em
  // vez de truncar o payload. E nada de dado do comprador: `billing_info`
  // traz CPF, nome, telefone e endereco, e diagnostico e feito pra ser
  // copiado e colado por ai.
  // b249 (review do Codex) - inclui os nomes que o /invoice_data usa de fato
  // (invoice_id, invoice_key, cfop, invoice_type...), senao o resumo daquele
  // endpoint cairia no ramo generico e perderia justamente o que interessa.
  const CAMPOS_NF = ['type', 'document_type', 'invoice_type', 'kind', 'operation_type', 'cfop',
    'number', 'invoice_number', 'invoice_id', 'id', 'serie', 'series', 'invoice_series',
    'key', 'access_key', 'authorization_key', 'invoice_key', 'nfe_key',
    'status', 'state', 'date', 'date_created', 'invoice_date', 'creation_date', 'total_amount'];
  // b252 - o endpoint certo apareceu: /users/{uid}/invoices/orders/{oid}
  // responde 200 com a nota (invoice_number, invoice_series, status). Falta
  // saber se e a de VENDA ou a de DEVOLUCAO — e a distincao que decide se o
  // app pode parar de oferecer "gerar NF". Os campos que provavelmente
  // carregam isso (`attributes`, `fiscal_data`, `transaction_status`) nao
  // estavam no resumo. Entram agora, SEM `issuer`/`recipient`/`payments`,
  // que trazem CPF, nome e endereco.
  const SENSIVEIS = new Set(['issuer', 'recipient', 'payments', 'buyer', 'seller',
    'custom_issuer_address', 'billing_info', 'shipping', 'receiver_address']);
  const soEscalares = (o, prof) => {
    if (!o || typeof o !== 'object' || prof > 2) return null;
    const r = {};
    for (const [k, v] of Object.entries(o)) {
      if (SENSIVEIS.has(k)) continue;
      if (v == null) continue;
      if (typeof v === 'object') { const dentro = soEscalares(v, prof + 1); if (dentro) r[k] = dentro; }
      else if (String(v).length <= 60) r[k] = v;
    }
    return Object.keys(r).length ? r : null;
  };
  const resumirDoc = (d) => {
    if (!d || typeof d !== 'object') return null;
    const out = {};
    for (const k of CAMPOS_NF) if (d[k] !== undefined && d[k] !== null) out[k] = d[k];
    // b252 - os blocos que podem dizer o TIPO da nota, ja peneirados
    for (const k of ['attributes', 'fiscal_data', 'transaction_status', 'items_quantity', 'pack_id', 'amount']) {
      if (d[k] === undefined || d[k] === null) continue;
      out[k] = (typeof d[k] === 'object') ? soEscalares(d[k], 0) : d[k];
    }
    if (Array.isArray(d.items) && d.items.length) {
      out.itens = d.items.slice(0, 5).map(it => soEscalares(it, 1));
    }
    return Object.keys(out).length ? out : { campos: Object.keys(d).slice(0, 20) };
  };
  const acharDocs = (d) => {
    if (!d || typeof d !== 'object') return [];
    if (Array.isArray(d)) return d;
    for (const k of ['results', 'invoices', 'documents', 'fiscal_documents', 'data', 'billing_info']) {
      if (Array.isArray(d[k])) return d[k];
      if (d[k] && typeof d[k] === 'object') return [d[k]];
    }
    // b249 - so tratar o objeto do topo como documento se ele PARECER um:
    // devolver qualquer resposta como "documento" faria a sonda relatar
    // documentos onde nao ha nenhum.
    const pareceNF = CAMPOS_NF.some(k => d[k] !== undefined && d[k] !== null);
    return pareceNF ? [d] : [];
  };

  // b249 - teto de tempo: 6 chamadas sequenciais ao ML sem limite podiam
  // segurar a requisicao ate o timeout do Render. Passou de 25s, encerra e
  // devolve o que ja apurou, dizendo que faltou.
  const LIMITE_MS = Date.now() + 25000;
  const passos = [];
  for (const caminho of alvos) {
    if (Date.now() > LIMITE_MS) { passos.push({ caminho, pulado: 'prazo da sonda estourou' }); continue; }
    try {
      // b251 (review do Codex) - o teto de 25s so era checado ANTES de cada
      // chamada: uma unica requisicao lenta ao ML podia furar o prazo inteiro
      // e a rota morrer no timeout do Render sem devolver nada. Agora a
      // propria chamada corre contra o prazo que resta.
      const restante = Math.max(1000, LIMITE_MS - Date.now());
      const r = await Promise.race([
        chamarML(caminho),
        new Promise(ok => setTimeout(() => ok({ ok: false, status: null, error: 'prazo da sonda estourou nesta chamada' }), restante)),
      ]);
      const d = r.data;
      // b249 - resumir TODOS (o resumo ja e pequeno); cortar em 10 podia
      // deixar a NF de devolucao de fora quando ha muitos documentos
      const achados = r.ok ? acharDocs(d) : [];
      // b253 - com ?bruto=1, a resposta inteira peneirada (sem issuer,
      // recipient, payments): serve pra achar o campo que marca "devolucao"
      // quando o resumo nao o previu.
      const bruto = (String(req.query.bruto || '') === '1' && r.ok) ? soEscalares(d, 0) : null;
      const docs = achados.map(resumirDoc).filter(Boolean);
      passos.push({
        caminho,
        status: r.status || (r.ok ? 200 : null),
        ok: !!r.ok,
        campos: d && typeof d === 'object' && !Array.isArray(d) ? Object.keys(d).slice(0, 25) : null,
        qtd_documentos: r.ok ? docs.length : null,
        qtd_bruta: r.ok ? achados.length : null,   // b249 - confere se algum resumo caiu
        bruto,   // b253 - so quando ?bruto=1
        documentos: r.ok ? docs : null,
        // b248 - o corpo do ERRO distingue "endpoint nao existe" de "existe,
        // mas falta permissao/parametro" — mas so a mensagem, sem dado nenhum
        // b250 (review do Codex) - o erro do ML nem sempre e objeto: quando
        // vem string, ler `.message` dava null e a sonda perdia a unica pista
        // que distingue "endpoint nao existe" de "falta permissao".
        erro_ml: !r.ok && r.error ? (
          typeof r.error === 'string'
            ? { message: r.error.slice(0, 300) }
            : {
                message: (r.error.message || r.error.error || null),
                status: r.error.status || null,
                cause: Array.isArray(r.error.cause) ? r.error.cause.slice(0, 3) : null,
              }
        ) : null,
      });
    } catch (e) {
      passos.push({ caminho, erro: String(e.message || e) });
    }
    await sleep(250);
  }
  res.json({
    ok: true, order_id: oid, user_id: uid || null,
    erro_user_id: erroUid,   // b250 - por que o caminho por vendedor nao foi tentado
    passos,
  });
});

// b254 - RAIO-X DA NOTA DE ENTRADA (devolucao) NO BLING.
//
// A API do ML nao expoe a NF de devolucao (as 6 variantes da sonda deram
// 404/405/400 e o `?document_type=return` e ignorado). Mas ela ENTRA no
// Bling — e o Diego mostrou a tela de notas de ENTRADA trazendo um bloco
// "Chave de acesso | Numero | Serie" com a chave da NF de VENDA (5161).
// Se isso for o campo de NOTAS REFERENCIADAS, o casamento e EXATO: a
// devolucao aponta pra venda, sem depender de nome nem de data.
// Esta rota mostra os campos crus da nota de entrada pra confirmar.
// GET /api/debug/nf-entrada/:idNF?k=ADMIN_KEY
app.get('/api/debug/nf-entrada/:idNF', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, erro: 'so admin' });
  try {
    const r = await chamarBling(`/nfe/${encodeURIComponent(req.params.idNF)}`);
    const nf = (r.ok && r.data && r.data.data) || null;
    if (!nf) return res.status(404).json({ ok: false, erro: 'nao achei essa NF', status: r.status || null });
    // procura qualquer campo que pareca "nota referenciada", sem depender do
    // nome exato (o Bling varia entre versoes)
    const refs = {};
    for (const [k, v] of Object.entries(nf)) {
      if (!/refer|vincul|origem|documento/i.test(k)) continue;
      refs[k] = typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
    }
    res.json({
      ok: true,
      campos_do_topo: Object.keys(nf),
      resumo: {
        id: nf.id, tipo: nf.tipo, numero: nf.numero, serie: nf.serie,
        situacao: nf.situacao, dataEmissao: nf.dataEmissao,
        chaveAcesso: nf.chaveAcesso || null,
        naturezaOperacao: nf.naturezaOperacao || null,
        contato_nome: nf.contato && nf.contato.nome ? nf.contato.nome : null,
        numeroPedidoLoja: nf.numeroPedidoLoja || null,
      },
      campos_de_referencia: Object.keys(refs).length ? refs : null,
      // as observacoes costumam citar a nota de origem por extenso
      observacoes: String(nf.observacoes || nf.informacoesAdicionais || '').slice(0, 800) || null,
      itens: Array.isArray(nf.itens) ? nf.itens.map(it => ({
        codigo: it.codigo || null, descricao: (it.descricao || '').slice(0, 80),
        quantidade: it.quantidade || null, gtin: it.gtin || null,
      })) : null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

// b256 - o PAINEL pergunta antes de oferecer "gerar NF": ja existe nota de
// devolucao pra esta volta? Cobre os DOIS casos que o Diego citou: a NF que
// o Full do ML emite sozinho e a entrada que outro admin ja lancou. Achou ->
// a tela mostra a nota e esconde o gerar, deixando so incluir estoque.
// b572 - dono, 06/10: card de KIT mostra o ANUNCIO vendido (titulo e SKU do marketplace, ex.: '4 Lixas 4 Pol ... +
// Disco Prato + Adaptador M14' / '4LixDIAM-1DISC-1PIN-Kit51'); os itens da NF seguem listados embaixo, um por um.
// Comeca pelo ML (/orders/{id} -> order_items[].item.title/seller_sku). Cache de 6 h por pedido; outro marketplace
// responde suportado:false (a tela mantem a linha de 'N produtos'). Nao grava nada no banco.
const _cacheAnuncio = new Map();
app.get('/api/admin/anuncio-do-pedido', requerAdmin, async (req, res) => {
  const mkt = String(req.query.mkt || '').toLowerCase();
  const pedido = String(req.query.pedido || '').replace(/\D/g, '');
  if (!pedido && !String(req.query.pedido || '').trim()) return res.status(400).json({ ok: false, erro: 'pedido obrigatorio' });
  // Codex #464 (P2): marketplace vazio + id no formato do ML (20 + 14 digitos) e ML — mesma inferencia do painel (b492)
  const ehML = /^(ml|mercadolivre|mercado_livre|mercado livre)$/.test(mkt) || (!mkt && /^20\d{14}$/.test(pedido));
  // b595 - dono, 08/10: 'todos marketplaces fornecem titulo e SKU do anuncio'. Magalu: /seller/v1/orders/{codigo de 16
  // digitos} -> deliveries[].items[].info.name / info.sku (formato conferido num pedido real da GOOD, 1575070106528392).
  const ehMagalu = /^magalu|magazine/.test(mkt) || (!mkt && /^\d{16}$/.test(pedido) && !/^20\d{14}$/.test(pedido));
  if (ehMagalu) return anuncioMagalu(pedido, res);
  // b597 - Shopee: o servico da Shopee (proxy multi-loja) expoe /:loja/interno/anuncio-do-pedido (PR #27 de la)
  const snShopee = String(req.query.pedido || '').trim();
  // order_sn da Shopee tem ao menos uma LETRA (regra do painel) — sem isso, o pedido do ML (20 + 14 digitos) cairia aqui
  const ehShopee = /^shopee/.test(mkt) || (!mkt && /^\d{6}(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}$/.test(snShopee));
  if (ehShopee) return anuncioShopee(snShopee, res);
  if (!ehML) return res.json({ ok: false, suportado: false, motivo: 'marketplace ainda sem anuncio (ML e Magalu ligados)' });
  const chave = 'ml:' + pedido;
  const c = _cacheAnuncio.get(chave);
  if (c && Date.now() - c.ts < 6 * 3600e3) return res.json(c.v);
  try {
    const r = await chamarML('/orders/' + pedido);
    if (!r || !r.ok) return res.status(502).json({ ok: false, erro: 'ML nao devolveu o pedido', status: (r && r.status) || null });
    const itens = ((r.data && r.data.order_items) || []).map((oi) => ({
      titulo: (oi.item && oi.item.title) || null,
      sku: (oi.item && (oi.item.seller_sku || oi.item.seller_custom_field)) || null,
      qtd: oi.quantity || null,
    }));
    const v = { ok: true, mkt: 'ml', pedido, itens, titulo: (itens[0] && itens[0].titulo) || null, sku: (itens[0] && itens[0].sku) || null };
    if (_cacheAnuncio.size > 2000) _cacheAnuncio.clear();
    _cacheAnuncio.set(chave, { ts: Date.now(), v });
    return res.json(v);
  } catch (e) {
    return res.status(502).json({ ok: false, erro: e.message });
  }
});

// b597 - anuncio do pedido na Shopee, pelo servico da Shopee (mesmo formato de resposta do ML/Magalu)
async function anuncioShopee(sn, res) {
  const px = deps.shopeeProxy || {};
  if (!px.url || !px.loja || !px.key) return res.json({ ok: false, suportado: false, motivo: 'servico da Shopee nao configurado nesta empresa' });
  if (!sn) return res.status(400).json({ ok: false, erro: 'pedido obrigatorio' });
  const chave = 'shopee:' + px.loja + ':' + sn;
  const c = _cacheAnuncio.get(chave);
  if (c && Date.now() - c.ts < 6 * 3600e3) return res.json(c.v);
  try {
    const r = await fetch(String(px.url).replace(/\/+$/, '') + '/' + encodeURIComponent(px.loja) + '/interno/anuncio-do-pedido?sn=' + encodeURIComponent(sn),
      { headers: { 'x-internal-key': px.key } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok) return res.status(502).json({ ok: false, erro: 'servico da Shopee nao devolveu o pedido', status: r.status, detalhe: j && j.erro });
    const itens = (j.itens || []).map((i) => ({ titulo: i.titulo ? (i.variacao ? i.titulo + ' — ' + i.variacao : i.titulo) : null, sku: i.sku || null, qtd: i.qtd || null, preco: i.preco || null }));
    const v = { ok: true, mkt: 'shopee', pedido: sn, itens, titulo: (itens[0] && itens[0].titulo) || null, sku: (itens[0] && itens[0].sku) || null };
    if (_cacheAnuncio.size > 2000) _cacheAnuncio.clear();
    _cacheAnuncio.set(chave, { ts: Date.now(), v });
    return res.json(v);
  } catch (e) {
    return res.status(502).json({ ok: false, erro: e.message });
  }
}

// b595 - anuncio do pedido no Magalu (mesmo formato de resposta do ML)
async function anuncioMagalu(pedido, res) {
  if (typeof deps.chamarMagalu !== 'function') return res.json({ ok: false, suportado: false, motivo: 'Magalu nao ligado nesta empresa' });
  const chave = 'magalu:' + pedido;
  const c = _cacheAnuncio.get(chave);
  if (c && Date.now() - c.ts < 6 * 3600e3) return res.json(c.v);
  try {
    const r = await deps.chamarMagalu('/seller/v1/orders/' + pedido);
    if (!r || !r.ok) return res.status(502).json({ ok: false, erro: 'Magalu nao devolveu o pedido', status: (r && r.status) || null });
    const itens = [];
    ((r.data && r.data.deliveries) || []).forEach((dl) => ((dl && dl.items) || []).forEach((it) => {
      const info = (it && it.info) || {};
      itens.push({ titulo: info.name || null, sku: info.sku || null, qtd: (it && it.quantity) || null });
    }));
    const v = { ok: true, mkt: 'magalu', pedido, itens, titulo: (itens[0] && itens[0].titulo) || null, sku: (itens[0] && itens[0].sku) || null };
    if (_cacheAnuncio.size > 2000) _cacheAnuncio.clear();
    _cacheAnuncio.set(chave, { ts: Date.now(), v });
    return res.json(v);
  } catch (e) {
    return res.status(502).json({ ok: false, erro: e.message });
  }
}

app.get('/api/admin/nf-devolucao', requerAdmin, async (req, res) => {
  if (typeof buscarNfDevolucaoBling !== 'function') {
    return res.status(500).json({ ok: false, erro: 'busca nao injetada nas deps' });
  }
  // Codex #441 (P1): na GOOD o chamarBling PODE LANCAR (a fila do ritmo rejeita no timeout, antes do
  // try da lib). Rota async no Express 4 nao pega rejeicao: a requisicao ficava sem resposta.
  // Busca que nao rodou = INDETERMINADO, nunca "nao achei".
  let r;
  try {
    r = await buscarNfDevolucaoBling({
      cliente: req.query.cliente || null,
      sku: req.query.sku || null,
      desde: req.query.desde || null,
      ate: req.query.ate || null,
      // ⚠️ b402: sem isto, cai no id da AMBTotal cravado no lib/nf-pessoa.
      naturezaId: naturezaDevolucaoDaEmpresa || null,
    });
  } catch (e) {
    return res.json({ ok: false, motivo: 'nao consegui consultar o Bling agora (fila ocupada ou fora do ar) — confira no Bling antes de gerar' });
  }
  // b308 (review do Codex) - O CASO DAS DUAS COMPRAS. Se o cliente comprou o
  // mesmo SKU duas vezes e devolveu SO uma, a nota existente satisfaz
  // "cliente + sku" nos DOIS cards e o card errado perderia os botoes. O
  // Bling nao diz a qual venda a nota pertence — mas NOS sabemos: se ela ja
  // esta vinculada a OUTRA devolucao aqui no banco, nao e a desta volta.
  try {
    if (r && r.ok && r.achou && r.nf && r.nf.id && supabase) {
      const idDesta = String(req.query.devolucaoId || '').trim();
      const { data: usos, error: erroUsos } = await supabase
        .from(TAB)
        .select('id')
        .eq('nf_devolucao_id_bling', String(r.nf.id))
        .limit(5);
      // b309 (review do Codex) - o cliente do Supabase resolve com
      // { data: null, error } em vez de lancar, entao o try/catch NAO pegava:
      // uma falha passageira de banco viraria "nao ha vinculo" e a checagem
      // que existe justo pra desambiguar diria o contrario do que devia.
      // Erro aqui = INDETERMINADO, nao "esta livre".
      if (erroUsos) {
        return res.json({
          ok: false,
          motivo: 'nao consegui conferir no banco se esta nota ja esta vinculada a outra devolucao — confira no Bling antes de gerar',
        });
      }
      const outros = (usos || []).filter(u => String(u.id) !== idDesta);
      if (outros.length) {
        return res.json({
          ok: true, achou: false,
          motivo: 'essa nota de entrada JA esta vinculada a outra devolucao aqui no sistema — nao e a desta volta',
          candidatos: [{ id: r.nf.id, numero: r.nf.numero, serie: r.nf.serie, data: r.nf.dataEmissao || null, cliente: r.nf.cliente }],
        });
      }
      // b311 (review do Codex, apontamento em aberto) - VINCULO VAZIO NAO E
      // PROVA. A nota pode ser orfa (importada, ou sobrou de um registro que
      // falhou) e ainda assim pertencer a OUTRA venda. Ela so desambigua
      // quando ha uma unica compra deste cliente+SKU na janela: com duas
      // compras e uma volta so, a mesma nota serve aos dois cards e o card
      // errado perderia os botoes. Entao, havendo mais de uma devolucao
      // NOSSA do mesmo cliente+SKU, o desfecho e INDETERMINADO.
      const cliBusca = String(req.query.cliente || '').trim();
      const skuBusca = String(req.query.sku || '').trim();
      if (cliBusca && skuBusca) {
        // b313 (review do Codex) - a conferencia de "irmas" tem que usar a
        // MESMA regra de igualdade do casamento la no Bling. Com nome exato e
        // SKU sensivel a caixa, dois cards do mesmo cliente gravados como
        // "MONICA RODRIGUES" e "MONICA MARIA RODRIGUES" (ou SKU com caixa
        // diferente) nao se enxergariam, e a mesma nota solta seria aceita
        // nos DOIS — exatamente o que esta trava existe pra impedir. Entao
        // trago os candidatos por SKU normalizado e comparo o nome aqui,
        // com a mesma funcao de partes estaveis usada no matcher.
        // b316 (review do Codex) - usar o MESMO comparador do casamento, nao
        // uma copia parecida. A minha versao mantinha pontuacao e particulas
        // de uma letra; a oficial troca pontuacao por espaco e descarta
        // tokens de 1 letra. Com "MARIA D'AVILA" e "MARIA D AVILA" a nota
        // casava no Bling e os dois cards NAO se enxergavam aqui.
        const normSku = (x) => String(x || '').toLowerCase().normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
        const skuNorm = normSku(skuBusca);
        /* Codex #441 (P2 x2): o prefiltro `ilike %SKU%` no banco nao enxerga acento nem espaco interno
           (a normSku enxerga), e sem ORDER BY o corte de 500 podia deixar a irma de verdade de fora.
           Agora le TODAS as sem-nota, paginando com ordem estavel, e compara em JS com a normSku.
           Se nem assim couber no teto de paginas, e INDETERMINADO (nunca "nao ha irma").
           b317 - a irma so cria duvida se ela mesma AINDA nao tem nota (nf_devolucao_id_bling nulo).
           b318 - a coluna de data e `nf_data_emissao`; `nf_data` NAO existe na tabela. */
        const POR_PAGINA = 1000, MAX_PAGINAS = 10;
        let irmasBrutas = [], erroIrmas = null, truncouIrmas = false;
        for (let pg = 0; pg < MAX_PAGINAS; pg++) {
          const { data: lote, error: eLote } = await supabase
            .from(TAB)
            .select('id, buyer_nome, produto_sku, nf_devolucao_id_bling, nf_data_emissao, ' + COL_CRIADO)
            .is('nf_devolucao_id_bling', null)
            .order('id', { ascending: true })
            .range(pg * POR_PAGINA, pg * POR_PAGINA + POR_PAGINA - 1);
          if (eLote) { erroIrmas = eLote; break; }
          irmasBrutas = irmasBrutas.concat(lote || []);
          if (!lote || lote.length < POR_PAGINA) break;
          if (pg === MAX_PAGINAS - 1) truncouIrmas = true;
        }
        const comparaNome = (typeof nomesBatemNf === 'function')
          ? nomesBatemNf
          : (x, y) => normSku(x) === normSku(y);   // sem o oficial, exige igualdade
        // b318 (review do Codex) - VOLTEI ATRAS no filtro por janela da b317.
        // Uma compra ANTIGA pode gerar nota de devolucao tardia, que cai
        // dentro da janela desta busca — cortar por data devolvia justamente
        // a ambiguidade real pra debaixo do tapete. O que continua valendo e
        // o filtro por nota JA vinculada (essa sim nao disputa nada).
        // b319 (review do Codex) - a irma so disputa esta nota se a venda dela
        // aconteceu ANTES da nota existir. Compra feita DEPOIS da nota nao
        // pode te-la gerado, e conta-la deixava o caso "indeterminado" sem
        // motivo — soltando a emissao e arriscando a duplicata.
        //
        // Isto NAO e o filtro por janela que revertemos na b318: la eu cortava
        // compra ANTIGA (que pode gerar devolucao tardia, e por isso disputa
        // mesmo); aqui corto so o que veio DEPOIS da nota, que e impossivel.
        const dataDaNota = String((r.nf && r.nf.dataEmissao) || '').slice(0, 10);
        const antesDaNota = (u) => {
          if (!dataDaNota) return true;   // sem data da nota, nao descarto ninguem
          // b321 (review do Codex) - `criado_em` e quando a DEVOLUCAO foi
          // registrada na triagem, nao quando a venda aconteceu. Se a nota do
          // marketplace saiu antes de o galpao bipar, esse fallback fazia a
          // irma parecer comprada DEPOIS da nota e eu a descartava — e a
          // mesma nota solta seria aceita pra outra compra do cliente,
          // escondendo os botoes do card certo. Sem a data da VENDA, o caso
          // continua ambiguo: mantenho a irma.
          const dt = String(u.nf_data_emissao || '').slice(0, 10);
          if (!dt) return true;
          return dt <= dataDaNota;
        };
        const irmas = (irmasBrutas || []).filter((u) => antesDaNota(u) && (
          normSku(u.produto_sku) === skuNorm && comparaNome(u.buyer_nome, cliBusca)
        ));

        // Codex #441: lista truncada (sem ordem/pagina completa) = nao da pra afirmar que nao ha irma.
        if (!erroIrmas && truncouIrmas) {
          return res.json({
            ok: false,
            motivo: 'ha registros demais deste SKU pra eu conferir se este cliente tem outra compra igual — confira no Bling antes de gerar',
          });
        }
        if (erroIrmas) {
          return res.json({
            ok: false,
            motivo: 'nao consegui conferir no banco se ha mais de uma compra deste cliente com este SKU — confira no Bling antes de gerar',
          });
        }
        const outrasCompras = (irmas || []).filter(u => String(u.id) !== idDesta);
        if (outrasCompras.length) {
          return res.json({
            ok: false,
            motivo: 'este cliente tem mais de uma devolucao deste mesmo SKU aqui, e a nota achada nao esta vinculada a nenhuma — nao da pra dizer a qual volta ela pertence. Confira no Bling antes de gerar',
          });
        }
      }
    }
  } catch (e) {
    // b310 (review do Codex) - se a consulta LANCAR (rede caida, cliente
    // quebrado), cair fora do try devolvia a resposta original como se o
    // vinculo tivesse sido conferido. Mesma regra do erro no objeto: nao
    // conseguir olhar e INDETERMINADO.
    return res.json({
      ok: false,
      motivo: 'nao consegui conferir no banco se esta nota ja esta vinculada a outra devolucao — confira no Bling antes de gerar',
    });
  }

  res.json(r);
});

// b255 - EXISTE NF DE DEVOLUCAO NO BLING PRA ESTA VOLTA?
// A API do ML nao entrega essa nota; o Bling sim (ela e importada la).
// Casamento por natureza de devolucao + cliente + SKU, dentro da janela que
// comeca na emissao da NF de venda.
// GET /api/debug/nf-devolucao?k=&cliente=&sku=&desde=AAAA-MM-DD
app.get('/api/debug/nf-devolucao', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, erro: 'so admin' });
  if (typeof buscarNfDevolucaoBling !== 'function') {
    return res.status(500).json({ ok: false, erro: 'busca nao injetada nas deps' });
  }
  // b546 (Codex #449): chamarBling pode LANCAR (fila cheia); rota async no Express 4 nao pega rejeicao
  let r;
  try {
    r = await buscarNfDevolucaoBling({
      cliente: req.query.cliente || null,
      sku: req.query.sku || null,
      desde: req.query.desde || null,
      ate: req.query.ate || null,
      // ⚠️ b402: sem isto, cai no id da AMBTotal cravado no lib/nf-pessoa.
      naturezaId: naturezaDevolucaoDaEmpresa || null,
    });
  } catch (e) {
    return res.status(503).json({ ok: false, erro: 'nao consegui consultar o Bling agora (fila ocupada ou fora do ar): ' + String((e && e.message) || e).slice(0, 160) });
  }
  res.json(r);
});

// b282 (regra dele: "se tem alguma forma de API pegar isso, otimo. senao vai
// na unha manual mesmo") - os DOIS ids fiscais que sobraram no painel
// (idEmpresaControl e idNaturezaOperacao) foram capturados na TELA do Bling
// com o F12, nao pela API. Antes de decidir como tirar do codigo, precisamos
// saber o que a API v3 entrega: esta sonda mostra as naturezas de operacao e
// os campos crus de um deposito (o comentario do painel diz que o
// idEmpresaControl saiu de `depositos[].idEmpresa` do endpoint interno).
// GET /api/debug/ids-fiscais?k=ADMIN_KEY
app.get('/api/debug/ids-fiscais', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, erro: 'so admin' });
  const out = {};
  const tentar = async (caminho) => {
    try {
      const r = await chamarBling(caminho);
      const d = (r.data && r.data.data) || null;
      return {
        status: r.status || (r.ok ? 200 : null),
        ok: !!r.ok,
        qtd: Array.isArray(d) ? d.length : (d ? 1 : 0),
        // so o que interessa: id, descricao e os campos que possam trazer empresa
        amostra: Array.isArray(d)
          ? d.slice(0, 12).map((x) => ({
              id: x.id, descricao: x.descricao || x.nome || null,
              padrao: x.padrao != null ? x.padrao : undefined,
              tipo: x.tipo != null ? x.tipo : undefined,
              idEmpresa: x.idEmpresa || (x.empresa && x.empresa.id) || undefined,
            }))
          : (d ? { campos: Object.keys(d).slice(0, 25) } : null),
        erro_ml: !r.ok ? String((r.error && (r.error.message || r.error.error)) || r.error || '').slice(0, 200) : null,
      };
    } catch (e) { return { erro: String(e.message || e).slice(0, 160) }; }
  };
  out['/naturezas-operacoes'] = await tentar('/naturezas-operacoes?limite=100');
  await sleep(350);
  out['/depositos (campos crus)'] = await tentar('/depositos?limite=3');
  await sleep(350);
  out['/empresas'] = await tentar('/empresas');
  res.json({
    ok: true,
    procurando: 'idEmpresaControl e idNaturezaOperacao ("Devolucao de Mercadoria - Entrada") desta empresa',
    // b546 (Codex #449): cada empresa informa os SEUS ids; sem isso, o padrao historico (AMBTotal)
    hoje_no_codigo: deps.idsFiscaisHoje || { idEmpresaControl: '14901993834', idNaturezaOperacao: '15110128838' },
    resultado: out,
  });
});

// GET /api/debug/resgate-nf/:orderId
// Roda o MESMO fluxo do resgate mas NAO grava nada - mostra cada
// passo (ML invoice, pack, blindada com trace) pra diagnostico.
// ============================================================
app.get('/api/debug/resgate-nf/:orderId', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  const orderIdParam = String(req.params.orderId || '').trim();
  const saida = { orderId: orderIdParam };
  try {
    // Registro no Supabase (se existir)
    let reg = null;
    if (supabase) {
      const { data } = await supabase
        .from(TAB)
        .select('id, order_id, pack_id, nf_numero, nf_id_bling, created_at')
        .eq('order_id', orderIdParam)
        .order('created_at', { ascending: false })
        .limit(1);
      reg = data && data[0] ? data[0] : null;
    }
    saida.registro = reg;

    // Order no ML
    let order = null;
    const rOrder = await chamarML(`https://api.mercadolibre.com/orders/${orderIdParam}`);
    if (rOrder.ok) order = rOrder.data;
    saida.order_ml = order ? {
      date_created: order.date_created,
      pack_id: order.pack_id || null,
      shipping_id: order.shipping?.id || null,
      tags: order.tags || [],
      fulfillment: (order.tags || []).some(t => String(t).includes('fulfillment')) || order.shipping?.logistic_type === 'fulfillment',
    } : { erro: rOrder.status || 'sem resposta' };

    // ML invoice_data (shipment da venda)
    const shipVenda = order?.shipping?.id || null;
    if (shipVenda) {
      const rNF = await buscarNFnoML(shipVenda);
      saida.ml_invoice_venda = {
        shipment: shipVenda, ok: rNF.ok, status: rNF.status,
        invoice_number: rNF.data?.invoice_number || null,
        invoice_serie: rNF.data?.invoice_serie || null,
        tem_fiscal_key: !!rNF.data?.fiscal_key,
      };
    } else saida.ml_invoice_venda = { erro: 'order sem shipping.id' };

    // ML invoice_data (shipment do PACK)
    const packId = reg?.pack_id || order?.pack_id || null;
    if (packId) {
      const rPack = await chamarML(`https://api.mercadolibre.com/packs/${packId}`);
      const shipPack = rPack.ok ? rPack.data?.shipment?.id : null;
      if (shipPack && String(shipPack) !== String(shipVenda || '')) {
        const rNF2 = await buscarNFnoML(shipPack);
        saida.ml_invoice_pack = {
          shipment: shipPack, ok: rNF2.ok, status: rNF2.status,
          invoice_number: rNF2.data?.invoice_number || null,
          tem_fiscal_key: !!rNF2.data?.fiscal_key,
        };
      } else saida.ml_invoice_pack = { shipment: shipPack, igual_ao_da_venda: true };
    }

    // Blindada (dry-run)
    const rBlind = await buscarNFBlindada({
      orderIds: [orderIdParam, packId],
      numeroNF: saida.ml_invoice_venda?.invoice_number || null,
      serieNF: saida.ml_invoice_venda?.invoice_serie || null,
      dataReferencia: order?.date_created || reg?.created_at || null,
    });
    saida.blindada = {
      ok: rBlind.ok,
      via: rBlind.via || null,
      nf_numero: rBlind.nf?.numero || null,
      nf_serie: rBlind.nf?.serie || null,
      nf_id_bling: rBlind.idNF || null,
      numeroPedidoLoja_na_nf: rBlind.nf?.numeroPedidoLoja || null,
      tentado: rBlind.tentado || null,
      trace: rBlind.trace || null,
    };

    return res.json(saida);
  } catch (e) {
    saida.erro = e.message || String(e);
    return res.status(500).json(saida);
  }
});

// ============================================================
// v3.19 - RESGATE DE NF pra registros gravados sem NF ("NF: -")
// ============================================================
// Fluxo: le o registro -> busca a order no ML (data + shipment da
// venda) -> tenta invoice_data do ML -> se falhar, busca BLINDADA
// no Bling (janela de datas) -> grava nf_* no registro.
app.post('/api/admin/buscar-nf/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  const devId = req.params.id;

  try {
    const { data: reg, error: errReg } = await supabase
      .from(TAB)
      .select('*')
      .eq('id', devId)
      .single();
    if (errReg || !reg) {
      return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    }
    if (reg.nf_numero) {
      return res.json({ ok: true, ja_tinha: true, nf_numero: reg.nf_numero });
    }
    if (!reg.order_id) {
      return res.status(400).json({ ok: false, erro: 'Registro sem order_id - nao da pra localizar a NF automaticamente' });
    }

    // 1) Order no ML: da a data da venda e o shipment ORIGINAL
    let order = null;
    const rOrder = await chamarML(`https://api.mercadolibre.com/orders/${reg.order_id}`);
    if (rOrder.ok) order = rOrder.data;

    // 2) Tenta invoice_data do ML (rapido, ja traz chave/serie)
    let nfInfo = null; // { numero, serie, chave, valor, dataEmissao, idBling, linkDanfe }
    let via = null;

    async function tentarInvoiceML(sid) {
      if (!sid) return false;
      const rNFML = await buscarNFnoML(sid);
      if (rNFML.ok && rNFML.data?.fiscal_key) {
        nfInfo = {
          numero: String(rNFML.data.invoice_number || ''),
          serie: rNFML.data.invoice_serie != null ? String(rNFML.data.invoice_serie) : null,
          chave: rNFML.data.fiscal_key,
          valor: rNFML.data.invoice_amount || null,
          dataEmissao: rNFML.data.invoice_date || null,
          idBling: null,
          linkDanfe: `https://meudanfe.com.br/consulta/${rNFML.data.fiscal_key}`,
        };
        via = 'ml_invoice';
        return true;
      }
      return false;
    }

    const shipVenda = order?.shipping?.id || null;
    let achouML = await tentarInvoiceML(shipVenda);

    // v3.19.1: venda de CARRINHO - a NF pode estar no shipment do PACK
    if (!achouML) {
      const packId = reg.pack_id || order?.pack_id || null;
      if (packId) {
        const rPack = await chamarML(`https://api.mercadolibre.com/packs/${packId}`);
        const shipPack = rPack.ok ? rPack.data?.shipment?.id : null;
        if (shipPack && String(shipPack) !== String(shipVenda || '')) {
          achouML = await tentarInvoiceML(shipPack);
          if (achouML) via = 'ml_invoice_pack';
        }
      }
    }

    // 3) BLINDADA no Bling (janela de datas da venda) - acha o id Bling
    //    Roda mesmo se o ML deu a NF, pra vincular o nf_id_bling (necessario
    //    pro botao Gerar NF Devolucao usar o caminho rapido).
    const dataRef = order?.date_created || reg.created_at || null;
    const rBlind = await buscarNFBlindada({
      orderIds: [reg.order_id, reg.pack_id || order?.pack_id || null],
      numeroNF: nfInfo?.numero || null,
      serieNF: nfInfo?.serie || null,
      dataReferencia: dataRef,
    });
    if (rBlind.ok && rBlind.nf) {
      const nf = rBlind.nf;
      nfInfo = {
        numero: String(nf.numero || nfInfo?.numero || ''),
        serie: nf.serie != null ? String(nf.serie) : (nfInfo?.serie || null),
        chave: nf.chaveAcesso || nfInfo?.chave || null,
        valor: nf.valorNota || nfInfo?.valor || null,
        dataEmissao: nf.dataEmissao || nfInfo?.dataEmissao || null,
        idBling: nf.id ? String(nf.id) : null,
        linkDanfe: nf.linkDanfe || nfInfo?.linkDanfe || (nf.chaveAcesso ? `https://meudanfe.com.br/consulta/${nf.chaveAcesso}` : null),
      };
      via = via ? via + '+' + rBlind.via : rBlind.via;
    }

    if (!nfInfo || !nfInfo.numero) {
      const detalhe = (rBlind.tentado || []).join(' | ') || 'sem detalhes';
      return res.status(404).json({
        ok: false,
        erro: 'NF nao localizada no ML nem no Bling. Tentado: ' + detalhe,
        tentado: rBlind.tentado || [],
      });
    }

    // 4) Grava no registro
    const nfItensResgate = (rBlind.ok && rBlind.nf) ? mapItensNF(rBlind.nf) : null;
    const { error: errUpd } = await supabase
      .from(TAB)
      .update({
        nf_numero: nfInfo.numero,
        nf_serie: nfInfo.serie,
        nf_chave: nfInfo.chave,
        nf_valor: nfInfo.valor,
        nf_data_emissao: nfInfo.dataEmissao,
        nf_id_bling: nfInfo.idBling,
        nf_link_danfe: nfInfo.linkDanfe,
        nf_itens: nfItensResgate,
      })
      .eq('id', devId);
    if (errUpd) {
      return res.status(500).json({ ok: false, erro: 'Achei a NF mas falhou ao gravar: ' + errUpd.message });
    }

    console.log(`[RESGATE-NF] ${devId}: NF ${nfInfo.numero}${nfInfo.serie ? '/s' + nfInfo.serie : ''} via ${via}`);
    return res.json({ ok: true, via, nf_numero: nfInfo.numero, nf_serie: nfInfo.serie, nf_id_bling: nfInfo.idBling });
  } catch (e) {
    console.error('[RESGATE-NF] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// Usado quando a devolucao tem nf_numero mas NAO tem nf_id_bling salvo.
// O botao "Gerar NF Devolucao" chama isto pra descobrir o ID interno
// que o endpoint obter-dados-devolucao precisa.
app.get('/api/admin/resolver-id-nf', requerAdmin, async (req, res) => {
  const numero = String(req.query.numero || '').trim();
  const idParam = String(req.query.id || '').trim();
  const chave = String(req.query.chave || '').replace(/\D/g, '');
  const data = req.query.data || null;
  if (!numero && !idParam) {
    return res.status(400).json({ ok: false, erro: 'numero ou id da NF obrigatorio' });
  }

  try {
    let idBling = idParam;
    let numeroNF = numero;
    let idLoja = null;

    // v3.31.1 - FASE JANELA: a chave de acesso diz o MES de emissao;
    // o helper faz busca binaria pelo DIA (rapida em qualquer volume)
    // com plano B varrendo o mes inteiro.
    if (!idBling && chave.length === 44 && numero) {
      const achado = await resolverIdNFPorChave(numero, chave);
      if (achado) {
        idBling = achado;
        console.log(`[resolver-id-nf] achou pela chave: id=${idBling}`);
      }
    }

    // Se nao veio o id interno, descobre pelo numero (varre /nfe)
    if (!idBling) {
      const r = await buscarNFnoBlingPorNumero(numero, data, { maxPaginas: 50 });
      if (!r.ok) {
        return res.status(502).json({ ok: false, erro: 'Erro ao consultar o Bling ao buscar a NF' });
      }
      if (!r.match) {
        return res.status(404).json({
          ok: false,
          erro: `NF ${numero} nao encontrada nas ultimas ${r.totalScanned || 0} NFs do Bling`,
        });
      }
      idBling = String(r.match.id);
      numeroNF = r.match.numero;
      if (r.match.loja && r.match.loja.id != null) idLoja = String(r.match.loja.id);
    }

    // Garante o idLoja: busca a NF individual (GET /nfe/{id}), que traz "loja".
    // Esse idLoja e o ULTIMO segmento do obter-dados-devolucao - a extensao precisa dele.
    if (!idLoja && idBling) {
      const rNF = await buscarNFePorId(idBling);
      const nf = rNF.ok ? rNF.data?.data : null;
      if (nf) {
        if (nf.loja && nf.loja.id != null) idLoja = String(nf.loja.id);
        if (!numeroNF && nf.numero) numeroNF = nf.numero;
      }
    }

    return res.json({
      ok: true,
      idBling: String(idBling),
      numero: numeroNF || null,
      idLoja: idLoja || null,
    });
  } catch (e) {
    console.error('[resolver-id-nf] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.15.0 (Fase 3B) - Preparar dados pra gerar NF Devolucao no Bling
// ============================================================
// Frontend (admin.html) chama esse endpoint pra obter os dados completos
// (produtos com idBling + contato com idMunicipio etc) que sao necessarios
// pra montar o XML xajax do salvarNotaDevolucao.
// Usa a API v3 oficial do Bling (escopo NF Leitura ja tem).
app.get('/api/admin/preparar-devolucao/:idBling', requerAdmin, async (req, res) => {
  const idBling = String(req.params.idBling || '').trim();
  if (!idBling || !/^\d+$/.test(idBling)) {
    return res.status(400).json({ ok: false, erro: 'idBling invalido' });
  }

  try {
    // Busca a NF completa via API v3 oficial
    const url = `https://api.bling.com.br/Api/v3/nfe/${idBling}`;
    const r = await chamarBling(url);

    if (!r.ok) {
      return res.status(r.status || 500).json({
        ok: false,
        erro: `Bling API v3 retornou ${r.status || 'erro'}: ${(r.error?.error?.description || JSON.stringify(r.error || {})).slice(0, 200)}`,
      });
    }

    const nf = r.data?.data;
    if (!nf) {
      return res.status(404).json({ ok: false, erro: 'NF nao encontrada no Bling' });
    }

    // Extrai itens. API v3 NF nao retorna idProduto direto.
    // Buscamos cada produto pelo SKU pra pegar o idBling (necessario pro XML xajax).
    const itensNF = Array.isArray(nf.itens) ? nf.itens : [];
    if (itensNF.length === 0) {
      return res.status(400).json({ ok: false, erro: 'NF sem itens' });
    }

    const produtos = [];
    for (const it of itensNF) {
      const sku = it.codigo;
      if (!sku) {
        return res.status(400).json({ ok: false, erro: `Item da NF sem SKU: ${JSON.stringify(it).slice(0, 200)}` });
      }
      const rProd = await buscarProdutoBlingPorSku(sku);
      if (!rProd.ok || !rProd.produto) {
        return res.status(400).json({ ok: false, erro: `Produto nao encontrado no Bling para SKU ${sku}` });
      }
      produtos.push({
        idBling: String(rProd.produto.id),
        sku,
        descricao: it.descricao,
        quantidade: Number(it.quantidade) || 1,
        valor: Number(it.valor) || 0,
      });
    }

    // Extrai contato (vem completo na NF v3)
    const contato = nf.contato || {};
    const endereco = contato.endereco || {};

    // BUG 1 FIX: Detecta tipo F/J pelo numero de digitos do CPF/CNPJ
    // (a API v3 nem sempre retorna tipoPessoa direito)
    const docDigitos = String(contato.numeroDocumento || '').replace(/\D/g, '');
    const tipoDetectado = detectarTipoPessoa(docDigitos);
    const tipoFinal = tipoDetectado || (contato.tipoPessoa === 'J' ? 'J' : 'F');

    // BUG 1 FIX: Formata CPF/CNPJ no padrao Bling
    const cnpjFormatado = formatarCpfCnpj(docDigitos);

    // BUG 2 FIX: Se idMunicipio nao veio, busca via IBGE pelo nome+UF
    // Fallback: se IBGE falhar, busca pelo CEP (BrasilAPI)
    let idMunicipioFinal = String(endereco.codigoMunicipio || '').trim();
    if (!idMunicipioFinal && endereco.municipio && endereco.uf) {
      console.log('[preparar-devolucao] Buscando idMunicipio via IBGE:', endereco.municipio, endereco.uf);
      idMunicipioFinal = (await buscarIdMunicipioIBGE(endereco.municipio, endereco.uf)) || '';
    }
    if (!idMunicipioFinal && endereco.cep) {
      console.log('[preparar-devolucao] Fallback - Buscando idMunicipio pelo CEP:', endereco.cep);
      idMunicipioFinal = (await buscarIdMunicipioPorCep(endereco.cep)) || '';
    }

    const contatoOut = {
      id: String(contato.id || ''),
      nome: contato.nome || '',
      tipo: tipoFinal,
      cnpj: cnpjFormatado,
      ie: contato.ie || '',
      indIEDest: String(contato.indicadorIE || '9'),
      rg: contato.rg || '',
      nomePais: '',
      idPais: '',
      cep: endereco.cep || '',
      cidade: endereco.municipio || '',
      idMunicipio: idMunicipioFinal,
      uf: endereco.uf || '',
      endereco: endereco.endereco || '',
      enderecoNro: endereco.numero || '',
      bairro: endereco.bairro || '',
      complemento: endereco.complemento || '',
      email: contato.email || '',
      fone: contato.telefone || '',
      celular: '',
      dataNascimento: '',
    };

    if (!contatoOut.id) {
      return res.status(400).json({ ok: false, erro: 'NF sem ID de contato' });
    }
    if (!contatoOut.idMunicipio) {
      console.warn('[preparar-devolucao] AVISO: contato sem idMunicipio - Bling pode rejeitar');
    }

    return res.json({
      ok: true,
      idNFOriginal: idBling,
      numeroNF: nf.numero,
      produtos,
      contato: contatoOut,
    });

  } catch (e) {
    console.error('[preparar-devolucao] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// v3.15.0: Registra no Supabase que a NF de devolucao foi gerada
// pra evitar duplicatas e mostrar link direto no admin
app.put('/api/admin/registrar-devolucao-gerada/:id', requerAdmin, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }

  const id = String(req.params.id || '').trim();
  const { nf_devolucao_id_bling, nf_devolucao_numero } = req.body || {};

  if (!id) return res.status(400).json({ ok: false, erro: 'id obrigatorio' });
  if (!nf_devolucao_id_bling) return res.status(400).json({ ok: false, erro: 'nf_devolucao_id_bling obrigatorio' });

  try {
    const { error } = await supabase
      .from(TAB)
      .update({
        nf_devolucao_id_bling: String(nf_devolucao_id_bling),
        nf_devolucao_numero: String(nf_devolucao_numero || ''),
        nf_devolucao_gerada_em: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      return res.status(500).json({ ok: false, erro: error.message });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
});

// API: marcar como concluido
app.put('/api/admin/concluir/:id', requerAdmin, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  try {
    const { error } = await supabase
      .from(TAB)
      .update({
        status: 'concluido',
        data_concluido: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    if (error) {
      return res.status(500).json({ ok: false, erro: error.message });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// API: deletar (caso tenha sido criado por engano)
app.delete('/api/admin/devolucao/:id', requerAdmin, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  try {
    const { error } = await supabase
      .from(TAB)
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ ok: false, erro: error.message });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});


  /* b496 - pedido do dono (02/10): "automatiza esse passo, pra eu nao ter que clicar em Achar NF
     no Bling — apos ser triada ja faca essa consulta". O servidor procura sozinho a NF de
     devolucao do marketplace (serie != 1) dos cards do FULL que ainda nao tem a NF ligada —
     logo depois da triagem (varredura a cada 5 min) e de novo mais tarde, se a NF ainda nao
     chegou no Bling (a Toolbox importa depois). Usa a MESMA rota do botao (mesma prova, mesmo
     "nao sei != nao existe"), achada na pilha do roteador — nada duplicado. Cota: no maximo
     3 cards por volta, um de cada vez, e cada card espera 30 min apos nao achar (6 h depois da
     3a vez) — o 503 "busca incompleta" volta a tentar na proxima volta. */
  const _fullTentativas = new Map();   // id -> { prox: ts, falhas }
  let _fullVarrendo = false;
  function _handlerAchar() {
    const pilha = (app && (app.stack || (app._router && app._router.stack))) || [];
    const camada = pilha.find((l) => l.route && l.route.path === '/api/admin/full-vincular/:id' && l.route.methods && l.route.methods.post);
    return camada ? camada.route.stack[camada.route.stack.length - 1].handle : null;
  }
  async function _varrerFullSemNF() {
    if (_fullVarrendo || !supabase) return;
    _fullVarrendo = true;
    try {
      const handler = _handlerAchar();
      if (!handler) return;
      const desde = new Date(Date.now() - 60 * 864e5).toISOString();
      /* Codex #410: (P1) a coluna de data e 'criado_em' nesta tabela (AMB/empresas novas: criado_em; GOOD:
         created_at); (P1) o RESULTADO da triagem fica em 'tipo' na GOOD (status = 'pendente') — o
         filtro olha os dois em JS, sem supor coluna; (P2) a serie e filtrada ANTES do corte, com
         folga de 500 linhas, pra card do FULL nao ficar atras de serie 1 recente. */
      const { data, error } = await supabase.from(TAB).select('*')
        .is('nf_devolucao_id_bling', null).gte(COL_CRIADO, desde).order(COL_CRIADO, { ascending: false }).limit(500);
      if (error || !Array.isArray(data)) return;
      const serie = (d) => { const s = String(d.nf_serie || '').trim().replace(/^0+/, ''); if (s) return s; const ch = String(d.nf_chave || '').replace(/\D/g, ''); return ch.length === 44 ? ch.substr(22, 3).replace(/^0+/, '') : ''; };
      const RESULTADOS = ['aprovado', 'problema', 'divergente'];
      const aberto = (d) => !d.concluido_em && String(d.status || '').toLowerCase() !== 'concluido' &&
        (RESULTADOS.indexOf(String(d.tipo || '').toLowerCase()) > -1 || RESULTADOS.indexOf(String(d.status || '').toLowerCase()) > -1);
      const agora = Date.now();
      const fila = data.filter((d) => { const s = serie(d); return s && s !== '1' && aberto(d); })
        .filter((d) => { const t = _fullTentativas.get(String(d.id)); return !t || (!t.desistiu && t.prox <= agora); }).slice(0, 3);
      for (const d of fila) {
        const out = await new Promise((resolve) => {
          const res = { _s: 200, status(s) { this._s = s; return this; }, json(o) { resolve({ status: this._s, corpo: o }); } };
          // Codex #410 (P1): varredura automatica = trafego de FUNDO (nao disputa com a bipagem)
          Promise.resolve(handler({ params: { id: String(d.id) }, body: {}, _fundo: true }, res)).catch((e) => resolve({ status: 500, corpo: { ok: false, erro: String(e && e.message || e) } }));
        });
        const id = String(d.id);
        if (out.corpo && out.corpo.ok) { _fullTentativas.delete(id); console.log('[FULL-AUTO] ' + id + ': devolucao ligada sozinha (NF ' + (out.corpo.nf_devolucao_numero || '?') + ')'); }
        else {
          /* pergunta do dono (02/10): "se nao acha, fica retestando infinito?" — NAO: cada falha
             (inclusive busca incompleta) afasta a proxima tentativa (5 min, 30 min, 6 h) e depois de
             8 tentativas o automatico DESISTE do card (o botao Achar continua la). */
          const ant = _fullTentativas.get(id) || { falhas: 0 };
          const f = ant.falhas + 1;
          const espera = out.status === 503 && f <= 2 ? 5 * 60e3 : (f >= 3 ? 6 * 3600e3 : 30 * 60e3);
          _fullTentativas.set(id, { prox: Date.now() + espera, falhas: f, desistiu: f >= 8 });
          if (f >= 8) console.log('[FULL-AUTO] ' + id + ': 8 tentativas sem achar — o automatico desistiu (use o Achar no card)');
        }
        await sleep(2000);
      }
    } catch (e) { console.warn('[FULL-AUTO] varredura falhou:', e.message || e); }
    finally { _fullVarrendo = false; }
  }
  deps.varrerFullSemNF = _varrerFullSemNF;   // teste (e quem quiser disparar na mao)
  if (process.env.FULL_ACHAR_AUTO !== 'off' && !process.env.NODE_TEST_SEM_TIMERS) {
    const t0 = setTimeout(() => { _varrerFullSemNF(); const t1 = setInterval(_varrerFullSemNF, 5 * 60 * 1000); if (t1.unref) t1.unref(); }, 3 * 60 * 1000);
    if (t0.unref) t0.unref();
  }
};
