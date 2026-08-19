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
};
