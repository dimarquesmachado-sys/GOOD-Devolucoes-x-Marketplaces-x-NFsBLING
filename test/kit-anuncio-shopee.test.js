'use strict';
// b597 — anuncio do pedido na SHOPEE, pelo servico da Shopee (/:loja/interno/anuncio-do-pedido).
const path = require('path'); const fs = require('fs');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
(async () => {
  const stack = []; const reg = (m) => (p, ...f) => stack.push({ m, p, h: f[f.length - 1] });
  const app = { get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete'), patch: reg('patch'), use() {} };
  const q = new Proxy({}, { get: (t, k) => (k === 'then' ? (r) => r({ data: [], error: null }) : () => q) });
  const urls = [];
  global.fetch = async (u, o) => { urls.push({ u, k: o && o.headers && o.headers['x-internal-key'] }); return { ok: true, status: 200, json: async () => ({ ok: true, sn: '260910KKS30YAK', itens: [{ titulo: 'Politriz Dupla Acao 1050W + Cabo + Kit Boinas', variacao: '110V', sku: 'KIT-POLI-110', preco: 547.9, qtd: 1 }] }) }; };
  process.env.NODE_TEST_SEM_TIMERS = '1';
  require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'))(app, { supabase: { from: () => q, storage: { from: () => ({}) } }, requerAdmin: (a, b, n) => n(), adminOk: () => true, sleep: async () => {}, chamarML: async () => ({ ok: false }), chamarBling: async () => ({ ok: false }), shopeeProxy: { url: 'https://shopee.falso/', loja: 'girassol', key: 'kint' }, tabelaDevolucoes: 'devolucoes' });
  const rota = stack.find((x) => x.p === '/api/admin/anuncio-do-pedido');
  const chamar = (query) => new Promise((res) => rota.h({ query }, { _s: 200, status(s) { this._s = s; return this; }, json(o) { res({ s: this._s, o }); } }));
  const r = await chamar({ mkt: 'shopee', pedido: '260910KKS30YAK' });
  ok(r.o.ok && r.o.titulo === 'Politriz Dupla Acao 1050W + Cabo + Kit Boinas — 110V' && r.o.sku === 'KIT-POLI-110', '⚠️ Shopee: titulo (com a variacao) e SKU do anuncio vem do servico da Shopee');
  ok(urls[0] && urls[0].u === 'https://shopee.falso/girassol/interno/anuncio-do-pedido?sn=260910KKS30YAK' && urls[0].k === 'kint', '  chama a loja DESTA empresa no servico, com a chave interna');
  const r5 = await chamar({ mkt: '', pedido: '260910KKS30YAK' });
  ok(r5.o.mkt === 'shopee', '  marketplace vazio + order_sn com letra = Shopee (o do ML, so digitos, nao cai aqui)');
  const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'); const A = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/shopeeProxy: \{ url: shopee\.cfg\.url, loja: shopee\.cfg\.loja,/.test(S) && /shopeeProxy: \{ url: shopee\.cfg\.url, loja: shopee\.cfg\.loja,/.test(A), '⚠️ GOOD e AMB/Girassol passam o servico da Shopee (url + loja dela)');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
