'use strict';
// b496 — o servidor acha sozinho a NF de devolucao do FULL depois da triagem (sem clicar em Achar).
// Roda o varredor DE PRODUCAO das duas rotas com um roteador e um banco falsos.
const path = require('path');
process.env.NODE_TEST_SEM_TIMERS = '1';
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
(async () => {
  for (const arq of [path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'), path.join(__dirname, '..', 'lib', 'rotas-admin-nf.js')]) {
    const chamados = [];
    let respostaAchar = { s: 404, o: { ok: false, erro: 'nao achei' } };
    const stack = [];
    const reg = (m) => (p, ...f) => { const route = { path: p, methods: { [m]: true }, stack: f.map((h) => ({ handle: h })) }; stack.push({ route }); };
    const app = { stack, get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete'), patch: reg('patch'), use() {} };
    const cards = [{ id: 1, nf_serie: '2', status: 'aprovado' }, { id: 2, nf_serie: '1', status: 'problema' }, { id: 3, nf_chave: '35260727548456000147550020000492861144343275', status: 'divergente' }];
    const q = { select() { return q; }, is() { return q; }, in() { return q; }, gte() { return q; }, order() { return q; }, limit: async () => ({ data: cards, error: null }), eq() { return q; }, single: async () => ({ data: null }) };
    const deps = { supabase: { from: () => q, storage: { from: () => ({}) } }, requerAdmin: (a, b, n) => n && n(), adminOk: () => true, sleep: async () => {}, chamarBling: async () => ({ ok: false }), chamarML: async () => ({ ok: false }), buscarNFnoML: async () => null, buscarNFePorId: async () => null, buscarNFBlindada: async () => null, resolverIdNFPorChave: async () => null, mapItensNF: () => [], tabelaDevolucoes: 'devolucoes_girassol', listarDepositos: async () => ({ ok: true, depositos: [] }) };
    delete require.cache[require.resolve(arq)];
    require(arq)(app, deps);
    // troca o handler do Achar por um espiao (a rota real e coberta pelo teste do Achar)
    const camada = stack.find((l) => l.route.path === '/api/admin/full-vincular/:id');
    camada.route.stack[camada.route.stack.length - 1].handle = async (req, res) => { chamados.push(req.params.id); res.status(respostaAchar.s).json(respostaAchar.o); };
    await deps.varrerFullSemNF();
    ok(chamados.join() === '1,3', '⚠️ ' + path.basename(arq) + ': acha sozinho a NF dos cards do FULL (serie 2 pelo campo OU pela chave) e pula a serie 1 (' + chamados.join() + ')');
    chamados.length = 0;
    await deps.varrerFullSemNF();
    ok(chamados.length === 0, '  ' + path.basename(arq) + ': quem nao achou espera (nao martela o Bling a cada volta)');
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
