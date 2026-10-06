'use strict';
// b553 — unificacao do ciclo de defeitos: a GOOD registra a copia UNICA (defeitos-ciclo-AMB.js) com o adaptador
// dela. Roda a copia unica de producao com as tabelas da GOOD e confere que nenhuma tabela com sufixo e usada.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
const s = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
ok(/require\('\.\/amb-devolucoes\/lib-AMB\/defeitos-ciclo-AMB'\)\(app, \{/.test(s) && !/require\('\.\/lib\/defeitos-ciclo'\)/.test(s), '⚠️ a GOOD registra a copia UNICA do ciclo de defeitos (a antiga nao carrega)');
ok(/tabelas: \{ devolucoes: 'devolucoes', pecasRetiradas: 'pecas_retiradas' \}/.test(s) && /resolverSku: \(sku\) => skuDeparaGOOD\.resolverSku\(sku\)/.test(s), '  adaptador: tabelas da GOOD e o de-para de SKU da GOOD');
(async () => {
  const tabelas = new Set();
  const q = new Proxy({}, { get: (t, k) => (k === 'then' ? (r) => r({ data: [], error: null }) : () => q) });
  const supabase = { from: (t) => { tabelas.add(t); return q; } };
  const stack = []; const reg = (m) => (p, ...f) => stack.push({ m, p, h: f[f.length - 1] });
  const app = { get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete'), patch: reg('patch'), use() {} };
  require(path.join(R, 'amb-devolucoes', 'lib-AMB', 'defeitos-ciclo-AMB.js'))(app, {
    auth: { requerLogin: (a, b, n) => n(), validarSessao: () => ({ usuario: 'Diego', tipo: 'admin' }), tokenDaRequisicao: () => 't' },
    db: { tabelas: { devolucoes: 'devolucoes', pecasRetiradas: 'pecas_retiradas' }, conectar: () => supabase, atualizarTriagem: async () => ({ ok: true }), resolverSku: async (x) => ({ sku: x, trocado: false }), registrarPecaRetirada: async () => ({ ok: true }) },
    bling: { chamarBling: async () => ({ ok: false }) },
    cfg: { PREFIXO_ENV: 'GOOD_', supabase: { tabelas: { devolucoes: 'devolucoes' } }, fiscal: { depositoGeral: () => '4956031259' }, depositos: { geral: '4956031259' } },
  });
  ok(stack.length === 16, '  as 16 rotas do estoque de defeitos registradas (' + stack.length + ')');
  const chamar = (m, p, req) => new Promise((res) => { const r = stack.find((x) => x.m === m && x.p === p); r.h(Object.assign({ params: {}, query: {}, body: {}, usuario: 'Diego', cookies: {} }, req), { status() { return this; }, json(o) { res(o); }, send() { res(); } }); setTimeout(res, 1500); });
  await chamar('get', '/api/defeitos/lista', { query: { q: 'X' } });
  await chamar('post', '/api/defeitos/:id/excluir', { params: { id: '1' } });
  ok([...tabelas].every((t) => !/_amb$|_girassol$/.test(t)), '⚠️ nenhuma tabela com sufixo de outra empresa (' + [...tabelas].join(', ') + ')');
  ok(tabelas.has('devolucoes'), '  le a tabela de devolucoes da GOOD');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
