'use strict';
// b607 — nivelar por cima: o que o painel antigo da GOOD fazia com as ESTORNADAS sem retorno e o painel unico perdeu,
// e a lista da Girassol/AMB decodificando os marcadores (so_rascunho, dep_sugerido) como a GOOD.
const path = require('path'); const fs = require('fs');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
(async () => {
  const rotas = {}; const reg = (m) => (p, ...f) => { rotas[m + ' ' + p] = f[f.length - 1]; };
  const router = { get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete'), patch: reg('patch'), use() {} };
  const marc = require(path.join(__dirname, '..', 'lib', 'marcadores-estornada.js'));
  const reg1 = { id: 9, tipo: 'aprovado', problema_descricao: marc.TAG + ' [SO RASCUNHO] [DEFEITO] [data:2026-09-30]' };
  const db = { listarFila: async ({ status }) => ({ ok: true, registros: status === 'aprovado' ? [reg1] : [] }), conectar: () => null };
  const mult = () => ({ single: () => (q, r, n) => n(), array: () => (q, r, n) => n(), fields: () => (q, r, n) => n() }); mult.memoryStorage = () => ({});
  require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js')).criar({ PREFIXO_ENV: 'AMB_' }).montar(router, {
    auth: { requerLogin: (q, r, n) => n(), requerAdmin: (q, r, n) => n() }, db, bling: {}, cfg: {}, multer: mult, versao: 't', chaveDados: 'girassol', espreitaMontada: () => null });
  const out = await new Promise((res) => rotas['get /api/admin/devolucoes']({ query: {} }, { status() { return this; }, json: res }));
  const a = out.aprovadas[0];
  ok(a && a.so_rascunho === true && a.dep_sugerido === 'defeito' && a.data_origem === '2026-09-30', '⚠️ a lista da Girassol/AMB decodifica os marcadores da estornada (so rascunho, DEFEITO, data) como a GOOD');
  const P = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
  const lote = P.slice(P.indexOf('async function concluirSelecionadas'), P.indexOf('async function concluirSelecionadas') + 2500);
  ok(/c\.dataset\.sorascunho !== '1'\)/.test(lote) && /conclua depois de validar a NF no Bling/.test(lote), '⚠️ o Concluir em LOTE pula os casos de estornadas (so rascunho) e avisa quantos pulou');
  const ind = P.slice(P.indexOf('async function concluir('), P.indexOf('async function concluir(') + 1200);
  ok(/chk\.dataset\.sorascunho === '1'/.test(ind) && /Já validou a NF no Bling\?/.test(ind), '⚠️ o Concluir INDIVIDUAL pergunta antes de esconder um caso de estornada');
  ok(/x\.tem_devolucao_registrada\s*\n\s*\? '📦 Devolução <b>COM entrada<\/b> — o marketplace registrou o retorno/.test(P) && /não foi entregue ao cliente/.test(P), '  cancelados: "o marketplace registrou" so quando ELE registrou');
  ok((P.match(/pack_varios_pedidos/g) || []).length >= 4 && /abra no ML pra ver qual voltou/.test(P), '  os dois cards da espreita explicam o pack com varios pedidos');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
