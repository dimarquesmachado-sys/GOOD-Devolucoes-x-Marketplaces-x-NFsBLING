'use strict';
// b574 — a emissao em lote diz o MOTIVO certo de cada card pulado (antes: sempre 'SEM NF').
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const h = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
const i = h.indexOf('async function rodarEsteira'); const bloco = h.slice(i, i + 9000);
ok(/const puladosSemNF = marcados\.filter\(c => c\.dataset\.full !== '1' && !temNF\(c\)\)\.length;/.test(bloco), '⚠️ "SEM NF" so conta quem nao tem NF');
ok(/puladosRascunho/.test(bloco) && /puladosParcial/.test(bloco) && /faltasDoCard\(c\.dataset\.id\)\.length > 0/.test(bloco), '⚠️ so-rascunho e parcial contados a parte, com o motivo');
ok(/\$\{pulados\} selecionado\(s\) SEM NF/.test(bloco) === false && /linhasPulados \+/.test(bloco), '  a confirmacao lista cada motivo (nao mais um "SEM NF" pra tudo)');
ok(/\(linhaFull \+ linhasPulados\)\.replace/.test(bloco), '  aviso de fila vazia MISTA (FULL + outro motivo) inclui a linha do FULL');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
