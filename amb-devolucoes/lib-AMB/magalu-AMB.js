// ============================================================
// amb-devolucoes/lib-AMB/magalu-AMB.js         (AMB Devol. b11)
// ------------------------------------------------------------
// Magalu da AMBTotal.
//
// NAO precisa de app novo no Magalu: o OAuth deles e no nivel do
// APP, e a CONTA autorizada e decidida por quem esta logado na
// hora do consentimento. Entao usamos o MESMO MAGALU_CLIENT_ID/
// SECRET da GOOD (vars sem prefixo, mesmo servico) e guardamos
// TOKENS SEPARADOS da AMB (AMB_MAGALU_ACCESS_TOKEN/REFRESH),
// obtidos com o Diego logado na conta Magalu DA AMBTOTAL.
//
// O tenant do portal Magalu Entregas e outro segredo por conta:
// AMB_MAGALU_TENANT_ID (na GOOD e 'goodimport-magazine'; o da
// AMB o Diego descobre no DevTools do portal, header x-tenant-id).
//
// A espreita varre as 3 modalidades do BFF do portal (padrao
// descoberto na GOOD via DevTools, testado 200):
//   /v1/orders/{tenant}       -> Agencias Magalu
//   /v1/post-office/{tenant}  -> Correios
//   /v1/fulfillment/{tenant}  -> Fulfillment (o Magalu Full!)
// ============================================================

'use strict';

const axios = require('axios');
const tokens = require('./render-tokens-AMB');

const ID_BASE = 'https://id.magalu.com';
const BFF = 'https://seller-devolution-bff.mglu.io';

// ═══════════════════════════════════════════════════════════════════════
// b149 - APP PROPRIO DA AMB, se existir.
// No Magalu o app pertence a UMA conta. Se a AMBTotal nao conseguir
// consentir no app da GOOD, a saida e criar um app proprio pra ela no
// portal de desenvolvedores e por as credenciais dele aqui:
//     AMB_MAGALU_CLIENT_ID / AMB_MAGALU_CLIENT_SECRET   (no Render)
// Sem essas variaveis, segue usando o app compartilhado com a GOOD -
// entao criar isto nao muda nada enquanto voce nao preencher.
// ═══════════════════════════════════════════════════════════════════════
const CLIENT_ID = process.env.AMB_MAGALU_CLIENT_ID || process.env.MAGALU_CLIENT_ID || '';
const CLIENT_SECRET = process.env.AMB_MAGALU_CLIENT_SECRET || process.env.MAGALU_CLIENT_SECRET || '';
const APP_PROPRIO = !!process.env.AMB_MAGALU_CLIENT_ID;
// ═══════════════════════════════════════════════════════════════════════
// b148 - OS ESCOPOS SAO OS MESMOS DA GOOD.
// O app do Magalu e COMPARTILHADO pelas duas empresas, entao os escopos
// permitidos sao os mesmos - e o Magalu recusa o consentimento inteiro
// ("Houve um erro com a sua solicitacao") quando se pede um escopo que o
// app nao tem. A AMB pedia escopos ADIVINHADOS: sem o sufixo -seller
// (open:order-order:read em vez de open:order-order-seller:read) e mais
// dois que o app nao possui (open:portfolio:read e offline_access).
// Aqui vai a lista EXATA que a GOOD usa e que funciona hoje.
// ═══════════════════════════════════════════════════════════════════════
const SCOPES = (process.env.MAGALU_SCOPES || [
  'open:tickets-seller:read',
  'open:ticket-returns-seller:read',
  'open:ticket-events-seller:read',
  'open:ticket-messages-seller:read',
  'open:order-order-seller:read',
  'open:order-invoice-seller:read',
  'open:order-delivery-seller:read',
  'open:order-logistics-seller:read',
  'open:logistic-seller-shippings:read',
  'open:logistic-seller-trackings:read',
].join(' ')).trim();

let ACCESS = process.env.AMB_MAGALU_ACCESS_TOKEN || '';
let REFRESH = process.env.AMB_MAGALU_REFRESH_TOKEN || '';
let TENANT = process.env.AMB_MAGALU_TENANT_ID || '';

const temCredenciais = () => !!(CLIENT_ID && CLIENT_SECRET);
const temToken = () => !!(ACCESS || REFRESH);
const temTenant = () => !!TENANT;

function urlAutorizacao(state, redirectUri) {
  // ═══════════════════════════════════════════════════════════════════
  // b147 - choose_tenants VIROU OPCIONAL.
  // Com ele ligado, depois de confirmar a conta o Magalu tenta mostrar o
  // seletor de LOJAS. Se a conta da AMBTotal ainda nao tem loja vinculada
  // a este app, ele nao tem o que exibir e a tela simplesmente trava no
  // "continuar" - foi o que aconteceu. Sem o parametro, quando ha uma
  // unica loja ele nem pergunta.
  // Pra voltar ao comportamento antigo: crie AMB_MAGALU_CHOOSE_TENANTS=true
  // no Render.
  // ═══════════════════════════════════════════════════════════════════
  // b148 - choose_tenants VOLTA a ser padrao: a GOOD usa e funciona, entao
  // nao era ele o problema (eram os escopos). Pra desligar, crie
  // AMB_MAGALU_CHOOSE_TENANTS=false no Render.
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri,
    response_type: 'code', scope: SCOPES, state,
  });
  if (String(process.env.AMB_MAGALU_CHOOSE_TENANTS || 'true').toLowerCase() !== 'false') {
    p.set('choose_tenants', 'true');
  }
  return `${ID_BASE}/login?${p.toString()}`;
}

async function trocarCodePorToken(code, redirectUri) {
  const r = await axios.post(`${ID_BASE}/oauth/token`, {
    grant_type: 'authorization_code',
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    code, redirect_uri: redirectUri,
  }, { timeout: 20000 });

  ACCESS = r.data.access_token || '';
  REFRESH = r.data.refresh_token || REFRESH;
  const persistiu = await tokens.persistir({
    AMB_MAGALU_ACCESS_TOKEN: ACCESS,
    AMB_MAGALU_REFRESH_TOKEN: REFRESH,
  });
  return { ok: true, persistiu, expira_em_s: r.data.expires_in || null };
}

async function renovar() {
  if (!REFRESH) throw new Error('sem refresh token do Magalu da AMB - refaca o consentimento');
  const corpo = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: REFRESH,
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
  });
  const r = await axios.post(`${ID_BASE}/oauth/token`, corpo.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000,
  });
  ACCESS = r.data.access_token || '';
  if (r.data.refresh_token) REFRESH = r.data.refresh_token;
  await tokens.persistir({
    AMB_MAGALU_ACCESS_TOKEN: ACCESS,
    AMB_MAGALU_REFRESH_TOKEN: REFRESH,
  });
  return ACCESS;
}

/** GET autenticado com renovacao automatica no 401. */
async function chamarMagalu(url, extra = {}) {
  if (!ACCESS && REFRESH) { try { await renovar(); } catch (e) { /* segue e falha adiante */ } }
  const fazer = () => axios.get(url, {
    ...extra,
    headers: { Authorization: `Bearer ${ACCESS}`, ...(extra.headers || {}) },
    timeout: 25000, validateStatus: () => true,
  });
  let r = await fazer();
  if (r.status === 401 && REFRESH) {
    try { await renovar(); r = await fazer(); } catch (e) { /* devolve o 401 */ }
  }
  return { ok: r.status >= 200 && r.status < 300, status: r.status, data: r.data };
}

// ── A ESPREITA ───────────────────────────────────────────────
const IDX = { ts: 0, porPedido: {}, lista: [], erro: null, duracaoSeg: 0 };
let construindo = false;

const HDR = () => ({ headers: {
  'x-tenant-id': TENANT,
  Origin: 'https://seller.magaluentregas.com.br',
  Referer: 'https://seller.magaluentregas.com.br/',
} });

async function varrer(caminho, categoria) {
  const out = [];
  for (let off = 0; off < 500; off += 50) {
    const r = await chamarMagalu(`${BFF}${caminho}/${TENANT}?limit=50&offset=${off}`, HDR());
    if (!r.ok) { IDX.erro = `${categoria} HTTP ${r.status}`; break; }
    const recs = (r.data && r.data.records) || [];
    for (const d of recs) {
      out.push({
        categoria,
        chave: String(d.uuid || d.id || ''),
        pedido: String(d.orderId || ''),
        status: d.status || null,                  // IN_TRANSIT | DELIVERED | RETURNED
        tipo: d.devolutionType || null,
        valor: d.price != null ? d.price : null,
        data_devolucao: d.devolutionDate || null,
        entregue_em: d.deliveredAt || null,
        prazo: d.deadlineDate || null,
      });
    }
    const total = (r.data && r.data.meta && r.data.meta.totalRecords) || 0;
    if (off + recs.length >= total || recs.length === 0) break;
    await new Promise(s => setTimeout(s, 250));
  }
  return out;
}

async function construirIndice() {
  if (construindo) return IDX;
  if (!temToken() || !temTenant()) return IDX;
  construindo = true;
  const t0 = Date.now();
  try {
    IDX.erro = null;
    const tudo = [];
    for (const [caminho, cat] of [['/v1/orders', 'agencia'], ['/v1/post-office', 'correios'], ['/v1/fulfillment', 'fulfillment']]) {
      try { tudo.push(...await varrer(caminho, cat)); }
      catch (e) { IDX.erro = `${cat}: ${e.message}`; }
      await new Promise(s => setTimeout(s, 200));
    }
    const porPedido = {};
    for (const d of tudo) if (d.pedido) porPedido[d.pedido] = d;
    IDX.ts = Date.now();
    IDX.lista = tudo;
    IDX.porPedido = porPedido;
    IDX.duracaoSeg = Math.round((Date.now() - t0) / 1000);
    console.log(`[AMB/MAGALU] espreita: ${tudo.length} devolucoes em ${IDX.duracaoSeg}s`);
    return IDX;
  } finally { construindo = false; }
}

function resumoEspreita() {
  if (!temToken()) return { quente: false, desligada: true, falta: 'consentimento OAuth da conta Magalu da AMB', em_transito: [] };
  if (!temTenant()) return { quente: false, desligada: true, falta: 'AMB_MAGALU_TENANT_ID', em_transito: [] };
  if (!IDX.ts) return { quente: false, em_transito: [] };

  const dias = (v) => v ? Math.floor((Date.now() - Date.parse(v)) / 864e5) : null;
  const emTransito = [];
  let entregues = 0;
  for (const d of IDX.lista) {
    const st = String(d.status || '').toUpperCase();
    if (st === 'DELIVERED' || st === 'RETURNED') { entregues++; continue; }
    emTransito.push({
      marketplace: 'magalu',
      pedido: d.pedido, tracking: d.chave || null,
      status: [st, d.categoria].filter(Boolean).join(' / '),
      dias_em_transito: dias(d.data_devolucao),
      categoria: d.categoria,
    });
  }
  emTransito.sort((x, y) => (y.dias_em_transito || 0) - (x.dias_em_transito || 0));
  return { quente: true, idade_min: Math.round((Date.now() - IDX.ts) / 60000), em_transito: emTransito, entregues_indice: entregues };
}

function statusIndice() {
  return {
    credenciais_do_app: temCredenciais(),
    token_da_amb: temToken(),
    tenant: TENANT || null,
    quente: IDX.ts > 0,
    total: IDX.lista.length,
    erro: IDX.erro,
    duracao_seg: IDX.duracaoSeg || null,
  };
}

function preAquecer() {
  if (!temToken() || !temTenant()) {
    console.log('[AMB/MAGALU] desligada -', !temToken() ? 'falta consentimento OAuth' : 'falta AMB_MAGALU_TENANT_ID');
    return;
  }
  setTimeout(() => { construirIndice().catch(e => console.error('[AMB/MAGALU]', e.message)); }, 5 * 60 * 1000).unref();
  setInterval(() => { construirIndice().catch(() => {}); }, 30 * 60 * 1000).unref();
}

// b149 - pra a tela de conexoes dizer qual app esta sendo usado
function appEmUso() {
  return { proprio: APP_PROPRIO, client_id_final: CLIENT_ID ? CLIENT_ID.slice(0, 6) + '...' : null };
}

module.exports = {
  appEmUso,
  temCredenciais, temToken, temTenant,
  urlAutorizacao, trocarCodePorToken, chamarMagalu,
  construirIndice, resumoEspreita, statusIndice, preAquecer,
  porPedido: (p) => IDX.porPedido[String(p)] || null,
};
