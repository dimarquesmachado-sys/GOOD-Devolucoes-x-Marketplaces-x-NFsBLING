'use strict';
// b734 — P2-09 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): LOGOUT REVOGA DE VERDADE.
//
// O token de sessao e ASSINADO (HMAC) e vale ate vencer, sem depender de memoria: foi assim que o deploy parou de
// deslogar o galpao (v4.50 / b130). O efeito colateral: `sair()` so apagava o Map e o cookie — um token capturado
// (print, log, extensao) continuava entrando ate a meia-noite. Esta peca e a LISTA DE REVOGADOS por empresa:
//   - revogarToken(token, expiraEm): ESTA sessao (o logout do aparelho) — guarda so o hash, ate o token vencer;
//   - revogarUsuario(usuario, antesDe): TODAS as sessoes do usuario criadas antes do carimbo (troca de senha/papel,
//     "sair de todos os aparelhos");
//   - revogado(token, dados): o que o validarSessao pergunta ANTES de aceitar um token assinado.
// Vive na memoria do processo (a lista e pequena: so logouts ate a meia-noite). Sobreviver ao reinicio exigiria
// tabela no banco — decisao do dono (DDL), anotada no roteiro.
const crypto = require('crypto');

function criar({ agora = () => Date.now() } = {}) {
  const tokens = new Map();     // hash do token -> expira em (ms)
  const usuarios = new Map();   // usuario -> tokens criados antes deste carimbo nao valem
  const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('base64');
  let ultimaLimpeza = 0;
  function limpar() {
    const t = agora();
    if (t - ultimaLimpeza < 60000) return;
    ultimaLimpeza = t;
    for (const [h, exp] of tokens) if (exp <= t) tokens.delete(h);
  }
  return {
    revogarToken(token, expiraEm) {
      if (!token) return false;
      limpar();
      // sem expiracao conhecida: guarda por 24h (o teto de qualquer sessao: 12h ou a meia-noite)
      // Codex #600: e nunca alem disso (a validade vinda do chamador nao prende a entrada pra sempre)
      const teto = agora() + 24 * 3600 * 1000;
      tokens.set(hash(token), Number(expiraEm) > 0 ? Math.min(Number(expiraEm), teto) : teto);
      return true;
    },
    revogarUsuario(usuario, antesDe) {
      const u = String(usuario || '').trim().toLowerCase();
      if (!u) return false;
      usuarios.set(u, Number(antesDe) > 0 ? Number(antesDe) : agora());
      return true;
    },
    // dados = { usuario, criado } do token ja verificado pela assinatura
    revogado(token, dados) {
      limpar();
      if (token && tokens.has(hash(token))) return true;
      const u = String((dados && dados.usuario) || '').trim().toLowerCase();
      if (u && usuarios.has(u)) {
        const criado = Number(dados && dados.criado) || 0;
        if (!criado || criado < usuarios.get(u)) return true;   // sem `c` (token de antes do b734): vale como antigo; login no MESMO ms da revogacao e novo
      }
      return false;
    },
    tamanho() { limpar(); return { tokens: tokens.size, usuarios: usuarios.size }; },
  };
}

module.exports = { criar };
