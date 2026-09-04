// ============================================================
// b232.3 - RITMO GLOBAL DAS CHAMADAS AO BLING
//
// [Codex] "When two operators perform name searches concurrently, or a
// search overlaps another Bling task, each handler independently starts
// three detail calls, so the account can still send six or more requests
// in the same second."
//
// O erro que eu repeti: tratei o limite como se fosse DA REQUISICAO. A
// cota do Bling e DA CONTA — dois estoquistas buscando ao mesmo tempo, ou
// uma busca junto com o indice de nomes reconstruindo, estouram igual.
// (Mesma familia do item 3 do meu checklist: "trava/contador/orcamento
// sao GLOBAIS do servidor, nao por requisicao".)
//
// Este modulo e um portao unico do processo: no maximo N chamadas por
// segundo, seja qual for a rota que pediu. Quem chega alem disso espera.
// ============================================================

const LIMITE_POR_SEGUNDO = Number(process.env.BLING_REQ_POR_SEGUNDO || 3);
const JANELA_MS = 1000;

// instantes das chamadas liberadas na ultima janela
let liberadas = [];
let fila = Promise.resolve();

/**
 * Espera ate ser a vez desta chamada. Serializa a DECISAO (nao a chamada),
 * entao varias rotas podem estar em voo ao mesmo tempo — o que se controla
 * e o ritmo com que elas PARTEM.
 */
function aguardarVez() {
  const minhaVez = fila.then(async () => {
    for (;;) {
      const agora = Date.now();
      liberadas = liberadas.filter((t) => agora - t < JANELA_MS);
      if (liberadas.length < LIMITE_POR_SEGUNDO) {
        liberadas.push(agora);
        return;
      }
      // espera o mais antigo sair da janela
      const esperar = JANELA_MS - (agora - liberadas[0]) + 5;
      await new Promise((ok) => setTimeout(ok, Math.max(5, esperar)));
    }
  });
  // a fila segue mesmo se alguem estourar, senao trava o processo inteiro
  fila = minhaVez.catch(() => {});
  return minhaVez;
}

/**
 * Envolve uma chamada ao Bling no ritmo global.
 * Uso: `await comRitmo(() => buscarNFePorId(id))`
 */
async function comRitmo(fn) {
  await aguardarVez();
  return fn();
}

/** Quantas chamadas foram liberadas na ultima janela (pra diagnostico). */
function estado() {
  const agora = Date.now();
  liberadas = liberadas.filter((t) => agora - t < JANELA_MS);
  return { limite_por_segundo: LIMITE_POR_SEGUNDO, na_janela: liberadas.length };
}

module.exports = { comRitmo, aguardarVez, estado, LIMITE_POR_SEGUNDO };
