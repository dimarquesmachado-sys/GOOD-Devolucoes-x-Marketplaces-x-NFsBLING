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
  const EM_VOO = new WeakMap();   // resposta -> { ctrl, timer } enquanto o corpo nao foi lido
  const t0 = agora();
  const total = Number(totalMs) > 0 ? Number(totalMs) : 20000;
  let estourouEm = null;
  const restante = () => Math.max(0, total - (agora() - t0));
  return {
    totalMs: total,
    restante,
    decorrido: () => agora() - t0,
    estourou: () => estourouEm !== null || restante() <= 0,
    // b743: le o corpo DENTRO do prazo — o fetch() resolve nos cabecalhos, mas o JSON pode demorar. Parse invalido
    // = null (como o `.json().catch(() => null)` de antes); estouro = PrazoEstourado.
    // b746 (Codex #608, 3o apontamento): o estouro ABORTA A REQUISICAO pelo mesmo AbortController do fetch — e o unico
    // jeito de soltar o socket e o leitor do JSON (resp.body.cancel() falha com stream travada por resp.json(), e o
    // Promise.race deixava a conexao aberta; bipes repetidos contra um proxy gotejando acumulavam conexoes).
    async json(resp, etapa = 'corpo') {
      const vivo = EM_VOO.get(resp);
      const sobra = restante();
      if (sobra <= 0) {
        estourouEm = estourouEm || agora();
        if (vivo) { clearTimeout(vivo.timer); vivo.ctrl.abort(); }
        throw new PrazoEstourado(etapa, agora() - t0, total);
      }
      if (!vivo) {
        // resposta que nao veio deste prazo.fetch: nao tem como abortar — so corre contra o relogio
        let timer;
        const limite = new Promise((_, rej) => { timer = setTimeout(() => { estourouEm = agora(); rej(new PrazoEstourado(etapa, agora() - t0, total)); }, sobra); });
        try { return await Promise.race([resp.json().catch(() => null), limite]); }
        finally { clearTimeout(timer); }
      }
      try {
        return await resp.json();
      } catch (e) {
        if (vivo.ctrl.signal.aborted) { estourouEm = agora(); throw new PrazoEstourado(etapa, agora() - t0, total); }
        return null;   // JSON invalido = null, como antes
      } finally { clearTimeout(vivo.timer); EM_VOO.delete(resp); }
    },
    // etapa: nome curto pro motivo ("lista", "refresh"...).
    // O timer e o AbortController FICAM ARMADOS depois dos cabecalhos: quem le o corpo e prazo.json(resp), que os
    // desarma ao terminar. Se ninguem ler o corpo, o estouro aborta a conexao sozinho (nada fica pendurado).
    async fetch(url, opts = {}, etapa = 'chamada') {
      const sobra = restante();
      if (sobra <= 0) { estourouEm = estourouEm || agora(); throw new PrazoEstourado(etapa, agora() - t0, total); }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), sobra);
      let resp;
      try {
        resp = await fetchImpl(url, Object.assign({}, opts, { signal: ctrl.signal }));
      } catch (e) {
        clearTimeout(timer);
        if (ctrl.signal.aborted) { estourouEm = agora(); throw new PrazoEstourado(etapa, agora() - t0, total); }
        throw e;
      }
      EM_VOO.set(resp, { ctrl, timer });
      return resp;
    },
  };
}

module.exports = { criarPrazo, PrazoEstourado };
