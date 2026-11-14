'use strict';
require('./_fonte-fabrica');   // docs/MODULARIZACAO.md: le a fabrica (app-AMB.js) com os blocos de lib-AMB de volta no lugar
// b586 — o indice do ML da AMB/Girassol se atualiza pelo relogio da espreita (3 min): com mais de 30 min, remonta.
// Antes so o bipe religava (Girassol chegou a 321 min). Roda o resumoEspreita de producao com o ML falso.
const path = require('path'); const fs = require('fs');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const A = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'ml-returns-AMB.js'), 'utf8');
// b692: a condicao ganhou `podeRemontarSozinho()` (espera depois de uma montagem que FALHOU — a rajada de 403 da GOOD).
// A regra daqui nao muda: indice bom com mais de 30 min remonta. O comportamento esta em test/ml-indice-nao-martela (caso E).
ok(/if \(!construindo && podeRemontarSozinho\(\) && \(!IDX\.ts \|\| \(Date\.now\(\) - IDX\.ts\) > 30 \* 60000\)\) \{\n\s+construirIndice\(\)/.test(A), '⚠️ o resumo da espreita (relogio de 3 min) remonta o indice do ML com mais de 30 min');
const app = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
ok(/drenagem\.intervalo\(\(\) => preAquecerEspreitaAMB\('relogio'\), 3 \* 60 \* 1000\);/.test(app) && /baseML = mlReturns\.resumoEspreita\(\);/.test(app), '  o relogio de 3 min da espreita passa pelo resumo do ML');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
