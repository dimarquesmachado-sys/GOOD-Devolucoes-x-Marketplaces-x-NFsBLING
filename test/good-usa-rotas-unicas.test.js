'use strict';
// b545 — unificacao das rotas de admin, passo 2: a GOOD registra a copia UNICA (rotas-admin-AMB.js) com a tabela,
// a coluna de data e o Bling dela. Roda a copia unica de producao com a configuracao da GOOD.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
const s = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
ok(/require\('\.\/amb-devolucoes\/lib-AMB\/rotas-admin-AMB\.js'\)\(app, Object\.assign\(\{\}, DEPS_ADMIN_NF, \{/.test(s), '⚠️ a GOOD registra a copia UNICA das rotas de admin');
ok(/tabelaDevolucoes: 'devolucoes',\n\s+colunaCriadoEm: 'created_at',/.test(s), '⚠️ com a tabela e a coluna de data DA GOOD');
ok(/chamarBling: \(u, \.\.\.resto\) => chamarBling\(\/\^https\?:\/i\.test\(String\(u\)\) \? u : 'https:\/\/api\.bling\.com\.br\/Api\/v3' \+ u, \.\.\.resto\),/.test(s), '⚠️ caminho relativo do Bling vira endereco inteiro (o cliente da GOOD exige)');
ok(!/^\s*registrarRotasAdminNF\(app/m.test(s) && !/require\('\.\/lib\/rotas-admin-nf'\)/.test(s), '  a copia antiga da GOOD nao e mais carregada');
ok(/require\('\.\/lib\/rotas-admin-good-extra'\)\(app, DEPS_ADMIN_NF\)/.test(s), '  as 2 rotas so da GOOD (imagem, depositos) seguem registradas');
// funcional: a copia unica com a configuracao da GOOD consulta a tabela/coluna da GOOD
(async () => {
  const usado = { tabelas: new Set(), colunas: new Set() };
  const q = new Proxy({}, { get: (t, k) => {
    if (k === 'then') return (r) => r({ data: [], error: null });
    if (k === 'gte' || k === 'order') return (col) => { usado.colunas.add(col); return q; };
    if (k === 'select') return (cols) => { String(cols).split(',').forEach((c) => /criado|created/.test(c) && usado.colunas.add(c.trim())); return q; };
    return () => q;
  } });
  const stack = []; const reg = (m) => (p, ...f) => stack.push({ m, p, h: f[f.length - 1] });
  const app = { get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete'), patch: reg('patch'), use() {} };
  const deps = { supabase: { from: (t) => { usado.tabelas.add(t); return q; }, storage: { from: () => ({}) } }, requerAdmin: (a, b, n) => n && n(), adminOk: () => true, sleep: async () => {},
    chamarBling: async () => ({ ok: false }), chamarML: async () => ({ ok: false }), buscarNFnoML: async () => null, buscarNFePorId: async () => null, buscarNFBlindada: async () => null,
    resolverIdNFPorChave: async () => null, mapItensNF: () => [], buscarNFsPorNumero: async () => ({ ok: true, notas: [] }), buscarNFnoBlingPorNumero: async () => null, listarDepositos: async () => ({ ok: true, depositos: [] }),
    buscarNfDevolucaoBling: async () => ({ ok: true, achou: true, nf: { id: 1, numero: '10', contato: { nome: 'Fulano' } } }), nomesBatemNf: () => true,
    naturezaDevolucaoDaEmpresa: '5776118802,15110882187', tabelaDevolucoes: 'devolucoes', colunaCriadoEm: 'created_at', NODE_TEST_SEM_TIMERS: true };
  process.env.NODE_TEST_SEM_TIMERS = '1';
  require(path.join(R, 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'))(app, deps);
  const r = stack.find((x) => x.p === '/api/admin/nf-devolucao' && x.m === 'get');
  await new Promise((res) => r.h({ query: { cliente: 'Fulano', sku: 'X', desde: '2026-09-01', devolucaoId: '5' } }, { status() { return this; }, json() { res(); } }));
  ok(usado.tabelas.has('devolucoes') && ![...usado.tabelas].some((t) => /amb|girassol/.test(t)), '⚠️ a copia unica consulta a tabela DA GOOD (' + [...usado.tabelas].join(',') + ')');
  ok(![...usado.colunas].includes('criado_em'), '⚠️ ... e nunca a coluna da AMB (criado_em) — usadas: ' + [...usado.colunas].join(','));
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
