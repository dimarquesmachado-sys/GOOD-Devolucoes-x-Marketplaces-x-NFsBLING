// ============================================================
// amb-devolucoes/lib-AMB/ml-returns-AMB.js     (AMB Devol. b33)
// ------------------------------------------------------------
// INDICE DE DEVOLUCOES DO ML POR RASTREIO DOS CORREIOS.
//
// O PROBLEMA QUE ISTO RESOLVE: devolucao "por agencia" do ML
// chega com etiqueta dos CORREIOS (codigo AD/AP...BR). Esse
// codigo NAO existe em lugar nenhum do pedido — ele so aparece
// dentro da RECLAMACAO. Sem este indice, o estoquista bipa a
// caixa e o sistema nao faz ideia de que venda e aquela.
//
// COMO FUNCIONA:
//   GET /post-purchase/v1/claims/search        -> claims do seller
//   GET /post-purchase/v2/claims/{id}/returns  -> shipments[] com
//        tracking_number (o AD/AP...BR) + destino
// Resultado: um dicionario rastreio -> venda, montado em background.
//
// ============================================================
// LICOES APRENDIDAS NA GOOD (nao mexer sem entender o porque):
//
// 1) O search EXIGE um filtro PRINCIPAL (status/type/stage). Com
//    players/range/sort sozinhos ele responde 400
//    "atLeastOneFilterProvided". Por isso duas passadas: opened
//    e closed.
//
// 2) Varrer so "opened" PERDE os pacotes que estao na mesa do
//    estoquista: o ML fecha o claim quando a entrega conclui, e o
//    pacote chega DEPOIS disso. Provado no galpao.
//
// 3) Falha transitoria num claim deixava a devolucao sem rastreio
//    no mapa SILENCIOSAMENTE. Por isso: 3 tentativas com pausa
//    crescente + uma segunda rodada sequencial so dos falhados.
//
// 4) 401/403 no /returns NAO e erro: o ML nega ao vendedor o
//    return de certos tipos de mediacao, por design. Tratado como
//    404 (normal). So 500/timeout conta como falha de verdade.
//
// 5) Uma devolucao que passa pelo CD do ML tem DOIS trechos
//    (cliente->CD e CD->galpao). Sem marcar o primeiro como
//    superado, ele ficava presa no painel como "em transito ha
//    118 dias" pra sempre.
// ============================================================

'use strict';

const cfg = require('../config-AMB');
const ml = require('./ml-AMB');

// b17 - detalhes do PEDIDO (apelido do comprador + itens) num
// cache proprio: buscados em BACKGROUND depois que o indice
// monta, 1 pedido por vez, e reaproveitados entre reconstrucoes
// (pedido nao muda de dono nem de itens).
const PEDIDOS = new Map();

// b28 - DATA REAL DE ENTREGA da devolucao (licao das v3.95/v4.13 da
// GOOD): o return NAO traz a data; ela vem de /shipments/{id}/history
// no campo date_history.date_delivered. Cache permanente (data de
// entrega nunca muda). Enquanto nao chega, o painel mostra "~" (estimado).
const ENTREGA_REAL = new Map();   // sid -> { v: dataISO|null, tent: n, http: status }
let ENTREGA_RODANDO = false;

/** Data real (ou null) já resolvida pra este envio. */
function entregaRealData(sid) {
  const e = sid ? ENTREGA_REAL.get(String(sid)) : null;
  return (e && e.v) || null;
}

function dispararDatasEntrega(itens) {
  if (ENTREGA_RODANDO) return;
  // b30 - null NAO e mais permanente: re-tenta ate 4 vezes (o /history
  // pode falhar num soluco e a data ficar presa como "estimada" pra
  // sempre — foi o que travou os ~ do painel em 01/08).
  const fila = [...new Set((itens || [])
    .map(d => d.shipment_devolucao ? String(d.shipment_devolucao) : null)
    .filter(Boolean))]
    .filter(sid => {
      const e = ENTREGA_REAL.get(sid);
      return !e || (!e.v && (e.tent || 0) < 4);
    }).slice(0, 60);
  if (!fila.length) return;
  ENTREGA_RODANDO = true;
  (async () => {
    for (const sid of fila) {
      const antes = ENTREGA_REAL.get(sid) || { tent: 0 };
      try {
        const rh = await ml.chamarML('/shipments/' + sid + '/history');
        ENTREGA_REAL.set(sid, {
          v: (rh.ok && rh.data && rh.data.date_history &&
              rh.data.date_history.date_delivered) || null,
          tent: (antes.tent || 0) + 1,
          http: rh.status || (rh.ok ? 200 : null),
        });
      } catch (e) {
        ENTREGA_REAL.set(sid, { v: null, tent: (antes.tent || 0) + 1, http: 'exc:' + e.message.slice(0, 40) });
      }
      await new Promise(r => setTimeout(r, 300));
    }
    const ok = [...ENTREGA_REAL.values()].filter(e => e.v).length;
    console.log('[AMB/ML-RETURNS] datas de entrega: ' + ok + ' reais / ' + ENTREGA_REAL.size + ' consultadas');
  })().catch(() => {}).finally(() => { ENTREGA_RODANDO = false; });
}
let ENRIQ_ERRO = null;

async function enriquecerPedido(orderId) {
  const k = String(orderId || '');
  if (!k || PEDIDOS.has(k)) return PEDIDOS.get(k) || null;
  try {
    const r = await ml.chamarML(`/orders/${k}`);
    if (!r.ok || !r.data) return null;
    const o = r.data;
    const info = {
      nickname: (o.buyer && o.buyer.nickname) || null,
      valor_venda: (o.total_amount != null ? o.total_amount : null),
      cliente_ml: [o.buyer && o.buyer.first_name, o.buyer && o.buyer.last_name]
        .filter(Boolean).join(' ').trim() || null,
      itens: (o.order_items || []).slice(0, 3).map(it => ({
        titulo: (it.item && it.item.title) || null,
        sku: (it.item && (it.item.seller_sku || it.item.seller_custom_field)) || null,
        qtd: it.quantity || 1,
      })),
      nf_ml_numero: null, nf_ml_serie: null, nf_ml_chave: null,
      pack_id: o.pack_id ? String(o.pack_id) : null,
    };

    // NF DA VENDA direto do ML (invoice_data do envio) - a fonte da
    // GOOD; nao depende de campo nenhum da lista do Bling.
    let shipId = o.shipping && o.shipping.id;
    // b30 - venda de carrinho pode vir sem shipping no pedido: o envio
    // mora no PACK. Sem shipId = sem invoice_data = card sem NF (caso
    // real da MALHEIROSAUDREY, 01/08).
    if (!shipId && o.pack_id) {
      try {
        const rP = await ml.chamarML('/packs/' + o.pack_id);
        const pk = rP.ok && rP.data;
        shipId = (pk && pk.shipment && pk.shipment.id)
          || (pk && Array.isArray(pk.shipments) && pk.shipments[0] && pk.shipments[0].id)
          || null;
      } catch (e) { /* segue sem */ }
    }
    info.ship_venda = shipId || null;
    if (shipId) {
      try {
        const rN = await ml.chamarML('/shipments/' + shipId + '/invoice_data?siteId=MLB');
        const ch = rN.ok && rN.data && rN.data.fiscal_key ? String(rN.data.fiscal_key) : null;
        if (ch && ch.length === 44) {
          info.nf_ml_chave = ch;
          info.nf_ml_numero = ch.slice(25, 34).replace(/^0+/, '');
          info.nf_ml_serie = ch.slice(22, 25).replace(/^0+/, '') || '1';
        }
        info.nf_http = rN.status || (rN.ok ? 200 : null);
        // fallback: alguns retornos trazem o numero sem a chave
        if (!info.nf_ml_numero && rN.ok && rN.data) {
          const inv = rN.data.invoice_number || rN.data.number || null;
          if (inv) {
            info.nf_ml_numero = String(inv).replace(/^0+/, '');
            info.nf_ml_serie = String(rN.data.invoice_series || rN.data.serie || '').replace(/^0+/, '') || null;
          }
        }
      } catch (e) { /* segue sem NF */ }
    }
    PEDIDOS.set(k, info);
    return info;
  } catch (e) { return null; }
}

async function enriquecerLista(pedidos) {
  for (const pid of pedidos) {
    if (PEDIDOS.has(String(pid))) continue;
    await enriquecerPedido(pid);
    await new Promise(r => setTimeout(r, 140));
  }
}

const IDX = {
  ts: 0, mapa: {}, totalClaims: 0, comTracking: 0,
  duracaoSeg: 0, erro: null, falhasReturns: 0, amostraFalhas: [],
};

let construindo = false;   // evita duas construcoes ao mesmo tempo

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const normTrack = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function meuUserId() {
  if (ml.userId()) return ml.userId();
  const eu = await ml.quemSouEu();
  return eu.ok ? String(eu.user_id) : null;
}

/** Extrai os trechos de devolucao de um claim e joga no mapa. */
function registrarShipments(mapa, c, dados) {
  const ships = (dados && dados.shipments) || (dados && dados.shipping ? [dados.shipping] : []);
  // Se existe trecho vindo pro galpao, o trecho do CD ja cumpriu o papel.
  const temTrechoPraNos = ships.some(x => x && x.destination && x.destination.name === 'seller_address');
  let contados = 0;

  for (const sh of ships) {
    const trk = normTrack(sh && sh.tracking_number);
    if (!trk) continue;
    const destino = (sh.destination && sh.destination.name) || null;
    mapa[trk] = {
      fonte: 'ml_return',
      claim_id: c.id,
      order_id: c.resource === 'order' ? String(c.resource_id) : null,
      resource: c.resource,
      resource_id: String(c.resource_id || ''),
      shipment_devolucao: sh.shipment_id || sh.id || null,
      status_devolucao: sh.status || null,
      tracking: trk,
      claim_date: c.date || null,
      destino,                                    // seller_address = vem pro galpao | warehouse = CD do ML
      superado: (destino === 'warehouse' && temTrechoPraNos),
      status_claim: c.status || null,
      stage_claim: c.stage || null,
      entregue_em: (sh.status === 'delivered') ? (dados.last_updated || null) : null,
      status_money: dados.status_money || null,
    };
    contados++;
  }
  return contados;
}

async function construirIndice(opts = {}) {
  if (construindo) return { ...IDX, jaEmAndamento: true };
  construindo = true;
  const t0 = Date.now();

  try {
    const maxPaginas = opts.maxPaginas || 30;
    const janelaDias = opts.janelaDias || cfg.ml.janelaDias;   // AMB: 60 dias
    const mapa = {};
    let comTracking = 0;
    let erroBusca = null;

    // ── 1) Coletar os claims (duas passadas: opened + closed) ──
    const claims = [];
    const vistos = new Set();
    const uid = await meuUserId();
    const desde = new Date(Date.now() - janelaDias * 864e5).toISOString().replace('Z', '-00:00');
    const extras = uid
      ? `&players.user_id=${uid}&players.role=respondent&range=date_created:after:${desde}&sort=date_created:desc`
      : '';

    for (const st of ['opened', 'closed']) {
      for (let pg = 0; pg < maxPaginas; pg++) {
        const r = await ml.chamarML(
          `/post-purchase/v1/claims/search?status=${st}${extras}&offset=${pg * 30}&limit=30`
        );
        if (!r.ok) {
          erroBusca = `claims/search(${st}) HTTP ${r.status}: ${JSON.stringify(r.error || '').slice(0, 120)}`;
          break;
        }
        const lista = (r.data && r.data.data) || [];
        if (lista.length === 0) break;
        for (const c of lista) {
          if (vistos.has(c.id)) continue;
          vistos.add(c.id);
          claims.push({
            id: c.id, resource: c.resource, resource_id: c.resource_id,
            status: c.status, stage: c.stage, date: c.date_created,
          });
        }
        if (lista.length < 30) break;
        await sleep(200);
      }
    }

    // ── 2) Puxar o return de cada claim ────────────────────────
    let falhasReturns = 0;
    const falhados = [];
    const amostraFalhas = [];

    async function puxarReturns(c, guardarFalha) {
      let rr = null;
      for (let tent = 0; tent < 3; tent++) {
        rr = await ml.chamarML(`/post-purchase/v2/claims/${c.id}/returns`);
        if (rr.ok || rr.status === 404) break;                 // 404 = claim sem return (normal)
        if (rr.status && rr.status !== 429 && rr.status >= 400 && rr.status < 500) break;
        await sleep(1000 + tent * 1500);
      }
      if (!rr.ok) {
        // 401/403 = o ML nega esse return por design. Nao e falha.
        if (rr.status !== 404 && rr.status !== 401 && rr.status !== 403) {
          if (guardarFalha) falhados.push(c);
          if (amostraFalhas.length < 6) {
            amostraFalhas.push({
              claim_id: c.id, status: rr.status || null,
              erro: JSON.stringify(rr.error || '').slice(0, 100),
            });
          }
        }
        return null;
      }
      return rr;
    }

    // Lotes de 3 com pausa: pressao baixa evita o rate limit em cascata.
    for (let i = 0; i < claims.length; i += 3) {
      const lote = claims.slice(i, i + 3);
      await Promise.all(lote.map(async (c) => {
        try {
          const rr = await puxarReturns(c, true);
          if (!rr) return;
          comTracking += registrarShipments(mapa, c, rr.data || {});
        } catch (e) { /* claim sem return: segue */ }
      }));
      await sleep(350);
    }

    // ── 3) Segunda rodada: so os falhados, com calma ───────────
    if (falhados.length > 0) {
      console.log(`[AMB/ML-RETURNS] 2a rodada: ${falhados.length} falhados - respirando 5s`);
      await sleep(5000);
      for (const c of falhados) {
        try {
          const rr = await puxarReturns(c, false);
          if (!rr) { falhasReturns++; continue; }
          comTracking += registrarShipments(mapa, c, rr.data || {});
        } catch (e) { falhasReturns++; }
        await sleep(450);
      }
    }

    // Se a busca falhou E nao veio nada, NAO marca como quente: assim o
    // proximo bipe tenta reconstruir em vez de confiar num indice vazio
    // por 30 minutos. Falha silenciosa e a pior especie.
    const falhouGeral = !!erroBusca && Object.keys(mapa).length === 0;
    IDX.ts = falhouGeral ? 0 : Date.now();
    IDX.mapa = mapa;
    IDX.totalClaims = claims.length;
    IDX.comTracking = comTracking;
    IDX.falhasReturns = falhasReturns;
    IDX.amostraFalhas = amostraFalhas;
    IDX.duracaoSeg = Math.round((Date.now() - t0) / 1000);
    IDX.erro = erroBusca;

    console.log(`[AMB/ML-RETURNS] indice: ${claims.length} claims, ${comTracking} com rastreio, em ${IDX.duracaoSeg}s`);

    // b22 - CONSERTO da 3a reclamacao do Diego: o gatilho antigo
    // usava uma variavel `dados` que NAO EXISTE neste escopo ->
    // ReferenceError silencioso todo boot -> apelido/itens/NF nunca
    // chegavam na tela. Agora a lista sai do PROPRIO indice, e
    // qualquer erro fica visivel em statusIndice().
    try {
      const paraEnriquecer = [...new Set(
        Object.values(mapa || {}).map(d => d && d.order_id).filter(Boolean)
          .map(String))].slice(0, 120);
      enriquecerLista(paraEnriquecer)
        .then(() => console.log('[AMB/ML-RETURNS] pedidos enriquecidos: ' + PEDIDOS.size))
        .catch(e => { ENRIQ_ERRO = e.message; });
    } catch (e) { ENRIQ_ERRO = e.message; console.error('[AMB/ML-RETURNS] gatilho:', e.message); }
    return IDX;
  } finally {
    construindo = false;
  }
}

function statusIndice() {
  return {
    pedidos_enriquecidos: PEDIDOS.size,
    datas_entrega_reais: [...ENTREGA_REAL.values()].filter(e => e.v).length,
    datas_entrega_nulas: [...ENTREGA_REAL.values()].filter(e => !e.v).length,
    datas_entrega_amostra: [...ENTREGA_REAL.entries()].slice(0, 3)
      .map(([sid, e]) => ({ sid, v: e.v, tent: e.tent, http: e.http })),
    enriquecimento_erro: ENRIQ_ERRO,
    quente: IDX.ts > 0,
    construindo,
    idade_min: IDX.ts ? Math.round((Date.now() - IDX.ts) / 60000) : null,
    janela_dias: cfg.ml.janelaDias,
    total_claims: IDX.totalClaims,
    com_tracking: IDX.comTracking,
    returns_com_falha_persistente: IDX.falhasReturns || 0,
    amostra_falhas: IDX.amostraFalhas || [],
    duracao_construcao_seg: IDX.duracaoSeg || null,
    erro: IDX.erro,
    exemplos: Object.keys(IDX.mapa).slice(0, 3),
  };
}

/** Acha a devolucao pelo codigo dos Correios. Reconstroi se estiver frio. */
async function acharPorTracking(codigo) {
  const trk = normTrack(codigo);
  if (!trk) return null;
  // Mesma regra do indice de nomes: so espera quando esta vazio.
  if (!IDX.ts) {
    try { await construirIndice(); } catch (e) { /* segue vazio */ }
  } else if ((Date.now() - IDX.ts) > 30 * 60000) {
    construirIndice().catch(e => console.error('[AMB/ML-RETURNS] atualizacao em background falhou:', e.message));
  }
  return IDX.mapa[trk] || null;
}

/** Classifica as devolucoes do indice — base do painel "a espreita". */
function resumoEspreita() {
  const dias = (iso) => iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null;
  const EM_TRANSITO = ['shipped', 'ready_to_ship', 'handling', 'pending'];
  // b29 - AUTOCURA: se o indice esta FRIO (build do boot falhou) e
  // ninguem esta construindo, a propria espreita dispara a
  // reconstrucao. Antes so o bipe religava — galpao parado = ML
  // sumido do painel pra sempre (foi o que o Diego viu em 01/08).
  if (!IDX.ts && !construindo) {
    construirIndice().catch(e => { IDX.erro = e.message; });
  }

  const emTransito = [], entreguesLista = [];
  let aguardando = 0, entregues = 0;

  for (const d of Object.values(IDX.mapa)) {
    if (d.superado) continue;                       // trecho ja cumprido
    const st = String(d.status_devolucao || '').toLowerCase();

    if (st === 'delivered') {
      entregues++;
      // 'delivered' no CD do ML NAO e chegada no galpao.
      if (d.destino === 'warehouse' && String(d.status_claim || '').toLowerCase() === 'closed') {
        continue;                                   // ML resolveu por dentro
      }
      if (d.destino === 'warehouse') {
        emTransito.push({
          marketplace: 'ml', pedido: d.order_id, tracking: d.tracking,
          status: 'em revisão no CD do ML', dias_em_transito: dias(d.claim_date),
          claim_id: d.claim_id, status_money: d.status_money || null, no_cd_ml: true, desde: d.claim_date || null,
        
        ...(PEDIDOS.get(String(d.order_id)) || {}),
      });
        continue;
      }
      const real = entregaRealData(d.shipment_devolucao);
      entreguesLista.push({
        marketplace: 'ml', pedido: d.order_id, tracking: d.tracking,
        dias_desde: real ? dias(real) : dias(d.entregue_em || d.claim_date),
        entregue_em: real || d.entregue_em || null,
        data_precisa: !!real,
        claim_id: d.claim_id, shipment_devolucao: d.shipment_devolucao || null,
      
        ...(PEDIDOS.get(String(d.order_id)) || {}),
      });
      continue;
    }

    if (st === 'label_generated') { aguardando++; continue; }

    if (EM_TRANSITO.includes(st)) {
      emTransito.push({
        marketplace: 'ml', pedido: d.order_id, tracking: d.tracking, status: st,
        dias_em_transito: dias(d.claim_date), claim_id: d.claim_id,
        status_money: d.status_money || null, no_cd_ml: d.destino === 'warehouse', desde: d.claim_date || null,
      
        ...(PEDIDOS.get(String(d.order_id)) || {}),
      });
    }
  }

  dispararDatasEntrega(entreguesLista);
  const emTransitoSano = emTransito.filter(d =>
    d.dias_em_transito == null || d.dias_em_transito <= 120);

  emTransitoSano.sort((x, y) => (y.dias_em_transito || 0) - (x.dias_em_transito || 0));
  entreguesLista.sort((x, y) => (x.dias_desde || 0) - (y.dias_desde || 0));

  return {
    quente: IDX.ts > 0,
    em_transito: emTransitoSano,
    atrasadas_30d: emTransito.filter(x => (x.dias_em_transito || 0) > 30).length,
    aguardando_postagem: aguardando,
    entregues_indice: entregues,
    entregues: entreguesLista,
  };
}

/**
 * Pre-aquecimento ATRASADO de proposito.
 * O servico sobe junto com o Devolucoes da GOOD, que ja monta os
 * indices dele no boot. Comecar junto seria dobrar o pico de
 * memoria e de chamadas a API no mesmo instante. 3 minutos de
 * atraso resolve sem custo nenhum — ninguem bipa caixa nos
 * primeiros minutos depois de um deploy.
 */
function preAquecer(atrasoMs) {
  const atraso = atrasoMs != null ? atrasoMs : 3 * 60 * 1000;
  console.log(`[AMB/ML-RETURNS] pre-aquecimento agendado para daqui a ${Math.round(atraso / 1000)}s`);
  setTimeout(() => {
    construirIndice().catch(e => console.error('[AMB/ML-RETURNS] pre-aquecimento falhou:', e.message));
  }, atraso).unref();
}

module.exports = {
  construirIndice, statusIndice, acharPorTracking, resumoEspreita, preAquecer,
  enriquecerLista,
  tamanho: () => Object.keys(IDX.mapa).length,
};
