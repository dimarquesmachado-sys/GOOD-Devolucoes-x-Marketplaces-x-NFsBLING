'use strict';
// b595 — anuncio do pedido no MAGALU (formato real conferido no pedido 1575070106528392 da GOOD).
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
(async () => {
  const stack = []; const reg = (m) => (p, ...f) => stack.push({ m, p, h: f[f.length - 1] });
  const app = { get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete'), patch: reg('patch'), use() {} };
  const q = new Proxy({}, { get: (t, k) => (k === 'then' ? (r) => r({ data: [], error: null }) : () => q) });
  const caminhos = [];
  const chamarMagalu = async (c) => { caminhos.push(c); return { ok: true, status: 200, data: { code: '1575070106528392', deliveries: [{ items: [{ quantity: 1, unit_price: { currency: 'BRL', normalizer: 100, value: 52790 }, info: { sku: '9941779365', name: 'Luminária Chão Piso Arco Base Mármore Ajustável 170cm Tam. P 801s' } }] }] } }; };
  process.env.NODE_TEST_SEM_TIMERS = '1';
  require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'))(app, { supabase: { from: () => q, storage: { from: () => ({}) } }, requerAdmin: (a, b, n) => n(), adminOk: () => true, sleep: async () => {}, chamarML: async () => ({ ok: false }), chamarMagalu, chamarBling: async () => ({ ok: false }), tabelaDevolucoes: 'devolucoes' });
  const rota = stack.find((x) => x.p === '/api/admin/anuncio-do-pedido');
  const chamar = (query) => new Promise((res) => rota.h({ query }, { _s: 200, status(s) { this._s = s; return this; }, json(o) { res({ s: this._s, o }); } }));
  const r = await chamar({ mkt: 'magalu', pedido: '1575070106528392' });
  ok(r.o.ok && r.o.titulo === 'Luminária Chão Piso Arco Base Mármore Ajustável 170cm Tam. P 801s' && r.o.sku === '9941779365', '⚠️ Magalu: titulo e SKU do anuncio vem de deliveries[].items[].info (pedido real da GOOD)');
  ok(r.o.itens[0].preco === 527.9, '  preco do anuncio: unit_price.value / normalizer (52790 / 100 = 527,90)');
  ok(caminhos[0] === '/seller/v1/orders/1575070106528392', '  pede /seller/v1/orders/{codigo de 16 digitos}');
  const r2 = await chamar({ mkt: '', pedido: '1575070106528392' });
  ok(r2.o.mkt === 'magalu', '  marketplace vazio + 16 digitos (nao 20...) = Magalu');
  const fs = require('fs');
  ok(/chamarMagalu: magalu\.chamarMagalu,/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')) && /chamarMagalu: magalu\.chamarMagalu,/.test(fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8')), '⚠️ GOOD e AMB/Girassol passam o cliente do Magalu pras rotas de admin');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
