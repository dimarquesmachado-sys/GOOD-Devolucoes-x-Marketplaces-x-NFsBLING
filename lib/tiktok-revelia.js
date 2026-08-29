// ============================================================
// lib/tiktok-revelia.js
// ------------------------------------------------------------
// Diz QUAIS devolucoes do TikTok estao prestes a ser perdidas por
// falta de resposta — e quanto isso custa.
//
// ------------------------------------------------------------
// POR QUE ISTO EXISTE
//
// Os dois prejuizos que o dono conferiu no extrato em 29/08 nao foram
// julgamento: foram REVELIA. O TikTok aprovou o reembolso porque
// ninguem respondeu no prazo. O texto do evento e explicito:
//
//   "This refund was approved because it was not reviewed within the
//    required timeframe"
//
// Num deles (pedido 585514776487560610) o cliente ficou com o produto,
// o valor voltou inteiro, e ainda foram cobrados o frete e a comissao:
// R$ 21,12 creditados contra R$ 41,01 debitados. Prejuizo de R$ 19,89
// MAIS a mercadoria.
//
// Nas palavras dele: "o tiktok deu revelia digamos, e deu válido a
// reclamação do cliente, ele ficando com o produto, estornou o
// pagamento todo, e ainda nos cobrou o frete e a comissão. então fica
// pesado qdo não respondemos no prazo".
//
// ------------------------------------------------------------
// O RELOGIO
//
// Medido pela conversa do Checkout nos dois casos reais: a revelia caiu
// 6 e 7 dias depois de o cliente postar (evento BUYER_SHIPPED).
//
// Por isso o alerta e escalonado e conservador: comeca a avisar no 4o
// dia, fica urgente no 5o. Melhor avisar cedo demais — o custo de olhar
// um caso a toa e zero perto de perder um.
// ============================================================

const DIAS_ATE_REVELIA = 6;      // o menor prazo observado
const AVISO_A_PARTIR_DE = 4;     // dois dias de folga
const URGENTE_A_PARTIR_DE = 5;   // ultimo dia util pra agir

/** Eventos que dizem que o caso ACABOU — sai da janela de risco. */
const EVENTOS_FIM = [
  'REFUND_SUCCESS',
  'SELLER_REJECT_RECEIVE_DELIVERED_TIMEOUT',   // ja perdeu por revelia
  'RETURN_OR_REFUND_REQUEST_CANCEL',
  'CANCEL',
];

/** O evento que INICIA o relogio: o cliente postou. */
const EVENTO_POSTOU = 'BUYER_SHIPPED';

function paraData(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) {
    // o TikTok manda em SEGUNDOS; se vier em milissegundos, o numero
    // passa de 1e12 e a conversao muda
    return new Date(n > 1e12 ? n : n * 1000);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Lê a linha do tempo de UMA devolucao e diz em que pe ela esta.
 *
 * Devolve { postou_em, dias_desde_postagem, fechado, perdido_por_revelia,
 *           risco: 'ok' | 'atencao' | 'urgente' | null }
 */
function avaliar(eventos, agora) {
  const lista = Array.isArray(eventos) ? eventos : [];
  const hoje = agora ? new Date(agora) : new Date();

  let postouEm = null;
  let fechado = false;
  let revelia = false;

  for (const e of lista) {
    if (!e) continue;
    const nome = String(e.evento || e.event || e.type || e.status || '').toUpperCase();
    const quando = paraData(e.data || e.create_time || e.time || e.timestamp);

    if (nome.indexOf(EVENTO_POSTOU) !== -1 && quando) {
      // a postagem mais RECENTE manda: se o cliente postou de novo, o
      // relogio recomeca
      if (!postouEm || quando > postouEm) postouEm = quando;
    }
    if (EVENTOS_FIM.some((f) => nome.indexOf(f) !== -1)) fechado = true;
    if (nome.indexOf('TIMEOUT') !== -1) revelia = true;
  }

  if (!postouEm) {
    // o cliente ainda nao postou: nao ha relogio correndo
    return { postou_em: null, dias_desde_postagem: null, fechado, perdido_por_revelia: revelia, risco: null };
  }

  const dias = Math.floor((hoje.getTime() - postouEm.getTime()) / 864e5);

  let risco = 'ok';
  if (fechado) risco = null;                              // acabou, nao ha o que fazer
  else if (dias >= URGENTE_A_PARTIR_DE) risco = 'urgente';
  else if (dias >= AVISO_A_PARTIR_DE) risco = 'atencao';

  return {
    postou_em: postouEm.toISOString(),
    dias_desde_postagem: dias,
    dias_ate_revelia: Math.max(0, DIAS_ATE_REVELIA - dias),
    fechado,
    perdido_por_revelia: revelia,
    risco,
  };
}

/**
 * Percorre a resposta de /tiktok/devolucoes-eventos e separa o que
 * precisa de acao AGORA do que ja se perdeu.
 *
 * O formato de la pode variar, entao aceito as duas formas que a
 * conversa do Checkout descreveu: uma lista pronta de "aguardando
 * analise", ou os registros crus com os eventos dentro.
 */
function separar(corpo, agora) {
  const emRisco = [];
  const perdidas = [];

  const registros = (corpo && (corpo.devolucoes || corpo.registros || corpo.aguardando_analise)) || [];

  for (const r of registros) {
    if (!r) continue;
    const eventos = r.eventos || r.records || r.events || [];
    const av = avaliar(eventos, agora);

    const item = {
      id: r.id || r.return_id || null,
      pedido: r.pedido || r.order_id || null,
      valor: r.valor != null ? Number(r.valor) : (r.refund_amount != null ? Number(r.refund_amount) : null),
      motivo: r.motivo_texto || r.return_reason_text || r.motivo || null,
      ...av,
    };

    if (av.perdido_por_revelia) perdidas.push(item);
    else if (av.risco === 'atencao' || av.risco === 'urgente') emRisco.push(item);
  }

  // o mais urgente primeiro: quem tem menos tempo aparece no topo
  emRisco.sort((a, b) => (b.dias_desde_postagem || 0) - (a.dias_desde_postagem || 0));

  const soma = (lista) => Number(lista.reduce((t, x) => t + (Number(x.valor) || 0), 0).toFixed(2));

  return {
    em_risco: emRisco,
    perdidas,
    total_em_risco: emRisco.length,
    valor_em_risco: soma(emRisco),
    total_perdidas: perdidas.length,
    valor_perdido: soma(perdidas),
    urgentes: emRisco.filter((x) => x.risco === 'urgente').length,
  };
}

module.exports = {
  avaliar, separar,
  DIAS_ATE_REVELIA, AVISO_A_PARTIR_DE, URGENTE_A_PARTIR_DE,
  EVENTOS_FIM, EVENTO_POSTOU,
};
