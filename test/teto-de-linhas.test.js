'use strict';
// b687 — O TETO DE ~3.000 LINHAS POR ARQUIVO, como teste (regra do dono, 22/08: "modularizar antes").
//
// ⚠️ POR QUE EXISTE: o painel unico chegou a 4.978 linhas e a fabrica a 4.334 porque a regra dependia de
// alguem lembrar. A modularizacao de novembro (docs/MODULARIZACAO.md) trouxe os dois pra baixo do teto;
// este teste impede a volta: arquivo de codigo acima de 3.000 linhas reprova — a saida e por o bloco novo
// num modulo (painel: js-AMB/painel-<tema>.js; fabrica: lib-AMB/<tema>-AMB.js), nao aumentar o teto.
//
// Unica excecao, com motivo: server.js (o codigo da GOOD hospedeira), que a fusao GOOD->Girassol aposenta
// (docs/FUSAO-GOOD-GIRASSOL.md) — modulariza-lo agora e trabalho jogado fora.
//
// Roda com: node test/teto-de-linhas.test.js

require('./_fonte-painel');    // este teste conta as linhas dos arquivos CRUS: os helpers entram so pra dar o
require('./_fonte-fabrica');   // leitor original — pelo fs embrulhado viria a fonte composta (com os blocos de volta)
const fs = require('fs');
const path = require('path');
const lerCru = fs.__lerOriginalFontePainel;

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const TETO = 3000;
const TETO_MODULO = 1000;          // meta do plano: nenhum modulo novo acima de 1.000
const ISENTOS = new Map([['server.js', 'codigo da GOOD hospedeira — a fusao aposenta (docs/FUSAO-GOOD-GIRASSOL.md)']]);

function arquivos(dir, rel = '') {
  const out = [];
  for (const nome of fs.readdirSync(path.join(RAIZ, dir, rel))) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const r = path.join(rel, nome);
    const st = fs.statSync(path.join(RAIZ, dir, r));
    if (st.isDirectory()) out.push(...arquivos(dir, r));
    else if (/\.(js|html)$/.test(nome)) out.push(path.join(dir, r).replace(/\\/g, '/').replace(/^\.\//, ''));
  }
  return out;
}
const linhas = (rel) => lerCru.call(fs, path.join(RAIZ, rel), 'utf8').split('\n').length;
const todos = arquivos('.').map((a) => a.replace(/^\.\//, ''));
ok(todos.length > 150 && todos.includes('server.js') && todos.includes('amb-devolucoes/app-AMB.js'), `varri ${todos.length} arquivos .js/.html do repo`);

const acima = todos.map((a) => [a, linhas(a)]).filter(([a, n]) => n > TETO && !ISENTOS.has(a));
ok(acima.length === 0, `⚠️ nenhum arquivo de codigo acima de ${TETO} linhas` + (acima.length ? ' — ACIMA: ' + acima.map(([a, n]) => `${a} (${n})`).join(', ') + ' — tire um bloco pra um modulo (docs/MODULARIZACAO.md)' : ''));
for (const [a, motivo] of ISENTOS) ok(todos.includes(a), `  isento: ${a} (${linhas(a)} linhas) — ${motivo}`);

// os dois que ja estouraram, com a folga a vista
for (const a of ['amb-devolucoes/public-AMB/painel-AMB.html', 'amb-devolucoes/app-AMB.js']) {
  const n = linhas(a);
  ok(n <= TETO, `  ${a}: ${n} linhas (folga de ${TETO - n})`);
}

// modulos saidos da modularizacao: o plano pede cada um abaixo de 1.000
const modulos = todos.filter((a) => /^amb-devolucoes\/public-AMB\/js-AMB\/painel-[a-z0-9-]+\.js$/.test(a));
const fab = lerCru.call(fs, path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');   // cru: e la que estao as marcas
for (const m of fab.matchAll(/^\/\/ @fabrica-modulo (lib-AMB\/[A-Za-z0-9-]+\.js)#/gm)) modulos.push('amb-devolucoes/' + m[1]);
ok(modulos.length >= 8, `  modulos da modularizacao: ${modulos.length}`);
const gordos = [...new Set(modulos)].map((a) => [a, linhas(a)]).filter(([, n]) => n > TETO_MODULO);
ok(gordos.length === 0, `⚠️ nenhum modulo do painel/da fabrica acima de ${TETO_MODULO} linhas` + (gordos.length ? ' — ' + gordos.map(([a, n]) => `${a} (${n})`).join(', ') : ''));

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
