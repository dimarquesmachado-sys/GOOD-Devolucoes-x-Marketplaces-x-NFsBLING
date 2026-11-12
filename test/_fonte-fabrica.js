'use strict';
// test/_fonte-fabrica.js — a fonte da FABRICA (amb-devolucoes/app-AMB.js) como os testes a leem.
//
// ⚠️ POR QUE EXISTE (docs/MODULARIZACAO.md — fatias da fabrica)
//
// 62 testes leem `app-AMB.js` como TEXTO e procuram codigo la dentro. A fabrica e UMA funcao de
// ~4.200 linhas (criarAppEmpresa); pra caber no teto, blocos dela saem pra `lib-AMB/<tema>-AMB.js`
// como `registrar(router, deps)`. Sem isto, cada bloco movido deixaria testes vermelhos — ou verdes
// por nao acharem mais o que procuravam.
//
// Mesmo desenho do painel (test/_fonte-painel.js): no lugar de onde o bloco saiu ficam, em app-AMB.js,
//     // @fabrica-modulo lib-AMB/<arquivo>-AMB.js#<secao>
//     require('./lib-AMB/<arquivo>-AMB')(router, { ...deps });   // @fabrica-chamada
// e no modulo o bloco fica entre `// @secao <secao>` e `// @fim-secao`. Quem le app-AMB.js em utf8
// recebe o bloco DE VOLTA no lugar da marca (e sem a linha da chamada): o texto de antes da fatia.
//
// Como se usa: `require('./_fonte-fabrica');` no topo do teste. `fonteCruaFabrica()` da o arquivo cru.
// `test/fabrica-fonte-unica.test.js` acusa teste que le a fabrica sem isto.

const painel = require('./_fonte-painel');   // garante o leitor original guardado (fs.__lerOriginalFontePainel)
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const FABRICA = path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js');
const DIR_FABRICA = path.join(RAIZ, 'amb-devolucoes');
const MARCA_FABRICA = /^[ \t]*\/\/ @fabrica-modulo (lib-AMB\/[A-Za-z0-9-]+\.js)#([A-Za-z0-9-]+)[ \t]*$/gm;
const CHAMADA_FABRICA = /^[^\n]*\/\/ @fabrica-chamada[ \t]*\n/gm;

const lerOriginal = fs.__lerOriginalFontePainel;

// secoes de um modulo da fabrica: do `// @secao nome` ate o `// @fim-secao` (a funcao registradora
// continua depois — a chave que a fecha NAO faz parte do bloco)
function secoesDaFabrica(js) {
  const secoes = new Map();
  let nome = null, linhas = [];
  for (const l of String(js).split('\n')) {
    const a = l.match(/^[ \t]*\/\/ @secao ([A-Za-z0-9-]+)\s*$/);
    if (a) { nome = a[1]; linhas = []; continue; }
    if (/^[ \t]*\/\/ @fim-secao\s*$/.test(l)) { if (nome != null) secoes.set(nome, linhas.join('\n')); nome = null; continue; }
    if (nome != null) linhas.push(l);
  }
  return secoes;
}

function comporFabrica(src, lerModulo) {
  const voltou = new Set();
  let out = String(src).replace(MARCA_FABRICA, (linha, arq, secao) => {
    const js = lerModulo(arq);
    const txt = js == null ? null : secoesDaFabrica(js).get(secao);
    if (txt == null) return linha;
    voltou.add(arq);
    return txt;
  });
  if (voltou.size) out = out.replace(CHAMADA_FABRICA, '');
  return out;
}

function fonteCruaFabrica() { return lerOriginal.call(fs, FABRICA, 'utf8'); }
function modulosDaFabrica() { return [...new Set([...fonteCruaFabrica().matchAll(MARCA_FABRICA)].map((m) => m[1]))]; }
function fonteFabrica() {
  return comporFabrica(fonteCruaFabrica(), (arq) => {
    const p = path.join(DIR_FABRICA, arq);
    return fs.existsSync(p) ? lerOriginal.call(fs, p, 'utf8') : null;
  });
}

if (!fs.__fonteFabricaInstalada) {
  fs.__fonteFabricaInstalada = true;
  const anterior = fs.readFileSync;            // ja pode ser o embrulho do painel
  fs.readFileSync = function readFileSyncComFonteFabrica(arquivo, opcoes) {
    const utf8 = opcoes === 'utf8' || opcoes === 'utf-8' || (opcoes && (opcoes.encoding === 'utf8' || opcoes.encoding === 'utf-8'));
    if (utf8 && typeof arquivo === 'string' && path.resolve(arquivo) === FABRICA) return fonteFabrica();
    return anterior.apply(fs, arguments);
  };
}

module.exports = { fonteFabrica, fonteCruaFabrica, comporFabrica, secoesDaFabrica, modulosDaFabrica, FABRICA, DIR_FABRICA, MARCA_FABRICA, CHAMADA_FABRICA, painel };
