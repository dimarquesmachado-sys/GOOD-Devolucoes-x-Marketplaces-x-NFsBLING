'use strict';
// b583 — o teto de TEMPO da montagem acompanha o teto de PAGINAS (Girassol com 300 paginas parava abandonada na 87).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const A = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'), 'utf8');
const m = /const _paginasPrevistas = ([^\n]+);\n\s+const TETO_CONSTRUCAO_MS = ([^\n]+);/.exec(A);
ok(!!m, '⚠️ o teto de tempo e calculado a partir das paginas previstas');
const calc = (paginas, envTeto) => { const opts = { maxPaginas: paginas }; const cfg = {}; const process = { env: envTeto ? { NF_NOMES_TETO_CONSTRUCAO_MS: envTeto } : {} };
  // eslint-disable-next-line no-new-func
  return new Function('opts', 'cfg', 'process', 'const TETO_PAGINAS_PADRAO = 300; const _paginasPrevistas = ' + m[1] + '; return ' + m[2] + ';')(opts, cfg, process); };
ok(calc(80) === 240000, '  80 paginas: 4 min, como antes');
ok(calc(300) === 900000, '⚠️ 300 paginas (Girassol): 15 min — cabe a montagem inteira (' + calc(300) / 60000 + ' min)');
ok(calc(undefined) === 900000, '⚠️ b584: sem teto informado, o padrao e 300 paginas pras 3 empresas (15 min)');
ok(calc(300, '600000') === 600000, '  a variavel NF_NOMES_TETO_CONSTRUCAO_MS continua mandando, se definida');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
