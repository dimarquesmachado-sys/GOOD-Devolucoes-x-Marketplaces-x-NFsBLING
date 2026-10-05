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
  // b546 (Codex #449) — modelo tipo/status, retrofit, sonda de ML, debug de NF, ids fiscais e adminOk, rodando de verdade
  const montar = async (extra, jaTem) => {
    const reg2 = []; const gravado = { insert: null, update: null, in: [] };
    const q2 = new Proxy({}, { get: (t, k) => {
      if (k === 'then') return (r) => r({ data: jaTem || [], error: null });
      if (k === 'single') return () => Promise.resolve({ data: { id: 9 }, error: null });
      if (k === 'insert') return (v) => { gravado.insert = v[0]; return q2; };
      if (k === 'update') return (v) => { gravado.update = v; return q2; };
      if (k === 'in') return (col, v) => { gravado.in.push(col); return q2; };
      return () => q2;
    } });
    const app2 = { get: (p, ...f) => reg2.push({ m: 'get', p, h: f[f.length - 1] }), post: (p, ...f) => reg2.push({ m: 'post', p, h: f[f.length - 1] }), put() {}, delete() {}, patch() {}, use() {} };
    const d2 = Object.assign({ supabase: { from: () => q2, storage: { from: () => ({}) } }, requerAdmin: (a, b, n) => n && n(), adminOk: () => true, sleep: async () => {},
      chamarBling: async () => ({ ok: false }), chamarML: async () => ({ ok: false }), buscarNFnoML: async () => null,
      buscarNFePorId: async () => ({ ok: true, data: { data: { id: 7, numero: '123', serie: '1', itens: [{ codigo: 'A', descricao: 'Peca', quantidade: 1 }], contato: { nome: 'Fulano' } } } }),
      buscarNFBlindada: async () => null, resolverIdNFPorChave: async () => null, mapItensNF: () => [],
      buscarNFsPorNumero: async () => ({ ok: true, notas: [] }), buscarNFnoBlingPorNumero: async () => ({ ok: true, match: { id: 7 } }),
      listarDepositos: async () => ({ ok: true, depositos: [] }), buscarNfDevolucaoBling: async () => { throw new Error('fila cheia'); }, nomesBatemNf: () => true,
      tabelaDevolucoes: 'devolucoes', colunaCriadoEm: 'created_at' }, extra);
    delete process.env.NODE_TEST_SEM_TIMERS; process.env.NODE_TEST_SEM_TIMERS = '1';
    require(path.join(R, 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'))(app2, d2);
    return { reg2, gravado, d2 };
  };
  const chamar = (reg2, p, req, m) => new Promise((res) => { const r = reg2.find((x) => x.p === p && (!m || x.m === m)); const out = { _s: 200, status(s) { this._s = s; return this; }, json(o) { res({ s: this._s, o }); }, send(o) { res({ s: this._s, o }); } }; r.h(Object.assign({ query: {}, params: {}, body: {}, usuario: 't' }, req), out); });
  const g = await montar({ triagemNoTipo: true, idsFiscaisHoje: { idEmpresaControl: '4956030980', idNaturezaOperacao: '5776118802' } }, []);
  await chamar(g.reg2, '/api/admin/lancar-por-nf', { body: { numeros: ['123'] } });
  ok(g.gravado.insert && g.gravado.insert.tipo === 'aprovado' && g.gravado.insert.status === 'pendente', '⚠️ GOOD: lancar-por-nf grava tipo aprovado + status pendente (modelo da GOOD)');
  const gj = await montar({ triagemNoTipo: true }, [{ id: 5, status: 'pendente' }]);
  const rj = await chamar(gj.reg2, '/api/admin/lancar-por-nf', { body: { numeros: ['123'] } });
  ok(gj.gravado.update === null && rj.o.resultados[0].ok === false, '⚠️ GOOD: card pendente existente NAO e reescrito (pendente e o normal na GOOD)');
  const a = await montar({}, []);
  await chamar(a.reg2, '/api/admin/lancar-por-nf', { body: { numeros: ['123'] } });
  ok(a.gravado.insert && a.gravado.insert.tipo === 'devolucao' && a.gravado.insert.status === 'aprovado', '  AMB/Girassol: segue tipo devolucao + status aprovado');
  const aj = await montar({}, [{ id: 5, status: 'pendente' }]);
  await chamar(aj.reg2, '/api/admin/lancar-por-nf', { body: { numeros: ['123'] } });
  ok(aj.gravado.update && aj.gravado.update.status === 'aprovado', '  AMB/Girassol: card orfao pendente continua sendo consertado');
  const rf = await chamar(g.reg2, '/api/debug/nf-devolucao', {});
  ok(rf.s === 503 && rf.o.ok === false, '⚠️ debug nf-devolucao responde (503) quando a busca rejeita, em vez de pendurar');
  const ri = await chamar(g.reg2, '/api/debug/ids-fiscais', {});
  ok(ri.o.hoje_no_codigo.idEmpresaControl === '4956030980', '⚠️ ids-fiscais mostra os ids DA GOOD quando informados');
  const ra = await chamar(a.reg2, '/api/debug/ids-fiscais', {});
  ok(ra.o.hoje_no_codigo.idEmpresaControl === '14901993834', '  ids-fiscais sem dep segue com o padrao historico (AMB)');
  // o retrofit roda no timer; confere o filtro pela fonte do modelo (coluna tipo na GOOD, status na AMB)
  const src = fs.readFileSync(path.join(R, 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'), 'utf8');
  ok(/\.in\(COL_RESULTADO, \['aprovado', 'problema', 'divergente'\]\)/.test(src) && /COL_RESULTADO = TRIAGEM_NO_TIPO \? 'tipo' : 'status'/.test(src), '⚠️ retrofit filtra o RESULTADO na coluna do modelo da empresa (tipo na GOOD)');
  ok(/chamarML: \(u, \.\.\.resto\) => chamarML\(\/\^https\?:\/i\.test\(String\(u\)\) \? u : 'https:\/\/api\.mercadolibre\.com' \+ u, \.\.\.resto\),/.test(s), '⚠️ caminho relativo do ML vira endereco inteiro na GOOD');
  const extraApp = []; const eapp = { get: (p, ...f) => extraApp.push({ p, h: f[f.length - 1] }), post() {}, put() {}, delete() {}, use() {} };
  require(path.join(R, 'lib', 'rotas-admin-good-extra.js'))(eapp, { chamarBling: async () => ({ ok: false }), sleep: async () => {}, requerAdmin: (a1, b1, n) => n(), adminOk: () => false, fotoDoIndice: () => null, indiceTemProduto: () => false });
  const ri2 = await new Promise((res) => { const h = extraApp.find((x) => x.p === '/api/produto/imagem/:id').h; h({ query: {}, params: { id: 'X' }, cookies: {} }, { status() { return this; }, json(o) { res(o); } }); });
  ok(ri2 && ri2.erro === 'faca login', '⚠️ imagem do produto: adminOk injetado (sem login responde 401, nao ReferenceError)');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
