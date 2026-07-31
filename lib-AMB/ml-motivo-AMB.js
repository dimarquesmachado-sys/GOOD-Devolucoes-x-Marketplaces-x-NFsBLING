// ============================================================
// amb-devolucoes/lib-AMB/ml-motivo-AMB.js      (AMB Devol. b11)
// ------------------------------------------------------------
// POR QUE o produto voltou — em linguagem de galpao.
//
// Porta fiel do classificarMotivoDevolucao + contextoDaReclamacao
// da GOOD (v4.12-v4.16), que nasceu de casos reais:
//
//  - "nao entregue" = o cliente NUNCA recebeu. O produto deve
//    estar LACRADO. Se o ML marcou fraude no envio, foi ELE que
//    bloqueou no meio do caminho — nem faz sentido alertar o
//    estoquista pra "conferir com cuidado".
//  - "reclamacao" = foi entregue e o cliente reclamou. Abrir e
//    conferir bem.
//  - As mensagens do mediador do ML vem em HTML; os <li> sao o
//    resumo do caso. Limpamos e extraimos ate 4 pontos.
//  - O motivo em portugues sai por padrao de texto (arrependeu,
//    defeito, item errado, incompleto) — sem IA, deterministico.
//
// Cache em memoria por claim: o caso nao muda depois de fechado.
// ============================================================

'use strict';

const ml = require('./ml-AMB');

function limparHtml(t) {
  return String(t || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const CTX = new Map();

/** Le a reclamacao e as mensagens do mediador. */
async function contextoDaReclamacao(claimId) {
  const k = String(claimId || '');
  if (!k) return null;
  if (CTX.has(k)) return CTX.get(k);

  const ctx = { claim_id: k, motivo: null, pontos: [], pacote_consolidado: false, sem_custo_pra_voce: false, resolucao: null };
  try {
    const rc = await ml.chamarML(`/post-purchase/v1/claims/${k}`);
    if (rc.ok && rc.data) {
      ctx.resolucao = (rc.data.resolution && rc.data.resolution.reason) || null;
      ctx.reason_id = rc.data.reason_id || null;
      ctx.status_claim = rc.data.status || null;
    }
    const rm = await ml.chamarML(`/post-purchase/v1/claims/${k}/messages`);
    const msgs = (rm.ok && Array.isArray(rm.data)) ? rm.data : [];
    const textoTudo = msgs.map(m => String(m.message || '')).join(' ');

    const lis = [...textoTudo.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map(m => limparHtml(m[1])).filter(Boolean);
    ctx.pontos = lis.slice(0, 4);
    ctx.pacote_consolidado = /consolidad|um .{0,3}nico pacote|mesmo pacote/i.test(textoTudo);
    ctx.sem_custo_pra_voce = /n.{0,3}o precisa pagar nada|cobre todos os custos/i.test(textoTudo);

    const t = limparHtml(textoTudo).toLowerCase();
    if (/arrepend|desist|n.{0,3}o quer mais/.test(t)) ctx.motivo = 'arrependimento';
    else if (/defeito|avaria|quebrad|trincad|n.{0,3}o funciona|n.{0,3}o liga|n.{0,3}o acende/.test(t)) ctx.motivo = 'defeito';
    else if (/diferente|errado|n.{0,3}o .{0,3}o que/.test(t)) ctx.motivo = 'item_errado';
    else if (/incomplet|falta/.test(t)) ctx.motivo = 'incompleto';
    if (!ctx.motivo && ctx.resolucao === 'item_returned') ctx.motivo = 'devolvido';
  } catch (e) { /* melhor sem contexto do que quebrar o bipe */ }

  CTX.set(k, ctx);
  return ctx;
}

/** Classifica pelo pedido + envio (dados confirmados, nao chute). */
function classificar(order, shipment) {
  if (!order) return null;
  const tags = order.tags || [];
  const cd = order.cancel_detail || {};
  const st = String((shipment && shipment.status) || '');
  const sub = String((shipment && shipment.substatus) || '');
  const temReclamacao = Array.isArray(order.mediations) && order.mediations.length > 0;
  const fraude = tags.includes('fraud_risk_detected');

  const naoEntregue = cd.code === 'shipment_not_delivered'
    || cd.group === 'shipment'
    || st === 'not_delivered'
    || sub === 'returned'
    || (tags.includes('not_delivered') && !tags.includes('delivered'));

  if (naoEntregue) {
    return {
      tipo: 'nao_entregue',
      titulo: '🚫 O cliente NUNCA recebeu este produto',
      detalhe: fraude
        ? 'O Mercado Livre bloqueou este envio no meio do caminho por irregularidade na operação. O produto nem chegou ao cliente — deve estar LACRADO e intacto.'
        : 'Voltou sem ser entregue (recusa, endereço não encontrado ou ausente). O produto deve estar LACRADO e intacto — confira e devolva ao estoque.',
      cor: '#1565c0',
      reclamacao_id: null,
      risco_fraude: false,
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

const ROTULO = {
  arrependimento: 'Cliente se ARREPENDEU (não é defeito)',
  defeito: 'Cliente relatou DEFEITO',
  item_errado: 'Cliente diz que veio ITEM ERRADO',
  incompleto: 'Cliente diz que veio INCOMPLETO',
  devolvido: 'Produto devolvido (mediação encerrada)',
};

/**
 * O pacote completo: busca o pedido, o envio e o contexto da
 * reclamacao, e devolve o motivo pronto pra tela.
 */
async function motivoDaDevolucao({ orderId, claimId }) {
  if (!orderId) return null;
  try {
    const rO = await ml.chamarML(`/orders/${orderId}`);
    if (!rO.ok || !rO.data) return null;
    const order = rO.data;

    let shipment = null;
    const shipId = order.shipping && order.shipping.id;
    if (shipId) {
      const rS = await ml.chamarML(`/shipments/${shipId}`);
      if (rS.ok) shipment = rS.data;
    }

    const mot = classificar(order, shipment) || {};

    const cid = claimId || mot.reclamacao_id;
    if (cid) {
      const ctx = await contextoDaReclamacao(cid);
      if (ctx) {
        if (ctx.motivo && ROTULO[ctx.motivo]) mot.titulo = '⚠️ ' + ROTULO[ctx.motivo];
        if (ctx.motivo === 'arrependimento') {
          mot.detalhe = 'Não é defeito: o cliente só desistiu. O produto tende a estar em bom estado — confira e, se estiver ok, inclua no estoque.';
        } else if (ctx.motivo === 'defeito') {
          mot.detalhe = 'O cliente relatou defeito. Abra e procure o problema com atenção.';
        }
        mot.pontos_do_mediador = ctx.pontos;
        mot.pacote_consolidado = ctx.pacote_consolidado;
        mot.sem_custo_pra_voce = ctx.sem_custo_pra_voce;
        mot.reclamacao_id = mot.reclamacao_id || cid;
      }
    }

    // Titulo e SKU do anuncio — util no card mesmo sem NF
    const item0 = Array.isArray(order.order_items) && order.order_items[0];
    if (item0 && item0.item) {
      mot.produto_titulo = item0.item.title || null;
      mot.produto_sku = item0.item.seller_sku || item0.item.seller_custom_field || null;
      mot.produto_qtd = item0.quantity || null;
    }
    mot.pack_id = order.pack_id ? String(order.pack_id) : null;
    return mot;
  } catch (e) {
    return null;   // o bipe segue sem o motivo
  }
}

module.exports = { motivoDaDevolucao, contextoDaReclamacao, classificar };
