// Roda com: node test/rotas-do-front-existem.test.js
//
// ⚠️ ERRO REAL NA TELA DO ESTOQUISTA (10/09):
//   "❌ Erro de conexao: Unexpected token '<', "<!DOCTYPE "... is not valid JSON"
//
// A CAUSA: `public/index.html` chamava `/api/produto/imagem/:id`, e essa
// rota NUNCA existiu no server.js. O Express respondia com a PÁGINA HTML de
// 404, e o `.json()` da linha seguinte estourava no `<` do `<!DOCTYPE`.
//
// ⚠️ Esta classe de erro é invisível para tudo que a gente tinha: o
// `node --check` não olha HTML, o boot real sobe normalmente, e os testes
// de módulo passam. Só aparece quando o estoquista clica.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// ⚠️ AS ROTAS NAO ESTAO SO NO server.js. Modulos de `lib/` registram as
// suas (`defeitos-ciclo.js`, `rotas-admin-nf.js`, ...), e minha primeira
// versao deste teste acusou `/api/defeitos/pedidos` como faltando quando
// ela existe em `lib/defeitos-ciclo.js`.
//
// Falso positivo em teste de rota e o pior tipo: ensina a ignorar o
// vermelho justamente onde ele avisa que a tela vai quebrar.
const ondeHaRotas = [path.join(RAIZ, 'server.js')];
for (const dir of ['lib', path.join('amb-devolucoes', 'lib-AMB'), 'amb-devolucoes']) {
  const d = path.join(RAIZ, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (f.endsWith('.js')) ondeHaRotas.push(path.join(d, f));
  }
}
// ⚠️ E SEM OS COMENTARIOS. Minha 1a versao achava a rota no COMENTARIO que
// eu mesmo tinha escrito acima dela — desliguei o `app.get` de proposito
// pra testar e o teste continuou VERDE.
//
// Teste que se satisfaz com documentacao em vez de codigo e pior que teste
// nenhum: da a sensacao de cobertura sem a cobertura.
const semComentarios = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const srv = ondeHaRotas.map((f) => semComentarios(fs.readFileSync(f, 'utf8'))).join('\n');

const TELAS = [
  ['public/index.html', 'GOOD'],
  ['amb-devolucoes/index-AMB.html', 'AMB'],
];

for (const [arq, nome] of TELAS) {
  const caminho = path.join(RAIZ, arq);
  if (!fs.existsSync(caminho)) continue;
  const html = fs.readFileSync(caminho, 'utf8');

  // toda rota /api/... que o HTML chama
  const chamadas = [...html.matchAll(/['"`](\/(?:api|amb\/api)\/[a-z0-9/_-]+)/gi)]
    .map((m) => m[1])
    .filter((r, i, a) => a.indexOf(r) === i);

  const faltando = [];
  for (const rota of chamadas) {
    // o server pode registrar com :param no meio — comparo os 3 primeiros
    // segmentos, que é o que identifica a rota
    const partes = rota.split('/').filter(Boolean).slice(0, 3).join('/');
    if (!srv.includes(partes)) faltando.push(rota);
  }

  ok(faltando.length === 0,
     nome + ': toda rota que a tela chama existe no server'
     + (faltando.length ? ' (FALTANDO: ' + faltando.join(', ') + ')' : ''));
}

// ── ⚠️ e o front não pode chamar .json() sem olhar o status ─────────
//
// Foto de produto é enfeite: se falhar, o card fica sem foto e a devolução
// segue. Nunca deve virar erro vermelho na tela.
{
  const html = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8');
  const i = html.indexOf("/api/produto/imagem/");
  const bloco = html.slice(i, i + 900);
  ok(/if \(!r\.ok\) continue/.test(bloco),
     'a busca de foto confere o status antes do .json()');
  ok(/\.json\(\)\.catch\(/.test(bloco),
     '  e protege o parse (resposta pode nao ser JSON)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
