'use strict';
// b598 — anuncio do pedido no TIKTOK (formato real conferido no pedido 586485718877832225 da Girassol).
const path = require('path'); const fs = require('fs');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
(async () => {
  const stack = []; const reg = (m) => (p, ...f) => stack.push({ m, p, h: f[f.length - 1] });
  const app = { get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete'), patch: reg('patch'), use() {} };
  const q = new Proxy({}, { get: (t, k) => (k === 'then' ? (r) => r({ data: [], error: null }) : () => q) });
  const chamadas = [];
  const li = (sku, nome, varia, preco) => ({ product_name: nome, sku_name: varia, seller_sku: sku, sale_price: preco });
  const tiktokPonte = { chamarMoverPedidos: async (cam, params) => { chamadas.push({ cam, params }); return { ok: true, http: 200, corpo: { ok: true, resposta_crua: { code: 0, data: { orders: [{ id: params.ids, line_items: [li('KP18', 'Kit 11 Peças 5 Pol. 125mm Disco Espuma Boina Lã Prato Pino M14 Polimento Automotivo KP18', 'Padrão', '42.9'), li('POLI-110', 'Politriz 1050W', '110V', '471.3'), li('POLI-110', 'Politriz 1050W', '110V', '471.3')] }] } } } }; } };
  process.env.NODE_TEST_SEM_TIMERS = '1';
  require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'))(app, { supabase: { from: () => q, storage: { from: () => ({}) } }, requerAdmin: (a, b, n) => n(), adminOk: () => true, sleep: async () => {}, chamarML: async () => ({ ok: false }), chamarBling: async () => ({ ok: false }), tiktokPonte, tiktokLoja: 'girassol', tabelaDevolucoes: 'devolucoes' });
  const rota = stack.find((x) => x.p === '/api/admin/anuncio-do-pedido');
  const chamar = (query) => new Promise((res) => rota.h({ query }, { _s: 200, status(s) { this._s = s; return this; }, json(o) { res({ s: this._s, o }); } }));
  const r = await chamar({ mkt: 'tiktok', pedido: '586485718877832225' });
  ok(r.o.ok && r.o.titulo === 'Kit 11 Peças 5 Pol. 125mm Disco Espuma Boina Lã Prato Pino M14 Polimento Automotivo KP18' && r.o.sku === 'KP18', '⚠️ TikTok: titulo e SKU do anuncio vem de line_items (pedido real da Girassol; "Padrão" nao vira variacao)');
  ok(r.o.itens[1].titulo === 'Politriz 1050W — 110V' && r.o.itens[1].qtd === 2 && r.o.itens[1].preco === 471.3, '  uma linha por unidade vira item com quantidade; variacao entra no titulo; preco numerico');
  ok(chamadas[0].cam === '/tiktok/sonda' && chamadas[0].params.loja === 'girassol' && chamadas[0].params.caminho === '/order/202309/orders' && chamadas[0].params.ids === '586485718877832225', '  pede o detalhe do pedido na loja DESTA empresa pela ponte do Mover-Pedidos');
  const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'); const A = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/tiktokPonte, tiktokLoja: tiktokPonte\.lojaDaEmpresa\('good'\)/.test(S) && /tiktokPonte, tiktokLoja: tiktokPonte\.lojaDaEmpresa\(CFG_EMPRESA\.CHAVE_REGISTRO/.test(A), '⚠️ GOOD e AMB/Girassol passam a ponte do TikTok com a loja delas');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
