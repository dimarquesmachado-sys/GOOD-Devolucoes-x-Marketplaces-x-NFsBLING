'use strict';
// b780 — pedido do dono (21/11, AMB): bipou a etiqueta de RETIRADA do Full e a lista "vem pelo RETIRO" trouxe 23
// pecas SO com o numero do pedido ("como sei agora qual e?!"), e sem data nenhuma. Ele pediu: "titulo, produto, sku,
// qtdade, data, se tiver nome cliente, pack id, order id, tracking — o que tiver coloca la". E perguntou se o numero da
// etiqueta (codigo de barras / Ref. ID) nao resolveria.
//
// Executa o modulo de PRODUCAO (amb-devolucoes/lib-AMB/ml-returns-AMB.js, a fabrica das 3 empresas) com um cliente ML
// falso e a peca lib/retiro-bipe.js (a linha da lista, usada pelas duas rotas /api/espreita/retiro):
//   1. a peca que o CD mandou pro vendedor sai com produto (titulo/SKU/qtd), cliente, apelido, NF, pack, rastreio,
//      datas (devolucao aberta, retirada reservada, saiu do CD) e a condicao em portugues ('saleable' → 'vendável');
//   2. os numeros das operacoes de RETIRADA ficam guardados; o codigo bipado que aparece ali (igualdade exata) marca a
//      peca — de qualquer operacao WITHDRAWAL_*; numero de OUTRA operacao (entrada no Full) nao casa; pedaco nao casa;
//   3. quando a linha do tempo nao vem, a lista diz POR QUE (anuncio respondeu 403 → motivo), em vez de sumir calada.
// ⚠️ O formato das operacoes do ML aqui e INVENTADO de proposito (external_references): ninguem mediu ainda onde o
// numero da etiqueta aparece — por isso o codigo procura em QUALQUER campo das operacoes de retirada, e a lista
// devolve os campos achados (a 1a etiqueta real mostra onde esta).
// Roda com: node test/retiro-lista-completa.test.js
const path = require('path');
const { itemDoRetiro, casaComEtiqueta, condicaoML } = require('../lib/retiro-bipe');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const PED_A = '2000018239001602', PED_B = '2000019243159482', PED_C = '2000019060853696';
const dia = (n) => new Date(Date.now() - n * 864e5).toISOString();
const chamadas = [];
const ml = {
  userId: () => '1',
  chamarML: async (url) => {
    chamadas.push(url);
    if (url.includes('/claims/search')) {
      if (!/status=closed/.test(url)) return { ok: true, data: { data: [] } };
      return { ok: true, data: { data: [
        { id: 71, resource: 'order', resource_id: PED_A, status: 'closed', stage: 'claim', date_created: dia(50) },
        { id: 72, resource: 'order', resource_id: PED_B, status: 'closed', stage: 'claim', date_created: dia(20) },
        { id: 73, resource: 'order', resource_id: PED_C, status: 'closed', stage: 'claim', date_created: dia(30) },
      ] } };
    }
    const mRet = /\/post-purchase\/v2\/claims\/(\d+)\/returns/.exec(url);
    if (mRet) {
      const k = { 71: ['551', PED_A, 'MLB111', 'TRKA1', 49], 72: ['552', PED_B, 'MLB222', 'TRKB2', 19], 73: ['553', PED_C, 'MLB333', 'TRKC3', 29] }[mRet[1]];
      return { ok: true, data: {
        id: k[0], date_created: dia(k[4]),
        orders: [{ order_id: k[1], item_id: k[2] }],
        shipments: [{ tracking_number: k[3], shipment_id: 500 + Number(mRet[1]), status: 'delivered', destination: { name: 'warehouse' } }],
      } };
    }
    if (/\/post-purchase\/v1\/returns\/55[123]\/reviews/.test(url)) {
      const a = url.includes('/551/');
      return { ok: true, data: { reviews: [{ resource_reviews: [{ product_destination: 'seller', product_condition: a ? 'saleable' : 'unsaleable', reason_id: 'damaged' }] }] } };
    }
    if (url.startsWith('/items/MLB111')) return { ok: true, data: { inventory_id: 'INVA', seller_id: 1 } };
    if (url.startsWith('/items/MLB222')) return { ok: false, status: 403, error: { blocked_by: 'PolicyAgent' } };
    if (url.startsWith('/items/MLB333')) return { ok: true, data: { inventory_id: 'INVC', seller_id: 1 } };
    if (url.startsWith('/stock/fulfillment/operations/search') && url.includes('inventory_id=INVC')) throw new Error('socket hang up');
    if (url.startsWith('/stock/fulfillment/operations/search') && url.includes('inventory_id=INVA')) {
      return { ok: true, data: { results: [
        { id: 900001, type: 'INBOUND_RECEPTION', date_created: dia(200), external_references: [{ type: 'inbound_id', value: '77777777' }] },
        { id: 900002, type: 'WITHDRAWAL_RESERVATION', date_created: dia(55 - 8), external_references: [{ type: 'withdrawal_id', value: '48126024340' }] },
        { id: 900003, type: 'WITHDRAWAL_DELIVERY', date_created: dia(55 - 13), detail: { shipment: 48133297953 } },
      ] } };
    }
    const mOrd = /^\/orders\/(\d+)$/.exec(url);
    if (mOrd) {
      const a = mOrd[1] === PED_A;
      return { ok: true, data: {
        buyer: { nickname: a ? 'JOAOSILVA77' : 'MARIAB', first_name: a ? 'Joao' : 'Maria', last_name: a ? 'Silva' : 'Borges' },
        total_amount: 199.9, pack_id: a ? 2000009999000001 : null, shipping: { id: a ? 41000000001 : 41000000002 },
        order_items: [{ item: { title: a ? 'Cavalete Automotivo 3 Toneladas Par' : 'Macaco Jacare 2T', seller_sku: a ? 'CAV-3T' : 'MAC-2T' }, quantity: a ? 2 : 1 }],
      } };
    }
    if (url.includes('/invoice_data')) {
      const a = url.includes('41000000001');
      return { ok: true, data: { fiscal_key: a ? '35261012345678000199550010000123451000123456' : '35261012345678000199550020000654321000654321' } };
    }
    return { ok: false, status: 404 };
  },
};

(async () => {
  // ── a peca pura ──
  ok(condicaoML('saleable') === 'vendável' && condicaoML('unsaleable') === 'inservível' && condicaoML('outra') === 'outra' && condicaoML(null) === null,
    '  condicao do ML em portugues; valor desconhecido sai como veio (nunca some)');

  // ── a fabrica de producao, com o ML falso ──
  const mod = require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'ml-returns-AMB.js'));
  const r = mod.criar({ clienteMl: ml, ml: { janelaDias: 120 }, PREFIXO_ENV: 'AMB_' });
  await r.construirIndice();
  r.resumoEspreita();   // dispara a consulta da revisao do CD (fila, uma por vez, com pausa)
  let lista = [];
  for (let t = 0; t < 40; t++) {
    await new Promise((ok2) => setTimeout(ok2, 250));
    const base = r.resumoEspreita() || {};
    lista = (base.em_transito || []).filter((x) => x && x.vem_pelo_retiro);
    const prontas = lista.filter((x) => x.retiro && x.retiro.linha_do_tempo && (x.itens || []).length);
    if (prontas.length === 3) break;
  }
  ok(lista.length === 3, '  as 3 pecas que o CD mandou pro vendedor estao no retiro (' + lista.length + ')');
  const A = itemDoRetiro(lista.find((x) => String(x.pedido) === PED_A) || {}, '48133297953');
  const B = itemDoRetiro(lista.find((x) => String(x.pedido) === PED_B) || {}, '48133297953');
  console.log('     linha A: ' + JSON.stringify(A).slice(0, 600));

  // 1. tudo que o sistema tem do pedido
  ok(A.produtos.length === 1 && A.produtos[0].titulo === 'Cavalete Automotivo 3 Toneladas Par' && A.produtos[0].sku === 'CAV-3T' && A.produtos[0].qtd === 2,
    '⚠️ produto: titulo, SKU e quantidade');
  ok(A.cliente === 'Joao Silva' && A.apelido === 'JOAOSILVA77', '⚠️ cliente e apelido do ML');
  ok(A.nf_numero === '12345' && A.nf_serie === '1', '  NF da venda (numero e serie da chave)');
  ok(String(A.pack_id) === '2000009999000001' && String(A.pedido) === PED_A && A.tracking === 'TRKA1', '  pedido, pack e rastreio');
  ok(!!A.devolucao_em && !!A.reservada_em && !!A.saiu_cd_em, '⚠️ datas: devolucao aberta, retirada reservada e saiu do CD');
  ok(A.condicao === 'vendável' && A.embalagem_danificada === true, '  condicao do ML em portugues ("saleable" aparecia cru na tela)');
  ok(A.linha_do_tempo && A.linha_do_tempo.anuncio_http === 200 && A.linha_do_tempo.operacoes_http === 200 && A.linha_do_tempo.operacoes === 3,
    '  linha do tempo: anuncio e operacoes responderam (3 operacoes)');

  // 2. o numero da etiqueta
  ok(!!A.casa_etiqueta && /WITHDRAWAL_DELIVERY/.test(A.casa_etiqueta), '⚠️ o codigo de barras bipado aparece na retirada do pedido A → marcado (' + A.casa_etiqueta + ')');
  ok(!!casaComEtiqueta(A, '48126024340'), '⚠️ o Ref. ID tambem casa (outra operacao de retirada, outro campo)');
  ok(!casaComEtiqueta(A, '77777777'), '  numero de OUTRA operacao (entrada no Full) NAO casa');
  ok(!casaComEtiqueta(A, '4813329795') && !casaComEtiqueta(A, '481332979530') && !!casaComEtiqueta(A, ' 48133297953 '), '  pedaco ou numero maior NAO casa (so igualdade exata); espaco em volta e ignorado');
  ok(casaComEtiqueta(A, PED_A) === 'pedido', '  digitar o numero do pedido tambem marca');
  ok(B.casa_etiqueta === null, '  a outra peca nao e marcada');

  // 3. sem linha do tempo, a lista diz por que
  ok(B.linha_do_tempo && B.linha_do_tempo.anuncio_http === 403 && /falta a permissao "Publicação e sincronização"/.test(B.linha_do_tempo.motivo || ''),
    '⚠️ anuncio negado pelo PolicyAgent (403) → a lista diz qual permissao falta, em vez de ficar sem data calada (' + JSON.stringify(B.linha_do_tempo) + ')');
  ok(B.condicao === 'inservível' && B.produtos[0] && B.produtos[0].sku === 'MAC-2T' && !B.saiu_cd_em, '  e o resto da linha vem igual (produto, condicao), so sem as datas do CD');
  ok(!chamadas.some((u) => u.startsWith('/stock/fulfillment/operations/search') && u.includes('INVB')), '  sem inventory, nao consulta operacoes');
  const C = itemDoRetiro(lista.find((x) => String(x.pedido) === PED_C) || {}, '48133297953');
  ok(C.pedido === PED_C && C.linha_do_tempo && /^erro: socket hang up/.test(C.linha_do_tempo.motivo || '') && C.casa_etiqueta === null,
    '⚠️ a consulta das operacoes ESTOURA → a peca continua no retiro, com o motivo, sem casar nada (' + JSON.stringify(C.linha_do_tempo) + ')');

  console.log('');
  console.log(falhas === 0 ? '=== todos passaram' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
