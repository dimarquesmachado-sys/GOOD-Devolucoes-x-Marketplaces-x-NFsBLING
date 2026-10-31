'use strict';
// 31/10 — o login do Devolucoes ACABA NA MEIA-NOITE de Sao Paulo (ou nas 12 h de sempre, o que vier primeiro).
// Dono, 31/10: 'faz o login expirar quando der meia noite ... assim exige q sempre pela manha seguinte o funcionario use
// o login e senha dele mesmo pra logar e acessar. se nao, acaba risco de um funcionario usar login do outro.'
// Antes: 12 h a partir do login — quem entrava as 20h ficava logado ate as 8h do dia seguinte, e o turno da manha
// comecava com a sessao de outra pessoa. Peca unica: GOOD (server.js) e Girassol/AMB (auth-AMB.js) usam esta.
// O fuso e o do galpao (Taboao da Serra). O Brasil nao tem horario de verao desde 2019 (dia de 24 h).
const FUSO = 'America/Sao_Paulo';
const DOZE_HORAS = 12 * 60 * 60 * 1000;
const FMT = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

function msDesdeMeiaNoite(ms) {
  const p = {};
  for (const x of FMT.formatToParts(new Date(ms))) p[x.type] = x.value;
  const h = Number(p.hour) % 24;   // en-US com hour12:false pode devolver '24' na meia-noite
  return ((h * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000 + (((ms % 1000) + 1000) % 1000);
}
// a meia-noite (em Sao Paulo) que vem DEPOIS deste instante
function proximaMeiaNoite(ms) {
  return ms - msDesdeMeiaNoite(ms) + 24 * 60 * 60 * 1000;
}
// quando a sessao criada neste instante acaba: o que vier primeiro, as 12 h ou a meia-noite
function expiraEm(criadoMs, validadeMs) {
  const c = Number(criadoMs) || Date.now();
  return Math.min(c + (Number(validadeMs) || DOZE_HORAS), proximaMeiaNoite(c));
}
function venceu(criadoMs, validadeMs, agora = Date.now()) {
  const c = Number(criadoMs);
  if (!c) return false;   // sem a hora do login nao ha o que medir (quem chama tem a propria regra de expiracao)
  return agora >= expiraEm(c, validadeMs);
}
// o cookie acaba junto com a sessao (no minimo 1 min, pra login colado na meia-noite nao virar cookie de 0 s)
function maxAgeCookie(validadeMs, agora = Date.now()) {
  return Math.max(60 * 1000, expiraEm(agora, validadeMs) - agora);
}

module.exports = { FUSO, DOZE_HORAS, proximaMeiaNoite, expiraEm, venceu, maxAgeCookie };
