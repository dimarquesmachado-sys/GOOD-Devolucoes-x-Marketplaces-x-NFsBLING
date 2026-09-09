'use strict';

/**
 * lib/token-leitor.js — lê o token vigente do dono (Mover-Pedidos).
 * ---------------------------------------------------------------------
 * PASSO 2 do plano multi-empresa. O Mover-Pedidos é o dono eleito da
 * renovação de Bling e ML (contrato-empresas.json, `passo_2_eleicao`), e
 * este módulo é o outro lado: aqui a gente LÊ em vez de renovar.
 *
 * ---------------------------------------------------------------------
 * ⚠️ POR QUE ISTO EXISTE, e não é organização
 *
 * O refresh token do ML é de USO ÚNICO. Enquanto os dois serviços renovam
 * as mesmas contas, um consome o refresh do outro — e o segundo só descobre
 * quando o access dele expira. Não é risco futuro: é corrida ativa hoje,
 * nas três empresas.
 *
 * Este módulo é o primeiro passo para matá-la. Ele NÃO desliga a renovação
 * local: ela continua como rede até confirmarmos um período de operação
 * normal. O corte vem depois, ML primeiro.
 *
 * ---------------------------------------------------------------------
 * O CONTRATO DE LEITURA (fechado com o dono em 08/09)
 *
 *   GET {MOVER}/interno/token/:empresa/:integracao
 *   Header: x-token-leitura: <ADMIN_TOKEN_LEITURA_KEY>
 *   → 200 { access, expira_em: null, versao }
 *
 *   404  a empresa não tem essa integração (GOOD/tiktok)
 *   501  integração ainda sem leitor (magalu, tiktok)
 *   502  falha de aquisição — re-pedir em instantes
 *   400  se mandar `?k=` (a querystring foi banida: credencial em URL fica
 *        em log de proxy e em URL copiada)
 *
 * ⚠️ `expira_em` vem `null` HONESTO: os managers do dono renovam por 401 e
 * não expõem o instante. Por isso o 401 é o sinal, não o relógio.
 *
 * ⚠️ CONCORRÊNCIA é problema do DONO: leituras simultâneas da mesma
 * (empresa, integração) compartilham uma aquisição lá dentro. Podemos
 * martelar a rota — o refresh de uso único continua único.
 */

const axios = require('axios');

const MOVER_URL = process.env.MOVER_PEDIDOS_URL
  || 'https://mover-pedidos-aguardando-x-atendido.onrender.com';
const CHAVE = process.env.ADMIN_TOKEN_LEITURA_KEY || '';

// ⚠️ CACHE: memória, por (empresa, integração). NUNCA em disco — token vivo
// não vai pra arquivo, e reinício tem que limpar.
const cache = new Map();

// ⚠️ TTL de 5 min E invalidação no 401 — OS DOIS. O TTL não substitui o
// 401: cachear 5 min e ignorar o 401 faria um token revogado sobreviver a
// janela inteira.
const TTL_MS = 5 * 60 * 1000;

const chaveCache = (empresa, integracao) => empresa + '/' + integracao;

/**
 * b257 - O QUE FAZER, dada a política do eixo e o motivo do leitor.
 *
 * Substitui o `lerToken` cru: em vez de "veio null, use o local", cada
 * combinação tem uma decisão explícita.
 *
 * @returns {{usar: 'remoto'|'local'|'falhar', access, motivo, estado}}
 */
async function resolverToken(empresa, integracao) {
  const politica = politicaDe(empresa, integracao);

  // ⚠️ `bloqueado` nao chama nada: configuracao invalida nao pode disparar
  // chamada destrutiva enquanto ninguem olha.
  if (politica === 'bloqueado') {
    return { usar: 'falhar', access: null, politica, estado: 'bloqueado',
             motivo: 'eixo BLOQUEADO por configuracao — nenhuma chamada sai' };
  }

  if (politica === 'local') {
    return { usar: 'local', access: null, politica, estado: 'local',
             motivo: 'politica local: nem consulto o dono' };
  }

  const r = await lerTokenDetalhado(empresa, integracao);

  if (r.estado === 'ok') {
    return { usar: 'remoto', access: r.access, politica, estado: 'ok',
             versao: r.versao, do_cache: !!r.do_cache };
  }

  // ⚠️ EM `remoto` NAO EXISTE REDE. Cair no token local aqui seria
  // ressuscitar em silencio o renovador que a gente acabou de desligar — e
  // reabrir a corrida do refresh de uso unico sem ninguem perceber.
  if (politica === 'remoto') {
    return { usar: 'falhar', access: null, politica, estado: r.estado,
             motivo: `sem token do dono (${r.estado}) e a politica e REMOTO: `
               + 'falho explicito em vez de renovar escondido' };
  }

  // sombra: mede e recupera no local
  return { usar: 'local', access: null, politica, estado: r.estado,
           motivo: `sombra: dono devolveu ${r.estado}, uso a rede local` };
}

/** Compatível com quem já usa: devolve só o access, ou null. */
async function lerToken(empresa, integracao) {
  const r = await resolverToken(empresa, integracao);
  return r.usar === 'remoto' ? r.access : null;
}

/** Esquece o token guardado — chamar no primeiro 401 do marketplace. */
function invalidar(empresa, integracao) {
  cache.delete(chaveCache(empresa, integracao));
}

/**
 * Devolve o access token vigente, ou null se não der para ler.
 *
 * ⚠️ NUNCA LANÇA. Quem chama tem a renovação local como rede: se este
 * módulo falhar, o sistema continua com o token de sempre. Derrubar a
 * bipagem porque o outro serviço está fora seria trocar um problema
 * invisível por um visível.
 */
// b257 - ⚠️ O RETORNO E TIPADO. `null` misturava 6 situacoes que pedem
// coisas diferentes depois do corte:
//   ok               tem token
//   ausente          404: a empresa nao tem essa integracao
//   nao_implementado 501: o dono ainda nao tem leitor pra ela
//   indisponivel     502/timeout/DNS: passageiro, re-pedir
//   nao_configurado  falta chave aqui
//   config_invalida  503/404/400: erro de configuracao, retry nao ajuda
//
// Quem chama decide pela POLITICA + o motivo, nao por "veio null".
const R = (estado, access, extra) => ({ estado, access: access || null, ...(extra || {}) });

async function lerTokenDetalhado(empresa, integracao) {
  if (!CHAVE) return R('nao_configurado');

  const k = chaveCache(empresa, integracao);
  const guardado = cache.get(k);
  if (guardado && (Date.now() - guardado.em) < TTL_MS) {
    if (guardado.definitivo) return R(guardado.estado || 'ausente');
    return R('ok', guardado.access, { do_cache: true, versao: guardado.versao });
  }

  try {
    const r = await axios.get(
      `${MOVER_URL}/interno/token/${encodeURIComponent(empresa)}/${encodeURIComponent(integracao)}`,
      {
        headers: { 'x-token-leitura': CHAVE },
        timeout: 8000,
        validateStatus: () => true,
      },
    );

    if (r.status === 200 && r.data && r.data.access) {
      cache.set(k, { access: r.data.access, em: Date.now(), versao: r.data.versao });
      return R('ok', r.data.access, { versao: r.data.versao });
    }

    // 404 = a empresa não tem a integração; 501 = ainda sem leitor lá.
    // Os dois são resposta CORRETA, não erro — e não vale re-pedir.
    // b257 - ⚠️ ERRO DE CONFIGURACAO. 503 = o dono sem chave configurada;
    // 400 = conta invalida ou credencial na URL. Retry nao ajuda em nenhum
    // — e o pior e que, misturados com `indisponivel`, uma configuracao
    // quebrada parece "o dono esta fora hoje" e ninguem investiga.
    // ⚠️ este modulo NAO tem circuito (aquilo e do `ritmo-porteiro`). Eu
    // copiei a linha de la e ela lancou `CIRCUITO_MS is not defined` — o
    // erro caia no catch generico e virava `indisponivel`, escondendo
    // justamente o caso que este bloco veio distinguir. So o teste pegou.
    if (r.status === 503 || r.status === 400) {
      console.warn(`[token-leitor] ${k}: HTTP ${r.status} — CONFIGURACAO, nao indisponibilidade`);
      return R('config_invalida', null, { status: r.status });
    }

    if (r.status === 404 || r.status === 501) {
      // ⚠️ 404/501 sao cacheados como definitivos — mas guardo QUAL, senao
      // "empresa nao tem essa integracao" e "o dono ainda nao implementou"
      // viram a mesma coisa, e config errada parece operacao normal.
      const estado = r.status === 404 ? 'ausente' : 'nao_implementado';
      cache.set(k, { access: null, em: Date.now(), definitivo: true, estado });
      return R(estado, null, { status: r.status });
    }

    // 502 = falha de aquisição no dono. A renovação segue em background lá,
    // então re-pedir em instantes funciona. NÃO cacheio o vazio: cachear
    // uma falha passageira por 5 min é transformar um soluço em apagão.
    if (r.status === 502) {
      console.warn(`[token-leitor] ${k}: dono nao conseguiu adquirir agora (502)`);
      return R('indisponivel', null, { status: 502, passageiro: true });
    }

    console.warn(`[token-leitor] ${k}: resposta inesperada ${r.status}`);
    return R('indisponivel', null, { status: r.status });
  } catch (e) {
    // rede fora, timeout, DNS... a rede local cobre
    console.warn(`[token-leitor] ${k}: ${e.message}`);
    return R('indisponivel', null, { erro: e.message, passageiro: true });
  }
}

/** Estado do cache, sem expor token. Para o /health. */
// b255 (Codex, P0) - ⚠️ QUEM REALMENTE LE DO DONO, HOJE.
//
// O parecer pegou uma coisa que o /health verde escondia: o leitor so esta
// no caminho da GOOD (`lib/bling.js` e `lib/ml.js`). A AMB usa
// `lib-AMB/bling-AMB.js` e `ml-AMB.js`, que continuam renovando LOCALMENTE
// — e a Girassol nem esta ativa aqui.
//
// Ou seja: o corte NAO e uma chave unica do servico. E por (empresa,
// integracao), e o /health precisa dizer isso, senao alguem le "ligado:
// true" e corta a AMB achando que ela le do dono.
// b257 (Codex, P0) - A POLITICA POR EIXO, e o que cada estado permite.
//
// "Desligar a renovacao" nao pode ser apagar env var nem torcer pra ninguem
// chamar uma rota: ha renovacao por 401, batimento preventivo e rota
// administrativa de renovacao forcada. Sem estado explicito, o corte e
// invisivel e irreversivel na hora errada.
//
//   local      comportamento antigo: nem chama o dono
//   sombra     LE o dono e mede, mas pode recuperar no local  <- hoje
//   remoto     nunca usa nem agenda refresh local
//   bloqueado  configuracao invalida: nao faz chamada destrutiva
//
// ⚠️ A politica vem de env var, entao o corte e REVERSIVEL sem deploy —
// que e o que ele precisa, porque nao usa terminal.
//
// ⚠️ E ROLLBACK PRA `local` NAO E REDE CONFIAVEL: o refresh que esta no
// ambiente pode ja ter sido consumido pelo dono. Voltar exige um refresh
// sabidamente vigente, nao o valor velho que sobrou la.
const POLITICA_PADRAO = 'sombra';

function politicaDe(empresa, integracao) {
  const chaveEnv = 'TOKEN_POLITICA_' + String(empresa).toUpperCase() + '_' + String(integracao).toUpperCase();
  const bruta = String(process.env[chaveEnv] || process.env.TOKEN_POLITICA_PADRAO || POLITICA_PADRAO).toLowerCase();
  return ['local', 'sombra', 'remoto', 'bloqueado'].includes(bruta) ? bruta : POLITICA_PADRAO;
}

const EIXOS = {
  'good/bling': 'le do dono',
  'good/ml': 'le do dono',
  'ambtotal/bling': 'renova LOCAL (nao ligado ao dono)',
  'ambtotal/ml': 'renova LOCAL (nao ligado ao dono)',
  'girassol/*': 'empresa nao ativa neste servico',
};

function diagnostico() {
  const itens = [];
  for (const [k, v] of cache.entries()) {
    itens.push({
      chave: k,
      tem_token: !!v.access,
      idade_s: Math.round((Date.now() - v.em) / 1000),
      definitivo: !!v.definitivo,
    });
  }
  return {
    configurado: !!CHAVE,
    // ⚠️ o corte e por EIXO, nao pelo servico inteiro
    eixos: EIXOS,
    // b257 - a POLITICA EFETIVA de cada eixo. E o que diz, sem adivinhacao,
    // se o corte ja aconteceu e onde.
    politica: {
      'good/bling': politicaDe('good', 'bling'),
      'good/ml': politicaDe('good', 'ml'),
      'ambtotal/bling': politicaDe('ambtotal', 'bling'),
      'ambtotal/ml': politicaDe('ambtotal', 'ml'),
      _como_mudar: 'env TOKEN_POLITICA_<EMPRESA>_<INTEGRACAO> = local|sombra|remoto|bloqueado',
      _reversivel_sem_deploy: true,
      _atencao_rollback: 'voltar pra `local` exige um refresh SABIDAMENTE vigente — '
        + 'o valor no ambiente pode ja ter sido consumido pelo dono',
    },
    pronto_pra_cortar: ['good/bling', 'good/ml'],
    ainda_local: ['ambtotal/bling', 'ambtotal/ml'],
    dono: MOVER_URL,
    ttl_s: TTL_MS / 1000,
    em_cache: itens.length,
    itens,
  };
}

module.exports = { lerToken, lerTokenDetalhado, resolverToken, politicaDe, invalidar, diagnostico, TTL_MS };
