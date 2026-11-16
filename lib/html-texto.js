'use strict';
// lib/html-texto.js — b707 (P1-02 do ROTEIRO-LIQUIDACAO-2026-11). Texto que vai pra dentro de HTML montado no
// servidor (paginas de callback do OAuth, setups). O que vem do provedor ou da query (code, error_description,
// escopo, conta, mensagem de erro) e DADO: vira entidade, nunca tag. Peca unica — GOOD e fabrica usam a mesma.
function escaparHtml(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
module.exports = { escaparHtml };
