'use strict';
// b544 — unificacao das rotas de admin, passo 1: natureza de devolucao da FICHA na rota de ligar devolucao existente
// (era a da GOOD escrita a mao, inclusive na copia da AMB/Girassol) e a coluna de data como parametro.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
const semComent = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
for (const [arq, origem] of [['amb-devolucoes/lib-AMB/rotas-admin-AMB.js', 'naturezaDevolucaoDaEmpresa']]) {
  const s = fs.readFileSync(path.join(R, arq), 'utf8');
  ok(!/'5776118802'/.test(semComent(s)), '⚠️ ' + arq + ': nenhuma natureza da GOOD escrita a mao no codigo');
  ok(s.includes("const NATUREZAS_DEVOLUCAO = String(" + origem + " || '')") && /!NATUREZAS_DEVOLUCAO\.includes\(String\(nf\.naturezaOperacao\?\.id \|\| ''\)\)/.test(s), '  ' + arq + ': aceita QUALQUER natureza de devolucao da ficha da empresa');
  ok(/natureza de devolucao desta empresa nao configurada na ficha/.test(s), '  ' + arq + ': sem natureza na ficha, avisa (nao finge que nao ha NF)');
}
const a = fs.readFileSync(path.join(R, 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'), 'utf8');
ok(/const COL_CRIADO = deps\.colunaCriadoEm \|\| 'criado_em';/.test(a), '⚠️ a coluna de data vem de fora (padrao criado_em: AMB/Girassol nao mudam)');
ok(!/'criado_em'/.test(semComent(a).replace("deps.colunaCriadoEm || 'criado_em'", '')), '  nenhuma consulta com criado_em escrito a mao (todas usam COL_CRIADO)');
const g = require(path.join(R, 'lib', 'empresas')).obterEmpresa('good');
ok(String(g.fiscal.naturezasDevolucaoIds()).split(',').length === 2, '  a GOOD tem 2 naturezas na ficha — antes a rota so aceitava 1');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
