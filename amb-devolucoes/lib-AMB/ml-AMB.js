// ============================================================
// amb-devolucoes/lib-AMB/ml-AMB.js             (AMB Devol. b2)
// ------------------------------------------------------------
// Cliente Mercado Livre — PECA UNICA das tres empresas (b702).
//
// ⚠️ b702 - A GOOD TAMBEM USA ESTA FABRICA. `lib/ml.js` virou um adaptador fino sobre `criar(configDaEmpresa('good'))`
// que preserva a assinatura antiga do server.js. A copia da GOOD (556 linhas) divergia desta nos dois sentidos; o que
// so ela tinha veio pra ca (nivelar por cima): `diagnostico403` (o `ml_403.por_rota` do /health, b691), `definirTokens`
// (o /ml/setup), `buscarNFnoML`, `credenciais`, a preventiva que nao tenta em `remoto`/`bloqueado` (b258 P2) e a
// gravacao do token tambem no nome historico sem prefixo (b250). O que so esta tinha a GOOD ganhou: retry de 429 e
// a regra do 403 por rota ja conhecida sem invalidar o cache (b690 — medido: 118 invalidacoes em 5 min na GOOD).
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
const { PREFIXO_SEM_EMPRESA } = require('../../lib/empresas');   // b662 - nunca ler as envs da AMB por fallback

const axios = require('axios');
// b246 - FASE 3, passo 2: RECEBE a ficha em vez de importar o config.
//
// ⚠️ AQUI TEM ESTADO MUTAVEL, diferente do supabase (passo 1): os tokens
// (`ACCESS_TOKEN`, `REFRESH_TOKEN`), o cache de depositos/naturezas e a
// renovacao em voo vivem em variaveis DO MODULO. Com duas empresas isso
// seria pior que o bug original — uma usaria o token da outra.
//
// Envolver na fabrica move esse estado pra DENTRO de cada instancia, que
// e exatamente o que precisa acontecer.
// ⚠️ b377 - o `config-AMB` fixo SAIU. Ficou so o require, sem uso, depois
// que a instancia padrao foi removida — e require de arquivo da AMB num
// modulo multiempresa e pegadinha esperando alguem usar.

function criarMl(cfg) {
  const { SEM_EMPRESA } = require('../../lib/empresas');   // b661 - nunca cair na AMB
  // ⚠️ b424: a canonica do contrato (`ambtotal`), nao a curta (`amb`).
  const CHAVE_TOKEN = (cfg && cfg.CHAVE_REGISTRO) || SEM_EMPRESA;   // b661: sem empresa = leitor diz 'desconhecida', nao o token da AMB
  // b732 (P2-08, auditoria do Codex 15/11) - "TEM TOKEN LOCAL" NAO E "INTEGRACAO OPERACIONAL". Em politica
  // remota/sombra o access vem do DONO a cada chamada e o local pode nem existir — mas temToken() olhava so o
  // ACCESS_TOKEN local e, com ele vazio, o pre-aquecimento e as telas davam a integracao como desligada.
  // REMOTO_VISTO liga quando o leitor entregou um token do dono; operacional() pergunta ao leitor sem gastar nada.
  let REMOTO_VISTO = false;
  async function operacional() {
    if (ACCESS_TOKEN) return true;
    try {
      const d = await tokenLeitor.resolverToken(CHAVE_TOKEN, 'ml');
      if (d.usar === 'remoto' && d.access) { REMOTO_VISTO = true; return true; }
    } catch (e) { /* leitor fora: nao e operacional agora */ }
    return !!ACCESS_TOKEN;
  }
  // ⚠️ b396 - A ETIQUETA DO LOG DIZ QUAL EMPRESA.
  //
  // Era `[AMB/...]` fixo. O Render junta o log das duas no MESMO
  // lugar: com a Girassol montada, um erro dela apareceria como
  // `[AMB/...]` e mandaria caçar no app errado.
  const TAG_EMP = String((cfg && cfg.PREFIXO_ENV != null) ? (cfg.PREFIXO_ENV || 'GOOD_') : PREFIXO_SEM_EMPRESA)
    .replace(/_$/, '');
const { atualizarTokensNoRender } = require('../../lib/render-tokens');
const { registrarPreventiva } = require('../../lib/token-preventiva');   // b271

// ⚠️ b424 - O LEITOR DE TOKEN REMOTO, igual ao Bling e ao que a GOOD ja faz.
//
// O refresh do ML e de USO UNICO — e este e o que JA nos mordeu hoje: o log
// do dono tinha `403 ... a rota ja renovou nesta janela, nao gasto outro
// refresh (o do ML e de uso unico)`.
//
// 📌 Padrao `sombra`: USA o access que o dono entregar; se o dono falhar, cai no
// token local. Em `remoto` a rede local some. (b689: o comentario dizia "mas usa o
// token local" — o codigo nunca fez isso; ver a nota em bling-AMB.js.)
const tokenLeitor = require('../../lib/token-leitor');
// b272 (review do Codex) - ESTA DECLARACAO VOLTOU. Meu refactor da b271
// apagou o bloco antigo levando junto o `let ultimaPersistencia`, mas a
// funcao de renovar continua ATRIBUINDO a ela. Em modulo strict, isso
// lanca ReferenceError bem depois do marketplace ja ter rotacionado o
// refresh: o token novo nao seria gravado e a integracao morreria.
let ultimaPersistencia = false;

let ACCESS_TOKEN  = cfg.ml.accessToken;
let REFRESH_TOKEN = cfg.ml.refreshToken;
let USER_ID       = cfg.ml.userId;

// b702 (porte de lib/ml.js, b250) - ONDE GRAVAR O TOKEN RENOVADO quando a empresa ainda vive no nome HISTORICO.
//
// A GOOD nasceu com `ML_ACCESS_TOKEN` (sem prefixo) e e lida por fallback (`envDaEmpresa` -> `nomeHistorico`). Se a
// renovacao gravasse so em `GOOD_ML_ACCESS_TOKEN`, o nome antigo ficaria com o refresh JA CONSUMIDO — e qualquer volta
// atras morreria no primeiro restart. Entao, enquanto o nome historico existir no ambiente, grava nos DOIS: o padrao
// (`chaveAccess`) e o antigo. Empresa sem `nomeHistorico` (AMB, Girassol, as proximas) grava so o padrao, como sempre.
const chavesDeGravacao = (chavePadrao, nomeBase) => {
  const chaves = [chavePadrao];
  const antigo = (cfg.ml.nomeHistorico && cfg.ml.nomeHistorico(nomeBase)) || null;
  if (antigo && antigo !== chavePadrao && process.env[antigo] != null && process.env[antigo] !== '') chaves.push(antigo);
  return chaves;
};
// b702 - o NOME da env de carimbo/dias da preventiva: o padrao com prefixo, salvo quando ele nao existe no ambiente e o
// historico sem prefixo existe (a GOOD hoje: `ML_RENOVADO_EM`). Sem isto, a primeira montagem pela fabrica leria
// `GOOD_ML_RENOVADO_EM` vazio, acharia que nunca renovou e gastaria um refresh a toa no primeiro batimento.
const nomeEnvPreventiva = (nomeBase) => {
  const padrao = ((cfg.PREFIXO_ENV != null) ? cfg.PREFIXO_ENV : PREFIXO_SEM_EMPRESA) + nomeBase;
  const antigo = (cfg.ml.nomeHistorico && cfg.ml.nomeHistorico(nomeBase)) || null;
  const tem = (k) => process.env[k] != null && process.env[k] !== '';
  return (antigo && antigo !== padrao && !tem(padrao) && tem(antigo)) ? antigo : padrao;
};
const paresDeToken = () => [
  ...chavesDeGravacao(cfg.ml.chaveAccess, 'ML_ACCESS_TOKEN').map((k) => ({ key: k, value: ACCESS_TOKEN })),
  ...chavesDeGravacao(cfg.ml.chaveRefresh, 'ML_REFRESH_TOKEN').map((k) => ({ key: k, value: REFRESH_TOKEN })),
];

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

  const gravar = paresDeToken();
  if (USER_ID) gravar.push({ key: cfg.ml.chaveUserId, value: USER_ID });
  // b702 (porte de lib/ml.js, b273) - CARIMBA TAMBEM AO AUTORIZAR: logo apos uma reautorizacao o carimbo estaria velho e
  // o proximo batimento consumiria NA HORA o refresh recem-emitido.
  if (PREVENTIVA.parEnvCarimbo()) gravar.push(PREVENTIVA.parEnvCarimbo());
  const persistiu = await atualizarTokensNoRender(gravar);
  if (persistiu) PREVENTIVA.marcarRenovado();
  return { user_id: USER_ID, expira_em_s: r.data.expires_in, escopo: r.data.scope || null, persistiu };
}

/**
 * b702 (porte de lib/ml.js, v3.40/b273/b274) - INJETA tokens ja trocados (o /ml/setup da GOOD troca o code ele
 * mesmo) e persiste no Render, com o carimbo da preventiva. Se a persistencia falhar, NAO quebra: avisa, e os
 * tokens ficam na memoria ate o proximo redeploy. O carimbo so e marcado se persistiu de fato (b274).
 */
async function definirTokens(accessToken, refreshToken) {
  ACCESS_TOKEN = accessToken;
  if (refreshToken) REFRESH_TOKEN = refreshToken;
  try {
    const gravar = paresDeToken();
    if (PREVENTIVA.parEnvCarimbo()) gravar.push(PREVENTIVA.parEnvCarimbo());
    const persistiu = await atualizarTokensNoRender(gravar);
    if (persistiu) PREVENTIVA.marcarRenovado();
    else console.warn(`[${TAG_EMP}/ML] tokens ativos na MEMORIA, mas nao persistidos no Render`);
    return { persistiu: !!persistiu };
  } catch (e) {
    console.warn(`[${TAG_EMP}/ML] tokens ativos na MEMORIA, mas falhou persistir no Render:`, e.message || e);
    return { persistiu: false, erro: e.message || String(e) };
  }
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
  // ⚠️ b424: em `remoto`, renovar aqui invalidaria o que o DONO gravou.
  const polRenov = tokenLeitor.politicaDe(CHAVE_TOKEN, 'ml');
  if (polRenov === 'remoto' || polRenov === 'bloqueado') {
    tokenLeitor.registrarRecusa(CHAVE_TOKEN, 'ml');
    console.warn(`[${TAG_EMP}/ML] renovacao local RECUSADA: o eixo `
      + `${CHAVE_TOKEN}/ml esta em ${polRenov} (o dono e quem renova)`);
    return false;
  }

  if (!REFRESH_TOKEN) {
    console.error(`[${TAG_EMP}/ML] Sem refresh token - autorize pelo ${cfg.PREFIXO_ROTA}/conectar`);
    return false;
  }
  console.log(`[${TAG_EMP}/ML] Renovando access token...`);
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

    const gravar = paresDeToken();
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
    if (!persistiu) console.error(`[${TAG_EMP}/ML] renovou no marketplace mas NAO persistiu no Render — o refresh gravado esta consumido`);
    ultimaPersistencia = !!persistiu;
    // b270 (review do Codex) - QUALQUER renovacao que persistiu conta pro
    // intervalo, nao so a preventiva. Uma renovacao normal (por 401) gravava
    // carimbo novo enquanto o contador em memoria seguia no antigo — e o
    // batimento renovava de novo pouco depois, gastando refresh a toa.
    if (ultimaPersistencia) PREVENTIVA.marcarRenovado();   // b271

    console.log(`[${TAG_EMP}/ML] Token renovado`);
    return true;
  } catch (erro) {
    console.error(`[${TAG_EMP}/ML] ERRO ao renovar:`, (erro.response && erro.response.data) || erro.message);
    return false;
  }
}

/**
 * Chamada base. Retry de 401 (renova) e 429 (espera).
 * Aceita caminho relativo ("/users/me") ou URL inteira.
 */
// b571 - trava do 403 por rota (porte da GOOD)
const ML_ULTIMA_RENOV_POR_ROTA = new Map();
const ML_JANELA_RENOV_MS = 10 * 60 * 1000;
function rotaDe(url) {
  try { return new URL(String(url)).pathname.replace(/\/\d{6,}/g, '/{id}').replace(/\/[A-Z]{2,4}\d{6,}/g, '/{id}'); }
  catch (e) { return String(url).split('?')[0]; }
}
function podeRenovarPor403(url) { return Date.now() - (ML_ULTIMA_RENOV_POR_ROTA.get(rotaDe(url)) || 0) >= ML_JANELA_RENOV_MS; }
function registrarRenovacaoPor403(url) { ML_ULTIMA_RENOV_POR_ROTA.set(rotaDe(url), Date.now()); }

// b702 (porte de lib/ml.js, b691) - QUAL ROTA esta tomando 403 — o padrao da rota, nunca o id.
//
// ⚠️ O /health da GOOD de 14/11 mostrava 1.146 invalidacoes por 403 em 33 min, numa rota so, e o painel nao dizia QUAL.
// `rotaDe()` ja troca os ids por `{id}`: o que sai daqui e `/shipments/{id}/history`, nao o envio de ninguem. No
// maximo 40 padroes guardados (teto pra memoria). Por INSTANCIA: cada empresa conta as suas.
const ML_403_POR_ROTA = new Map();   // padrao da rota -> { vezes, ultima }
function contar403DaRota(url) {
  const rota = rotaDe(url);
  const c = ML_403_POR_ROTA.get(rota) || { vezes: 0, ultima: 0 };
  c.vezes++; c.ultima = Date.now();
  ML_403_POR_ROTA.set(rota, c);
  if (ML_403_POR_ROTA.size > 40) {
    const maisVelha = [...ML_403_POR_ROTA.entries()].sort((a, b) => a[1].ultima - b[1].ultima)[0];
    if (maisVelha) ML_403_POR_ROTA.delete(maisVelha[0]);
  }
}
/** Pro /health — ⚠️ SO CONTAGEM, nunca os ids. */
function diagnostico403() {
  const agora = Date.now();
  let emJanela = 0;
  for (const t of ML_ULTIMA_RENOV_POR_ROTA.values()) if (agora - t < ML_JANELA_RENOV_MS) emJanela++;
  const por_rota = [...ML_403_POR_ROTA.entries()]
    .sort((a, b) => b[1].vezes - a[1].vezes).slice(0, 5)
    .map(([rota, c]) => ({ rota, vezes: c.vezes, ultima_ha_s: Math.round((agora - c.ultima) / 1000) }));
  return {
    rotas_com_403_recente: emJanela,
    por_rota,
    janela_min: ML_JANELA_RENOV_MS / 60000,
    _nota: '403 renova no maximo 1x por rota nesta janela — o refresh do ML e de uso unico e 403 de permissao nao '
      + 'melhora com token novo. Em `por_rota` vai o PADRAO da rota (`/shipments/{id}`), nunca o id de pedido/envio.',
  };
}

async function chamarML(caminho, opcoes = {}) {
  // ⚠️ b424: de onde vem o token desta chamada (ver bling-AMB.js).
  // b693 - DE ONDE VEIO O TOKEN DESTA TENTATIVA (dono x local).
  //
  // ⚠️ O dado (Girassol, 14/11, /health): `girassol/ml: retry falhou 4x (status do retry — 401: 3, 429: 1)`.
  // Sao reclamacoes cujo /returns o ML nega POR REGRA (ml-returns-AMB, licao 4) — nada a ver com token. Mas em
  // `sombra` cada uma custava: derrubar o cache, RENOVAR O TOKEN LOCAL e repetir. E a renovacao local nao
  // servia de nada: o retry rele o token do DONO (que, no ML, confere o token no proprio ML antes de entregar),
  // nao usa o local que acabou de ser renovado. Quatro refresh gastos em 12 min de servico no ar, pra nada.
  // ✅ A regra: se o token RECUSADO veio do dono, o retry vem do dono — em `sombra` tambem, nao so em `remoto`.
  // A renovacao local fica pra quando o token recusado era o LOCAL (dono fora do ar, ou politica `local`).
  let tokenDoDono = false;
  const tokenAgora = async () => {
    const d = await tokenLeitor.resolverToken(CHAVE_TOKEN, 'ml');
    tokenDoDono = d.usar === 'remoto';
    if (d.usar === 'remoto') { REMOTO_VISTO = true; return d.access; }
    if (d.usar === 'falhar') {
      const e = new Error('[token] ' + d.motivo);
      e.semToken = true;
      throw e;
    }
    return ACCESS_TOKEN;
  };
  const url = caminho.startsWith('http') ? caminho : `${cfg.ml.apiBase}${caminho}`;
  // b694: TODA tentativa feita com o token DO DONO avisa o leitor do resultado — aceite (2xx) ou recusa (401/403).
  // E o que separa, no veredito de corte, recusa da rota de problema de token (`anotarAceite` no leitor).
  // O envio e marcado com o token JA resolvido, logo antes de a chamada sair (Codex, #566).
  const fazer = async () => {
    const token = await tokenAgora();
    const doDono = tokenDoDono;
    const envio = tokenLeitor.marcarEnvio();
    let r;
    try {
      r = await axios({
        url,
        method: opcoes.method || 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(opcoes.headers || {}) },
        data: opcoes.data,
        timeout: opcoes.timeout || 30000,
      });
    } catch (e) {
      if (doDono) tokenLeitor.anotarRecusa(CHAVE_TOKEN, 'ml', e.response && e.response.status);
      throw e;
    }
    if (doDono) tokenLeitor.anotarAceite(CHAVE_TOKEN, 'ml', envio);
    return r;
  };

  try {
    const r = await fazer();
    return { ok: true, data: r.data, status: r.status };
  } catch (erro) {
    const status = erro.response && erro.response.status;
    const recusadoEraDoDono = tokenDoDono;   // b693: guarda ANTES do retry (o `fazer()` seguinte reescreve)

    if (status === 401) {
      // ⚠️ b424: invalida o cache do leitor — sem isto, em `remoto` a
      // tentativa seguinte receberia o MESMO token morto.
      tokenLeitor.invalidar(CHAVE_TOKEN, 'ml');
      tokenLeitor.anotarInvalidacao(CHAVE_TOKEN, 'ml', 401);

      // b690 - EM `remoto` O RETRY VEM DO DONO (porte da GOOD: lib/ml.js, b258, Codex P1).
      //
      // A renovacao local e RECUSADA em `remoto` — certo, o dono e quem renova. Mas o retry daqui so
      // acontecia SE ela devolvesse true: em `remoto`, a chamada que descobriu o token vencido morria
      // com "token invalido e refresh falhou - reautorize pelo /conectar", com o dono ja tendo o token
      // novo. E a mensagem mandava reautorizar AQUI, que em `remoto` nao conserta nada.
      // A GOOD tem isto desde setembro; a fabrica — que e o que sobra depois da fusao — nao tinha.
      // O cache ja foi invalidado acima: este `fazer()` rele do dono.
      if (recusadoEraDoDono || tokenLeitor.politicaDe(CHAVE_TOKEN, 'ml') === 'remoto') {   // b693: token do dono recusado -> retry do dono
        try {
          const r = await fazer();
          tokenLeitor.anotarRetry(CHAVE_TOKEN, 'ml', true, 401);
          return { ok: true, data: r.data, status: r.status };
        } catch (e2) {
          tokenLeitor.anotarRetry(CHAVE_TOKEN, 'ml', false, 401, e2.response && e2.response.status);
          return { ok: false, status: e2.response && e2.response.status, error: (e2.response && e2.response.data) || e2.message, semToken: e2.semToken };
        }
      }

      if (await renovarToken()) {
        try {
          const r = await fazer();
          tokenLeitor.anotarRetry(CHAVE_TOKEN, 'ml', true, 401);    // b690: o RESULTADO do retry e a evidencia do corte
          return { ok: true, data: r.data, status: r.status };
        } catch (e2) {
          tokenLeitor.anotarRetry(CHAVE_TOKEN, 'ml', false, 401, e2.response && e2.response.status);
          return { ok: false, status: e2.response && e2.response.status, error: (e2.response && e2.response.data) || e2.message };
        }
      }
      return { ok: false, status: 401, error: `token invalido e refresh falhou - reautorize pelo ${cfg.PREFIXO_ROTA}/conectar` };
    }

    // b571 - porte da GOOD (lib/ml.js): 403 TAMBEM pode ser token vencido. Renova no maximo 1x por ROTA a cada 10 min
    // (o refresh do ML e de uso unico e 403 de permissao nao melhora com token novo); o relogio da rota so anda se o
    // refresh foi de fato gasto.
    if (status === 403) {
      contar403DaRota(url);   // b702 (b691): qual padrao de rota (sem id) esta tomando 403
      if (!podeRenovarPor403(url)) {
        return { ok: false, status: 403, error: (erro.response && erro.response.data) || erro.message, rota_ja_renovou: true };
      }
      tokenLeitor.invalidar(CHAVE_TOKEN, 'ml');
      tokenLeitor.anotarInvalidacao(CHAVE_TOKEN, 'ml', 403);

      // b690 - em `remoto`, o 403 tambem tenta UMA vez com o token relido do dono (o ML responde 403 com
      // token vencido). Se der certo, era token: nada a marcar. Se falhar, e permissao — e ai a ROTA entra
      // na janela de 10 min, pra o proximo 403 dela nao invalidar o cache nem repetir a chamada.
      // ⚠️ De proposito NAO e a regra da GOOD (que invalida e repete em TODO 403): o /health dela mostrou
      // 118 invalidacoes em 5 min numa rota restrita ao comprador. Aqui, 403 por desenho e rotina
      // (`/returns`), e seria uma releitura do dono + uma chamada em dobro a cada um.
      if (recusadoEraDoDono || tokenLeitor.politicaDe(CHAVE_TOKEN, 'ml') === 'remoto') {   // b693: token do dono recusado -> retry do dono
        try {
          const r = await fazer();
          tokenLeitor.anotarRetry(CHAVE_TOKEN, 'ml', true, 403);
          return { ok: true, data: r.data, status: r.status };
        } catch (e2) {
          tokenLeitor.anotarRetry(CHAVE_TOKEN, 'ml', false, 403, e2.response && e2.response.status);
          // so um 403 de NOVO e conclusivo (permissao). Dono fora, rede, 5xx: nao sei — a rota nao e marcada
          // e o proximo 403 dela tenta outra vez.
          if (e2.response && e2.response.status === 403) registrarRenovacaoPor403(url);
          return { ok: false, status: e2.response && e2.response.status, error: (e2.response && e2.response.data) || e2.message, semToken: e2.semToken };
        }
      }

      if (await renovarToken()) {
        registrarRenovacaoPor403(url);
        try {
          const r = await fazer();
          tokenLeitor.anotarRetry(CHAVE_TOKEN, 'ml', true, 403);
          return { ok: true, data: r.data, status: r.status };
        } catch (e2) {
          tokenLeitor.anotarRetry(CHAVE_TOKEN, 'ml', false, 403, e2.response && e2.response.status);
          return { ok: false, status: e2.response && e2.response.status, error: (e2.response && e2.response.data) || e2.message };
        }
      }
      return { ok: false, status: 403, error: (erro.response && erro.response.data) || erro.message };
    }

    if (status === 429) {
      console.log(`[${TAG_EMP}/ML] 429 - aguardando 2s`);
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
    // b702 (porte de lib/ml.js, b258 Codex P1) - PRESERVA O `semToken`: "o dono nao entregou token e a politica e
    // remoto" chegava a quem chamou como erro generico sem status — indistinguivel de falha de rede.
    return { ok: false, status, semToken: erro.semToken || undefined, error: (erro.response && erro.response.data) || erro.message };
  }
}

/** b702 (porte de lib/ml.js) - shipment -> invoice_data (a NF que o ML tem do envio). */
async function buscarNFnoML(shipmentId) {
  return chamarML(`/shipments/${shipmentId}/invoice_data?siteId=MLB`);
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
  // b246 (Fase 3): a empresa e o prefixo saem da FICHA recebida, nao do
  // literal. Com duas instancias, `empresa: 'ambtotal'` fixo faria as duas
  // competirem pelo MESMO carimbo de renovacao — uma renovaria o token e a
  // outra acharia que ja tinha renovado.
  empresa: cfg.CHAVE_REGISTRO || SEM_EMPRESA, integracao: 'ml',   // b661
  // b702 (porte de lib/ml.js, b258 Codex P2) - EM `remoto`/`bloqueado` O PREVENTIVO NEM TENTA. A recusa nao avanca o
  // carimbo, entao o timer voltava a cada hora, levava outra recusa e inflava o contador de recusas — que e
  // justamente o numero que deveria PROVAR que nada mais renova. Telemetria poluida pela propria protecao.
  temRefresh: () => {
    const pol = tokenLeitor.politicaDe(CHAVE_TOKEN, 'ml');
    if (pol === 'remoto' || pol === 'bloqueado') return false;
    return !!REFRESH_TOKEN;
  },
  renovar: () => renovarToken(),
  persistiu: () => ultimaPersistencia,
  carimboEnv: nomeEnvPreventiva('ML_RENOVADO_EM'),   // b702: historico sem prefixo enquanto so ele existir (GOOD)
  diasEnv: nomeEnvPreventiva('ML_RENOVAR_DIAS'),
});
const renovacaoPreventiva = (op) => PREVENTIVA.preventiva(op);
const ligarRenovacaoPreventiva = (op) => PREVENTIVA.ligar(op);

return {
  chamarML,
  urlAutorizacao,
  trocarCodePorToken,
  definirTokens,            // b702
  buscarNFnoML,             // b702
  renovarToken,
  renovacaoPreventiva, ligarRenovacaoPreventiva,   // b264
  preventiva: PREVENTIVA,   // b702 (a GOOD expunha `preventivaML`)
  diagnostico403,           // b702 (b691)
  quemSouEu,
  testeDeVida,
  userId: () => USER_ID,
  temToken: () => !!ACCESS_TOKEN || REMOTO_VISTO,   // b732: operacional (local OU token do dono ja visto)
  operacional,                                       // b732: pergunta ao leitor (async) — pro pre-aquecimento no boot
  temCredenciais: () => !!(cfg.ml.clientId && cfg.ml.clientSecret),
  credenciais: () => ({ clientId: cfg.ml.clientId, clientSecret: cfg.ml.clientSecret }),   // b702 (o /ml/setup)
};
}

// b246: o objeto pronto da AMB continua sendo o export padrao (nada muda
// pra quem ja usa — sao 6 pontos), e a fabrica fica em `.criar`.
// ⚠️ b377 - A INSTANCIA PRONTA SAIU (era a ultima forma de vazamento).
//
// Era `criarMl(configAMB)` — criada NO REQUIRE com o `config-AMB` fixo.
// Quem esquecesse o `.criar()` pegava o cliente DA AMBTOTAL sem nada
// avisar, e isso nao aparecia em busca por env nem por tabela.
//
// 📌 Ninguem mais a consome: o app usa `.criar(CFG_EMPRESA)`.
module.exports = { criar: criarMl };
