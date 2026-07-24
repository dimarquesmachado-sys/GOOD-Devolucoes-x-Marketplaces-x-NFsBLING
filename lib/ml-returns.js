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
    // v3.69 - o teto de 5 paginas (150) CORTAVA os fechados: com 149 closed
    // no indice e etiquetas reais ainda de fora, ficou claro que ha mais de
    // 150 claims em 60d. O range ja limita o universo (60 dias), entao da
    // pra paginar ate esgotar - o teto agora e so seguranca (20 pg = 600).
    const maxPaginas = opts.maxPaginas || 30; // v3.70: 120d de closed cabe em ate 900/status
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
    // v3.70 - janela 60d perdia 3 das 4 etiquetas reais do galpao: pacote de
    // devolucao pode ficar MESES na pilha antes do bipe. 120 dias cobre.
    const desde = new Date(Date.now() - 120 * 864e5).toISOString().replace('Z', '-00:00');
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
    // v3.72 - RETRY: uma falha transitoria (429/timeout) num claim deixava a
    // devolucao SEM tracking no mapa - silenciosamente (caso real: claim
    // 5536987606/AP176823194BR escapou assim). Agora: ate 3 tentativas com
    // pausa crescente, e as falhas persistentes CONTAM no status (visiveis).
    // v3.73 - 13 falhas PERSISTENTES na v3.72 = rate limit sistematico: a
    // rajada (~470 chamadas) derrubava ate os retries, que caiam DENTRO da
    // janela de punicao. Cura dupla: (a) menos pressao (lotes de 3, pausas
    // maiores, backoff de 1s/2.5s no 429) e (b) SEGUNDA RODADA sequencial
    // so dos falhados, depois de respirar - na pratica zera.
    let falhasReturns = 0;
    const falhados = [];
    const amostraFalhas = []; // v3.73.1 - QUEM falha e COM QUE ERRO (13 cravado 2x = deterministico, nao rate limit)
    async function puxarReturns(c, guardarFalha) {
      let rr = null;
      for (let tent = 0; tent < 3; tent++) {
        rr = await chamarML(`https://api.mercadolibre.com/post-purchase/v2/claims/${c.id}/returns`);
        if (rr.ok || rr.status === 404) break; // 404 = claim sem return (normal)
        if (rr.status && rr.status !== 429 && rr.status >= 400 && rr.status < 500) break; // 4xx deterministico: nao insistir
        await new Promise(s => setTimeout(s, 1000 + tent * 1500));
      }
      if (!rr.ok) {
        // v3.74 - VEREDITO do raio-x: os "13" eram 401/403 "not authorized
        // to obtain claim" - o ML NEGA ao seller o return de certos tipos de
        // mediacao, por design. Sem acesso = sem tracking a extrair = NORMAL
        // (como o 404). O contador agora aponta so falha REAL (500/timeout).
        if (rr.status !== 404 && rr.status !== 401 && rr.status !== 403) {
          if (guardarFalha) falhados.push(c);
          if (amostraFalhas.length < 6) {
            amostraFalhas.push({ claim_id: c.id, status: rr.status || null, erro: JSON.stringify(rr.error || '').slice(0, 100) });
          }
        }
        return null;
      }
      return rr;
    }
    for (let i = 0; i < claims.length; i += 3) {
      const lote = claims.slice(i, i + 3);
      await Promise.all(lote.map(async (c) => {
        try {
          const rr = await puxarReturns(c, true);
          if (!rr) return;
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
              destino: sh?.destination?.name || null, // v3.85: seller_address = vem pro galpao | warehouse = CD do ML
              status_money: rr.data?.status_money || null,
            };
            comTracking++;
          }
        } catch (e) { /* claim sem return: segue */ }
      }));
      await new Promise(s => setTimeout(s, 350));
    }

    // SEGUNDA RODADA: so os falhados, sequencial e com calma (5s de respiro)
    if (falhados.length > 0) {
      console.log(`[ML-RETURNS] 2a rodada: ${falhados.length} claims falhados - respirando 5s...`);
      await new Promise(s => setTimeout(s, 5000));
      for (const c of falhados) {
        try {
          const rr = await puxarReturns(c, false);
          if (!rr) { falhasReturns++; continue; }
          const ships = rr.data?.shipments || (rr.data?.shipping ? [rr.data.shipping] : []);
          for (const sh of ships) {
            const trk = normTrack(sh?.tracking_number);
            if (!trk) continue;
            mapa[trk] = {
              fonte: 'ml_return', claim_id: c.id,
              order_id: c.resource === 'order' ? String(c.resource_id) : null,
              resource: c.resource, resource_id: String(c.resource_id || ''),
              shipment_devolucao: sh?.shipment_id || sh?.id || null,
              status_devolucao: sh?.status || null,
              tracking: trk, claim_date: c.date || null,
              destino: sh?.destination?.name || null, // v3.85: seller_address = vem pro galpao | warehouse = CD do ML
              status_money: rr.data?.status_money || null,
            };
            comTracking++;
          }
        } catch (e) { falhasReturns++; }
        await new Promise(s => setTimeout(s, 450));
      }
    }

    IDX.ts = Date.now();
    IDX.mapa = mapa;
    IDX.totalClaims = totalClaims;
    IDX.comTracking = comTracking;
    IDX.falhasReturns = falhasReturns;
    IDX.amostraFalhas = amostraFalhas;
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
      returns_com_falha_persistente: IDX.falhasReturns || 0,
      amostra_falhas: IDX.amostraFalhas || [],
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

  // v3.77 - A ESPREITA ML: classifica as devolucoes do indice pelo status
  // do shipment de volta. Em transito = pacote a caminho do galpao.
  function resumoEspreita() {
    const dias = (iso) => iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null;
    const EM_TRANSITO = ['shipped', 'ready_to_ship', 'handling', 'pending'];
    const emTransito = [], aguardando = [], entreguesLista = [];
    let entregues = 0;
    for (const d of Object.values(IDX.mapa)) {
      const st = String(d.status_devolucao || '').toLowerCase();
      if (st === 'delivered') {
        entregues++;
        // v3.85 - DESCOBERTA: 'delivered' com destino warehouse = chegou no CD
        // do ML (Cajamar), NAO no galpao. O ML revisa e SO DEPOIS manda pra
        // gente. Alertar "ninguem bipou" nesses casos era falso positivo.
        if (d.destino === 'warehouse') {
          emTransito.push({ marketplace: 'ml', pedido: d.order_id, tracking: d.tracking, status: 'em revisão no CD do ML', dias_em_transito: dias(d.claim_date), claim_id: d.claim_id, status_money: d.status_money || null, no_cd_ml: true });
          continue;
        }
        entreguesLista.push({ marketplace: 'ml', pedido: d.order_id, tracking: d.tracking, dias_desde: dias(d.claim_date), claim_id: d.claim_id });
        continue;
      }
      if (st === 'label_generated') { aguardando.push(d); continue; }
      if (EM_TRANSITO.includes(st)) {
        emTransito.push({ marketplace: 'ml', pedido: d.order_id, tracking: d.tracking, status: st, dias_em_transito: dias(d.claim_date), claim_id: d.claim_id, status_money: d.status_money || null, no_cd_ml: d.destino === 'warehouse' });
      }
    }
    emTransito.sort((x, y) => (y.dias_em_transito || 0) - (x.dias_em_transito || 0));
    entreguesLista.sort((x, y) => (x.dias_desde || 0) - (y.dias_desde || 0));
    return { quente: IDX.ts > 0, em_transito: emTransito, aguardando_postagem: aguardando.length, entregues_indice: entregues, entregues: entreguesLista };
  }

  function preAquecer() {
    construirIndice().catch(e => console.error('[ML-RETURNS] pre-aquecimento falhou:', e.message));
  }

  return { construirIndice, statusIndice, acharPorTracking, preAquecer, resumoEspreita };
};
