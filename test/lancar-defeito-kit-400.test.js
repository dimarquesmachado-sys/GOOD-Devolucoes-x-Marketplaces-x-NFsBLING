// Roda com: node test/lancar-defeito-kit-400.test.js
//
// ⚠️ revisao Codex #245 (P1): `/api/defeitos/adicionar` devolve HTTP 400
// com corpo JSON estruturado (`kit`, `componentes_det`) quando o SKU
// escolhido e um KIT — a trava do servidor (server.js) SEMPRE manda esse
// corpo, nunca so o status. Mas `salvarDefeitoManual` fazia
// `if (!r.ok) throw ...` ANTES de `r.json()`: o throw disparava pro
// `catch` generico e a tela mostrava "Erro de conexao" pro estoquista,
// em vez de oferecer o caminho de explodir o kit nos componentes. O
// `if (d.kit && d.componentes_det...)` que vem logo depois do parse
// nunca rodava pra essa resposta.
//
// `lancarComponenteKit` tinha o MESMO padrao (mesmo comentario "b291"
// copiado) numa segunda chamada a essa rota — la o efeito e perder a
// mensagem de erro especifica do servidor, trocada por um "erro no
// {sku}" generico.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const MOD = path.join(RAIZ, 'public', 'js', 'lancar-defeito.js');
const src = fs.readFileSync(MOD, 'utf8');

// ── ⚠️ o parse do JSON NAO pode depender de `r.ok` ──────────────────
//
// Regra estatica, mais barata que rodar o modulo: nas duas chamadas a
// `/api/defeitos/adicionar`, `r.json()` tem que rodar ANTES (ou sem
// depender) de qualquer `if (!r.ok) throw` — senao o 400 estruturado
// (kit, sessao expirada) nunca chega a ser lido.
{
  ok(!/if \(!r\.ok\) throw new Error\("HTTP " \+ r\.status \+ " em o lan[çc]amento do defeito"\);/.test(src),
     '⚠️ `salvarDefeitoManual` nao joga o corpo 400 fora antes de ler');
  ok(!/if \(!r\.ok\) throw new Error\("HTTP " \+ r\.status \+ " ao lan[çc]ar o componente"\);/.test(src),
     '⚠️ `lancarComponenteKit` nao joga o corpo 400 fora antes de ler');
}

// ── e o comportamento de verdade: 400 com `kit` explode, nao "Erro de conexao" ─
{
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
    fetch: () => Promise.resolve({
      ok: false,
      status: 400,
      json: () => Promise.resolve({
        ok: false,
        erro: '"KIT1" e um KIT, nao um produto simples.',
        kit: true,
        componentes: ['1x PECA-A'],
        kit_sku: 'KIT1',
        componentes_det: [{ sku: 'PECA-A', quantidade: 1, nome: 'Peca A' }],
        composicao_completa: true,
        componentes_faltando: 0,
      }),
    }),
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { timeout: 5000 });
  ctx.window.LancarDefeito.instalar({ prefixo: '' });

  // preenche o formulario como o operador faria
  getElementById('defProblema').value = 'quebrado';
  getElementById('defLocal').value = 'DEF-A1';
  getElementById('defQtd').value = '1';
  ctx.window.selecionarProdutoDefeito({ sku: 'KIT1', nome: 'Kit Teste' }, 0);

  return (async () => {
    await ctx.window.salvarDefeitoManual();
    const msg = getElementById('defMsg').innerHTML;
    ok(!/Erro de conexao/.test(msg),
       '⚠️ 400 de kit NAO cai no catch generico ("Erro de conexao")');
    ok(/KIT/.test(msg) && /PECA-A/.test(msg),
       '  e OFERECE o componente pra lancar (explodirKitDefeito rodou)');

    console.log('');
    console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
    process.exit(falhas ? 1 : 0);
  })();
}
