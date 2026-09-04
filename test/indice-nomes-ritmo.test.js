// Roda com: node test/indice-nomes-ritmo.test.js
//
// O dono viu a busca por nome so achando agosto. O estado do indice dizia:
//   "erro": "nfe pagina 20 HTTP 429", total_nfs: 1896, janela_dias: 120
//
// Sem pausa entre paginas, o Bling cortava na 20a — 1.896 notas, uns 40
// dias na GOOD. A janela era de 120, mas o indice nunca chegava la.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

for (const [nome, rel] of [['GOOD', 'lib/nf-nomes.js'],
                           ['AMB', 'amb-devolucoes/lib-AMB/nf-nomes-AMB.js']]) {
  const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  const i = src.indexOf('for (let pg = 1; pg <= maxPaginas; pg++) {');
  const laco = src.slice(i, i + 1400);
  ok(/if \(pg > 1\) await new Promise\(\(ok\) => setTimeout\(ok, 400\)\)/.test(laco),
     nome + ': pausa de 400ms entre paginas — o Bling limita a 3 req/s');
  ok(/r\.status === 429/.test(laco) && /tent <= 3/.test(laco),
     nome + ': 429 e fila, nao recusa — tenta ate 3x com espera crescente');
  ok(/2000 \* tent/.test(laco), nome + '  com espera crescente (2s, 4s, 6s)');
}

// a GOOD reconstroi em BACKGROUND, como a AMB ja fazia
{
  const good = fs.readFileSync(path.join(RAIZ, 'lib', 'nf-nomes.js'), 'utf8');
  ok(/IDX\.reconstruindo = true/.test(good),
     'GOOD: reconstroi em background — com ~60s de indice, refazer na busca faria o estoquista esperar');
  ok(/if \(vencido && !IDX\.ts\)/.test(good),
     '  so espera quando NAO ha indice nenhum');
  // e o mapa so troca no fim: durante a reconstrucao, a busca le o velho inteiro
  // b233: a publicacao do indice e um bloco so — ts, cobertura e mapa
  // juntos, sem await no meio. (A distancia em chars nao servia: as linhas
  // de cobertura do b233 entraram entre o ts e o mapa e quebraram o teste
  // sem que o comportamento mudasse.)
  const iC = good.indexOf('IDX.ts = Date.now();');
  const iM = good.indexOf('IDX.mapa = mapa;');
  ok(iC > 0 && iM > iC, '  o mapa e publicado depois do carimbo de tempo');
  ok(!/await/.test(good.slice(iC, iM)),
     '  e sem await entre eles — publicacao atomica, sem estado intermediario');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
