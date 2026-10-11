'use strict';
// b609 (Codex, #485): na Girassol/AMB as irmas CONCLUIDAS vem por PEDIDO ativo (nao pela janela global de 200 do
// listarFila) e a espreita da AMB resolve pack -> pedidos como a GOOD.
const path = require('path'); const fs = require('fs');
const { entreMarcadores } = require('./_recorte');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
(async () => {
  const rotas = {}; const reg = (m) => (p, ...f) => { rotas[m + ' ' + p] = f[f.length - 1]; };
  const router = { get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete'), patch: reg('patch'), use() {} };
  const chamadas = [];
  const cliente = { from(tabela) {
    const q = { tabela, filtros: {}, select() { return q; }, eq(c, v) { q.filtros[c] = v; return q; },
      in(c, v) { q.filtros[c] = v; return q; },
      then(res) { chamadas.push(q); res({ data: [], error: null }); } };
    return q; } };
  const abertas = { aprovado: [{ id: 1, order_id: 'P1', status: 'aprovado' }] };
  const db = { tabelas: { devolucoes: 'devolucoes_x' }, conectar: () => cliente,
    listarFila: async ({ status }) => ({ ok: true, registros: abertas[status] || [] }) };
  const mult = () => ({ single: () => (q, r, n) => n(), array: () => (q, r, n) => n(), fields: () => (q, r, n) => n() }); mult.memoryStorage = () => ({});
  require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js')).criar({ PREFIXO_ENV: 'AMB_' }).montar(router, {
    auth: { requerLogin: (q, r, n) => n(), requerAdmin: (q, r, n) => n() }, db, bling: {}, cfg: {}, multer: mult, versao: 't', chaveDados: 'girassol', espreitaMontada: () => null });
  const out = await new Promise((res) => rotas['get /api/admin/devolucoes']({ query: {} }, { status() { return this; }, json: res }));
  ok(out.ok === true && out.aprovadas.length === 1, 'a lista continua saindo');
  const conc = chamadas.find((q) => q.tabela === 'devolucoes_x');
  ok(conc && conc.filtros.status === 'concluido' && Array.isArray(conc.filtros.order_id) && conc.filtros.order_id.includes('P1'),
    '⚠️ as irmas concluidas sao buscadas PELO order_id dos cards ativos (nao pela janela global de 200)');
  const SRV = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  const bloco = entreMarcadores(SRV, 'async function resolverPacksEspreitaAMB', 'async function montarEspreitaAMB');
  ok(/\/packs\//.test(bloco) && /pack_varios_pedidos/.test(bloco) && /pedidos_do_pack/.test(bloco), '⚠️ a espreita da AMB resolve pack -> pedidos e marca pack com varios pedidos');
  ok(/resolverPacksEspreitaAMB\(baseML\.em_transito\)/.test(SRV) && /resolverPacksEspreitaAMB\(baseML\.entregues\)/.test(SRV), '  em transito e entregues passam pelo resolvedor');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
