'use strict';
// b512 — de-para, parte 2: a GOOD aplica a ligacao de SKU ao gravar a triagem (como a AMB/Girassol, b258).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const fonte = (rota) => { const i = s.indexOf("app.post('" + rota + "'"); return s.slice(i, s.indexOf('\n});\n', i)); };
for (const r of ['/api/triagem/aprovar', '/api/triagem/problema', '/api/triagem/consertado']) ok(/produto_sku: \(await skuAtualGOOD\(dados\.produto_sku\)\) \|\| null/.test(fonte(r)), '⚠️ ' + r + ' grava o SKU ATUAL (de-para)');
ok(/produto_sku: \(await skuAtualGOOD\(skuVoltou\)\) \|\| skuVoltou/.test(s), '  divergente: o SKU que voltou de fato tambem passa pelo de-para');
const h = s.slice(s.indexOf('async function skuAtualGOOD('), s.indexOf('\n}\n', s.indexOf('async function skuAtualGOOD(')) + 2);
ok(/catch \(e\) \{ return sku; \}/.test(h), '  falha no de-para nunca trava o registro (grava o SKU como veio)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
