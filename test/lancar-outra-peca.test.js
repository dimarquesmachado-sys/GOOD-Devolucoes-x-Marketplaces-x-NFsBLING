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
  ok(/var skuLancarOutra = skusAchados\.length === 1 \? skusAchados\[0\] : null;/.test(semC),
     '⚠️ ha caminho pra lançar OUTRA peça quando a busca ACHA');
  ok(/Lançar OUTRA peça de/.test(semC),
     '  com texto que diz que e outra peça');
  ok(/Cada peça é um registro/.test(semC),
     '  explicando por que (cada peça e um registro)');
}

// ── b303 (apontamento do Codex #260): termoBusca vive FORA do if ────
//
// `var` e funcao-scoped: declarado dentro do `if (!d.ok || !itens.length)`,
// o nome existe no resto da funcao mas so GANHA VALOR quando aquele if
// roda. Os dois ramos sao mutuamente exclusivos (o if termina em `return`),
// entao no ramo "achou resultado" (onde o b302 vive) o valor ficava
// `undefined` pra sempre — o proprio caso que motivou o botao nunca
// disparava. A declaracao/atribuicao tem que vir ANTES do `if`.
{
  const antesDoIf = semC.split('if (!d.ok || !itens.length) {')[0];
  ok(/var termoBusca = String\(q \|\| ''\)\.trim\(\);/.test(antesDoIf),
     '⚠️ termoBusca e atribuido ANTES do if (nao so dentro do ramo vazio)');
}

// ── b303 (apontamento do Codex #260): usa o SKU achado, nao o termo bruto ─
//
// A busca tambem acha por numero da peça, NF ou localizacao — nesses casos
// o termo digitado nao e um SKU, e /api/produtos/buscar so acha por
// SKU/EAN/nome. Passar o termo bruto podia abrir o modal sem achar nada.
{
  ok(/var skusAchados = itens\.reduce/.test(semC),
     '⚠️ calcula os SKUs de fato retornados pela busca');
  ok(/window\.abrirModalDefeito\(skuLancarOutra\)/.test(semC),
     '  e manda o SKU resolvido pro modal, nao o termo digitado');
}

// ── b303 (apontamento do Codex #260): fecha a caixa DEPOIS de abrir ──
//
// #caixaDefeitos tem z-index 2000 (fica por cima de tudo na busca);
// #modalDefeito tem z-index 1000. Sem fechar a caixa depois de abrir o
// modal, ele abre por TRAS dela — visualmente identico a nao ter feito
// nada.
{
  ok(/window\.abrirModalDefeito\(skuLancarOutra\);[\s\S]{0,200}fecharCaixaDefeitos/.test(semC),
     '⚠️ fecha #caixaDefeitos depois que o modal abre (senao ele fica atras)');
}

// ── ⚠️ e respeita as lições das rodadas anteriores ──────────────────
{
  // b287: este arquivo é IIFE — tem que alcançar por window
  ok(/typeof window\.abrirModalDefeito === 'function'/.test(semC),
     '⚠️ alcanca a funcao por `window.` (este arquivo e uma IIFE)');

  // b287.1: no painel admin o modal não existe — lá o botão não aparece
  ok(/podeLancarOutra = skuLancarOutra\s*\n?\s*&& typeof window\.abrirModalDefeito/.test(semC),
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
