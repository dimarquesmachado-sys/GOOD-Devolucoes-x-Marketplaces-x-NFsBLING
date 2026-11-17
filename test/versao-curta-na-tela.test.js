'use strict';
// b744 — a tela do estoquista mostra so "server v9.126.258 (b744)", nao a descricao inteira do build (que tinha
// virado um paragrafo no cabecalho da triagem). A descricao fica no title (hover). Roda a funcao REAL das duas
// copias do auth.js (GOOD e fabrica) e confere que o /health da hospedeira continua curto.
// Roda com: node test/versao-curta-na-tela.test.js
const fs = require('fs');
const path = require('path');
const { entreMarcadores } = require('./_recorte');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

for (const f of ['public/js/auth.js', 'amb-devolucoes/public-AMB/js-AMB/auth.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const fn = new Function(entreMarcadores(src, 'function versaoCurta(v) {', 'if (typeof window !== ') + '\nreturn versaoCurta;')();
  const longa = "9.126.255 (b741: P2-17b — axios 1.21.1 + follow-redirects 1.16.3 (GHSA-q3jh-wrc6-jgq8); b740: P2-17a — express 4.22.3; b739: ...)";
  ok(fn(longa) === '9.126.255 (b741)', '⚠️ ' + f + ': a linha longa vira "9.126.255 (b741)". Veio: ' + fn(longa));
  ok(fn('9.126.258 (b744: tela mostra so numero e build)') === '9.126.258 (b744)', '  ' + f + ': build normal');
  ok(fn('Devolucoes b744') === 'Devolucoes b744' && fn('') === '?' && fn(undefined) === '?', '  ' + f + ': formato da fabrica passa inteiro; vazio vira ?');
  ok(/span\.title = String\(d\.version/.test(src) && /versaoCurta\(d\.version\)/.test(src), '  ' + f + ': a tela usa versaoCurta e guarda a descricao no title');
}
const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const m = srv.match(/version: '([^']*)'/);
ok(m && m[1].length <= 120 && !/; b7\d\d:/.test(m[1]), '⚠️ a linha version do server.js e curta (<=120) e NAO encadeia builds anteriores. Tamanho: ' + (m ? m[1].length : '?'));
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
