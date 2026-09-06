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
  // b278.2 (Codex): arquivo configurado que SUMIU e falha, nao `continue`.
  // Se alguem renomear a tela ou o produtor, o `continue` pulava o caso
  // inteiro e a suite passava verde — o contrato ficaria sem guarda sem
  // ninguem notar.
  ok(fs.existsSync(pHtml), t.nome + ': a tela existe (' + t.html + ')');
  ok(fs.existsSync(pSrv), t.nome + ': o produtor existe (' + t.servidor + ')');
  if (!fs.existsSync(pHtml) || !fs.existsSync(pSrv)) continue;

  const html = fs.readFileSync(pHtml, 'utf8');
  const srv = fs.readFileSync(pSrv, 'utf8');

  // o que a tela lê da resposta: `d.campo`
  const lidos = new Set([...html.matchAll(/\bd\.(\w+)/g)].map((m) => m[1]));

  // b278.1 (Codex): olhar o arquivo INTEIRO tornava o teste inutil — o
  // server.js tem dezenas de `itens:` sem relacao, entao tirar `itens` da
  // rota /api/defeitos passaria batido. Agora o escopo e o PRODUTOR
  // configurado (a funcao ou a rota que monta ESTA resposta).
  // b278.5 (Codex): DELIMITAR de verdade, nao cortar num numero fixo.
  //
  // A fatia de 20.000 chars ainda pegava produtores vizinhos — o escopo da
  // GOOD passava do fim da rota e entrava em outras. E quando a funcao
  // cresceu, o corte fixo ficou CURTO e acusou campo que existe. Os dois
  // erros vem da mesma causa: numero magico em vez do fim real.
  //
  // Agora conto chaves a partir do `{` do produtor: paro exatamente onde
  // ele fecha.
  function corpoDelimitado(src, ini) {
    // ⚠️ a primeira `{` pode ser de um PARAMETRO desestruturado —
    // `listarDefeitos({ busca } = {})`. Se eu contar dali, paro no fim do
    // parametro e o escopo sai vazio (acusou 8 campos que existem).
    // Comeco depois do `)` que fecha a lista de parametros.
    const abre = src.indexOf('(', ini);
    let prof = 0; let corpo = ini;
    for (let k = abre; k < src.length && abre >= 0; k++) {
      if (src[k] === '(') prof++;
      else if (src[k] === ')') { prof--; if (prof === 0) { corpo = k; break; } }
    }
    let i = src.indexOf('{', corpo);
    if (i < 0) return src.slice(ini, ini + 20000);
    let n = 0;
    for (let k = i; k < src.length; k++) {
      const c = src[k];
      if (c === '{') n++;
      else if (c === '}') { n--; if (n === 0) return src.slice(ini, k + 1); }
    }
    return src.slice(ini);
  }

  let escopo = srv;
  if (t.produtor) {
    const i = srv.indexOf('async function ' + t.produtor);
    if (i >= 0) escopo = corpoDelimitado(srv, i);
  } else if (t.rota) {
    // b278.7 (Codex): numa ROTA, o primeiro `(` e o do `app.get(`, e o
    // parentese so fecha DEPOIS do callback inteiro — o escopo entao pegava
    // a proxima funcao junto. Pra rota, comeco no corpo do callback: o `{`
    // que vem logo apos a seta `=>`.
    const i = srv.indexOf(t.rota);
    if (i >= 0) {
      const seta = srv.indexOf('=>', i);
      const j = seta >= 0 ? srv.indexOf('{', seta) : -1;
      if (j >= 0) {
        let n = 0;
        for (let k = j; k < srv.length; k++) {
          if (srv[k] === '{') n++;
          else if (srv[k] === '}') { n--; if (n === 0) { escopo = srv.slice(i, k + 1); break; } }
        }
      }
    }
  }
  ok(escopo !== srv || (!t.produtor && !t.rota),
     t.nome + ': achei o produtor da resposta (escopo delimitado)');
  // ⚠️ o JS permite abreviar `{ itens }` em vez de `{ itens: itens }` — a
  // GOOD faz isso, e meu detector acusou um campo que ELA MANDA. Falso
  // positivo ensina a ignorar o vermelho; conto as duas formas.
  // b278.9 (Codex): so a resposta de SUCESSO. Antes eu juntava os nomes de
  // TODOS os objetos do escopo — inclusive os `{ ok: false, erro }` — entao
  // tirar `ok: true` da resposta boa nao acusava nada, porque `ok` aparecia
  // no retorno de erro. O teste ficava verde com o contrato quebrado.
  //
  // Pego o retorno que tem `ok: true`; e o que a tela consome.
  // inclui tambem o `res.status(...).json({...})` do catch — a GOOD trata
  // erro assim, sem `return {`, e o campo `erro` so aparece la
  const todosRetornos = [
    ...[...escopo.matchAll(/return\s+(?:res\.json\()?\{[\s\S]*?\}\s*\)?\s*;/g)].map((m) => m[0]),
    ...[...escopo.matchAll(/res\.status\([^)]*\)\.json\(\{[\s\S]*?\}\)/g)].map((m) => m[0]),
  ];
  const sucesso = todosRetornos.filter((r) => /ok:\s*true/.test(r));
  ok(sucesso.length > 0, t.nome + ': achei a resposta de SUCESSO (ok: true)');

  // ⚠️ a tela le `d.erro` no caminho de FALHA, e isso e legitimo — ela
  // trata os dois. Entao o contrato e: campo de dado vem do retorno de
  // sucesso, campo de erro vem do de erro. Uno os dois, mas garanto que o
  // de SUCESSO existe (era o furo: sem ele, `ok` vinha do erro e passava).
  const fonte = todosRetornos.length ? todosRetornos.join('\n') : escopo;
  const mandados = new Set([
    ...[...fonte.matchAll(/(\w+)\s*:/g)].map((m) => m[1]),
    ...[...fonte.matchAll(/[{,]\s*(\w+)\s*[,}]/g)].map((m) => m[1]),   // abreviado
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
  const fn = srv.slice(i, i + 20000);
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
