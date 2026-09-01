// lib/erro-de-codigo.js
//
// SEPARA erro MEU de falha do marketplace.
//
// POR QUE ISTO EXISTE: tres bugs identicos passaram despercebidos neste
// repo, e os tres pelo mesmo motivo — um try/catch em volta transformava
// ReferenceError em "erro da integracao":
//
//   1. `buscarNFnoBlingPorOrderId` na AMB, que nunca existiu no modulo
//   2. `buscarPedidoBlingPorId` na AMB, idem
//   3. `magaluCancelados` na GOOD, nunca importado
//
// O terceiro so foi achado porque o dono abriu a rota crua e mandou o JSON:
//   "magalu_erro": "magaluCancelados is not defined"
//
// Ate ali, a tela dizia "falha do Magalu" e eu procurava o problema na
// ponte deles. O Magalu NUNCA apareceu no card da GOOD por causa disso.
//
// ReferenceError, TypeError e SyntaxError sao BUGS — nao "o marketplace
// esta fora do ar". Quem le a tela precisa saber a diferenca: uma coisa se
// resolve esperando, a outra so se resolve com codigo.

const TIPOS_DE_BUG = ['ReferenceError', 'TypeError', 'SyntaxError', 'RangeError'];

/** true = isto e bug no nosso codigo, nao falha da integracao. */
function ehBugNosso(e) {
  if (!e) return false;
  const nome = String(e.name || '');
  if (TIPOS_DE_BUG.includes(nome)) return true;
  // erro serializado (veio de outro processo ou de um JSON.stringify)
  const txt = String(e.message || e || '');
  return /is not defined|is not a function|Cannot read propert|undefined is not/.test(txt);
}

/**
 * A mensagem que vai pra tela, marcada quando o erro e nosso.
 * O dono nao precisa saber o que e ReferenceError — precisa saber que
 * esperar nao vai adiantar.
 */
function paraTela(e, contexto) {
  const txt = String((e && e.message) || e || 'erro').slice(0, 200);
  if (!ehBugNosso(e)) return txt;
  return '⚠️ ERRO NO NOSSO CODIGO (nao e falha do marketplace): ' + txt
    + (contexto ? ' — em ' + contexto : '')
    + '. Esperar nao resolve; isto precisa de correcao.';
}

/**
 * Grita no log quando o erro e nosso.
 * Falha de integracao e rotina e vira ruido; bug nosso tem que saltar aos
 * olhos de quem olhar o log do Render.
 */
function registrar(e, contexto) {
  if (ehBugNosso(e)) {
    console.error('🐛🐛🐛 BUG NO CODIGO' + (contexto ? ' [' + contexto + ']' : '') + ':',
      (e && e.stack) || e);
  } else {
    console.warn('[integracao]' + (contexto ? ' [' + contexto + ']' : ''),
      String((e && e.message) || e).slice(0, 200));
  }
  return e;
}

module.exports = { ehBugNosso, paraTela, registrar, TIPOS_DE_BUG };
