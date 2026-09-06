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
  // b278.16: a ORDEM MUDOU DE PROPOSITO. Antes eu lia TODO o historico de
  // pedidos pra excluir na consulta — e isso crescia pra sempre, deixando a
  // tela mais lenta a cada mes. Agora: consulta limitada primeiro, e o
  // estado SO dos ids que vieram (max 800, uma chamada).
  //
  // O teste acompanha o desenho novo — mas continua cobrando o que importa:
  // filtrar ANTES de cortar.
  const etapas = [
    ['limite da consulta', 'const limite = 800'],
    ['consulta', 'const r = await q'],
    ['estado dos ids da pagina', 'idsPagina'],
    ['exclusão dos resolvidos', 'resolvidosPorPedido.has'],
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
  // b278.16: o custo nao pode crescer com o historico
  ok(!/for \(let de = 0; ; de \+= PAG\)/.test(FN),
     'NAO varre o historico inteiro de pedidos a cada carga');
  ok(/\.in\('defeito_id', idsPagina\)/.test(FN),
     '  pergunta o estado so dos ids que a consulta trouxe');
  ok(/return \{ ok: false, erro: 'nao consegui conferir/.test(FN),
     'e se essa consulta falhar, NAO devolve inventario incompleto');

  ok(/normalize\('NFD'\)/.test(FN),
     'a busca em memoria ignora acento (senao SUBTRAI o que o banco achou)');
  // b278.11 (Codex): meu `||` aqui nao verificava NADA — mover o calculo
  // pra antes da busca satisfazia a primeira metade, mover pra depois do
  // corte satisfazia a segunda. Disjuncao de duas condicoes que se cobrem
  // e sempre verdadeira. Tem que ser E, com as duas fronteiras.
  {
    const p = (t) => FN.indexOf(t);
    ok(p('const bateuNoTeto') > p('norm(x.produto_sku)'),
       'o teto e medido DEPOIS da busca em memoria');
    ok(p('const bateuNoTeto') < p('linhas.slice(0, 400)'),
       '  e ANTES do corte (senao mede o ja cortado, sempre 400)');
  }
  ok(/const bateuNoTeto = trouxeCheio \|\| linhas\.length > 400;/.test(FN),
     'o aviso vale COM busca tambem — 400 resultados filtrados tambem sao um teto');
  ok(/if \(ids\.length\) \{/.test(FN),
     'a consulta de pecas so roda se ha itens');
  ok(/tipo\.eq\.defeito_estoque,and\(tipo\.eq\.problema,status\.eq\.concluido\)/.test(FN),
     'a consulta traz SO defeito: nem devolucao concluida, nem aguardando NF');
  ok(/not\('tipo', 'in', '\(recuperado,descartado,defeito_excluido\)'\)/.test(FN),
     'e exclui os estados terminais');
}

// ── b278.12: a mesma regra nos DOIS lugares ─────────────────────────
//
// Os estados terminais (recuperado/descartado/defeito_excluido) precisam
// sair da consulta principal E da contagem de aguardando NF. Eu excluia so
// na primeira — a linha recuperada seguia contando como pendente pra
// sempre, porque o `status` continua 'problema'.
{
  const terminais = (FN.match(/recuperado,descartado,defeito_excluido/g) || []).length;
  ok(terminais >= 2,
     'os terminais sao excluidos na consulta E na contagem (achei ' + terminais + ')');
  ok(!/aguardandoNF\+\+/.test(FN),
     'a contagem de aguardando NF vem SO do count — sem soma por cima');
  ok(/aguardandoNF = rc\.count/.test(FN),
     '  e vem de consulta propria (head+count, sem trazer linha)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
