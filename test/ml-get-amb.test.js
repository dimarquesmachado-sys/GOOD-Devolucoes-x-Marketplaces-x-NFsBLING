'use strict';
// b502 — a AMB/Girassol tambem le o ML na conta dela (como a GOOD ja tinha), so admin, so GET.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const s = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
const i = s.indexOf("router.get('/api/debug/ml-get', admin,"); const rota = s.slice(i, s.indexOf('\n});\n', i) + 4);
ok(i > 0, '⚠️ rota /api/debug/ml-get existe na AMB/Girassol, atras do admin');
ok(/ml\.chamarML\('https:\/\/api\.mercadolibre\.com' \+ p\)/.test(rota), '  usa o token do ML DESTA empresa (ml do modulo)');
ok(/p\.startsWith\('\/\/'\)/.test(rota), '  so caminho da API do ML (nada de //outro-host)');
ok(/try \{/.test(rota) && /status\(502\)/.test(rota), '  erro de rede vira 502 com o motivo (nao derruba o servidor)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
