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
async function lerToken(empresa, integracao) {
  if (!CHAVE) return null;   // ainda não configurado — silêncio, tem rede

  const k = chaveCache(empresa, integracao);
  const guardado = cache.get(k);
  if (guardado && (Date.now() - guardado.em) < TTL_MS) return guardado.access;

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
      return r.data.access;
    }

    // 404 = a empresa não tem a integração; 501 = ainda sem leitor lá.
    // Os dois são resposta CORRETA, não erro — e não vale re-pedir.
    if (r.status === 404 || r.status === 501) {
      cache.set(k, { access: null, em: Date.now(), definitivo: true });
      return null;
    }

    // 502 = falha de aquisição no dono. A renovação segue em background lá,
    // então re-pedir em instantes funciona. NÃO cacheio o vazio: cachear
    // uma falha passageira por 5 min é transformar um soluço em apagão.
    if (r.status === 502) {
      console.warn(`[token-leitor] ${k}: dono nao conseguiu adquirir agora (502) — uso a rede local`);
      return null;
    }

    console.warn(`[token-leitor] ${k}: resposta ${r.status} — uso a rede local`);
    return null;
  } catch (e) {
    // rede fora, timeout, DNS... a rede local cobre
    console.warn(`[token-leitor] ${k}: ${e.message} — uso a rede local`);
    return null;
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
    pronto_pra_cortar: ['good/bling', 'good/ml'],
    ainda_local: ['ambtotal/bling', 'ambtotal/ml'],
    dono: MOVER_URL,
    ttl_s: TTL_MS / 1000,
    em_cache: itens.length,
    itens,
  };
}

module.exports = { lerToken, invalidar, diagnostico, TTL_MS };
