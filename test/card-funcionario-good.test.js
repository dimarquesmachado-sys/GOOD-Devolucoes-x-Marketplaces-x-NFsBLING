'use strict';
// b519 — auditoria (Codex, 04/10): o card de aprovadas da GOOD le `funcionario` de reserva (paridade com a AMB).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'painel-devolucoes.html'), 'utf8');
ok(/replace\(\/\^Aprovado por\\s\+\/, ''\) \|\| \(d\.funcionario \|\| ''\)/.test(h), '⚠️ GOOD: sem descricao, o card mostra quem triou pelo campo funcionario');
ok(!/const desc = \(d\.problema_descricao \|\| ''\)\.replace\(\/\^Aprovado por\\s\+\/, ''\);/.test(h), '  nao sobrou card sem a reserva');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
