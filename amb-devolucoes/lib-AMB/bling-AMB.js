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

// b267 (review do Codex) - UMA renovacao por vez NESTA integracao. Serializar
// as escritas no Render nao resolve isto: o batimento da preventiva e um 401
// normal podem chamar a renovacao ao mesmo tempo, com o MESMO refresh de uso
// unico — a segunda chamada falha e, pior, pode gravar por cima. Agora quem
// chega depois espera o resultado da que ja esta rodando.
let renovacaoEmVooBling = null;

async function renovarToken() {
  if (renovacaoEmVooBling) return renovacaoEmVooBling;      // b267 - pega carona
  renovacaoEmVooBling = (async () => { try { return await renovarTokenInterno(); } finally { renovacaoEmVooBling = null; } })();
  return renovacaoEmVooBling;
}

async function renovarTokenInterno() {

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
    // b266 (review do Codex) - renovacao so vale com o refresh NOVO guardado
    ultimaPersistenciaBling = !!(await atualizarTokensNoRender([
      { key: cfg.bling.chaveAccess,  value: ACCESS_TOKEN },
      { key: cfg.bling.chaveRefresh, value: REFRESH_TOKEN },
      // b269 - carimbo no MESMO write: intervalo sobrevive ao restart
      { key: 'AMB_BLING_RENOVADO_EM', value: String(Date.now()) },
    ]));
    if (!ultimaPersistenciaBling) console.error('[AMB/Bling] renovou mas NAO persistiu no Render — refresh gravado esta consumido');
    // b270 (review do Codex) - QUALQUER renovacao que persistiu conta pro
    // intervalo, nao so a preventiva. Uma renovacao normal (por 401) gravava
    // carimbo novo enquanto o contador em memoria seguia no antigo — e o
    // batimento renovava de novo pouco depois, gastando refresh a toa.
    if (ultimaPersistenciaBling) ultimaPreventivaBli = Date.now();
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

    // b187 (review do Codex no PR da GOOD) - quem tem PRAZO proprio pede
    // `semRetentativa`: sem isso o 401/429 dorme 1,5s e dispara OUTRA
    // requisicao depois que o chamador ja desistiu (trabalho orfao, fora
    // da cadencia global).
    if (opcoes.semRetentativa) {
      return { ok: false, status, error: (erro.response && erro.response.data) || erro.message };
    }

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
// b270 (review do Codex) - carimbo VALIDADO: `Number(...) || 0` aceitava
// `Infinity` ou data no futuro, e ai `Date.now() - carimbo` fica negativo,
// o intervalo nunca vence e a renovacao NUNCA MAIS acontece. So aceito
// numero finito, positivo e nao futuro.
let ultimaPreventivaBli = (() => {
  const t = Number(process.env.AMB_BLING_RENOVADO_EM);
  return (Number.isFinite(t) && t > 0 && t <= Date.now()) ? t : 0;
})();   // b269
let ultimaPersistenciaBling = false;   // b266

async function renovacaoPreventiva({ forcar = false } = {}) {
  // b267 (review do Codex) - valor invalido (texto, 0, negativo, Infinity)
  // fazia o intervalo virar NaN/0 e o batimento de 1h renovar TODA HORA um
  // refresh de uso unico; Infinity travava a preventiva pra sempre. Agora
  // qualquer coisa fora de 1..180 cai no padrao de 7 dias.
  const diasEnv = Number(process.env.AMB_BLING_RENOVAR_DIAS);
  const DIAS = (Number.isFinite(diasEnv) && diasEnv >= 1 && diasEnv <= 180) ? diasEnv : 7;
  const intervalo = DIAS * 24 * 60 * 60 * 1000;
  if (!forcar && ultimaPreventivaBli && (Date.now() - ultimaPreventivaBli) < intervalo) {
    return { ok: true, pulou: true, proxima_em_dias: Math.max(0, Math.round((intervalo - (Date.now() - ultimaPreventivaBli)) / 86400000)) };
  }
  if (!REFRESH_TOKEN) return { ok: false, erro: 'sem refresh token - autorize pelo /amb/conectar' };
  ultimaPersistenciaBling = false;
  let okRenovou = false;
  try { okRenovou = !!(await renovarToken()); } catch (e) { okRenovou = false; }
  // b266 - ciclo so conta como cumprido se persistiu
  if (okRenovou && ultimaPersistenciaBling) ultimaPreventivaBli = Date.now();
  return { ok: okRenovou && ultimaPersistenciaBling, renovado: okRenovou, persistiu: ultimaPersistenciaBling, dias: DIAS };
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
    // b270 (review do Codex) - SEM `forcar` aqui. Forcando, o primeiro timer
    // ignorava o carimbo restaurado e renovava em todo restart — anulando
    // justamente o que a b269 veio corrigir. Quem precisa forcar e a rota
    // manual (?forcar=1), nao o boot.
    renovacaoPreventiva().catch(() => {});
    const bat = setInterval(() => { renovacaoPreventiva().catch(() => {}); }, UMA_HORA);
    if (bat.unref) bat.unref();
  }, 15 * 60 * 1000);
  if (primeiro.unref) primeiro.unref();
  console.log('[AMB/Bling] renovacao preventiva ligada: a cada ' + Number(process.env.AMB_BLING_RENOVAR_DIAS || 7) + ' dia(s)');
}

module.exports = {
  chamarBling,
  renovacaoPreventiva, ligarRenovacaoPreventiva,   // b265
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
