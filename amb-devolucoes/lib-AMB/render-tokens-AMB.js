// ============================================================
// amb-devolucoes/lib-AMB/render-tokens-AMB.js   (AMB Devol. b1)
// ------------------------------------------------------------
// Persiste tokens renovados como env vars do proprio servico,
// via API do Render. Espelho do lib/render-tokens.js da GOOD.
//
// CONTEXTO DO PERIGO (incidente de 04/07/2026 no servico da GOOD):
// a API do Render PAGINA a lista de env vars e o PUT SUBSTITUI o
// conjunto INTEIRO. Sem paginar o GET, um servico com muitas vars
// perdia as que ficavam de fora a cada rotacao de token — foi
// assim que as ML_* e RENDER_* sumiram.
//
// A versao da GOOD (v3.40.2) resolveu paginando + travando quando
// a lista vem com menos de 5 itens. AQUI A TRAVA E MAIS FORTE, e
// de proposito: com a AMB o servico passa a ter ~10 vars a mais,
// e o piso de 5 nao protege mais contra uma paginacao que traga
// "quase tudo". Esta versao guarda o MAIOR numero de vars ja visto
// e aborta se a lista nova encolher mais de 20% em relacao a ele.
// Melhor nao persistir um token do que apagar o ambiente inteiro
// (o token se renova sozinho na proxima; a env var apagada, nao).
// ============================================================

'use strict';

const axios = require('axios');
const cfg = require('../config-AMB');

// Maior lista ja vista neste processo — o piso de comparacao.
let maiorListaVista = 0;

async function listarTodasAsVars() {
  const todas = [];
  let cursor = null;
  for (let pagina = 0; pagina < 20; pagina++) {
    const url = `https://api.render.com/v1/services/${cfg.render.serviceId}/env-vars?limit=100`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const r = await axios.get(url, {
      headers: { Authorization: `Bearer ${cfg.render.apiKey}` },
      timeout: 20000,
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
 * Atualiza env vars no Render preservando TODAS as outras.
 * @param {Array<{key:string,value:string}>} updates
 * @returns {Promise<boolean>}
 */
// b266 (review do Codex) - FILA. Esta funcao faz GET de TODAS as env vars e
// PUT do conjunto inteiro. Duas renovacoes simultaneas (ML, Magalu, Bling)
// liam o mesmo conjunto e a segunda escrita RESTAURAVA o refresh antigo — ja
// consumido — da outra integracao. No proximo restart, aquele token estaria
// morto e so voltaria reautorizando a mao. Agora as escritas acontecem uma
// de cada vez, e cada uma le o estado depois da anterior.
let filaRender = Promise.resolve();

async function atualizarTokensNoRender(updates) {
  const minhaVez = filaRender.then(() => escreverNoRender(updates), () => escreverNoRender(updates));
  filaRender = minhaVez.catch(() => {});
  return minhaVez;
}

async function escreverNoRender(updates) {
  if (!cfg.render.apiKey || !cfg.render.serviceId) {
    console.log('[AMB/Render] RENDER_API_KEY ou RENDER_SERVICE_ID ausente - token nao persistido');
    return false;
  }
  try {
    const todas = await listarTodasAsVars();

    // ── TRAVA 1: lista absurdamente pequena ────────────────────
    if (todas.length < 5) {
      console.error(`[AMB/Render] ABORTADO: lista com apenas ${todas.length} var(s) - suspeita de paginacao falha`);
      return false;
    }

    // ── TRAVA 2: encolhimento em relacao ao maior ja visto ─────
    if (maiorListaVista > 0 && todas.length < maiorListaVista * 0.8) {
      console.error(`[AMB/Render] ABORTADO: lista encolheu de ${maiorListaVista} para ${todas.length} vars - PUT cancelado`);
      return false;
    }
    if (todas.length > maiorListaVista) maiorListaVista = todas.length;

    for (const u of updates) {
      const existente = todas.find(v => v.key === u.key);
      if (existente) existente.value = u.value;
      else todas.push(u);
    }

    await axios.put(
      `https://api.render.com/v1/services/${cfg.render.serviceId}/env-vars`,
      todas,
      {
        headers: { Authorization: `Bearer ${cfg.render.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    console.log(`[AMB/Render] ${updates.length} var(s) gravada(s), ${todas.length} preservadas no total`);
    return true;
  } catch (erro) {
    console.error('[AMB/Render] Erro:', (erro.response && erro.response.data) || erro.message);
    return false;
  }
}

module.exports = {
  atualizarTokensNoRender,
  listarTodasAsVars,
  persistenciaLigada: () => !!(cfg.render.apiKey && cfg.render.serviceId),
  diagnostico: () => ({ maiorListaVista, ligada: !!(cfg.render.apiKey && cfg.render.serviceId) }),
};
