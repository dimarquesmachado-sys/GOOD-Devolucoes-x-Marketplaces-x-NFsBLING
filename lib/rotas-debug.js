// ═══════════════════════════════════════════════════════════════════
// ROTAS DE DIAGNOSTICO (b298)
//
// Primeira fatia da quebra do `server.js`, que estava com 5.369 linhas e 81
// rotas. Comecei pelas de DEBUG de proposito: elas nao participam de nenhuma
// operacao do galpao — se algo aqui quebrar, nada que o pessoal usa para.
//
// Sao as rotas contiguas do fim do arquivo. As outras de debug estao
// espalhadas pelo meio e vao em fatias seguintes, uma por vez: mover tudo de
// uma vez daria um diff enorme e sem revisao possivel.
//
// NADA aqui foi reescrito — o codigo e o mesmo, so mudou de arquivo. As
// dependencias que ele usava do escopo do server chegam agora por parametro.
// ═══════════════════════════════════════════════════════════════════

// b334 - ponte TikTok via Mover-Pedidos. Require direto (e nao via `deps`)
// de proposito: o modulo e autonomo — so usa env + axios, nada do escopo do
// server, entao injetar seria cerimonia sem funcao.
const tiktokPonte = require('./tiktok-ponte');

module.exports = function registrarRotasDebug(app, deps) {
  const {
    requerAdmin, espreita, shopee, magalu, mlReturns,
    chamarBling, chamarML, sleep,
    // b299 (fatia 2) - o que os blocos novos usavam do escopo do server
    adminOk, buscarNFnoML, buscarPedidoBlingPorNumeroLoja,
    buscarPedidoBlingPorId, buscarNFePorId,
    // b300 (review do Codex) - faltavam estas DUAS, e eu tinha ate escrito no
    // PR que era justo isso que o boot nao pegaria: `bling-busca-nf/:orderId`
    // lancaria ReferenceError, e `dados-devolucao-numero/:numero` engoliria o
    // mesmo erro no catch e responderia uma falha ENGANOSA.
    buscarNFnoBlingPorOrderId, buscarNFnoBlingPorNumero,
    // b300 - e esta faltava desde a FATIA 1 (#61), que ja esta em producao:
    // a rota que a usa quebraria do mesmo jeito. Achei varrendo TODAS as
    // funcoes chamadas no modulo contra as injetadas, em vez de conferir
    // so as que o review apontou.
    buscarNFsPorNumero,
    // b301 (fatia 3) - familia Magalu/ML
    supabase,
    // b302 (fatia 4) - a VARREDURA achou estas tres antes do PR, que e
    // exatamente o que a fatia 2 me ensinou a fazer: `produtos-indice` e
    // `bling-ean` chamam o indice de produtos do server.
    construirIndiceProdutos, enriquecerEansEmBackground, normProd,
    // b302 - e este MIDDLEWARE, que a minha varredura NAO pegava: ela so
    // olhava chamadas `nome(`, e middleware entra como ARGUMENTO do app.get.
    // Sem ele o modulo nem carrega — o boot real e que pegou.
    requerEstoquista,
    // b302 - e estes DOIS objetos, que a varredura so pegou na 3a versao:
    // ela ignorava `objeto.metodo(` de proposito, achando que era metodo de
    // algo ja injetado. `mlClient.chamarML` e `nfNomes.*` sao raizes do
    // escopo do server, nao membros — e sem elas a rota estoura em tempo de
    // execucao, DEPOIS de o boot ter passado.
    mlClient, nfNomes,
    // b302 - e estes TRES objetos de ESTADO do server, que nenhuma das minhas
    // varreduras pegou: `ESP_ENTREGA` (Map de espreita de entrega),
    // `IDX_PROD` (indice de produtos) e `EAN_POR_SKU` (cache de EANs). Sao
    // MAIUSCULAS, e eu vinha excluindo maiusculas achando que era classe.
    // Como sao objetos vivos compartilhados, passam por REFERENCIA: o modulo
    // le o mesmo estado que o server mantem, nao uma copia.
    ESP_ENTREGA, IDX_PROD, EAN_POR_SKU, EAN_PROGRESSO,
    // v4.63 - a captura das devolucoes: o modulo e a funcao que conta o
    // ultimo ciclo. Passar por parametro (e nao usar o escopo do server) e o
    // que ja derrubou o boot duas vezes neste arquivo — b300 e b302.
    devCapturadas, capturaEstado,
    tiktokRevelia,   // v4.68 - quem esta na janela de revelia
    forcarCaptura,   // v4.70 - rodar a captura sem esperar o ciclo
    // b302 - flags de "esta rodando?" desses mesmos indices. Achei-as com a
    // verificacao que eu devia ter feito desde o inicio: comparar TODOS os
    // identificadores de topo do server.js contra os usados no modulo, em vez
    // de heuristica de "parece funcao".

  } = deps || {};

  app.get('/api/debug/espreita-indice', requerAdmin, async (req, res) => {
    if (req.query.rebuild === '1') {
      try { await espreita.construirIndice(); } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
    }
    return res.json({ ok: true, ...espreita.resumo() });
  });

  // v3.75 - TESTE DO BFF de devolucoes do portal Magalu Entregas: sera que o
  // NOSSO token OAuth (escopo logistic-seller-shippings ja concedido) e aceito
  // pela API interna do portal (seller-devolution-bff.mglu.io)?
  // Endpoints vistos no DevTools: /v1/fulfillment/{tenant}?limit&offset (lista),
  // /v1/fulfillment/totalizers/{tenant}. Abas Correios/Agencias por analogia.
  // Uso: /api/debug/magalu-bff?path=/v1/fulfillment/goodimport-magazine%3Flimit=5
  app.get('/api/debug/magalu-bff', requerAdmin, async (req, res) => {
    if (!magalu.cfg.autorizado) return res.status(400).json({ ok: false, erro: 'Magalu nao autorizada' });
    const p = String(req.query.path || '').trim();
    if (!p.startsWith('/')) return res.status(400).json({ ok: false, erro: 'informe ?path=/v1/...' });
    const tenant = String(req.query.tenant || 'goodimport-magazine').trim();
    const r = await magalu.chamarMagalu(`https://seller-devolution-bff.mglu.io${p}`, {
      headers: { 'x-tenant-id': tenant, Origin: 'https://seller.magaluentregas.com.br', Referer: 'https://seller.magaluentregas.com.br/' },
    });
    return res.status(200).json({ ok: r.ok, status: r.status, data: r.data });
  });

  // Indice de NFs por nome (?rebuild=1 | ?q=nome testa a busca)
  app.get('/api/debug/nf-nomes-indice', requerAdmin, async (req, res) => {
    if (req.query.rebuild === '1') {
      try { await nfNomes.construirIndice(); } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
    }
    const out = { ok: true, ...nfNomes.statusIndice() };
    if (req.query.q) out.busca = await nfNomes.buscarPorNome(String(req.query.q));
    return res.json(out);
  });

  // Indice de devolucoes ML por rastreio Correios (?rebuild=1 reconstroi)
  app.get('/api/debug/ml-returns-indice', requerAdmin, async (req, res) => {
    if (req.query.rebuild === '1') {
      try { await mlReturns.construirIndice(); } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
    }
    return res.json({ ok: true, ...mlReturns.statusIndice() });
  });

  // Exploracao crua: returns de um claim especifico (validar campos reais)
  app.get('/api/debug/ml-returns', requerAdmin, async (req, res) => {
    const claim = String(req.query.claim || '').trim();
    if (!claim) return res.status(400).json({ ok: false, erro: 'informe ?claim=ID' });
    const r = await chamarML(`https://api.mercadolibre.com/post-purchase/v2/claims/${encodeURIComponent(claim)}/returns`);
    return res.status(r.ok ? 200 : (r.status || 502)).json({ ok: r.ok, status: r.status, data: r.ok ? r.data : r.error });
  });

  // Status do indice de devolucoes Magalu (?rebuild=1 reconstroi na hora)
  app.get('/api/debug/magalu-indice', requerAdmin, async (req, res) => {
    if (!magalu.cfg.autorizado) return res.status(400).json({ ok: false, erro: 'Magalu nao autorizada' });
    if (req.query.rebuild === '1') {
      try { await magalu.construirIndiceDevolucoes(); } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
    }
    return res.json({ ok: true, ...magalu.statusIndice() });
  });

  // EXPLORACAO 3: rota livre (pra tatear qualquer endpoint sem novo deploy)
  app.get('/api/debug/magalu-get', requerAdmin, async (req, res) => {
    const p = String(req.query.path || '').trim();
    if (!p.startsWith('/')) return res.status(400).json({ ok: false, erro: 'informe ?path=/seller/v0/...' });
    const r = await magalu.chamarMagalu(p);
    return res.status(r.ok ? 200 : (r.status || 502)).json({ ok: r.ok, status: r.status, data: r.data });
  });

  // v3.54 - TESTE DO FILTRO DE DATA: descobrir por que 1 dia retorna vazio.
  // Hipotese: o Bling trata as datas como datetime (00:00), entao
  // inicial==final vira um intervalo vazio. Prova comparando variantes.
  app.get('/api/debug/nf-filtro', requerAdmin, async (req, res) => {
    const dia = String(req.query.dia || '2026-06-20').trim();
    const d = new Date(dia + 'T00:00:00Z');
    const mais = (n) => new Date(d.getTime() + n * 864e5).toISOString().slice(0, 10);
    const variantes = [
      { nome: 'A) mesmo dia (o que eu usava)', ini: dia, fim: dia },
      { nome: 'B) dia ate dia+1', ini: dia, fim: mais(1) },
      { nome: 'C) dia-1 ate dia+1', ini: mais(-1), fim: mais(1) },
      { nome: 'D) janela de 7 dias', ini: mais(-3), fim: mais(3) },
      { nome: 'E) sem filtro de data', ini: null, fim: null },
    ];
    const out = [];
    for (const v of variantes) {
      await sleep(400);
      let url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=1&tipo=1`;
      if (v.ini) url += `&dataEmissaoInicial=${v.ini}&dataEmissaoFinal=${v.fim}`;
      const r = await chamarBling(url);
      const lista = (r.ok && r.data?.data) ? r.data.data : [];
      out.push({
        variante: v.nome,
        intervalo: v.ini ? `${v.ini} .. ${v.fim}` : '(nenhum)',
        status: r.status || null,
        qtd: lista.length,
        // amostra: primeiro e ultimo, pra ver a ORDEM e as datas reais
        primeira: lista[0] ? { numero: lista[0].numero, serie: lista[0].serie, data: lista[0].dataEmissao } : null,
        ultima: lista.length > 1 ? { numero: lista[lista.length - 1].numero, serie: lista[lista.length - 1].serie, data: lista[lista.length - 1].dataEmissao } : null,
        tem_a_75053: lista.some(nf => String(nf.numero || '').replace(/^0+/, '') === '75053') || undefined,
      });
    }
    return res.json({ ok: true, dia_testado: dia, variantes: out });
  });

  // v3.53 - RAIO-X da busca por numero da NF (mostra cada passo)
  app.get('/api/debug/nf-numero', requerAdmin, async (req, res) => {
    const n = String(req.query.n || '').trim();
    if (!n) return res.status(400).json({ ok: false, erro: 'informe ?n=75053' });
    const serie = req.query.serie ? String(req.query.serie) : null;
    const trace = [];
    let achadas = [];
    let erro = null;
    try {
      achadas = await buscarNFsPorNumero(n, serie, { trace });
    } catch (e) { erro = e.message || String(e); }
    return res.json({ ok: true, alvo: n, serie_pedida: serie, achadas, erro, trace });
  });

  // v3.53 - o Bling devolve MESMO as NFs de um dia? (checa a suposicao base)
  app.get('/api/debug/nf-dia', requerAdmin, async (req, res) => {
    const dia = String(req.query.dia || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return res.status(400).json({ ok: false, erro: 'informe ?dia=2026-06-20' });
    const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=1&tipo=1&dataEmissaoInicial=${dia}&dataEmissaoFinal=${dia}`;
    const r = await chamarBling(url);
    const lista = (r.ok && r.data?.data) ? r.data.data : [];
    return res.json({
      ok: r.ok,
      status: r.status || null,
      url_chamada: url,
      qtd: lista.length,
      // so o essencial de cada NF: e aqui que vejo se numero/serie vem mesmo
      nfs: lista.slice(0, 100).map(nf => ({ id: nf.id, numero: nf.numero, serie: nf.serie, dataEmissao: nf.dataEmissao })),
      resposta_crua_se_vazio: lista.length === 0 ? r.data : undefined,
    });
  });

  app.get('/api/debug/shopee-indice-status', requerAdmin, async (req, res) => {
    try {
      if (!shopee.cfg.ativo) return res.status(400).json({ ok: false, erro: 'Shopee proxy sem envs' });
      const extra = (req.query.rebuild === '1' ? '?rebuild=1' : (req.query.amostra === '1' ? '?amostra=1' : ''));
      const url = `${shopee.cfg.url}/${shopee.cfg.loja}/interno/indice-status${extra}`;
      const r = await fetch(url, { headers: { 'x-internal-key': shopee.cfg.key } });
      const d = await r.json().catch(() => null);
      return res.status(r.ok ? 200 : 502).json(d || { ok: false, erro: 'resposta invalida (HTTP ' + r.status + ')' });
    } catch (e) {
      return res.status(500).json({ ok: false, erro: e.message || String(e) });
    }
  });

  app.get('/api/debug/shopee-procurar', requerAdmin, async (req, res) => {
    try {
      if (!shopee.cfg.ativo) return res.status(400).json({ ok: false, erro: 'Shopee proxy sem envs' });
      const q = encodeURIComponent(String(req.query.q || '').trim());
      if (!q) return res.status(400).json({ ok: false, erro: 'informe ?q=CODIGO' });
      const dias = Math.min(180, parseInt(req.query.dias, 10) || 150);
      const url = `${shopee.cfg.url}/${shopee.cfg.loja}/interno/devolucoes?procurar=${q}&dias=${dias}`;
      const r = await fetch(url, { headers: { 'x-internal-key': shopee.cfg.key } });
      const d = await r.json().catch(() => null);
      return res.status(r.ok ? 200 : 502).json(d || { ok: false, erro: 'resposta invalida (HTTP ' + r.status + ')' });
    } catch (e) {
      return res.status(500).json({ ok: false, erro: e.message || String(e) });
    }
  });

  app.get('/api/debug/shopee-pedido', requerAdmin, async (req, res) => {
    try {
      if (!shopee.cfg.ativo) return res.status(400).json({ ok: false, erro: 'Shopee proxy sem envs' });
      const q = encodeURIComponent(String(req.query.q || '').trim());
      if (!q) return res.status(400).json({ ok: false, erro: 'informe ?q=ORDER_SN' });
      const bruto = req.query.bruto === '1' ? '&bruto=1' : '';
      const url = `${shopee.cfg.url}/${shopee.cfg.loja}/interno/devolucoes?pedido=${q}${bruto}`;
      const r = await fetch(url, { headers: { 'x-internal-key': shopee.cfg.key } });
      const d = await r.json().catch(() => null);
      return res.status(r.ok ? 200 : 502).json(d || { ok: false, erro: 'resposta invalida (HTTP ' + r.status + ')' });
    } catch (e) {
      return res.status(500).json({ ok: false, erro: e.message || String(e) });
    }
  });

  app.get('/api/debug/shopee-devolucoes', requerAdmin, async (req, res) => {
    try {
      if (!shopee.cfg.ativo) {
        return res.status(400).json({ ok: false, erro: 'Configure SHOPEE_PROXY_URL e SHOPEE_PROXY_KEY no Render deste servico' });
      }
      const dados = await shopee.buscarDevolucoesProxy(req.query.refresh === '1');
      return res.json({ ok: true, qtd: (dados || []).length, devolucoes: dados });
    } catch (e) {
      return res.status(500).json({ ok: false, erro: e.message || String(e) });
    }
  });

  // ============================================================

  // ── b299 (fatia 2) - consultas cruas ao ML e ao Bling ─────────────
  // Vieram de dois pontos do server.js (linhas ~1413 e ~1484). Sao janelas
  // pra ver o que o marketplace/ERP respondeu, uteis quando um pedido nao
  // casa; nenhuma delas participa de operacao.

  app.get('/api/debug/shipment/:id', async (req, res) => {
    if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
    const r = await chamarML(`https://api.mercadolibre.com/shipments/${req.params.id}`, { 'x-format-new': 'true' });
    res.status(r.ok ? 200 : r.status || 500).json(r);
  });

  app.get('/api/debug/order/:id', async (req, res) => {
    if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
    const r = await chamarML(`https://api.mercadolibre.com/orders/${req.params.id}`);
    res.status(r.ok ? 200 : r.status || 500).json(r);
  });

  app.get('/api/debug/ml-invoice/:shipmentId', async (req, res) => {
    if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
    const r = await buscarNFnoML(req.params.shipmentId);
    res.status(r.ok ? 200 : r.status || 500).json(r);
  });

  app.get('/api/debug/bling-busca/:numeroLoja', async (req, res) => {
    if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
    const dataRef = req.query.data || null;
    const r = await buscarPedidoBlingPorNumeroLoja(req.params.numeroLoja, dataRef, { maxPaginas: 50 });
    res.json(r);
  });

  app.get('/api/debug/bling-pedido/:id', async (req, res) => {
    if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
    const r = await buscarPedidoBlingPorId(req.params.id);
    res.status(r.ok ? 200 : r.status || 500).json(r);
  });

  app.get('/api/debug/bling-nfe-cru/:idNFe', async (req, res) => {
    if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
    const r = await buscarNFePorId(req.params.idNFe);
    res.status(r.ok ? 200 : r.status || 500).json(r);
  });

  // v3.4: ver primeira pagina de NFs (pra debug)
  app.get('/api/debug/bling-nfe-primeira-pagina', async (req, res) => {
    if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
    const limite = req.query.limite || 20;
    const r = await chamarBling(`https://api.bling.com.br/Api/v3/nfe?limite=${limite}&pagina=1&tipo=1`);
    if (r.ok && r.data?.data) {
      const resumo = r.data.data.map(nf => ({
        id: nf.id,
        numero: nf.numero,
        serie: nf.serie,
        numeroPedidoLoja: nf.numeroPedidoLoja,
        dataEmissao: nf.dataEmissao,
        situacao: nf.situacao,
        valorNota: nf.valorNota,
        contato: nf.contato?.nome,
      }));
      return res.json({ ok: true, total_na_pagina: r.data.data.length, primeiros: resumo });
    }
    res.status(r.ok ? 200 : r.status || 500).json(r);
  });

  // v3.4: busca NF por order_id ML (manual, pra debug)
  app.get('/api/debug/bling-busca-nf/:orderId', async (req, res) => {
    if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
    const dataRef = req.query.data || null;
    const r = await buscarNFnoBlingPorOrderId(req.params.orderId, dataRef, { maxPaginas: 50 });
    res.json(r);
  });

  // v3.19 DEBUG: testa se obter-dados-devolucao funciona na API oficial
  // (api.bling.com.br + Bearer). Decide se dá pra o BACKEND buscar os dados
  // da devolucao (com os IDs reais dos itens) em vez da extensao.
  app.get('/api/debug/dados-devolucao-numero/:numero', async (req, res) => {
    if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
    const numero = String(req.params.numero || '').trim();
    try {
      const rBusca = await buscarNFnoBlingPorNumero(numero, null, { maxPaginas: 50 });
      if (!rBusca.ok || !rBusca.match) {
        return res.json({ ok: false, etapa: 'buscar-numero', achou_nf: false });
      }
      const idNF = rBusca.match.id;

      // Descobre o idLoja pela API v3 (a NF individual traz "loja").
      // Esse e o valor que vai no ULTIMO segmento do obter-dados-devolucao.
      const rNFind = await buscarNFePorId(idNF);
      const lojaId = rNFind.ok ? (rNFind.data?.data?.loja?.id ?? null) : null;

      // Testa o obter-dados-devolucao via API oficial (Bearer) COM o idLoja real.
      // Esperado: 403 - esse endpoint e INTERNO (so cookie/sessao no www), nao e
      // exposto a apps de API. Serve so pra confirmar (a extensao e quem chama de verdade).
      const seg = lojaId != null ? String(lojaId) : '0';
      const url = `https://api.bling.com.br/Api/v3/nfe/${idNF}/obter-dados-devolucao/${seg}`;
      const r = await chamarBling(url);
      return res.json({
        ok: r.ok,
        status: r.status,
        idNF: String(idNF),
        idLoja_apiV3: lojaId != null ? String(lojaId) : null,
        url_testada: url,
        tem_data: !!r.data?.data,
        tem_itens: !!(r.data?.data?.itens),
        qtd_itens: r.data?.data?.itens ? Object.keys(r.data.data.itens).length : 0,
        ids_itens: r.data?.data?.itens ? Object.keys(r.data.data.itens) : [],
        dadosNota_id: r.data?.data?.dadosNota?.id || null,
        idDeposito: r.data?.data?.dadosNota?.idDeposito || null,
        devolucaoExistente: r.data?.data?.devolucaoExistente,
        error: r.error || null,
      });
    } catch (e) {
      return res.json({ ok: false, erro: e.message });
    }
  });

  // ============================================================
  // CALLBACKS OAuth
  // ============================================================

  // ── b301 (fatia 3) - diagnostico do Magalu e do ML ────────────────
  // Sete rotas que ficavam no meio do server.js (linhas ~2558-2760). Sao
  // sondas do portal do Magalu (status da autorizacao, tickets, remessas
  // reversas, cacada de pedido, links, SAC) e um GET cru no ML.

  app.get('/api/debug/magalu-status', requerAdmin, (req, res) => {
    return res.json({
      ok: true,
      configurado: magalu.cfg.ativo,
      autorizado: magalu.cfg.autorizado,
      client_id: magalu.cfg.clientId ? magalu.cfg.clientId.slice(0, 8) + '...' : null,
      redirect_uri: magalu.cfg.redirectUri || null,
      api_base: magalu.cfg.apiBase,
      escopos: magalu.cfg.scopes,
    });
  });

  // EXPLORACAO 1: lista tickets (as devolucoes vivem como ticket de pos-venda)
  app.get('/api/debug/magalu-tickets', requerAdmin, async (req, res) => {
    const r = await magalu.listarTickets({
      _limit: req.query.limit || 20,
      _offset: req.query.offset || 0,
      status: req.query.status || undefined,
    });
    return res.status(r.ok ? 200 : (r.status || 502)).json({ ok: r.ok, status: r.status, data: r.data });
  });

  // EXPLORACAO 2: remessas reversas de um ticket (AQUI mora o rastreio?)
  app.get('/api/debug/magalu-return', requerAdmin, async (req, res) => {
    const t = String(req.query.ticket || '').trim();
    if (!t) return res.status(400).json({ ok: false, erro: 'informe ?ticket=ID' });
    const r = await magalu.remessasReversasDoTicket(t);
    return res.status(r.ok ? 200 : (r.status || 502)).json({ ok: r.ok, status: r.status, data: r.data });
  });

  // v3.57 - CACADOR: onde mora o codigo de barras da etiqueta (196634440-01)?
  // Varre os endpoints que temos escopo e diz em QUAL deles o numero aparece.
  // Uso: /api/debug/magalu-caca?q=196634440&ticket=<id>&pedido=<uuid>
  app.get('/api/debug/magalu-caca', requerAdmin, async (req, res) => {
    if (!magalu.cfg.autorizado) return res.status(400).json({ ok: false, erro: 'Magalu nao autorizada' });
    const alvo = String(req.query.q || '').replace(/\D/g, '');
    const ticket = String(req.query.ticket || '').trim();
    const pedido = String(req.query.pedido || '').trim();   // uuid do order
    const entrega = String(req.query.entrega || '').trim(); // uuid do delivery

    // procura o numero em qualquer lugar do JSON (recursivo)
    const contem = (obj) => {
      if (!alvo) return false;
      const txt = JSON.stringify(obj || {}).replace(/\D/g, '');
      return txt.includes(alvo);
    };

    const alvos = [];
    // v3.61 - A LISTA DE ESCOPOS do Diego revelou a "Shipping Open Api" de
    // SELLER: open:logistic-seller-shippings:read ("Leitura de remessas para
    // sellers") e open:logistic-seller-trackings:read. O padrao de URL da API
    // de carrier e /logistic-carrier/v1/shippings/{id} - entao a de seller
    // deve ser /logistic-seller/v1/... A LISTAGEM revela o formato dos IDs.
    const cod = alvo || '196634440';
    alvos.push(['SELLER-SHIP: lista', `/logistic-seller/v1/shippings?_limit=5`]);
    alvos.push(['SELLER-SHIP: por id', `/logistic-seller/v1/shippings/${cod}`]);
    alvos.push(['SELLER-SHIP: id -01', `/logistic-seller/v1/shippings/${cod}-01`]);
    alvos.push(['SELLER-TRACK: lista', `/logistic-seller/v1/trackings?_limit=5`]);
    alvos.push(['SELLER-SHIP v0: lista', `/logistic-seller/v0/shippings?_limit=5`]);
    alvos.push(['LOG/SELLER: lista', `/logistic/v1/seller/shippings?_limit=5`]);
    alvos.push(['SHIPPING: lista', `/shipping/v1/shippings?_limit=5`]);
    if (entrega) {
      alvos.push(['ORDER-LOG: da entrega', `/seller/v1/deliveries/${entrega}/logistics`]);
    }
    // carrier (provavel 403 pra seller, mas registra o comportamento)
    alvos.push(['CARRIER: por id', `/logistic-carrier/v1/shippings/${cod}`]);

    const achados = [];
    for (const [nome, caminho] of alvos) {
      await sleep(200);
      const r = await magalu.chamarMagalu(caminho);
      const bateu = r.ok && contem(r.data);
      achados.push({
        onde: nome,
        caminho,
        status: r.status,
        ok: r.ok,
        CONTEM_O_CODIGO: bateu || undefined,
        // se achou, mostra o JSON inteiro pra eu ver o campo exato
        resposta: bateu ? r.data : (r.ok ? '(ok, mas sem o codigo)' : r.data),
      });
    }
    return res.json({ ok: true, procurando: alvo || '(nada)', achados });
  });

  // v4.35 - SONDAGEM dos links do seller.magalu.com. O HAR do Diego revelou:
  //   pedido:    seller.magalu.com/pedidos/{numero}/{UUID_pedido}
  //   protocolo: seller.magalu.com/tickets/{UUID_ticket}?tenantId=goodimport-magazine
  // A duvida: o UUID que ja temos (da espreita Magalu Entregas) e o mesmo
  // UUID_pedido da URL? E como listar os protocolos de um pedido? Esta rota
  // pega um numero de pedido e testa os endpoints que podem devolver esses IDs.
  app.get('/api/debug/magalu-links', requerAdmin, async (req, res) => {
    if (!magalu.cfg.autorizado) return res.status(400).json({ ok: false, erro: 'Magalu nao autorizada' });
    const pedido = String(req.query.pedido || '').replace(/\D/g, '');
    if (!pedido) return res.status(400).json({ ok: false, erro: 'informe ?pedido=NUMERO' });
    const out = { pedido, fontes: {} };
    const proba = async (nome, caminho) => {
      try {
        const r = await magalu.chamarMagalu(caminho);
        out.fontes[nome] = { caminho, http: r.status, ok: !!r.ok, dados: r.ok ? r.data : String(JSON.stringify(r.error || '')).slice(0, 200) };
        return r.ok ? r.data : null;
      } catch (e) { out.fontes[nome] = { caminho, erro: e.message }; return null; }
    };
    try {
      // 1) o pedido pelo numero - procuramos um UUID na resposta
      const ped = await proba('pedido_por_numero', `https://api.magalu.com/seller/v1/orders/${pedido}`);
      if (ped) {
        // varre atras de qualquer uuid (id do pedido, do pacote, etc)
        const uuids = [];
        const busca = (o, path) => {
          if (!o || typeof o !== 'object') return;
          for (const k of Object.keys(o)) {
            const v = o[k];
            if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) uuids.push({ campo: (path ? path + '.' : '') + k, uuid: v });
            else if (typeof v === 'object') busca(v, (path ? path + '.' : '') + k);
          }
        };
        busca(ped, '');
        out.uuids_encontrados_no_pedido = uuids;
        out.campos_topo = Object.keys(ped);
      }
      // 2) endpoints de protocolo/ticket que podem existir
      await proba('protocolos_v1', `https://api.magalu.com/seller/v1/orders/${pedido}/protocols`);
      await proba('tickets_do_pedido', `https://api.magalu.com/seller/v1/orders/${pedido}/tickets`);

      out.como_montar = {
        link_pedido: 'https://seller.magalu.com/pedidos/{numero}/{UUID} - preciso saber qual dos uuids_encontrados e o certo',
        link_protocolo: 'https://seller.magalu.com/tickets/{UUID_ticket}?tenantId=goodimport-magazine',
      };
      return res.json({ ok: true, ...out });
    } catch (e) { return res.status(500).json({ ok: false, erro: e.message, ...out }); }
  });

  // v4.37 - SONDAGEM da API de SAC/TICKETS da Magalu. A DOC OFICIAL confirma o
  // endpoint (eu antes tinha chutado /orders/{id}/protocols, que nao existe):
  //   GET /seller/v0/tickets              -> lista os protocolos
  //   GET /seller/v0/tickets/{id}         -> um protocolo
  //   escopo: open:tickets-seller:read  (contas vindas do Integracommerce ja tem)
  // Testa se o nosso token acessa, e como filtrar por pedido.
  app.get('/api/debug/magalu-sac', requerAdmin, async (req, res) => {
    if (!magalu.cfg.autorizado) return res.status(400).json({ ok: false, erro: 'Magalu nao autorizada' });
    const pedido = String(req.query.pedido || '').replace(/\D/g, '');
    const out = { pedido: pedido || null, fontes: {} };
    const proba = async (nome, caminho) => {
      try {
        const r = await magalu.chamarMagalu(`https://api.magalu.com${caminho}`);
        const arr = r.ok ? (r.data?.results || r.data?.data || r.data || []) : null;
        out.fontes[nome] = {
          caminho, http: r.status, ok: !!r.ok,
          qtd: Array.isArray(arr) ? arr.length : (arr ? 'obj' : 0),
          erro: r.ok ? null : String(JSON.stringify(r.error || '')).slice(0, 200),
          amostra: r.ok ? (Array.isArray(arr) ? arr.slice(0, 2) : arr) : null,
        };
        return arr;
      } catch (e) { out.fontes[nome] = { caminho, erro: e.message }; return null; }
    };
    try {
      // 1) lista geral (o escopo funciona?)
      await proba('tickets_lista', '/seller/v0/tickets?_limit=5');
      // 2) filtros provaveis por pedido (a doc nao detalhou os query params aqui,
      //    entao testo os nomes mais comuns - o que voltar filtrado e o certo)
      if (pedido) {
        await proba('por_order_id', `/seller/v0/tickets?order_id=${pedido}&_limit=10`);
        await proba('por_orderId', `/seller/v0/tickets?orderId=${pedido}&_limit=10`);
        await proba('por_order', `/seller/v0/tickets?order=${pedido}&_limit=10`);
        await proba('por_q', `/seller/v0/tickets?q=${pedido}&_limit=10`);
        await proba('por_orderNumber', `/seller/v0/tickets?orderNumber=${pedido}&_limit=10`); // v4.39 - o que a pagina do seller usa
      }
      out.doc = 'GET /seller/v0/tickets - escopo open:tickets-seller:read';
      out.proxima = 'se tickets_lista vier 200, olho os campos pra montar o link e achar o filtro por pedido';
      return res.json({ ok: true, ...out });
    } catch (e) { return res.status(500).json({ ok: false, erro: e.message, ...out }); }
  });

  // EXPLORACAO livre ML (v3.65.1): tatear qualquer endpoint sem novo deploy
  // Uso: /api/debug/ml-get?path=/post-purchase/v1/claims/search
  app.get('/api/debug/ml-get', requerAdmin, async (req, res) => {
    const p = String(req.query.path || '').trim();
    if (!p.startsWith('/')) return res.status(400).json({ ok: false, erro: 'informe ?path=/...' });
    const r = await chamarML(`https://api.mercadolibre.com${p}`);
    return res.status(r.ok ? 200 : (r.status || 502)).json({ ok: r.ok, status: r.status, data: r.ok ? r.data : r.error });
  });

  // ── b302 (fatia 4) - as ultimas sete, uma a uma ───────────────────
  // Estas nao formavam bloco: estavam espalhadas no meio de codigo
  // operacional (linhas ~1499, 3473, 3687, 3905, 3964, 4072, 4099).
  // Cada uma foi recortada pelos proprios limites e conferida contra as
  // dependencias antes de sair.

  app.get('/api/debug/ml-token', requerAdmin, async (req, res) => {
    const r = await mlClient.chamarML('https://api.mercadolibre.com/users/me');
    if (r.ok) {
      return res.json({
        ok: true,
        veredito: '✅ TOKEN VIVO (renovou sozinho se precisou)',
        user_id: r.data?.id,
        nickname: r.data?.nickname,
      });
    }
    return res.status(502).json({
      ok: false,
      veredito: '💀 TOKEN MORTO - o refresh falhou. Use o /ml/setup (instrucoes na resposta)',
      status_ml: r.status,
      erro_ml: r.error,
      como_ressuscitar: [
        '1) Logado na conta ML da GOOD, abra: https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=SEU_ML_CLIENT_ID&redirect_uri=' + 'https://good-devolucoes-x-marketplaces-x-nfsbling.onrender.com/callback',
        '2) Autorize - a pagina /callback mostra o CODE',
        '3) EM ATE 1 MINUTO abra: /ml/setup?code=SEU_CODE',
      ],
    });
  });

  app.get('/api/debug/alerta-datas', requerAdmin, async (req, res) => {
    // v4.17 - modo PEDIDO ESPECIFICO: nao depende do indice (que zera a cada
    // deploy e leva ~2 min pra montar). Segue a cadeia inteira do zero:
    // pedido -> reclamacao -> devolucao -> envio de volta -> data real.
    const alvoOrder = String(req.query.order || '').trim();
    if (alvoOrder) {
      const passos = {};
      try {
        const rO = await chamarML(`https://api.mercadolibre.com/orders/${alvoOrder}`);
        passos['1_pedido'] = { http: rO.status || (rO.ok ? 200 : null), mediations: rO.ok ? (rO.data?.mediations || []) : null };
        const claimId = rO.ok && rO.data?.mediations?.[0]?.id ? String(rO.data.mediations[0].id) : null;
        passos['2_claim_id'] = claimId || '(pedido sem reclamacao)';
        if (claimId) {
          // v4.19 - o indice usa a V2 desta API; a v1 devolve 400 (foi o que
          // fez este diagnostico vir vazio na rodada anterior)
          let rR = await chamarML(`https://api.mercadolibre.com/post-purchase/v2/claims/${claimId}/returns`);
          passos['3_returns_v2'] = { http: rR.status || (rR.ok ? 200 : null), ok: !!rR.ok };
          if (!rR.ok) {
            rR = await chamarML(`https://api.mercadolibre.com/post-purchase/v1/claims/${claimId}/returns`);
            passos['3_returns_v1_fallback'] = { http: rR.status || (rR.ok ? 200 : null), ok: !!rR.ok };
          }
          passos['3_return_completo'] = rR.ok ? rR.data : null;
          const shipments = (rR.ok && (rR.data?.shipments || (Array.isArray(rR.data) ? rR.data[0]?.shipments : null))) || [];
          passos['3_shipments_encontrados'] = shipments.map(x => ({ id: x.shipment_id || x.id, status: x.status, tipo: x.type, tracking: x.tracking_number }));
          passos['3_last_updated_do_return'] = rR.ok ? (rR.data?.last_updated || (Array.isArray(rR.data) ? rR.data[0]?.last_updated : null) || null) : null;
          const sid = shipments[0] ? String(shipments[0].shipment_id || shipments[0].id) : null;
          passos['4_shipment_da_devolucao'] = sid || '(nenhum shipment no return)';
          if (sid) {
            const rh = await chamarML(`https://api.mercadolibre.com/shipments/${sid}/history`);
            const dt = rh.ok ? (rh.data?.date_history?.date_delivered || null) : null;
            passos['5_history'] = { http: rh.status || (rh.ok ? 200 : null), date_delivered: dt, date_history: rh.ok ? rh.data?.date_history : null };
            if (dt) passos['6_dias_pela_data_certa'] = Math.floor((Date.now() - Date.parse(dt)) / 864e5);
            if (passos['3_last_updated_do_return']) passos['6_dias_pelo_last_updated'] = Math.floor((Date.now() - Date.parse(passos['3_last_updated_do_return'])) / 864e5);
            passos['7_ja_esta_no_cache'] = ESP_ENTREGA.has(sid) ? ESP_ENTREGA.get(sid) : '(nao)';
          }
        }
      } catch (e) { passos.erro = e.message; }
      return res.json({ ok: true, modo: 'pedido_especifico', order: alvoOrder, passos });
    }

    const mlR = mlReturns.resumoEspreita();
    const lista = (mlR.entregues || []).slice(0, Number(req.query.n || 8));
    const out = [];
    for (const d of lista) {
      const sid = d.shipment_devolucao ? String(d.shipment_devolucao) : null;
      const item = {
        pedido: d.pedido,
        tracking: d.tracking,
        shipment_devolucao: sid,
        entregue_em_do_return: d.entregue_em || null,   // last_updated (pode estar errado)
        data_no_cache: sid ? (ESP_ENTREGA.has(sid) ? ESP_ENTREGA.get(sid) : '(nao buscado ainda)') : '(sem shipment)',
        dias_que_o_painel_mostra: d.dias_desde,
      };
      // testa o /history AGORA, pra saber se ele responde a data certa
      if (sid && req.query.testar === '1') {
        try {
          const rh = await chamarML(`https://api.mercadolibre.com/shipments/${sid}/history`);
          item.history_http = rh.status || (rh.ok ? 200 : null);
          item.history_date_delivered = rh.ok ? (rh.data?.date_history?.date_delivered || null) : null;
          item.history_status = rh.ok ? (rh.data?.status || null) : null;
          if (item.history_date_delivered) {
            item.dias_pela_data_certa = Math.floor((Date.now() - Date.parse(item.history_date_delivered)) / 864e5);
          }
        } catch (e) { item.history_erro = e.message; }
        await new Promise(r => setTimeout(r, 250));
      }
      out.push(item);
    }
    return res.json({
      ok: true,
      dica: alvoOrder ? null : 'indice vazio? use ?order=NUMERO_DA_VENDA&testar=1 - esse modo nao depende do indice',
      indice_ml_quente: !!mlR.quente,
      cache_tamanho: ESP_ENTREGA.size,
      enriquecimento_rodando: deps.ESP_ENTREGA_RODANDO,
      total_entregues_no_indice: (mlR.entregues || []).length,
      itens: out,
    });
  });

  app.get('/api/debug/shopee-return', requerAdmin, async (req, res) => {
    const alvo = String(req.query.sn || '').trim().toUpperCase();
    try {
      const lista = await shopee.buscarDevolucoesProxy(false);
      if (!Array.isArray(lista)) return res.json({ ok: false, erro: 'proxy nao devolveu lista', tipo: typeof lista });
      const achado = alvo
        ? lista.find(d => [d.order_sn, d.return_sn, d.tracking_number].some(v => String(v || '').toUpperCase() === alvo))
        : null;
      const statusVistos = {}, logVistos = {};
      for (const d of lista) {
        const st = String(d.status || '(vazio)');
        statusVistos[st] = (statusVistos[st] || 0) + 1;
        const ls = String(d.logistics_status || d.logistic_status || '(vazio)');
        logVistos[ls] = (logVistos[ls] || 0) + 1;
      }
      return res.json({
        ok: true,
        total_na_lista: lista.length,
        campos_disponiveis: lista[0] ? Object.keys(lista[0]) : [],
        valores_de_status: statusVistos,
        valores_de_logistics_status: logVistos,
        procurado: alvo || '(nenhum)',
        objeto_cru: achado || null,
        dica: achado ? 'olhe o objeto_cru: qual campo diz que a devolucao terminou?' : 'nao achei esse codigo na lista do proxy',
        amostra_2_itens: lista.slice(0, 2),
      });
    } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
  });

  app.get('/api/debug/bling-nf-devolucao', requerAdmin, async (req, res) => {
    const out = { testes: {} };
    const proba = async (nome, url) => {
      try {
        const r = await chamarBling(url);
        const lista = (r.ok && r.data?.data) || [];
        out.testes[nome] = {
          url: url.replace('https://api.bling.com.br/Api/v3', ''),
          http: r.ok ? 200 : (r.status || null),
          erro: r.ok ? null : String(r.error || '').slice(0, 150),
          qtd: lista.length,
          // so os campos que interessam pra nao vazar a nota inteira
          amostra: lista.slice(0, 3).map(n => ({
            id: n.id, numero: n.numero, tipo: n.tipo, serie: n.serie,
            situacao: n.situacao, dataEmissao: n.dataEmissao,
            natureza: n.naturezaOperacao?.descricao || n.naturezaOperacao || null,
            contato: n.contato?.nome || null,
          })),
        };
        return lista;
      } catch (e) { out.testes[nome] = { url, erro: e.message }; return []; }
    };

    try {
      // tipo=0 saida, tipo=1 entrada. Devolucao de cliente = ENTRADA.
      await proba('entrada_tipo1', 'https://api.bling.com.br/Api/v3/nfe?tipo=1&limite=15');
      // sem filtro, so pra ver o formato e quais campos vem
      await proba('todas_recentes', 'https://api.bling.com.br/Api/v3/nfe?limite=5');
      // se aceitar filtro por natureza/finalidade (pode nao existir)
      await proba('por_situacao_5', 'https://api.bling.com.br/Api/v3/nfe?tipo=1&situacao=5&limite=15');

      // se o Diego mandar uma chave de NF de venda, tenta achar a devolucao que a referencia
      const chaveRef = String(req.query.chave || '').replace(/\D/g, '');
      if (chaveRef.length === 44) {
        const lista = await proba('busca_por_chave_referenciada', `https://api.bling.com.br/Api/v3/nfe?limite=50&tipo=1`);
        // e detalha uma nota de entrada pra ver se traz a chave referenciada
        if (lista[0]?.id) {
          const rDet = await chamarBling(`https://api.bling.com.br/Api/v3/nfe/${lista[0].id}`);
          const det = rDet.ok ? (rDet.data?.data || {}) : {};
          out.exemplo_detalhe_entrada = {
            id: det.id, numero: det.numero, tipo: det.tipo,
            tem_notaReferenciada: !!(det.notaReferenciada || det.notasReferenciadas || det.chaveAcesso),
            campos_no_detalhe: Object.keys(det).slice(0, 40),
          };
        }
      }

      out.legenda = {
        tipo: '0 = saida (venda), 1 = entrada (devolucao de cliente)',
        objetivo: 'achar as notas tipo 1 e cruzar a chave da NF de venda original com o campo referenciado',
      };
      return res.json({ ok: true, ...out });
    } catch (e) { return res.status(500).json({ ok: false, erro: e.message, ...out }); }
  });

  app.get('/api/debug/motivo-devolucao', requerAdmin, async (req, res) => {
    const orderId = String(req.query.order || '').trim();
    let claimId = String(req.query.claim || '').trim();
    const out = { order_id: orderId || null, claim_id: claimId || null, fontes: {} };

    const tentar = async (nome, url, opts) => {
      try {
        const r = await chamarML(url, opts);
        out.fontes[nome] = {
          url: url.replace('https://api.mercadolibre.com', ''),
          http: r.status || (r.ok ? 200 : null),
          ok: !!r.ok,
          erro: r.ok ? null : String(r.error || '').slice(0, 200),
          amostra: r.ok ? r.data : null,
        };
        return r.ok ? r.data : null;
      } catch (e) {
        out.fontes[nome] = { url, ok: false, erro: e.message };
        return null;
      }
    };

    try {
      // 1) o PEDIDO: traz status, tags e o motivo do cancelamento quando existe
      let order = null;
      if (orderId) {
        order = await tentar('pedido', `https://api.mercadolibre.com/orders/${orderId}`);
        if (order) {
          out.resumo_pedido = {
            status: order.status || null,
            status_detail: order.status_detail || null,
            tags: order.tags || [],
            shipping_id: order.shipping?.id || null,
            pack_id: order.pack_id || null,
          };
        }
        // 2) OBSERVACOES da venda (o "Adicionar nota" do painel do ML)
        await tentar('observacoes_da_venda', `https://api.mercadolibre.com/orders/${orderId}/notes`);
        // v4.11 - DESCOBERTA: o proprio pedido traz o id da reclamacao em
        // mediations[]. Nao precisa da busca (que dava 400).
        if (!claimId && order?.mediations?.length) {
          claimId = String(order.mediations[0].id);
          out.claim_id = claimId;
          out.fontes['claim_via_mediations'] = { ok: true, http: 200, amostra: order.mediations };
        }
        if (!claimId) out.fontes['claim_via_mediations'] = { ok: false, erro: 'pedido sem mediations (nao houve reclamacao)' };
        // 4) o ENVIO ORIGINAL: e aqui que aparece "nem foi entregue ao cliente"
        const shipIda = order?.shipping?.id;
        if (shipIda) {
          const sh = await tentar('envio_original', `https://api.mercadolibre.com/shipments/${shipIda}`, { 'x-format-new': 'true' });
          if (sh) {
            // v4.11 - o campo status_history.date_delivered NAO vem nesta
            // resposta. O que vale e o status/substatus e as tags do pedido.
            const st = String(sh.status || '');
            const sub = String(sh.substatus || '');
            const tags = order?.tags || [];
            out.resumo_envio_ida = {
              status: st || null,
              substatus: sub || null,
              last_updated: sh.last_updated || null,
              tem_status_history: !!sh.status_history,
              // so isso prova que o cliente nao recebeu:
              nunca_entregue: st === 'not_delivered' || sub === 'returned' || tags.includes('not_delivered'),
              risco_fraude: tags.includes('fraud_risk_detected'),
            };
          }
          // v4.11 - o historico fica em endpoint separado: e de la que sai a
          // data REAL da entrega (a v3.95 procurava no lugar errado)
          await tentar('historico_do_envio', `https://api.mercadolibre.com/shipments/${shipIda}/history`);
        }
      }

      // 5) o CLAIM: motivo classificado, tipo e estagio
      if (claimId) {
        const cl = await tentar('claim_detalhe', `https://api.mercadolibre.com/post-purchase/v1/claims/${claimId}`);
        if (cl) {
          out.resumo_claim = {
            tipo: cl.type || null,
            status: cl.status || null,
            stage: cl.stage || null,
            reason_id: cl.reason_id || null,
            motivo_texto: cl.reason?.name || cl.reason?.description || null,
            resolucao: cl.resolution?.reason || null,
          };
        }
        // 6) MENSAGENS da mediacao (texto livre do cliente - candidato a resumo por IA)
        await tentar('mensagens_mediacao', `https://api.mercadolibre.com/post-purchase/v1/claims/${claimId}/messages`);
        // 7) variacoes do endpoint de motivo/mensagens (qual responde?)
        await tentar('claim_reason', `https://api.mercadolibre.com/post-purchase/v1/claims/${claimId}/reasons`);
        await tentar('claim_v2', `https://api.mercadolibre.com/v1/claims/${claimId}`);
        await tentar('claim_mensagens_v2', `https://api.mercadolibre.com/v1/claims/${claimId}/messages`);
        // 8) o RETURN (ja usamos no indice, mas aqui mostra o objeto inteiro)
        await tentar('return_do_claim', `https://api.mercadolibre.com/post-purchase/v1/claims/${claimId}/returns`);
      }

      // veredito rapido: o que DA pra mostrar pro estoquista hoje
      out.veredito = {};
      for (const [k, v] of Object.entries(out.fontes)) {
        out.veredito[k] = v.ok ? '✅ liberado' : `❌ ${v.http || ''} ${String(v.erro || '').slice(0, 60)}`;
      }
      return res.json({ ok: true, ...out });
    } catch (e) {
      return res.status(500).json({ ok: false, erro: e.message, ...out });
    }
  });

  app.get('/api/debug/bling-ean', requerEstoquista, async (req, res) => {
    const ean = String(req.query.ean || '').trim();
    const out = { ean, testes: [], campos_da_listagem: null };
    try {
      const rL = await chamarBling('https://api.bling.com.br/Api/v3/produtos?pagina=1&limite=1');
      const amostra = (rL.ok && rL.data?.data && rL.data.data[0]) || null;
      out.campos_da_listagem = amostra ? Object.keys(amostra) : null;
      out.listagem_tem_gtin = amostra ? ('gtin' in amostra) : null;
      out.amostra_listagem = amostra || null;
      if (ean) {
        for (const filtro of ['gtin', 'codigo', 'pesquisa', 'nome']) {
          const r = await chamarBling(`https://api.bling.com.br/Api/v3/produtos?${filtro}=${encodeURIComponent(ean)}&limite=5`);
          const lista = (r.ok && r.data?.data) || [];
          out.testes.push({
            filtro,
            http_ok: r.ok,
            qtd: lista.length,
            primeiros: lista.slice(0, 3).map(p => ({ sku: p.codigo, nome: (p.nome || '').slice(0, 45), gtin: p.gtin || null })),
          });
          await new Promise(r2 => setTimeout(r2, 250));
        }
      }
      return res.json({ ok: true, ...out });
    } catch (e2) { return res.status(500).json({ ok: false, erro: e2.message, ...out }); }
  });

  app.get('/api/debug/produtos-indice', requerEstoquista, async (req, res) => {
    if (req.query.eans === '1') enriquecerEansEmBackground();
    // v4.04 - dispara em background e responde na hora (antes esperava o
    // indice inteiro e a requisicao estourava o tempo do Render = 502)
    if (req.query.rebuild === '1' && !IDX_PROD.construindo) { construirIndiceProdutos().catch(() => {}); }
    const q = String(req.query.q || '').trim();
    const alvo = normProd(q);
    const pal = alvo.split(/\s+/).filter(Boolean);
    const amostra = q ? IDX_PROD.itens.filter(p => pal.every(w => p.busca.includes(w))).slice(0, 10).map(p => ({ sku: p.sku, nome: p.nome })) : [];
    return res.json({
      ok: true,
      total_no_indice: IDX_PROD.itens.length,
      idade_min: IDX_PROD.ts ? Math.round((Date.now() - IDX_PROD.ts) / 60000) : null,
      erro: IDX_PROD.erro,
      construindo: !!IDX_PROD.construindo,
      paginas_lidas: IDX_PROD.paginas || 0,
      falhas: IDX_PROD.falhas || [],
      exemplos: IDX_PROD.itens.slice(0, 5).map(p => p.sku),
      eans: { ...EAN_PROGRESSO, rodando: deps.EAN_RODANDO, cache_skus: EAN_POR_SKU.size, com_ean_no_indice: IDX_PROD.itens.filter(p => (p.eans || []).length).length },
      amostra_com_ean: IDX_PROD.itens.filter(p => (p.eans || []).length).slice(0, 5).map(p => ({ sku: p.sku, ean: p.ean })),
      busca_teste: q ? { termo: q, achou: amostra.length, amostra } : null,
    });
  });

  // ── b334 — SONDA TikTok (frente devolucoes TikTok) ─────────────────────
  // Mostra o que o Mover-Pedidos guarda das devolucoes TikTok da GOOD, via
  // ponte (os tokens do TikTok moram la). ?coletar=1&dias=60 coleta antes
  // de ler; ?limite=N (padrao 30). O que interessa: `cru.cru_campos_uniao`
  // — e ali que aparece se a API manda rastreio da reversa, o que decide o
  // que da pra BIPAR na triagem. A empresa vai carimbada aqui porque este
  // modulo E o da GOOD (mesma regra do b324: ponto unico, nunca por chamada).
  // v4.68 - QUEM ESTA PRESTES A SER PERDIDO POR REVELIA
  //
  // Os dois prejuizos conferidos no extrato em 29/08 nao foram julgamento:
  // o TikTok aprovou o reembolso porque ninguem respondeu no prazo. Num
  // deles o cliente ficou com o produto, o valor voltou inteiro, e ainda
  // foram cobrados frete e comissao.
  //
  // A conversa do Checkout achou o endpoint /records (linha do tempo) e
  // mediu o relogio: a revelia cai 6-7 dias depois de o cliente postar.
  // Esta rota lista quem esta nessa janela, ANTES de virar prejuizo.
  //
  // ?empresa=good|amb|girassol (padrao good)
  app.get('/api/debug/tiktok-revelia', (req, res, next) => {
    if (adminOk(req)) return next();
    return requerAdmin(req, res, next);
  }, async (req, res) => {
    try {
      const empresa = String(req.query.empresa || 'good').toLowerCase();
      const r = await tiktokPonte.eventosDevolucoes(empresa, { limite: req.query.limite });
      if (!r || !r.ok) {
        return res.status(502).json({ ok: false, empresa, erro: (r && r.erro) || 'ponte indisponivel' });
      }
      const analise = tiktokRevelia.separar(r.corpo);
      return res.json({
        ok: true,
        empresa,
        loja: r.loja,
        relogio: {
          dias_ate_revelia: tiktokRevelia.DIAS_ATE_REVELIA,
          avisa_a_partir_de: tiktokRevelia.AVISO_A_PARTIR_DE,
          urgente_a_partir_de: tiktokRevelia.URGENTE_A_PARTIR_DE,
          medido_em: '19 casos reais da Girassol (29/08): revelia entre 4 e 14 dias apos o BUYER_SHIPPED, mediana 7. O alerta usa o PIOR caso (4), nao a media',
        },
        ...analise,
        // b182 - o proprio servico avisa, e vale repetir aqui: o valor das
        // perdidas e o da TELA (reembolso ao cliente), NAO o prejuizo. O
        // impacto real esta no extrato — e o dono ja mediu a diferenca: no
        // pedido 585514776487560610 a tela dizia R$ 36,00 e o extrato
        // debitou R$ 41,01.
        aviso_valor: analise.valor_e_da_tela
          ? 'O valor acima e o do reembolso ao cliente (tela), nao o prejuizo. '
            + 'O impacto real esta no extrato, no Mover-Pedidos: '
            // b183 (Codex): caminho relativo faria o admin colar isto no
            // host das DEVOLUCOES, onde a rota nao existe. A rota mora no
            // outro servico — URL inteira, que e a regra da casa.
            + (String(process.env.MOVER_PEDIDOS_URL || '').replace(/\/+$/, '')
               || 'https://mover-pedidos-aguardando-x-atendido.onrender.com')
            + '/tiktok/revelia-impacto?loja=' + r.loja + '&k=SUA_ADMIN_KEY'
          : undefined,
      });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 200) });
    }
  });

  // ============================================================
  // v4.73 - REMESSAS REVERSAS POR PEDIDO (pedido da conversa do Checkout)
  // ------------------------------------------------------------
  // Eles mapearam os cancelamentos do Magalu e acharam 14 casos na GOOD
  // com NF emitida e sem devolucao registrada — R$ 12.704 nas tres
  // empresas. Mas o dado deles nao diz se o produto chegou a SAIR:
  //
  //   "esses 14 podem ser duas coisas bem diferentes: cancelou antes de
  //    postar (so cancelar a NF) ou postou e o cliente ficou com o
  //    produto (ai voce perdeu o produto tambem)"
  //
  // O cruzamento precisa das duas pontas: eles dizem se SAIU (etiqueta do
  // checkout), nos dizemos se VOLTOU (remessa reversa). Esta rota e a
  // nossa metade.
  //
  // POR QUE AQUI E NAO LA: o indice de tickets ja existe deste lado e se
  // mantem sozinho (reconstroi quando passa de 30 min). Refazer la seria
  // varrer a lista inteira de tickets pra reconstruir o mesmo mapa — e
  // ficaria velho entre execucoes.
  //
  // ⚠️ A LICAO QUE VALE REPETIR: o Magalu FECHA o ticket com o pacote
  // ainda na rua, e /tickets/{id}/returns responde pra ticket fechado.
  // Filtrar por ticket aberto pularia justamente os que importam.
  //
  // GET  /api/magalu/reversas-por-pedido?codes=A,B,C&k=ADMIN_KEY
  // POST /api/magalu/reversas-por-pedido  { codes: [...] }
  // ============================================================
  async function reversasPorPedido(req, res) {
    try {
      const brutos = req.method === 'POST'
        ? (req.body && (req.body.codes || req.body.pedidos))
        : String(req.query.codes || req.query.pedidos || '').split(',');

      const codes = (Array.isArray(brutos) ? brutos : [])
        .map((c) => String(c == null ? '' : c).trim())
        .filter(Boolean)
        .slice(0, 200);   // teto: sao "poucas dezenas por vez" no uso deles

      if (!codes.length) {
        return res.status(400).json({
          ok: false,
          erro: 'passe os pedidos em ?codes=A,B,C ou no corpo { codes: [...] }',
        });
      }

      const linhas = [];
      for (const code of codes) {
        try {
          const dev = await magalu.acharDevolucao(code);
          linhas.push({
            code,
            // ⚠️ tem_reversa: TRUE so quando ha reverse_code — ou seja, um
            // pacote de verdade voltando. Ticket sem remessa NAO conta:
            // protocolo aberto e pacote a caminho sao coisas diferentes,
            // e e essa diferenca que separa os 14 casos deles.
            // b190.6 (Codex): codigo de tentativa que FALHOU nao e reversa
            // viva. Num ticket reagendado eu caio no codigo antigo como
            // ultimo recurso e marco `codigo_possivelmente_obsoleto` — mas
            // nao repassava, entao a outra conversa receberia tem_reversa:
            // true com o rastreio de um pacote que nunca saiu. Pior que
            // dizer "nao sei": levaria eles a concluir que o produto voltou.
            tem_reversa: !!(dev && dev.reverse_code && !dev.codigo_possivelmente_obsoleto),
            reverse_code: (dev && dev.reverse_code) || null,
            codigo_obsoleto: (dev && dev.codigo_possivelmente_obsoleto) || undefined,
            ticket_id: (dev && dev.ticket_id) || null,
            protocolo: (dev && dev.protocolo) || null,
            // contexto util pra eles decidirem sem outra chamada
            ticket_status: (dev && dev.status) || null,
            ticket_fechado: dev ? !!dev.fechado : null,
            motivo: (dev && dev.motivo) || null,
            // sem ticket nenhum: o cliente nem abriu protocolo
            tem_ticket: !!dev,
          });
        } catch (e) {
          linhas.push({ code, erro: String(e.message || e).slice(0, 120) });
        }
      }

      const comReversa = linhas.filter((l) => l.tem_reversa).length;
      return res.json({
        ok: true,
        total: linhas.length,
        com_reversa: comReversa,
        sem_reversa: linhas.length - comReversa,
        linhas,
        leia: 'tem_reversa=true significa PACOTE VOLTANDO (ha reverse_code). '
          + 'Ticket sem remessa nao conta como reversa: protocolo aberto e pacote a caminho '
          + 'sao coisas diferentes. tem_ticket=false = o cliente nem abriu protocolo. '
          + 'ATENCAO: nao filtramos por ticket aberto de proposito — o Magalu fecha o ticket '
          + 'com o pacote ainda na rua. E `codigo_obsoleto:true` significa que o unico codigo '
          + 'que achei e de uma tentativa de coleta ANTERIOR (reagendada): vai no reverse_code '
          + 'pra consulta, mas NAO conta como reversa viva.',
      });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 200) });
    }
  }

  app.get('/api/magalu/reversas-por-pedido', (req, res, next) => {
    if (adminOk(req)) return next();
    return requerAdmin(req, res, next);
  }, reversasPorPedido);

  app.post('/api/magalu/reversas-por-pedido', (req, res, next) => {
    if (adminOk(req)) return next();
    return requerAdmin(req, res, next);
  }, reversasPorPedido);

  // b219 - O /nfe ACEITA FILTRO POR CHAVE?
  //
  // [stated] "existiria alguma forma de eu relacionar o número da chave
  // danfe, que fica dentro da NF? como eu pegaria isso, end point sei lá?"
  //
  // A pergunta e boa: a chave e UNICA, entao filtrar por ela resolveria de
  // uma vez o problema que passamos o dia caçando — numero que se repete
  // entre series, candidata ambigua, escada de desempate.
  //
  // Hoje NINGUEM busca por chave: `resolverIdNFPorChave` so extrai a DATA
  // dela e varre o periodo inteiro comparando depois. Caro e lento.
  //
  // Eu nao sei se a API aceita, e nao tenho como testar daqui. Esta rota
  // tenta as grafias plausiveis e diz qual funciona.
  //
  // GET /api/debug/testar-chave?chave=44DIGITOS&k=ADMIN_KEY
  app.get('/api/debug/testar-chave', (req, res, next) => {
    if (adminOk(req)) return next();
    return requerAdmin(req, res, next);
  }, async (req, res) => {
    const chave = String(req.query.chave || '').replace(/\D/g, '');
    if (chave.length !== 44) {
      return res.status(400).json({ ok: false, erro: 'passe ?chave= com os 44 digitos' });
    }
    const formas = [
      { nome: 'chaveAcesso', url: `?limite=5&pagina=1&chaveAcesso=${chave}` },
      { nome: 'chave', url: `?limite=5&pagina=1&chave=${chave}` },
      { nome: 'chaveAcesso+tipo', url: `?limite=5&pagina=1&tipo=1&chaveAcesso=${chave}` },
      // b219.2 (Codex): este e o CONTROLE — a busca por numero que ja
      // funciona. Serve so pra provar que a nota existe e a conta esta
      // certa; um FUNCIONA aqui nao diz nada sobre filtrar por chave.
      { nome: 'numero (CONTROLE - nao e filtro por chave)', controle: true,
        url: `?limite=5&pagina=1&tipo=1&numero=${chave.substr(25, 9).replace(/^0+/, '')}` },
    ];
    const saida = [];
    for (const f of formas) {
      try {
        const r = await chamarBling('https://api.bling.com.br/Api/v3/nfe' + f.url);
        const lista = (r.ok && r.data?.data) ? r.data.data : [];

        // b219.1 (Codex): a listagem PODE OMITIR a chave — esta documentado
        // no proprio repo (b166.4). Julgar so pelo que a lista traz diria
        // "ignorou o filtro" mesmo quando a API acertou em cheio.
        //
        // Entao: quando a lista vem curta e sem chave, busco o DETALHE da
        // primeira nota, onde a chave sempre vem. Uma chamada a mais num
        // diagnostico que roda sob demanda nao custa nada, e sem ela o
        // teste pode me fazer descartar a solucao certa.
        let bateu = lista.filter((nf) =>
          String(nf.chaveAcesso || '').replace(/\D/g, '') === chave);
        let confirmadaPeloDetalhe = false;
        let detalheFalhou = false;
        if (!bateu.length && lista.length && lista.length <= 5) {
          // b219.4 (Codex): conferir TODAS as linhas sem chave, nao so a
          // primeira. No controle o numero se repete entre series, entao a
          // nota certa pode ser a segunda ou a terceira — parar na primeira
          // reportaria "nao achei" com ela na lista.
          const semChave = lista.filter((nf) => !nf.chaveAcesso);
          for (const cand of semChave) {
            await sleep(400);
            const det = await buscarNFePorId(cand.id);
            if (!det.ok) { detalheFalhou = true; continue; }   // b219.4: erro e erro
            const nfd = det.data?.data || null;
            if (nfd && String(nfd.chaveAcesso || '').replace(/\D/g, '') === chave) {
              bateu = [nfd];
              confirmadaPeloDetalhe = true;
              break;
            }
          }
        }
        saida.push({
          forma: f.nome,
          controle: f.controle || undefined,
          http_ok: !!r.ok,
          status: r.status || null,
          devolveu: lista.length,
          com_a_chave_certa: bateu.length,
          // se devolveu MUITAS e nenhuma bate, o filtro foi IGNORADO
          // b219.2 (Codex): mais de UMA linha prova que o filtro foi ignorado.
          //
          // Se o Bling nao conhece o parametro, ele devolve as 5 primeiras
          // notas quaisquer — e se a que eu procuro estiver entre elas por
          // acaso, `bateu.length` e 1 e eu diria FUNCIONA. Falso positivo
          // que me faria trocar a busca inteira por algo que nao filtra.
          //
          // Filtro de verdade por chave devolve UMA nota, porque a chave e
          // unica.
          // b219.3 (Codex): a regra de "1 linha so" vale pra CHAVE, nao pro
          // controle — o numero se repete entre series, e vir varias linhas
          // ali e o esperado (e justamente o problema que investigamos).
          // b219.4: se o detalhe falhou, nao sei dizer se o filtro serviu
          veredito: !r.ok ? 'erro'
            : (detalheFalhou && !bateu.length) ? 'erro (detalhe da NF falhou)'
            : f.controle
              ? (bateu.length ? 'FUNCIONA' : (lista.length ? 'achou outras, nao a certa' : 'vazio'))
              : (bateu.length && lista.length === 1 ? 'FUNCIONA'
                : (bateu.length ? 'ignorou o filtro (achei a nota, mas vieram '
                    + lista.length + ' — chave e unica, filtro real devolveria 1)'
                  : (lista.length ? 'ignorou o filtro' : 'vazio'))),
          // b219.1: se precisou do detalhe, a lista nao trazia a chave
          confirmada_pelo_detalhe: confirmadaPeloDetalhe || undefined,
          id: bateu[0] ? bateu[0].id : null,
        });
        await sleep(400);
      } catch (e) {
        // b219.5 (Codex): excecao tambem e sonda que FALHOU. Sem `veredito`
        // aqui, a contagem de erros passageiros ignorava esta linha — e se
        // o controle funcionasse, a rota concluiria "nenhuma grafia e
        // aceita" tendo uma sonda que nem chegou a responder.
        saida.push({
          forma: f.nome,
          controle: f.controle || undefined,
          veredito: 'erro (excecao)',
          erro: String(e.message || e).slice(0, 120),
        });
      }
    }
    // b219.2: a conclusao olha SO os testes de chave, nunca o controle
    const deChave = saida.filter((x) => !x.controle);
    const venceu = deChave.find((x) => x.veredito === 'FUNCIONA');
    const controleOk = saida.some((x) => x.controle && x.veredito === 'FUNCIONA');

    res.json({
      ok: true,
      conclusao: venceu
        ? 'DA PRA FILTRAR POR CHAVE usando `' + venceu.forma + '` — vale trocar a busca'
        // b219.3 (Codex): sonda que ERROU nao prova nada. Dizer "nao
        // aceita" por causa de um 500 passageiro faria descartar a solucao
        // certa — e este teste existe pra decidir arquitetura.
        // b219.4 (Codex): 4xx e RECUSA (o parametro nao existe), 5xx e
        // passageiro. Tratar os dois como "tente de novo" faria a rota
        // responder INCONCLUSIVO pra sempre quando a API rejeita a grafia
        // com 400 — que e exatamente a resposta que eu quero registrar.
        : (deChave.some((x) => (x.veredito || '').startsWith('erro')
            && !(x.status >= 400 && x.status < 500))
          ? 'INCONCLUSIVO: ' + deChave.filter((x) => (x.veredito || '').startsWith('erro')
              && !(x.status >= 400 && x.status < 500)).length
            + ' sonda(s) falharam por erro passageiro (5xx ou rede). Rode de novo'
          : (controleOk
            ? 'NAO da pra filtrar por chave. A nota existe (o controle achou por numero) '
              + 'e as grafias ou nao filtraram, ou foram RECUSADAS pela API (4xx) — '
              + 'nos dois casos, o parametro nao serve'
            : 'INCONCLUSIVO: nem o controle achou a nota. Confira se a chave e desta '
              + 'empresa e se a nota existe no Bling')),
      chave,
      serie: chave.substr(22, 3),
      numero: chave.substr(25, 9).replace(/^0+/, ''),
      testes: saida,
      leia: 'Procure `veredito: "FUNCIONA"` — essa forma acha a nota pela CHAVE, '
        + 'que e unica. Se alguma funcionar, da pra trocar toda a busca por numero '
        + '(ambigua entre series) por uma chamada exata. "ignorou o filtro" significa '
        + 'que a API devolveu notas quaisquer, entao aquela grafia nao serve. '
        + '`confirmada_pelo_detalhe: true` = a lista nao trazia a chave e eu fui '
        + 'buscar na nota completa; o filtro funcionou do mesmo jeito.',
    });
  });

  // b210 - O MAPA SERIE -> MARKETPLACE que o sistema aprendeu.
  //
  // [stated] "cada marketplace com operação fullfilment vai ter 1 série
  // específica, pois são NFs q o próprio programa faturador do marketplace
  // emite."
  //
  // A regra e firme e toda nota traz serie e origem juntas, entao o sistema
  // aprende observando. Esta rota mostra o que ele viu, pro dono conferir —
  // serie com mais de uma origem sai marcada como duvidosa, porque ai eu
  // nao escolho sozinho.
  //
  // GET /api/debug/series?k=ADMIN_KEY
  app.get('/api/debug/series', (req, res, next) => {
    if (adminOk(req)) return next();
    return requerAdmin(req, res, next);
  }, (req, res) => {
    const confrontar = require('./confrontar-nf');
    res.json({
      ok: true,
      regra: 'serie 1 = vendas da matriz; cada marketplace com Full tem a sua',
      fixo: confrontar.SERIE_CANAL,
      aprendido: confrontar.mapaAprendido(),
      leia: 'O `fixo` e o que esta no codigo; o `aprendido` e o que o sistema viu nas '
        + 'notas. Serie marcada como `duvidoso` apareceu com mais de uma origem — '
        + 'confira e me diga qual e a certa. Serie que nao aparecer aqui ainda nao '
        + 'passou por nenhuma busca.',
    });
  });

  // v4.85 - POR QUE A NF NAO FOI ACHADA?
  //
  // O dono viu "sem NF vinculada" num caso cuja nota EXISTE no Bling (ele
  // abriu e mostrou). A busca por pedido roda, mas nao casa — e sem ver o
  // que ela varreu, eu so chutaria.
  //
  // Esta rota mostra: quantas paginas leu, o intervalo de datas que
  // alcancou, e os `numeroPedidoLoja` que encontrou perto. Com isso da pra
  // saber se e formato diferente, janela errada ou nota fora do alcance.
  //
  // GET /api/debug/achar-nf?pedido=583529996785714778&data=2026-04-19&k=ADMIN_KEY
  app.get('/api/debug/achar-nf', (req, res, next) => {
    if (adminOk(req)) return next();
    return requerAdmin(req, res, next);
  }, async (req, res) => {
    try {
      const pedido = String(req.query.pedido || '').trim();
      if (!pedido) return res.status(400).json({ ok: false, erro: 'passe ?pedido=' });
      const data = String(req.query.data || '').trim() || null;

    // b206 - o diagnostico testa os TRES caminhos, na ORDEM do card.
    //
    // Ele so buscava por PEDIDO, enquanto o card passou a buscar primeiro
    // pelo NUMERO da nota. Testar um caminho diferente do real engana: o
    // dono via "achou: false" e concluia que o card falharia, quando o card
    // usa outro caminho — ou o contrario.
    //
    // Aceita ?nf=NUMERO tambem, que e o que o card tem em maos.
    const numeroNF = String(req.query.nf || '').trim();
    const tentativas = [];
    let r = null;

    if (numeroNF) {
      const rn = await buscarNFnoBlingPorNumero(numeroNF, data, { maxPaginas: 2 });
      tentativas.push({ via: 'numero', achou: !!(rn && rn.match),
        detalhe: (rn && rn.via) || null, notas_vistas: (rn && rn.totalScanned) || 0 });
      if (rn && rn.match) r = rn;
    }

    if (!r) {
      const rp = await buscarNFnoBlingPorOrderId(pedido, data, {
        maxPaginas: parseInt(req.query.paginas, 10) || 12,
      });
      tentativas.push({ via: 'pedido', achou: !!(rp && rp.match),
        detalhe: (rp && rp.via) || null, notas_vistas: (rp && rp.totalScanned) || 0 });
      if (rp && rp.match) r = rp;
      else if (!r) r = rp;   // guarda a varredura pro relatorio
    }

      return res.json({
        ok: true,
        pedido,
        data_referencia: data,
        achou: !!(r && r.match),
        nf: (r && r.match) ? {
          id: r.match.id, numero: r.match.numero,
          numeroPedidoLoja: r.match.numeroPedidoLoja,
          data: r.match.data, chave: r.match.chaveAcesso,
        } : null,
        // o que a varredura ALCANCOU — e daqui que sai o diagnostico
        varredura: {
          paginas_lidas: (r && r.pagina) || undefined,
          notas_vistas: (r && r.totalScanned) || 0,
          primeira_data: (r && r.primeiraDataVista) || null,
          ultima_data: (r && r.ultimaDataVista) || null,
          primeira_nf: (r && r.primeiraNumero) || null,
          ultima_nf: (r && r.ultimaNumero) || null,
          descartadas_mortas: (r && r.descartadas_mortas) || 0,
        },
        // b206: o que cada caminho fez — e por qual deles achou
        tentativas,
        erro: (r && !r.ok) ? (r.error || ('HTTP ' + r.status)) : undefined,
        leia: '⚠️ EMPRESA: esta rota usa a conta Bling da GOOD. Pedido da AMB tem que ir '
          + 'em /amb/api/debug/achar-nf — buscar na conta errada nunca acha. '
          + '· Passe ?nf=NUMERO pra testar o caminho que o card usa primeiro. '
          + '· `tentativas` mostra o que cada caminho fez.',
      });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 300) });
    }
  });

  // v4.70 - FORCAR a captura agora, sem esperar o ciclo.
  //
  // A captura roda presa ao preAquecerEspreita (a cada 3 min, e so grava de
  // hora em hora). Pra primeira carga e pra depurar, isso e lento demais —
  // o dono ficou esperando sem saber se algo estava travado ou so nao
  // tinha chegado a vez.
  //
  // Responde com o resultado da gravacao, nao so "disparei": e a diferenca
  // entre saber que funcionou e achar que funcionou.
  app.get('/api/debug/capturar-agora', (req, res, next) => {
    if (adminOk(req)) return next();
    return requerAdmin(req, res, next);
  }, async (req, res) => {
    try {
      if (!forcarCaptura) {
        return res.status(500).json({ ok: false, erro: 'a captura nao esta disponivel neste servidor' });
      }
      // b186: ?tiktok=500 pra carga historica; o padrao (200) cobre o dia a dia
      const r = await forcarCaptura(req.query.tiktok);

      // b185 (Codex): PULOU e diferente de RODOU SEM GRAVAR. Responder ok
      // nos dois casos faria o dono achar que capturou quando nem chegou a
      // tentar — foi por nao distinguir isso que ele ficou recarregando.
      if (r && r.rodou === false) {
        return res.status(409).json({
          ok: false,
          rodou: false,
          motivo: r.motivo,
          estado: capturaEstado ? capturaEstado() : null,
        });
      }

      // b185.3 (Codex): gravacao com ERRO nao e sucesso.
      //
      // A captura registra a falha no estado e segue (de proposito: uma
      // falha nao pode derrubar o ciclo). Mas ESTA rota existe pra dizer se
      // funcionou — responder ok:true com o erro escondido dentro de
      // `gravacao` e o mesmo silencio que a gente passou o dia matando.
      // b186 (Codex): a falha do TIKTOK tambem conta.
      //
      // Ela e registrada em `tiktok_erro` e nao em `erro`, de proposito: a
      // ponte pode cair sem derrubar a captura dos outros 3 marketplaces.
      // Mas eu so olhava `erro` — entao, com a ponte fora do ar, a rota
      // responderia ok:true e o dono acharia que o TikTok veio junto.
      // Justamente o marketplace que alimenta o painel de estornadas.
      const g = (r && r.gravacao) || null;
      const falhou = g && (g.erro || g.tiktok_erro);
      if (falhou) {
        return res.status(g.erro ? 500 : 207).json({
          ok: false,
          rodou: true,
          // 207 = os outros gravaram, so o TikTok falhou. Nao e o mesmo que
          // tudo ter quebrado, e a mensagem diz qual dos dois foi.
          parcial: !g.erro,
          erro: g.erro || ('TikTok nao veio: ' + g.tiktok_erro
            + ' (os outros marketplaces gravaram normalmente)'),
          gravacao: g,
          estado: capturaEstado ? capturaEstado() : null,
        });
      }

      // b186 (Codex): ZERO GRAVADAS com itens descartados nao e "vazio".
      //
      // Se a lista veio cheia mas nenhum registro tinha identificador, o
      // `sem_chave` conta os descartes e a gravacao "sucede" com zero. Dizer
      // "nao havia nada em transito" ali seria mentira — havia, e a gente
      // nao conseguiu identificar.
      if (g && !g.gravadas && g.sem_chave) {
        return res.status(500).json({
          ok: false,
          rodou: true,
          erro: 'nenhuma linha gravada: ' + g.sem_chave + ' registro(s) foram DESCARTADOS '
            + 'por nao ter identificador (nao e o mesmo que nao haver nada em transito)',
          gravacao: g,
          estado: capturaEstado ? capturaEstado() : null,
        });
      }

      return res.json({
        ok: true,
        rodou: true,
        gravacao: (r && r.gravacao) || null,
        estado: capturaEstado ? capturaEstado() : null,
        // b185 (Codex): o texto anterior estava ERRADO. O upsert conta TUDO
        // que enviou, inclusive o que ja existia igual — `gravadas` e
        // "linhas enviadas ao banco", nao "novidades".
        leia: 'Rodou agora, pulando o intervalo de 1h. `gravadas` e quantas linhas foram '
          + 'ENVIADAS ao banco (o upsert conta as regravadas tambem, nao so as novas). '
          + 'Zero com `sem_chave` tambem zero significa que nao havia nada em transito; '
          + 'zero COM sem_chave seria descarte por falta de identificador, e vira erro.',
      });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 300) });
    }
  });

  // v4.63 - ACOMPANHAR A CAPTURA das devolucoes.
  //
  // Diz quantas linhas ja foram guardadas, por marketplace, e quando foi a
  // ultima vez que o marketplace confirmou cada uma. Serve pra responder
  // "esta capturando?" sem abrir o Supabase.
  //
  // ?q=<codigo> procura uma devolucao pelos identificadores da etiqueta —
  // e o mesmo caminho que o bipe vai usar quando esta frente fechar.
  app.get('/api/debug/capturadas', (req, res, next) => {
    if (adminOk(req)) return next();
    return requerAdmin(req, res, next);
  }, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q) {
        const r = await devCapturadas.procurar(supabase, req.query.empresa || 'good', [q]);
        return res.status(r.ok ? 200 : 500).json(r);
      }
      const r = await devCapturadas.resumo(supabase, req.query.empresa || 'good');
      return res.status(r.ok ? 200 : 500).json({ ...r, estado: capturaEstado ? capturaEstado() : null });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 200) });
    }
  });

  // b342 - aceita ?k=ADMIN_KEY tambem, nao so o cookie de admin.
  //
  // As outras rotas de diagnostico deste arquivo ja aceitavam a chave; esta
  // ficou so no cookie. Na pratica isso obriga a estar logado NO PAINEL DA
  // GOOD — e o dono costuma estar logado no da AMB, que e outro login.
  // Resultado: "Acesso restrito a admin" sem explicacao do porque.
  app.get('/api/debug/tiktok-devolucoes', (req, res, next) => {
    if (adminOk(req)) return next();       // ?k=ADMIN_KEY
    return requerAdmin(req, res, next);    // ou cookie de admin, como antes
  }, async (req, res) => {
    try {
      const r = await tiktokPonte.sondaDevolucoes('good', req.query);
      res.status(r.ok ? 200 : 502).json(r);
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 200) });
    }
  });
};
