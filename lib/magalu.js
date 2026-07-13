// ============================================================
// MAGALU - OAuth 2.0 (ID Magalu) + chamador da API
// ------------------------------------------------------------
// A Magalu trata DEVOLUCAO como um TICKET de pos-venda (modulo SAC):
//   - o ticket e o protocolo aberto pelo cliente
//   - a "remessa reversa" (return) e o pacote voltando
// Endpoints que interessam (base: https://api.magalu.com):
//   GET /seller/v0/tickets                    -> lista tickets
//   GET /seller/v0/tickets/{id}/returns       -> remessas reversas do ticket
//   GET /seller/v0/tickets/{id}/returns/{rid} -> uma remessa reversa
//
// OAuth (doc oficial):
//   consentimento: https://id.magalu.com/login?client_id=..&redirect_uri=..
//                  &scope=..&response_type=code&choose_tenants=true
//   troca do code: POST https://id.magalu.com/oauth/token  (JSON)
//   refresh:       POST https://id.magalu.com/oauth/token  (form-urlencoded)
//   access_token dura 7200s (2h) -> renovamos sozinhos.
//
// Tokens sao persistidos nas env vars do Render (mesmo padrao do ML).
// ============================================================
const axios = require('axios');

module.exports = ({ atualizarTokensNoRender }) => {
  const ID_BASE = 'https://id.magalu.com';
  const API_BASE = process.env.MAGALU_API_BASE || 'https://api.magalu.com';

  const CLIENT_ID = process.env.MAGALU_CLIENT_ID || '';
  const CLIENT_SECRET = process.env.MAGALU_CLIENT_SECRET || '';
  const REDIRECT_URI = process.env.MAGALU_REDIRECT_URI || '';

  // Escopos necessarios pra ler devolucoes (tickets + remessa reversa).
  // Precisam estar no client (criado via IDM CLI) E consentidos pelo seller.
  const SCOPES = (process.env.MAGALU_SCOPES || [
    'open:tickets-seller:read',
    'open:ticket-returns-seller:read',
    'open:ticket-events-seller:read',
    'open:ticket-messages-seller:read',
    'open:order-order-seller:read',
    'open:order-invoice-seller:read',
  ].join(' '));

  let ACCESS_TOKEN = process.env.MAGALU_ACCESS_TOKEN || '';
  let REFRESH_TOKEN = process.env.MAGALU_REFRESH_TOKEN || '';

  const cfg = {
    get ativo() { return !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI); },
    get autorizado() { return !!REFRESH_TOKEN; },
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scopes: SCOPES,
    apiBase: API_BASE,
  };

  // URL que o SELLER abre pra consentir (etapa unica, feita pelo Diego)
  function urlConsentimento(state = 'good') {
    const p = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      response_type: 'code',
      choose_tenants: 'true',
      state,
    });
    return `${ID_BASE}/login?${p.toString()}`;
  }

  // Troca o "code" (que chega no callback) por access+refresh token
  async function trocarCodePorTokens(code) {
    const r = await axios.post(`${ID_BASE}/oauth/token`, {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
      grant_type: 'authorization_code',
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 });

    ACCESS_TOKEN = r.data?.access_token || '';
    REFRESH_TOKEN = r.data?.refresh_token || '';
    if (!ACCESS_TOKEN || !REFRESH_TOKEN) throw new Error('resposta sem tokens');

    await atualizarTokensNoRender([
      { key: 'MAGALU_ACCESS_TOKEN', value: ACCESS_TOKEN },
      { key: 'MAGALU_REFRESH_TOKEN', value: REFRESH_TOKEN },
    ]);
    console.log(`[MAGALU] tokens obtidos e salvos (escopos: ${r.data?.scope || '-'})`);
    return { ok: true, scope: r.data?.scope || null, expires_in: r.data?.expires_in || null };
  }

  // Renova o access_token (dura 2h) usando o refresh_token
  async function renovarToken() {
    if (!REFRESH_TOKEN) return false;
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH_TOKEN,
      }).toString();
      const r = await axios.post(`${ID_BASE}/oauth/token`, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000,
      });
      ACCESS_TOKEN = r.data?.access_token || ACCESS_TOKEN;
      if (r.data?.refresh_token) REFRESH_TOKEN = r.data.refresh_token;
      await atualizarTokensNoRender([
        { key: 'MAGALU_ACCESS_TOKEN', value: ACCESS_TOKEN },
        { key: 'MAGALU_REFRESH_TOKEN', value: REFRESH_TOKEN },
      ]);
      console.log('[MAGALU] access_token renovado');
      return true;
    } catch (e) {
      console.error('[MAGALU] ERRO ao renovar:', e.response?.data || e.message);
      return false;
    }
  }

  // Chamador da API com auto-renovacao em 401 (1 tentativa)
  async function chamarMagalu(caminho, opts = {}) {
    if (!ACCESS_TOKEN && !(await renovarToken())) {
      return { ok: false, status: 401, data: { erro: 'sem token Magalu - autorize primeiro' } };
    }
    const url = caminho.startsWith('http') ? caminho : `${API_BASE}${caminho}`;
    const fazer = () => axios({
      method: opts.method || 'GET',
      url,
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, Accept: 'application/json', ...(opts.headers || {}) },
      data: opts.body || undefined,
      timeout: opts.timeout || 25000,
      validateStatus: () => true,
    });
    let r = await fazer();
    if (r.status === 401) {
      if (await renovarToken()) r = await fazer();
    }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, data: r.data };
  }

  // ---- Devolucoes (tickets + remessa reversa) ----
  async function listarTickets(params = {}) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v));
    const qs = p.toString();
    return chamarMagalu(`/seller/v0/tickets${qs ? '?' + qs : ''}`);
  }

  async function remessasReversasDoTicket(ticketId) {
    return chamarMagalu(`/seller/v0/tickets/${encodeURIComponent(ticketId)}/returns`);
  }

  return {
    cfg,
    urlConsentimento,
    trocarCodePorTokens,
    renovarToken,
    chamarMagalu,
    listarTickets,
    remessasReversasDoTicket,
  };
};
