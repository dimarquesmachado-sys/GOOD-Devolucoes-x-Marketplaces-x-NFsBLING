// Roda com: node test/relatorio-sem-defeito-estoque.test.js
//
// Guarda o apontamento do Codex no PR #249: desde que o defeito de
// estoque passou a ser INSERIDO de verdade em `devolucoes` (antes, o
// NOT NULL de shipment_id derrubava o insert sempre), o relatorio de
// devolucoes de VENDA (lib/rotas-relatorios.js) passou a contar essas
// linhas de controle interno como se fossem venda perdida.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'rotas-relatorios.js'), 'utf8');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const trechoQuery = SRC.slice(SRC.indexOf("supabase\n"), SRC.indexOf('// Aplica filtros'));

ok(trechoQuery.includes(".neq('tipo', 'defeito_estoque')"),
   'a base do relatorio de devolucoes exclui tipo=defeito_estoque');
ok(SRC.indexOf(".neq('tipo', 'defeito_estoque')") < SRC.indexOf('// Aplica filtros'),
   '  a exclusao vem ANTES dos filtros opcionais (vale mesmo sem filtro de tipo)');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
