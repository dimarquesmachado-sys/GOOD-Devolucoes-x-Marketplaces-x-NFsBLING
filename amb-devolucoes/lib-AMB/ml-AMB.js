// ============================================================
// amb-devolucoes/lib-AMB/ml-AMB.js             (AMB Devol. b2)
// ------------------------------------------------------------
// Cliente Mercado Livre da AMBTotal.
//
// O access token do ML dura ~6 HORAS (o do Bling dura mais).
// Por isso o refresh automatico aqui nao e luxo: sem ele, o
// sistema para de funcionar sozinho no meio do expediente.
//
// DETALHE UTIL: a resposta do /oauth/token do ML JA TRAZ o
// user_id. Ou seja, na hora que voce autoriza, o AMB_ML_USER_ID
// e descoberto e gravado sozinho — voce nao precisa procurar
// esse numero em lugar nenhum.
// ============================================================

'use strict';

const axios = require('axios');
const cfg = require('../config-AMB');
const { atualizarTokensNoRender } = require('./render-tokens-AMB');
const { registrarPreventiva } = require('../../lib/token-preventiva');   // b271

let ACCESS_TOKEN  = cfg.ml.accessToken;
let REFRESH_TOKEN = cfg.ml.refreshToken;
let USER_ID       = cfg.ml.userId;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * URL que o vendedor abre pra autorizar.
 * O redirect_uri tem que ser IDENTICO ao cadastrado no app.
 */
function urlAutorizacao(state, redirectUri) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.ml.clientId,
    redirect_uri: redirectUri,
    state: state || '',
  });
  return `https://auth.mercadolivre.com.br/authorization?${p.toString()}`;
}

/**
 * Troca o code por tokens. Grava access, refresh e user_id.
 * O code do ML tambem e de vida curta — por isso o callback
 * automatico existe: ele troca em milissegundos.
 */
async function trocarCodePorToken(code, redirectUri) {
  const r = await axios.post(
    `${cfg.ml.apiBase}/oauth/token`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.ml.clientId,
      client_secret: cfg.ml.clientSecret,
      code,
      redirect_uri: redirectUri,
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      timeout: 20000,
    }
  );

  ACCESS_TOKEN = r.data.access_token;
  if (r.data.refresh_token) REFRESH_TOKEN = r.data.refresh_token;
  if (r.data.user_id) USER_ID = String(r.data.user_id);

  const gravar = [
    { key: cfg.ml.chaveAccess,  value: ACCESS_TOKEN },
    { key: cfg.ml.chaveRefresh, value: REFRESH_TOKEN },
  ];
  if (USER_ID) gravar.push({ key: cfg.ml.chaveUserId, value: USER_ID });

  const persistiu = await atualizarTokensNoRender(gravar);
  return { user_id: USER_ID, expira_em_s: r.data.expires_in, escopo: r.data.scope || null, persistiu };
}

// b267 (review do Codex) - UMA renovacao por vez NESTA integracao. Serializar
// as escritas no Render nao resolve isto: o batimento da preventiva e um 401
// normal podem chamar a renovacao ao mesmo tempo, com o MESMO refresh de uso
// unico — a segunda chamada falha e, pior, pode gravar por cima. Agora quem
// chega depois espera o resultado da que ja esta rodando.
let renovacaoEmVooML = null;

async function renovarToken() {
  if (renovacaoEmVooML) return renovacaoEmVooML;      // b267 - pega carona
  renovacaoEmVooML = (async () => { try { return await renovarTokenInterno(); } finally { renovacaoEmVooML = null; } })();
  return renovacaoEmVooML;
}

async function renovarTokenInterno() {

  if (!REFRESH_TOKEN) {
    console.error('[AMB/ML] Sem refresh token - autorize pelo /amb/conectar');
    return false;
  }
  console.log('[AMB/ML] Renovando access token...');
  try {
    const r = await axios.post(
      `${cfg.ml.apiBase}/oauth/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: cfg.ml.clientId,
        client_secret: cfg.ml.clientSecret,
        refresh_token: REFRESH_TOKEN,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        timeout: 20000,
      }
    );
    ACCESS_TOKEN = r.data.access_token;
    if (r.data.refresh_token) REFRESH_TOKEN = r.data.refresh_token;
    if (r.data.user_id) USER_ID = String(r.data.user_id);

    const gravar = [
      { key: cfg.ml.chaveAccess,  value: ACCESS_TOKEN },
      { key: cfg.ml.chaveRefresh, value: REFRESH_TOKEN },
    ];
    if (USER_ID) gravar.push({ key: cfg.ml.chaveUserId, value: USER_ID });
    // b269 - CARIMBO DA RENOVACAO, no MESMO write (zero escrita a mais).
    // Sem ele, `ultimaPreventiva` so vivia em memoria: todo restart zerava o
    // ciclo e um dia de varios deploys disparava varias renovacoes seguidas
    // de um refresh de USO UNICO. Agora o intervalo sobrevive ao restart.
    if (PREVENTIVA.parEnvCarimbo()) gravar.push(PREVENTIVA.parEnvCarimbo());   // b271
    // b266 (review do Codex) - a renovacao so vale se o refresh NOVO ficou
    // guardado. Se o marketplace aceitou mas o Render falhou, a env ainda
    // tem o refresh JA CONSUMIDO: no proximo restart o token estaria morto.
    const persistiu = await atualizarTokensNoRender(gravar);
    if (!persistiu) console.error('[AMB/ML] renovou no marketplace mas NAO persistiu no Render — o refresh gravado esta consumido');
    ultimaPersistencia = !!persistiu;
    // b270 (review do Codex) - QUALQUER renovacao que persistiu conta pro
    // intervalo, nao so a preventiva. Uma renovacao normal (por 401) gravava
    // carimbo novo enquanto o contador em memoria seguia no antigo — e o
    // batimento renovava de novo pouco depois, gastando refresh a toa.
    if (ultimaPersistencia) PREVENTIVA.marcarRenovado();   // b271

    console.log('[AMB/ML] Token renovado');
    return true;
  } catch (erro) {
    console.error('[AMB/ML] ERRO ao renovar:', (erro.response && erro.response.data) || erro.message);
    return false;
  }
}

/**
 * Chamada base. Retry de 401 (renova) e 429 (espera).
 * Aceita caminho relativo ("/users/me") ou URL inteira.
 */
async function chamarML(caminho, opcoes = {}) {
  const url = caminho.startsWith('http') ? caminho : `${cfg.ml.apiBase}${caminho}`;
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
      return { ok: false, status: 401, error: 'token invalido e refresh falhou - reautorize pelo /amb/conectar' };
    }

    if (status === 429) {
      console.log('[AMB/ML] 429 - aguardando 2s');
      await sleep(2000);
      try {
        const r = await fazer();
        return { ok: true, data: r.data, status: r.status };
      } catch (e2) {
        return { ok: false, status: e2.response && e2.response.status, error: (e2.response && e2.response.data) || e2.message };
      }
    }

    // 403 no /returns e NORMAL: o ML nao libera esse recurso pra
    // todo mundo. Quem chama trata como "sem acesso por design".
    return { ok: false, status, error: (erro.response && erro.response.data) || erro.message };
  }
}

/** Quem sou eu — confirma a conta e devolve o user_id. */
async function quemSouEu() {
  const r = await chamarML('/users/me');
  if (!r.ok) return r;
  const d = r.data || {};
  if (d.id && !USER_ID) {
    USER_ID = String(d.id);
    await atualizarTokensNoRender([{ key: cfg.ml.chaveUserId, value: USER_ID }]);
  }
  return {
    ok: true,
    user_id: d.id,
    apelido: d.nickname,
    email: d.email,
    tipo: d.user_type,
    site: d.site_id,
  };
}

/** Teste de vida: confirma token valido e conta correta. */
async function testeDeVida() {
  const eu = await quemSouEu();
  if (!eu.ok) return { ok: false, status: eu.status, error: eu.error };
  return { ok: true, conta: eu.apelido, user_id: eu.user_id, site: eu.site };
}

// b271 - RENOVACAO PREVENTIVA pela LIB UNICA (lib/token-preventiva.js).
// Antes cada modulo tinha sua copia deste mecanismo — e cada correcao da
// review precisava ser repetida em tres arquivos. Agora a peca e uma so, com
// a EMPRESA como parametro: integracao nova (ou empresa nova) = um registro
// como este, zero logica duplicada.
const PREVENTIVA = registrarPreventiva({
  empresa: 'ambtotal', integracao: 'ml',
  temRefresh: () => !!REFRESH_TOKEN,
  renovar: () => renovarToken(),
  persistiu: () => ultimaPersistencia,
  carimboEnv: 'AMB_ML_RENOVADO_EM',
  diasEnv: 'AMB_ML_RENOVAR_DIAS',
});
const renovacaoPreventiva = (op) => PREVENTIVA.preventiva(op);
const ligarRenovacaoPreventiva = (op) => PREVENTIVA.ligar(op);

module.exports = {
  chamarML,
  urlAutorizacao,
  trocarCodePorToken,
  renovarToken,
  renovacaoPreventiva, ligarRenovacaoPreventiva,   // b264
  quemSouEu,
  testeDeVida,
  userId: () => USER_ID,
  temToken: () => !!ACCESS_TOKEN,
  temCredenciais: () => !!(cfg.ml.clientId && cfg.ml.clientSecret),
};
