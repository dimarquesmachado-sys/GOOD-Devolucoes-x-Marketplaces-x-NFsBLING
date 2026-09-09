'use strict';

/**
 * lib/ritmo-porteiro.js — cliente do porteiro de ritmo do Bling.
 * ---------------------------------------------------------------------
 * ⚠️ O PROBLEMA QUE ISTO RESOLVE, e que o portão local NÃO resolve:
 *
 * O limite do Bling é POR CONTA (CNPJ): 3 req/s e 120 mil/dia, valendo
 * para a conta inteira em qualquer módulo. A conta `good` é dividida entre
 * ESTE serviço e o módulo `good` do Mover-Pedidos.
 *
 * O portão local (`lib/ritmo-bling.js`) segura ~3 req/s DESTE processo. O
 * outro serviço segura os dele. Somados, estouram a conta — e foi assim que
 * um backfill em dia útil deixou a bipagem da Expedição sem pedido: "a
 * operação sempre perde primeiro".
 *
 * O porteiro mora no Mover-Pedidos e mantém um balde por conta.
 *
 * ---------------------------------------------------------------------
 * ⚠️ O PORTEIRO NÃO É PONTO ÚNICO DE FALHA
 *
 * O portão local continua existindo como rede: se o porteiro cair, cada
 * serviço segue com o ritmo próprio. Uma pane nele não pode parar a
 * operação inteira.
 *
 * Mas "falhar aberto" tem lugar certo — e é só erro de TRANSPORTE. As
 * quatro regras abaixo vieram do Codex na revisão do cliente da Expedição,
 * e todas eram "falhar aberto no lugar errado".
 *
 * ---------------------------------------------------------------------
 * NASCE DESLIGADO: sem `BLING_RITMO_URL` E `BLING_RITMO_KEY`, este módulo
 * não faz nada e o portão local age sozinho. Dá para subir com segurança
 * antes de o porteiro existir.
 */

const axios = require('axios');

const URL_BASE = process.env.BLING_RITMO_URL || '';
const CHAVE = process.env.BLING_RITMO_KEY || '';
const CONTA = process.env.BLING_RITMO_CONTA || 'good';

const LIGADO = !!(URL_BASE && CHAVE);

// ⚠️ ARMADILHA 3: circuito. Se o porteiro aceita conexão e não responde,
// cada chamada paga o timeout — 100 chamadas viram ~100s de espera. No
// primeiro timeout marco indisponível por 30s e uso só o ritmo local.
const CIRCUITO_MS = 30 * 1000;
let circuitoAte = 0;

// pausa global da conta, quando o porteiro avisa que houve 429
let pausaAte = 0;

const TIMEOUT_MS = 4000;

function disponivel() {
  return LIGADO && Date.now() >= circuitoAte;
}

async function chamar(caminho, params) {
  const r = await axios.post(`${URL_BASE}${caminho}`, null, {
    params,
    // ⚠️ a credencial vai no HEADER. `?k=` na URL leva 400 de propósito —
    // credencial em querystring fica em log de proxy e em URL copiada.
    headers: { 'x-ritmo-key': CHAVE },
    timeout: TIMEOUT_MS,
    validateStatus: () => true,
  });
  return r;
}

/**
 * Pede permissão para UMA chamada ao Bling.
 *
 * @returns {'pode'|'espere'|'local'} — 'local' significa: siga só com o
 *   ritmo local (o porteiro está fora ou desligado).
 */
async function pedirPermissao(prioridade) {
  // b253.1 (Codex, P1) - ⚠️ A PAUSA VEM ANTES DA DISPONIBILIDADE.
  //
  // Estava ao contrario: com o circuito aberto, `disponivel()` devolvia
  // 'local' e NUNCA se olhava a pausa. Entao um 429 tomado durante o
  // fallback registrava `pausaAte` e o retry seguinte chamava o Bling
  // assim mesmo — martelando uma conta que ACABOU de dizer "pare".
  //
  // A pausa e informacao LOCAL e valida: quem a registrou fui eu, ao levar
  // o 429. Ela nao depende do porteiro estar de pe.
  if (Date.now() < pausaAte) {
    return { via: 'espere', ms: Math.min(pausaAte - Date.now(), 5000) };
  }

  if (!disponivel()) return { via: 'local' };

  let r;
  try {
    r = await chamar('/bling-ritmo/permissao', { conta: CONTA, prioridade });
  } catch (e) {
    // ⚠️ ARMADILHA 3: erro de TRANSPORTE (timeout, DNS, conexão) abre o
    // circuito. É o único caso em que falhar aberto é certo.
    circuitoAte = Date.now() + CIRCUITO_MS;
    console.warn(`[ritmo-porteiro] ${e.message} — circuito aberto por 30s, uso o ritmo local`);
    return { via: 'local' };
  }

  // 503 = porteiro sem chave configurada; 404 = chave errada; 400 = conta
  // inválida. Nenhum melhora com retry, e todos são erro de CONFIGURAÇÃO —
  // aviso alto e caio no local.
  if (r.status === 503 || r.status === 404 || r.status === 400) {
    circuitoAte = Date.now() + CIRCUITO_MS;
    console.warn(`[ritmo-porteiro] HTTP ${r.status} (configuracao) — uso o ritmo local por 30s`);
    return { via: 'local' };
  }

  if (r.status !== 200 || !r.data || typeof r.data !== 'object') {
    // ⚠️ ARMADILHA 1: formato desconhecido cai no LOCAL, nunca libera.
    console.warn(`[ritmo-porteiro] resposta inesperada (${r.status}) — uso o ritmo local`);
    return { via: 'local' };
  }

  const d = r.data;

  // ⚠️ ARMADILHA 1: `=== true` ESTRITO. `{"ok":"false"}` é a string
  // "false", que é VERDADEIRA em JS — uma resposta degradada assim
  // liberaria a fila furando até o ritmo local.
  if (d.ok === true) return { via: 'porteiro' };

  // pausa global da conta: houve 429 recente em algum serviço
  if (typeof d.pausa_s === 'number' && d.pausa_s > 0) {
    pausaAte = Date.now() + d.pausa_s * 1000;
    console.warn(`[ritmo-porteiro] conta ${CONTA} em pausa por ${d.pausa_s}s (${d.motivo || '429'})`);
    return { via: 'espere', ms: Math.min(d.pausa_s * 1000, 5000) };
  }

  if (typeof d.esperar_ms === 'number' && d.esperar_ms >= 0) {
    return { via: 'espere', ms: Math.max(5, Math.min(d.esperar_ms, 5000)) };
  }

  // `ok:false` sem instrução: trato como espera curta, não como liberação
  return { via: 'espere', ms: 250 };
}

/**
 * ⚠️ ARMADILHA 4: avisa o porteiro de um 429, inclusive quando o
 * `Retry-After` é MAIOR que a pausa que já está valendo.
 *
 * Sem isto, os outros serviços ficam com o prazo curto do primeiro 429 e
 * voltam a consumir a conta antes da hora.
 */
async function avisar429(retryAfterS) {
  const s = Number(retryAfterS) || 60;
  // atualizo a minha pausa local também, e SEMPRE para o maior prazo
  const novoAte = Date.now() + s * 1000;
  if (novoAte > pausaAte) pausaAte = novoAte;

  if (!disponivel()) return false;
  try {
    const r = await chamar('/bling-ritmo/aviso-429', { conta: CONTA, retry_after_s: s });
    // b253.1 (Codex, P2) - ⚠️ CONFERIR SE ELE ACEITOU. Com
    // `validateStatus: () => true`, um 400/404/500 resolvia normalmente e
    // eu reportava sucesso — a pausa CENTRAL nao foi registrada, os outros
    // servicos nao souberam, e ninguem ficou sabendo do silencio.
    if (r.status < 200 || r.status >= 300) {
      console.warn(`[ritmo-porteiro] o porteiro RECUSOU o aviso-429 (HTTP ${r.status}) — a pausa central NAO foi registrada`);
      circuitoAte = Date.now() + CIRCUITO_MS;
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[ritmo-porteiro] nao consegui avisar do 429: ${e.message}`);
    circuitoAte = Date.now() + CIRCUITO_MS;
    return false;
  }
}

/** Avisa que a conta voltou a responder bem (limpa a pausa no porteiro). */
async function avisarOk() {
  pausaAte = 0;
  if (!disponivel()) return false;
  try {
    await chamar('/bling-ritmo/aviso-ok', { conta: CONTA });
    return true;
  } catch (e) { return false; }
}

function diagnostico() {
  return {
    ligado: LIGADO,
    conta: CONTA,
    circuito_aberto: Date.now() < circuitoAte,
    circuito_volta_em_s: Math.max(0, Math.round((circuitoAte - Date.now()) / 1000)),
    pausa_ativa: Date.now() < pausaAte,
    pausa_termina_em_s: Math.max(0, Math.round((pausaAte - Date.now()) / 1000)),
  };
}

module.exports = { pedirPermissao, avisar429, avisarOk, diagnostico, LIGADO, CONTA };
