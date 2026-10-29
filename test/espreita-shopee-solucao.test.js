'use strict';
// 29/10 — espreita da Shopee com a SOLUCAO, os PRAZOS e o TRANSPORTE que o shopee-sync #30 passou a mandar.
// Dados reais da Girassol (consultados em 29/10). Roda a fabrica de producao (Girassol/AMB) e a copia da GOOD.
process.env.SHOPEE_PROXY_URL = 'http://proxy.teste';
process.env.SHOPEE_PROXY_KEY = 'chave-teste';
process.env.GIRASSOL_SHOPEE_LOJA = 'girassol';
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const agora = Math.floor(Date.now() / 1000);
const LISTA = [
  // so reembolso (2607040QR2JAYU9): nada volta
  { return_sn: '2607040QR2JAYU9', order_sn: '260703NCR4719V', status: 'ACCEPTED', reason: 'ITEM_MISSING', tracking_number: null,
    create_time: agora - 117 * 86400, update_time: agora - 113 * 86400, return_solution: 1, needs_logistics: true, return_ship_due_date: null,
    logistics_status: null, reverse_logistics_status: 'LOGISTICS_NOT_STARTED', itens: [] },
  // entregue (2608180NVV0BBKA)
  { return_sn: '2608180NVV0BBKA', order_sn: '260813898DFEWW', status: 'ACCEPTED', reason: 'CHANGE_MIND', tracking_number: 'BR260236192139R',
    create_time: agora - 72 * 86400, update_time: agora - 61 * 86400, return_solution: 0, return_ship_due_date: agora - 65 * 86400,
    logistics_status: 'LOGISTICS_DELIVERY_DONE', reverse_logistics_status: 'LOGISTICS_DELIVERY_DONE', itens: [] },
  // nunca postada: com retorno, sem rastreio, transporte nao iniciado, prazo vencido ha 10 dias
  { return_sn: 'NP1', order_sn: 'PEDNP1', status: 'ACCEPTED', reason: 'CHANGE_MIND', tracking_number: null,
    create_time: agora - 20 * 86400, update_time: agora - 20 * 86400, return_solution: 0, return_ship_due_date: agora - 10 * 86400,
    logistics_status: null, reverse_logistics_status: 'LOGISTICS_NOT_STARTED', itens: [] },
  // em transito de verdade: postada, andando
  { return_sn: 'T1', order_sn: 'PEDT1', status: 'ACCEPTED', reason: 'CHANGE_MIND', tracking_number: 'BR999',
    create_time: agora - 6 * 86400, update_time: agora - 2 * 86400, return_solution: 0, return_ship_due_date: agora + 2 * 86400,
    logistics_status: 'LOGISTICS_PICKUP_DONE', reverse_logistics_status: 'LOGISTICS_PICKUP_DONE', itens: [] },
  // shopee-sync ANTIGO (sem os campos): continua em transito — nao adivinha
  { return_sn: 'V1', order_sn: 'PEDV1', status: 'ACCEPTED', reason: 'CHANGE_MIND', tracking_number: null, create_time: agora - 50 * 86400, itens: [] },
];
const fetchOrig = global.fetch;
global.fetch = async (url) => ({ ok: true, status: 200, json: async () => (/interno\/devolucoes/.test(String(url)) ? { ok: true, devolucoes: LISTA } : { ok: true }) });
(async () => {
  const fab = require('../amb-devolucoes/lib-AMB/shopee-AMB').criar({ PREFIXO_ENV: 'GIRASSOL_' });
  const r = await fab.resumoEspreita();
  const emT = (r.em_transito_todas || r.em_transito).map((x) => x.return_sn);
  ok(!emT.includes('2607040QR2JAYU9') && r.so_reembolso === 1, '⚠️ fabrica: SO REEMBOLSO sai de em transito (o comprador fica com o produto)');
  ok(!emT.includes('NP1') && r.nunca_postadas === 1, '⚠️ fabrica: NUNCA POSTADA (prazo vencido, sem rastreio, transporte nao iniciado) sai de em transito');
  ok((r.entregues || []).some((x) => x.pedido === '260813898DFEWW'), '⚠️ fabrica: ENTREGUE vai pro bloco "chegou na sua matriz"');
  ok(emT.includes('T1') && emT.includes('V1'), '  fabrica: postada andando e devolucao sem os campos novos continuam em transito (nao adivinha)');
  delete require.cache[require.resolve('../lib/shopee-proxy')];
  const good = require('../lib/shopee-proxy');
  const g = await good.resumoEspreita();
  const emG = (g.em_transito_todas || g.em_transito).map((x) => x.pedido);
  ok((g.entregues || []).some((x) => x.pedido === '260813898DFEWW') && !emG.includes('260813898DFEWW'), '⚠️ GOOD: ENTREGUE vai pro bloco de entregues (antes era descartada como "encerrada")');
  ok(!emG.includes('260703NCR4719V') && !emG.includes('PEDNP1') && g.so_reembolso === 1 && g.nunca_postadas === 1, '⚠️ GOOD: a mesma regra de so reembolso / nunca postada');
  ok(emG.includes('PEDT1') && emG.includes('PEDV1'), '  GOOD: em transito de verdade continua');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  ok(/\.\.\.\(\(shopeeR && shopeeR\.entregues\) \|\| \[\]\)/.test(src), '  GOOD: a espreita junta as entregues da Shopee ao alerta');
  global.fetch = fetchOrig;
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
