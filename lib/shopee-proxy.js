// ============================================================
// lib/shopee-proxy.js (v3.41)
// ------------------------------------------------------------
// Devolucoes Shopee via proxy interno do shopee-nf-sync (la vivem
// os tokens saudaveis da loja; aqui so consultamos). Extraido do
// server.js LITERAL para enxugar - logica identica a producao.
//
// Uso no server.js:
//   const shopee = require('./lib/shopee-proxy');
//   shopee.iniciarPreAquecimento();
//   const info = await shopee.acharDevolucao(codigo);
//   if (shopee.cfg.ativo) { ... }
// ============================================================

const SHOPEE_PROXY_URL = (process.env.SHOPEE_PROXY_URL || '').replace(/\/+$/, '');
const SHOPEE_PROXY_KEY = process.env.SHOPEE_PROXY_KEY || '';
const SHOPEE_LOJA_KEY = process.env.SHOPEE_LOJA_KEY || 'good';

// config exposta pro server (diagnosticos, banner de boot, rota debug)
const cfg = {
  url: SHOPEE_PROXY_URL,
  key: SHOPEE_PROXY_KEY,
  loja: SHOPEE_LOJA_KEY,
  get ativo() { return !!(SHOPEE_PROXY_URL && SHOPEE_PROXY_KEY); },
};

let _shopeeDevCache = { ts: 0, dados: [] };

async function buscarDevolucoesProxy(forcar) {
  if (!SHOPEE_PROXY_URL || !SHOPEE_PROXY_KEY) return null; // integracao desligada
  const idade = Date.now() - _shopeeDevCache.ts;
  if (!forcar && _shopeeDevCache.ts > 0 && idade < 5 * 60 * 1000) {
    return _shopeeDevCache.dados;
  }
  const url = `${SHOPEE_PROXY_URL}/${SHOPEE_LOJA_KEY}/interno/devolucoes${forcar ? '?refresh=1' : ''}`;
  const r = await fetch(url, { headers: { 'x-internal-key': SHOPEE_PROXY_KEY } });
  const d = await r.json().catch(() => null);
  if (!d || !d.ok) {
    throw new Error('proxy shopee: ' + (d && d.erro ? d.erro : 'HTTP ' + r.status));
  }
  _shopeeDevCache = { ts: Date.now(), dados: d.devolucoes || [] };
  return _shopeeDevCache.dados;
}

const normShopee = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function acharDevolucao(codigo) {
  // v3.34.3: retorna diagnostico junto -> { hit, qtd, exemplo, usouRefresh }
  // qtd = -1 significa integracao sem as variaveis (proxy desligado)
  const vazio = { hit: null, qtd: -1, exemplo: null, usouRefresh: false };
  const alvo = normShopee(codigo);
  if (!alvo || alvo.length < 6) return vazio;
  const alvoDig = String(codigo).replace(/\D/g, '');
  const mTok = String(codigo).toUpperCase().match(/BR[A-Z0-9]{9,}/);
  const alvoTok = mTok ? mTok[0] : null;
  let usouRefresh = false;
  let lista = await buscarDevolucoesProxy(false);
  if (lista === null) return vazio;
  const casa = (d) => [d.tracking_number, d.return_sn, d.order_sn].some(v => {
    if (!v) return false;
    const nv = normShopee(v);
    if (nv === alvo) return true;
    if (alvoTok && nv === alvoTok) return true; // token SPX dentro de URL/QR
    // leitor/camera que comeu as letras: compara so os digitos (>=10 evita
    // colidir com order_sn, que tem poucos digitos)
    const dv = String(v).replace(/\D/g, '');
    return alvoDig.length >= 10 && dv.length >= 10 && dv === alvoDig;
  });
  let hit = lista.find(casa);

  // v3.48 - REORDENACAO ANTI-LENTIDAO: um token BR... que nao casou na
  // lista pode ser INSUCESSO (nunca esteve na lista de returns). Antes de
  // gastar 30-40s num refresh que revarre 120 dias de returns (e que nunca
  // vai achar um insucesso), tenta PRIMEIRO o indice tracking->pedido
  // (quente, ~2s). Isso e o que resolve o bipe do BR de insucesso rapido.
  if (!hit && alvoTok) {
    try {
      const urlT = `${SHOPEE_PROXY_URL}/${SHOPEE_LOJA_KEY}/interno/devolucoes?tracking=${encodeURIComponent(alvoTok)}`;
      const rT = await fetch(urlT, { headers: { 'x-internal-key': SHOPEE_PROXY_KEY } });
      const dT = await rT.json().catch(() => null);
      if (dT && dT.ok && dT.encontrado && dT.devolucao) {
        hit = dT.devolucao;
        hit.via_tracking_pedido = true;
        console.log(`[SHOPEE] ${alvoTok}: achou via INDICE tracking->pedido (insucesso) - rapido, sem refresh`);
      }
    } catch (e) { /* segue pros outros fallbacks */ }
  }

  if (!hit) {
    // Re-busca (fura o cache) SO quando o codigo tem cara de Shopee:
    // token BR..., order_sn (6 dig + alfanum), return_sn (8 dig + alfanum)
    // ou tracking so-digitos (>=12). Lixo obvio nao dispara varredura dupla.
    // (v3.48: se o indice tracking ja achou acima, este bloco e pulado.)
    const pareceShopee = !!alvoTok
      || /^\d{6}[A-Z0-9]{7,10}$/.test(alvo)
      || /^\d{8}[A-Z0-9]{6,9}$/.test(alvo)
      || (alvoDig.length >= 12 && alvo === alvoDig);
    if (pareceShopee) {
      usouRefresh = true;
      lista = await buscarDevolucoesProxy(true);
      hit = lista.find(casa);
    }
  }

  // v3.46 - FALLBACK "SPX Insucesso": entrega falha -> a Shopee CANCELA o
  // pedido e reembolsa SEM criar return (nao aparece em get_return_list).
  // Se o codigo tem cara de order_sn e nao casou nas devolucoes, consulta
  // o PEDIDO no proxy: cancelado = retorno legitimo, tratamos igual.
  if (!hit && /^\d{6}[A-Z0-9]{7,10}$/.test(alvo)) {
    try {
      const urlP = `${SHOPEE_PROXY_URL}/${SHOPEE_LOJA_KEY}/interno/devolucoes?pedido=${encodeURIComponent(alvo)}`;
      const rP = await fetch(urlP, { headers: { 'x-internal-key': SHOPEE_PROXY_KEY } });
      const dP = await rP.json().catch(() => null);
      if (dP && dP.ok && dP.encontrado && dP.devolucao) {
        hit = dP.devolucao; // mesmo formato da lista (order_sn, itens, ...)
        hit.via_pedido_cancelado = true;
        console.log(`[SHOPEE] ${alvo}: achou via PEDIDO CANCELADO (insucesso de entrega)`);
      }
    } catch (e) { /* fallback silencioso */ }
  }

  // v3.48 - (o fallback por tracking foi movido pra ANTES do refresh, no
  // topo desta funcao, pra resolver o insucesso rapido sem os 30-40s.)

  const exemplo = lista[0]
    ? (lista[0].tracking_number || lista[0].return_sn || lista[0].order_sn)
    : null;
  return { hit: hit || null, qtd: lista.length, exemplo, usouRefresh };
}

// v3.39.1 - PRE-AQUECIMENTO: mantem a cache Shopee quente em background.
// A varredura de 120 dias (~30-40s quando fria) passa a rodar AQUI, de
// tempos em tempos - a busca do estoquista sempre encontra cache quente
// e responde em ~1s. Silencioso e a prova de falha.
// v3.77 - A ESPREITA SHOPEE: classifica a lista do proxy pelos campos que
// vierem (defensivo - o proxy repassa a return_list oficial). Em transito =
// ainda nao entregue/encerrada; datas em epoch (create_time) ou ISO.
async function resumoEspreita() {
  let lista = null;
  try { lista = await buscarDevolucoesProxy(false); } catch (e) { return { quente: false, erro: e.message, em_transito: [] }; }
  if (lista === null) return { quente: false, em_transito: [] }; // integracao desligada
  const dias = (v) => {
    if (!v) return null;
    const ms = /^\d{10}$/.test(String(v)) ? Number(v) * 1000 : Date.parse(v);
    return isFinite(ms) ? Math.floor((Date.now() - ms) / 864e5) : null;
  };
  const FIM = /DONE|CLOSED|CANCELLED|REFUND_PAID|SELLER_COMPENSAT/i;
  const emTransito = [];
  let encerradas = 0;
  for (const d of lista) {
    const st = String(d.status || '');
    const lst = String(d.logistics_status || '');
    if (FIM.test(st) || /DELIVERY_DONE/i.test(lst)) { encerradas++; continue; }
    emTransito.push({
      marketplace: 'shopee',
      pedido: d.order_sn || null,
      tracking: d.tracking_number || d.return_sn || null,
      status: [st, lst].filter(Boolean).join(' / ') || null,
      dias_em_transito: dias(d.create_time || d.data || d.created_at),
    });
  }
  emTransito.sort((x, y) => (y.dias_em_transito || 0) - (x.dias_em_transito || 0));
  return { quente: true, em_transito: emTransito.slice(0, 40), encerradas_indice: encerradas };
}

function iniciarPreAquecimento() {
  if (!SHOPEE_PROXY_URL || !SHOPEE_PROXY_KEY) return;
  setTimeout(() => {
    buscarDevolucoesProxy(false)
      .then(l => console.log(`[SHOPEE] cache pre-aquecida: ${(l || []).length} devolucoes`))
      .catch(e => console.warn('[SHOPEE] pre-aquecimento falhou:', e.message || e));
  }, 30 * 1000);
  setInterval(() => {
    buscarDevolucoesProxy(false).catch(() => { /* tenta de novo no proximo */ });
  }, 8 * 60 * 1000);
}

module.exports = {
  cfg,
  buscarDevolucoesProxy,
  acharDevolucao,
  normShopee,
  iniciarPreAquecimento,
  resumoEspreita,
};
