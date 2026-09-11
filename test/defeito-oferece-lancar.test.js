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
  ok(/Esse SKU ainda não tem defeito registrado/.test(ficha),
     '  explicando que o vazio esta CERTO (nao e falha)');

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

// ── ⚠️ e o onclick gerado COMPILA ───────────────────────────────────
//
// Minha 1ª versão usava `JSON.stringify`, que gera aspas DUPLAS — elas
// fecham o atributo `onclick="..."` antes da hora e quebram o botão (e a
// tela junto). Peguei testando o onclick com `new Function()`, não lendo.
{
  ok(/&#39;/.test(ficha),
     '⚠️ usa aspas simples ESCAPADAS (JSON.stringify quebraria o atributo)');
  ok(!/abrirModalDefeito\(' \+ JSON\.stringify/.test(ficha),
     '  e nao voltou pro JSON.stringify');

  // simula o onclick com SKUs problemáticos
  const esc = (s) => String(s).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  for (const termo of ['LV-ASH-4', "SKU'X", 'A<B&C']) {
    const oc = "if (typeof fecharCaixaDefeitos === 'function') fecharCaixaDefeitos();"
      + 'abrirModalDefeito(&#39;' + esc(termo.replace(/'/g, '')) + '&#39;)';
    const real = oc.replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    let compila = true;
    try { new Function(real); } catch (e) { compila = false; }
    ok(compila, '  o onclick compila com SKU "' + termo + '"');
  }
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
