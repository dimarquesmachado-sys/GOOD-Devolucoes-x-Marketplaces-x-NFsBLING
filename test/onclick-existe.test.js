// Roda com: node test/onclick-existe.test.js
//
// A CLASSE DE BUG: botao chamando funcao que nao existe no HTML.
//
// Aconteceu no b225: pus "Editar" no painel da GOOD chamando `editarRecado`,
// que so existia no painel-AMB. O botao morria em silencio — sem erro, sem
// nada. Quinta funcao fantasma do repo, primeira no front.
//
// `node --check` nao pega isso: o onclick e string. So rodando no navegador.
// Entao este teste faz o que o navegador faria: pra cada `onclick="X("`,
// confere que X esta declarado GLOBALMENTE no mesmo arquivo (ou e nativo).
//
// b225.2 (Codex): "declarado" = no nivel do script ou em `window.X =`.
// Um `function X` dentro de outra funcao, num comentario ou numa string
// enganava a versao anterior — e o navegador nao resolve onclick por escopo
// interno. Comentarios e strings sao removidos antes de olhar.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const NATIVAS = new Set(['setTimeout', 'alert', 'confirm', 'prompt', 'open', 'print', 'location', 'history']);

// so o JS dos <script>, sem comentarios. NAO tento remover strings: uma
// aspa solta no HTML (um "it's" num texto) fazia a regex engolir o arquivo
// inteiro ate a proxima aspa, e todas as funcoes viravam "fantasmas". A
// checagem de escopo (inicio de linha com 4 espacos) ja descarta mencao
// dentro de string, que nunca comeca uma linha assim.
function soCodigo(s) {
  const scripts = [...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  return scripts
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function declaradaGlobal(codigo, f) {
  // nivel do script: ate 4 espacos de indentacao. Mais que isso e corpo de
  // outra funcao. (Os paineis usam 4; `gerarLoteEstornadas` esta em 0 e
  // funciona do mesmo jeito — o navegador nao liga pra indentacao, mas o
  // detector precisa de um teto pra separar global de aninhada.)
  if (new RegExp('^ {0,4}(async )?function ' + f + '\\s*\\(', 'm').test(codigo)) return true;
  if (new RegExp('^ {0,4}(const|let|var) ' + f + '\\s*=', 'm').test(codigo)) return true;
  // `window.X =` e global por definicao, em qualquer indentacao
  if (new RegExp('window\\.' + f + '\\s*=').test(codigo)) return true;
  return false;
}

for (const [nome, rel] of [
  ['GOOD', 'public/painel-devolucoes.html'],
  ['AMB (servido)', 'amb-devolucoes/public-AMB/painel-AMB.html'],
  ['AMB (direto)', 'amb-devolucoes/public-AMB/painel2-AMB.html'],
]) {
  const s = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  const chamadas = new Set([...s.matchAll(/onclick="(\w+)\(/g)].map((m) => m[1]));
  const codigo = soCodigo(s);
  const faltam = [...chamadas].filter((f) => !NATIVAS.has(f) && !declaradaGlobal(codigo, f));
  ok(faltam.length === 0,
     nome + ': todo onclick chama funcao declarada GLOBALMENTE'
     + (faltam.length ? ' (FANTASMAS: ' + faltam.join(', ') + ')' : ' (' + chamadas.size + ' conferidas)'));
}

// e o detector NAO se engana com mencao em comentario ou string
{
  const falso = "<script>\n    // function fantasma() { }\n    var x = 'function fantasma() {}';\n</script>";
  ok(declaradaGlobal(soCodigo(falso), 'fantasma') === false,
     'mencao em comentario ou string NAO conta como declaracao');
  const real = "<script>\n    function deVerdade() { }\n</script>";
  ok(declaradaGlobal(soCodigo(real), 'deVerdade') === true, 'declaracao real conta');
  const aninhada = "<script>\n    function fora() {\n      function dentro() { }\n    }\n</script>";
  ok(declaradaGlobal(soCodigo(aninhada), 'dentro') === false,
     'funcao ANINHADA nao conta — o onclick nao a alcanca');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
