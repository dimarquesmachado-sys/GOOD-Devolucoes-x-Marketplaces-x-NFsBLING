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
const html = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8');

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
  ok(/function abrirModalDefeito\(skuInicial\)/.test(html),
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
  const iAbre = ficha.indexOf('abrirModalDefeito(termoBusca)');
  const iFecha = ficha.indexOf('fecharCaixaDefeitos();', iAbre);
  ok(iAbre > 0 && iFecha > iAbre,
     '⚠️ abre o modal ANTES de fechar a caixa (se falhar, ele nao fica sem nada)');
}

// ── ⚠️ e a falha aparece NA TELA ────────────────────────────────────
//
// O dono ficou olhando tela vazia e teve que me avisar 3 vezes. Erro que só
// vai para o console não existe para quem está operando.
{
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
  ok(/if \(sku\) setTimeout\(function \(\) \{ buscarProdutoDefeito\(\); \}/.test(html),
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
  const i = html.indexOf('function abrirModalDefeito');
  const j = html.indexOf('function fecharModalDefeito');
  const corpo = html.slice(i, j);

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

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
