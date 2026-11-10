'use strict';
// test/_fonte-painel.js — FATIA 0 da modularizacao (docs/MODULARIZACAO.md).
//
// ⚠️ POR QUE EXISTE
//
// 52 testes leem `amb-devolucoes/public-AMB/painel-AMB.html` como TEXTO e procuram
// codigo la dentro (83 pontos de leitura, em meia duzia de formatos: readFileSync
// direto, listas de caminhos lidas por um `rd()`, `fs2`/`fs3`...). O painel vai ter
// o JS movido para `js-AMB/painel-<tema>.js`. Sem isto, cada fatia deixaria a
// bateria vermelha — ou, pior, VERDE por nao achar mais o que procurava.
//
// O que faz: quando um teste (ou o verifica.js) le o painel em utf8, recebe o HTML
// com cada `<script src="js-AMB/painel-*.js?v=..."></script>` trocado pelo conteudo
// do modulo, embutido num <script> no MESMO lugar — o texto que o teste ve e o do
// painel como se o codigo nunca tivesse saido. Enquanto nao houver modulo externo, o
// resultado e identico ao arquivo.
//
// Como se usa: `require('./_fonte-painel');` no topo do teste (uma linha). Quem
// precisa do arquivo cru (ex.: conferir as tags e o ?v=) chama `fonteCrua()`.
// `test/painel-fonte-unica.test.js` acusa teste que le o painel sem isto.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PAINEL = path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html');
const DIR_JS = path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'js-AMB');
const TAG_MODULO = /<script src="js-AMB\/(painel-[a-z0-9-]+\.js)(?:\?v=[^"]*)?"><\/script>/g;

// o leitor ORIGINAL, guardado antes de qualquer troca (um segundo require nao re-embrulha)
const lerOriginal = fs.__lerOriginalFontePainel || fs.readFileSync;

function compor(html, lerModulo) {
  return String(html).replace(TAG_MODULO, (tag, nome) => {
    const js = lerModulo(nome);
    return js == null ? tag : '<script>/* modulo: js-AMB/' + nome + ' */\n' + js + '\n</script>';
  });
}

function fonteCrua() { return lerOriginal.call(fs, PAINEL, 'utf8'); }

function modulosDoPainel() {
  return [...fonteCrua().matchAll(TAG_MODULO)].map((m) => m[1]);
}

function fontePainel() {
  return compor(fonteCrua(), (nome) => {
    const p = path.join(DIR_JS, nome);
    return fs.existsSync(p) ? lerOriginal.call(fs, p, 'utf8') : null;
  });
}

if (!fs.__lerOriginalFontePainel) {
  fs.__lerOriginalFontePainel = lerOriginal;
  fs.readFileSync = function readFileSyncComFontePainel(arquivo, opcoes) {
    const utf8 = opcoes === 'utf8' || opcoes === 'utf-8' || (opcoes && (opcoes.encoding === 'utf8' || opcoes.encoding === 'utf-8'));
    if (utf8 && typeof arquivo === 'string' && path.resolve(arquivo) === PAINEL) return fontePainel();
    return lerOriginal.apply(fs, arguments);
  };
}

module.exports = { fontePainel, fonteCrua, compor, modulosDoPainel, PAINEL, DIR_JS, TAG_MODULO };
