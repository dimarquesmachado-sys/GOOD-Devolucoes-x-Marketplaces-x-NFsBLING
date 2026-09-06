'use strict';

/**
 * lib/provisionar-empresa.js — cria as tabelas de uma empresa nova.
 * ---------------------------------------------------------------------
 * [stated 05/09] "não tem como criar automático essas tabelas supabase, a
 * partir do momento q for embarcar a empresa nova?"
 *
 * Fluxo completo de embarcar um CNPJ, depois da Fase 3:
 *
 *   1. a ficha entra em `lib/empresas.js`        (chave, prefixo, tabelas)
 *   2. as credenciais entram no Render           (com o prefixo dela)
 *   3. ESTA PEÇA cria as 5 tabelas no Supabase   ← automático
 *   4. `descobrirFicha` levanta os ids fiscais    (pergunta pro Bling)
 *
 * ---------------------------------------------------------------------
 * COMO FUNCIONA
 *
 * A chave que o sistema usa (service_role) lê e grava LINHAS — ela não cria
 * tabela, porque o PostgREST não expõe DDL. Então quem executa é uma função
 * no próprio banco (`sql/provisionar-empresa.sql`, colada uma vez), e daqui
 * a gente só a chama.
 *
 * A função copia a estrutura das tabelas da AMB (`LIKE ... INCLUDING ALL`):
 * a empresa nova nasce com as mesmas colunas, defaults, índices e RLS. Sem
 * risco de faltar uma coluna que só apareceria meses depois, quando um card
 * viesse vazio.
 *
 * ---------------------------------------------------------------------
 * ⚠️ AS TRAVAS EXISTEM DOS DOIS LADOS, DE PROPÓSITO
 *
 * A função no banco valida o sufixo e recusa `_amb`/`_good`. Este módulo
 * valida de novo antes de chamar. Não é redundância à toa: aqui o erro sai
 * legível pra quem pediu, e lá é a última linha de defesa se alguém chamar
 * a função por outro caminho.
 */

const { obterEmpresa } = require('./empresas');

const SUFIXO_VALIDO = /^_[a-z0-9]{2,12}$/;
const RESERVADOS = new Set(['_amb', '_good']);

/**
 * Descobre o sufixo das tabelas de uma empresa a partir da ficha dela.
 *
 * Não invento o sufixo: leio do nome real das tabelas no registro. Se a
 * ficha disser `devolucoes_gira`, o sufixo é `_gira` — assim o que for
 * criado bate exatamente com o que o sistema vai procurar.
 */
function sufixoDaFicha(ficha) {
  const nome = ficha && ficha.tabelas && ficha.tabelas.devolucoes;
  if (!nome) return { ok: false, erro: 'a ficha nao diz o nome da tabela de devolucoes' };
  if (nome === 'devolucoes') {
    return { ok: false, erro: 'esta empresa usa as tabelas SEM sufixo (a GOOD) — nada a criar' };
  }
  const m = /^devolucoes(_[a-z0-9]+)$/.exec(nome);
  if (!m) {
    return { ok: false, erro: `nao consigo deduzir o sufixo de "${nome}" — esperado devolucoes_xxx` };
  }
  return { ok: true, sufixo: m[1] };
}

/**
 * Cria as tabelas da empresa. Idempotente: rodar duas vezes não duplica
 * nem apaga nada — a função do banco responde "ja existia".
 *
 * @param {string} chaveEmpresa  a chave no registro ('girassol')
 * @param {object} cliente       cliente supabase já conectado (service_role)
 */
async function provisionarEmpresa(chaveEmpresa, cliente) {
  if (!cliente) return { ok: false, erro: 'sem cliente supabase' };

  let ficha;
  try { ficha = obterEmpresa(chaveEmpresa); }
  catch (e) { return { ok: false, erro: e.message }; }

  const s = sufixoDaFicha(ficha);
  if (!s.ok) return { ok: false, erro: s.erro };

  // ⚠️ as mesmas duas travas da função do banco, aqui pra dar erro legível
  if (!SUFIXO_VALIDO.test(s.sufixo)) {
    return { ok: false, erro: `sufixo "${s.sufixo}" fora do formato _[a-z0-9]{2,12}` };
  }
  if (RESERVADOS.has(s.sufixo)) {
    return { ok: false, erro: `sufixo "${s.sufixo}" pertence a uma empresa que ja existe` };
  }

  const r = await cliente.rpc('provisionar_empresa', { sufixo: s.sufixo });
  if (r.error) {
    // o caso mais provável na primeira vez: o SQL não foi colado ainda
    const faltaFuncao = /function .*provisionar_empresa.* does not exist|PGRST202/i
      .test(r.error.message || '');
    return {
      ok: false,
      erro: faltaFuncao
        ? 'a funcao nao existe no banco — cole sql/provisionar-empresa.sql no SQL Editor do Supabase (uma vez so)'
        : r.error.message,
    };
  }

  const linhas = r.data || [];
  const erros = linhas.filter((x) => String(x.resultado || '').startsWith('ERRO'));
  return {
    ok: erros.length === 0,
    empresa: chaveEmpresa,
    sufixo: s.sufixo,
    tabelas: linhas,
    erro: erros.length ? erros.map((x) => x.tabela + ': ' + x.resultado).join(' | ') : undefined,
  };
}

module.exports = { provisionarEmpresa, sufixoDaFicha, SUFIXO_VALIDO, RESERVADOS };
