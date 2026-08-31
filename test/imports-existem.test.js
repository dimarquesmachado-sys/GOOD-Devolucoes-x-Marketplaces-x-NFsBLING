// Roda com: node test/imports-existem.test.js
//
// A CLASSE DE BUG QUE ISTO MATA: usar um modulo que ninguem importou.
//
// Aconteceu TRES vezes neste repo, e as tres passaram despercebidas porque
// um try/catch em volta transformava o ReferenceError em "erro do
// marketplace":
//
//   1. `buscarNFnoBlingPorOrderId` na AMB (b172 marcou como "bug latente")
//   2. `buscarPedidoBlingPorId` na AMB, fase 2 da blindada
//   3. `magaluCancelados` na GOOD — o Magalu NUNCA apareceu no card de
//      estornadas, e o erro parecia da ponte deles
//
// O terceiro so foi descoberto porque o dono abriu a rota crua e mandou o
// JSON: `"magalu_erro": "magaluCancelados is not defined"`.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// os modulos que as rotas usam, e onde cada um tem que estar importado
const ESPERADOS = [
  ['server.js', 'magaluCancelados', "require('./lib/magalu-cancelados')"],
  ['server.js', 'marcadores', "require('./lib/marcadores-estornada')"],
  ['server.js', 'devParcial', "require('./lib/devolucao-parcial')"],
  ['amb-devolucoes/app-AMB.js', 'magaluCancelados', "require('../lib/magalu-cancelados')"],
  ['amb-devolucoes/app-AMB.js', 'marcadores', "require('../lib/marcadores-estornada')"],
];

for (const [rel, nome, req] of ESPERADOS) {
  const s = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  const temRequire = s.indexOf('const ' + nome + ' = ' + req) !== -1
    || new RegExp('const ' + nome + '\\s*=\\s*require').test(s);
  ok(temRequire, rel.split('/').pop() + ': `' + nome + '` esta importado');
}

// e a varredura geral: chamada de metodo tipico de modulo, sem declaracao
for (const rel of ['server.js', 'amb-devolucoes/app-AMB.js']) {
  const s = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  const declarados = new Set(
    [...s.matchAll(/(?:const|let|var|function)\s+(\w+)/g)].map((m) => m[1])
  );
  const orfaos = [...new Set(
    [...s.matchAll(/\b([a-z][a-zA-Z]{3,})\.(buscar|listar|montar|enriquecer|resumo|anotar|coletar)\b/g)]
      .map((m) => m[1])
      .filter((n) => !declarados.has(n))
  )];
  ok(orfaos.length === 0,
     rel.split('/').pop() + ': nenhum modulo usado sem import'
     + (orfaos.length ? ' (achei: ' + orfaos.join(', ') + ')' : ''));
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
