
// 📌 Junto do INDICES, que e o outro estado de controle — e ANTES do
// `statusIndice` que le os dois. A ordem inversa funcionava (a funcao so
// roda depois da carga), mas depender disso e fragil.
// ⚠️ b414 - ACEITA O ATRASO, pro app poder encadear.
//
// Era fixo aqui dentro. O app agora roda as rotinas UMA DE CADA VEZ e
// precisa disparar com 0 — antes elas esperavam o proprio minuto e
// voltavam a se atropelar, com o encadeamento sem efeito nenhum.
//
// 📌 `!= null` e nao `||`: com `||`, o 0 cairia no padrao e a mudanca
// nao valeria nada — parecendo funcionar.
// ⚠️ b418 (Codex, P2) - AGENDADO TAMBEM E OCUPADO.
//
// Entre `preAquecer` agendar e o timer disparar, `ocupado` dizia FALSE — o
// modulo estava a caminho e parecia livre. Se o OAuth do Magalu terminasse
// pouco antes da fila chegar aqui, ela passava direto, e 3 minutos depois o
// Magalu acordava por cima de quem estivesse rodando.
//
// 📌 E A MESMA FRESTA DO `reagendado` (b415/b416), em outro modulo: la entre
// falhar e retentar, aqui entre agendar e comecar.
let agendado = false;

// ============================================================
// amb-devolucoes/lib-AMB/magalu-AMB.js         (AMB Devol. b156)
// ------------------------------------------------------------
// Magalu da AMBTotal.
//
// NAO precisa de app novo no Magalu: o OAuth deles e no nivel do
// APP, e a CONTA autorizada e decidida por quem esta logado na
// hora do consentimento. Entao usamos o MESMO MAGALU_CLIENT_ID/
// SECRET da GOOD (vars sem prefixo, mesmo servico) e guardamos
// TOKENS SEPARADOS da AMB (AMB_MAGALU_ACCESS_TOKEN/TOKENS.refresh),
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

// ⚠️ b361 - O MAGALU VIRA FABRICA (2 de 13).
//
// Era instancia unica do processo. Guarda os TOKENS: com duas empresas, uma
// faria requisicao ao Magalu com a CREDENCIAL DA OUTRA — e o marketplace
// responde com os dados da conta errada, sem erro nenhum.
//
// 📌 ENVOLVO SEM REINDENTAR (mesma tecnica do app-AMB): reindentar 568
// linhas daria um diff ilegivel onde ninguem acharia um erro real.
//
// ⚠️ AS 6 ENVS ERAM CRAVADAS EM `AMB_MAGALU_*`. Agora vem do prefixo da
// empresa, com `AMB_` de padrao — a AMB le exatamente as mesmas de hoje.
//
// ⚠️ E HA 8 TIMERS AQUI (renovacao preventiva, pre-aquecimento). Com duas
// instancias eles DOBRAM: duas renovacoes do mesmo token e corrida — e o
// refresh do Magalu e de USO UNICO, entao uma invalidaria a outra. Por isso
// `ligarRenovacaoPreventiva` continua sendo chamada UMA vez pelo app, e nao
// dentro da fabrica.
function criar(cfgEmpresa) {
  // ⚠️ b400 - a etiqueta do log diz QUAL EMPRESA.
  //
  // Era `[AMB/...]` fixo: o Render junta o log das duas no MESMO lugar,
  // e um erro da Girassol apareceria como AMB.
  //
  // 📌 CONST dentro da fábrica, nunca `let` no módulo — foi o erro que
  // cometi no b396: a 2ª empresa sobrescrevia a etiqueta da 1ª.
  const _TAG = String((cfgEmpresa && cfgEmpresa.PREFIXO_ENV) || 'AMB_')
    .replace(/_$/, '');
const _PREFIXO = String((cfgEmpresa && cfgEmpresa.PREFIXO_ENV) || 'AMB_');
const _env = (nome) => process.env[_PREFIXO + 'MAGALU_' + nome] || '';
'use strict';

const axios = require('axios');
const tokens = require('../../lib/render-tokens');
const { registrarPreventiva } = require('../../lib/token-preventiva');   // b271
// b272 (review do Codex) - ESTA DECLARACAO VOLTOU. Meu refactor da b271
// apagou o bloco antigo levando junto o `let RENOV.ultimaPersistencia`, mas a
// funcao de renovar continua ATRIBUINDO a ela. Em modulo strict, isso
// lanca ReferenceError bem depois do marketplace ja ter rotacionado o
// refresh: o token novo nao seria gravado e a integracao morreria.
// (RENOV.ultimaPersistencia -> RENOV.ultimaPersistencia — b345)

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
const CLIENT_ID = _env('CLIENT_ID') || process.env.MAGALU_CLIENT_ID || '';
const CLIENT_SECRET = _env('CLIENT_SECRET') || process.env.MAGALU_CLIENT_SECRET || '';
const APP_PROPRIO = !!_env('CLIENT_ID');
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

// ⚠️ b345 - GAVETA DE TOKENS: o caso mais grave dos 30.
//
// TOKENS.access/TOKENS.refresh/TOKENS.tenant eram do MODULO. Com duas empresas, uma faria
// requisicao ao Magalu com a CREDENCIAL DA OUTRA — e o marketplace nao
// tem como saber: responderia com os dados da conta errada.
//
// ⚠️ E a renovacao piora: o refresh do Magalu e de uso unico. Duas
// empresas renovando o MESMO token invalidam uma a outra em corrida.
//
// 📌 Os padroes leem as envs da AMB, entao hoje o comportamento e
// IDENTICO. O passo 3 passa as envs da empresa.
// ⚠️ b354 - PASSO 3, FATIA 2: UMA FABRICA PRO ESTADO DO MAGALU.
//
// Mesma tecnica da fatia 1 no app-AMB: as 5 gavetas com escrita nasciam em
// pontos diferentes do arquivo. O passo 3 precisa criar TODAS por empresa.
//
// ⚠️ ESTE E O MODULO DE MAIOR RISCO DOS QUE RESTAM: guarda os TOKENS. Com
// duas empresas dividindo `TOKENS.access`, uma faria requisicao ao Magalu
// com a credencial da outra — e o marketplace responderia com os dados da
// conta errada, sem erro nenhum.
//
// 📌 O `cfg` fica FORA: e fachada de leitura (0 escritas, medido) e esta no
// `module.exports` — renomear quebraria quem le `magalu.cfg`.
function criarEstadoMagalu() {
  return {
    // tokens da conta — o mais sensivel
    tokens: {
      access: _env('ACCESS_TOKEN') || '',
      refresh: _env('REFRESH_TOKEN') || '',
      tenant: _env('TENANT_ID') || '',
    },
    // controle da renovacao (o refresh do Magalu e de uso unico)
    renov: { emVoo: null, ultimaPersistencia: false },
    // sinalizadores de construcao
    indices: { fase2Rodando: false, construindo: false },
    // indice de tickets
    tidx: { ts: 0, mapa: {}, total: 0, comReversa: 0, duracaoSeg: 0, erro: null },
    // indice da espreita
    idx: { ts: 0, porPedido: {}, lista: [], erro: null, duracaoSeg: 0 },
  };
}

// ⚠️ a instancia de hoje VEM da fabrica — sem duas fontes do mesmo estado
const EST_MAGALU = criarEstadoMagalu();

const TOKENS = EST_MAGALU.tokens;

const temCredenciais = () => !!(CLIENT_ID && CLIENT_SECRET);
const temToken = () => !!(TOKENS.access || TOKENS.refresh);
const temTenant = () => !!TOKENS.tenant;

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
  if (String(_env('CHOOSE_TENANTS') || 'true').toLowerCase() !== 'false') {
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

  TOKENS.access = r.data.access_token || '';
  TOKENS.refresh = r.data.refresh_token || TOKENS.refresh;
  // ═══════════════════════════════════════════════════════════════════
  // b150 - PERSISTENCIA CONSERTADA. O consentimento da AMB passou
  // inteiro (login, lojas, code no callback) e quebrava AQUI: o modulo
  // chamava tokens.persistir({obj}), funcao que a lib nao exporta. O
  // nome real e atualizarTokensNoRender e ela recebe ARRAY de
  // {key, value} - mesmo padrao do bling-AMB/ml-AMB, que persistem em
  // producao ha semanas.
  // ═══════════════════════════════════════════════════════════════════
  const persistiu = await tokens.atualizarTokensNoRender([
    { key: _PREFIXO + 'MAGALU_ACCESS_TOKEN',  value: TOKENS.access },
    { key: _PREFIXO + 'MAGALU_REFRESH_TOKEN', value: TOKENS.refresh },
  ]);
  return { ok: true, persistiu, expira_em_s: r.data.expires_in || null };
}

// b267 (review do Codex) - UMA renovacao por vez NESTA integracao. Serializar
// as escritas no Render nao resolve isto: o batimento da preventiva e um 401
// normal podem chamar a renovacao ao mesmo tempo, com o MESMO refresh de uso
// unico — a segunda chamada falha e, pior, pode gravar por cima. Agora quem
// chega depois espera o resultado da que ja esta rodando.
// ⚠️ b345 - controle da renovacao (em voo + ultima persistencia).
// Compartilhado, duas empresas renovariam em cima uma da outra.
const RENOV = EST_MAGALU.renov;   // b354

async function renovar() {
  if (RENOV.emVoo) return RENOV.emVoo;      // b267 - pega carona
  RENOV.emVoo = (async () => { try { return await renovarInterno(); } finally { RENOV.emVoo = null; } })();
  return RENOV.emVoo;
}

async function renovarInterno() {

  if (!TOKENS.refresh) throw new Error('sem refresh token do Magalu da AMB - refaca o consentimento');
  const corpo = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: TOKENS.refresh,
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
  });
  const r = await axios.post(`${ID_BASE}/oauth/token`, corpo.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000,
  });
  TOKENS.access = r.data.access_token || '';
  if (r.data.refresh_token) TOKENS.refresh = r.data.refresh_token;
  // b266 (review do Codex) - a renovacao so vale se o refresh NOVO ficou
  // guardado: se o Magalu aceitou e o Render falhou, a env mantem o refresh
  // JA CONSUMIDO e o proximo restart cai sem token — justo o caso que da
  // mais trabalho pra recuperar (consentimento inteiro no navegador certo).
  RENOV.ultimaPersistencia = !!(await tokens.atualizarTokensNoRender([   // b150: nome/formato certos
    { key: _PREFIXO + 'MAGALU_ACCESS_TOKEN',  value: TOKENS.access },
    { key: _PREFIXO + 'MAGALU_REFRESH_TOKEN', value: TOKENS.refresh },
      ...(PREVENTIVA.parEnvCarimbo() ? [PREVENTIVA.parEnvCarimbo()] : []),   // b271
  ]));
  if (!RENOV.ultimaPersistencia) console.error(`[${_TAG}/Magalu] renovou mas NAO persistiu no Render — refresh gravado esta consumido`);
  // b270 (review do Codex) - QUALQUER renovacao que persistiu conta pro
  // intervalo, nao so a preventiva. Uma renovacao normal (por 401) gravava
  // carimbo novo enquanto o contador em memoria seguia no antigo — e o
  // batimento renovava de novo pouco depois, gastando refresh a toa.
  if (RENOV.ultimaPersistencia) PREVENTIVA.marcarRenovado();   // b271
  return TOKENS.access;
}

/** GET autenticado com renovacao automatica no 401.
 *  b152 - aceita caminho RELATIVO (prefixa API_BASE) alem de URL cheia:
 *  o ramo Magalu da identificar (codigo da GOOD) chama
 *  chamarMagalu('/seller/v1/orders/...') — antes so URL cheia funcionava. */
async function chamarMagalu(url, extra = {}) {
  const urlFinal = String(url).startsWith('http') ? url : (API_BASE + url);
  if (!TOKENS.access && TOKENS.refresh) { try { await renovar(); } catch (e) { /* segue e falha adiante */ } }
  const fazer = () => axios.get(urlFinal, {
    ...extra,
    headers: { Authorization: `Bearer ${TOKENS.access}`, ...(extra.headers || {}) },
    timeout: 25000, validateStatus: () => true,
  });
  let r = await fazer();
  if (r.status === 401 && TOKENS.refresh) {
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

// ⚠️ b345 - os dois indices + os sinalizadores de construcao, numa gaveta.
const INDICES = EST_MAGALU.indices;   // b354
const TIDX = EST_MAGALU.tidx;   // b354
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// (INDICES.fase2Rodando -> INDICES.fase2Rodando — b345)
async function _fase2ReverseCodes(abertos) {
  if (INDICES.fase2Rodando) return;
  INDICES.fase2Rodando = true;
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
    console.log(`[${_TAG}/MAGALU] tickets fase 2: ${comReversa} reverse_codes indexados`);
  } finally { INDICES.fase2Rodando = false; }
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
  console.log(`[${_TAG}/MAGALU] tickets fase 1: ${total} (protocolo+pedido) em ${TIDX.duracaoSeg}s - ${abertos.length} p/ fase 2 (todos, fechados incluidos - b156)`);
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
const IDX = EST_MAGALU.idx;   // b354
// (INDICES.construindo -> INDICES.INDICES.construindo — b345)

const HDR = () => ({ headers: {
  'x-tenant-id': TOKENS.tenant,
  Origin: 'https://seller.magaluentregas.com.br',
  Referer: 'https://seller.magaluentregas.com.br/',
} });

async function varrer(caminho, categoria) {
  const out = [];
  for (let off = 0; off < 500; off += 50) {
    const r = await chamarMagalu(`${BFF}${caminho}/${TOKENS.tenant}?limit=50&offset=${off}`, HDR());
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
  if (INDICES.construindo) return IDX;
  if (!temToken() || !temTenant()) return IDX;
  INDICES.construindo = true;
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
    console.log(`[${_TAG}/MAGALU] espreita: ${tudo.length} devolucoes em ${IDX.duracaoSeg}s`);
    return IDX;
  } finally { INDICES.construindo = false; }
}

function resumoEspreita() {
  if (!temToken()) return { quente: false, desligada: true, falta: 'consentimento OAuth da conta Magalu da AMB', em_transito: [] };
  if (!temTenant()) return { quente: false, desligada: true, falta: _PREFIXO + 'MAGALU_TENANT_ID', em_transito: [] };
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
    // ⚠️ b415 (Codex, P2) - A FILA ESPERAVA UM CAMPO QUE NAO EXISTIA.
    //
    // O `statusIndice` daqui nunca teve `construindo` — a fase ativa mora
    // em `INDICES.fase2Rodando`. A espera lia `st.construindo`, achava
    // `undefined` e retornava NA HORA: o magalu ficava fora da fila,
    // rodando por cima de quem viesse depois. A fila parecia completa.
    // ⚠️ b416: o apontamento pedia incluir a fase de tickets — mas CONFERI e
    // ela ja esta coberta: `construirIndice()` (a dos tickets) marca
    // `INDICES.construindo`, e `construirIndiceDevolucoes()` marca
    // `fase2Rodando`. Os 2 campos que existem cobrem as 2 funcoes.
    //
    // 📌 Eu tinha escrito `INDICES.ticketsRodando` aqui, um campo que NAO
    // EXISTE — leria `undefined` pra sempre, calado. Conferi a lista real
    // antes de subir.
    ocupado: !!(agendado || (INDICES && (INDICES.fase2Rodando
      || INDICES.construindo))),

    credenciais_do_app: temCredenciais(),
    token_da_amb: temToken(),
    tenant: TOKENS.tenant || null,
    quente: IDX.ts > 0,
    total: IDX.lista.length,
    erro: IDX.erro,
    duracao_seg: IDX.duracaoSeg || null,
    tickets: statusTickets(),   // b152 - o indice do bipe (P/R/O)
  };
}


function preAquecer(atrasoMs) {
  if (!temToken()) {
    console.log(`[${_TAG}/MAGALU] desligada - falta consentimento OAuth`);
    return;
  }
  // b152 - TICKETS (o indice do bipe) so exigem o token: aquecem mesmo
  // sem o tenant. 3min pos-boot + a cada 30min, como na GOOD.
  agendado = true;   // b418: a fila conta isto como ocupado
  setTimeout(() => { agendado = false; construirIndiceDevolucoes().catch(e => console.error(`[${_TAG}/MAGALU] tickets:`, e.message)); }, (atrasoMs != null ? atrasoMs : 3 * 60 * 1000)).unref();
  setInterval(() => { construirIndiceDevolucoes({ reverseEmBackground: true }).catch(() => {}); }, 30 * 60 * 1000).unref();

  if (!temTenant()) {
    console.log(`[${_TAG}/MAGALU] espreita desligada - falta ` + _PREFIXO + 'MAGALU_TENANT_ID (tickets seguem)');
    return;
  }
  setTimeout(() => { construirIndice().catch(e => console.error(`[${_TAG}/MAGALU]`, e.message)); }, 5 * 60 * 1000).unref();
  setInterval(() => { construirIndice().catch(() => {}); }, 30 * 60 * 1000).unref();
}

// b149 - pra a tela de conexoes dizer qual app esta sendo usado
function appEmUso() {
  return { proprio: APP_PROPRIO, client_id_final: CLIENT_ID ? CLIENT_ID.slice(0, 6) + '...' : null };
}

// b271 - RENOVACAO PREVENTIVA pela LIB UNICA (lib/token-preventiva.js).
// Antes cada modulo tinha sua copia deste mecanismo — e cada correcao da
// review precisava ser repetida em tres arquivos. Agora a peca e uma so, com
// a EMPRESA como parametro: integracao nova (ou empresa nova) = um registro
// como este, zero logica duplicada.
const PREVENTIVA = registrarPreventiva({
  // b362 (review do Codex) - a empresa e o prefixo saem da FICHA recebida,
  // nao do literal (mesmo padrao do bling-AMB, b246). Com duas instancias,
  // `empresa: 'ambtotal'` fixo faria as duas competirem pelo MESMO registro
  // de renovacao: a segunda substituiria o callback da primeira, e o
  // batimento so renovaria a empresa registrada por ultimo.
  empresa: (cfgEmpresa && cfgEmpresa.CHAVE_REGISTRO) || 'ambtotal', integracao: 'magalu',
  temRefresh: () => !!TOKENS.refresh,
  renovar: () => renovar(),
  persistiu: () => RENOV.ultimaPersistencia,
  carimboEnv: _PREFIXO + 'MAGALU_RENOVADO_EM',
  diasEnv: _PREFIXO + 'MAGALU_RENOVAR_DIAS',
});
const renovacaoPreventiva = (op) => PREVENTIVA.preventiva(op);
const ligarRenovacaoPreventiva = (op) => PREVENTIVA.ligar(op);


return {
  appEmUso,
  renovacaoPreventiva, ligarRenovacaoPreventiva,
  cfg,
  acharDevolucao,
  listarTickets, remessasReversasDoTicket, construirIndiceDevolucoes,
  temCredenciais, temToken, temTenant,
  urlAutorizacao, trocarCodePorToken, chamarMagalu,
  construirIndice, resumoEspreita, statusIndice, preAquecer,
  porPedido: (p) => IDX.porPedido[String(p)] || null,
};
}

// ⚠️ SO A FABRICA. Sem instancia padrao de proposito: se eu deixasse uma, o
// app poderia continuar usando a antiga sem nada avisar — foi exatamente o
// que aconteceu com o auth-AMB, que teve `criar()` por um dia inteiro
// enquanto o app usava a instancia do processo.
module.exports = { criar };
