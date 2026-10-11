'use strict';
// b606 — nivelar por cima: a lista da Girassol/AMB anota `parcial` (devolucao em VARIAS CAIXAS) como a GOOD, e o painel
// unico mostra CAIXA 1/2. Roda a rota de producao da compat com banco falso.
const path = require('path'); const fs = require('fs');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
(async () => {
  const rotas = {}; const reg = (m) => (p, ...f) => { rotas[m + ' ' + p] = f[f.length - 1]; };
  const router = { get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete'), patch: reg('patch'), use() {} };
  const consultas = [];
  const chain = (rows) => { const q = { select() { return q; }, eq(c, v) { consultas.push([c, v]); return q; }, in() { return q; }, then(r) { return r({ data: rows, error: null }); } }; return q; };
  const reg1 = { id: 1, order_id: 'P-77', tipo: 'aprovado', created_at: '2026-10-01T10:00:00Z', produto_titulo: 'Caixa A' };
  const db = {
    listarFila: async ({ status }) => ({ ok: true, registros: status === 'aprovado' ? [reg1] : [] }),
    conectar: () => ({ from: () => chain([{ pedido: 'P-77', tipo_tiktok: null, status: 'x' }, { pedido: 'P-77', tipo_tiktok: null, status: 'y' }]) }),
  };
  const mult = () => ({ single: () => (q, r, n) => n(), array: () => (q, r, n) => n(), fields: () => (q, r, n) => n() });
  mult.memoryStorage = () => ({});
  require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js')).criar({ PREFIXO_ENV: 'AMB_' }).montar(router, {
    auth: { requerLogin: (q, r, n) => n(), requerAdmin: (q, r, n) => n() }, db, bling: {}, cfg: {}, multer: mult, versao: 't', chaveDados: 'girassol', espreitaMontada: () => null });
  const h = rotas['get /api/admin/devolucoes'];
  const out = await new Promise((res) => h({ query: {} }, { status() { return this; }, json: res }));
  const a = out.aprovadas[0];
  ok(consultas.some(([c, v]) => c === 'empresa' && v === 'girassol'), '⚠️ a captura e lida SO da empresa certa (empresa = girassol)');
  ok(a && a.parcial && (a.parcial.esperadas === 2 || a.parcial.vieram >= 1) && a.parcial.completo === false, '⚠️ 1 caixa triada de 2 esperadas: card anotado como parcial (aguardando outra caixa) ' + JSON.stringify(a && a.parcial && { esta: a.parcial.esta, esperadas: a.parcial.esperadas, completo: a.parcial.completo }));
  const P = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
  ok(/const multi = d\.parcial \|\| null;/.test(P) && /\$\{badgeParcial\}\$\{badgeMulti\}/.test(P) && /\$\{avisoMulti\}\$\{blocoFotos\}/.test(P), '⚠️ o painel unico mostra CAIXA 1/2 no titulo e o aviso no card de aprovada');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
