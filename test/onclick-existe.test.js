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
// confere que X esta declarado no mesmo arquivo (ou e nativo).

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const NATIVAS = new Set(['setTimeout', 'alert', 'confirm', 'prompt', 'open', 'print', 'location', 'history']);

for (const [nome, rel] of [
  ['GOOD', 'public/painel-devolucoes.html'],
  ['AMB (servido)', 'amb-devolucoes/public-AMB/painel-AMB.html'],
  ['AMB (direto)', 'amb-devolucoes/public-AMB/painel2-AMB.html'],
]) {
  const s = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  const chamadas = new Set([...s.matchAll(/onclick="(\w+)\(/g)].map((m) => m[1]));
  const faltam = [...chamadas].filter((f) =>
    !NATIVAS.has(f)
    && !new RegExp('(function ' + f + '\\b|window\\.' + f + '\\s*=|const ' + f + '\\s*=|let ' + f + '\\s*=)').test(s));
  ok(faltam.length === 0,
     nome + ': todo onclick chama funcao que existe'
     + (faltam.length ? ' (FANTASMAS: ' + faltam.join(', ') + ')' : ' (' + chamadas.size + ' conferidas)'));
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
