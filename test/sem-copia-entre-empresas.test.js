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
  const unificados = ['ml-buscas', 'ritmo-bling', 'nf-pessoa', 'render-tokens'];   // cresce a cada unificação
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

// ── b241.1: UNIFICAR NAO PODE PERDER FUNCIONALIDADE ─────────────────
//
// Ao unificar o `render-tokens` eu adotei a versao da AMB (que tinha uma
// trava a mais) e PERDI a fila unica, que so existia na da GOOD. Escrevi no
// commit que "a fila continua existindo" — e nao existia. Unificacao tem
// dois lados, e eu conferi so um.
//
// Estas sao as protecoes que o modulo comum PRECISA ter, cada uma vinda de
// um lado. Se um proximo merge derrubar qualquer uma, o teste acusa.
{
  const rt = fs.readFileSync(path.join(RAIZ, 'lib', 'render-tokens.js'), 'utf8');
  const protecoes = [
    // ⚠️ procurar so o NOME nao serve: ele aparece em 3 linhas, entao
    // apagar a declaracao deixava o teste verde (testei). A checagem e
    // sobre o COMPORTAMENTO: declarada, encadeada e reatribuida.
    ['fila unica declarada (GOOD)', /let filaRenderGlobal = Promise\.resolve\(\)/,
     'sem ela, duas rotacoes simultaneas se sobrescrevem'],
    ['  e a gravacao entra nela', /filaRenderGlobal\.then\(/,
     'declarar sem usar nao serializa nada'],
    ['  e a fila avanca', /filaRenderGlobal = minhaVez/,
     'sem reatribuir, a 3a chamada nao espera a 2a'],
    ['aborta lista minuscula (GOOD)', /length < 5/,
     'paginacao falha nao pode virar PUT que zera o ambiente'],
    ['aborta encolhimento (veio da AMB)', /maiorListaVista/,
     'o piso de 5 nao protege contra lista com "quase tudo"'],
    ['pagina o GET (os dois)', /limit=100|cursor/,
     'sem paginar, o PUT apaga o que ficou de fora'],
  ];
  for (const [nome, re, porque] of protecoes) {
    ok(re.test(rt), 'render-tokens tem: ' + nome + (re.test(rt) ? '' : ' — ' + porque));
  }
  // e nao pode carregar a si mesmo
  ok(!/require\('\.\.\/\.\.\/lib\/render-tokens'\)/.test(rt),
     '  e nao tenta se carregar por require (ponte da epoca da copia)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
