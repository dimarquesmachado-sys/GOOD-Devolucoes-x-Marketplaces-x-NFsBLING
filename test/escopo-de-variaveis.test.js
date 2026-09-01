// Roda com: node test/escopo-de-variaveis.test.js
//
// A CLASSE DE BUG QUE ISTO MATA: eu colar codigo na funcao ERRADA.
//
// Aconteceu TRES vezes so nesta frente, sempre igual — dois arquivos com
// trechos parecidos, eu localizo por texto e a insercao cai na funcao
// vizinha:
//
//   1. `const acumuladas` foi parar noutra funcao da GOOD
//   2. o retorno acumulado entrou na `varreduraFundo` da AMB, que nao tem
//      acumulador — daria ReferenceError e derrubaria a identificacao
//   3. `candidatas: acumuladas.slice()` vazou pra `buscarNFnoBlingPorOrderId`
//
// Os tres davam ReferenceError em producao, e nenhum aparecia no
// `node --check` — ele valida sintaxe, nao escopo.
//
// Este teste confere os nomes que JA me pegaram. Nao tenta ser um linter:
// um detector generico acusa `k`, `v`, `num` — nomes curtos que se repetem
// legitimamente — e vira ruido que ninguem le.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// nome -> (arquivo, funcao) onde ele PODE aparecer
const VIGIADOS = [
  ['acumuladas', 'lib/bling.js', 'buscarNFnoBlingPorNumero'],
  ['acumuladas', 'amb-devolucoes/lib-AMB/admin-helpers-AMB.js', 'buscarNFnoBlingPorNumero'],
  ['vivasVarredura', 'lib/bling.js', 'buscarNFnoBlingPorNumero'],
  ['vivasVarredura', 'amb-devolucoes/lib-AMB/admin-helpers-AMB.js', 'buscarNFnoBlingPorNumero'],
  ['todasAteAqui', 'lib/bling.js', 'buscarNFnoBlingPorNumero'],
  ['todasAteAqui', 'amb-devolucoes/lib-AMB/admin-helpers-AMB.js', 'buscarNFnoBlingPorNumero'],
];

for (const [nome, rel, funcaoDona] of VIGIADOS) {
  const s = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  const fn = [...s.matchAll(/(?:async )?function (\w+)/g)].map((m) => ({ pos: m.index, f: m[1] }));
  const donaDe = (pos) => {
    const antes = fn.filter((x) => x.pos < pos);
    return antes.length ? antes[antes.length - 1].f : '(topo)';
  };

  const forasteiras = [...s.matchAll(new RegExp('\\b' + nome + '\\b', 'g'))]
    .map((m) => donaDe(m.index))
    .filter((f) => f !== funcaoDona);

  ok(forasteiras.length === 0,
     rel.split('/').pop() + ': `' + nome + '` so aparece em ' + funcaoDona
     + (forasteiras.length ? ' (vazou pra: ' + [...new Set(forasteiras)].join(', ') + ')' : ''));
}

// e as funcoes que NAO podem depender do acumulador continuam limpas
{
  const amb = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'admin-helpers-AMB.js'), 'utf8');
  const i = amb.indexOf('async function varreduraFundo');
  const j = amb.indexOf('async function ', i + 10);
  ok(!/acumuladas\./.test(amb.slice(i, j)),
     'a varreduraFundo da AMB nao usa `acumuladas` — nao tem um');

  const good = fs.readFileSync(path.join(RAIZ, 'lib', 'bling.js'), 'utf8');
  const a = good.indexOf('async function buscarNFnoBlingPorOrderId');
  const b = good.indexOf('async function ', a + 10);
  ok(!/acumuladas/.test(good.slice(a, b)),
     'e a busca por PEDIDO da GOOD tambem nao');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
