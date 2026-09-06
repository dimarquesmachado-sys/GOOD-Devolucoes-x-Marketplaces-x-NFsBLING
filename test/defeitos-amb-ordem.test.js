// Roda com: node test/defeitos-amb-ordem.test.js
//
// [stated 04/09] "vários problemas graves e vc não resolve. faz só
// superficial."
//
// Ele tinha razão. `listarDefeitos` da AMB virou uma pilha de remendos —
// cada rodada eu corrigia o caso apontado e a ORDEM das operações ia
// ficando errada. A auditoria da função inteira achou 4 problemas que
// nenhum apontamento tinha citado:
//
//   1. o corte em 400 vinha ANTES da busca em memória → procurar um SKU
//      antigo podia falhar porque o corte já o tinha tirado
//   2. a busca em memória usava `includes` cru → "Agua" não casava com
//      "Água" que o banco tinha trazido certo (a 2ª passada SUBTRAÍA)
//   3. o aviso de teto era medido antes da busca → numa busca por SKU
//      alertava à toa
//   4. a consulta de peças rodava mesmo com a lista vazia
//
// Este teste trava a ORDEM, que é o que se perde a cada remendo.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'supabase-AMB.js'), 'utf8');
const i = SRC.indexOf('async function listarDefeitos');
const j = SRC.indexOf('async function ', i + 10);
const FN = SRC.slice(i, j);

// ── a ordem das operações ───────────────────────────────────────────
{
  const pos = (t) => FN.indexOf(t);
  const etapas = [
    ['resolvidos por pedido', 'resolvidosPorPedido = new Set'],
    ['exclusão na consulta', "q.not('id', 'in'"],
    ['limite', '.limit(limite)'],
    ['consulta', 'const r = await q'],
    ['rede em memória', 'resolvidosPorPedido.has'],
    ['busca em memória', 'norm(x.produto_sku)'],
    ['corte em 400', 'linhas.slice(0, 400)'],
  ];
  for (let k = 0; k < etapas.length - 1; k++) {
    const [nomeA, a] = etapas[k];
    const [nomeB, b] = etapas[k + 1];
    ok(pos(a) >= 0 && pos(b) >= 0 && pos(a) < pos(b),
       nomeA + ' vem antes de ' + nomeB);
  }
}

// ── e o que cada etapa precisa garantir ─────────────────────────────
{
  ok(/normalize\('NFD'\)/.test(FN),
     'a busca em memoria ignora acento (senao SUBTRAI o que o banco achou)');
  ok(/const bateuNoTeto = !busca &&/.test(FN),
     'o aviso de teto so vale SEM busca (com filtro, trazer menos e normal)');
  ok(FN.indexOf('const bateuNoTeto') < FN.indexOf('linhas.slice(0, 400)')
     || FN.indexOf('const bateuNoTeto') > FN.indexOf('norm(x.produto_sku)'),
     '  e e medido depois dos filtros, nao antes');
  ok(/if \(ids\.length\) \{/.test(FN),
     'a consulta de pecas so roda se ha itens');
  ok(/tipo\.eq\.defeito_estoque,and\(tipo\.eq\.problema,status\.eq\.concluido\)/.test(FN),
     'a consulta traz SO defeito: nem devolucao concluida, nem aguardando NF');
  ok(/not\('tipo', 'in', '\(recuperado,descartado,defeito_excluido\)'\)/.test(FN),
     'e exclui os estados terminais');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
