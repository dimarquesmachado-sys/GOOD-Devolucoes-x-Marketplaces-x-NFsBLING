'use strict';
// b606/b607 — nivelar por cima: a lista da Girassol/AMB anota `parcial` (devolucao em VARIAS CAIXAS) como a GOOD, e o painel
// unico mostra CAIXA 1/2. Roda a rota de producao da compat com banco falso.
const path = require('path'); const fs = require('fs');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

async function rodar({ filas, captura, erroCaptura }) {
  const rotas = {}; const reg = (m) => (p, ...f) => { rotas[m + ' ' + p] = f[f.length - 1]; };
  const router = { get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete'), patch: reg('patch'), use() {} };
  const consultas = []; const selects = [];
  const chain = (tabela) => { const q = { select(s) { if (tabela !== 'devolucoes_x') selects.push(s); return q; }, eq(c, v) { consultas.push([c, v]); return q; }, in() { return q; }, then(r) { if (tabela === 'devolucoes_x') return r({ data: filas.concluido || [], error: null }); return r({ data: erroCaptura ? null : captura, error: erroCaptura ? { message: 'permission denied' } : null }); } }; return q; };
  const db = {
    listarFila: async ({ status }) => ({ ok: true, registros: filas[status] || [] }),
    tabelas: { devolucoes: 'devolucoes_x' },
    conectar: () => ({ from: (t) => chain(t) }),
  };
  const mult = () => ({ single: () => (q, r, n) => n(), array: () => (q, r, n) => n(), fields: () => (q, r, n) => n() });
  mult.memoryStorage = () => ({});
  require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js')).criar({ PREFIXO_ENV: 'AMB_' }).montar(router, {
    auth: { requerLogin: (q, r, n) => n(), requerAdmin: (q, r, n) => n() }, db, bling: {}, cfg: {}, multer: mult, versao: 't', chaveDados: 'girassol', espreitaMontada: () => null });
  const h = rotas['get /api/admin/devolucoes'];
  const out = await new Promise((res) => h({ query: {} }, { status() { return this; }, json: res }));
  return { out, consultas, selects };
}

(async () => {
  const reg1 = { id: 1, order_id: 'P-77', tipo: 'aprovado', created_at: '2026-10-01T10:00:00Z', produto_titulo: 'Caixa A' };
  const duas = [{ pedido: 'P-77', tipo_tiktok: null, status: 'x', shipment: 'S1' }, { pedido: 'P-77', tipo_tiktok: null, status: 'y', shipment: 'S2' }];

  // 1 caixa triada de 2 esperadas
  let r = await rodar({ filas: { aprovado: [reg1] }, captura: duas });
  let a = r.out.aprovadas[0];
  ok(r.consultas.some(([c, v]) => c === 'empresa' && v === 'girassol'), '⚠️ a captura e lida SO da empresa certa (empresa = girassol)');
  ok(a && a.parcial && a.parcial.esperadas === 2 && a.parcial.completo === false, '⚠️ 1 caixa triada de 2 esperadas: card anotado como parcial (aguardando outra caixa)');
  ok(/shipment/.test(r.selects[0]) && /rastreio/.test(r.selects[0]), '⚠️ a consulta traz shipment e rastreio (os nomes gravados) pra contar PACOTE e nao registro');

  // dois registros do MESMO pacote = 1 caixa so, nao "1 de 2"
  r = await rodar({ filas: { aprovado: [reg1] }, captura: [{ pedido: 'P-77', status: 'x', shipment: 'S1' }, { pedido: 'P-77', status: 'y', shipment: 'S1' }] });
  ok(!r.out.aprovadas[0].parcial, '⚠️ claims duplicadas do mesmo shipment nao viram 2 caixas (sem selo)');
  r = await rodar({ filas: { aprovado: [reg1] }, captura: [{ pedido: 'P-77', status: 'x', rastreio: 'R1' }, { pedido: 'P-77', status: 'y', rastreio: 'R1' }] });
  ok(!r.out.aprovadas[0].parcial, '⚠️ idem pelo rastreio gravado');

  // irma ja concluida conta como recebida e nao aparece na lista
  const irma = { id: 2, order_id: 'P-77', tipo: 'aprovado', status: 'concluido', created_at: '2026-10-02T10:00:00Z' };
  r = await rodar({ filas: { aprovado: [reg1], concluido: [irma] }, captura: duas });
  a = r.out.aprovadas[0];
  ok(a.parcial && a.parcial.vieram === 2 && a.parcial.completo === true, '⚠️ irma concluida conta como caixa recebida: as 2 chegaram');
  ok(r.out.aprovadas.length === 1 && r.out.total === 1, 'a concluida entra so na conta, nao na resposta');

  // problema e divergente tambem sao anotados
  const prob = { id: 3, order_id: 'P-77', tipo: 'problema', created_at: '2026-10-03T10:00:00Z' };
  const div = { id: 4, order_id: 'P-77', tipo: 'divergente', created_at: '2026-10-04T10:00:00Z' };
  r = await rodar({ filas: { aprovado: [reg1], problema: [prob], divergente: [div] }, captura: [duas[0], duas[1], { pedido: 'P-77', status: 'z', shipment: 'S3' }] });
  ok(r.out.problemas[0].parcial && r.out.divergentes[0].parcial && r.out.problemas[0].parcial.esperadas === 3, 'problemas e divergentes tambem saem com `parcial`');

  // erro do Supabase na captura: lista sai igual, sem selo falso
  const avisos = []; const w = console.warn; console.warn = (...x) => avisos.push(x.join(' '));
  r = await rodar({ filas: { aprovado: [reg1], problema: [{ ...prob }] }, captura: null, erroCaptura: true });
  console.warn = w;
  ok(r.out.ok && r.out.aprovadas.length === 1 && !r.out.aprovadas[0].parcial && !r.out.problemas[0].parcial, '⚠️ erro na leitura da captura: lista igual, SEM "aguardando outra caixa" falso');
  ok(avisos.some((x) => /cruzamento de entrega parcial falhou/.test(x)), 'o erro cai no fallback existente (aviso no log)');

  const P = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
  ok(/function badgeMultiCaixa\(d\)/.test(P) && /function avisoMultiCaixa\(d\)/.test(P), 'o painel unico tem os helpers do selo CAIXA n/m e do aviso');
  ok(/\$\{badgeParcial\}\$\{badgeMulti\}/.test(P) && /\$\{avisoMulti\}\$\{blocoFotos\}/.test(P), '⚠️ aprovada: CAIXA 1/2 no titulo e aviso no card');
  const iP = P.indexOf('function itemHtmlProblema'); const iD = P.indexOf('function itemHtmlDivergente', iP);
  ok(iP > 0 && iD > iP, 'marcadores dos renderers existem na ordem esperada');
  const blocoP = P.slice(iP, iD); const blocoD = P.slice(iD, P.indexOf('</script>', iD));
  ok(/badgeMultiCaixa\(d\)/.test(blocoP) && /avisoMultiCaixa\(d\)/.test(blocoP), '⚠️ problema mostra o selo e o aviso de caixa');
  ok(/badgeMultiCaixa\(d\)/.test(blocoD) && /avisoMultiCaixa\(d\)/.test(blocoD), '⚠️ divergente mostra o selo e o aviso de caixa');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
