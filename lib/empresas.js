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

module.exports = {
  EMPRESAS,
  ENVS_OBRIGATORIAS,
  envDaEmpresa,
  obterEmpresa,
  listarEmpresas,
  conferirEmpresa,
};
