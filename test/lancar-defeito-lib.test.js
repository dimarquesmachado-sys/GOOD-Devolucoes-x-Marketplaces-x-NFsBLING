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

// ── e funções que só existem na Triagem são opcionais ───────────────
//
// ⚠️ `explodirKitDefeito` vive no index.html e só faz sentido lá. No painel
// não existe — chamar direto derrubaria o lançamento, que é o que o dono
// veio fazer.
{
  ok(/typeof window\.explodirKitDefeito === 'function'/.test(src),
     '⚠️ `explodirKitDefeito` e chamada SE existir (nao derruba o lançamento)');
  ok(/function instalarZoomSeFaltar/.test(src),
     '  e o zoom da foto tem fallback (erro em onclick suja o console)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
