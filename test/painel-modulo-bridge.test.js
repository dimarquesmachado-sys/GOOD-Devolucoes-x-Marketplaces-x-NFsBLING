'use strict';
// b679 — FATIA 1 da modularizacao do painel: o bloco da Bridge mora em js-AMB/painel-bridge.js.
//
// ⚠️ O QUE ESTE TESTE PROTEGE (docs/MODULARIZACAO.md): a fatia e SO MOVIMENTO. O risco de mover
// um bloco de um <script> inline pra um arquivo carregado ANTES do script principal e ele depender,
// na hora do CARREGAMENTO, de estado que o script principal ainda nao declarou (ReferenceError em
// producao, que `node --check` nao pega). Aqui o modulo e carregado SOZINHO num window falso: se
// subir e expuser as funcoes, nao ha dependencia de carga. E confere que o codigo nao ficou
// duplicado (uma `let` declarada nos dois scripts derruba a pagina inteira no navegador).
//
// Roda com: node test/painel-modulo-bridge.test.js

const fonte = require('./_fonte-painel');
const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const MODULO = path.join(fonte.DIR_JS, 'painel-bridge.js');
const cru = fonte.fonteCrua();
const js = fs.readFileSync(MODULO, 'utf8');

// ── 1. o modulo carrega SOZINHO (sem o script principal) ──
function janelaFalsa() {
  const ouvintes = [];
  const w = {
    addEventListener: (t, fn) => { if (t === 'message') ouvintes.push(fn); },
    removeEventListener: (t, fn) => { const i = ouvintes.indexOf(fn); if (i >= 0) ouvintes.splice(i, 1); },
    postMessage: (data) => { setTimeout(() => { for (const fn of ouvintes.slice()) fn({ source: w, data }); }, 0); },
  };
  return w;
}
let api = null, erroCarga = null;
const w = janelaFalsa();
const logs = [];
try {
  // eslint-disable-next-line no-new-func
  api = new Function('window', 'console', js + '\nreturn { verificarBridgeInstalada, chamarBlingViaBridge, cache: () => bridgeInstaladaCache };')(w, { log: (...a) => logs.push(a.join(' ')), warn() {}, error() {} });
} catch (e) { erroCarga = e; }
ok(!erroCarga, '⚠️ o modulo carrega sozinho, antes do script principal (nenhuma dependencia na hora da carga)' + (erroCarga ? ' — ' + erroCarga.message : ''));
ok(api && typeof api.verificarBridgeInstalada === 'function' && typeof api.chamarBlingViaBridge === 'function', '  e expoe verificarBridgeInstalada e chamarBlingViaBridge');

(async () => {
  // a pre-deteccao do carregamento ja saiu (PING) e, com a extensao anunciando depois, a Bridge e vista
  w.postMessage({ tipo: 'GOOD_BRIDGE_INSTALADA', versao: 't' });
  await new Promise((r) => setTimeout(r, 20));
  ok(api && api.cache() === true && await api.verificarBridgeInstalada() === true, '  comportamento preservado: anuncio da extensao depois da carga marca a Bridge como presente (b668)');

  // ── 2. o painel: tag antes do script principal, bloco nao ficou duplicado ──
  const iTag = cru.indexOf('<script src="js-AMB/painel-bridge.js?v=');
  const iMain = cru.indexOf('\n  <script>\n');
  ok(iTag > 0 && iMain > 0 && iTag < iMain, '⚠️ o painel carrega js-AMB/painel-bridge.js (com ?v=) ANTES do script principal');
  ok(!/let bridgeInstaladaCache/.test(cru) && !/function verificarBridgeInstalada\(/.test(cru) && !/function chamarBlingViaBridge\(/.test(cru),
     '⚠️ o bloco SAIU do HTML (declarar a mesma `let` nos dois scripts derrubaria a pagina)');
  ok(/let bridgeInstaladaCache = null;/.test(js) && /function verificarBridgeInstalada\(/.test(js) && /function chamarBlingViaBridge\(/.test(js) && /GOOD_BRIDGE_PING/.test(js),
     '  e esta inteiro no modulo');
  ok(/verificarBridgeInstalada\(\)/.test(cru) && /chamarBlingViaBridge\(\{/.test(cru), '  o script principal continua CHAMANDO as funcoes (por clique, depois de tudo carregado)');
  ok(/setarDatasPadrao\(\);\s*\n\s*carregar\(\);\s*\n\s*<\/script>/.test(cru), '  o arranque do painel (setarDatasPadrao + carregar) ficou no script principal');

  // ── 3. a fonte composta (o que os 52 testes leem) tem o bloco no lugar da tag ──
  const composta = fonte.fontePainel();
  ok(composta.includes('/* modulo: js-AMB/painel-bridge.js */') && /let bridgeInstaladaCache = null;/.test(composta) && !/<script src="js-AMB\/painel-bridge\.js/.test(composta),
     '⚠️ a fonte composta embute o modulo (os testes do painel continuam enxergando o codigo)');
  for (const m of composta.matchAll(/<script>([\s\S]*?)<\/script>/g)) { try { new Function(m[1]); } catch (e) { ok(false, '  script do painel composto compila: ' + e.message); } }
  ok(true, '  todos os <script> do painel composto compilam');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
