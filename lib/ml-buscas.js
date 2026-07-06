// ============================================================
// lib/ml-buscas.js (v3.42)
// ------------------------------------------------------------
// Helpers de busca no Mercado Livre (claims, returns, orders por
// comprador). Extraidos do server.js LITERAL para enxugar.
// Todos dependem de chamarML, que e injetado na criacao:
//
//   const mlBuscas = require('./lib/ml-buscas')(mlClient.chamarML);
//   const r = await mlBuscas.buscarClaimsPorShipment(id);
// ============================================================

module.exports = function criarMlBuscas(chamarML) {

  function extrairClaimsDaResposta(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.claims)) return data.claims;
    if (data.id) return [data];
    return [];
  }

  async function buscarClaimsPorShipment(shipmentId) {
    // Tenta varias formas - inclui claims fechados (status nao filtrado)
    const tentativas = [
      `https://api.mercadolibre.com/post-purchase/v1/claims/search?resource=shipment&resource_id=${shipmentId}`,
      `https://api.mercadolibre.com/post-purchase/v1/claims/search?shipment_id=${shipmentId}`,
      `https://api.mercadolibre.com/post-purchase/v1/claims/search?resource=shipment&resource_id=${shipmentId}&status=closed`,
    ];
    for (const url of tentativas) {
      const r = await chamarML(url);
      if (r.ok) {
        const claims = extrairClaimsDaResposta(r.data);
        if (claims.length > 0) return { ok: true, claims, raw: r.data };
      }
    }
    return { ok: false, claims: [] };
  }

  // NOVO v3.13: pra shipment com tags=claims_return mas sem order_id direto
  // Tenta buscar a order original via endpoint /shipments/{id}/orders
  async function buscarOrderViaShipmentReturn(shipmentId) {
    const tentativas = [
      // Endpoint que retorna a(s) order(s) vinculadas ao shipment
      `https://api.mercadolibre.com/shipments/${shipmentId}/orders`,
      // Alternativo - shipment items com expand de pack
      `https://api.mercadolibre.com/shipments/${shipmentId}/items`,
    ];
    for (const url of tentativas) {
      const r = await chamarML(url);
      if (r.ok && r.data) {
        // Busca order_id em varios formatos possiveis de resposta
        const possiveis = [
          r.data?.order_id,
          r.data?.id,
          r.data?.[0]?.order_id,
          r.data?.[0]?.id,
          r.data?.results?.[0]?.id,
          r.data?.orders?.[0]?.id,
        ].filter(Boolean);

        if (possiveis.length > 0) {
          return { ok: true, orderId: String(possiveis[0]), raw: r.data, url };
        }
      }
    }
    return { ok: false };
  }

  async function buscarClaimDetalhada(claimId) {
    return chamarML(`https://api.mercadolibre.com/post-purchase/v1/claims/${claimId}`);
  }

  async function buscarReturnPorClaim(claimId) {
    return chamarML(`https://api.mercadolibre.com/post-purchase/v2/claims/${claimId}/returns`);
  }

  async function buscarOrdersPorComprador(buyerId, sellerId) {
    // Limita a 20 mais recentes pra nao pegar venda antiga aleatoria
    return chamarML(
      `https://api.mercadolibre.com/orders/search?seller=${sellerId}&buyer=${buyerId}&sort=date_desc&limit=20`
    );
  }

  return {
    extrairClaimsDaResposta,
    buscarClaimsPorShipment,
    buscarOrderViaShipmentReturn,
    buscarClaimDetalhada,
    buscarReturnPorClaim,
    buscarOrdersPorComprador,
  };
};
