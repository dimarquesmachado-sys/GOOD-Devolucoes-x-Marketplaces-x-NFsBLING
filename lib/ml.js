// ============================================================
// lib/ml.js
// ------------------------------------------------------------
// Cliente Mercado Livre.
// - renovarTokenML: refresh do access_token
// - chamarML: GET com retry de 401
// - buscarNFnoML: shipment -> invoice_data
// ============================================================

const axios = require('axios');
const { atualizarTokensNoRender } = require('./render-tokens');

const ML_CLIENT_ID = process.env.ML_CLIENT_ID;
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
let ML_ACCESS_TOKEN = process.env.ML_ACCESS_TOKEN;
let ML_REFRESH_TOKEN = process.env.ML_REFRESH_TOKEN;

async function renovarTokenML() {
  console.log('[ML] Renovando access token...');
  try {
    const response = await axios.post(
      'https://api.mercadolibre.com/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ML_CLIENT_ID,
        client_secret: ML_CLIENT_SECRET,
        refresh_token: ML_REFRESH_TOKEN,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    ML_ACCESS_TOKEN = response.data.access_token;
    ML_REFRESH_TOKEN = response.data.refresh_token;
    await atualizarTokensNoRender([
      { key: 'ML_ACCESS_TOKEN', value: ML_ACCESS_TOKEN },
      { key: 'ML_REFRESH_TOKEN', value: ML_REFRESH_TOKEN },
    ]);
    return true;
  } catch (error) {
    console.error('[ML] ERRO renovar:', error.response?.data || error.message);
    return false;
  }
}

async function chamarML(url, headersExtras = {}) {
  const fazer = () => axios.get(url, {
    headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}`, ...headersExtras },
  });
  try {
    const r = await fazer();
    return { ok: true, data: r.data, status: r.status };
  } catch (error) {
    // v3.40: o ML as vezes responde 403 (nao 401) com token vencido -
    // o refresh tem que disparar nos DOIS casos, senao fica 403 eterno.
    const st = error.response?.status;
    if (st === 401 || st === 403) {
      if (await renovarTokenML()) {
        try {
          const r = await fazer();
          return { ok: true, data: r.data, status: r.status };
        } catch (err2) {
          return { ok: false, status: err2.response?.status, error: err2.response?.data || err2.message };
        }
      }
    }
    return { ok: false, status: error.response?.status, error: error.response?.data || error.message };
  }
}

async function buscarNFnoML(shipmentId) {
  return chamarML(`https://api.mercadolibre.com/shipments/${shipmentId}/invoice_data?siteId=MLB`);
}

// v3.40 - injeta tokens novos (usado pelo /ml/setup) e persiste no Render.
// v3.40.1: se a persistencia falhar (RENDER_API_KEY/SERVICE_ID ausentes),
// NAO quebra - avisa. Tokens ficam na memoria ate o proximo redeploy.
async function definirTokensML(accessToken, refreshToken) {
  ML_ACCESS_TOKEN = accessToken;
  ML_REFRESH_TOKEN = refreshToken;
  try {
    await atualizarTokensNoRender([
      { key: 'ML_ACCESS_TOKEN', value: ML_ACCESS_TOKEN },
      { key: 'ML_REFRESH_TOKEN', value: ML_REFRESH_TOKEN },
    ]);
    return { persistiu: true };
  } catch (e) {
    console.warn('[ML] tokens ativos na MEMORIA, mas falhou persistir no Render:', e.message || e);
    return { persistiu: false, erro: e.message || String(e) };
  }
}

module.exports = {
  chamarML,
  renovarTokenML,
  buscarNFnoML,
  definirTokensML,
  getClientML: () => ({ clientId: ML_CLIENT_ID, clientSecret: ML_CLIENT_SECRET }),
  hasToken: () => !!ML_ACCESS_TOKEN,
};
