'use strict';
// b668 — A DETECCAO DA BRIDGE NAO PODE PERDER A CORRIDA DO CARREGAMENTO.
//
// ⚠️ CASO REAL (GOOD, 07/11): Toolbox 2.1.8 instalada e o "Gerar NF" dizendo
// "Extensao de devolucoes nao detectada". A pre-deteccao do painel roda durante o
// parse da pagina; o content script da extensao so e injetado em `document_idle`,
// depois da pagina carregar — num painel pesado, mais de 1,5 s. O PING saia antes
// da extensao existir, o timeout gravava `false` no cache e nunca mais perguntava.
//
// O teste roda o codigo REAL do painel (extraido do HTML) com um `window` falso
// que entrega postMessage aos ouvintes, e simula a extensao chegando DEPOIS do
// primeiro PING.
//
// Roda com: node test/bridge-deteccao-sem-corrida.test.js

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');

// ── o trecho real: do cache ate o fim de verificarBridgeInstalada ──
const ini = html.indexOf('let bridgeInstaladaCache = null;');
const fim = html.indexOf('// Manda pedido pra Bridge criar a devolucao no Bling', ini);
ok(ini > 0 && fim > ini, '⚠️ achei o bloco de deteccao da Bridge no painel');
const trecho = html.slice(ini, fim);

function janelaFalsa() {
  const ouvintes = [];
  const w = {
    addEventListener: (tipo, fn) => { if (tipo === 'message') ouvintes.push(fn); },
    removeEventListener: (tipo, fn) => { const i = ouvintes.indexOf(fn); if (i >= 0) ouvintes.splice(i, 1); },
    postMessage: (data) => { setTimeout(() => { for (const fn of ouvintes.slice()) fn({ source: w, data }); }, 0); },
  };
  return w;
}
// uma "extensao" que ainda NAO esta na pagina: nao responde PING. Quando injeta, anuncia INSTALADA e passa a responder.
function extensaoFalsa(w) {
  const ext = { injetada: false };
  ext.injetar = () => {
    ext.injetada = true;
    w.addEventListener('message', (ev) => {
      if (ev.data && ev.data.tipo === 'GOOD_BRIDGE_PING') w.postMessage({ tipo: 'GOOD_BRIDGE_PONG', versao: 'teste' });
    });
    w.postMessage({ tipo: 'GOOD_BRIDGE_INSTALADA', versao: 'teste' });
  };
  return ext;
}
function montar(w) {
  // eslint-disable-next-line no-new-func
  const f = new Function('window', trecho + '\nreturn { verificarBridgeInstalada };');
  return f(w);
}

(async () => {
  // 1. a corrida: PING antes da extensao -> false; extensao injeta depois -> a proxima chamada tem que dar true
  const w = janelaFalsa(); const ext = extensaoFalsa(w); const painel = montar(w);
  const r1 = await painel.verificarBridgeInstalada();
  ok(r1 === false, '  sem extensao na pagina, a 1a checagem da false (timeout de 1,5 s)');
  ext.injetar();
  await new Promise((r) => setTimeout(r, 20));
  const r2 = await painel.verificarBridgeInstalada();
  ok(r2 === true, '⚠️ a extensao injetou DEPOIS do 1o PING: a checagem seguinte detecta (antes ficava false pra sempre)');

  // 2. extensao presente desde o inicio: PING/PONG normal
  const w2 = janelaFalsa(); const ext2 = extensaoFalsa(w2); ext2.injetar(); const painel2 = montar(w2);
  ok(await painel2.verificarBridgeInstalada() === true, '  extensao presente desde o inicio: detectada pelo PING/PONG');

  // 3. sem extensao nenhuma, continua false (nao inventa presenca)
  const w3 = janelaFalsa(); const painel3 = montar(w3);
  ok(await painel3.verificarBridgeInstalada() === false, '  sem extensao nenhuma: false, sem falso positivo');

  // 4. invariantes de texto
  const semCom = trecho.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(!/bridgeInstaladaCache = false/.test(semCom), '⚠️ resultado negativo nunca e gravado no cache');
  ok(/GOOD_BRIDGE_INSTALADA/.test(semCom) && /bridgeInstaladaCache = true/.test(semCom), '  o anuncio INSTALADA da extensao marca a Bridge como presente');
  ok(/Toolbox 2\.1\+/.test(html), '  a mensagem de erro nomeia a Toolbox (a extensao unificada de hoje)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
