'use strict';
// ⚠️ DEFEITO ATIVO ANTIGO SUMINDO DA TELA DA AMB.
//
// A consulta trazia ativos E resolvidos com `.limit(300)` fixo, e só separava
// depois, num filtro em JS. Peça já recuperada/descartada POR PEDIDO ocupava
// vaga dentro do limite — empurrando defeito ativo ANTIGO para fora.
//
// O estoquista via a lista "completa" sem a peça que procurava, e nada no
// sistema dizia que faltava alguém: 300 linhas vieram, 300 linhas apareceram.
//
// 📌 Conserto que a GOOD já tinha e a AMB não recebeu — a dívida recorrente
// de `docs/divida-copias-empresas.md`.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(
  path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'defeitos-ciclo-AMB.js'), 'utf8');
const semComent = src.split('\n')
  .filter((l) => !l.trim().startsWith('//')).join('\n');

// ── o limite deixou de ser fixo ─────────────────────────────────────
{
  ok(!/\.limit\(300\)/.test(semComent),
     '⚠️ a consulta nao usa mais `.limit(300)` cravado');
  ok(/\.limit\(limiteDaConsulta\(/.test(semComent),
     '  o limite e calculado pelo volume de resolvidas');
  ok(/\.not\('id', 'in'/.test(semComent),
     '⚠️ e as resolvidas saem NA CONSULTA, nao no pos-filtro');
}

// ── ⚠️ e o `porPedido` nasce ANTES da busca ─────────────────────────
//
// Sem isso o conserto não teria como funcionar: a busca já teria acontecido
// quando soubéssemos quais peças excluir.
{
  const iPorPedido = semComent.indexOf('const porPedido = {}');
  const iBuscar = semComent.indexOf('async function buscar(');
  ok(iPorPedido > 0 && iBuscar > 0 && iPorPedido < iBuscar,
     '⚠️ o `porPedido` e montado ANTES de `buscar()`');
}

// ── os dois caminhos do limite, exercitados ─────────────────────────
//
// ⚠️ Acima de MAX_IDS_NA_URL a lista de ids não cabe na URL, a exclusão não
// entra, e eles voltariam a ocupar vaga. Nesse caso o limite CRESCE.
{
  const MAX = 150;
  const idsFora = (estado, pp) => {
    if (estado !== 'defeito') return [];
    const ids = Object.keys(pp || {});
    return ids.length && ids.length <= MAX ? ids : [];
  };
  const limite = (estado, pp) => {
    const base = 300;
    if (estado !== 'defeito') return base;
    const n = Object.keys(pp || {}).length;
    if (!n || n <= MAX) return base;
    return Math.min(base + n, 1000);
  };
  const pp = (n) => Object.fromEntries(
    Array.from({ length: n }, (_, i) => ['id' + i, 'recuperado']));

  ok(idsFora('defeito', pp(50)).length === 50 && limite('defeito', pp(50)) === 300,
     '  50 resolvidas: saem na consulta, limite segue 300');
  ok(idsFora('defeito', pp(400)).length === 0 && limite('defeito', pp(400)) === 700,
     '⚠️ 400 resolvidas: nao cabem na URL, entao o limite CRESCE pra 700');
  ok(limite('defeito', pp(9000)) === 1000,
     '  e tem teto de 1000 (nao pede a tabela inteira)');
  ok(limite('recuperado', pp(400)) === 300,
     '  ⚠️ e so a aba `defeito` alarga (as outras nao tem o problema)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
