// Roda com: node test/ml-403-permanente.test.js
//
// ⚠️ ACHADO DE PRODUÇÃO, 09/09: a telemetria do `/health` mostrou, em 113
// minutos de operação real, **10 respostas 403 do ML e 10 retries
// falhados**. Cem por cento. Renovar o token nunca resolveu nenhum.
//
// E o dono não viu nada na tela — os 403 vêm de rotina de fundo (o ciclo
// de datas de entrega, que roda a cada 5 min).
//
// ⚠️ POR QUE ISSO CUSTA CARO: cada renovação à toa QUEIMA UM REFRESH DE
// USO ÚNICO. Era exatamente o alerta que o Mover-Pedidos trouxe no mesmo
// dia — e a telemetria mostrou que a gente fazia isso 10x em 2 horas.
//
// A tensão que o conserto respeita: em março (v3.40) um 403 ERA token
// vencido, e renovar resolvia. Os dois são verdade — causas diferentes com
// o mesmo código. Então não escolhi um lado: renovo UMA vez e, se o retry
// falhar, aquele recurso para de disparar renovação.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'lib', 'ml.js'), 'utf8');
const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── a lista existe e tem teto ────────────────────────────────────────
{
  ok(/const ML_403_PERMANENTE = new Set\(\)/.test(codigo),
     'existe a lista dos 403 ja provados permanentes');
  ok(/ML_403_MAX/.test(codigo),
     '  com teto (a memoria nao cresce sem limite)');
  ok(/ML_403_PERMANENTE\.size < ML_403_MAX/.test(codigo),
     '  e o teto e conferido ANTES de inserir');
}

// ── ⚠️ só entra na lista quem PROVOU que renovar não resolve ─────────
//
// A marcação acontece no catch do retry — ou seja, depois de já ter
// renovado uma vez. Marcar antes disso quebraria o caso de março.
{
  const iRetry = codigo.indexOf("anotarRetry('good', 'ml', false)");
  const trechoRetry = codigo.slice(iRetry, iRetry + 500);
  ok(/ML_403_PERMANENTE\.add/.test(trechoRetry),
     'a marcacao acontece no catch do RETRY (ja renovou uma vez)');
  ok(/st === 403 &&/.test(trechoRetry),
     '  ⚠️ e SO em 403 — um 401 que falha no retry pode ser passageiro');
}

// ── e o 403 já conhecido NÃO dispara renovação ───────────────────────
{
  const iGuarda = codigo.indexOf('ML_403_PERMANENTE.has');
  ok(iGuarda > 0, 'ha uma guarda que consulta a lista');
  const iGatilho = codigo.indexOf('if (st === 401');
  ok(iGuarda < iGatilho,
     '  ⚠️ e ela vem ANTES do gatilho de renovacao (senao renovaria assim mesmo)');

  const trechoGuarda = codigo.slice(iGuarda - 200, iGuarda + 400);
  ok(/permissaoNegada/.test(trechoGuarda),
     '  e devolve o erro marcado, pra quem chamou saber que e permissao');
}

// ── ⚠️ o conserto é VISÍVEL ──────────────────────────────────────────
//
// Sem isso ninguém saberia se a lista tem 0 ou 50 recursos, nem quais — e
// "parou de queimar refresh" viraria fé.
{
  ok(/function diagnostico403/.test(src), 'ha diagnostico da lista');
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  ok(/ml_403_permanente/.test(srv), '  exposto no /health');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
