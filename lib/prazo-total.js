'use strict';
// b743 — V-07 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): PRAZO TOTAL PRA UMA SEQUENCIA DE CHAMADAS.
//
// O bipe da Shopee faz ate 4 chamadas ao proxy em sequencia (lista, indice por tracking, refresh de 120 dias,
// pedido cancelado) e nenhuma tinha prazo: o estoquista ficava 30-60s olhando o spinner, sem saber se a Shopee
// estava fora ou se "nao e Shopee". Esta peca da um RELOGIO UNICO pra sequencia inteira:
//   const prazo = criarPrazo(20000);           // 20s pro conjunto
//   const r = await prazo.fetch(url, opts);    // cada chamada recebe so o tempo que SOBROU (AbortController)
//   prazo.estourou()                           // true depois do estouro — quem chama devolve resultado DEGRADADO
// Estourou = lanca PrazoEstourado (instanceof) com `etapa` e `decorridoMs`; quem chama transforma em
// { degradado: true, motivo } em vez de "nao achei". Sem `fetch` global (Node < 18) nao e usado.
class PrazoEstourado extends Error {
  constructor(etapa, decorridoMs, totalMs) {
    super(`prazo de ${Math.round(totalMs / 1000)}s estourado em "${etapa}" (${Math.round(decorridoMs / 1000)}s)`);
    this.name = 'PrazoEstourado'; this.etapa = etapa; this.decorridoMs = decorridoMs; this.totalMs = totalMs;
  }
}

function criarPrazo(totalMs, { agora = () => Date.now(), fetchImpl = global.fetch } = {}) {
  const t0 = agora();
  const total = Number(totalMs) > 0 ? Number(totalMs) : 20000;
  let estourouEm = null;
  const restante = () => Math.max(0, total - (agora() - t0));
  return {
    totalMs: total,
    restante,
    decorrido: () => agora() - t0,
    estourou: () => estourouEm !== null || restante() <= 0,
    // etapa: nome curto pro motivo ("lista", "refresh"...)
    async fetch(url, opts = {}, etapa = 'chamada') {
      const sobra = restante();
      if (sobra <= 0) { estourouEm = estourouEm || agora(); throw new PrazoEstourado(etapa, agora() - t0, total); }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), sobra);
      try {
        return await fetchImpl(url, Object.assign({}, opts, { signal: ctrl.signal }));
      } catch (e) {
        if (ctrl.signal.aborted) { estourouEm = agora(); throw new PrazoEstourado(etapa, agora() - t0, total); }
        throw e;
      } finally { clearTimeout(timer); }
    },
  };
}

module.exports = { criarPrazo, PrazoEstourado };
