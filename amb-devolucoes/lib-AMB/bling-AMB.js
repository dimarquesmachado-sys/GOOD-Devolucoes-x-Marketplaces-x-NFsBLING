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
// b246 - FASE 3, passo 2: RECEBE a ficha em vez de importar o config.
//
// ⚠️ AQUI TEM ESTADO MUTAVEL, diferente do supabase (passo 1): os tokens
// (`ACCESS_TOKEN`, `REFRESH_TOKEN`), o cache de depositos/naturezas e a
// renovacao em voo vivem em variaveis DO MODULO. Com duas empresas isso
// seria pior que o bug original — uma usaria o token da outra.
//
// Envolver na fabrica move esse estado pra DENTRO de cada instancia, que
// e exatamente o que precisa acontecer.
const configAMB = require('../config-AMB');

function criarBling(cfg) {
const { atualizarTokensNoRender } = require('../../lib/render-tokens');
const { registrarPreventiva } = require('../../lib/token-preventiva');   // b271
// b272 (review do Codex) - ESTA DECLARACAO VOLTOU. Meu refactor da b271
// apagou o bloco antigo levando junto o `let ultimaPersistenciaBling`, mas a
// funcao de renovar continua ATRIBUINDO a ela. Em modulo strict, isso
// lanca ReferenceError bem depois do marketplace ja ter rotacionado o
// refresh: o token novo nao seria gravado e a integracao morreria.
let ultimaPersistenciaBling = false;

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
      ...(PREVENTIVA.parEnvCarimbo() ? [PREVENTIVA.parEnvCarimbo()] : []),   // b271
    ]));
    if (!ultimaPersistenciaBling) console.error('[AMB/Bling] renovou mas NAO persistiu no Render — refresh gravado esta consumido');
    // b270 (review do Codex) - QUALQUER renovacao que persistiu conta pro
    // intervalo, nao so a preventiva. Uma renovacao normal (por 401) gravava
    // carimbo novo enquanto o contador em memoria seguia no antigo — e o
    // batimento renovava de novo pouco depois, gastando refresh a toa.
    if (ultimaPersistenciaBling) PREVENTIVA.marcarRenovado();   // b271
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

// ═══════════════════════════════════════════════════════════════════
// b283 - IDS FISCAIS DA EMPRESA (regra dele: "se tem alguma forma de API
// pegar isso, otimo. senao vai na unha manual mesmo").
//
// A sonda da b282 respondeu, rodando no Bling da AMB:
//   GET /naturezas-operacoes  -> 200, 22 itens, e la esta
//                                "Devolucao de Mercadoria - Entrada" (15110128838)
//   GET /depositos            -> 200, mas SEM o campo idEmpresa
//   GET /empresas             -> 404, nao existe na v3
//
// Entao: a NATUREZA vem da API, achada pelo NOME (como fazemos com o
// deposito DEFEITOS). O ID DA EMPRESA nao tem API — fica em env POR
// EMPRESA (AMB_ID_EMPRESA_CONTROL), com o valor de hoje como padrao. Sai do
// meio do codigo e passa a ser trocavel sem deploy, que era o ponto.
// ═══════════════════════════════════════════════════════════════════
let _natCache = { ts: 0, lista: [] };

async function listarNaturezas(forcar) {
  if (!forcar && _natCache.ts && (Date.now() - _natCache.ts) < 30 * 60 * 1000) {
    return { ok: true, naturezas: _natCache.lista, cache: true };
  }
  const r = await chamarBling('/naturezas-operacoes?limite=100&pagina=1');
  if (!r.ok) return { ok: false, status: r.status, erro: 'Bling nao devolveu as naturezas de operacao' };
  const lista = ((r.data && r.data.data) || []).map(n => ({
    id: String(n.id),
    descricao: n.descricao || ('natureza ' + n.id),
    padrao: n.padrao != null ? n.padrao : null,
  }));
  _natCache = { ts: Date.now(), lista };
  return { ok: true, naturezas: lista };
}

/** Acha a natureza de DEVOLUCAO DE ENTRADA desta empresa. Ordem: env de
 *  override -> nome exato -> nome aproximado. Sem achar, devolve null: quem
 *  chama recusa, em vez de emitir nota com natureza adivinhada. */
async function naturezaDevolucaoEntrada() {
  const forcado = String(process.env.AMB_ID_NATUREZA_DEVOLUCAO_ENTRADA || '').trim();
  if (forcado) return { ok: true, id: forcado, via: 'env' };
  const r = await listarNaturezas(false);
  if (!r.ok) return { ok: false, erro: r.erro || 'nao consegui listar as naturezas' };
  // b296 (review do Codex) - normaliza tambem o ESPACO. Sem isso, uma
  // duplicata que difere so por espaco (extra no meio, sobrando na ponta)
  // NAO casava como igual: `exatas` ficava com uma linha so e o retorno
  // antecipado escolhia a canonica, driblando justamente a regra de
  // "ambiguidade nao escolhe" que este trecho existe pra garantir.
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  // b285 (review do Codex) - a mesma regra do aproximado vale AQUI: se o
  // catalogo tiver duas naturezas com o MESMO nome (duplicata ou variacao
  // com espaco/acento que normaliza igual), `.find()` pegaria a primeira e
  // diria `ok: true`. Coerencia: um unico casamento serve, mais de um recusa.
  const exatas = r.naturezas.filter(n => norm(n.descricao) === 'devolucao de mercadoria - entrada');
  if (exatas.length === 1) {
    return { ok: true, id: exatas[0].id, descricao: exatas[0].descricao, via: 'api_nome_exato' };
  }
  if (exatas.length > 1) {
    return {
      ok: false,
      erro: 'ha mais de uma natureza com o nome "Devolucao de Mercadoria - Entrada" nesta empresa — defina AMB_ID_NATUREZA_DEVOLUCAO_ENTRADA pra escolher',
      candidatos: exatas.slice(0, 5).map(n => ({ id: n.id, descricao: n.descricao })),
    };
  }
  // b284 (review do Codex) - AMBIGUIDADE NAO ESCOLHE. Com `.find()`, se o
  // catalogo tivesse duas naturezas parecidas ("Devolucao de venda -
  // entrada", "Devolucao de remessa - entrada"), eu pegaria a que a API
  // devolvesse primeiro e diria `ok: true` — a nota sairia com natureza
  // fiscal errada e o `natureza_via` so serviria pra auditar o estrago
  // depois. Mesmo criterio que ja usamos no de-para de SKU: um unico
  // candidato serve; mais de um, recusa e pede a env.
  const candidatos = r.naturezas.filter(n =>
    /devolu/.test(norm(n.descricao)) && /entrada/.test(norm(n.descricao)) && !/compra/.test(norm(n.descricao)));
  if (candidatos.length === 1) {
    return { ok: true, id: candidatos[0].id, descricao: candidatos[0].descricao, via: 'api_nome_aproximado' };
  }
  if (candidatos.length > 1) {
    return {
      ok: false,
      erro: 'mais de uma natureza de "devolucao ... entrada" nesta empresa — defina AMB_ID_NATUREZA_DEVOLUCAO_ENTRADA pra escolher',
      candidatos: candidatos.slice(0, 5).map(n => ({ id: n.id, descricao: n.descricao })),
    };
  }
  return { ok: false, erro: 'nenhuma natureza de "devolucao ... entrada" encontrada nesta empresa' };
}

/** Os dois ids que o painel precisa pra emitir a NF de devolucao. */
async function idsFiscais() {
  const empresa = String(process.env.AMB_ID_EMPRESA_CONTROL || '14901993834').trim();
  const nat = await naturezaDevolucaoEntrada();
  return {
    ok: !!(empresa && nat.ok),
    idEmpresaControl: empresa || null,
    empresa_via: process.env.AMB_ID_EMPRESA_CONTROL ? 'env' : 'padrao_do_codigo',
    idNaturezaOperacao: nat.ok ? nat.id : null,
    natureza_via: nat.via || null,
    natureza_descricao: nat.descricao || null,
    erro: nat.ok ? null : nat.erro,
  };
}

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
  empresa: cfg.CHAVE_REGISTRO || 'ambtotal', integracao: 'bling',
  temRefresh: () => !!REFRESH_TOKEN,
  renovar: () => renovarToken(),
  persistiu: () => ultimaPersistenciaBling,
  carimboEnv: (cfg.PREFIXO_ENV || 'AMB_') + 'BLING_RENOVADO_EM',
  diasEnv: (cfg.PREFIXO_ENV || 'AMB_') + 'BLING_RENOVAR_DIAS',
});
const renovacaoPreventiva = (op) => PREVENTIVA.preventiva(op);
const ligarRenovacaoPreventiva = (op) => PREVENTIVA.ligar(op);

return {
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
  listarNaturezas, naturezaDevolucaoEntrada, idsFiscais,   // b283
};
}

// b246: o objeto pronto da AMB continua sendo o export padrao (nada muda
// pra quem ja usa — sao 6 pontos), e a fabrica fica em `.criar`.
module.exports = criarBling(configAMB);
module.exports.criar = criarBling;
