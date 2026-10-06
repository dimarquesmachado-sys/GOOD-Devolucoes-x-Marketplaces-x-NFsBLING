'use strict';
// b556 — o indice de nomes da AMB/Girassol ganha o TETO DE CONSTRUCAO que so a copia da GOOD tinha: montagem que passa
// do teto e abandonada (o emConstrucao nao fica pendurado e as buscas seguintes nao esperam por ela pra sempre).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const A = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'), 'utf8');
ok(/const TETO_CONSTRUCAO_MS = Number\(process\.env\.NF_NOMES_TETO_CONSTRUCAO_MS \|\| 240000\);/.test(A), '⚠️ a montagem do indice tem teto proprio (ajustavel por env), como na GOOD');
ok(/IDX\.emConstrucao = Promise\.race\(\[\n\s+construirIndice\(\),/.test(A), '⚠️ o emConstrucao guarda a versao COM teto (nao fica pendurado)');
ok(/\.finally\(\(\) => \{ IDX\.emConstrucao = null; IDX\.construindoDesde = null; \}\);/.test(A), '  limpa o carimbo ao terminar (o status nao mente)');
ok(/construindo_ha_s: IDX\.construindoDesde \?/.test(A), '  o status mostra ha quanto tempo esta montando');
ok(/\} else if \(\(Date\.now\(\) - IDX\.ts\) > 30 \* 60000\) \{\n\s+construirIndice\(\)\.catch/.test(A) && /construirIndice\(\{ fundo: true \}\)/.test(A), '  (ja tinha) remonta em segundo plano e o pre-aquecimento vai como fundo');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
