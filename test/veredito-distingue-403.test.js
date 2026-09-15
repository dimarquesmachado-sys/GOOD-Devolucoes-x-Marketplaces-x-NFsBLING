'use strict';
// ⚠️ 403 NO ML TEM DOIS SIGNIFICADOS, e só um tem conserto pelo token.
//
// Contrato v7: o ML responde 403 com **token vencido**.
// Contrato v10: 403 de **rota restrita ao dono do recurso** NÃO indica token —
// e renovar não cura (o /health já expõe `ml_403` com essa nota).
//
// Os dois chegam ao veredito como "invalidação sem retry", e o dono não
// distingue. Sem isso, um eixo pode ficar bloqueado para sempre por 403 de
// permissão, que nenhuma renovação vai resolver.
//
// 📌 O veredito NÃO foi afrouxado: o bloqueio continua. O que muda é dizer
// QUAL é o saldo, para a decisão ser informada em vez de adivinhada.
//
// b329.1 (Codex, P2) - o "saldo" tem que ser por STATUS, não o total bruto
// acumulado desde `DESDE`. Um 401 já resolvido por retry não pode impedir
// que um 403 pendente seja identificado como "só 403" — e um 403 já
// resolvido não pode "cobrir" um 401 pendente. Por isso este teste chama as
// funções de verdade (`anotarInvalidacao`/`anotarRetry`/`vereditoDeCorte`)
// em vez de casar texto solto no fonte: o bug só aparece quando 401 e 403
// coexistem na mesma janela, e é exatamente isso que se testa aqui.

const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const carregar = () => {
  const p = path.join(__dirname, '..', 'lib', 'token-leitor.js');
  delete require.cache[require.resolve(p)];
  for (const k of Object.keys(process.env)) if (k.startsWith('TOKEN_POLITICA_')) delete process.env[k];
  return require(p);
};

const porQue = (tl) => tl.vereditoDeCorte()['good/ml'].por_que || '';

// ── o caso real do ML: só 403, sem 401 nenhum ───────────────────────
{
  const tl = carregar();
  for (let i = 0; i < 12; i++) tl.anotarInvalidacao('good', 'ml', 403);
  tl.anotarRetry('good', 'ml', false, 403);
  tl.anotarRetry('good', 'ml', false, 403);
  const q = porQue(tl);
  ok(/TODAS por 403/.test(q), '⚠️ o caso real do ML (0x401, 12x403) aponta rota restrita (' + q + ')');
}

// ── ⚠️ o bug do apontamento: um 401 JÁ RESOLVIDO não pode esconder um
// 403 pendente. Com o total bruto, `por_401` continuava > 0 pra sempre
// depois do primeiro 401 — mesmo com o retry dele já tendo dado certo — e
// isso derrubava a detecção de "só 403" pro resto da janela.
{
  const tl = carregar();
  tl.anotarInvalidacao('good', 'ml', 401);
  tl.anotarRetry('good', 'ml', true, 401);      // 401 resolvido, sem saldo
  tl.anotarInvalidacao('good', 'ml', 403);      // 403 sem retry: pendente
  const q = porQue(tl);
  ok(/TODAS por 403/.test(q),
     '⚠️ 401 ja resolvido nao esconde o 403 pendente (' + q + ')');
}

// ── e o inverso: um 403 já resolvido não pode "cobrir" um 401 pendente
{
  const tl = carregar();
  tl.anotarInvalidacao('good', 'ml', 403);
  tl.anotarRetry('good', 'ml', true, 403);      // 403 resolvido, sem saldo
  tl.anotarInvalidacao('good', 'ml', 401);      // 401 sem retry: pendente
  const q = porQue(tl);
  ok(!/TODAS por 403/.test(q) && /por_401=1/.test(q),
     '  e um 403 ja resolvido nao e confundido com 401 pendente (' + q + ')');
}

// ── `outras` pendente também impede "só 403" ────────────────────────
{
  const tl = carregar();
  tl.anotarInvalidacao('good', 'ml', 403);      // pendente
  tl.anotarInvalidacao('good', 'ml', 500);      // outras, pendente
  const q = porQue(tl);
  ok(!/TODAS por 403/.test(q) && /outras=1/.test(q),
     '  e um saldo em `outras` tambem impede "TODAS por 403" (' + q + ')');
}

// ── ⚠️ e NÃO afrouxou: retry cobrindo tudo não gera o motivo ────────
{
  const tl = carregar();
  tl.anotarInvalidacao('good', 'ml', 401);
  tl.anotarInvalidacao('good', 'ml', 401);
  tl.anotarRetry('good', 'ml', true, 401);
  tl.anotarRetry('good', 'ml', true, 401);
  const q = porQue(tl);
  ok(!/sem retry conhecido/.test(q),
     '  retry cobrindo as invalidacoes nao gera o motivo (' + q + ')');
}

// ── e continua BLOQUEANDO quando há saldo (não afrouxa o veredito) ──
{
  const tl = carregar();
  tl.anotarInvalidacao('good', 'ml', 401);
  const v = tl.vereditoDeCorte()['good/ml'];
  ok(v.pronto === false, '⚠️ invalidacao sem retry continua bloqueando o veredito');
  ok(/sem retry conhecido/.test(v.por_que || ''), '  e o motivo aparece em `por_que`');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
