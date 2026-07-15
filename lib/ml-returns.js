// ============================================================
// ML RETURNS (v3.65) - indice de devolucoes ML por RASTREIO CORREIOS
// ------------------------------------------------------------
// Devolucoes "por agencia" do ML chegam com etiqueta dos CORREIOS
// (SEDEX/PAC REVERSO, codigo AD/AP...BR). Esse codigo NAO e shipment
// do ML - e o tracking da remessa de VOLTA. A API expoe assim:
//   GET /post-purchase/v1/claims/search           -> claims do seller
//   GET /post-purchase/v2/claims/{id}/returns     -> shipments[] da
//        devolucao, com tracking_number (o AD/AP...BR!) + shipment_id
// Estrategia (padrao Shopee/Magalu): varrer claims recentes, puxar os
// returns, montar mapa tracking->venda, PRE-AQUECIDO em background.
// Bipou o codigo Correios -> mapa -> order -> NF (fluxo ML existente).
// ============================================================

module.exports = ({ chamarML }) => {
  const IDX = { ts: 0, mapa: {}, totalClaims: 0, comTracking: 0, duracaoSeg: 0, erro: null };

  // user_id do seller (pra "acotar" a busca, como a doc recomenda) - dinamico
  let USER_ID = null;
  async function meuUserId() {
    if (USER_ID) return USER_ID;
    try {
      const r = await chamarML('https://api.mercadolibre.com/users/me');
      if (r.ok && r.data?.id) USER_ID = String(r.data.id);
    } catch (e) { /* segue sem - fallback abaixo */ }
    return USER_ID;
  }

  const normTrack = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  async function construirIndice(opts = {}) {
    const t0 = Date.now();
    const maxPaginas = opts.maxPaginas || 5; // 5 x 30 = 150 claims (~60d+ do GOOD)
    const mapa = {};
    let totalClaims = 0, comTracking = 0;

    // 1) claims recentes do seller (mais novos primeiro)
    // v3.66 - CONFIRMADO com dado real: o search EXIGE pelo menos um filtro
    // (400 "atLeastOneFilterProvided" sem ele). Com ?status=opened vieram os
    // 17 claims do GOOD. Claims costumam ficar ABERTOS ate o review do
    // produto devolvido - ou seja, o pacote no galpao ainda tem claim aberto.
    // v3.67 - PROVADO NO GALPAO: o pacote chega DEPOIS do claim fechar
    // (entrega concluida -> ML fecha). Varrer so "opened" perdia exatamente
    // os pacotes na mesa do estoquista. A doc oficial da os filtros certos:
    //   range=date_created:after:<data>  +  sort=date_created:desc
    //   players.user_id + players.role=respondent (busca "acotada")
    // Agora: TODOS os claims (abertos E fechados) dos ultimos 60 dias.
    // v3.68 - REGRA NAO-DOCUMENTADA (descoberta com o erro real): para o
    // validador do search, players/range/sort sao COMPLEMENTOS - e preciso
    // um filtro "principal" (status, type, stage...). Sem status a v3.67
    // levava "atLeastOneFilterProvided" mesmo com 4 parametros na URL.
    // Solucao: DUAS passadas (opened + closed), ambas com range de 60 dias
    // e sort desc - fechados recentes entram (pacote chega apos fechar!).
    const claims = [];
    const vistos = new Set();
    let erroBusca = null;
    const uid = await meuUserId();
    const desde = new Date(Date.now() - 60 * 864e5).toISOString().replace('Z', '-00:00');
    const extras = uid
      ? `&players.user_id=${uid}&players.role=respondent&range=date_created:after:${desde}&sort=date_created:desc`
      : '';
    for (const st of ['opened', 'closed']) {
      for (let pg = 0; pg < maxPaginas; pg++) {
        const r = await chamarML(`https://api.mercadolibre.com/post-purchase/v1/claims/search?status=${st}${extras}&offset=${pg * 30}&limit=30`);
        if (!r.ok) { erroBusca = `claims/search(${st}) HTTP ${r.status}: ${JSON.stringify(r.error || '').slice(0, 120)}`; break; }
        const lista = r.data?.data || [];
        if (lista.length === 0) break;
        for (const c of lista) {
          if (vistos.has(c.id)) continue;
          vistos.add(c.id);
          claims.push({ id: c.id, resource: c.resource, resource_id: c.resource_id, status: c.status, stage: c.stage, date: c.date_created });
        }
        if (lista.length < 30) break;
        await new Promise(s => setTimeout(s, 200));
      }
    }
    totalClaims = claims.length;

    // 2) returns de cada claim, em lotes de 4 (nem todo claim tem return - 404 e normal)
    for (let i = 0; i < claims.length; i += 4) {
      const lote = claims.slice(i, i + 4);
      await Promise.all(lote.map(async (c) => {
        try {
          const rr = await chamarML(`https://api.mercadolibre.com/post-purchase/v2/claims/${c.id}/returns`);
          if (!rr.ok) return;
          const ships = rr.data?.shipments || (rr.data?.shipping ? [rr.data.shipping] : []);
          for (const sh of ships) {
            const trk = normTrack(sh?.tracking_number);
            if (!trk) continue;
            mapa[trk] = {
              fonte: 'ml_return',
              claim_id: c.id,
              order_id: c.resource === 'order' ? String(c.resource_id) : null,
              resource: c.resource,
              resource_id: String(c.resource_id || ''),
              shipment_devolucao: sh?.shipment_id || sh?.id || null,
              status_devolucao: sh?.status || null,
              tracking: trk,
              claim_date: c.date || null,
            };
            comTracking++;
          }
        } catch (e) { /* claim sem return: segue */ }
      }));
      await new Promise(s => setTimeout(s, 180));
    }

    IDX.ts = Date.now();
    IDX.mapa = mapa;
    IDX.totalClaims = totalClaims;
    IDX.comTracking = comTracking;
    IDX.duracaoSeg = Math.round((Date.now() - t0) / 1000);
    IDX.erro = erroBusca; // v3.66 - antes um "= null" aqui APAGAVA o erro do loop
    console.log(`[ML-RETURNS] indice: ${totalClaims} claims, ${comTracking} com rastreio de devolucao, em ${IDX.duracaoSeg}s`);
    return IDX;
  }

  function statusIndice() {
    return {
      quente: IDX.ts > 0,
      idade_min: IDX.ts ? Math.round((Date.now() - IDX.ts) / 60000) : null,
      total_claims: IDX.totalClaims,
      com_tracking: IDX.comTracking,
      duracao_construcao_seg: IDX.duracaoSeg || null,
      erro: IDX.erro,
      exemplos: Object.keys(IDX.mapa).slice(0, 3),
    };
  }

  // Acha a devolucao ML pelo codigo Correios (AD641471045BR etc).
  // Reconstroi na hora se o indice estiver frio (rede de seguranca).
  async function acharPorTracking(codigo) {
    const trk = normTrack(codigo);
    if (!trk) return null;
    if (!IDX.ts || (Date.now() - IDX.ts) > 30 * 60000) {
      try { await construirIndice(); } catch (e) { /* segue com o que tiver */ }
    }
    return IDX.mapa[trk] || null;
  }

  function preAquecer() {
    construirIndice().catch(e => console.error('[ML-RETURNS] pre-aquecimento falhou:', e.message));
  }

  return { construirIndice, statusIndice, acharPorTracking, preAquecer };
};
