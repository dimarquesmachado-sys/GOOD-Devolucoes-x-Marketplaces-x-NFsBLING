'use strict';
// b523 — auditoria (Codex, 04/10): quando nada acha, o bipe consulta a captura persistente (nas 3 empresas).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..'); const rd = (a) => fs.readFileSync(path.join(R, a), 'utf8');
const g = rd('server.js'); const a = rd('amb-devolucoes/lib-AMB/identificar-AMB.js');
ok(/devCapturadas\.procurar\(supabase, 'good', \[String\(req\.params\.codigo/.test(g), '⚠️ GOOD: o "nao encontrado" consulta a captura da propria empresa');
ok(/\.procurar\(supabase, CHAVE_DADOS, \[String\(req\.params\.codigo/.test(a), '⚠️ AMB/Girassol: idem, com a chave DESTA empresa (CHAVE_DADOS)');
for (const [nome, s] of [['GOOD', g], ['AMB', a]]) ok(/setTimeout\(\(\) => ok\(null\), 3000\)/.test(s) && /captura e ajuda: nunca derruba o bipe/.test(s), '  ' + nome + ': no maximo 3 s e falha nao derruba o bipe');
const b = rd('public/js/busca.js');
ok(/mostrarCapturadas\(data\.capturadas\);   \/\/ b523/.test(b) && /function mostrarCapturadas\(lista\)/.test(b), '⚠️ a tela unica mostra o que foi guardado, com um toque pra buscar pela NF');
// o modulo da AMB nao tem variavel chamada chaveDados solta (erro que eu cometi e corrigi)
ok(!/\.procurar\(supabase, chaveDados,/.test(a), '  (nada de variavel inexistente)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
