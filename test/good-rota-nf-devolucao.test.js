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
  let busca = async () => ({ ok: true, achou: false }), nomes = () => false;   // as deps sao lidas no registro: o teste troca o comportamento por aqui
  const q = { select() { return q; }, eq() { return q; }, in() { return q; }, neq() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; }, ilike() { return q; }, range() { return q; }, not() { return q; }, is() { return q; }, limit: async () => ({ data: [], error: null }), then: (r) => r({ data: [], error: null }) };
  const deps = { supabase: { from: () => q, storage: { from: () => ({}) } }, requerAdmin: (a, b, n) => n && n(), adminOk: () => true, sleep: async () => {}, chamarBling: async () => ({ ok: false }), chamarML: async () => ({ ok: false }),
    buscarNFnoML: async () => null, buscarNFePorId: async () => null, buscarNFBlindada: async () => null, resolverIdNFPorChave: async () => null, mapItensNF: () => [], listarDepositos: async () => ({ ok: true, depositos: [] }),
    buscarNfDevolucaoBling: async (o) => { pedido = o; return busca(o); }, nomesBatemNf: (a, b) => nomes(a, b), naturezaDevolucaoDaEmpresa: '5776118802,15110882187' };
  require(path.join(__dirname, '..', 'lib', 'rotas-admin-nf.js'))(app, deps);
  const camada = stack.find((l) => l.route.path === '/api/admin/nf-devolucao' && l.route.methods.get);
  ok(!!camada, '⚠️ a GOOD tem a rota /api/admin/nf-devolucao (era a unica que o painel unico chamava e faltava)');
  const out = await new Promise((resolve) => { const res = { _s: 200, status(s) { this._s = s; return this; }, json(o) { resolve({ s: this._s, o }); } }; camada.route.stack[camada.route.stack.length - 1].handle({ query: { cliente: 'Fulano', sku: 'X1', desde: '2026-09-01' } }, res); });
  ok(pedido && pedido.cliente === 'Fulano' && pedido.sku === 'X1', '  a rota chama a busca da lib unica com o cliente e o SKU');
  ok(pedido && pedido.naturezaId === '5776118802,15110882187', '⚠️ com a natureza de devolucao DA GOOD (da ficha), nao a da AMB');
  ok(out.s === 200 && out.o && out.o.ok === true, '  responde ok (' + JSON.stringify(out.o).slice(0, 60) + ')');
  const s = require('fs').readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok(/buscarNfDevolucaoBling: nfpDevolucaoRota\.acharNfDevolucaoBling,/.test(s) && /obterEmpresa\('good'\)/.test(s), '  server.js injeta a busca e a natureza da ficha da GOOD');
  ok(s.indexOf("'https://api.bling.com.br/Api/v3' + u") > -1, '⚠️ server.js prefixa a URL do Bling pra esta rota (o chamarBling da GOOD nao tem baseURL)');
  // Codex #441: busca que LANCA vira indeterminado (nao requisicao pendurada)
  const h = camada.route.stack[camada.route.stack.length - 1].handle;
  const chama = (query) => new Promise((resolve) => { const res = { status() { return this; }, json(o) { resolve(o); } }; h({ query }, res); });
  busca = async () => { throw new Error('timeout da fila'); };
  const o1 = await chama({ cliente: 'Fulano', sku: 'X1', desde: '2026-09-01' });
  ok(o1 && o1.ok === false && /Bling/.test(o1.motivo), '⚠️ timeout da fila do Bling responde ok:false (indeterminado)');
  // Codex #441: irma com SKU diferente so por acento e vista; lista que bate o teto de paginas = indeterminado
  let linhas = [{ id: 1, buyer_nome: 'Fulano', produto_sku: 'ABCA', nf_data_emissao: null }, { id: 2, buyer_nome: 'Fulano', produto_sku: 'ABCÁ', nf_data_emissao: null }];
  const q2 = { select() { return q2; }, eq() { return q2; }, is() { return q2; }, order() { return q2; }, range: async () => ({ data: linhas, error: null }), limit: async () => ({ data: [], error: null }) };
  deps.supabase.from = () => q2;
  busca = async () => ({ ok: true, achou: true, nf: { id: 9, dataEmissao: '2026-09-02' } });
  nomes = (a, b) => a === b;
  const o2 = await chama({ cliente: 'Fulano', sku: 'ABCA', devolucaoId: '1' });
  ok(o2 && o2.ok === false && /mais de uma devolucao/.test(o2.motivo), '⚠️ irma com SKU acentuado (ABCÁ x ABCA) e enxergada');
  linhas = Array.from({ length: 1000 }, (_, i) => ({ id: i + 10, buyer_nome: 'Outro', produto_sku: 'ZZ' }));
  const o3 = await chama({ cliente: 'Fulano', sku: 'ABCA', devolucaoId: '1' });
  ok(o3 && o3.ok === false && /registros demais/.test(o3.motivo), '⚠️ lista que bate o teto de paginas e indeterminado, mesmo sem irma visivel');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
