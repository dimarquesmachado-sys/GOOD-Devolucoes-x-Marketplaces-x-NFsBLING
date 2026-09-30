'use strict';
// ⚠️ O "LANÇAR POR NF" GRAVA NO MODELO DA AMB, NÃO NO DA GOOD.
//
// A rota foi portada da GOOD, onde a devolução tem `tipo: 'aprovado'` +
// `status: 'pendente'`. Na AMB (e na Girassol) é o CONTRÁRIO: `tipo` diz o
// que a peça é ('devolucao', 'recuperado', 'descartado') e `status` diz a
// fila ('aprovado', 'problema', 'divergente'). A tela "Aprovadas" filtra
// `status = 'aprovado'`.
//
// 📌 Então todo card lançado por NF nascia INVISÍVEL: existia (a 2ª tentativa
// dizia "já existe card pendente"), mas nunca aparecia em tela nenhuma. O
// dono achou na Girassol em 30/09 — na AMB nunca tinha funcionado.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const rotas = fs.readFileSync(
  path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'), 'utf8');
const semCom = rotas.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// o bloco do lançar-por-nf
const i = semCom.indexOf("app.post('/api/admin/lancar-por-nf'");
ok(i !== -1, 'a rota lancar-por-nf existe');
const bloco = semCom.slice(i, semCom.indexOf("app.post(", i + 10) > 0 ? semCom.indexOf("app.post(", i + 10) : undefined);

// ── o insert grava o modelo da AMB ──────────────────────────────────
ok(/status: 'aprovado'/.test(bloco),
   '⚠️ o card nasce com status APROVADO (o que a tela "Aprovadas" filtra)');
ok(/tipo: 'devolucao'/.test(bloco),
   '  e tipo DEVOLUCAO (o que a peca e, no modelo da AMB)');
ok(!/status: 'pendente'/.test(bloco),
   '⚠️ e NAO grava mais status pendente (o modelo da GOOD, invisivel aqui)');

// ── e a listagem filtra exatamente isso ─────────────────────────────
const supa = fs.readFileSync(
  path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'supabase-AMB.js'), 'utf8');
const iFila = supa.indexOf('async function listarFila');
const blocoFila = supa.slice(iFila, iFila + 600);
ok(/\.eq\('status', String\(status\)\)/.test(blocoFila),
   '  e a listagem filtra por status (o mesmo campo que o insert grava)');

// ── o card orfao do bug antigo e consertado, nao recusado ──────────
ok(/jaTem\[0\]\.status === 'pendente'/.test(bloco),
   '⚠️ card orfao (status pendente) e reconhecido');
ok(/\.update\(\{ status: 'aprovado', tipo: 'devolucao' \}\)/.test(bloco),
   '  e CONSERTADO pra aprovado (nao "ja existe" pra sempre)');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
