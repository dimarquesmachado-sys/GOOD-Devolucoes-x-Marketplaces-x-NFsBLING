// Roda com: node test/sem-copia-entre-empresas.test.js
//
// [stated 04/09] "tá tudo em lib? se conectar mais outra empresa, já ta
// tudo no esquema?"
//
// Não estava. Medi os módulos duplicados entre GOOD e AMB:
//
//   ml-buscas      100% iguais  ← cópia byte a byte, unificado no b238
//   nf-pessoa       72%
//   defeitos-ciclo  71%
//   render-tokens   46%
//   magalu          24%
//   nf-nomes        20%
//   ml / ml-returns 15%
//   bling           11%
//
// A AMB importava só 2 arquivos da /lib compartilhada. Na prática é uma
// cópia paralela — e todo conserto vira dois consertos (a dívida que já
// apareceu várias vezes: "a AMB ficou pra trás").
//
// Este teste não conserta o passado; ele IMPEDE PIORAR:
//   - o que já foi unificado não pode voltar a ser copiado
//   - módulo NOVO nasce em /lib, não em cópia nos dois lados

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const LIB = path.join(RAIZ, 'lib');
const LIB_AMB = path.join(RAIZ, 'amb-devolucoes', 'lib-AMB');

// ── o que já foi unificado NÃO pode voltar a ter cópia ───────────────
{
  const unificados = ['ml-buscas', 'ritmo-bling'];   // cresce a cada unificação
  for (const nome of unificados) {
    const naLib = fs.existsSync(path.join(LIB, nome + '.js'));
    const copias = fs.readdirSync(LIB_AMB)
      .filter((f) => f === nome + '.js' || f === nome + '-AMB.js');
    ok(naLib, nome + ': existe em /lib');
    ok(copias.length === 0,
       '  e NAO tem copia na AMB' + (copias.length ? ' (VOLTOU: ' + copias.join(', ') + ')' : ''));
  }
}

// ── e a AMB usa mesmo a versão comum, não uma cópia escondida ────────
{
  const app = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/require\('\.\.\/lib\/ml-buscas'\)/.test(app),
     'app-AMB importa `ml-buscas` da /lib comum');
  ok(/require\('\.\.\/lib\/ritmo-bling'\)/.test(app),
     'app-AMB importa `ritmo-bling` da /lib comum');
}

// ── módulo NOVO nasce compartilhado ──────────────────────────────────
//
// A regra do dono desde 17/08: "peça nova = código ÚNICO em /lib com a
// empresa como PARÂMETRO". Se aparecer um par novo (X.js na lib e X-AMB.js
// na AMB) que não está na lista de dívida conhecida, é regressão.
{
  const DIVIDA_CONHECIDA = new Set([
    'bling', 'ml', 'ml-returns', 'magalu', 'nf-nomes', 'nf-pessoa',
    'defeitos-ciclo', 'render-tokens', 'supabase', 'auth', 'compat',
    'rotas-admin', 'identificar', 'admin-helpers', 'shopee', 'triagem',
    'espreita', 'recados', 'checkout', 'nf-devolucao', 'utils',
  ]);
  const naLib = new Set(fs.readdirSync(LIB).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)));
  const novasCopias = [];
  for (const f of fs.readdirSync(LIB_AMB)) {
    if (!f.endsWith('.js')) continue;
    const base = f.replace(/-AMB\.js$/, '').replace(/\.js$/, '');
    if (naLib.has(base) && !DIVIDA_CONHECIDA.has(base)) novasCopias.push(base);
  }
  ok(novasCopias.length === 0,
     'nenhuma copia NOVA entre GOOD e AMB'
     + (novasCopias.length ? ' (peca nova deve nascer em /lib: ' + novasCopias.join(', ') + ')' : ''));
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
