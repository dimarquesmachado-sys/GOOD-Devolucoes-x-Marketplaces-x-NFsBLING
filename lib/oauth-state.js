'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  lib/oauth-state.js — b709 (P1-11 do ROTEIRO-LIQUIDACAO-2026-11)
//
//  O `state` do OAuth: aleatorio, de uso unico, com validade curta, guardado POR EMPRESA (cada instancia tem o
//  seu Map — um state da Girassol nao existe no da GOOD). Era codigo da fabrica (app-AMB.js, b343/b353); a GOOD
//  mandava `state='good'` fixo e o callback dela nem olhava — qualquer code que chegasse era trocado e gravado.
//  Agora e peca unica: a fabrica passa a gaveta dela (`GAVETAS.triagem.pendentes`), a GOOD cria a sua.
// ════════════════════════════════════════════════════════════════════════════
const crypto = require('crypto');

const VALIDADE_PADRAO_MS = 10 * 60 * 1000;

function criar({ pendentes = new Map(), validadeMs = VALIDADE_PADRAO_MS, agora = Date.now } = {}) {
  /** Gera e registra um state novo; `extras` (ex.: { empresa }) volta no registro ao consumir. */
  function novoState(servico, extras) {
    const s = crypto.randomBytes(24).toString('hex');
    pendentes.set(s, Object.assign({}, extras || {}, { servico, criado_em: agora() }));
    for (const [k, v] of pendentes) {
      if (agora() - v.criado_em > validadeMs) pendentes.delete(k);
    }
    return s;
  }

  /** Devolve o registro UMA vez (e apaga); null se desconhecido, ja usado ou vencido. */
  function consumirState(s) {
    const reg = pendentes.get(s);
    if (!reg) return null;
    pendentes.delete(s);
    if (agora() - reg.criado_em > validadeMs) return null;
    return reg;
  }

  return { novoState, consumirState, VALIDADE_MS: validadeMs };
}

module.exports = { criar, VALIDADE_PADRAO_MS };
