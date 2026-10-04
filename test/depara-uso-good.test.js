'use strict';
// b512 — de-para, parte 2: a GOOD aplica a ligacao de SKU ao gravar a triagem (como a AMB/Girassol, b258).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const fonte = (rota) => { const i = s.indexOf("app.post('" + rota + "'"); return s.slice(i, s.indexOf('\n});\n', i)); };
for (const r of ['/api/triagem/aprovar', '/api/triagem/problema', '/api/triagem/consertado']) {
  const f = fonte(r);
  ok(/produto_sku: skuGravar \|\| null/.test(f) && /const skuGravar = await skuAtualGOOD\(dados\.produto_sku\)/.test(f), '⚠️ ' + r + ' grava o SKU ATUAL (de-para)');
}
ok(/produto_sku: skuVoltouGravar \|\| skuVoltou/.test(fonte('/api/triagem/divergente')) && /const skuVoltouGravar = await skuAtualGOOD\(dados\.produto_correto_sku\)/.test(fonte('/api/triagem/divergente')), '  divergente: o SKU que voltou de fato tambem passa pelo de-para');
// Codex: o de-para pode ir ao banco — resolvido ANTES da checagem de duplicata, sem await entre ela e o insert
for (const r of ['/api/triagem/aprovar', '/api/triagem/problema', '/api/triagem/divergente']) {
  const f = fonte(r); const a = f.indexOf('await skuAtualGOOD('); const d = f.indexOf('Bloqueia duplicata'); const ins = f.indexOf('.insert([');
  ok(a >= 0 && d > a && ins > d && !/await skuAtualGOOD/.test(f.slice(d)), '⚠️ ' + r + ': de-para resolvido antes da checagem de duplicata (sem await entre checagem e insert)');
}
const h = s.slice(s.indexOf('async function skuAtualGOOD('), s.indexOf('\n}\n', s.indexOf('async function skuAtualGOOD(')) + 2);
ok(/catch \(e\) \{ return sku; \}/.test(h), '  falha no de-para nunca trava o registro (grava o SKU como veio)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
