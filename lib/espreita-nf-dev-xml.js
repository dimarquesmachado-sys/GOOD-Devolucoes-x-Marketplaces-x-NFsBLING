'use strict';
// 29/10 — marca nf_devolucao_xml nos cards da espreita quando a NF de VENDA do card tem NF de DEVOLUCAO provada pelo
// XML no Bling (nf-entrada-AMB: natureza de devolucao + autorizada + <refNFe> da venda). Vale pra nota feita A MAO
// no Bling, que nao traz o numero do pedido. E a marca que a baixa em massa do painel unico aceita (#505).
// A NF de venda so vem de fonte FIRME: a do ML no card (nf_ml_numero/serie) ou a do pedido no indice de NFs
// (acharPorPedido). Palpite pelo nome fica de fora — marca errada esconderia uma devolucao pendente.
// Devolve uma lista NOVA (nao mexe nos objetos de quem chamou — podem ser do cache de um indice).
function marcarNfDevolucaoXml(lista, { jaEmitida, acharPorPedido } = {}) {
  if (!Array.isArray(lista) || typeof jaEmitida !== 'function') return Array.isArray(lista) ? lista : [];
  return lista.map((d) => {
    if (!d || d.nf_devolucao_xml) return d;
    let n = null, s = null;
    if (d.nf_ml_numero) { n = d.nf_ml_numero; s = d.nf_ml_serie; }
    else if (d.pedido && typeof acharPorPedido === 'function') {
      const v = acharPorPedido(d.pedido);
      if (v && v.numero) { n = v.numero; s = v.serie; }
    }
    if (!n || s == null || s === '') return d;   // sem a serie, nao chuta
    const r = jaEmitida({ nfVenda: n, serieVenda: s });
    if (!(r && r.emitida === true && r.via === 'xml')) return d;
    return { ...d, nf_devolucao_xml: true, nf_devolucao_emitida: (r.nf && r.nf.numero) || true };
  });
}
module.exports = { marcarNfDevolucaoXml };
