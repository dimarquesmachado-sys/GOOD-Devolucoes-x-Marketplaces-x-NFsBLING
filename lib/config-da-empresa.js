'use strict';

/**
 * lib/config-da-empresa.js — a PONTE entre o registro e os módulos.
 * ---------------------------------------------------------------------
 * ⚠️ ESTE ARQUIVO NASCEU DE UM APONTAMENTO CERTEIRO DO CODEX (P2 no #173),
 * e o problema que ele achou é do tipo que passa despercebido:
 *
 *   `criarDb(obterEmpresa('ambtotal'))`  →  TypeError
 *
 * A fábrica do passo 1 espera o formato do `config-AMB` (`cfg.supabase.url`,
 * `cfg.bling.clientId`...). A ficha do registro tem outro: identidade da
 * empresa (`chave`, `prefixoEnv`, `tabelas`, `fiscal`). São coisas
 * diferentes — o registro diz QUEM é a empresa, o config diz COM O QUE ela
 * se conecta.
 *
 * E o pior: meu teste da Fase 3 ESCONDEU isso, porque eu montei à mão um
 * objeto no formato do config em vez de usar a ficha real. Teste que
 * fabrica o próprio cenário não testa o contrato.
 *
 * ---------------------------------------------------------------------
 * O QUE ESTE MÓDULO FAZ
 *
 * Recebe a chave da empresa e devolve o config montado, lendo as env vars
 * com o prefixo dela. É o mesmo trabalho que o `config-AMB` faz — mas para
 * QUALQUER empresa do registro, sem arquivo próprio.
 *
 *   const cfg = configDaEmpresa('ambtotal');
 *   const db  = criarDb(cfg);          // funciona
 *
 * Com isto a Fase 4 (Girassol entra como ficha, não como pasta) deixa de
 * precisar de um `config-GIRASSOL.js` copiado.
 */

const { obterEmpresa, envDaEmpresa } = require('./empresas');

/**
 * Monta o config de uma empresa a partir da ficha do registro.
 *
 * @param {string|object} empresa  chave ('ambtotal') ou a ficha já obtida
 * @returns {object} config no formato que os módulos esperam
 */
function configDaEmpresa(empresa) {
  const ficha = (typeof empresa === 'string') ? obterEmpresa(empresa) : empresa;
  if (!ficha || !ficha.chave) {
    throw new Error('configDaEmpresa: passe a chave da empresa ou a ficha do registro');
  }

  const env = (nome, padrao) => envDaEmpresa(ficha, nome, padrao);

  return {
    // identidade — de onde os módulos tiram empresa e prefixo, em vez de
    // escrever 'ambtotal' e 'AMB_' no literal (b246)
    CHAVE_REGISTRO: ficha.chave,
    PREFIXO_ENV: ficha.prefixoEnv,
    EMPRESA: ficha.chave,
    NOME_EMPRESA: ficha.nome,
    PREFIXO: ficha.prefixoRota,

    supabase: {
      // o fallback global existe porque hoje as duas empresas dividem o
      // MESMO projeto Supabase, separadas por sufixo de tabela
      url: env('SUPABASE_URL', process.env.SUPABASE_URL || ''),
      key: env('SUPABASE_KEY', process.env.SUPABASE_KEY || ''),
      tabelas: ficha.tabelas,
    },

    bling: {
      clientId: env('BLING_CLIENT_ID', ''),
      clientSecret: env('BLING_CLIENT_SECRET', ''),
      accessToken: env('BLING_ACCESS_TOKEN', ''),
      refreshToken: env('BLING_REFRESH_TOKEN', ''),
      chaveAccess: (ficha.prefixoEnv || '') + 'BLING_ACCESS_TOKEN',
      chaveRefresh: (ficha.prefixoEnv || '') + 'BLING_REFRESH_TOKEN',
      apiBase: 'https://api.bling.com.br/Api/v3',
      pausaMs: Number(env('BLING_PAUSA_MS', 700)),
    },

    ml: {
      clientId: env('ML_CLIENT_ID', ''),
      clientSecret: env('ML_CLIENT_SECRET', ''),
      accessToken: env('ML_ACCESS_TOKEN', ''),
      refreshToken: env('ML_REFRESH_TOKEN', ''),
      userId: env('ML_USER_ID', ''),
      chaveAccess: (ficha.prefixoEnv || '') + 'ML_ACCESS_TOKEN',
      chaveRefresh: (ficha.prefixoEnv || '') + 'ML_REFRESH_TOKEN',
      apiBase: 'https://api.mercadolibre.com',
      janelaDias: Number(env('ML_JANELA_DIAS', 60)),
    },

    shopee: {
      proxyUrl: env('SHOPEE_PROXY_URL', process.env.SHOPEE_PROXY_URL || ''),
      proxyKey: env('SHOPEE_PROXY_KEY', process.env.SHOPEE_PROXY_KEY || ''),
      loja: env('SHOPEE_LOJA_KEY', ficha.chave),
    },

    magalu: {
      clientId: env('MAGALU_CLIENT_ID', ''),
      clientSecret: env('MAGALU_CLIENT_SECRET', ''),
      accessToken: env('MAGALU_ACCESS_TOKEN', ''),
      refreshToken: env('MAGALU_REFRESH_TOKEN', ''),
      tenantId: env('MAGALU_TENANT_ID', ''),
    },

    // os campos fiscais vêm prontos da ficha (o registro já resolve o
    // prefixo fiscal, que na GOOD é diferente do de credenciais)
    fiscal: ficha.fiscal,
  };
}

module.exports = { configDaEmpresa };
