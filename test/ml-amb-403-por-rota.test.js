'use strict';
// b571 — o ML da AMB/Girassol ganha a renovacao no 403 com trava por ROTA (porte da GOOD) e o prefixo vazio valido.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const A = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'ml-AMB.js'), 'utf8');
const i = A.indexOf('const ML_ULTIMA_RENOV_POR_ROTA'); const j = A.indexOf('async function chamarML');
const f = new Function(A.slice(i, j) + '; return { rotaDe, podeRenovarPor403, registrarRenovacaoPor403 };')();
ok(f.rotaDe('https://api.mercadolibre.com/shipments/1234567/history?x=1') === '/shipments/{id}/history', '  a rota agrupa ids (/shipments/{id}/history)');
ok(f.podeRenovarPor403('https://api.mercadolibre.com/shipments/1234567') === true, '⚠️ 1o 403 da rota: pode renovar');
f.registrarRenovacaoPor403('https://api.mercadolibre.com/shipments/1234567');
ok(f.podeRenovarPor403('https://api.mercadolibre.com/shipments/7654321') === false, '⚠️ 2o 403 na MESMA rota em 10 min: nao gasta outro refresh (o do ML e de uso unico)');
ok(f.podeRenovarPor403('https://api.mercadolibre.com/orders/1234567') === true, '  outra rota segue podendo');
ok(/if \(status === 403\) \{\n\s+if \(!podeRenovarPor403\(url\)\)/.test(A) && /registrarRenovacaoPor403\(url\);/.test(A), '⚠️ chamarML trata o 403 (antes so o 401) e so marca a rota quando o refresh foi gasto');
ok(!/\(cfg && cfg\.PREFIXO_ENV\) \|\| 'AMB_'/.test(A) && !/\(cfg\.PREFIXO_ENV \|\| 'AMB_'\)/.test(A), '⚠️ prefixo vazio nao cai mais em AMB_ (empresa sem prefixo nao usaria o token da AMB)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
