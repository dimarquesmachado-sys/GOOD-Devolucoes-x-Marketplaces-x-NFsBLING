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

// b682 - A FONTE COMPOSTA REPRODUZ A ORDEM ORIGINAL DO PAINEL.
//
// A 1a versao embutia o modulo no lugar da TAG (no topo, antes do script principal). Os testes do
// painel recortam texto entre dois marcos (`indexOf('function A')` ... `indexOf('function B', i)`);
// com um bloco mudando de lugar no texto, um recorte que cruza a fronteira fica MAIOR sem ninguem
// ver — o teste segue verde olhando pra mais codigo do que devia ("verde por nao achar mais o que
// procurava"). Agora cada bloco deixa, no script principal, uma linha de marca no lugar de onde
// saiu (`// @painel-modulo js-AMB/painel-x.js#secao`) e o modulo marca o comeco de cada secao
// (`// @secao nome`): a fonte composta poe cada secao DE VOLTA no lugar e tira a tag. O texto que
// o teste le e o do painel de antes das fatias. Modulo com tag e sem marca (nao deveria existir)
// ainda e embutido no lugar da tag — nada some.
const MARCA_MODULO = /^[ \t]*\/\/ @painel-modulo js-AMB\/(painel-[a-z0-9-]+\.js)#([A-Za-z0-9-]+)[ \t]*$/gm;

function secoesDoModulo(js) {
  const secoes = new Map();
  let nome = null, linhas = [];
  const fechar = () => { if (nome != null) { while (linhas.length && linhas[linhas.length - 1].trim() === '') linhas.pop(); secoes.set(nome, linhas.join('\n')); } };
  for (const l of String(js).split('\n')) {
    const m = l.match(/^\/\/ @secao ([A-Za-z0-9-]+)\s*$/);
    if (m) { fechar(); nome = m[1]; linhas = []; continue; }
    if (nome != null) linhas.push(l);
  }
  fechar();
  return secoes;
}

function compor(html, lerModulo) {
  const noLugar = new Set();
  let out = String(html).replace(MARCA_MODULO, (linha, nome, secao) => {
    const js = lerModulo(nome);
    const txt = js == null ? null : secoesDoModulo(js).get(secao);
    if (txt == null) return linha;
    noLugar.add(nome);
    return '/* modulo: js-AMB/' + nome + '#' + secao + ' */\n' + txt;
  });
  out = out.replace(TAG_MODULO, (tag, nome) => {
    if (noLugar.has(nome)) return '';                 // as secoes ja voltaram pro lugar
    const js = lerModulo(nome);
    return js == null ? tag : '<script>/* modulo: js-AMB/' + nome + ' */\n' + js + '\n</script>';
  });
  return out;
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

module.exports = { fontePainel, fonteCrua, compor, secoesDoModulo, modulosDoPainel, PAINEL, DIR_JS, TAG_MODULO, MARCA_MODULO };
