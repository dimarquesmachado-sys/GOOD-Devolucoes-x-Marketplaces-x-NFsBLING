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
let INTERATIVOS_ESPERANDO = 0;
let fila = Promise.resolve();

/**
 * Espera ate ser a vez desta chamada. Serializa a DECISAO (nao a chamada),
 * entao varias rotas podem estar em voo ao mesmo tempo — o que se controla
 * e o ritmo com que elas PARTEM.
 */
/**
 * b237 - PRIORIDADE. [stated] "já tá uns 2 minutos procurando"
 *
 * O portao e global, entao a busca do estoquista — que espera com a caixa
 * na mao — ficava ATRAS das rotinas de fundo (espreita, indice de nomes).
 *
 * A primeira versao nao funcionou: eu serializava tudo numa `fila` unica, e
 * quem entrava antes travava a ordem, por mais que o de fundo "cedesse".
 * Agora sao DUAS filas e um despachante — o de fundo so e chamado quando
 * nao ha interativo esperando.
 *
 * Nao muda a taxa: continua no maximo N por segundo. Muda so a ORDEM.
 */
const filaInterativa = [];
const filaDeFundo = [];
let despachando = false;

function podeAgora() {
  const agora = Date.now();
  liberadas = liberadas.filter((t) => agora - t < JANELA_MS);
  return liberadas.length < LIMITE_POR_SEGUNDO;
}

async function despachar() {
  if (despachando) return;
  despachando = true;
  try {
    while (filaInterativa.length || filaDeFundo.length) {
      if (!podeAgora()) {
        const espera = JANELA_MS - (Date.now() - liberadas[0]) + 5;
        await new Promise((ok) => setTimeout(ok, Math.max(5, espera)));
        continue;
      }
      // interativo SEMPRE primeiro
      const proximo = filaInterativa.shift() || filaDeFundo.shift();
      if (!proximo) break;
      liberadas.push(Date.now());
      proximo();
    }
  } finally { despachando = false; }
}

function aguardarVez(opcoes = {}) {
  return new Promise((liberar) => {
    (opcoes.fundo ? filaDeFundo : filaInterativa).push(liberar);
    despachar();
  });
}

/**
 * Envolve uma chamada ao Bling no ritmo global.
 * Uso: `await comRitmo(() => buscarNFePorId(id))`
 */
async function comRitmo(fn, opcoes = {}) {
  if (!opcoes.fundo) INTERATIVOS_ESPERANDO++;
  try {
    await aguardarVez(opcoes);
    return await fn();
  } finally {
    if (!opcoes.fundo) INTERATIVOS_ESPERANDO--;
  }
}

/** Quantas chamadas foram liberadas na ultima janela (pra diagnostico). */
function estado() {
  const agora = Date.now();
  liberadas = liberadas.filter((t) => agora - t < JANELA_MS);
  return { limite_por_segundo: LIMITE_POR_SEGUNDO, na_janela: liberadas.length };
}

module.exports = { comRitmo, aguardarVez, estado, LIMITE_POR_SEGUNDO };
