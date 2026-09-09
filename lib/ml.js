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
// b252 - PASSO 2: le o token do DONO. ⚠️ No ML isto e o mais urgente — o
// refresh e de USO UNICO, e a corrida esta ativa hoje.
const tokenLeitor = require('./token-leitor');

// b250.1 (Codex, P1) - MEU PASSO 1 NAO FUNCIONAVA. Eu tinha posto o leitor
// de dois nomes no REGISTRO — mas a GOOD nao le por ele: o server.js usa
// ESTE modulo, que lia `process.env.ML_*` direto. Criar as vars novas
// no Render nao teria efeito nenhum, e ele acharia que tinha migrado.
//
// A migracao acontece AQUI. `GOOD_` primeiro, historico depois:
//   1. (agora) le os dois — nada quebra, as antigas seguem valendo
//   2. ele cria as `GOOD_*` no Render copiando os valores
//   3. quando confirmar, o fallback sai e sobra so o padrao
const envGood = (nome) => {
  const novo = process.env['GOOD_' + nome];
  if (novo != null && novo !== '') return novo;
  return process.env[nome];   // historico: a GOOD nasceu sem prefixo
};

// ⚠️ ONDE GRAVAR O TOKEN RENOVADO — a parte perigosa da migracao.
//
// O token e persistido de volta no Render a cada renovacao. Se eu gravasse
// so no nome NOVO agora, na primeira renovacao o `ML_ACCESS_TOKEN`
// antigo ficaria velho — e voltar atras deixaria de ser possivel.
//
// Entao durante a migracao grava nos DOIS: o que o codigo le hoje continua
// certo, e o novo ja nasce atualizado. No passo 3, quando o fallback sair,
// some o antigo daqui.
const chavesToken = (nome) => (
  process.env['GOOD_' + nome] != null && process.env['GOOD_' + nome] !== ''
    ? ['GOOD_' + nome, nome]     // ja migrou: mantem os dois em dia
    : [nome]                     // ainda nao: so o historico
);
// b271 - RENOVACAO PREVENTIVA pela lib unica (empresa como parametro).
// O refresh do ML vale 6 meses e e de uso unico: modulo parado esse tempo =
// so volta reautorizando a mao.
const { registrarPreventiva } = require('./token-preventiva');
let renovarTokenML = null;   // b272 - definida abaixo, envolvida pelo lock
let ULTIMA_PERSISTENCIA = false;
let PREVENTIVA = null;

const ML_CLIENT_ID = envGood('ML_CLIENT_ID');
const ML_CLIENT_SECRET = envGood('ML_CLIENT_SECRET');
let ML_ACCESS_TOKEN = envGood('ML_ACCESS_TOKEN');
let ML_REFRESH_TOKEN = envGood('ML_REFRESH_TOKEN');

async function renovarTokenMLInterno() {
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
    // b271 - o carimbo da renovacao vai NO MESMO write (zero escrita extra):
    // e ele que faz o intervalo sobreviver ao restart.
    const gravar = [
      ...chavesToken('ML_ACCESS_TOKEN').map(k => ({ key: k, value: ML_ACCESS_TOKEN })),
      ...chavesToken('ML_REFRESH_TOKEN').map(k => ({ key: k, value: ML_REFRESH_TOKEN })),
    ];
    const carimbo = PREVENTIVA && PREVENTIVA.parEnvCarimbo();
    if (carimbo) gravar.push(carimbo);
    const persistiu = await atualizarTokensNoRender(gravar);
    if (!persistiu) console.error('[ML] renovou mas NAO persistiu no Render — o refresh gravado esta consumido');
    // qualquer renovacao que gravou conta pro intervalo, nao so a preventiva
    if (persistiu && PREVENTIVA) PREVENTIVA.marcarRenovado();
    ULTIMA_PERSISTENCIA = !!persistiu;
    return true;
  } catch (error) {
    console.error('[ML] ERRO renovar:', error.response?.data || error.message);
    return false;
  }
}

async function chamarML(url, headersExtras = {}) {
  // b252 - o token do DONO tem preferencia; o local e a REDE.
  //
  // ⚠️ Este e o eixo urgente: o refresh do ML e de USO UNICO, entao
  // enquanto os dois servicos renovam, um consome o do outro. Ler daqui e
  // o primeiro passo pra matar a corrida (o corte vem depois, ML primeiro).
  //
  // Nao lanca: se o dono estiver fora, seguimos com o token local.
  const doDonoML = await tokenLeitor.lerToken('good', 'ml');
  const tokenUsadoML = doDonoML || ML_ACCESS_TOKEN;

  const fazer = () => axios.get(url, {
    headers: { Authorization: `Bearer ${tokenUsadoML}`, ...headersExtras },
  });
  try {
    const r = await fazer();
    return { ok: true, data: r.data, status: r.status };
  } catch (error) {
    // v3.40: o ML as vezes responde 403 (nao 401) com token vencido -
    // o refresh tem que disparar nos DOIS casos, senao fica 403 eterno.
    const st = error.response?.status;
    if (st === 401 || st === 403) {
      // b252 - ⚠️ INVALIDA NOS DOIS STATUS, nao so no 401.
      //
      // O contrato com o dono diz "invalidar no primeiro 401" — mas o
      // codigo daqui ja sabe algo que o contrato nao previu: o ML responde
      // 403 com token vencido (v3.40, comentario acima). Invalidar so no
      // 401 deixaria o token morto no cache por 5 min em todo caso de 403.
      //
      // Vou avisar o dono disso: o contrato de leitura deles diz 401, e a
      // realidade do ML tem os dois.
      tokenLeitor.invalidar('good', 'ml');

      // ⚠️ a renovacao local CONTINUA como rede ate o corte
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
// v3.40.1: se a persistencia falhar (RENDER_API_KEY/SERVICE_ID ausentes -
// os nomes com sufixo _v2 tambem sao aceitos pelo render-tokens),
// NAO quebra - avisa. Tokens ficam na memoria ate o proximo redeploy.
async function definirTokensML(accessToken, refreshToken) {
  ML_ACCESS_TOKEN = accessToken;
  ML_REFRESH_TOKEN = refreshToken;
  try {
    // b273 (review do Codex) - CARIMBA TAMBEM AO AUTORIZAR. Sem isto, logo
    // apos uma reautorizacao (o caso tipico de recuperacao) o carimbo estaria
    // ausente ou velho, e o proximo batimento consumiria NA HORA o refresh
    // recem-emitido — trocando de novo um token que acabou de nascer.
    const gravar = [
      ...chavesToken('ML_ACCESS_TOKEN').map(k => ({ key: k, value: ML_ACCESS_TOKEN })),
      ...chavesToken('ML_REFRESH_TOKEN').map(k => ({ key: k, value: ML_REFRESH_TOKEN })),
    ];
    const carimbo = PREVENTIVA && PREVENTIVA.parEnvCarimbo();
    if (carimbo) gravar.push(carimbo);
    // b274 (review do Codex) - o helper devolve FALSE (sem lancar) quando
    // faltam credenciais do Render, quando a protecao anti-wipe recusa ou
    // quando a API falha. Marcar o carimbo nesses casos anunciaria uma
    // persistencia que nao houve, e o token so viveria em memoria.
    const persistiuAuth = await atualizarTokensNoRender(gravar);
    if (persistiuAuth && PREVENTIVA) PREVENTIVA.marcarRenovado();
    if (!persistiuAuth) console.warn('[ML] tokens ativos na MEMORIA, mas nao persistidos no Render');
    return { persistiu: !!persistiuAuth };
  } catch (e) {
    console.warn('[ML] tokens ativos na MEMORIA, mas falhou persistir no Render:', e.message || e);
    return { persistiu: false, erro: e.message || String(e) };
  }
}

PREVENTIVA = registrarPreventiva({
  empresa: 'good', integracao: 'ml',
  temRefresh: () => !!ML_REFRESH_TOKEN,
  renovar: () => renovarTokenML(),
  persistiu: () => ULTIMA_PERSISTENCIA,
  carimboEnv: 'ML_RENOVADO_EM',
  diasEnv: 'ML_RENOVAR_DIAS',
});
// b272 (review do Codex) - o caminho normal (401) passa a usar O MESMO lock
// da preventiva: sem isto, o batimento e um 401 podiam mandar o MESMO
// refresh de uso unico ao mesmo tempo, e um dos dois falharia.
renovarTokenML = PREVENTIVA.guardarRenovacao(renovarTokenMLInterno);

module.exports = {
  preventivaML: PREVENTIVA,   // b271
  chamarML,
  renovarTokenML,
  buscarNFnoML,
  definirTokensML,
  getClientML: () => ({ clientId: ML_CLIENT_ID, clientSecret: ML_CLIENT_SECRET }),
  hasToken: () => !!ML_ACCESS_TOKEN,
};
