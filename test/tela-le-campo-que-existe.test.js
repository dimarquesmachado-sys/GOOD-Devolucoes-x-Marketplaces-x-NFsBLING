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
    produtor: null,
    rota: "app.get('/api/defeitos'",   // montada inline: o escopo e a rota
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

  // b278.1 (Codex): olhar o arquivo INTEIRO tornava o teste inutil — o
  // server.js tem dezenas de `itens:` sem relacao, entao tirar `itens` da
  // rota /api/defeitos passaria batido. Agora o escopo e o PRODUTOR
  // configurado (a funcao ou a rota que monta ESTA resposta).
  let escopo = srv;
  if (t.produtor) {
    const i = srv.indexOf('async function ' + t.produtor);
    if (i >= 0) escopo = srv.slice(i, i + 9000);
  } else if (t.rota) {
    const i = srv.indexOf(t.rota);
    if (i >= 0) escopo = srv.slice(i, i + 9000);
  }
  ok(escopo !== srv || (!t.produtor && !t.rota),
     t.nome + ': achei o produtor da resposta (escopo delimitado)');
  // ⚠️ o JS permite abreviar `{ itens }` em vez de `{ itens: itens }` — a
  // GOOD faz isso, e meu detector acusou um campo que ELA MANDA. Falso
  // positivo ensina a ignorar o vermelho; conto as duas formas.
  const mandados = new Set([
    ...[...escopo.matchAll(/(\w+)\s*:/g)].map((m) => m[1]),
    ...[...escopo.matchAll(/[{,]\s*(\w+)\s*[,}]/g)].map((m) => m[1]),   // abreviado
  ]);

  const fantasmas = [...lidos].filter((c) => !mandados.has(c));
  ok(fantasmas.length === 0,
     t.nome + ': todo campo que a tela lê o servidor manda'
     + (fantasmas.length ? ' (NUNCA MANDADOS: ' + fantasmas.join(', ') + ')' : ' (' + lidos.size + ' conferidos)'));
}

// ── e o caso concreto que motivou tudo ──────────────────────────────
{
  const srv = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'supabase-AMB.js'), 'utf8');
  const i = srv.indexOf('async function listarDefeitos');
  const fn = srv.slice(i, i + 9000);
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
