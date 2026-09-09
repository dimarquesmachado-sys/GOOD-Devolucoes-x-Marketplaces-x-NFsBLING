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

// b253 - ⚠️ O TETO LOCAL DESCEU DE 3 PRA 2,5/s.
//
// O limite do Bling e POR CONTA (CNPJ), nao por processo: 3 req/s valendo
// pra conta inteira. A conta `good` e dividida entre ESTE servico e o
// modulo `good` do Mover-Pedidos — entao 3/s local em cada um SOMA 6/s e
// estoura a conta.
//
// 400 ms entre chamadas = ~2,5/s. Medido com janela deslizante de 1s na
// Expedicao: pior caso 3 chamadas, no teto. Sugestao deles, e adoto o
// mesmo numero pra os tres servicos ficarem coerentes.
const LIMITE_POR_SEGUNDO = Number(process.env.BLING_REQ_POR_SEGUNDO || 2.5);

// b253.1 (Codex, P1) - ⚠️ CONTAR NAO E ESPACAR, e eu tinha documentado uma
// coisa e implementado outra.
//
// `liberadas.length < 2.5` deixa passar 3 chamadas NA HORA (0 < 2.5,
// 1 < 2.5, 2 < 2.5) e outras 3 um segundo depois. Ou seja: eu escrevi no
// commit "400 ms entre chamadas" e entreguei RAJADA DE 3 — o fallback
// nunca teve o freio prometido.
//
// O espacamento e o que a conta sente: 3 chamadas juntas estouram o
// limite do Bling no instante, mesmo que a media do segundo feche.
const INTERVALO_MIN_MS = Math.round(1000 / (LIMITE_POR_SEGUNDO || 1));
let ultimaLiberacao = 0;
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
// b253 - cliente do porteiro; nasce DESLIGADO (sem BLING_RITMO_URL +
// BLING_RITMO_KEY, `pedirPermissao` devolve 'local' e este arquivo age
// sozinho, como sempre agiu).
const porteiro = require('./ritmo-porteiro');

const filaInterativa = [];
const filaDeFundo = [];
let despachando = false;

function podeAgora() {
  const agora = Date.now();
  liberadas = liberadas.filter((t) => agora - t < JANELA_MS);
  // b253.1: as DUAS travas. O intervalo minimo impede a rajada; a janela
  // continua como teto da media.
  if (agora - ultimaLiberacao < INTERVALO_MIN_MS) return false;
  return liberadas.length < Math.ceil(LIMITE_POR_SEGUNDO);
}

/** Quanto falta pra proxima liberacao (pro despachante nao girar a toa). */
function esperaAte() {
  const porIntervalo = INTERVALO_MIN_MS - (Date.now() - ultimaLiberacao);
  const porJanela = liberadas.length >= Math.ceil(LIMITE_POR_SEGUNDO)
    ? JANELA_MS - (Date.now() - liberadas[0])
    : 0;
  return Math.max(5, porIntervalo, porJanela);
}

async function despachar() {
  if (despachando) return;
  despachando = true;
  try {
    while (filaInterativa.length || filaDeFundo.length) {
      if (!podeAgora()) {
        await new Promise((ok) => setTimeout(ok, esperaAte()));
        continue;
      }
      // interativo SEMPRE primeiro
      const ehInterativo = filaInterativa.length > 0;
      const proximo = filaInterativa.shift() || filaDeFundo.shift();
      if (!proximo) break;

      // b253 - o PORTEIRO decide antes do balde local.
      //
      // As duas filas mapeiam direto na prioridade dele: interativo ->
      // `operacao`, fundo -> `fundo`. O porteiro trata as duas com tetos
      // diferentes (inclusive de cota diaria), entao rotina de fundo cede
      // pra bipagem — que e o que o estoquista sente.
      const permissao = await porteiro.pedirPermissao(ehInterativo ? 'operacao' : 'fundo');

      if (permissao.via === 'espere') {
        // ⚠️ ARMADILHA 2: CONTENCAO NAO VIRA LIBERACAO. O porteiro esta
        // SAUDAVEL e mandou esperar — devolvo o pedido pra fila. Chamar o
        // Bling assim seria furar a coordenacao justo quando ela importa.
        // Falhar aberto so vale pra erro de TRANSPORTE, que o cliente ja
        // trata devolvendo 'local'.
        (ehInterativo ? filaInterativa : filaDeFundo).unshift(proximo);

        // b253.1 (Codex, P2) - ⚠️ ITEM DE FUNDO NEGADO NAO SEGURA A
        // BIPAGEM. O despachante e UNICO: dormir 5s por causa de uma
        // rotina de fundo deixaria uma busca do estoquista esperando o
        // mesmo tanto — mesmo o porteiro tendo cota SEPARADA pras duas
        // prioridades, e podendo liberar a interativa na hora.
        //
        // Entao: espera curta se ha interativo na fila, e o loop volta pra
        // pegar ele primeiro.
        const esperaCheia = permissao.ms || 250;
        const espera = (!ehInterativo && filaInterativa.length)
          ? Math.min(esperaCheia, 50)
          : esperaCheia;
        await new Promise((ok) => setTimeout(ok, espera));
        continue;
      }

      liberadas.push(Date.now());
      ultimaLiberacao = Date.now();
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
