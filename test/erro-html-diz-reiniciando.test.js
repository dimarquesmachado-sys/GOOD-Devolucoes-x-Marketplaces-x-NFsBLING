'use strict';
// O bipe, quando o servidor devolve HTML em vez de JSON (Render reiniciando no
// deploy -> 502/503), diz "o servidor estava reiniciando, espere 30s e bipe de
// novo" com o status HTTP — nao "Unexpected token '<', <!DOCTYPE ... is not
// valid JSON" (o que o dono viu em 01/10, logo apos o deploy do b477).
// Nos DOIS fronts (GOOD e AMB/Girassol sao arquivos separados).
const fs = require('fs');
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

for (const [p, nome] of [[['public', 'js', 'busca.js'], 'GOOD'], [['public', 'js', 'busca.js'], 'AMB/Girassol']]) {
  const s = fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const i = s.indexOf('/api/devolucao/identificar/');
  const bloco = s.slice(i, i + 1800);
  ok(/const tipo = String\(resp\.headers\.get\('content-type'\) \|\| ''\);\s*if \(!\/json\/i\.test\(tipo\)\) \{/.test(bloco), `⚠️ ${nome}: confere o content-type ANTES do resp.json()`);
  ok(/resp\.status === 502 \|\| resp\.status === 503 \|\| resp\.status === 504/.test(bloco), `  ${nome}: 502/503/504 = reiniciando`);
  ok(/O servidor estava REINICIANDO \(deploy\)/.test(bloco) && /Espere 30 segundos e bipe de novo/.test(bloco), `  ${nome}: a mensagem diz o que foi e o que fazer`);
  ok(/\(HTTP ' \+ resp\.status \+ '\)/.test(bloco), `  ${nome}: ... com o status HTTP`);
  ok(bloco.indexOf('if (!/json/i.test(tipo))') < bloco.indexOf('const data = await resp.json();'), `  ${nome}: o resp.json() so roda com JSON`);
  ok(/return;\s*\}\s*const data = await resp\.json\(\);/.test(bloco), `  ${nome}: sai antes do json (o finally restaura o botao)`);
}
// e os HTMLs da AMB carregam o busca.js com ?v= novo (mexeu no .js = bump)
const html = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'index-AMB.html'), 'utf8');
ok(/js-AMB\/busca\.js\?v=b523/.test(html), '  index-AMB.html carrega js-AMB/busca.js?v=b523 (bump — senao o galpao testa o front velho do cache)');
const htmlG = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
ok(/js\/busca\.js\?v=4783/.test(htmlG), '  index.html (GOOD) carrega js/busca.js?v=4783');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
