// ============================================================
// amb-devolucoes/lib-AMB/bling-AMB.js          (AMB Devol. b20)
// ------------------------------------------------------------
// Cliente Bling ERP v3 da AMBTotal.
// Espelho do lib/bling.js da GOOD, com duas diferencas:
//   1) le as credenciais do config-AMB (env vars AMB_BLING_*)
//   2) persiste os tokens nas chaves AMB_BLING_ACCESS_TOKEN /
//      AMB_BLING_REFRESH_TOKEN — NUNCA nas da GOOD
//
// IMPORTANTE: o app do Bling da AMB e SEPARADO do app da GOOD e
// tambem do app que o Mover-Pedidos usa. Refresh token do Bling
// e de uso unico: dois servicos com o mesmo CLIENT_ID derrubam o
// token um do outro. Por isso client_id proprio.
//
// Rate limit do Bling e por CLIENT_ID (~3 req/s) — com app
// proprio, a AMB nao divide cota com a GOOD.
// ============================================================

'use strict';

const axios = require('axios');
const cfg = require('../config-AMB');
const { atualizarTokensNoRender } = require('./render-tokens-AMB');

let ACCESS_TOKEN  = cfg.bling.accessToken;
let REFRESH_TOKEN = cfg.bling.refreshToken;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function basicAuth() {
  return Buffer.from(`${cfg.bling.clientId}:${cfg.bling.clientSecret}`).toString('base64');
}

// ============================================================
// AUTH
// ============================================================

async function renovarToken() {
  if (!cfg.bling.clientId || !cfg.bling.clientSecret) {
    console.error('[AMB/Bling] AMB_BLING_CLIENT_ID ou AMB_BLING_CLIENT_SECRET ausente');
    return false;
  }
  if (!REFRESH_TOKEN) {
    console.error('[AMB/Bling] Sem refresh token - rode o /amb/bling/setup');
    return false;
  }
  console.log('[AMB/Bling] Renovando access token...');
  try {
    const r = await axios.post(
      `${cfg.bling.apiBase}/oauth/token`,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN }).toString(),
      {
        headers: {
          Authorization: `Basic ${basicAuth()}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 20000,
      }
    );
    ACCESS_TOKEN = r.data.access_token;
    if (r.data.refresh_token) REFRESH_TOKEN = r.data.refresh_token;
    await atualizarTokensNoRender([
      { key: cfg.bling.chaveAccess,  value: ACCESS_TOKEN },
      { key: cfg.bling.chaveRefresh, value: REFRESH_TOKEN },
    ]);
    console.log('[AMB/Bling] Token renovado');
    return true;
  } catch (erro) {
    console.error('[AMB/Bling] ERRO ao renovar:', (erro.response && erro.response.data) || erro.message);
    return false;
  }
}

/**
 * Troca o authorization_code (da URL de callback) por access+refresh.
 * O code do Bling expira em ~1 minuto.
 */
async function trocarCodePorToken(code) {
  const r = await axios.post(
    `${cfg.bling.apiBase}/oauth/token`,
    new URLSearchParams({ grant_type: 'authorization_code', code }).toString(),
    {
      headers: {
        Authorization: `Basic ${basicAuth()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '1.0',
      },
      timeout: 20000,
    }
  );
  ACCESS_TOKEN = r.data.access_token;
  if (r.data.refresh_token) REFRESH_TOKEN = r.data.refresh_token;
  const persistiu = await atualizarTokensNoRender([
    { key: cfg.bling.chaveAccess,  value: ACCESS_TOKEN },
    { key: cfg.bling.chaveRefresh, value: REFRESH_TOKEN },
  ]);
  return { dados: r.data, persistiu };
}

/**
 * Monta a URL de autorizacao pra colar no navegador.
 */
function urlAutorizacao() {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.bling.clientId,
    state: 'amb-devolucoes',
  });
  return `${cfg.bling.apiBase}/oauth/authorize?${p.toString()}`;
}

// ============================================================
// CHAMADA BASE (retry de 401 e 429, igual a da GOOD)
// ============================================================

async function chamarBling(caminho, opcoes = {}) {
  const url = caminho.startsWith('http') ? caminho : `${cfg.bling.apiBase}${caminho}`;
  const fazer = () => axios({
    url,
    method: opcoes.method || 'GET',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, ...(opcoes.headers || {}) },
    data: opcoes.data,
    timeout: opcoes.timeout || 30000,
  });

  try {
    const r = await fazer();
    return { ok: true, data: r.data, status: r.status };
  } catch (erro) {
    const status = erro.response && erro.response.status;

    if (status === 401) {
      if (await renovarToken()) {
        try {
          const r = await fazer();
          return { ok: true, data: r.data, status: r.status };
        } catch (e2) {
          return { ok: false, status: e2.response && e2.response.status, error: (e2.response && e2.response.data) || e2.message };
        }
      }
      return { ok: false, status: 401, error: 'token invalido e refresh falhou - rode o /amb/bling/setup' };
    }

    if (status === 429) {
      console.log('[AMB/Bling] 429 - aguardando 1.5s');
      await sleep(1500);
      try {
        const r = await fazer();
        return { ok: true, data: r.data, status: r.status };
      } catch (e2) {
        return { ok: false, status: e2.response && e2.response.status, error: (e2.response && e2.response.data) || e2.message };
      }
    }

    return { ok: false, status, error: (erro.response && erro.response.data) || erro.message };
  }
}

// ============================================================
// CONSULTAS BASICAS (o minimo pra provar que a conexao vive)
// ============================================================

/** Busca produto por SKU. O Bling aceita ?codigo= (e traz similares). */
async function buscarProdutoPorSku(sku) {
  const r = await chamarBling(`/produtos?codigo=${encodeURIComponent(sku)}&limite=10`);
  if (!r.ok) return r;
  const lista = (r.data && r.data.data) || [];
  const exato = lista.find(p => String(p.codigo || '').trim() === String(sku).trim()) || null;
  return { ok: true, exato, candidatos: lista.length, lista };
}

/** GET /pedidos/vendas/{id} */
async function buscarPedidoPorId(id) {
  const r = await chamarBling(`/pedidos/vendas/${id}`);
  return r.ok ? { ok: true, pedido: (r.data && r.data.data) || null } : r;
}

/** GET /nfe/{id} */
async function buscarNFePorId(id) {
  const r = await chamarBling(`/nfe/${id}`);
  return r.ok ? { ok: true, nfe: (r.data && r.data.data) || null } : r;
}

/**
 * Teste de vida: primeira pagina de produtos. Serve pra saber se
 * o token esta valido e se os escopos batem.
 */
async function testeDeVida() {
  const r = await chamarBling('/produtos?limite=1&pagina=1');
  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  const qtd = ((r.data && r.data.data) || []).length;
  return { ok: true, respondeu: true, produtos_na_pagina: qtd };
}

// ============================================================
// DEPOSITOS + LANCAR ESTOQUE (b20)
// ------------------------------------------------------------
// Porta do fluxo da GOOD (lib/rotas-admin-nf.js):
//   POST /nfe/{id_nf_devolucao}/lancar-estoque/{id_deposito}
// lanca a ENTRADA de estoque daquela NF de devolucao no deposito
// escolhido. Na GOOD os depositos sao fixos no codigo; aqui a
// lista vem VIVA do Bling da AMB (GET /depositos) — os IDs das
// duas empresas sao diferentes e chumbar seria erro na certa.
// ============================================================

let _depCache = { ts: 0, lista: [] };

async function listarDepositos(forcar) {
  if (!forcar && _depCache.ts && (Date.now() - _depCache.ts) < 10 * 60 * 1000) {
    return { ok: true, depositos: _depCache.lista, cache: true };
  }
  const r = await chamarBling('/depositos?limite=100&pagina=1');
  if (!r.ok) return { ok: false, status: r.status, erro: 'Bling nao devolveu os depositos' };
  const lista = ((r.data && r.data.data) || []).map(d => ({
    id: String(d.id),
    descricao: d.descricao || ('deposito ' + d.id),
    padrao: !!d.padrao,
    situacao: d.situacao != null ? d.situacao : null,
  }));
  _depCache = { ts: Date.now(), lista };
  return { ok: true, depositos: lista };
}

/** POST /nfe/{idNf}/lancar-estoque/{idDeposito} — corpo vazio, como na GOOD. */
async function lancarEstoqueNf(idNfDevolucao, idDeposito) {
  const r = await chamarBling(`/nfe/${idNfDevolucao}/lancar-estoque/${idDeposito}`, {
    method: 'POST', data: {},
  });
  if (!r.ok) {
    const e = r.error || r.data || {};
    const detalhe = (e.error && (e.error.description || e.error.message)) ||
      JSON.stringify(e).slice(0, 180);
    return { ok: false, status: r.status, erro: `Bling recusou (HTTP ${r.status}): ${detalhe}` };
  }
  return { ok: true };
}

module.exports = {
  chamarBling,
  renovarToken,
  trocarCodePorToken,
  urlAutorizacao,
  buscarProdutoPorSku,
  buscarPedidoPorId,
  buscarNFePorId,
  testeDeVida,
  temToken: () => !!ACCESS_TOKEN,
  temCredenciais: () => !!(cfg.bling.clientId && cfg.bling.clientSecret),
  listarDepositos, lancarEstoqueNf,
};
