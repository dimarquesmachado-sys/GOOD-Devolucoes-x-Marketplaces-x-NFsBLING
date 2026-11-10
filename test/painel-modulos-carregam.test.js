'use strict';
// b680 — TODO modulo do painel (js-AMB/painel-*.js) carrega sozinho e nao duplica nada.
//
// ⚠️ O QUE ESTE TESTE PROTEGE (docs/MODULARIZACAO.md): cada fatia move um bloco do <script>
// principal do painel pra um arquivo carregado ANTES dele. Os dois jeitos de isso quebrar a
// tela em producao — e que `node --check` nao pega:
//   1. o modulo usa, NA HORA DA CARGA, algo que o script principal ainda nao declarou
//      (ReferenceError; a pagina fica sem as funcoes do bloco);
//   2. o mesmo nome de topo fica declarado nos dois lugares (uma `let` repetida entre scripts
//      e SyntaxError: o script principal inteiro nao roda).
// Vale pra TODA fatia, sem teste novo por modulo: ele descobre os modulos pelas tags do painel.
//
// Roda com: node test/painel-modulos-carregam.test.js

const fonte = require('./_fonte-painel');
const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const cru = fonte.fonteCrua();
const modulos = fonte.modulosDoPainel();
ok(modulos.length >= 1, 'o painel referencia ' + modulos.length + ' modulo(s): ' + modulos.join(', '));

// o script principal = o 1o <script> sem src
const mMain = cru.match(/\n  <script>\n([\s\S]*?)\n  <\/script>/);
ok(!!mMain, '⚠️ achei o script principal do painel');
const principal = mMain ? mMain[1] : '';
const iMain = mMain ? cru.indexOf(mMain[0]) : -1;

// nomes declarados no TOPO (4 espacos de indentacao no HTML e nos modulos, que sao movimento puro)
function nomesDeTopo(src) {
  const nomes = new Set();
  for (const l of src.split('\n')) {
    let m = l.match(/^    (?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/); if (m) nomes.add(m[1]);
    m = l.match(/^    (?:let|const|var)\s+([A-Za-z0-9_$]+)/); if (m) nomes.add(m[1]);
    m = l.match(/^    window\.([A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?function/); if (m) nomes.add('window.' + m[1]);
  }
  return nomes;
}
const topoPrincipal = nomesDeTopo(principal);
ok(topoPrincipal.size > 50, '  nomes de topo no script principal: ' + topoPrincipal.size);

// um navegador minimo: o que um modulo pode tocar NA CARGA sem depender do script principal
function ambiente() {
  const ouvintes = [];
  const elemento = () => new Proxy(function () {}, { get: (t, k) => (k === 'style' ? {} : k === 'classList' ? { add() {}, remove() {}, toggle() {}, contains: () => false } : elemento()), apply: () => elemento(), set: () => true });
  const w = {
    addEventListener: (t, fn) => { if (t === 'message') ouvintes.push(fn); },
    removeEventListener: () => {},
    postMessage: () => {},
    location: { pathname: '/painel-AMB.html', search: '', href: 'https://x/painel-AMB.html', origin: 'https://x' },
    APP_BASE: '', APP_EMPRESA: 'teste',
  };
  const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => elemento(), body: elemento(), readyState: 'loading' };
  return { w, document };
}

const vistos = new Map();   // nome -> modulo que o declarou
for (const nome of modulos) {
  const arq = path.join(fonte.DIR_JS, nome);
  ok(fs.existsSync(arq), `⚠️ ${nome}: o arquivo existe em js-AMB`);
  if (!fs.existsSync(arq)) continue;
  const js = fs.readFileSync(arq, 'utf8');
  // (a) tag antes do script principal, com ?v=
  const iTag = cru.indexOf('<script src="js-AMB/' + nome + '?v=');
  ok(iTag > 0 && iTag < iMain, `  ${nome}: carregado com ?v= ANTES do script principal`);
  // (b) carrega sozinho
  const { w, document } = ambiente();
  let erro = null;
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'fetch', 'localStorage', 'navigator', js)(
      w, document, { log() {}, warn() {}, error() {} }, () => 0, () => {}, () => 0, async () => ({ ok: false, json: async () => ({}) }), { getItem: () => null, setItem() {} }, { userAgent: 'teste' });
  } catch (e) { erro = e; }
  ok(!erro, `⚠️ ${nome}: carrega SOZINHO, antes do script principal` + (erro ? ' — ' + erro.name + ': ' + erro.message : ''));
  // (c) nenhum nome de topo duplicado com o principal nem com outro modulo
  const meus = nomesDeTopo(js);
  ok(meus.size >= 1, `  ${nome}: declara ${meus.size} nome(s) de topo`);
  const dupPrincipal = [...meus].filter((n) => topoPrincipal.has(n));
  ok(dupPrincipal.length === 0, `⚠️ ${nome}: nenhum nome de topo repetido no script principal` + (dupPrincipal.length ? ' — repetidos: ' + dupPrincipal.join(', ') : ''));
  const dupModulo = [...meus].filter((n) => vistos.has(n));
  ok(dupModulo.length === 0, `  ${nome}: nenhum nome repetido em outro modulo` + (dupModulo.length ? ' — ' + dupModulo.map((n) => n + ' (' + vistos.get(n) + ')').join(', ') : ''));
  for (const n of meus) vistos.set(n, nome);
}

// (d) o painel composto inteiro compila, script a script
for (const m of fonte.fontePainel().matchAll(/<script>([\s\S]*?)<\/script>/g)) { try { new Function(m[1]); } catch (e) { ok(false, 'script do painel composto compila: ' + e.message); } }
ok(true, 'todos os <script> do painel composto compilam');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
