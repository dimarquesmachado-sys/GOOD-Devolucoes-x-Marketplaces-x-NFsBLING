// Roda com: node test/indice-frio-falha-vazio.test.js
//
// Achado do Codex (revisao inline do #220, em lib/nf-nomes.js:279):
//
//   "When the first index build exhausts its 429 retries or gets another
//   non-OK response before publishing page 3, construirIndiceInterno()
//   records erroBusca but still assigns IDX.ts; consequently this new
//   condition reports montando: false even though the index is empty or
//   incomplete (...) repeated name searches continue returning an
//   unqualified 404."
//
// Cenario: o BOOT sobe, a 1a pagina do /nfe da HTTP ruim (nao-429, entao
// sem retentativa) ANTES do 1o checkpoint de parcial (pagina 3). O indice
// fica vazio (`totalNFs === 0`) mas `erroBusca` marcado.
//
// ⚠️ SEM O CONSERTO: `IDX.ts = Date.now()` era incondicional, carimbando
// o indice como "completo" mesmo vazio. `montando` (`!IDX.ts`, b275) virava
// FALSE, a tela engolia o aviso, e como `vencido` (em buscarPorNome) tambem
// le `IDX.ts`, a busca ficava 30 MINUTOS repetindo "nao encontrado" seco.

const criar = require('../lib/nf-nomes.js');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

(async () => {
  const nf = criar({
    // HTTP 500 na 1a pagina: nao e 429, entao nao ha retentativa — o
    // laco quebra imediatamente com totalNFs = 0.
    chamarBling: async () => ({ ok: false, status: 500 }),
  });

  await nf.construirIndice();

  const st = nf.statusIndice();
  ok(st.total_nfs === 0, 'o build frio que falha na pagina 1 nao junta NF nenhuma');
  ok(!!st.erro, '  e o erro fica registrado (nao silencioso)');
  ok(st.quente === false, '  ⚠️ mas NAO fica "quente" — carimbar ts o marcaria como completo');
  ok(st.completo === false, '  e "completo" tambem reflete a falha');

  const r = await nf.buscarPorNome('CHARLES SOBRENOME TESTE');
  ok(r.montando === true,
     '⚠️ a busca sabe que ainda esta montando (nao "nao encontrado" seco)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
