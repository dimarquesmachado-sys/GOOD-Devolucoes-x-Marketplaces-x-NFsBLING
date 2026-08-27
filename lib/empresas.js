'use strict';

/**
 * REGISTRO DE EMPRESAS — a "ficha" de cada CNPJ que roda no Devoluções.
 * ---------------------------------------------------------------------
 * POR QUE ISSO EXISTE
 *
 * Hoje, plugar uma empresa nova significa COPIAR pastas inteiras (o
 * app-AMB tem 2.066 linhas e 148 mencoes literais a "AMB"; o painel tem
 * 3.569). Cada copia depois diverge — e a mesma correcao passa a ser
 * feita duas vezes. Ja aconteceu: em 25/08 o mesmo bug foi consertado
 * nos dois lados no mesmo dia, e em 26/08 o furo do painel servido antes
 * do login estava nas DUAS empresas por caminhos diferentes.
 *
 * Com a Girassol entrando (volume ~15% acima da GOOD) e mais uma empresa
 * em ~3 meses, copiar de novo nao soma custo: multiplica.
 *
 * Este arquivo e o primeiro passo, e de proposito o mais barato: junta
 * num lugar so o que HOJE esta espalhado entre envs, ids no meio do
 * codigo e nomes de tabela. Ele NAO muda comportamento — quem le, le os
 * mesmos valores de antes. O que ele da e um CONTRATO: "isto e tudo o
 * que uma empresa precisa ter". Empresa nova = preencher esta ficha.
 *
 * ---------------------------------------------------------------------
 * A FICHA SE DESCOBRE SOZINHA — nao e pra preencher na unha
 *
 * Regra do Diego (18/08): "id de deposito, situacao e loja sao diferentes
 * em cada empresa. precisa sempre pegar isso. se tem alguma forma de API
 * pegar, otimo. senao vai na unha manual mesmo." E em 26/08: "ao adicionar
 * CNPJ de empresa nova deveria ta sempre buscando e pegando".
 *
 * O que a API do Bling v3 RESOLVE (medido pela sonda de ids fiscais em
 * 18/08, rodando no Bling da AMB — nao e suposicao):
 *   GET /naturezas-operacoes  -> 200, 22 itens. Acha a natureza por NOME.
 *   GET /depositos            -> lista os depositos da empresa logada.
 *   GET /situacoes            -> as situacoes de pedido (que MUDAM por
 *                                empresa: AGUARDANDO e 353459 na GOOD,
 *                                7259 na Girassol, 745122 na AMB).
 *   GET /lojas                -> os canais/integracoes de marketplace.
 *
 * O que a API NAO resolve:
 *   GET /empresas             -> 404, NAO EXISTE. O idEmpresaControl e o
 *                                unico campo que precisa de olho humano
 *                                (ou de env). Por isso ele fica marcado
 *                                como origem 'manual' aqui.
 *
 * `descobrirFicha()`, no fim deste arquivo, faz essa varredura pra
 * QUALQUER empresa — mesma peca, empresa como parametro.
 *
 * ---------------------------------------------------------------------
 * A PEGADINHA DOS PREFIXOS (medida no codigo, nao suposta)
 *
 * A GOOD nasceu primeiro e ficou SEM prefixo: `BLING_CLIENT_ID`.
 * A AMB veio depois e usa prefixo: `AMB_BLING_CLIENT_ID`.
 *
 * Por isso `prefixoEnv` da GOOD e string vazia. Empresa nova SEMPRE tem
 * prefixo — sem prefixo so cabe uma no ambiente.
 */

/**
 * Le uma variavel de ambiente respeitando o prefixo da empresa.
 * `envDaEmpresa(GOOD, 'BLING_CLIENT_ID')` -> process.env.BLING_CLIENT_ID
 * `envDaEmpresa(AMB,  'BLING_CLIENT_ID')` -> process.env.AMB_BLING_CLIENT_ID
 */
function envDaEmpresa(empresa, nome, padrao) {
  const prefixo = (empresa && empresa.prefixoEnv) || '';
  const valor = process.env[prefixo + nome];
  return (valor == null || valor === '') ? padrao : valor;
}

const EMPRESAS = {
  good: {
    chave: 'good',
    nome: 'GOOD Import (GIMPO)',
    prefixoEnv: '',              // sem prefixo: nasceu primeiro
    prefixoRota: '',             // servida na raiz do servico
    tabelaDevolucoes: 'devolucoes',
    fiscal: {
      // Fallbacks que hoje estao escritos no meio do codigo:
      //   lib/bling.js:684        -> idEmpresaControl 4956030980
      //   lib/rotas-admin-nf.js   -> deposito geral 4956031259
      idEmpresaControl:    () => envDaEmpresa(EMPRESAS.good, 'ID_EMPRESA_CONTROL', '4956030980'),
      depositoGeral:       () => envDaEmpresa(EMPRESAS.good, 'DEPOSITO_GERAL', '4956031259'),
      depositosValidos:    ['4956031259', '14888156920', '14888947655', '9596855161'],
      naturezaDevolucao:   () => envDaEmpresa(EMPRESAS.good, 'ID_NATUREZA_DEVOLUCAO_ENTRADA', '5776118802'),
      naturezasDevolucaoIds: () => envDaEmpresa(EMPRESAS.good, 'NATUREZAS_DEVOLUCAO_IDS', '5776118802,15110882187'),
      nfEntradaTipo:       () => envDaEmpresa(EMPRESAS.good, 'NF_ENTRADA_TIPO', '0'),
    },
  },

  ambtotal: {
    chave: 'ambtotal',
    nome: 'AMBTotal',
    prefixoEnv: 'AMB_',
    prefixoRota: '/amb',
    tabelaDevolucoes: 'devolucoes_amb',
    fiscal: {
      idEmpresaControl:    () => envDaEmpresa(EMPRESAS.ambtotal, 'ID_EMPRESA_CONTROL'),
      depositoGeral:       () => envDaEmpresa(EMPRESAS.ambtotal, 'DEPOSITO_GERAL', '14888917703'),
      // medidos no select #opcoesDepositos do proprio Bling da AMB (26/08):
      //   14889038488 DEFEITOS | 14888917703 Geral
      //   14889063674 Magalu Fulfillment | 14889063825 Shopee Fulfillment
      depositosValidos:    ['14888917703', '14889038488', '14889063674', '14889063825'],
      naturezaDevolucao:   () => envDaEmpresa(EMPRESAS.ambtotal, 'ID_NATUREZA_DEVOLUCAO_ENTRADA'),
      naturezasDevolucaoIds: () => envDaEmpresa(EMPRESAS.ambtotal, 'NATUREZAS_DEVOLUCAO_IDS', '15110882041,15110128838'),
      nfEntradaTipo:       () => envDaEmpresa(EMPRESAS.ambtotal, 'NF_ENTRADA_TIPO', '0'),
    },
  },

  // ── GIRASSOL: ficha ABERTA, ainda NAO plugada ────────────────────────
  // Deixada aqui de proposito, com os campos que faltam nomeados um a um.
  // NAO inventei nenhum id: os de baixo saem do Bling da Girassol e
  // precisam ser levantados por quem tem acesso (mesma varredura que
  // fizemos na AMB: catalogo /naturezas-operacoes e o select de
  // depositos na tela de NF de entrada).
  //
  // girassol: {
  //   chave: 'girassol',
  //   nome: 'Magazine Girassol',
  //   prefixoEnv: 'GIRA_',
  //   prefixoRota: '/girassol',
  //   tabelaDevolucoes: 'devolucoes_girassol',
  //   fiscal: {
  //     idEmpresaControl:    () => envDaEmpresa(EMPRESAS.girassol, 'ID_EMPRESA_CONTROL'),   // FALTA
  //     depositoGeral:       () => envDaEmpresa(EMPRESAS.girassol, 'DEPOSITO_GERAL'),       // FALTA
  //     depositosValidos:    [],                                                            // FALTA
  //     naturezaDevolucao:   () => envDaEmpresa(EMPRESAS.girassol, 'ID_NATUREZA_DEVOLUCAO_ENTRADA'), // FALTA
  //     naturezasDevolucaoIds: () => envDaEmpresa(EMPRESAS.girassol, 'NATUREZAS_DEVOLUCAO_IDS'),      // FALTA
  //     nfEntradaTipo:       () => envDaEmpresa(EMPRESAS.girassol, 'NF_ENTRADA_TIPO', '0'),
  //   },
  // },
};

/** Nomes de env que TODA empresa precisa ter no Render pra funcionar. */
const ENVS_OBRIGATORIAS = [
  'BLING_CLIENT_ID', 'BLING_CLIENT_SECRET', 'BLING_REFRESH_TOKEN',
  'ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'ML_REFRESH_TOKEN',
  'USERS',
];

function obterEmpresa(chave) {
  const e = EMPRESAS[String(chave || '').toLowerCase()];
  if (!e) throw new Error('empresa desconhecida: ' + chave);
  return e;
}

function listarEmpresas() {
  return Object.keys(EMPRESAS).map((k) => EMPRESAS[k]);
}

/**
 * Diz o que falta pra uma empresa entrar no ar — sem chutar nada:
 * so olha se as envs existem e se os ids fiscais tem valor.
 * E o que responde "a Girassol ja pode ser ligada?".
 */
function conferirEmpresa(chave) {
  const e = obterEmpresa(chave);
  const faltando = [];
  ENVS_OBRIGATORIAS.forEach((nome) => {
    if (!envDaEmpresa(e, nome)) faltando.push(e.prefixoEnv + nome);
  });
  const fiscalVazio = [];
  Object.keys(e.fiscal).forEach((campo) => {
    const v = e.fiscal[campo];
    const valor = (typeof v === 'function') ? v() : v;
    const vazio = Array.isArray(valor) ? valor.length === 0 : !valor;
    if (vazio) fiscalVazio.push(campo);
  });
  return {
    chave: e.chave,
    nome: e.nome,
    pronta: faltando.length === 0 && fiscalVazio.length === 0,
    envsFaltando: faltando,
    fiscalSemValor: fiscalVazio,
  };
}

/**
 * DESCOBRE a ficha de uma empresa perguntando pro Bling DELA.
 *
 * `chamarBling` e injetado (o cliente ja autenticado daquela empresa),
 * entao esta funcao serve pra QUALQUER CNPJ — e o que faz plugar empresa
 * nova virar "autoriza no Bling e roda", em vez de caçar id no DevTools.
 *
 * Princípio que ele aprovou em 18/08 e que vale em cada campo aqui:
 * **AMBIGUIDADE NAO ESCOLHE**. Um candidato serve; mais de um recusa,
 * devolve os candidatos e pede a env. Nunca `.find()` pegando o primeiro
 * que a API devolver — o campo errado so apareceria depois, no estrago.
 */
async function descobrirFicha(chave, chamarBling) {
  const e = obterEmpresa(chave);
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  async function lista(caminho, campo) {
    try {
      const r = await chamarBling('GET', caminho);
      const dados = (r && r.data && r.data.data) || (r && r.data) || [];
      return { ok: true, itens: Array.isArray(dados) ? dados : [] };
    } catch (err) {
      return { ok: false, erro: campo + ': ' + String(err && err.message || err), itens: [] };
    }
  }

  const problemas = [];

  // ── depositos ──────────────────────────────────────────────────────
  const dep = await lista('/depositos', 'depositos');
  if (!dep.ok) problemas.push(dep.erro);
  const depositos = dep.itens.map((d) => ({ id: String(d.id), nome: d.descricao || d.nome || '' }));
  const geraisPossiveis = depositos.filter((d) => norm(d.nome) === 'geral');
  let depositoGeral = null;
  if (geraisPossiveis.length === 1) depositoGeral = geraisPossiveis[0];
  else if (geraisPossiveis.length > 1) {
    problemas.push('mais de um deposito chamado "Geral" — defina ' + e.prefixoEnv + 'DEPOSITO_GERAL');
  } else if (depositos.length) {
    problemas.push('nenhum deposito chamado "Geral" — defina ' + e.prefixoEnv + 'DEPOSITO_GERAL');
  }

  // ── natureza de devolucao de entrada ───────────────────────────────
  const nat = await lista('/naturezas-operacoes', 'naturezas');
  if (!nat.ok) problemas.push(nat.erro);
  const naturezas = nat.itens.map((n) => ({ id: String(n.id), nome: n.descricao || '' }));
  let naturezaDevolucao = null;
  const exatas = naturezas.filter((n) => norm(n.nome) === 'devolucao de mercadoria - entrada');
  // "devolucao de COMPRA" existe na lista logo antes da certa e nao serve —
  // pegar a errada aqui joga a NF de devolucao na natureza errada.
  const perto = naturezas.filter((n) => /devolu/.test(norm(n.nome)) && /entrada/.test(norm(n.nome)) && !/compra/.test(norm(n.nome)));
  if (exatas.length === 1) naturezaDevolucao = exatas[0];
  else if (exatas.length > 1) problemas.push('mais de uma natureza com o nome exato — defina ' + e.prefixoEnv + 'ID_NATUREZA_DEVOLUCAO_ENTRADA');
  else if (perto.length === 1) naturezaDevolucao = perto[0];
  else if (perto.length > 1) problemas.push('mais de uma natureza de "devolucao ... entrada" — defina ' + e.prefixoEnv + 'ID_NATUREZA_DEVOLUCAO_ENTRADA');
  else if (naturezas.length) problemas.push('nenhuma natureza de "devolucao ... entrada" nesta empresa');

  // ── situacoes (mudam por empresa: AGUARDANDO e 353459/7259/745122) ──
  const sit = await lista('/situacoes', 'situacoes');
  if (!sit.ok) problemas.push(sit.erro);
  const situacoes = sit.itens.map((x) => ({ id: String(x.id), nome: x.nome || x.descricao || '' }));

  // ── lojas / canais de marketplace ──────────────────────────────────
  const lj = await lista('/lojas', 'lojas');
  if (!lj.ok) problemas.push(lj.erro);
  const lojas = lj.itens.map((x) => ({ id: String(x.id), nome: x.descricao || x.nome || '' }));

  // ── idEmpresaControl: NAO tem API (GET /empresas da 404) ───────────
  const idEmpresaControl = envDaEmpresa(e, 'ID_EMPRESA_CONTROL') || null;
  if (!idEmpresaControl) {
    problemas.push('idEmpresaControl NAO vem por API (GET /empresas da 404) — precisa de ' + e.prefixoEnv + 'ID_EMPRESA_CONTROL');
  }

  return {
    empresa: e.chave,
    nome: e.nome,
    pronta: problemas.length === 0,
    descoberto: {
      depositoGeral,
      naturezaDevolucao,
      totalDepositos: depositos.length,
      totalNaturezas: naturezas.length,
      totalSituacoes: situacoes.length,
      totalLojas: lojas.length,
    },
    manual: { idEmpresaControl },
    listas: { depositos, naturezas, situacoes, lojas },
    problemas,
  };
}

module.exports = {
  EMPRESAS,
  ENVS_OBRIGATORIAS,
  envDaEmpresa,
  obterEmpresa,
  listarEmpresas,
  conferirEmpresa,
  descobrirFicha,
};
