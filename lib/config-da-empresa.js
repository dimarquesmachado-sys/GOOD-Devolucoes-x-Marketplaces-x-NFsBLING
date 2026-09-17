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

  // ⚠️ b360 - OS CAMPOS DE AUTH VEM DA FICHA, nao cravados.
  //
  // O `auth-AMB.criar(cfg)` existe desde o PR #295 mas o app nunca o chamou:
  // a config da empresa nao tinha os 4 campos que ele exige, entao a unica
  // opcao era usar a instancia PADRAO — que e a AMB, uma por processo.
  //
  // ⚠️ E e por isso que o `auth` ainda vazava entre empresas mesmo com a
  // fabrica pronta: faltava a PONTE entre a ficha e o formato que ela pede.
  //
  // 📌 Derivo dos prefixos que a ficha ja declara:
  //   cookie        sessao_<rota sem barra>   -> sessao_amb, sessao_girassol
  //   caminhoCookie prefixoRota               -> /amb, /girassol
  //   envUsers      <PREFIXO>USERS            -> AMB_USERS, GIRASSOL_USERS
  //   envAdmins     <PREFIXO>ADMIN_USER
  //
  // Os valores da AMB batem EXATAMENTE com os padroes de hoje — conferido
  // contra `PADRAO` no auth-AMB, senao o galpao cairia da sessao no deploy.
  // ⚠️ A ROTA VAZIA DA GOOD DAVA `sessao_amb` — colisao.
  //
  // A GOOD tem `prefixoRota: ''` (ela e a raiz do servico). Meu primeiro
  // rascunho caia no padrao 'amb' e as DUAS teriam o mesmo cookie — que e
  // exatamente o vazamento que este trabalho existe pra fechar.
  //
  // 📌 Uso a CHAVE quando nao ha rota: 'good' -> sessao_good. Unica por
  // empresa, sem depender de um campo que pode ser vazio.
  const rotaLimpa = String(ficha.prefixoRota || '').replace(/^\//, '')
    || String(ficha.chaveDados || ficha.chave || '').trim();
  // ⚠️ e se ainda assim vier vazio, derrubo: cookie sem nome de empresa e
  // cookie compartilhado.
  if (!rotaLimpa) {
    throw new Error(`[config-da-empresa] a ficha de "${ficha.chave}" nao tem `
      + 'prefixoRota nem chave — sem isso o cookie da sessao nao seria unico '
      + 'por empresa, e uma entraria na sessao da outra.');
  }

  // ⚠️ b360.1 (Codex, P2) - O FALLBACK DE CAMINHO ERA CRAVADO NA AMB.
  //
  // `ficha.prefixoRota || '/amb'` so acerta a AMB, que tem prefixoRota
  // preenchido. A GOOD (prefixoRota: '') cairia sempre em '/amb' — mas o
  // bootstrap (server.js, via `empresasAtivasNoDevolucoes`) monta a GOOD em
  // `/good`. Cookie com path '/amb' nao e enviado pelo navegador em
  // requisicoes pra '/good': login retornaria 200 e a checagem de sessao
  // seguinte, 401.
  //
  // 📌 Mesmo fallback do bootstrap: sem prefixoRota, usa '/' + chave.
  const caminhoMontado = ficha.prefixoRota || '/' + ficha.chave;

  // ⚠️ b360.2 (Codex, P2) - envUsers/envAdmins TEM QUE RESPEITAR O HISTORICO.
  //
  // A GOOD ainda roda em producao com `USERS`/`ADMIN_USER` sem prefixo
  // (b250, ver lib/empresas.js:nomeHistorico). auth-AMB.js le
  // `process.env[c.envUsers]` DIRETO, sem passar por `envDaEmpresa` — cravar
  // `GOOD_USERS` aqui faria a leitura vir sempre vazia e NINGUEM da GOOD
  // conseguiria logar, mesmo com tudo configurado.
  //
  // 📌 Mesmo criterio do envDaEmpresa: nome novo primeiro; se vazio e a
  // ficha tiver `nomeHistorico`, cai no nome antigo.
  const nomeEnvComHistorico = (nome) => {
    const novo = ficha.prefixoEnv + nome;
    const vazio = process.env[novo] == null || process.env[novo] === '';
    if (vazio && ficha.nomeHistorico) {
      const antigo = ficha.nomeHistorico(nome);
      if (antigo && process.env[antigo] != null && process.env[antigo] !== '') return antigo;
    }
    return novo;
  };

  const AUTH = {
    cookie: 'sessao_' + rotaLimpa,
    caminhoCookie: caminhoMontado,
    validadeMs: 12 * 60 * 60 * 1000,
    envUsers: nomeEnvComHistorico('USERS'),
    envAdmins: nomeEnvComHistorico('ADMIN_USER'),
  };

  return {
    AUTH,
    // identidade — de onde os módulos tiram empresa e prefixo, em vez de
    // escrever 'ambtotal' e 'AMB_' no literal (b246)
    CHAVE_REGISTRO: ficha.chave,
    PREFIXO_ENV: ficha.prefixoEnv,
    // ⚠️ b367 - `EMPRESA` E A CHAVE DE DADOS, NAO A CANONICA.
    //
    // O `config-AMB` fixo entrega 'amb' aqui; esta config entregava
    // 'ambtotal'. Trocar um pelo outro no app gravaria/consultaria com a
    // chave errada e ORFANARIA os dados da AMB.
    //
    // 📌 Medi campo a campo antes de trocar, em vez de assumir que as duas
    // configs eram equivalentes.
    EMPRESA: ficha.chaveDados || ficha.chave,
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
      // ⚠️ b367: existia so no `config-AMB`. Sem ela, quem salva o token do
      // ML nao sabe em que env gravar — e o app nao pode largar o arquivo
      // fixo da AMB enquanto faltar um campo que ele usa.
      chaveUserId: (ficha.prefixoEnv || '') + 'ML_USER_ID',
      chaveRefresh: (ficha.prefixoEnv || '') + 'ML_REFRESH_TOKEN',
      apiBase: 'https://api.mercadolibre.com',
      janelaDias: Number(env('ML_JANELA_DIAS', 60)),
    },

    shopee: {
      proxyUrl: env('SHOPEE_PROXY_URL', process.env.SHOPEE_PROXY_URL || ''),
      proxyKey: env('SHOPEE_PROXY_KEY', process.env.SHOPEE_PROXY_KEY || ''),
      // ⚠️ b367 - MESMO CASO, E PIOR: o PROXY da Shopee so conhece 'amb',
      // 'girassol' e 'good' (sao as rotas dele). Mandar 'ambtotal' faria o
      // proxy nao achar a loja — e a Shopee cairia em producao.
      loja: env('SHOPEE_LOJA_KEY', ficha.chaveDados || ficha.chave),
    },

    magalu: {
      clientId: env('MAGALU_CLIENT_ID', ''),
      clientSecret: env('MAGALU_CLIENT_SECRET', ''),
      accessToken: env('MAGALU_ACCESS_TOKEN', ''),
      refreshToken: env('MAGALU_REFRESH_TOKEN', ''),
      tenantId: env('MAGALU_TENANT_ID', ''),
      // ⚠️ b367: as 2 chaves abaixo so existiam no `config-AMB` fixo — sao
      // o NOME da env onde o token renovado e gravado. Sem elas o app nao
      // pode largar o arquivo da AMB.
      chaveAccess: (ficha.prefixoEnv || '') + 'MAGALU_ACCESS_TOKEN',
      chaveRefresh: (ficha.prefixoEnv || '') + 'MAGALU_REFRESH_TOKEN',
    },

    // os campos fiscais vêm prontos da ficha (o registro já resolve o
    // prefixo fiscal, que na GOOD é diferente do de credenciais)
    fiscal: ficha.fiscal,
    // ⚠️ b367 - OS 4 CAMPOS QUE SO EXISTIAM NO `config-AMB` FIXO.
    //
    // Sem eles o app nao consegue largar o arquivo da AMB — e enquanto nao
    // largar, 2 empresas nao sobem (o freio do server.js).
    //
    // ⚠️ b367.1 (Codex, P2) - RENDER NAO E POR EMPRESA, E POR SERVICO.
    //
    // `env()` prefixa (AMB_RENDER_API_KEY...), mas so existe UM deploy no
    // Render rodando as duas empresas — a chave e o service id sao os
    // mesmos globais que `lib/render-tokens.js` ja le (com fallback `_v2`).
    // Prefixar aqui fazia `/config` mostrar Render como nao configurado
    // mesmo com o token sendo persistido de verdade.
    //
    // 📌 Leio as MESMAS globais do gravador de token, sem prefixo.
    render: {
      apiKey: process.env.RENDER_API_KEY || process.env.RENDER_API_KEY_v2 || '',
      serviceId: process.env.RENDER_SERVICE_ID || process.env.RENDER_SERVICE_ID_v2 || '',
    },

    urlBase() {
      return process.env.RENDER_EXTERNAL_URL || env('URL_BASE', '')
        || 'http://localhost:' + (process.env.PORT || 3000);
    },

    // ⚠️ E AQUI ESTAVA O PIOR DO FREIO: o callback era `/amb/oauth/callback`
    // CRAVADO no app. A 2a empresa mandaria o marketplace devolver o codigo
    // na rota da AMB — e o TOKEN DELA SERIA GRAVADO NA CONTA DA AMBTOTAL.
    //
    // 📌 Agora sai do prefixo da ficha: /amb, /girassol, cada uma na sua.
    //
    // ⚠️ b367.2 (Codex, P2) - A GOOD TEM `prefixoRota: ''` DE PROPOSITO.
    //
    // `ficha.prefixoRota || ''` derrubava o prefixo da GOOD pra string
    // vazia — mas o bootstrap (empresasAtivasNoDevolucoes) monta a GOOD em
    // `/good`, nao na raiz. O callback saia em `/oauth/callback` e nao
    // batia com nenhuma rota montada: OAuth da GOOD nunca completaria.
    //
    // 📌 Mesmo fallback ja usado pro cookie de sessao (`caminhoMontado`,
    // linha 96): sem prefixoRota, usa '/' + chave.
    redirectUri(caminho) {
      const base = process.env.RENDER_EXTERNAL_URL || env('URL_BASE', '')
        || 'http://localhost:' + (process.env.PORT || 3000);
      return base + caminhoMontado + (caminho || '/callback');
    },

    // ⚠️ o meu 1o rascunho tinha SO bling/ml/supabase — e o do `config-AMB`
    // tem 6 blocos. A tela de status mostraria menos do que hoje, e o dono
    // perderia o diagnostico de Shopee, Magalu e Render sem nada avisar.
    //
    // 📌 Comparei a saida das duas em vez de escrever de cabeca.
    statusConfig() {
      return {
        bling: {
          client_id: !!this.bling.clientId,
          secret: !!this.bling.clientSecret,
          token: !!this.bling.accessToken,
        },
        ml: {
          client_id: !!this.ml.clientId,
          secret: !!this.ml.clientSecret,
          token: !!this.ml.accessToken,
          user_id: this.ml.userId || null,
        },
        shopee: {
          proxy: !!this.shopee.proxyUrl,
          key: !!this.shopee.proxyKey,
          loja: this.shopee.loja,
        },
        magalu: {
          client_id: !!this.magalu.clientId,
          tenant: this.magalu.tenantId || null,
          token: !!this.magalu.accessToken,
        },
        supabase: { url: !!this.supabase.url, key: !!this.supabase.key },
        render: { api_key: !!this.render.apiKey, service_id: !!this.render.serviceId },
      };
    },
  };
}

module.exports = { configDaEmpresa };
