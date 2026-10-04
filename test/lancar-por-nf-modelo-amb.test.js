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

// ── ⚠️ b453: SEM TETO de 15 no front — vai em levas ─────────────────
//
// O dono: "15 e pouco". O teto existia porque a rota faz 2 chamadas ao Bling
// por nota numa requisicao so. Agora o front divide em levas de 15 e chama
// varias vezes, com progresso — o lote inteiro de uma vez.
for (const painel of ['painel-AMB.html']) {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', painel), 'utf8');
  const semComH = html.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const iFn = semComH.indexOf('async function lancarPorNF');
  const fn = semComH.slice(iFn, iFn + 4000);
  ok(!/numeros = numeros\.slice\(0, 15\)/.test(fn),
     `⚠️ ${painel}: o teto de 15 SAIU (nao corta mais a lista)`);
  ok(/const LEVA = 15/.test(fn) && /for \(let i = 0; i < numeros\.length; i \+= LEVA\)/.test(fn),
     `  ${painel}: e vai em LEVAS de 15, uma chamada por leva`);
  ok(/Leva \$\{nLeva\}\/\$\{totalLevas\}/.test(fn),
     `  ${painel}: com progresso no botao`);
  ok(/criadosTotal \+= /.test(fn) && /resultadosTotal\.push/.test(fn),
     `  ${painel}: e soma os resultados de todas as levas`);

  // ⚠️ b454 (Codex): a leva que FALHA nao derruba as outras. Antes um erro
  // de rede na 4a leva ia pro catch de fora e perdia o que 1-3 criaram —
  // sem alert, sem toast, sem recarregar. Agora vira "pulada" com motivo.
  const iLaco = fn.indexOf('for (let i = 0; i < numeros.length; i += LEVA)');
  const laco = fn.slice(iLaco, fn.indexOf('const d = { ok: true', iLaco));
  ok(/try \{[\s\S]*?await fetch[\s\S]*?\} catch \(eLeva\)/.test(laco),
     `⚠️ ${painel}: o fetch de cada leva tem try/catch PROPRIO (falha nao vaza)`);
  ok(/motivo: `leva \$\{nLeva\} falhou/.test(laco),
     `  ${painel}: e a leva que falhou vira "pulada" com o motivo`);
  // e o contador so avanca depois que a leva volta
  ok(/feitas \+= leva\.length;/.test(laco) && laco.indexOf('feitas += leva.length') > laco.indexOf('catch (eLeva)'),
     `  ${painel}: o contador avanca DEPOIS da leva voltar (nao antes)`);
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
