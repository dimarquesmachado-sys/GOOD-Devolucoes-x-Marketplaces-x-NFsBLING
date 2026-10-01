'use strict';
/* ============================================================
 * lib/triagem-tem-origem.js
 * ------------------------------------------------------------
 * UMA TRIAGEM "APROVADA" PRECISA DE ORIGEM: pedido, rastreio ou NF.
 *
 * ⚠️ O CASO REAL (Girassol, 30/09): o estoquista bipou o CÓDIGO DE BARRAS
 * DO PRODUTO em vez do rastreio da etiqueta. O sistema achou o produto no
 * Bling, não achou pedido nenhum — e deixou aprovar. Nasceram 3 cards com
 * SKU e quantidade e NADA mais: sem NF, sem cliente, sem pedido, sem
 * funcionário. O dono viu no painel e não tinha como emitir a nota de
 * devolução, porque não há nota de venda pra devolver.
 *
 * "Aprovado" quer dizer "o que voltou confere com a NF". Sem NF nem pedido
 * não há com o que conferir — o card nasce inútil, e quem descobre é o dono,
 * horas depois, não o estoquista, na hora.
 *
 * 📌 A trava vale pras 3 empresas (a GOOD e a fábrica usam este módulo). A
 * mensagem ensina o que fazer, porque o erro é de operação, não de código.
 * ============================================================ */

// ⚠️ b461 (Codex, P1) - a lista tem que ser a UNIAO do que CADA rota de
// aprovar ja aceitava. A GOOD validava `shipment_id || nf_chave ||
// magalu_protocolo` — e esta trava rodava ANTES, sem `nf_chave` nem
// `magalu_protocolo`: um bipe pela chave DANFE ou pelo protocolo Magalu era
// recusado por mim antes de chegar na validacao que o aceitaria. Ficou 1 dia
// no ar. Trava nova nao pode ser mais estreita que a validacao que ja existia.
const CAMPOS_ORIGEM = [
  'shipment_id', 'nf_chave', 'magalu_protocolo',          // os que a GOOD ja exigia
  'order_id', 'pack_id', 'tracking', 'nf_numero', 'pedido_bling_numero',   // os da AMB/Girassol
];

/**
 * @returns {{ ok: true } | { ok: false, erro: string, status: number }}
 */
function conferirOrigem(payload) {
  const d = payload || {};
  const tem = CAMPOS_ORIGEM.some((k) => {
    const v = d[k];
    return v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '-';
  });
  if (tem) return { ok: true };
  return {
    ok: false,
    status: 422,
    erro: 'Esta triagem nao tem pedido, rastreio nem NF — nao da pra aprovar. '
      + 'Provavelmente foi bipado o CODIGO DE BARRAS DO PRODUTO. '
      + 'Bipe o RASTREIO da etiqueta de devolucao (o codigo grande da etiqueta do marketplace). '
      + 'Se o pacote chegou sem etiqueta, registre como PROBLEMA, com foto, em vez de aprovar.',
    sem_origem: true,
  };
}

module.exports = { conferirOrigem, CAMPOS_ORIGEM };
