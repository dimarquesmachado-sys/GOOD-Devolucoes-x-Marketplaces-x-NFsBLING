// ════════════════════════════════════════════════════════════════════
//  amb-devolucoes · lib/admin-helpers  (AMB Devol. b71)
//  Os ajudantes que o modulo de rotas do painel pede. Desde o b703 as
//  buscas de NF/pedido no Bling sao a peca unica lib/bling-buscas.js
//  (a GOOD usa a mesma); aqui ficam so o motivo da devolucao do ML e a
//  NF do envio, recebendo por injecao o chamarBling/chamarML/sleep.
// ════════════════════════════════════════════════════════════════════
'use strict';

module.exports = function criar({ chamarBling, chamarML, buscarNFePorId, buscarPedidoPorId, sleep, rotulo }) {
  // b703: `buscarPedidoPorId` (formato CRU, como o `buscarNFePorId`) e o que a fase 2 da blindada usa — antes ela
  // chamava o Bling direto porque a funcao nao existia aqui (b203.3)
  if (typeof buscarPedidoPorId !== 'function') throw new Error('admin-helpers: faltou injetar buscarPedidoPorId');

/** A NF que o ML guarda pro envio (invoice_data). */
async function buscarNFnoML(shipmentId) {
  return chamarML(`https://api.mercadolibre.com/shipments/${shipmentId}/invoice_data?siteId=MLB`);
}

// ── b71: os 2 que a rota identificar da GOOD tambem pede ──

function classificarMotivoDevolucao(order, shipment) {
  if (!order) return null;
  const tags = order.tags || [];
  const cd = order.cancel_detail || {};
  const st = String(shipment?.status || '');
  const sub = String(shipment?.substatus || '');
  const temReclamacao = Array.isArray(order.mediations) && order.mediations.length > 0;
  const fraude = tags.includes('fraud_risk_detected');

  const naoEntregue = cd.code === 'shipment_not_delivered'
    || cd.group === 'shipment'
    || st === 'not_delivered'
    || sub === 'returned'
    || (tags.includes('not_delivered') && !tags.includes('delivered'));

  if (naoEntregue) {
    // v4.16 - se o ML marcou irregularidade E o produto nao foi entregue, foi
    // ELE que bloqueou o envio no meio do caminho. O produto nem chegou perto
    // do cliente - nao faz sentido pedir "cuidado ao conferir".
    return {
      tipo: 'nao_entregue',
      titulo: '🚫 O cliente NUNCA recebeu este produto',
      detalhe: fraude
        ? 'O Mercado Livre bloqueou este envio no meio do caminho por irregularidade na operação. O produto nem chegou ao cliente — deve estar LACRADO e intacto.'
        : 'Voltou sem ser entregue (recusa, endereço não encontrado ou ausente). O produto deve estar LACRADO e intacto — confira e devolva ao estoque.',
      cor: '#1565c0',
      reclamacao_id: null,
      risco_fraude: false,          // nada a alertar: o produto nao circulou
      bloqueado_pelo_ml: fraude,
    };
  }
  if (temReclamacao || cd.group === 'mediations') {
    return {
      tipo: 'reclamacao',
      titulo: '⚠️ O cliente ABRIU RECLAMAÇÃO',
      detalhe: 'Foi entregue e o cliente reclamou. Abra e confira bem o produto antes de decidir.',
      cor: '#e65100',
      reclamacao_id: temReclamacao ? String(order.mediations[0].id) : null,
      risco_fraude: fraude,
    };
  }
  return {
    tipo: 'devolucao_simples',
    titulo: '📦 Devolução sem reclamação registrada',
    detalhe: 'Confira o produto normalmente.',
    cor: '#616161',
    reclamacao_id: null,
    risco_fraude: fraude,
  };
}

// b703 - AS BUSCAS DE NF SAIRAM DAQUI: viraram a peca unica lib/bling-buscas.js (a GOOD usa a mesma). O que a fabrica
// ganhou: `opcoes.fundo` descendo pra fila do Bling, a busca por order_id em fatias (b197) e a de pedido por numeroLoja.
// O que levou pra la: o `parar()` da blindada e a NF viva mais recente (b172).
const buscas = require('../../lib/bling-buscas')({ chamarBling, buscarNFePorId, buscarPedidoPorId, sleep, rotulo });

return { buscarNFnoML, classificarMotivoDevolucao, ...buscas };
};
