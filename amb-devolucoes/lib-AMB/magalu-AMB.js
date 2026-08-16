// ============================================================
// amb-devolucoes/lib-AMB/magalu-AMB.js         (AMB Devol. b156)
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
// b152 - a API oficial (tickets, pedidos). O ramo Magalu da identificar
// chama caminhos RELATIVOS (/seller/v0/tickets, /seller/v1/orders/...).
const API_BASE = process.env.MAGALU_API_BASE || 'https://api.magalu.com';

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
  // ═══════════════════════════════════════════════════════════════════
  // b150 - PERSISTENCIA CONSERTADA. O consentimento da AMB passou
  // inteiro (login, lojas, code no callback) e quebrava AQUI: o modulo
  // chamava tokens.persistir({obj}), funcao que a lib nao exporta. O
  // nome real e atualizarTokensNoRender e ela recebe ARRAY de
  // {key, value} - mesmo padrao do bling-AMB/ml-AMB, que persistem em
  // producao ha semanas.
  // ═══════════════════════════════════════════════════════════════════
  const persistiu = await tokens.atualizarTokensNoRender([
    { key: 'AMB_MAGALU_ACCESS_TOKEN',  value: ACCESS },
    { key: 'AMB_MAGALU_REFRESH_TOKEN', value: REFRESH },
  ]);
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
  // b266 (review do Codex) - a renovacao so vale se o refresh NOVO ficou
  // guardado: se o Magalu aceitou e o Render falhou, a env mantem o refresh
  // JA CONSUMIDO e o proximo restart cai sem token — justo o caso que da
  // mais trabalho pra recuperar (consentimento inteiro no navegador certo).
  ultimaPersistenciaMagalu = !!(await tokens.atualizarTokensNoRender([   // b150: nome/formato certos
    { key: 'AMB_MAGALU_ACCESS_TOKEN',  value: ACCESS },
    { key: 'AMB_MAGALU_REFRESH_TOKEN', value: REFRESH },
  ]));
  if (!ultimaPersistenciaMagalu) console.error('[AMB/Magalu] renovou mas NAO persistiu no Render — refresh gravado esta consumido');
  return ACCESS;
}

/** GET autenticado com renovacao automatica no 401.
 *  b152 - aceita caminho RELATIVO (prefixa API_BASE) alem de URL cheia:
 *  o ramo Magalu da identificar (codigo da GOOD) chama
 *  chamarMagalu('/seller/v1/orders/...') — antes so URL cheia funcionava. */
async function chamarMagalu(url, extra = {}) {
  const urlFinal = String(url).startsWith('http') ? url : (API_BASE + url);
  if (!ACCESS && REFRESH) { try { await renovar(); } catch (e) { /* segue e falha adiante */ } }
  const fazer = () => axios.get(urlFinal, {
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

// ═══════════════════════════════════════════════════════════════════════
// b152 - RAMO MAGALU DO BIPE (porte fiel do lib/magalu.js da GOOD).
// Reconstruida nesta build em cima da b150 (persistencia preservada).
// A Magalu trata DEVOLUCAO como TICKET de pos-venda:
//   GET /seller/v0/tickets                    -> lista tickets
//   GET /seller/v0/tickets/{id}/returns       -> remessas reversas
// A etiqueta imprime o PROTOCOLO (16 dig = ticket.protocol). Indexamos
// por TRES chaves: P:protocolo | R:reverse_code | O:pedido (order.code,
// que vira numeroLoja no Bling). Duas fases, como na GOOD:
//   fase 1 (~1-2s): lista tickets -> protocolo + pedido; publica JA.
//   fase 2 (background, lotes de 4): reverse_code dos tickets abertos.
// ═══════════════════════════════════════════════════════════════════════
async function listarTickets(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v));
  const qs = p.toString();
  return chamarMagalu(`/seller/v0/tickets${qs ? '?' + qs : ''}`);
}

async function remessasReversasDoTicket(ticketId) {
  return chamarMagalu(`/seller/v0/tickets/${encodeURIComponent(ticketId)}/returns`);
}

const TIDX = { ts: 0, mapa: {}, total: 0, comReversa: 0, duracaoSeg: 0, erro: null };
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

let _fase2Rodando = false;
async function _fase2ReverseCodes(abertos) {
  if (_fase2Rodando) return;
  _fase2Rodando = true;
  try {
    let comReversa = 0;
    for (let i = 0; i < abertos.length; i += 4) {
      const lote = abertos.slice(i, i + 4);
      await Promise.all(lote.map(async (dev) => {
        try {
          const rr = await remessasReversasDoTicket(dev.ticket_id);
          const res = (rr.ok && rr.data && rr.data.results) ? rr.data.results : [];
          const comRc = res.find(x => x.reverse_code);
          const rc = comRc ? comRc.reverse_code : null;
          if (rc) {
            dev.reverse_code = String(rc);
            TIDX.mapa['R:' + dev.reverse_code] = dev;
            comReversa++;
          }
        } catch (e) { /* esse ticket fica sem reverse_code */ }
      }));
      await new Promise(s => setTimeout(s, 220));
    }
    TIDX.comReversa = comReversa;
    console.log(`[AMB/MAGALU] tickets fase 2: ${comReversa} reverse_codes indexados`);
  } finally { _fase2Rodando = false; }
}

async function construirIndiceDevolucoes(opts = {}) {
  if (!temToken()) { TIDX.erro = 'sem token Magalu da AMB'; return TIDX; }
  const t0 = Date.now();
  const maxPaginas = opts.maxPaginas || 4;   // ate 400 tickets
  const mapa = {};
  let total = 0;
  const abertos = [];

  for (let pg = 0; pg < maxPaginas; pg++) {
    const r = await listarTickets({ _limit: 100, _offset: pg * 100 });
    if (!r.ok) { TIDX.erro = `listarTickets HTTP ${r.status}`; break; }
    const lista = (r.data && r.data.results) || [];
    if (lista.length === 0) break;
    for (const t of lista) {
      total++;
      const itensBrutos = (t.order && t.order.delivery && t.order.delivery.items) || [];
      const itens = itensBrutos.map(it => ({
        sku: it.external_sku || it.sku || null,
        titulo: it.description || it.name || null,
        quantidade: it.quantity || 1,
      }));
      const dev = {
        fonte: 'magalu',
        via: 'ticket',
        ticket_id: t.id,
        protocolo: String(t.protocol || ''),
        pedido: String((t.order && t.order.code) || ''),
        pedido_id: (t.order && t.order.id) || null,
        tipo: t.type || null,
        motivo: t.reason || null,
        status: t.status || null,
        fechado: !!t.closed,
        criado_em: t.created_at || null,
        reverse_code: null, // preenchido na fase 2
        itens,
      };
      if (dev.protocolo) mapa['P:' + dev.protocolo] = dev;
      if (dev.pedido) mapa['O:' + dev.pedido] = dev;
      // ═══════════════════════════════════════════════════════════════
      // b156 - a fase 2 varre TODOS os tickets, fechados incluidos.
      // CONSTATADO 06/08 pelo raio-X (b155) no JSON cru: o Magalu FECHA
      // o ticket com o pacote ainda na rua (Ana: fechado 09/07, POSTED
      // em 06/08) e o /tickets/{id}/returns RESPONDE remessa de ticket
      // fechado (count 1). A premissa da GOOD "fechado nao tem pacote
      // voltando" pulava exatamente os tickets que importam - por isso
      // nenhum reverse_code era indexado (com_remessa_reversa: 0).
      // Custo: ~1 chamada por ticket (hoje 23), em lotes de 4.
      // ═══════════════════════════════════════════════════════════════
      abertos.push(dev);
    }
    if (lista.length < 100) break;
    await new Promise(s => setTimeout(s, 250));
  }

  // FASE 1 pronta: protocolo e pedido ja resolvem. Publica o indice JA.
  TIDX.ts = Date.now();
  TIDX.mapa = mapa;
  TIDX.total = total;
  TIDX.duracaoSeg = Math.round((Date.now() - t0) / 1000);
  if (total > 0) TIDX.erro = null;
  console.log(`[AMB/MAGALU] tickets fase 1: ${total} (protocolo+pedido) em ${TIDX.duracaoSeg}s - ${abertos.length} p/ fase 2 (todos, fechados incluidos - b156)`);
  if (opts.reverseEmBackground) {
    setImmediate(() => _fase2ReverseCodes(abertos)); // nao segura o bipe
  } else {
    await _fase2ReverseCodes(abertos); // pre-aquecimento: completa tudo
  }
  return TIDX;
}

function statusTickets() {
  return {
    quente: TIDX.ts > 0,
    idade_min: TIDX.ts ? Math.round((Date.now() - TIDX.ts) / 60000) : null,
    total_tickets: TIDX.total,
    com_remessa_reversa: TIDX.comReversa,
    chaves_indexadas: Object.keys(TIDX.mapa).length,
    duracao_construcao_seg: TIDX.duracaoSeg || null,
    erro: TIDX.erro,
  };
}

/** Acha a devolucao por QUALQUER codigo do fluxo Magalu:
 *  protocolo (16 dig) | reverse_code | pedido. Reconstroi a fase 1
 *  on-demand se o indice estiver frio (>30min). FALLBACK EXTRA da AMB:
 *  se nao houver ticket mas o PEDIDO estiver na espreita do BFF
 *  (devolucao criada no portal antes de virar ticket), devolve a
 *  devolucao da espreita com via:'espreita-categoria'. */
async function acharDevolucao(codigo) {
  const bruto = String(codigo || '').trim();
  const dig = soDigitos(bruto);
  if (!dig) return null;
  if (temToken() && (!TIDX.ts || (Date.now() - TIDX.ts) > 30 * 60000)) {
    // on-demand: so a fase 1 (1-2s); reverse_codes completam em background
    try { await construirIndiceDevolucoes({ reverseEmBackground: true }); } catch (e) { /* segue com o que tiver */ }
  }
  const porTicket = TIDX.mapa['P:' + dig] || TIDX.mapa['R:' + dig] || TIDX.mapa['O:' + dig] || null;
  if (porTicket) return porTicket;

  const daEspreita = IDX.porPedido[dig] || null;
  if (daEspreita) {
    return {
      fonte: 'magalu',
      via: 'espreita-categoria',
      ticket_id: null,
      protocolo: null,
      pedido: String(daEspreita.pedido || dig),
      pedido_id: null,
      tipo: daEspreita.tipo || null,
      motivo: null,
      status: daEspreita.status || null,
      fechado: false,
      criado_em: daEspreita.data_devolucao || null,
      reverse_code: null,
      categoria: daEspreita.categoria || null,
      itens: [],
    };
  }
  return null;
}

// b152 - a interface que a identificar da GOOD espera do cliente Magalu
const cfg = {
  get ativo() { return temCredenciais(); },
  get autorizado() { return temToken(); },
  apiBase: API_BASE,
};

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
    tickets: statusTickets(),   // b152 - o indice do bipe (P/R/O)
  };
}

function preAquecer() {
  if (!temToken()) {
    console.log('[AMB/MAGALU] desligada - falta consentimento OAuth');
    return;
  }
  // b152 - TICKETS (o indice do bipe) so exigem o token: aquecem mesmo
  // sem o tenant. 3min pos-boot + a cada 30min, como na GOOD.
  setTimeout(() => { construirIndiceDevolucoes().catch(e => console.error('[AMB/MAGALU] tickets:', e.message)); }, 3 * 60 * 1000).unref();
  setInterval(() => { construirIndiceDevolucoes({ reverseEmBackground: true }).catch(() => {}); }, 30 * 60 * 1000).unref();

  if (!temTenant()) {
    console.log('[AMB/MAGALU] espreita desligada - falta AMB_MAGALU_TENANT_ID (tickets seguem)');
    return;
  }
  setTimeout(() => { construirIndice().catch(e => console.error('[AMB/MAGALU]', e.message)); }, 5 * 60 * 1000).unref();
  setInterval(() => { construirIndice().catch(() => {}); }, 30 * 60 * 1000).unref();
}

// b149 - pra a tela de conexoes dizer qual app esta sendo usado
function appEmUso() {
  return { proprio: APP_PROPRIO, client_id_final: CLIENT_ID ? CLIENT_ID.slice(0, 6) + '...' : null };
}

// ═══════════════════════════════════════════════════════════════════
// b265 - RENOVACAO PREVENTIVA (mesmo padrao da b264 do ML)
//
// O access token se renova sozinho quando expira, mas o REFRESH tem
// validade propria e e de uso unico. Se o modulo da AMB ficar parado tempo
// demais, o refresh vence e so volta reautorizando A MAO — no caso do
// Magalu, refazendo todo o consentimento no navegador certo, que em agosto
// deu um trabalho enorme (client OAuth, redirect no idm, 2FA).
// Entao renovamos de tempos em tempos mesmo sem uso.
// Falha aqui NAO quebra nada: o caminho normal (expirou -> renova) segue.
// ═══════════════════════════════════════════════════════════════════
let ultimaPreventivaMag = 0;
let ultimaPersistenciaMagalu = false;   // b266

async function renovacaoPreventiva({ forcar = false } = {}) {
  const DIAS = Number(process.env.AMB_MAGALU_RENOVAR_DIAS || 7);
  const intervalo = DIAS * 24 * 60 * 60 * 1000;
  if (!forcar && ultimaPreventivaMag && (Date.now() - ultimaPreventivaMag) < intervalo) {
    return { ok: true, pulou: true, proxima_em_dias: Math.max(0, Math.round((intervalo - (Date.now() - ultimaPreventivaMag)) / 86400000)) };
  }
  if (!REFRESH) return { ok: false, erro: 'sem refresh token - autorize pelo /amb/conectar' };
  ultimaPersistenciaMagalu = false;
  let okRenovou = false;
  try { okRenovou = !!(await renovar()); } catch (e) { okRenovou = false; }
  // b266 - ciclo so conta como cumprido se persistiu; senao tenta no proximo
  // batimento, em vez de dormir uma semana com token morto na env
  if (okRenovou && ultimaPersistenciaMagalu) ultimaPreventivaMag = Date.now();
  return { ok: okRenovou && ultimaPersistenciaMagalu, renovado: okRenovou, persistiu: ultimaPersistenciaMagalu, dias: DIAS };
}

function ligarRenovacaoPreventiva() {
  // b266 (review do Codex) - TRES correcoes aqui:
  // 1) NADA de setInterval com dias: 30 dias = 2.592.000.000 ms, acima do
  //    limite de 32 bits do Node, que troca por 1 ms — viraria um loop de
  //    renovacoes consumindo o refresh de uso unico. Agora e um HEARTBEAT
  //    de 1h que so age quando o intervalo realmente venceu.
  // 2) o primeiro disparo e ESCALONADO por integracao (ML 2min, Magalu
  //    9min, Bling 15min): renovar tudo no mesmo instante disputava a
  //    escrita das env vars do Render.
  // 3) o Magalu sai de perto do preAquecer() (3min): os dois usariam o
  //    MESMO refresh de uso unico e um deles perderia — com o indice
  //    nascendo vazio.
  const UMA_HORA = 60 * 60 * 1000;
  const primeiro = setTimeout(() => {
    renovacaoPreventiva({ forcar: true }).catch(() => {});
    const bat = setInterval(() => { renovacaoPreventiva().catch(() => {}); }, UMA_HORA);
    if (bat.unref) bat.unref();
  }, 9 * 60 * 1000);
  if (primeiro.unref) primeiro.unref();
  console.log('[AMB/Magalu] renovacao preventiva ligada: a cada ' + Number(process.env.AMB_MAGALU_RENOVAR_DIAS || 7) + ' dia(s)');
}

module.exports = {
  appEmUso,
  renovacaoPreventiva, ligarRenovacaoPreventiva,   // b265
  cfg,                       // b152 - interface que a identificar espera
  acharDevolucao,            // b152 - bipe: protocolo | reverse_code | pedido
  listarTickets, remessasReversasDoTicket, construirIndiceDevolucoes,
  temCredenciais, temToken, temTenant,
  urlAutorizacao, trocarCodePorToken, chamarMagalu,
  construirIndice, resumoEspreita, statusIndice, preAquecer,
  porPedido: (p) => IDX.porPedido[String(p)] || null,
};
