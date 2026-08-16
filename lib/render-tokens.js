// ============================================================
// lib/render-tokens.js (v3.40.2)
// ------------------------------------------------------------
// Atualiza variaveis de ambiente no Render via API.
// Usado por bling.js e ml.js pra persistir tokens renovados.
//
// v3.40.2 - DESARME DA BOMBA: a API do Render PAGINA a lista de
// vars (20 por pagina) e o PUT SUBSTITUI o conjunto inteiro.
// Sem paginar o GET, servico com 20+ vars perdia as que ficavam
// fora da pagina a cada rotacao de token (foi assim que ML_* e
// RENDER_* sumiram em 04/07/2026). Agora: pagina ate o fim +
// trava de seguranca (lista suspeita = aborta, nunca zera o env).
// Tambem aceita RENDER_API_KEY_v2 / RENDER_SERVICE_ID_v2.
// ============================================================

const axios = require('axios');

const RENDER_API_KEY = process.env.RENDER_API_KEY || process.env.RENDER_API_KEY_v2;
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || process.env.RENDER_SERVICE_ID_v2;

async function listarTodasAsVars() {
  const todas = [];
  let cursor = null;
  for (let pagina = 0; pagina < 10; pagina++) {
    const url = `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars?limit=100` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const r = await axios.get(url, {
      headers: { Authorization: `Bearer ${RENDER_API_KEY}` },
    });
    const lote = r.data || [];
    if (lote.length === 0) break;
    for (const item of lote) {
      if (item && item.envVar && item.envVar.key) {
        todas.push({ key: item.envVar.key, value: item.envVar.value });
      }
    }
    cursor = lote[lote.length - 1] ? lote[lote.length - 1].cursor : null;
    if (!cursor || lote.length < 100) break;
  }
  return todas;
}

/**
 * Atualiza um ou mais env-vars no Render (preservando TODAS as outras).
 * @param {Array<{key:string, value:string}>} updates
 * @returns {Promise<boolean>} true se sucesso
 */
// b268 (review do Codex) - FILA UNICA. Existem dois helpers gravando as
// MESMAS env-vars do mesmo servico (este, da GOOD, e o render-tokens-AMB).
// Cada um faz GET de todas as vars e PUT do conjunto inteiro: se os dois
// rodarem juntos, o segundo PUT restaura o refresh JA CONSUMIDO que o
// primeiro acabou de trocar — e aquele token morre no proximo restart.
// Serializar so de um lado nao resolve; entao a fila mora aqui e o modulo
// da AMB passa a usar esta mesma funcao.
let filaRenderGlobal = Promise.resolve();

async function atualizarTokensNoRender(updates) {
  const minhaVez = filaRenderGlobal.then(() => escreverNoRender(updates), () => escreverNoRender(updates));
  filaRenderGlobal = minhaVez.catch(() => {});
  return minhaVez;
}

async function escreverNoRender(updates) {
  if (!RENDER_API_KEY || !RENDER_SERVICE_ID) return false;
  try {
    const allVars = await listarTodasAsVars();

    // TRAVA ANTI-WIPE: se a lista veio suspeita (vazia/mirrada),
    // NAO faz PUT - melhor nao persistir do que apagar o ambiente.
    if (allVars.length < 5) {
      console.error(`[Render] Lista de vars suspeita (${allVars.length} itens) - PUT abortado por seguranca`);
      return false;
    }

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
    console.log(`[Render] ${updates.length} var(s) atualizada(s) preservando ${allVars.length} no total`);
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
