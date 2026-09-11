// Roda com: node test/lancar-defeito-kit-componente-sessao.test.js
//
// ⚠️ revisao Codex #247 (P2): a b293 ensinou `lancarComponenteKit` a jogar
// "sua sessão expirou..." quando a rota devolve 401/403 (mesmo padrao da
// `salvarDefeitoManual`) — mas o `catch` que fecha o `try` daquela chamada
// TROCAVA qualquer `e.message` por "Erro de conexao no <sku>", sem olhar
// pro que foi lancado. Quem estava lancando um componente de kit com a
// sessao expirada continuava lendo "tente de novo" em vez de "entre de
// novo": o mesmo defeito que a b293 tinha acabado de corrigir na chamada
// principal, so que nesta segunda chamada.
//
// Este teste roda o modulo de verdade (via vm) simulando um 401 na rota
// do componente e confere que a mensagem que sobra na tela e a acionavel,
// nao a generica.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const MOD = path.join(RAIZ, 'public', 'js', 'lancar-defeito.js');
const src = fs.readFileSync(MOD, 'utf8');

function el() {
  return {
    value: '', innerHTML: '', textContent: '', disabled: false,
    style: {}, files: [],
    classList: { add() {}, remove() {} },
    focus() {}, appendChild() {},
  };
}
const elementos = new Map();
const getElementById = (id) => {
  if (!elementos.has(id)) elementos.set(id, el());
  return elementos.get(id);
};

const ctx = {
  console: { log() {}, error() {}, warn() {} },
  setTimeout, JSON, Date, Math, Promise, encodeURIComponent,
  document: {
    getElementById,
    createElement: () => el(),
    body: { appendChild() {} },
    addEventListener() {},
    querySelectorAll: () => [],
  },
  FormData: function () { this.append = () => {}; },
  FileReader: function () {},
  alert() {},
  // a rota do componente responde 401 (sessao expirada), com o corpo que o
  // servidor de verdade manda ("Sessao invalida ou expirada")
  fetch: () => Promise.resolve({
    ok: false,
    status: 401,
    json: () => Promise.resolve({ ok: false, erro: 'Sessao invalida ou expirada' }),
  }),
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { timeout: 5000 });
ctx.window.LancarDefeito.instalar({ prefixo: '' });

// monta um kit pendente com um componente, como `explodirKitDefeito` faria
ctx.window._kitPendente = {
  d: { componentes_det: [{ sku: 'PECA-A', quantidade: 1, nome: 'Peca A' }] },
  payload: { defeito: 'quebrado', localizacao: 'DEF-A1', qtd: 1, fotos: [] },
};

(async () => {
  await ctx.window.lancarComponenteKit(0);
  const msg = getElementById('defMsg').innerHTML;
  ok(!/Erro de conex[aã]o/.test(msg),
     '⚠️ 401 no lancamento de componente NAO cai na mensagem generica ("Erro de conexao")');
  ok(/sess[aã]o expirou/.test(msg),
     '  e mostra a causa real (sessao expirada)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
