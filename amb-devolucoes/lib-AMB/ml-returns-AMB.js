// ============================================================
// amb-devolucoes/lib-AMB/ml-returns-AMB.js     (AMB Devol. b51)
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

// b248 - FASE 3, passo 3 (ultimo antes do app): RECEBE a ficha.
//
// ⚠️ O ESTADO AQUI E DE CONTROLE, nao de credencial: `construindo`,
// `ENTREGA_RODANDO`, `NFV_RODANDO`, `ULTIMA_BUSCA`. Sao travas de "ja esta
// rodando" e caches de indice. Compartilhadas entre empresas, uma
// BLOQUEARIA a construcao do indice da outra — a segunda veria
// `construindo=true` e desistiria, ficando com indice vazio pra sempre.
//
// A fabrica move essas travas pra dentro de cada instancia.
// ⚠️ b377 - o `config-AMB` fixo SAIU. Ficou so o require, sem uso, depois
// que a instancia padrao foi removida — e require de arquivo da AMB num
// modulo multiempresa e pegadinha esperando alguem usar.
// b263.1 (Codex, P1) - ⚠️ A AMB TEM SCANNER PROPRIO, e eu tinha ligado a
// drenagem so na GOOD. Sao ate 60 paginas + 900 chamadas por claim: se o
// SIGTERM chega durante um preaquecimento da AMB, o processo velho continua
// a varredura INTEIRA e pode renovar a credencial de uso unico junto com o
// novo. Era a regra da casa que eu mesmo invoquei no commit e nao cumpri.
const drenagem = require('../../lib/drenagem');

// ⚠️ b377 - O CLIENTE VEM DA EMPRESA, nao a instancia padrao.
//
// Era `require('./ml-AMB')` sem `.criar()` — a instancia feita com o
// `config-AMB` fixo. A Girassol usaria o ml DA AMBTOTAL.
//

// ⚠️ b377 - o cliente DESTA empresa, quando a config traz um.
//
// Fica no escopo do modulo (logo apos o require) de proposito: minha 1a
// versao punha dentro da fabrica, ANTES da declaracao do `mlPadrao` —
// TDZ, que o `node --check` nao pega.
// ⚠️ b377 - SEM O CLIENTE DA EMPRESA, DERRUBA.
//
// Antes caia na instancia PADRAO do `ml-AMB` (feita com o `config-AMB`
// fixo) — a empresa nova usaria o cliente DA AMBTOTAL sem nada avisar.
//
// 📌 Fallback pro valor de outra empresa nao e compatibilidade, e vazamento
// com cara de seguranca. Ja tirei 3 iguais hoje.
function mlDa(cfg) {
  const c = cfg && cfg.clienteMl;
  if (!c) {
    throw new Error('[ml-returns-AMB.js] `clienteMl` nao veio na config da empresa — '
      + 'sem ele eu usaria o cliente da AMBTotal.');
  }
  return c;
}

function criarMlReturns(cfg) {
  // ⚠️ b396 - A ETIQUETA DO LOG DIZ QUAL EMPRESA.
  //
  // Era `[AMB/...]` fixo. O Render junta o log das duas no MESMO
  // lugar: com a Girassol montada, um erro dela apareceria como
  // `[AMB/...]` e mandaria caçar no app errado.
  const TAG_EMP = String((cfg && cfg.PREFIXO_ENV) || 'AMB_')
    .replace(/_$/, '');
  const ml = mlDa(cfg);   // b377

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
    console.log(`[${TAG_EMP}/ML-RETURNS] datas de entrega: ` + ok + ' reais / ' + ENTREGA_REAL.size + ' consultadas');
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
          info.nf_ml_serie = ch.slice(22, 25).replace(/^0+/, '') || null;   // b44 - serie real da chave, null se vazia
        }
        info.nf_http = rN.status || (rN.ok ? 200 : null);
        // fallback: alguns retornos trazem o numero sem a chave
        if (!info.nf_ml_numero && rN.ok && rN.data) {
          const inv = rN.data.invoice_number || rN.data.number || null;
          if (inv) {
            info.nf_ml_numero = String(inv).replace(/^0+/, '');
            info.nf_ml_serie = String(rN.data.invoice_series || rN.data.serie || '').replace(/^0+/, '') || null;   // b44
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

let construindo = false;
// ⚠️ b415 (Codex, P1) - "VAI TENTAR DE NOVO" e diferente de "parou".
//
// Quando a construcao falha (429, por exemplo), `construindo` vira false
// e SO DEPOIS o `catch` agenda a proxima tentativa. Nessa fresta a fila
// de pre-aquecimento achava que esta rotina tinha terminado e soltava a
// seguinte — e 30s depois as duas rodavam juntas.
//
// 📌 Justo no cenario que a fila existe pra evitar: o 429.
let reagendado = false;   // evita duas construcoes ao mesmo tempo

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
  // b266 - ⚠️ O CANCELAMENTO E ENCERRAMENTO NORMAL, NAO FALHA.
  //
  // Mesmo desenho da GOOD nf-nomes (b264): a varredura fica na funcao
  // interna, e o cancelamento e tratado AQUI, num lugar so. O `return`
  // impede que o resultado parcial seja publicado.
  //
  // ⚠️ Eu criei `pontoDeCancelamento()` no b264 e nao usei em lugar
  // nenhum — mesmo erro do `estaDrenando()` antes dele. Peca criada e
  // nao ligada passa despercebida porque o teste do modulo passa.
  try {
    return await construirIndiceInterno(opts);
  } catch (e) {
    if (drenagem.ehCancelamento(e)) {
      console.log(`[ML-RETURNS-AMB] ${e.message} — indice NAO publicado`);
      return;
    }
    throw e;
  }
}

async function construirIndiceInterno(opts = {}) {
  if (construindo) return { ...IDX, jaEmAndamento: true };
  construindo = true;
  const t0 = Date.now();

  try {
    const maxPaginas = opts.maxPaginas || 30;
    // b139 - JANELA IGUAL A DA GOOD: 120 dias.
    // A AMB varria 60 e a GOOD 120, com um comentario la dizendo o motivo:
    // a devolucao fica MESES na pilha antes de alguem bipar. Uma etiqueta
    // de uma venda de julho batia justamente nessa borda.
    const janelaDias = opts.janelaDias || Math.max(Number(cfg.ml.janelaDias) || 0, 120);
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
        drenagem.pontoDeCancelamento(true, 'ml-returns-amb');

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
      // b263.1: a fase 2 tambem — sem isto, uma pagina coletada vira ~30
      // chamadas depois da drenagem comecar (ate 900 no total da AMB)
      drenagem.pontoDeCancelamento(true, 'ml-returns-amb');

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
      console.log(`[${TAG_EMP}/ML-RETURNS] 2a rodada: ${falhados.length} falhados - respirando 5s`);
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

    console.log(`[${TAG_EMP}/ML-RETURNS] indice: ${claims.length} claims, ${comTracking} com rastreio, em ${IDX.duracaoSeg}s`);

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
        .then(() => console.log(`[${TAG_EMP}/ML-RETURNS] pedidos enriquecidos: ` + PEDIDOS.size))
        .catch(e => { ENRIQ_ERRO = e.message; });
    } catch (e) { ENRIQ_ERRO = e.message; console.error(`[${TAG_EMP}/ML-RETURNS] gatilho:`, e.message); }
    return IDX;
  } finally {
    construindo = false;
  }
}

function statusIndice() {
  return {
    // b415: a fila do pre-aquecimento precisa saber se ainda VEM mais
    ocupado: construindo || reagendado,
    construindo,
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
    construirIndice().catch(e => console.error(`[${TAG_EMP}/ML-RETURNS] atualizacao em background falhou:`, e.message));
  }
  const achado = IDX.mapa[trk] || null;
  // b139 - quando NAO acha, deixa o porque a mao de quem chamou: sem isso
  // o "404" nao distingue "o indice esta vazio" de "o rastreio nao esta la"
  if (!achado) {
    ULTIMA_BUSCA = {
      tracking: trk,
      no_indice: Object.keys(IDX.mapa).length,
      indice_em: IDX.ts ? new Date(IDX.ts).toISOString() : null,
      erro_indice: IDX.erro || null,
      exemplos: Object.keys(IDX.mapa).slice(0, 5),
    };
  }
  return achado;
}

/** b139 - o diagnostico da ultima busca por rastreio que falhou. */
let ULTIMA_BUSCA = null;
function ultimaBuscaTracking() { return ULTIMA_BUSCA; }

/** Classifica as devolucoes do indice — base do painel "a espreita". */
/* b503 - VEM PELO RETIRO (caso Marcos Vieira Lima, 02/10). A regra v4.18 dizia: "chegou no CD do ML e a
   reclamacao ja fechou = o ML resolveu por dentro, nao vem pra ca" — e o card SUMIA da fila. Errado quando o
   CD revisa e manda o produto pro VENDEDOR (revisao: product_destination 'seller', ex.: inservivel por
   embalagem danificada): ele VEM, pela retirada do Full. Agora a espreita consulta a revisao do CD
   (claims/{id}/returns -> returns/{id}/reviews), guarda o resultado e: 'seller' = fica na fila como
   "vem pelo RETIRO"; ainda nao consultou ou deu erro = fica ("nao sei" != "nao vem"); revisao sem destino
   'seller' = sai, como antes. So reclamacoes dos ultimos 90 dias; uma consulta por vez, com pausa. */
const REVISAO_CD = new Map();   // claim_id -> { destino, condicao, motivo, erro, em }
const REVISAO_FILA = new Set();
let REVISAO_RODANDO = false;
async function processarRevisoesCD() {
  if (REVISAO_RODANDO) return;
  REVISAO_RODANDO = true;
  try {
    while (REVISAO_FILA.size) {
      const id = REVISAO_FILA.values().next().value;
      REVISAO_FILA.delete(id);
      try {
        const rr = await ((p) => ml.chamarML(p))('/post-purchase/v2/claims/' + id + '/returns');
        const retId = rr && rr.ok && rr.data && rr.data.id;
        if (!retId) { REVISAO_CD.set(id, { erro: true, em: Date.now() }); continue; }
        const rv = await ((p) => ml.chamarML(p))('/post-purchase/v1/returns/' + retId + '/reviews');
        if (!rv || !rv.ok) { REVISAO_CD.set(id, { erro: true, em: Date.now() }); continue; }
        const rev = Array.isArray(rv.data && rv.data.reviews) ? rv.data.reviews[0] : null;
        const r0 = rev && Array.isArray(rev.resource_reviews) ? rev.resource_reviews[0] : null;
        const reg = { destino: (r0 && r0.product_destination) || null, condicao: (r0 && r0.product_condition) || null, motivo: (r0 && r0.reason_id) || null, em: Date.now() };
        /* b505 - linha do tempo do RETIRO (pedido do dono, 02/10): quando a peca vai pro vendedor, le no estoque do
           Full do anuncio quando a retirada foi reservada e quando a peca saiu do CD (provado no caso Marcos:
           WITHDRAWAL_RESERVATION 17/09, WITHDRAWAL_DELIVERY 23/09). So operacoes DEPOIS da abertura desta
           devolucao (o mesmo anuncio pode ter outras retiradas). A cota dessa rota do ML e baixissima: uma vez
           por dia por card (o registro vale 24 h) e falha = sem linha do tempo, o card continua no retiro. */
        if (reg.destino === 'seller') {
          try {
            const ped = rr.data && Array.isArray(rr.data.orders) ? rr.data.orders[0] : null;
            const it = ped && ped.item_id ? await ((p) => ml.chamarML(p))('/items/' + ped.item_id + '?attributes=inventory_id,seller_id') : null;
            const inv = it && it.ok && it.data && it.data.inventory_id;
            const sel = it && it.ok && it.data && it.data.seller_id;
            const de = String((rr.data && rr.data.date_created) || '').slice(0, 10);
            if (inv && sel && /^\d{4}-\d{2}-\d{2}$/.test(de)) {
              const ate = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
              const op = await ((p) => ml.chamarML(p))('/stock/fulfillment/operations/search?seller_id=' + sel + '&inventory_id=' + inv + '&date_from=' + de + '&date_to=' + ate);
              const ops = (op && op.ok && op.data && Array.isArray(op.data.results)) ? op.data.results : [];
              const quando = (t) => { const o = ops.filter((x) => String(x.type || '').toUpperCase() === t).sort((a, b) => String(b.date_created || '').localeCompare(String(a.date_created || '')))[0]; return o ? o.date_created : null; };
              reg.reservada_em = quando('WITHDRAWAL_RESERVATION');
              reg.saiu_cd_em = quando('WITHDRAWAL_DELIVERY');
            }
          } catch (e) { /* linha do tempo e extra */ }
        }
        REVISAO_CD.set(id, reg);
      } catch (e) { REVISAO_CD.set(id, { erro: true, em: Date.now() }); }
      await new Promise((ok) => setTimeout(ok, 700));
    }
  } finally { REVISAO_RODANDO = false; }
}
function revisaoCD(claimId) {
  const id = String(claimId || ''); if (!id) return null;
  const r = REVISAO_CD.get(id);
  const valida = r && (Date.now() - r.em) < (r.erro ? 30 * 60e3 : 24 * 3600e3);
  if (!valida && !REVISAO_FILA.has(id)) { REVISAO_FILA.add(id); setTimeout(processarRevisoesCD, 0); }
  return r || null;
}
function segueVindoPeloRetiro(d) {
  if (!d || !d.claim_id) return false;
  const t = new Date(d.claim_date || 0).getTime();
  if (!t || (Date.now() - t) > 90 * 864e5) return false;     // antigo: regra de antes
  const r = revisaoCD(d.claim_id);
  return !r || !!r.erro || r.destino === 'seller';
}
function statusCD(d, padrao) {
  if (String(d.status_claim || '').toLowerCase() !== 'closed') return padrao;
  const r = REVISAO_CD.get(String(d.claim_id || ''));
  if (r && r.destino === 'seller') return '🔁 vem pelo RETIRO — ML: ' + (r.condicao === 'unsaleable' ? 'inservível' : (r.condicao || 'revisado')) + (r.motivo === 'damaged' ? ' (embalagem danificada)' : '') +
      (r.saiu_cd_em ? ' · saiu do CD em ' + String(r.saiu_cd_em).slice(8, 10) + '/' + String(r.saiu_cd_em).slice(5, 7) + ' — a caminho do galpão' : (r.reservada_em ? ' · retirada reservada em ' + String(r.reservada_em).slice(8, 10) + '/' + String(r.reservada_em).slice(5, 7) : ''));
  return 'no CD do ML — conferindo a revisão';
}

function resumoEspreita() {
  const dias = (iso) => iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null;
  const EM_TRANSITO = ['shipped', 'ready_to_ship', 'handling', 'pending'];
  // b29 - AUTOCURA: se o indice esta FRIO (build do boot falhou) e
  // ninguem esta construindo, a propria espreita dispara a
  // reconstrucao. Antes so o bipe religava — galpao parado = ML
  // sumido do painel pra sempre (foi o que o Diego viu em 01/08).
  // b586 - o indice do ML tambem se atualiza pelo relogio da espreita (a cada 3 min, ela passa aqui): se tem mais de
  // 30 min, remonta em segundo plano. Antes so o BIPE religava um indice velho — com o galpao horas sem bipar ML, o
  // indice da Girassol chegou a 321 min, e o primeiro bipe usava o velho (devolucao nova = 'nao encontrado').
  // A GOOD tem relogio de 25 min (server.js). Sem indice nenhum, monta, como antes.
  if (!construindo && (!IDX.ts || (Date.now() - IDX.ts) > 30 * 60000)) {
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
      if (d.destino === 'warehouse' && String(d.status_claim || '').toLowerCase() === 'closed' && !segueVindoPeloRetiro(d)) {
        continue;                                   // ML resolveu por dentro
      }
      if (d.destino === 'warehouse') {
        emTransito.push({
          marketplace: 'ml', pedido: d.order_id, tracking: d.tracking,
          status: statusCD(d, 'em revisão no CD do ML'), vem_pelo_retiro: (REVISAO_CD.get(String(d.claim_id || '')) || {}).destino === 'seller', dias_em_transito: dias(d.claim_date),
          claim_id: d.claim_id, status_money: d.status_money || null, no_cd_ml: true,
          chegou_cd: true,                          // b51 - ENTREGUE no CD (constatado pelo ML)
          desde: d.claim_date || null,
        
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
        // b511 (unificacao, UNIAO): a copia antiga da GOOD entregava o dinheiro da devolucao nas ENTREGUES — o card
        // de alerta da GOOD calcula 'dinheiro' daqui. Sem isto, a GOOD perdia a info ao usar esta fabrica (#420).
        status_money: d.status_money || null,
      
        ...(PEDIDOS.get(String(d.order_id)) || {}),
      });
      continue;
    }

    if (st === 'label_generated') { aguardando++; continue; }

    if (EM_TRANSITO.includes(st)) {
      emTransito.push({
        marketplace: 'ml', pedido: d.order_id, tracking: d.tracking, status: st,
        dias_em_transito: dias(d.claim_date), claim_id: d.claim_id,
        status_money: d.status_money || null, no_cd_ml: d.destino === 'warehouse',
        chegou_cd: false,                           // b51 - destino e o CD, mas AINDA NAO chegou la
        desde: d.claim_date || null,
      
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
// b272 - ⚠️ MESMO BUG DA b271 AQUI: o parametro e o ATRASO em ms, e meu
// retry chamava `preAquecer(tentativa + 1)` — passaria 2ms como atraso, e
// `tentativa` nem existia no escopo (ReferenceError na 1a falha).
// Porte cego da assinatura da GOOD. Regra 4.12.
function preAquecer(atrasoMs, tentativa = 1) {
  const atraso = atrasoMs != null ? atrasoMs : 3 * 60 * 1000;
  console.log(`[${TAG_EMP}/ML-RETURNS] pre-aquecimento agendado para daqui a ${Math.round(atraso / 1000)}s`);
  reagendado = true;   // b415: a fila do pre-aquecimento espera isto
  setTimeout(() => tentar(1), atraso).unref();
}

// ⚠️ (Codex, PR #213) `preAquecer(atrasoMs)` NAO tem parametro `tentativa`
// — o retry abaixo referenciava uma variavel inexistente, e o
// ReferenceError estourava DENTRO do `.catch()`, virando rejeicao nao
// tratada (podia derrubar o processo). `atrasoMs` e o atraso do PRIMEIRO
// disparo; o contador de tentativas e outra coisa e mora aqui, separado.
function tentar(tentativa) {
  reagendado = false;   // b415
  construirIndice().then((idx) => {
    if (!idx) return; // cancelado pela drenagem - nem sucesso nem falha
    if (idx.erro) throw new Error(idx.erro);
  }).catch((e) => {
    // b271 - ⚠️ FALHOU, TENTA DE NOVO (a AMB tambem — regra da casa).
    // Um 429 no boot deixava o cache vazio por 25 min.
    console.error(`[${TAG_EMP}/ML-RETURNS] pre-aquecimento falhou (tentativa ${tentativa}/3):`, e.message);
    if (tentativa >= 3) return;
    const espera = 30000 * Math.pow(2, tentativa - 1);
    console.log(`[${TAG_EMP}/ML-RETURNS] tento de novo em ${espera / 1000}s`);
    // ⚠️ (Codex) setTimeout cru nao e cancelado pela drenagem — registra
    // com daquiA pra nao acordar o processo VELHO durante um deploy.
    // ⚠️ b416 (Codex, P1) - AQUI e a retentativa de verdade.
    //
    // No b415 eu marquei `reagendado` no `preAquecer` — o disparo
    // INICIAL — e achei que tinha coberto. A retentativa usa
    // `drenagem.daquiA`, nao `setTimeout`, entao minha busca nao achou e
    // a fresta continuou aberta: `construindo` cai, o catch chega aqui, e
    // nesse meio a fila soltava o proximo.
    //
    // 📌 Consertei o sintoma no lugar errado e o teste passou, porque ele
    // so conferia se o texto `reagendado = true` existia no arquivo.
    reagendado = true;
    drenagem.daquiA(() => tentar(tentativa + 1), espera);
  });
}

return {
  construirIndice, statusIndice, acharPorTracking, ultimaBuscaTracking, resumoEspreita, preAquecer,
  enriquecerLista,
  tamanho: () => Object.keys(IDX.mapa).length,
};
}

// b248: export padrao = objeto pronto da AMB; fabrica em `.criar`.
// ⚠️ b377 - A INSTANCIA PADRAO SAIU.
//
// Era `module.exports = criarMlReturns(configAMB)` — criada NO REQUIRE, com o
// `config-AMB` fixo. Duas coisas erradas:
//
//   1. carregava o arquivo da AMB em todo boot, mesmo sem ninguem usar
//   2. e agora que o modulo EXIGE o cliente da empresa, ela quebrava o boot:
//      o `configAMB` nao tem `clienteMl`
//
// 📌 Ninguem mais a consome — o app usa `.criar(CFG_EMPRESA)`. Exporto so a
// fabrica, como nos outros 8 modulos.
module.exports = { criar: criarMlReturns };
