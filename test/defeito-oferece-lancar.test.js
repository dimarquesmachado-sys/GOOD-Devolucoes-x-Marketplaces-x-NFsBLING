// Roda com: node test/defeito-oferece-lancar.test.js
//
// ⚠️ CASO REAL (11/09): o dono foi LANÇAR um defeito do SKU LV-ASH-4.
// Buscou no Estoque de Defeitos, leu "nada encontrado" — que estava CERTO,
// não há defeito desse SKU — e o caminho morria ali. Ele teria que fechar a
// tela, abrir "Lançar Defeito" e digitar o SKU de novo.
//
// A tela SABIA o SKU e não oferecia nada. Quem busca um SKU sem defeito
// quase sempre quer lançar um.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const ficha = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'defeitos-ficha.js'), 'utf8');
// ⚠️ b289: o modal saiu do `index.html` inline pro modulo compartilhado
// `js/lancar-defeito.js`. Os testes que conferiam o comportamento DELE
// passam a ler o modulo; os que conferem a TELA continuam no html.
const html = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8');
const modal = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'lancar-defeito.js'), 'utf8');

// ── o "nada encontrado" oferece o caminho ───────────────────────────
{
  ok(/Lançar defeito para/.test(ficha),
     'o "nada encontrado" oferece LANCAR pro SKU buscado');
  // ⚠️ b285: a tela dizia "nada encontrado." E LOGO ABAIXO "esse SKU ainda
  // nao tem defeito" — duas frases pro mesmo fato, e a primeira soa como
  // BUSCA QUEBRADA. O dono leu como erro meu.
  ok(/Nenhum defeito registrado para/.test(ficha),
     '  numa frase SO, que diz o que aconteceu (nao "nada encontrado")');
  ok(/a busca falhou/.test(ficha) && /color:#b00/.test(ficha),
     '  ⚠️ e a falha DE VERDADE fica visivelmente diferente (vermelha)');

  // ⚠️ e só quando NÃO houve erro: se a consulta falhou, oferecer lançar
  // seria esconder o problema
  ok(/termoBusca && !d\.erro/.test(ficha),
     '  ⚠️ e SO quando nao houve erro (senao esconderia falha de consulta)');
}

// ── ⚠️ e chama as funções que EXISTEM ───────────────────────────────
//
// Eu tinha escrito `fecharDefeitos` de cabeça — não existe. O nome real é
// `fecharCaixaDefeitos`, exposto em `window`. Regra 4.12.
{
  ok(/fecharCaixaDefeitos/.test(ficha), 'chama `fecharCaixaDefeitos` (o nome real)');
  ok(/window\.fecharCaixaDefeitos = fechar/.test(ficha),
     '  que esta exposto em window (senao o onclick nao alcanca)');
  ok(/function abrirModalDefeito\(skuInicial\)/.test(modal),
     'e `abrirModalDefeito` aceita o SKU de partida');
}

// ── ⚠️ o evento e ligado NO CODIGO, nao por `onclick` em texto ──────
//
// O botão anterior montava o código dentro de `onclick="..."`. O HTML saía
// certo (testei o gerado com `new Function`), mas o dono clicava, o card
// sumia e o modal não abria — TRÊS vezes seguidas, inclusive depois de
// Ctrl+F5 com a mensagem nova já na tela.
//
// Com `onclick` em texto, qualquer erro dentro da função vira silêncio: a
// caixa já fechou e não sobra nada na tela. Ligando no código, o erro é
// capturável — e vai para a TELA, não só para o console.
{
  ok(/btn\.onclick = function \(\)/.test(ficha),
     '⚠️ o evento e ligado no codigo (nao `onclick` montado em texto)');
  ok(/id="btnLancarDoVazio"/.test(ficha),
     '  com id proprio pra achar o botao');
  ok(!/onclick="if \(typeof fecharCaixaDefeitos/.test(ficha),
     '  e o onclick em texto SAIU');
}

// ── ⚠️ e a ORDEM: abre o modal ANTES de fechar a caixa ──────────────
//
// Na ordem anterior, se o modal falhasse, a caixa já estava fechada e
// sobrava tela vazia. Assim, se algo der errado, ele continua vendo a lista
// de onde veio.
{
  // ⚠️ b287: a chamada virou `abrir(termoBusca)`, com `abrir` vindo de
  // `window.abrirModalDefeito` — este arquivo e uma IIFE e nao alcanca o
  // escopo do `<script>` inline direto.
  const iAbre = ficha.indexOf('abrir(termoBusca)');
  const iFecha = ficha.indexOf('fecharCaixaDefeitos();', iAbre);
  ok(iAbre > 0 && iFecha > iAbre,
     '⚠️ abre o modal ANTES de fechar a caixa (se falhar, ele nao fica sem nada)');
}

// ── ⚠️ e a falha aparece NA TELA ────────────────────────────────────
//
// O dono ficou olhando tela vazia e teve que me avisar 3 vezes. Erro que só
// vai para o console não existe para quem está operando.
{
  // ⚠️ e a busca passa pelo `window`, nao pelo escopo local
  ok(/window\.abrirModalDefeito/.test(ficha),
     '⚠️ alcanca a funcao por `window.` (este arquivo e uma IIFE)');
  const html2 = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8');
  ok(/window\.abrirModalDefeito = abrirModalDefeito/.test(modal),
     '  e o index.html EXPOE explicitamente (nao depende de "em teoria")');

  ok(/nao consegui abrir o lançamento/.test(ficha),
     '⚠️ a falha e escrita NA TELA (nao so no console)');
  ok(/Lançar Defeito" no topo da tela/.test(ficha),
     '  com o caminho alternativo, pra ele nao ficar travado');
  ok(/console\.error\('\[DEFEITOS\]/.test(ficha),
     '  e tambem no console, pra diagnostico');
}

// ── e o modal dispara a busca, não só preenche ──────────────────────
//
// ⚠️ Preencher o campo e deixar o dono apertar Enter seria fazer metade do
// caminho.
{
  ok(/if \(sku\) setTimeout\(function \(\) \{ buscarProdutoDefeito\(\); \}/.test(modal),
     'com SKU de partida, o modal DISPARA a busca do produto');
}

// ── ⚠️ e o modal ABRE mesmo se a limpeza falhar ─────────────────────
//
// CASO REAL (11/09): o dono clicou o botão novo, a caixa de Defeitos
// FECHOU e o modal NÃO ABRIU — tela vazia, sem erro visível e sem caminho
// de volta.
//
// A causa: a limpeza rodava ANTES de `classList.add('show')`, e várias
// linhas faziam `getElementById(x).value = ''` sem conferir se o elemento
// existe. Um id ausente lança TypeError, a função morre — e como quem
// chamou já tinha fechado a caixa, sobra tela vazia.
{
  const i = modal.indexOf('function abrirModalDefeito');
  const j = modal.indexOf('function fecharModalDefeito');
  const corpo = modal.slice(i, j);

  // ⚠️ a ordem: abrir vem ANTES da limpeza
  const iShow = corpo.indexOf("classList.add('show')");
  const iLimpa = corpo.indexOf("valor('defProblema'");
  ok(iShow > 0 && iLimpa > iShow,
     '⚠️ o modal ABRE antes da limpeza (modal sujo da pra usar; tela vazia nao)');

  // e cada acesso é protegido
  ok(/const valor = \(id, v\) => \{ const n = el\(id\); if \(n\) n\.value = v; \}/.test(corpo),
     '  e os acessos passam por helper que confere se o elemento existe');
  ok(!/document\.getElementById\('def\w+'\)\.value = /.test(corpo),
     '  ⚠️ e nao sobrou acesso direto sem protecao (era o que matava a funcao)');
}

// ── ⚠️ e no PAINEL o botao LEVA pra triagem, nao some ───────────────
//
// CASO REAL (11/09): o dono buscou LV-ASH-4 e o botão SUMIU. Estava certo —
// ele estava no `painel-devolucoes.html`, que não tem o modal. Mas sumir
// não o ajuda: ele quer lançar o defeito, e a tela sabe o SKU.
//
// ⚠️ E eu passei 5 rodadas assumindo que ele estava na TRIAGEM, sem
// perguntar de qual tela. A URL estava no print desde o começo.
{
  ok(/var semLancadorAqui = termoBusca && !d\.erro && !lancadorDisponivel/.test(ficha),
     '⚠️ onde nao ha modal, a tela sabe disso explicitamente');
  ok(/href="\/index\.html\?lancarDefeito=/.test(ficha)
     || /index\.html\?lancarDefeito=/.test(ficha),
     '  e o botao vira LINK pra triagem, levando o SKU');
  ok(/Abre a tela de Triagem/.test(ficha),
     '  dizendo pra onde vai (nao e um link mudo)');
}

// ── e a triagem RECEBE o SKU e abre sozinha ─────────────────────────
//
// ⚠️ Sem isto ele chegaria numa tela em branco e teria que digitar o SKU de
// novo — que é exatamente o atalho que viemos construir.
{
  ok(/p\.get\('lancarDefeito'\)/.test(html),
     'a triagem le o SKU da querystring');
  ok(/history\.replaceState/.test(html),
     '  ⚠️ e LIMPA a querystring (senao o modal reabre a cada recarga)');
  ok(/DOMContentLoaded/.test(html),
     '  esperando o DOM (este script roda no meio da pagina)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
