'use strict';   // o bloco rodava DENTRO de criarAppEmpresa, que e modo estrito — aqui tambem
// amb-devolucoes/lib-AMB/diagnostico-AMB.js — peca da FABRICA (docs/MODULARIZACAO.md, fatia F2).
//
// MOVIDO de app-AMB.js em b686, SEM EDICAO: as rotas de diagnostico do admin —
//   /config, /ml/indice (+ /construir), /ml/rastreio, /ml/espreita, /porteiro, /nf/indice (+ /construir),
//   /shopee/chegada, /nf/nome, /nf/itens e /identificar.
// O bloco vivia dentro de criarAppEmpresa e usava 14 nomes da closure, TODOS `const` (ou funcao
// declarada) e nenhum reatribuido aqui (analise de escopo com acorn + eslint-scope): chegam por `deps`
// com o MESMO nome, entao o texto do bloco nao muda uma letra. Nada do que o bloco declara e usado fora.
// A fabrica chama este registrador NO MESMO PONTO em que o bloco estava (a ordem das rotas nao muda).
//
// ⚠️ QUEM EDITAR AQUI: este arquivo NAO enxerga mais a closure da fabrica. Nome novo que venha de la tem
// que entrar em DEPS e na chamada em app-AMB.js — test/fabrica-fonte-unica acusa; e a falta de um nome
// estoura no BOOT (a empresa aparece como `falhou` no /health), nao na requisicao.

const DEPS = ['cfg', 'BASE', 'bling', 'ml', 'mlReturns', 'nfNomes', 'tokens', 'shopee', 'emailAMB', 'NOME_EMPRESA', 'VERSAO', 'admin', 'TRIAGEM', 'redirectOAuth'];

module.exports = function registrarDiagnostico(router, deps) {
  for (const nome of DEPS) {
    if (!deps || deps[nome] === undefined) throw new Error('diagnostico-AMB: a fabrica nao passou a dependencia `' + nome + '`');
  }
  const { cfg, BASE, bling, ml, mlReturns, nfNomes, tokens, shopee, emailAMB, NOME_EMPRESA, VERSAO, admin, TRIAGEM, redirectOAuth } = deps;

// @secao diagnostico
router.get('/config', admin, (req, res) => {
  res.json({
    ok: true,
    versao: VERSAO,
    empresa: cfg.NOME_EMPRESA,
    url_base: cfg.urlBase(),
    redirect_oauth: redirectOAuth(),
    // ao vivo, nao a foto do boot
    conectado_agora: { bling: bling.temToken(), ml: ml.temToken(), ml_user: ml.userId() || null },
    configurado: cfg.statusConfig(),
    persistencia_token: tokens.diagnostico(),
    email: emailAMB.diagnostico(),
    tabelas_supabase: cfg.supabase.tabelas,
    oauth_pendentes: TRIAGEM.pendentes.size,
  });
});

// ── INDICE DE DEVOLUCOES DO ML ───────────────────────────────

/** Estado do indice. */
router.get('/ml/indice', admin, (req, res) => {
  res.json({ ok: true, versao: VERSAO, indice: mlReturns.statusIndice() });
});

/** Forca a reconstrucao. Responde na hora e monta em background. */
router.get('/ml/indice/construir', admin, (req, res) => {
  const st = mlReturns.statusIndice();
  if (st.construindo) {
    return res.json({ ok: true, ja_construindo: true, aviso: 'ja existe uma construcao em andamento' });
  }
  mlReturns.construirIndice().catch(e => console.error('[AMB] construcao falhou:', e.message));
  res.json({
    ok: true,
    iniciado: true,
    aviso: 'montando em background - pode levar alguns minutos',
    acompanhe: cfg.urlBase() + BASE + '/ml/indice?k=SUA_CHAVE',
  });
});

/**
 * O CORACAO DO BIPE: recebe o codigo dos Correios e diz de que
 * venda e a caixa. Aceita o codigo sujo (espaco, ponto, minuscula).
 */
router.get('/ml/rastreio', admin, async (req, res) => {
  const codigo = req.query.codigo;
  if (!codigo) {
    return res.status(400).json({ ok: false, erro: 'falta o codigo', uso: BASE + '/ml/rastreio?codigo=AD123456789BR&k=SUA_CHAVE' });
  }
  const achado = await mlReturns.acharPorTracking(String(codigo));
  if (!achado) {
    return res.json({
      ok: true, encontrado: false, codigo: String(codigo),
      indice: mlReturns.statusIndice(),
      dica: 'se o indice estiver frio ou a janela de dias for curta, o rastreio pode existir e nao estar no mapa',
    });
  }
  res.json({ ok: true, encontrado: true, devolucao: achado });
});

/** Base do painel "a espreita": o que esta vindo pro galpao. */
router.get('/ml/espreita', admin, (req, res) => {
  res.json({ ok: true, versao: VERSAO, espreita: mlReturns.resumoEspreita() });
});

// ── BUSCA POR NOME (pega-tudo: TikTok, Amazon, qualquer canal) ─

/** 09/10 (dono: 'descobre' quem consome a cota) - o estado do PORTEIRO central desta conta do Bling: quem pediu vez hoje
 *  (por servico), quantos 429 vieram com o porteiro folgado (consumo FORA dele) e os ultimos 429. So leitura. */
router.get('/porteiro', admin, async (req, res) => {
  try {
    const e = typeof bling.estadoPorteiro === 'function' ? await bling.estadoPorteiro() : { ok: false, erro: 'cliente do Bling sem porteiro' };
    res.json({ ok: true, versao: VERSAO, empresa: NOME_EMPRESA, porteiro: e });
  } catch (err) { res.status(500).json({ ok: false, erro: err.message }); }
});

/** Estado do indice de NFs por nome. */
router.get('/nf/indice', admin, (req, res) => {
  res.json({ ok: true, versao: VERSAO, indice: nfNomes.statusIndice() });
});

/** Forca a reconstrucao do indice de nomes. */
router.get('/nf/indice/construir', admin, (req, res) => {
  const st = nfNomes.statusIndice();
  if (st.construindo) {
    return res.json({ ok: true, ja_construindo: true });
  }
  nfNomes.construirIndice().catch(e => console.error('[AMB] indice de nomes falhou:', e.message));
  res.json({
    ok: true, iniciado: true,
    aviso: 'montando em background',
    acompanhe: cfg.urlBase() + BASE + '/nf/indice?k=SUA_CHAVE',
  });
});

/**
 * Busca a NF pelo nome do remetente. Aceita o nome colado como sai
 * na etiqueta ("IANDRAMATIASRIBEIRO") ou digitado com espaco.
 * SEMPRE devolve CANDIDATOS — a decisao e do estoquista.
 */
router.get('/shopee/chegada', admin, async (req, res) => {
  const sn = req.query.sn || req.query.order_sn;
  if (!sn) return res.status(400).json({ ok: false, uso: BASE + '/shopee/chegada?sn=ORDER_SN&k=SUA_CHAVE' });
  if (!shopee.cfg.ativo) {
    return res.json({ ok: false, erro: 'integracao Shopee desligada — faltam SHOPEE_PROXY_URL / SHOPEE_PROXY_KEY no servico' });
  }
  try {
    const r = await shopee.consultarChegada(String(sn));
    res.json({ ok: true, order_sn: String(sn), resultado: r });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

router.get('/nf/nome', admin, async (req, res) => {
  const q = req.query.q;
  if (!q) {
    return res.status(400).json({ ok: false, erro: 'falta o q', uso: BASE + '/nf/nome?q=NOMEDOCLIENTE&pagina=1&k=SUA_CHAVE' });
  }
  const r = await nfNomes.buscarPorNome(String(q), {
    pagina: req.query.pagina,
    porPagina: req.query.por_pagina,
  });
  res.json({
    ok: true,
    procurado: r.alvo,
    via: r.via,
    total_encontrados: r.total,
    mostrando: r.candidatos.length,
    pagina: r.pagina,
    tem_mais: r.tem_mais,
    proxima_pagina: r.tem_mais
      ? `${cfg.urlBase()}${BASE}/nf/nome?q=${encodeURIComponent(String(q))}&pagina=${r.pagina + 1}&k=SUA_CHAVE`
      : null,
    mesmo_cliente_repetido: r.muitos_iguais || false,
    dica_desempate: r.muitos_iguais
      // ⚠️ b368: TEXTO de ajuda, nao link — mas o caminho tem que ser o da
      // empresa, senao a Girassol leria uma instrucao pra usar a rota da AMB.
      ? `todas as NFs sao do mesmo nome - use ${BASE}/nf/itens?id=ID_DA_NF para ver os produtos de cada uma`
      : null,
    candidatos: r.candidatos,
    indice: nfNomes.statusIndice(),
  });
});

/**
 * ITENS DE UMA NF — o desempate.
 * Quando o mesmo cliente comprou varias vezes, o nome nao resolve.
 * Aqui o estoquista abre uma NF especifica e ve o que tem dentro.
 * E SOB DEMANDA de proposito: trazer os itens dos 8 candidatos
 * custaria 8 chamadas ao Bling (~6s) em toda busca, quase sempre
 * a toa. Uma chamada, quando ele clica, custa menos de 1s.
 */
router.get('/nf/itens', admin, async (req, res) => {
  const id = req.query.id;
  if (!id) {
    return res.status(400).json({ ok: false, erro: 'falta o id', uso: BASE + '/nf/itens?id=25994228847&k=SUA_CHAVE' });
  }
  const r = await bling.buscarNFePorId(String(id));
  if (!r.ok) return res.json({ ok: false, erro: r.error, status: r.status });

  const nfe = r.nfe || {};
  const itens = (nfe.itens || []).map(i => ({
    sku: i.codigo || null,
    descricao: i.descricao || null,
    quantidade: i.quantidade != null ? i.quantidade : null,
    valor_unit: i.valor != null ? i.valor : null,
  }));

  res.json({
    ok: true,
    nf: {
      id: String(nfe.id || id),
      numero: nfe.numero || null,
      serie: nfe.serie || null,
      chave: nfe.chaveAcesso || nfe.chave || null,
      data_emissao: nfe.dataEmissao || null,
      valor: nfe.valorNota != null ? nfe.valorNota : null,
      cliente: (nfe.contato && nfe.contato.nome) || null,
      numero_pedido_loja: nfe.numeroPedidoLoja || null,
    },
    itens,
    total_itens: itens.length,
  });
});

// ── IDENTIFICAR: a porta unica do bipe ───────────────────────
/**
 * Recebe qualquer coisa que o estoquista bipe ou digite e tenta
 * descobrir de que venda e. Ordem das tentativas:
 *   1. rastreio no indice do ML (Correios/Mercado Envios)
 *   2. nome do remetente
 * Quando nada bate, diz o que ja foi tentado — em vez de so
 * responder "nao achei", que nao ajuda ninguem no galpao.
 */
router.get('/identificar', admin, async (req, res) => {
  const codigo = String(req.query.codigo || '').trim();
  if (!codigo) {
    return res.status(400).json({ ok: false, erro: 'falta o codigo', uso: BASE + '/identificar?codigo=XXX&k=SUA_CHAVE' });
  }

  const tentativas = [];

  // 1) rastreio conhecido do ML
  const porTracking = await mlReturns.acharPorTracking(codigo);
  tentativas.push({ via: 'rastreio ML', achou: !!porTracking });
  if (porTracking) {
    return res.json({ ok: true, encontrado: true, via: 'rastreio ML', devolucao: porTracking, tentativas });
  }

  // 2) nome do remetente
  const porNome = await nfNomes.buscarPorNome(codigo, { pagina: req.query.pagina });
  tentativas.push({ via: 'nome do remetente', achou: porNome.total > 0, quantos: porNome.total });
  if (porNome.total > 0) {
    return res.json({
      ok: true, encontrado: true, via: 'nome do remetente',
      match: porNome.via,
      total_encontrados: porNome.total,
      mostrando: porNome.candidatos.length,
      pagina: porNome.pagina,
      tem_mais: porNome.tem_mais,
      mesmo_cliente_repetido: porNome.muitos_iguais || false,
      candidatos: porNome.candidatos,
      aviso: 'confira com a caixa antes de confirmar - sao candidatos, nao certeza',
      tentativas,
    });
  }

  res.json({
    ok: true, encontrado: false, codigo, tentativas,
    indices: { ml: mlReturns.statusIndice(), nomes: nfNomes.statusIndice() },
    dica: 'se for de canal sem integracao (TikTok, Amazon), tente o nome do remetente da etiqueta',
  });
});
// @fim-secao
};
module.exports.DEPS = DEPS;
