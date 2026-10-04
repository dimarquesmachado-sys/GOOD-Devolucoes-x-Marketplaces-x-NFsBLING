'use strict';
// b537 — unificacao do painel (passo de teste): a GOOD serve o painel UNICO em /painel-novo.html, com nome, cores e
// empresa dela. Roda a montagem de producao (lib/painel-unico) no painel de verdade da AMB/Girassol.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
const { montarPainelUnicoGood } = require(path.join(R, 'lib', 'painel-unico'));
const h = montarPainelUnicoGood(fs.readFileSync(path.join(R, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8'));
ok(/<title>GOOD Import \(GIMPO\) - Painel de Devoluções<\/title>/.test(h), '⚠️ titulo da GOOD');
ok(/Painel de Devoluções — GOOD Import \(GIMPO\)<\/h1>/.test(h) && !/— AMBTotal<\/h1>/.test(h), '⚠️ cabecalho da GOOD (nao "AMBTotal")');
ok(/id="tema-empresa"/.test(h) && /--marca:#561A9E/.test(h), '  paleta roxa da GOOD');
ok(/src="\/js-AMB\/base-amb\.js\?v=good537"/.test(h) && /src="\/js-AMB\/defeitos-ficha\.js\?v=good537"/.test(h), '⚠️ os arquivos de empresa vem da RAIZ da GOOD');
const s = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
ok(/app\.get\('\/painel-novo\.html', requerAdmin,/.test(s), '⚠️ /painel-novo.html exige o login de admin');
ok(/\.replace\('"%%APP_EMPRESA%%"', JSON\.stringify\('good'\)\)/.test(s) && /\.replace\('"%%APP_BASE%%"', JSON\.stringify\(''\)\)/.test(s), '⚠️ o base-amb da GOOD diz empresa "good" e base na raiz (nada de cair na AMB)');
ok(/app\.get\('\/painel-devolucoes\.html', requerAdmin, \(req, res\) => \{\n  res\.sendFile\(path\.join\(__dirname, 'public', 'painel-devolucoes\.html'\)\);/.test(s), '  o painel atual da GOOD continua igual ate o dono aprovar o novo');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
