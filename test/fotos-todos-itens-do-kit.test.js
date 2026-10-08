'use strict';
// b590 — a triagem pede a foto de ate 12 itens (kit de 6 da NF 127729: o 5o e o 6o ficavam no 📦).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
const b = fs.readFileSync(path.join(R, 'public', 'js', 'busca.js'), 'utf8');
ok(/for \(let i = 0; i < itens\.length; i\+\+\) \{/.test(b) && !/i < itens\.length && i < \d+;/.test(b), '⚠️ a triagem pede a foto de TODOS os itens (antes: so os 4 primeiros)');
ok(/js\/busca\.js\?v=4786/.test(fs.readFileSync(path.join(R, 'public', 'index.html'), 'utf8')), '  ?v= da GOOD bumpado (o navegador pega o arquivo novo)');
ok(/_passeFotosItens/.test(b) && (b.match(/meuPasse !== _passeFotosItens/g) || []).length >= 2, '⚠️ (Codex #473) passe antigo de fotos para ao abrir um render novo');
const x = fs.readFileSync(path.join(R, 'lib', 'rotas-admin-good-extra.js'), 'utf8');
ok(/idNota && !podeGastarNaFoto\(\)\) \{\s*return res\.json/.test(x), '⚠️ (Codex #473) id da NF sem cota nao cai no SKU');
ok(/js-AMB\/busca\.js\?v=b525/.test(fs.readFileSync(path.join(R, 'amb-devolucoes', 'public-AMB', 'index-AMB.html'), 'utf8')), '  ?v= da AMB/Girassol bumpado');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
