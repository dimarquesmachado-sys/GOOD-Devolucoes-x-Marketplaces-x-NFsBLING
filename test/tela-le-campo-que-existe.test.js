// Roda com: node test/tela-le-campo-que-existe.test.js
//
// A CLASSE DE BUG: a TELA ler campo que o SERVIDOR não manda.
//
// Achado real (b278): `defeitos-AMB.html` é cópia da tela da GOOD e lê
// `d.itens`, `d.total_registros` e `d.total_pecas`. O servidor da AMB
// nunca mandou esses campos — ele manda `grupos` e `total_linhas`.
// Resultado em produção: a tela de Defeitos da AMB mostrava
// "undefined registro(s)" e lista VAZIA.
//
// É a mesma família do `campo-tem-produtor`, mas num vão que nenhum teste
// cobria: entre o HTML e o servidor. `node --check` não pega (é acesso a
// propriedade), o boot não pega (só aparece com dado real na tela).
//
// Achei procurando outra coisa — conferindo o produtor antes de mexer.
// Este teste tira isso da sorte.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

/**
 * Telas conferidas: cada uma com a rota que alimenta e o arquivo do
 * servidor onde a resposta é montada.
 */
const TELAS = [
  {
    nome: 'defeitos-AMB',
    html: 'amb-devolucoes/public-AMB/defeitos-AMB.html',
    servidor: 'amb-devolucoes/lib-AMB/supabase-AMB.js',
    produtor: 'listarDefeitos',
  },
  {
    nome: 'defeitos (GOOD)',
    html: 'public/defeitos.html',
    servidor: 'server.js',
    produtor: null,   // montado inline na rota; confere no arquivo todo
  },
];

for (const t of TELAS) {
  const pHtml = path.join(RAIZ, t.html);
  const pSrv = path.join(RAIZ, t.servidor);
  if (!fs.existsSync(pHtml) || !fs.existsSync(pSrv)) continue;

  const html = fs.readFileSync(pHtml, 'utf8');
  const srv = fs.readFileSync(pSrv, 'utf8');

  // o que a tela lê da resposta: `d.campo`
  const lidos = new Set([...html.matchAll(/\bd\.(\w+)/g)].map((m) => m[1]));

  // o que o servidor pode mandar: qualquer `campo:` num objeto de resposta,
  // no arquivo inteiro (evita falso positivo por não achar a função exata)
  const mandados = new Set([...srv.matchAll(/(\w+)\s*:/g)].map((m) => m[1]));

  const fantasmas = [...lidos].filter((c) => !mandados.has(c));
  ok(fantasmas.length === 0,
     t.nome + ': todo campo que a tela lê o servidor manda'
     + (fantasmas.length ? ' (NUNCA MANDADOS: ' + fantasmas.join(', ') + ')' : ' (' + lidos.size + ' conferidos)'));
}

// ── e o caso concreto que motivou tudo ──────────────────────────────
{
  const srv = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'supabase-AMB.js'), 'utf8');
  const i = srv.indexOf('async function listarDefeitos');
  const fn = srv.slice(i, i + 4000);
  for (const campo of ['total_registros', 'total_pecas', 'itens']) {
    ok(new RegExp(campo + ':').test(fn),
       'listarDefeitos devolve `' + campo + '` (a tela da AMB depende dele)');
  }
  ok(/teto_atingido/.test(fn),
     'e avisa quando bate no teto de 400 — defeito antigo sumia calado');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
