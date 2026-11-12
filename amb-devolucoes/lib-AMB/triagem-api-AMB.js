'use strict';   // o bloco rodava DENTRO de criarAppEmpresa, que e modo estrito — aqui tambem
// amb-devolucoes/lib-AMB/triagem-api-AMB.js — peca da FABRICA (docs/MODULARIZACAO.md, fatia F2).
//
// MOVIDO de app-AMB.js em b686, SEM EDICAO: a API de triagem da tela de bipe —
//   GET /api/triagem/identificar, POST /api/triagem/registrar, GET /api/nf/itens,
//   GET /api/triagem/status/:identificador, GET /api/triagem/recentes, GET /db/teste e GET /api/triagem/fila.
// O bloco vivia dentro de criarAppEmpresa e usava 14 nomes da closure, TODOS `const` (ou funcao
// declarada) e nenhum reatribuido aqui (analise de escopo com acorn + eslint-scope): chegam por `deps`
// com o MESMO nome, entao o texto do bloco nao muda uma letra. Nada do que o bloco declara e usado fora.
// A fabrica chama este registrador NO MESMO PONTO em que o bloco estava (a ordem das rotas nao muda).
//
// ⚠️ QUEM EDITAR AQUI: este arquivo NAO enxerga mais a closure da fabrica. Nome novo que venha de la tem
// que entrar em DEPS e na chamada em app-AMB.js — test/fabrica-fonte-unica acusa; e a falta de um nome
// estoura no BOOT (a empresa aparece como `falhou` no /health), nao na requisicao.

const DEPS = ['auth', 'bling', 'mlReturns', 'nfNomes', 'marcadores', 'db', 'mkt', 'shopee', 'mlMotivo', 'emailAMB', 'nfEntrada', 'VERSAO', 'admin', 'linksReclamacao'];

module.exports = function registrarTriagemApi(router, deps) {
  for (const nome of DEPS) {
    if (!deps || deps[nome] === undefined) throw new Error('triagem-api-AMB: a fabrica nao passou a dependencia `' + nome + '`');
  }
  const { auth, bling, mlReturns, nfNomes, marcadores, db, mkt, shopee, mlMotivo, emailAMB, nfEntrada, VERSAO, admin, linksReclamacao } = deps;

// @secao triagem-api
/** Bipa/digita e descobre o que e. Versao logada do /identificar. */
router.get('/api/triagem/identificar', auth.requerLogin, async (req, res) => {
  const codigo = String(req.query.codigo || '').trim();
  if (!codigo) return res.status(400).json({ ok: false, erro: 'falta o codigo' });

  const tentativas = [];
  let achado = null, via = null, candidatos = null, extras = {};

  const porTracking = await mlReturns.acharPorTracking(codigo);
  tentativas.push({ via: 'rastreio ML', achou: !!porTracking });
  if (porTracking) { achado = porTracking; via = 'rastreio ML'; }

  // SHOPEE: tracking SPX (BR...), return_sn ou order_sn
  let devShopee = null;
  if (!achado && shopee.cfg.ativo) {
    try {
      const infoS = await shopee.acharDevolucao(codigo);
      tentativas.push({ via: 'devolucao Shopee', achou: !!infoS.hit, na_lista: infoS.qtd });
      if (infoS.hit) { devShopee = infoS.hit; via = 'devolucao Shopee'; }
    } catch (e) {
      tentativas.push({ via: 'devolucao Shopee', achou: false, erro: e.message });
    }
  }

  if (!achado && !devShopee) {
    const porNome = await nfNomes.buscarPorNome(codigo, { pagina: req.query.pagina });
    // b301 (auditoria da b268.1, P1) - o indice pode estar parcial (construcao
    // fria em andamento); sem isto, 'nao achei' e 'o indice ainda nao
    // chegou nessa pagina' ficavam indistinguiveis pra quem consome esta API.
    tentativas.push({ via: 'nome do remetente', achou: porNome.total > 0, quantos: porNome.total, indice_incompleto: porNome.parcial_ate_pagina != null });
    if (porNome.total > 0) {
      via = 'nome do remetente';
      candidatos = porNome.candidatos;
      extras = {
        match: porNome.via,
        total_encontrados: porNome.total,
        pagina: porNome.pagina,
        tem_mais: porNome.tem_mais,
        mesmo_cliente_repetido: porNome.muitos_iguais || false,
        busca_generica: porNome.generica || false,
        aviso_generico: porNome.generica
          ? 'muitos resultados - digite o nome COMPLETO do remetente que esta na etiqueta'
          : null,
      };
    }
  }

  // Duas checagens que evitam erro no galpao:
  //  - ja triaram esta caixa antes?
  //  - existe recado preso a este pedido?
  const chaves = {
    orderId: (achado && achado.order_id) || null,
    tracking: (achado && achado.tracking) || codigo,
  };
  // b212 - TODOS os numeros que essa mesma devolucao atende: o recado pode
  // ter sido preso a qualquer um deles (ele criou pelo numero da venda e
  // bipou pelo pack id — eram chaves diferentes e o aviso nunca chegou).
  const idsDoRecado = [
    codigo,
    achado && achado.order_id,
    achado && achado.pack_id,
    achado && achado.tracking,
    achado && achado.shipment_id,
    achado && achado.nf_numero,
    achado && achado.chave,
    devShopee && devShopee.order_sn,
    devShopee && devShopee.return_sn,
    devShopee && devShopee.tracking_number,
  ];
  const [dup, rec] = await Promise.all([
    db.jaTriado(chaves),
    db.recadoDeQualquer(idsDoRecado),
  ]);

  // Origem da venda descoberta sozinha, sem o estoquista escolher.
  const origem = achado
    ? mkt.detectar(null, { temClaimML: true, tracking: achado.tracking })
    : (devShopee ? { marketplace: 'shopee', confianca: 'alta' }
                 : { marketplace: 'desconhecido', confianca: 'nenhuma' });

  // MOTIVO (so no hit do ML: e de la que temos claim + pedido)
  let motivo = null;
  if (achado && achado.order_id) {
    motivo = await mlMotivo.motivoDaDevolucao({ orderId: achado.order_id, claimId: achado.claim_id });
  }

  // NF de devolucao ja emitida?
  const nfDev = nfEntrada.jaEmitida({
    pedido: (achado && achado.order_id) || (devShopee && devShopee.order_sn) || null,
    nome: null,
  });

  const reclamacao = linksReclamacao(origem.marketplace, {
    order_id: achado && achado.order_id,
    pack_id: motivo && motivo.pack_id,
    return_sn: devShopee && devShopee.return_sn,
    pedido: devShopee && devShopee.order_sn,
  });

  res.json({
    ok: true,
    encontrado: !!(achado || devShopee || candidatos),
    via,
    marketplace: origem.marketplace,
    marketplace_nome: mkt.nomeBonito(origem.marketplace),
    motivo_devolucao: motivo,
    reclamacao,
    nf_devolucao: nfDev,
    devolucao_shopee: devShopee ? {
      pedido: devShopee.order_sn || null,
      return_sn: devShopee.return_sn || null,
      tracking: devShopee.tracking_number || null,
      status: [devShopee.status, devShopee.logistics_status || devShopee.logistic_status].filter(Boolean).join(' / ') || null,
    } : null,
    devolucao: achado,
    candidatos,
    ...extras,
    ja_triado: dup.ok ? dup.triado : null,
    triagem_anterior: dup.ok ? dup.registro : null,
    recado: rec.ok ? rec.recado : null,
    tentativas,
    usuario: req.usuario,
  });
});

/** Grava a triagem. */
router.post('/api/triagem/registrar', auth.requerLogin, async (req, res) => {
  const d = req.body || {};
  if (!d.order_id && !d.tracking && !d.nf_numero) {
    return res.status(400).json({ ok: false, erro: 'informe ao menos order_id, tracking ou nf_numero' });
  }
  const r = await db.registrarTriagem({ ...d, funcionario: req.usuario });
  if (!r.ok) return res.status(200).json({ ok: false, erro: r.erro });

  // PROBLEMA: avisa o Diego por e-mail (fire and forget) e ja
  // responde se ha outras unidades do mesmo SKU em defeito — a
  // tela usa isso pro alerta de canibalizacao.
  let canibalizacao = null;
  if (d.status === 'problema') {
    emailAMB.avisarProblema({ ...d, funcionario: req.usuario });
    if (d.produto_sku) {
      const outras = await db.defeitosDoSku(d.produto_sku);
      if (outras.ok && outras.unidades.length > 1) {
        canibalizacao = {
          outras_unidades: outras.unidades.length - 1,
          locais: [...new Set(outras.unidades.map(u => u.localizacao).filter(Boolean))].slice(0, 4),
        };
      }
    }
  }
  res.json({ ok: true, registro: r.registro, email_enviado: d.status === 'problema' && emailAMB.ligado(), canibalizacao });
});

/** Itens de uma NF, para o estoquista logado desempatar. */
router.get('/api/nf/itens', auth.requerLogin, async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ ok: false, erro: 'falta o id' });
  const r = await bling.buscarNFePorId(String(id));
  if (!r.ok) return res.json({ ok: false, erro: r.error });
  const nfe = r.nfe || {};
  const origem = mkt.detectar(nfe.numeroPedidoLoja, {});
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
    marketplace: origem.marketplace,
    marketplace_nome: mkt.nomeBonito(origem.marketplace),
    marketplace_confianca: origem.confianca,
    itens: (nfe.itens || []).map(i => ({
      sku: i.codigo || null,
      descricao: i.descricao || null,
      quantidade: i.quantidade != null ? i.quantidade : null,
      valor_unit: i.valor != null ? i.valor : null,
    })),
  });
});

/** Ultimas triagens. */
// b165 - PRE-TRAVA DO BIPE: "este pacote ja foi triado".
//
// O front da AMB ja chamava esta rota (foi copiado da GOOD) — mas ela NAO
// existia aqui. Dava 404, o catch do JavaScript engolia, e a tela mostrava
// os botoes como se o pacote fosse novo. Em 29/08 o mesmo pacote foi triado
// duas vezes na AMB sem aviso nenhum.
//
// Mesmo contrato da GOOD: { ok, registros: [...] }, aceitando um segundo
// identificador em ?tambem= (a mesma devolucao pode ter sido gravada pelo
// shipment num bipe e pela chave da NF noutro).
router.get('/api/triagem/status/:identificador', auth.requerLogin, async (req, res) => {
  const ident = String(req.params.identificador || '').trim();
  if (!ident) return res.status(400).json({ ok: false, erro: 'identificador obrigatorio' });

  // b166.1 - aceita VARIOS ?tambem=, porque o mesmo pacote pode ter sido
  // gravado por portas diferentes (shipment num bipe, numero da NF noutro,
  // rastreio dos Correios num terceiro). Express entrega repetidos como
  // array; um valor so vem como string.
  const brutos = req.query.tambem;
  const lista = Array.isArray(brutos) ? brutos : (brutos ? [brutos] : []);
  const ids = [ident];
  for (const t of lista) {
    const v = String(t || '').trim();
    if (v && !ids.includes(v)) ids.push(v);
  }

  const r = await db.triagensDe(ids);
  if (!r.ok) return res.status(500).json({ ok: false, erro: r.erro });
  return res.json({ ok: true, registros: r.registros, ids_buscados: ids });
});

router.get('/api/triagem/recentes', auth.requerLogin, async (req, res) => {
  res.json(await db.listarRecentes(req.query.limite));
});

/** Saude do banco (admin). */
router.get('/db/teste', admin, async (req, res) => {
  res.json({ ok: true, versao: VERSAO, supabase: await db.testeDeVida(), tabelas: db.tabelas });
});

// ── FILAS DA TRIAGEM (Aprovadas x Problemas, como na GOOD) ───
router.get('/api/triagem/fila', auth.requerLogin, async (req, res) => {
  const status = req.query.status === 'problema' ? 'problema' : 'aprovado';
  const r = await db.listarFila({ status });
  // b200.1 (Codex): o campo e `registros` — `listarFila` devolve
  // { ok, total, registros }. Eu enriquecia `itens` e `data`, que nao
  // existem, entao a decodificacao nao chegava em NADA na AMB.
  //
  // Conferido na fonte antes de escrever desta vez.
  if (r && Array.isArray(r.registros)) r.registros = marcadores.enriquecer(r.registros);
  if (!r.ok) return res.json(r);
  // junta o link da NF DA VENDA no Bling (id vem do indice de nomes)
  const registros = (r.registros || []).map(x => {
    const venda = nfNomes.acharPorPedido(x.order_id) || nfNomes.acharPorNumero(x.nf_numero);
    return {
      ...x,
      nf_id_bling: (venda && venda.id) || null,
      link_nf_bling: venda && venda.id
        ? `https://www.bling.com.br/notas.fiscais.php#edit/${venda.id}` : null,
    };
  });
  res.json({ ok: true, status, total: registros.length, registros });
});
// @fim-secao
};
module.exports.DEPS = DEPS;
