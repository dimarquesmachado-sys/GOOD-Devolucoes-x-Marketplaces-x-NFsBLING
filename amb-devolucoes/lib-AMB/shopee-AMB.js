// ============================================================
// amb-devolucoes/lib-AMB/shopee-AMB.js         (AMB Devol. b37)
// ------------------------------------------------------------
// Devolucoes da SHOPEE via o proxy interno do shopee-nf-sync —
// la vivem os tokens saudaveis das lojas; aqui so consultamos.
// Porta fiel do lib/shopee-proxy.js da GOOD, trocando a loja.
//
// A AMB usa as MESMAS SHOPEE_PROXY_URL e SHOPEE_PROXY_KEY da
// GOOD (mesmo servico do Render, vars sem prefixo) e muda so a
// LOJA no caminho: /amb/interno/devolucoes. Se o shopee-nf-sync
// nao tiver a loja 'amb' cadastrada, a rota de diagnostico
// /amb/shopee/teste mostra o erro exato.
// ============================================================

'use strict';

const URL_PROXY = (process.env.SHOPEE_PROXY_URL || '').replace(/\/+$/, '');
const KEY_PROXY = process.env.SHOPEE_PROXY_KEY || '';
const LOJA = process.env.AMB_SHOPEE_LOJA || 'amb';

const cfg = {
  url: URL_PROXY, loja: LOJA,
  get ativo() { return !!(URL_PROXY && KEY_PROXY); },
};

let cache = { ts: 0, dados: [] };

async function buscarDevolucoesProxy(forcar) {
  if (!cfg.ativo) return null;                     // integracao desligada
  const idade = Date.now() - cache.ts;
  if (!forcar && cache.ts > 0 && idade < 5 * 60 * 1000) return cache.dados;

  const url = `${URL_PROXY}/${LOJA}/interno/devolucoes${forcar ? '?refresh=1' : ''}`;
  const r = await fetch(url, { headers: { 'x-internal-key': KEY_PROXY } });
  const d = await r.json().catch(() => null);
  if (!d || !d.ok) {
    throw new Error(`proxy shopee (loja ${LOJA}): ` + (d && d.erro ? d.erro : 'HTTP ' + r.status));
  }
  cache = { ts: Date.now(), dados: d.devolucoes || [] };
  return cache.dados;
}

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Acha a devolucao Shopee pelo que o estoquista bipar: tracking
 * SPX (BR...), return_sn ou order_sn. Mesmas 3 comparacoes da
 * GOOD: normalizado, so-digitos e token BR embutido.
 */
async function acharDevolucao(codigo) {
  const vazio = { hit: null, qtd: -1, usouRefresh: false };
  const alvo = norm(codigo);
  if (!alvo || alvo.length < 6) return vazio;
  const alvoDig = String(codigo).replace(/\D/g, '');
  const mTok = String(codigo).toUpperCase().match(/BR[A-Z0-9]{9,}/);
  const alvoTok = mTok ? mTok[0] : null;

  let lista = await buscarDevolucoesProxy(false);
  if (lista === null) return vazio;

  const casa = (d) => [d.tracking_number, d.return_sn, d.order_sn].some(v => {
    if (!v) return false;
    const n = norm(v);
    if (n === alvo) return true;
    if (alvoDig.length >= 8 && String(v).replace(/\D/g, '') === alvoDig) return true;
    if (alvoTok && n.includes(alvoTok)) return true;
    return false;
  });

  let hit = lista.find(casa) || null;
  let usouRefresh = false;

  // Nao achou na cache: forca uma leitura fresca antes de desistir —
  // a devolucao pode ter nascido nos ultimos minutos.
  if (!hit) {
    try {
      lista = await buscarDevolucoesProxy(true);
      usouRefresh = true;
      hit = lista.find(casa) || null;
    } catch (e) { /* fica com a cache */ }
  }
  return { hit, qtd: (lista || []).length, usouRefresh };
}

/** Classifica a lista pra o painel "a espreita". */
async function resumoEspreita() {
  let lista = null;
  try { lista = await buscarDevolucoesProxy(false); }
  catch (e) { return { quente: false, erro: e.message, em_transito: [] }; }
  if (lista === null) return { quente: false, desligada: true, em_transito: [] };

  const dias = (v) => {
    if (!v) return null;
    const ms = /^\d{10}$/.test(String(v)) ? Number(v) * 1000 : Date.parse(v);
    return isFinite(ms) ? Math.floor((Date.now() - ms) / 864e5) : null;
  };
  // Status que significam "acabou" — lista construida na GOOD com
  // dados reais (o ACCEPTED sozinho NAO e final).
  const FIM = /DONE|CLOSED|CANCELLED|REFUND_PAID|SELLER_COMPENSAT/i;

  const emTransito = [], entregues = [];
  let encerradas = 0;
  for (const d of lista) {
    const st = String(d.status || '');
    const lst = String(d.logistics_status || d.logistic_status || '');
    // b37 - DELIVERY_DONE = devolução ENTREGUE. Antes isso era
    // descartado como "encerrada" (mesma falha herdada da GOOD) —
    // mas entregue SEM bipe é exatamente o alerta do bloco vermelho.
    const entregouLst = /DELIVERY_DONE/i.test(lst);
    if (!entregouLst && FIM.test(st)) { encerradas++; continue; }
    // b17 - o proxy ja entrega motivo e itens; traduzimos o motivo
    // pra linguagem de galpao e passamos os itens adiante.
    const MOTIVO = { CHANGE_MIND: 'arrependimento', NOT_RECEIPT: 'não recebeu',
      DAMAGED: 'chegou danificado', DEFECTIVE: 'defeito', WRONG_ITEM: 'item errado',
      MISSING_PART: 'incompleto' };
    const card = {
      marketplace: 'shopee',
      pedido: d.order_sn || null,
      tracking: d.tracking_number || d.return_sn || null,
      return_sn: d.return_sn || null,
      status: [st, lst].filter(Boolean).join(' / ') || null,
      dias_em_transito: dias(d.create_time || d.data || d.created_at),
      desde: (() => {
        const t = d.create_time || d.data || d.created_at;
        if (!t) return null;
        const n = Number(t);
        const dt = new Date(Number.isFinite(n) && n > 1e9 && n < 1e12 ? n * 1000 : t);
        return isNaN(dt) ? null : dt.toISOString();
      })(),
      motivo_curto: MOTIVO[String(d.reason || '').toUpperCase()] || d.reason || null,
      itens: (d.itens || []).slice(0, 3).map(i => ({ titulo: i.nome || null, sku: i.sku || null, qtd: i.qtd || 1 })),
    };
    if (entregouLst) {
      // dias desde a ABERTURA com "~" (estimado) — a data exata de
      // entrega vem na fase 2 (rota do portal via Mover-Pedidos)
      entregues.push({ ...card, dias_desde: card.dias_em_transito,
        data_precisa: false, entregue_em: null });
    } else {
      emTransito.push(card);
    }
  }
  entregues.sort((x, y) => (x.dias_desde ?? 9999) - (y.dias_desde ?? 9999));
  emTransito.sort((x, y) => (y.dias_em_transito || 0) - (x.dias_em_transito || 0));
  return { quente: true, em_transito: emTransito.slice(0, 60),
    entregues: entregues.slice(0, 60), encerradas_indice: encerradas };
}

function preAquecer() {
  if (!cfg.ativo) {
    console.log('[AMB/SHOPEE] desligada - falta SHOPEE_PROXY_URL/KEY no servico');
    return;
  }
  // 90s depois do boot (a GOOD usa 30s; aqui atrasamos pra nao
  // somar com o pre-aquecimento dela no mesmo instante) e depois
  // renova a cada 8 minutos.
  setTimeout(() => {
    buscarDevolucoesProxy(false)
      .then(l => console.log(`[AMB/SHOPEE] cache pre-aquecida: ${(l || []).length} devolucoes (loja ${LOJA})`))
      .catch(e => console.warn('[AMB/SHOPEE] pre-aquecimento falhou:', e.message));
  }, 90 * 1000).unref();
  setInterval(() => {
    buscarDevolucoesProxy(false).catch(() => { /* proxima rodada tenta */ });
  }, 8 * 60 * 1000).unref();
}

module.exports = { cfg, buscarDevolucoesProxy, acharDevolucao, resumoEspreita, preAquecer, norm };
