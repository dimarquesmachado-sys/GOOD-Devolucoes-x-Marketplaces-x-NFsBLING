// ============================================================
// amb-devolucoes/config-AMB.js            (AMB Devolucoes b1)
// ------------------------------------------------------------
// Config unica da AMBTotal. TUDO que e credencial, nome de env
// var, prefixo de rota ou caminho vive AQUI e em nenhum outro
// lugar.
//
// POR QUE ASSIM: no dia em que este modulo mudar de servico
// (consolidacao no Mover-Pedidos), so este arquivo precisa ser
// olhado. Nenhuma URL fixa, nenhum client_id espalhado.
//
// Convencao de env var: TUDO da AMB leva prefixo AMB_.
// As da GOOD (BLING_CLIENT_ID, ML_CLIENT_ID, SUPABASE_URL...)
// sao SEM prefixo e nao podem ser tocadas.
// ============================================================

'use strict';

const EMPRESA = 'amb';
// b242 - FASE 1 DO PLUGAR-EMPRESA-NOVA: le do REGISTRO, nao do ambiente.
//
// `lib/empresas.js` existe desde 27/08 (322 linhas, revisado pelo Codex) e
// NINGUEM importava — peca pronta parada. A Fase 0 (criar o registro)
// estava feita; a Fase 1 (o codigo ler dele) nunca comecou.
//
// Isto NAO muda comportamento: `envDaEmpresa` monta o MESMO nome de
// variavel (`AMB_` + chave) e le o mesmo `process.env`. O que muda e de
// ONDE vem o prefixo — do registro, em vez de escrito a mao 22 vezes.
// Empresa nova passa a ser uma entrada la.
//
// ⚠️ `EMPRESA` (acima) ja existe e e EXPORTADO — e a chave curta 'amb' que
// o resto do modulo usa. Nao mexo nela; a ficha do registro fica em `FICHA`.
const { obterEmpresa, envDaEmpresa } = require('../lib/empresas');
const FICHA = obterEmpresa('ambtotal');
const env = (nome, padrao) => envDaEmpresa(FICHA, nome, padrao);

const NOME_EMPRESA = 'AMBTotal';

// Prefixo de todas as rotas deste modulo. Se um dia mudar,
// muda so aqui (e o app-AMB continua funcionando).
const PREFIXO = '/amb';

// ── Bling da AMBTotal ────────────────────────────────────────
const bling = {
  clientId:     env('BLING_CLIENT_ID')     || '',
  clientSecret: env('BLING_CLIENT_SECRET') || '',
  // Tokens: gravados de volta no Render pela lib de tokens.
  accessToken:  env('BLING_ACCESS_TOKEN')  || '',
  refreshToken: env('BLING_REFRESH_TOKEN') || '',
  // Nomes das chaves no Render (usados na hora de persistir).
  chaveAccess:  'AMB_BLING_ACCESS_TOKEN',
  chaveRefresh: 'AMB_BLING_REFRESH_TOKEN',
  apiBase:      'https://api.bling.com.br/Api/v3',
  // Rate limit do Bling e por CLIENT_ID (~3 req/s). Como a AMB
  // tem client_id proprio, nao divide cota com a GOOD.
  pausaMs:      Number(env('BLING_PAUSA_MS') || 700),
};

// ── Mercado Livre da AMBTotal ────────────────────────────────
const ml = {
  clientId:     env('ML_CLIENT_ID')     || '',
  clientSecret: env('ML_CLIENT_SECRET') || '',
  accessToken:  env('ML_ACCESS_TOKEN')  || '',
  refreshToken: env('ML_REFRESH_TOKEN') || '',
  userId:       env('ML_USER_ID')       || '',
  chaveAccess:  'AMB_ML_ACCESS_TOKEN',
  chaveRefresh: 'AMB_ML_REFRESH_TOKEN',
  chaveUserId:  'AMB_ML_USER_ID',
  apiBase:      'https://api.mercadolibre.com',
  // Janela do indice claims->returns. A GOOD usa 120 dias; a AMB
  // comeca com 60 (menos volume, menos memoria, indice mais rapido).
  janelaDias:   Number(env('ML_JANELA_DIAS') || 60),
};

// ── Shopee (via o servico shopee-nf-sync, que ja e multi-loja) ──
const shopee = {
  proxyUrl: env('SHOPEE_PROXY_URL', process.env.SHOPEE_PROXY_URL) || '',
  proxyKey: env('SHOPEE_PROXY_KEY', process.env.SHOPEE_PROXY_KEY) || '',
  loja:     env('SHOPEE_LOJA_KEY')  || 'amb',
};

// ── Magalu ───────────────────────────────────────────────────
const magalu = {
  clientId:     env('MAGALU_CLIENT_ID')     || '',
  clientSecret: env('MAGALU_CLIENT_SECRET') || '',
  accessToken:  env('MAGALU_ACCESS_TOKEN')  || '',
  refreshToken: env('MAGALU_REFRESH_TOKEN') || '',
  tenantId:     env('MAGALU_TENANT_ID')     || '',
  chaveAccess:  'AMB_MAGALU_ACCESS_TOKEN',
  chaveRefresh: 'AMB_MAGALU_REFRESH_TOKEN',
};

// ── Supabase (tabelas com sufixo _amb, mesmo projeto) ────────
const supabase = {
  url: env('SUPABASE_URL', process.env.SUPABASE_URL) || '',
  key: env('SUPABASE_KEY', process.env.SUPABASE_KEY) || '',
  tabelas: {
    devolucoes:     'devolucoes_amb',
    espreitaNotas:  'espreita_notas_amb',
    recados:        'recados_amb',
    pecasRetiradas: 'pecas_retiradas_amb',
    // b245 - de-para de SKU: anuncio Full do ML nao deixa trocar o SKU
    // (tem vendas), e o produto foi renomeado no Bling. Esta tabela e a
    // memoria que o Bling nao guarda: SKU da venda -> produto atual.
    skuDepara:      'sku_depara_amb',
  },
};

// ── Render (pra persistir token em env var) ──────────────────
const render = {
  apiKey:    process.env.RENDER_API_KEY || process.env.RENDER_API_KEY_v2 || '',
  serviceId: process.env.RENDER_SERVICE_ID || process.env.RENDER_SERVICE_ID_v2 || '',
};

// URL publica do servico. Vem do proprio Render em runtime, entao
// nao ha dominio escrito no codigo — se o servico mudar de nome ou
// de lugar, isto acompanha sozinho.
function urlBase() {
  return process.env.RENDER_EXTERNAL_URL
    || env('URL_BASE')
    || 'http://localhost:' + (process.env.PORT || 3000);
}

function redirectUri() {
  return urlBase() + '/callback';
}

// Diagnostico: o que esta configurado e o que falta.
function statusConfig() {
  return {
    bling:   { client_id: !!bling.clientId,  secret: !!bling.clientSecret,  token: !!bling.accessToken },
    ml:      { client_id: !!ml.clientId,     secret: !!ml.clientSecret,     token: !!ml.accessToken, user_id: ml.userId || null },
    shopee:  { proxy: !!shopee.proxyUrl,     key: !!shopee.proxyKey,        loja: shopee.loja },
    magalu:  { client_id: !!magalu.clientId, tenant: magalu.tenantId || null, token: !!magalu.accessToken },
    supabase:{ url: !!supabase.url,          key: !!supabase.key },
    render:  { api_key: !!render.apiKey,     service_id: !!render.serviceId },
  };
}

module.exports = {
  EMPRESA, NOME_EMPRESA, PREFIXO,
  bling, ml, shopee, magalu, supabase, render,
  urlBase, redirectUri, statusConfig,
};
