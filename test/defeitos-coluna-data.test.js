// Roda com: node test/defeitos-coluna-data.test.js
//
// Guarda o bug de 27/08: a busca do Estoque de Defeitos da GOOD morria com
// "column devolucoes.criado_em does not exist" e a tela dizia so
// "nada encontrado" — parecia produto inexistente, era coluna errada.
//
// A tabela `devolucoes` (GOOD) usa created_at; a `devolucoes_amb` usa
// criado_em. O modulo veio portado da AMB e trouxe o nome de la.

const fs = require('fs');
const path = require('path');

const GOOD = fs.readFileSync(path.join(__dirname, '..', 'lib', 'defeitos-ciclo.js'), 'utf8');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// ── 1. a consulta na tabela devolucoes usa created_at ────────────────
const trechoLista = GOOD.slice(GOOD.indexOf("dbc.from(T_DEV)"), GOOD.indexOf(".limit(300)"));
ok(trechoLista.includes("created_at"), 'o select da lista pede created_at');
ok(!/\.select\([^)]*\bcriado_em\b/.test(trechoLista),
   'o select da lista NAO pede criado_em (era o que quebrava)');
ok(trechoLista.includes(".order('created_at'"), 'o order da lista usa created_at');

// ── 2. as OUTRAS tabelas seguem com criado_em (nao foram tocadas) ────
// defeito_comentarios, pecas_retiradas e defeito_pedidos sao tabelas
// PROPRIAS do modulo e nasceram com criado_em nas duas empresas.
[['T_COM', 'defeito_comentarios'], ['T_PEC', 'pecas_retiradas'], ['T_PED', 'defeito_pedidos']].forEach(([c, nome]) => {
  const re = new RegExp("from\\(" + c + "\\)[^\\n]*order\\('criado_em'");
  ok(re.test(GOOD), '  ' + nome + ' continua ordenando por criado_em');
});

// ── 3. o CONTRATO com o painel nao mudou ─────────────────────────────
// O front le `.criado_em` (10 usos em public/js). A resposta tem que
// continuar chamando assim, so mudando de onde o valor vem.
ok(/criado_em:\s*x\.created_at/.test(GOOD), 'a lista devolve criado_em a partir de created_at');
ok(/criado_em:\s*item\.created_at\s*\|\|\s*item\.criado_em/.test(GOOD),
   'a ficha devolve criado_em tolerante (la e select("*"))');
const js = fs.readdirSync(path.join(__dirname, '..', 'public', 'js'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8')).join('\n');
ok(js.includes('.criado_em'), 'o painel realmente le .criado_em (por isso o nome de saida ficou)');

// ── 4. a AMB nao foi tocada ──────────────────────────────────────────
const AMB = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'defeitos-ciclo-AMB.js'), 'utf8');
ok(/\.select\([^)]*criado_em[^)]*\)/.test(AMB), 'a AMB segue com criado_em (a tabela dela e assim)');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
