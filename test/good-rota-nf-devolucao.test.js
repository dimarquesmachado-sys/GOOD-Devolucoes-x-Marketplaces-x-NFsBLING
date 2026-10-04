'use strict';
// b534 — unificacao do painel: a GOOD tem a rota /api/admin/nf-devolucao que o painel unico chama.
// Roda a rota DE PRODUCAO (lib/rotas-admin-nf.js) com roteador e dependencias falsos.
const path = require('path');
process.env.NODE_TEST_SEM_TIMERS = '1';
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
(async () => {
  const stack = []; const reg = (m) => (p, ...f) => { stack.push({ route: { path: p, methods: { [m]: true }, stack: f.map((h) => ({ handle: h })) } }); };
  const app = { stack, get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete'), patch: reg('patch'), use() {} };
  let pedido = null;
  const q = { select() { return q; }, eq() { return q; }, in() { return q; }, neq() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; }, ilike() { return q; }, not() { return q; }, is() { return q; }, limit: async () => ({ data: [], error: null }), then: (r) => r({ data: [], error: null }) };
  const deps = { supabase: { from: () => q, storage: { from: () => ({}) } }, requerAdmin: (a, b, n) => n && n(), adminOk: () => true, sleep: async () => {}, chamarBling: async () => ({ ok: false }), chamarML: async () => ({ ok: false }),
    buscarNFnoML: async () => null, buscarNFePorId: async () => null, buscarNFBlindada: async () => null, resolverIdNFPorChave: async () => null, mapItensNF: () => [], listarDepositos: async () => ({ ok: true, depositos: [] }),
    buscarNfDevolucaoBling: async (o) => { pedido = o; return { ok: true, achou: false }; }, nomesBatemNf: () => false, naturezaDevolucaoDaEmpresa: '5776118802,15110882187' };
  require(path.join(__dirname, '..', 'lib', 'rotas-admin-nf.js'))(app, deps);
  const camada = stack.find((l) => l.route.path === '/api/admin/nf-devolucao' && l.route.methods.get);
  ok(!!camada, '⚠️ a GOOD tem a rota /api/admin/nf-devolucao (era a unica que o painel unico chamava e faltava)');
  const out = await new Promise((resolve) => { const res = { _s: 200, status(s) { this._s = s; return this; }, json(o) { resolve({ s: this._s, o }); } }; camada.route.stack[camada.route.stack.length - 1].handle({ query: { cliente: 'Fulano', sku: 'X1', desde: '2026-09-01' } }, res); });
  ok(pedido && pedido.cliente === 'Fulano' && pedido.sku === 'X1', '  a rota chama a busca da lib unica com o cliente e o SKU');
  ok(pedido && pedido.naturezaId === '5776118802,15110882187', '⚠️ com a natureza de devolucao DA GOOD (da ficha), nao a da AMB');
  ok(out.s === 200 && out.o && out.o.ok === true, '  responde ok (' + JSON.stringify(out.o).slice(0, 60) + ')');
  const s = require('fs').readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok(/buscarNfDevolucaoBling: nfp\.acharNfDevolucaoBling,/.test(s) && /obterEmpresa\('good'\)/.test(s), '  server.js injeta a busca e a natureza da ficha da GOOD');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
