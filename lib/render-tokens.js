// ============================================================
// lib/render-tokens.js — COMUM as duas empresas (b241, 04/09)
//
// Era copia. Medi: nenhuma funcao exclusiva de um lado — mas a AMB tinha
// uma TRAVA DE SEGURANCA A MAIS que a GOOD nao tinha (ver abaixo), entao
// adotei a versao da AMB. Terceiro modulo unificado (ml-buscas, nf-pessoa).
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
// b241 - SEM `config-AMB`: modulo comum nao pode depender do config de uma
// empresa. Conferi que os dois lados liam AS MESMAS variaveis, so por
// caminhos diferentes (a GOOD direto do ambiente, a AMB via cfg.render).
// Leio direto, que serve para as duas — e para a proxima.
const RENDER_API_KEY = process.env.RENDER_API_KEY || process.env.RENDER_API_KEY_v2 || '';
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || process.env.RENDER_SERVICE_ID_v2 || '';

// Maior lista ja vista neste processo — o piso de comparacao.
let maiorListaVista = 0;

async function listarTodasAsVars() {
  const todas = [];
  let cursor = null;
  for (let pagina = 0; pagina < 20; pagina++) {
    const url = `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars?limit=100`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const r = await axios.get(url, {
      headers: { Authorization: `Bearer ${RENDER_API_KEY}` },
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
// b268 (review do Codex) - DELEGA pro helper da GOOD. Os dois arquivos
// gravavam as MESMAS env-vars do MESMO servico, cada um com sua fila: rodando
// juntos, o segundo PUT restaurava o refresh ja consumido pelo primeiro.
// Agora ha uma fila so — a de la — e este modulo mantem a interface que os
// modulos da AMB ja usam.
// b241.1 (Codex) - A FILA UNICA VOLTA. Eu escrevi que "a fila continua
// existindo: e a deste arquivo" — e nao existia mais. Tirei a PONTE (que
// apontaria pra si mesma, certo) e junto foi a FILA, que morava na versao
// da GOOD e nao tinha equivalente na da AMB, que eu adotei.
//
// Sem ela: duas rotacoes simultaneas (bling e ml, por exemplo) fazem GET do
// mesmo retrato e o segundo PUT restaura o refresh JA CONSUMIDO pelo
// primeiro — aquele token morre no proximo restart. E o incidente de
// 04/07 outra vez, agora pela concorrencia em vez da paginacao.
//
// Como o modulo agora e UM SO pras duas empresas, esta fila serializa
// tudo por construcao — nem precisa da ponte que existia antes.
let filaRenderGlobal = Promise.resolve();

async function atualizarTokensNoRender(updates) {
  const minhaVez = filaRenderGlobal.then(
    () => escreverNoRender(updates),
    () => escreverNoRender(updates),   // erro do anterior nao trava a fila
  );
  filaRenderGlobal = minhaVez.catch(() => {});
  return minhaVez;
}

async function escreverNoRender(updates) {
  if (!RENDER_API_KEY || !RENDER_SERVICE_ID) {
    console.log('[Render] RENDER_API_KEY ou RENDER_SERVICE_ID ausente - token nao persistido');
    return false;
  }
  try {
    const todas = await listarTodasAsVars();

    // ── TRAVA 1: lista absurdamente pequena ────────────────────
    if (todas.length < 5) {
      console.error(`[Render] ABORTADO: lista com apenas ${todas.length} var(s) - suspeita de paginacao falha`);
      return false;
    }

    // ── TRAVA 2: encolhimento em relacao ao maior ja visto ─────
    if (maiorListaVista > 0 && todas.length < maiorListaVista * 0.8) {
      console.error(`[Render] ABORTADO: lista encolheu de ${maiorListaVista} para ${todas.length} vars - PUT cancelado`);
      return false;
    }
    if (todas.length > maiorListaVista) maiorListaVista = todas.length;

    for (const u of updates) {
      const existente = todas.find(v => v.key === u.key);
      if (existente) existente.value = u.value;
      else todas.push(u);
    }

    await axios.put(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`,
      todas,
      {
        headers: { Authorization: `Bearer ${RENDER_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    console.log(`[Render] ${updates.length} var(s) gravada(s), ${todas.length} preservadas no total`);
    return true;
  } catch (erro) {
    console.error('[Render] Erro:', (erro.response && erro.response.data) || erro.message);
    return false;
  }
}

module.exports = {
  atualizarTokensNoRender,
  listarTodasAsVars,
  persistenciaLigada: () => !!(RENDER_API_KEY && RENDER_SERVICE_ID),
  diagnostico: () => ({ maiorListaVista, ligada: !!(RENDER_API_KEY && RENDER_SERVICE_ID) }),
};
