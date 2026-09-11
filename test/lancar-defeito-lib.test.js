// Roda com: node test/lancar-defeito-lib.test.js
//
// ⚠️ [stated 11/09] "me tirou da tela do painel ADMIN qdo cliquei pra
// adicionar produto e me jogou na tela de triagem. me deixa na mesma tela."
//
// O modal de lançar defeito vivia INLINE no `index.html`, então só existia
// na Triagem. O painel admin carrega a mesma caixa de Estoque de Defeitos e
// ficava sem o lançamento.
//
// ⚠️ E nasce MULTI-EMPRESA (regra da casa): o prefixo das rotas é PARÂMETRO.
// GOOD usa `/api/...`, AMB usaria `/amb/api/...`. Empresa nova pluga
// passando o prefixo — sem copiar arquivo.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const MOD = path.join(RAIZ, 'public', 'js', 'lancar-defeito.js');
const src = fs.readFileSync(MOD, 'utf8');

// ── ⚠️ o prefixo e PARAMETRO, nao constante ─────────────────────────
{
  ok(/var PREFIXO = '';/.test(src), 'o prefixo e variavel do modulo');
  ok(/PREFIXO = String\(opcoes\.prefixo \|\| ''\)/.test(src),
     '  e vem do `instalar({ prefixo })`');

  // ⚠️ nenhuma rota pode estar SEM o `PREFIXO +` antes.
  //
  // Minha 1a versao contava toda ocorrencia de `'/api/`, e acusava as que
  // JA estao certas (`PREFIXO + '/api/...'`). Falso positivo em teste
  // ensina a ignorar o vermelho — conto so as que NAO tem o prefixo antes.
  // ⚠️ sem os comentarios: o cabecalho do modulo EXPLICA a regra citando
  // `/api/...` e `/amb/api/...`, e o teste acusava o proprio texto que
  // documenta o comportamento certo.
  const semComent = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const todas = [...semComent.matchAll(/(.{12})['"`]\/api\//g)];
  const semPrefixo = todas.filter((m) => !/PREFIXO \+ $/.test(m[1]));
  ok(semPrefixo.length === 0,
     '⚠️ toda rota tem `PREFIXO +` antes (sem ele: ' + semPrefixo.length + ')');
  ok(/PREFIXO \+ ['"]\/api\//.test(src),
     '  todas passam por `PREFIXO + `');
}

// ── e o módulo carrega e instala de verdade ─────────────────────────
{
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    setTimeout, JSON, Date, Math, Promise, encodeURIComponent,
    fetch: () => Promise.resolve({ ok: true, json: () => ({ ok: true, produtos: [] }) }),
    document: {
      getElementById: () => null,
      createElement: () => ({ innerHTML: '', firstChild: null, style: {}, classList: { add() {}, remove() {} } }),
      body: { appendChild() {} },
      addEventListener() {},
    },
    FormData: function () { this.append = () => {}; },
    FileReader: function () {},
    alert() {},
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);

  let carregou = true;
  try { vm.runInContext(src, ctx, { timeout: 5000 }); } catch (e) { carregou = false; }
  ok(carregou, 'o modulo carrega sem erro');
  ok(typeof ctx.window.LancarDefeito === 'object', '  e expoe `LancarDefeito`');

  // ⚠️ instala com prefixo da AMB — é o teste que prova que serve às duas
  let instalou = true;
  try { ctx.window.LancarDefeito.instalar({ prefixo: '/amb' }); } catch (e) { instalou = false; }
  ok(instalou, 'instala com prefixo da AMB');
  ok(ctx.window.LancarDefeito.prefixo === '/amb',
     '  ⚠️ e o prefixo FICA (e o que faz as rotas irem pro lugar certo)');
  ok(typeof ctx.window.abrirModalDefeito === 'function',
     '  e expoe `abrirModalDefeito` no window (a caixa de Defeitos procura ela)');
}

// ── ⚠️ e as DUAS telas da GOOD carregam e instalam ──────────────────
{
  for (const tela of ['index.html', 'painel-devolucoes.html']) {
    const h = fs.readFileSync(path.join(RAIZ, 'public', tela), 'utf8');
    ok(/<script src="js\/lancar-defeito\.js\?v=\d+"><\/script>/.test(h),
       tela + ': carrega o modulo');
    ok(/LancarDefeito\.instalar\(/.test(h), '  e chama `instalar()`');
  }
}

// ── ⚠️ revisao Codex #242: o caminho do KIT e UNICO nas duas telas ──
//
// `explodirKitDefeito`/`lancarComponenteKit` viviam SO no index.html.
// No painel, a funcao nao existia e o lançamento de um kit caia num
// fallback que dizia "Defeito lançado" com o servidor tendo devolvido
// 400 e nada gravado — sucesso falso. Na Triagem, a funcao chamava
// `escDef` como global, que ja tinha virado privada desta IIFE —
// ReferenceError silencioso. Nao pode sobrar variante condicional.
{
  ok(/function explodirKitDefeito\(d, payload, msg\)/.test(src),
     '⚠️ `explodirKitDefeito` vive AQUI (modulo compartilhado), nao so numa tela');
  ok(/function lancarComponenteKit\(indice\)/.test(src),
     '  junto com `lancarComponenteKit`');
  ok(!/typeof window\.explodirKitDefeito === 'function'/.test(src),
     '  ⚠️ e o `salvarDefeitoManual` NAO tem mais fallback condicional');
  ok(/explodirKitDefeito\(d, payload, msg\);\s*\n\s*return;/.test(src),
     '  chama direto, sem `typeof ... === \'function\'` por perto');
  ok(/window\.explodirKitDefeito = explodirKitDefeito;/.test(src),
     '  e fica exposta em `window` (o HTML gerado chama por `onclick`)');
  ok(/window\.lancarComponenteKit = lancarComponenteKit;/.test(src),
     '  igual `lancarComponenteKit`');
  ok(/function instalarZoomSeFaltar/.test(src),
     '  e o zoom da foto continua com fallback (erro em onclick suja o console)');
}

// ── ⚠️ revisao Codex #242: o estado escolhido e DO MODULO ───────────
//
// Era `_defProdutoEscolhido = null;` sem `var`, dentro de
// `abrirModalDefeito`. Funcionava por acidente no index.html (que
// declarava a mesma var solta no proprio inline script). No painel, sem
// essa declaracao em lugar nenhum, a atribuicao em modo estrito lançava
// `ReferenceError` e travava o primeiro clique.
{
  ok(/var _defProdutoEscolhido = null;/.test(src),
     '⚠️ `_defProdutoEscolhido` e declarada DENTRO do modulo (nao depende do host)');
  const indexHtml = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8');
  ok(!/_defProdutoEscolhido/.test(indexHtml),
     '  e o index.html nao tem mais a declaracao solta (era o que mascarava o bug)');
}

// ── ⚠️ revisao Codex #242: o modal leva a propria folha de estilo ───
//
// No painel-devolucoes.html, o modal injetado nao tinha `.modal-bg`/
// `.modal-bg.show`/`.modal` em lugar nenhum (essas classes so existem em
// `styles.css`, que o painel nao importa) — o formulario renderizava
// como conteudo comum no fim da pagina, visivel desde o carregamento.
{
  ok(/function instalarEstilo\(\)/.test(src),
     '⚠️ o modulo tem uma função que injeta a própria folha de estilo');
  ok(/instalarEstilo\(\);/.test(src),
     '  chamada durante o `instalar()`');
  ok(/#modalDefeito\.modal-bg\{/.test(src) && /#modalDefeito\.modal-bg\.show\{/.test(src),
     '  ⚠️ e cobre o `.modal-bg`/`.modal-bg.show` (sem eles, "show" nao vira overlay)');
  ok(/document\.getElementById\('lancarDefeitoEstilo'\)/.test(src),
     '  ⚠️ e nao injeta duas vezes (guarda por id)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
