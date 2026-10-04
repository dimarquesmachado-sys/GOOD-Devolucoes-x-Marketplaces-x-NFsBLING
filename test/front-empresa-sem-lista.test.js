'use strict';
// b513 — auditoria multiloja (achado do Codex, conferido): o navegador NAO pode ter lista fechada de empresas.
// Roda o base-amb.js DE PRODUCAO com URLs de varias empresas, inclusive uma que nao existe hoje (/loja4).
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const src = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'js-AMB', 'base-amb.js'), 'utf8');
function base(caminho) {
  const win = { location: { pathname: caminho, origin: 'https://x', href: 'https://x' + caminho }, fetch: () => Promise.resolve({}), localStorage: { getItem() { return null; }, setItem() {} } };
  win.window = win;
  function XHR() {} XHR.prototype.open = function () {}; XHR.prototype.send = function () {}; XHR.prototype.setRequestHeader = function () {};
  win.XMLHttpRequest = XHR;
  const ctx = vm.createContext({ XMLHttpRequest: XHR, window: win, location: win.location, document: { cookie: '', querySelector() { return null; }, addEventListener() {} }, navigator: {}, console, setTimeout, fetch: win.fetch });
  try { vm.runInContext(src, ctx); } catch (e) { return 'ERRO: ' + e.message; }
  return win.APP_BASE;
}
for (const [url, esperado] of [['/amb/painel-AMB.html', '/amb'], ['/girassol/', '/girassol'], ['/good/index-AMB.html', '/good'], ['/loja4/painel-AMB.html', '/loja4'], ['/AMB/painel-AMB.html', '/amb']]) {
  const b = base(url);
  ok(b === esperado, (url.indexOf('loja4') > 0 ? '⚠️ ' : '  ') + url + ' -> ' + b + (url.indexOf('loja4') > 0 ? ' (uma 4a empresa NAO cai na raiz da GOOD)' : ''));
}
const fic = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'js-AMB', 'defeitos-ficha.js'), 'utf8');
ok(/typeof window\.APP_BASE === 'string'/.test(fic) && !/indexOf\('\/amb'\) === 0\) \? '\/amb'/.test(fic), '⚠️ ficha de defeitos usa a base da empresa (era so /amb: a Girassol chamava a GOOD)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
