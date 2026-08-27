'use strict';

/**
 * REGISTRO DE EMPRESAS — a "ficha" de cada CNPJ que roda no Devoluções.
 * ---------------------------------------------------------------------
 * Hoje plugar empresa nova = COPIAR pasta (app-AMB tem 2.066 linhas com
 * 148 mencoes literais a "AMB"; o painel tem 3.569). A copia diverge e a
 * mesma correcao passa a ser feita duas vezes — aconteceu 2x nesta
 * semana. Com a Girassol entrando e mais uma em ~3 meses, copiar de novo
 * nao soma custo: multiplica.
 *
 * Este arquivo NAO muda comportamento. Junta num lugar so o que esta
 * espalhado e serve de CONTRATO: "isto e tudo o que uma empresa tem".
 *
 * ---------------------------------------------------------------------
 * DOIS PREFIXOS, NAO UM (apontamento P1 do Codex no PR #86)
 *
 * Eu tinha escrito que "a GOOD nao tem prefixo". Errado, e perigoso: ela
 * nao tem prefixo nas CREDENCIAIS (`BLING_CLIENT_ID`) mas TEM nos campos
 * FISCAIS (`GOOD_DEPOSITO_GERAL`, `GOOD_ID_EMPRESA_CONTROL`...).
 *
 * Com um prefixo so, migrar a producao pra este registro leria
 * `DEPOSITO_GERAL` (que ninguem configurou), jogaria fora o valor
 * configurado e cairia no padrao — mirando em deposito, natureza ou
 * empresa ERRADA, sem avisar.
 *
 * ---------------------------------------------------------------------
 * A FICHA SE DESCOBRE SOZINHA — nao e pra preencher na unha
 *
 * Regra dele (18/08): "deposito, situacao e loja sao diferentes em cada
 * empresa. precisa sempre pegar isso. se tem alguma forma de API pegar,
 * otimo." E em 26/08: "ao adicionar CNPJ novo deveria ta sempre buscando".
 *
 * O que a API do Bling v3 resolve (medido pela sonda de 18/08 no Bling
 * da AMB, nao suposto): `/naturezas-operacoes` (200, 22 itens, acha por
 * NOME), `/depositos`, `/situacoes` (mudam por empresa: AGUARDANDO e
 * 353459 na GOOD, 7259 na Girassol, 745122 na AMB) e `/lojas`.
 *
 * O que NAO resolve: `GET /empresas` da 404. O idEmpresaControl e o
 * unico campo que precisa de env.
 */

/**
 * Le env respeitando o prefixo certo.
 *   tipo 'credencial' (padrao) -> prefixoEnv    | GOOD ''      AMB 'AMB_'
 *   tipo 'fiscal'              -> prefixoFiscal | GOOD 'GOOD_'  AMB 'AMB_'
 *
 * Empresa invalida LANCA (apontamento P1): sem isso, um nome de empresa
 * digitado errado cairia no prefixo vazio e leria a credencial da GOOD —
 * exatamente a mistura entre empresas que este registro existe pra evitar.
 */
function envDaEmpresa(empresa, nome, padrao, tipo) {
  if (!empresa || typeof empresa !== 'object' || !empresa.chave) {
    throw new Error('envDaEmpresa: empresa invalida — resolva por obterEmpresa(chave) antes');
  }
  const prefixo = (tipo === 'fiscal')
    ? (empresa.prefixoFiscal != null ? empresa.prefixoFiscal : empresa.prefixoEnv)
    : empresa.prefixoEnv;
  const valor = process.env[(prefixo || '') + nome];
  return (valor == null || valor === '') ? padrao : valor;
}

const fis = (empresa, nome, padrao) => envDaEmpresa(empresa, nome, padrao, 'fiscal');

const EMPRESAS = {
  good: {
    chave: 'good',
    nome: 'GOOD Import (GIMPO)',
    prefixoEnv: '',
    prefixoFiscal: 'GOOD_',
    prefixoRota: '',
    // Uma empresa precisa de MAIS que a tabela de devolucoes pra ficar
    // isolada (apontamento do Codex): defeitos, espreita, recados e
    // de-para tambem tem tabela propria por empresa.
    tabelas: {
      devolucoes: 'devolucoes', espreitaNotas: 'espreita_notas',
      recados: 'recados', pecasRetiradas: 'pecas_retiradas', skuDepara: 'sku_depara',
    },
    fiscal: {
      // Cada padrao e IDENTICO ao que roda hoje:
      //   lib/bling.js:684     GOOD_ID_EMPRESA_CONTROL || '4956030980'
      //   server.js:4850       GOOD_DEPOSITO_GERAL || '4956031259'
      //   server.js:3939-3940  GOOD_NF_ENTRADA_TIPO || '0'
      //                        GOOD_NATUREZAS_DEVOLUCAO_IDS || '5776118802,15110882187'
      idEmpresaControl:      () => fis(EMPRESAS.good, 'ID_EMPRESA_CONTROL', '4956030980'),
      depositoGeral:         () => fis(EMPRESAS.good, 'DEPOSITO_GERAL', '4956031259'),
      naturezaDevolucao:     () => fis(EMPRESAS.good, 'ID_NATUREZA_DEVOLUCAO_ENTRADA'),
      naturezasDevolucaoIds: () => fis(EMPRESAS.good, 'NATUREZAS_DEVOLUCAO_IDS', '5776118802,15110882187'),
      nfEntradaTipo:         () => fis(EMPRESAS.good, 'NF_ENTRADA_TIPO', '0'),
    },
  },

  ambtotal: {
    chave: 'ambtotal',
    nome: 'AMBTotal',
    prefixoEnv: 'AMB_',
    prefixoFiscal: 'AMB_',
    prefixoRota: '/amb',
    tabelas: {
      devolucoes: 'devolucoes_amb', espreitaNotas: 'espreita_notas_amb',
      recados: 'recados_amb', pecasRetiradas: 'pecas_retiradas_amb', skuDepara: 'sku_depara_amb',
    },
    fiscal: {
      //   bling-AMB.js:331      AMB_ID_EMPRESA_CONTROL || '14901993834'
      //   app-AMB.js:1482,1906  AMB_NATUREZAS_DEVOLUCAO_IDS || AMB_NATUREZA_DEVOLUCAO || '15110882041'
      //
      // ⚠️ O padrao das naturezas e SO '15110882041'. Eu tinha posto
      // '15110882041,15110128838' e o Codex pegou: a segunda passaria a
      // classificar como devolucao de cliente notas que hoje NAO sao —
      // mudanca de comportamento escondida num PR que promete nao mudar
      // nada. Se ela tiver que entrar, entra em PR proprio e testada
      // (sao 66 notas na AMB, medidas em 21/08).
      idEmpresaControl:      () => fis(EMPRESAS.ambtotal, 'ID_EMPRESA_CONTROL', '14901993834'),
      depositoGeral:         () => fis(EMPRESAS.ambtotal, 'DEPOSITO_GERAL', '14888917703'),
      naturezaDevolucao:     () => fis(EMPRESAS.ambtotal, 'ID_NATUREZA_DEVOLUCAO_ENTRADA'),
      naturezasDevolucaoIds: () => fis(EMPRESAS.ambtotal, 'NATUREZAS_DEVOLUCAO_IDS',
                                   process.env.AMB_NATUREZA_DEVOLUCAO || '15110882041'),
      nfEntradaTipo:         () => fis(EMPRESAS.ambtotal, 'NF_ENTRADA_TIPO', '0'),
    },
  },

  // ── GIRASSOL: ficha ABERTA, ainda NAO plugada ───────────────────────
  // Nao e pra cacar id no DevTools: descobrirFicha('girassol', ...)
  // levanta deposito, natureza, situacoes e lojas pelo Bling dela.
  // So o idEmpresaControl precisa de env (GET /empresas da 404).
  //
  // girassol: {
  //   chave: 'girassol', nome: 'Magazine Girassol',
  //   prefixoEnv: 'GIRA_', prefixoFiscal: 'GIRA_', prefixoRota: '/girassol',
  //   tabelas: { devolucoes: 'devolucoes_girassol', espreitaNotas: 'espreita_notas_girassol',
  //              recados: 'recados_girassol', pecasRetiradas: 'pecas_retiradas_girassol',
  //              skuDepara: 'sku_depara_girassol' },
  //   fiscal: { ...mesma forma, SEM padrao cravado... },
  // },
};

const ENVS_OBRIGATORIAS = [
  'BLING_CLIENT_ID', 'BLING_CLIENT_SECRET', 'BLING_REFRESH_TOKEN',
  'ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'ML_REFRESH_TOKEN',
  'USERS',
];

// Banco entra na conta (apontamento do Codex): sem Supabase o servidor
// nao cria cliente e a triagem responde "Supabase nao configurado" —
// dizer pronta:true nesse estado seria mentira. Vale a env da empresa OU
// a compartilhada, que e como funciona hoje.
const ENVS_BANCO = ['SUPABASE_URL', 'SUPABASE_KEY'];

function obterEmpresa(chave) {
  const e = EMPRESAS[String(chave || '').toLowerCase()];
  if (!e) throw new Error('empresa desconhecida: ' + chave);
  return e;
}

function listarEmpresas() { return Object.keys(EMPRESAS).map((k) => EMPRESAS[k]); }

function conferirEmpresa(chave) {
  const e = obterEmpresa(chave);
  const faltando = [];
  ENVS_OBRIGATORIAS.forEach((n) => { if (!envDaEmpresa(e, n)) faltando.push(e.prefixoEnv + n); });
  ENVS_BANCO.forEach((n) => {
    if (!envDaEmpresa(e, n) && !process.env[n]) faltando.push(e.prefixoEnv + n + ' (ou ' + n + ')');
  });
  const fiscalVazio = [];
  Object.keys(e.fiscal).forEach((campo) => {
    const v = e.fiscal[campo];
    const valor = (typeof v === 'function') ? v() : v;
    const vazio = Array.isArray(valor) ? valor.length === 0 : !valor;
    // naturezaDevolucao pode vir da API por NOME — vazia aqui nao reprova
    if (vazio && campo !== 'naturezaDevolucao') fiscalVazio.push(campo);
  });
  return {
    chave: e.chave, nome: e.nome,
    pronta: faltando.length === 0 && fiscalVazio.length === 0,
    envsFaltando: faltando, fiscalSemValor: fiscalVazio,
  };
}

/**
 * DESCOBRE a ficha perguntando pro Bling DAQUELA empresa.
 *
 * Assinatura do cliente segue a do repo — `chamarBling(caminho, opcoes)`,
 * metodo dentro de `opcoes` (lib/bling.js:106, bling-AMB.js:145). Eu
 * tinha escrito `chamarBling('GET', caminho)`: assim a GOOD pediria a URL
 * relativa "GET" e a AMB pediria "/GET", e a descoberta nao acharia nada,
 * em silencio. O Codex pegou.
 *
 * ⚠️ Os clientes NAO LANCAM em erro de HTTP/rede: RESOLVEM com
 * `{ ok:false }`. So try/catch nao ve, e a falha viraria "lista vazia com
 * sucesso" — com 4 chamadas falhando ainda daria pronta:true. Por isso o
 * `ok` e checado explicitamente.
 *
 * AMBIGUIDADE NAO ESCOLHE: um candidato serve; mais de um recusa, mostra
 * os candidatos e diz qual env resolve. E o override configurado e lido
 * ANTES — senao a saida mandaria definir uma env que ninguem leria.
 */
async function descobrirFicha(chave, chamarBling) {
  const e = obterEmpresa(chave);
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  const problemas = [];

  async function lista(caminho, rotulo) {
    let r;
    try { r = await chamarBling(caminho, { method: 'GET' }); }
    catch (err) { problemas.push(rotulo + ': ' + String((err && err.message) || err)); return []; }
    if (r && r.ok === false) {
      problemas.push(rotulo + ': ' + String(r.erro || r.error || r.status || 'falhou'));
      return [];
    }
    const dados = (r && r.data && r.data.data) || (r && r.data) || [];
    return Array.isArray(dados) ? dados : [];
  }

  const depositos = (await lista('/depositos', 'depositos'))
    .map((d) => ({ id: String(d.id), nome: d.descricao || d.nome || '' }));
  let depositoGeral = null;
  const depForcado = fis(e, 'DEPOSITO_GERAL');
  if (depForcado) {
    const achado = depositos.find((d) => d.id === String(depForcado));
    depositoGeral = achado || { id: String(depForcado), nome: '(definido por env)' };
    if (depositos.length && !achado) {
      problemas.push('o deposito de ' + e.prefixoFiscal + 'DEPOSITO_GERAL (' + depForcado + ') nao existe nesta empresa');
    }
  } else {
    const gerais = depositos.filter((d) => norm(d.nome) === 'geral');
    if (gerais.length === 1) depositoGeral = gerais[0];
    else if (gerais.length > 1) problemas.push('mais de um deposito "Geral" — defina ' + e.prefixoFiscal + 'DEPOSITO_GERAL');
    else if (depositos.length) problemas.push('nenhum deposito "Geral" — defina ' + e.prefixoFiscal + 'DEPOSITO_GERAL');
  }

  const naturezas = (await lista('/naturezas-operacoes', 'naturezas'))
    .map((n) => ({ id: String(n.id), nome: n.descricao || '' }));
  let naturezaDevolucao = null;
  const natForcada = fis(e, 'ID_NATUREZA_DEVOLUCAO_ENTRADA');
  if (natForcada) {
    const achada = naturezas.find((n) => n.id === String(natForcada));
    naturezaDevolucao = achada || { id: String(natForcada), nome: '(definida por env)' };
    if (naturezas.length && !achada) {
      problemas.push('a natureza de ' + e.prefixoFiscal + 'ID_NATUREZA_DEVOLUCAO_ENTRADA (' + natForcada + ') nao existe nesta empresa');
    }
  } else {
    const exatas = naturezas.filter((n) => norm(n.nome) === 'devolucao de mercadoria - entrada');
    // "Devolucao de COMPRA" fica na lista logo ANTES da certa e nao serve:
    // pegar a errada joga a NF de devolucao na natureza errada.
    const perto = naturezas.filter((n) => /devolu/.test(norm(n.nome)) && /entrada/.test(norm(n.nome)) && !/compra/.test(norm(n.nome)));
    if (exatas.length === 1) naturezaDevolucao = exatas[0];
    else if (exatas.length > 1) problemas.push('mais de uma natureza com o nome exato — defina ' + e.prefixoFiscal + 'ID_NATUREZA_DEVOLUCAO_ENTRADA');
    else if (perto.length === 1) naturezaDevolucao = perto[0];
    else if (perto.length > 1) problemas.push('mais de uma natureza de "devolucao ... entrada" — defina ' + e.prefixoFiscal + 'ID_NATUREZA_DEVOLUCAO_ENTRADA');
    else if (naturezas.length) problemas.push('nenhuma natureza de "devolucao ... entrada" nesta empresa');
  }

  const situacoes = (await lista('/situacoes', 'situacoes'))
    .map((x) => ({ id: String(x.id), nome: x.nome || x.descricao || '' }));
  const lojas = (await lista('/lojas', 'lojas'))
    .map((x) => ({ id: String(x.id), nome: x.descricao || x.nome || '' }));

  const idEmpresaControl = e.fiscal.idEmpresaControl ? e.fiscal.idEmpresaControl() : null;
  if (!idEmpresaControl) {
    problemas.push('idEmpresaControl NAO vem por API (GET /empresas da 404) — defina ' + e.prefixoFiscal + 'ID_EMPRESA_CONTROL');
  }

  return {
    empresa: e.chave, nome: e.nome,
    pronta: problemas.length === 0,
    descoberto: {
      depositoGeral, naturezaDevolucao,
      totalDepositos: depositos.length, totalNaturezas: naturezas.length,
      totalSituacoes: situacoes.length, totalLojas: lojas.length,
    },
    manual: { idEmpresaControl },
    // Listas VIVAS, de proposito nao viram snapshot: a AMB valida
    // deposito contra bling.listarDepositos() na hora do pedido
    // (app-AMB.js:1052). Congelar faria o sistema recusar deposito novo
    // — ou aceitar um que ja foi removido do Bling.
    listas: { depositos, naturezas, situacoes, lojas },
    problemas,
  };
}

module.exports = {
  EMPRESAS, ENVS_OBRIGATORIAS, ENVS_BANCO,
  envDaEmpresa, obterEmpresa, listarEmpresas, conferirEmpresa, descobrirFicha,
};
