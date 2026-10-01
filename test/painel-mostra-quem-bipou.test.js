'use strict';
// ⚠️ O PAINEL MOSTRA QUEM BIPOU — na AMB e na Girassol, não só na GOOD.
//
// 30/09, Girassol: o dono triou logado como Diego e o card saiu "por ·", vazio.
// O nome ESTAVA gravado (`funcionario: 'Diego'`), mas o painel — portado da
// GOOD — le `problema_descricao`, que a GOOD preenche com "Aprovado por X
// [bipagem OK]" e a AMB nunca preenchia. Todo card aprovado da AMB e da
// Girassol saia sem nome, desde o porte.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const compat = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js'), 'utf8');
const semCom = compat.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const i = semCom.indexOf("router.post('/api/triagem/aprovar'");
const bloco = semCom.slice(i, i + 1400);

ok(/Aprovado por \$\{req\.usuario\}/.test(bloco),
   '⚠️ a AMB grava "Aprovado por <usuario>" ao aprovar (paridade com a GOOD)');
ok(/\[bipagem OK\]/.test(bloco) && /\[BIPAGEM FORCADA\]/.test(bloco),
   '  com a marca de bipagem OK/forcada, igual a GOOD');
ok(/problema_descricao: descricao/.test(bloco),
   '  e manda pro registrarTriagem (nao so no log)');

for (const painel of ['painel-AMB.html', 'painel2-AMB.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', painel), 'utf8');
  ok(/\.replace\(\/\^Aprovado por\\s\+\/, ''\) \|\| \(d\.funcionario \|\| ''\)/.test(html),
     `⚠️ ${painel}: le \`funcionario\` como reserva (cobre os cards antigos)`);
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
