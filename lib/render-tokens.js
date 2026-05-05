// ============================================================
// lib/render-tokens.js
// ------------------------------------------------------------
// Atualiza variaveis de ambiente no Render via API.
// Usado por bling.js e ml.js pra persistir tokens renovados.
// ============================================================

const axios = require('axios');

const RENDER_API_KEY = process.env.RENDER_API_KEY;
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID;

/**
 * Atualiza um ou mais env-vars no Render.
 * @param {Array<{key:string, value:string}>} updates
 * @returns {Promise<boolean>} true se sucesso
 */
async function atualizarTokensNoRender(updates) {
  if (!RENDER_API_KEY || !RENDER_SERVICE_ID) return false;
  try {
    const current = await axios.get(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`,
      { headers: { Authorization: `Bearer ${RENDER_API_KEY}` } }
    );
    const allVars = (current.data || []).map(item => ({
      key: item.envVar.key,
      value: item.envVar.value,
    }));
    for (const u of updates) {
      const existing = allVars.find(v => v.key === u.key);
      if (existing) existing.value = u.value;
      else allVars.push(u);
    }
    await axios.put(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`,
      allVars,
      { headers: { Authorization: `Bearer ${RENDER_API_KEY}`, 'Content-Type': 'application/json' } }
    );
    return true;
  } catch (error) {
    console.error('[Render] Erro:', error.response?.data || error.message);
    return false;
  }
}

module.exports = {
  atualizarTokensNoRender,
  isRenderPersistEnabled: () => !!(RENDER_API_KEY && RENDER_SERVICE_ID),
};
