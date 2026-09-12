// Roda com: node test/lancar-outra-peca.test.js
//
// ⚠️ [stated 11/09] "esse eu inseri o defeito aquela hora, salvou tudo OK!
// (...) eu tenho outro produto desse no estoque `LV-ASH-4` e tenho q
// adicionar uma segunda peça com defeito. Não aparece o botão"
//
// O botão de lançar só existia no caminho do VAZIO. Mas ter um defeito
// registrado NÃO IMPEDE ter outro — são PEÇAS FÍSICAS diferentes, e no
// galpão isso é comum: chega uma segunda unidade quebrada do mesmo produto.
//
// O jeito antigo obrigava a fechar a caixa, abrir "Lançar Defeito" no topo e
// digitar o SKU de novo — o atalho que viemos construir.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const src = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'defeitos-ficha.js'), 'utf8');
const semC = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── o botão aparece COM resultado também ────────────────────────────
{
  ok(/var podeLancarOutra = termoBusca/.test(semC),
     '⚠️ ha caminho pra lançar OUTRA peça quando a busca ACHA');
  ok(/Lançar OUTRA peça de/.test(semC),
     '  com texto que diz que e outra peça');
  ok(/Cada peça é um registro/.test(semC),
     '  explicando por que (cada peça e um registro)');
}

// ── ⚠️ e respeita as lições das rodadas anteriores ──────────────────
{
  // b287: este arquivo é IIFE — tem que alcançar por window
  ok(/typeof window\.abrirModalDefeito === 'function'/.test(semC),
     '⚠️ alcanca a funcao por `window.` (este arquivo e uma IIFE)');

  // b287.1: no painel admin o modal não existe — lá o botão não aparece
  ok(/podeLancarOutra = termoBusca\s*\n?\s*&& typeof window\.abrirModalDefeito/.test(semC),
     '  e so aparece onde o modal EXISTE');

  // b286: erro que só vai pro console não existe para quem opera
  ok(/nao consegui abrir: ' \+ esc\(err\.message\)/.test(semC),
     '⚠️ e a falha aparece NA TELA (nao so no console)');
}

// ── e o id do botão bate com o que o código procura ─────────────────
//
// ⚠️ Foi assim que a lista quebrou duas vezes hoje: id montado de um jeito
// e procurado de outro.
{
  const idHtml = /id="(btnLancarOutra)"/.exec(src);
  ok(!!idHtml, 'o botao tem id no HTML');
  ok(/getElementById\('btnLancarOutra'\)/.test(src),
     '  e o codigo procura exatamente esse id');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
