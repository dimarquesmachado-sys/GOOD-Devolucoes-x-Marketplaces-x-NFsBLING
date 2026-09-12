// Roda com: node test/busca-produto-rapida.test.js
//
// ⚠️ [stated 11/09] "demorou 1 minuto +- pra buscar 1 produto (...) No
// checkout offline, tem um botão de PRODUTO, lá consigo pesquisar (...) e
// aparece rapidão o resultado"
//
// A pista do dono resolveu: a rota JÁ TINHA o índice local (`IDX_PROD`,
// milhares de produtos em memória) — mas só o consultava DEPOIS de tentar
// 3 chamadas ao Bling. Cada uma passa pela fila do porteiro e paga a
// latência da API.
//
// E: "pra gravar também tá super demorado. já passaram 2 minutos" — a
// gravação faz 1 chamada para descobrir se o produto é kit, e ela espera na
// mesma fila.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// ── ⚠️ na BUSCA, o índice vem ANTES do Bling ────────────────────────
{
  const i = srv.indexOf("app.get('/api/produtos/buscar'");
  const rota = srv.slice(i, i + 9000);

  const iIdx = rota.indexOf('IDX_PROD.ts && Array.isArray');
  const iBling = rota.indexOf('chamarBling');
  ok(iIdx > 0, 'a busca consulta o indice local');
  ok(iIdx < iBling,
     '⚠️ e o indice vem ANTES do Bling (era depois de 3 chamadas)');

  // ⚠️ e o Bling continua como reserva — tirar seria perder o produto que
  // o índice ainda não tem
  ok(iBling > 0, '  e o Bling segue como RESERVA (nao foi removido)');
  ok(/resolvido pelo INDICE/.test(rota),
     '  com log dizendo quando resolveu sem ir no Bling');
}

// ── ⚠️ e a GRAVAÇÃO guarda o detalhe do produto ─────────────────────
//
// A chamada que descobre se é kit é necessária — mas a composição de um
// produto quase não muda, e o caso comum é lançar várias peças do mesmo
// SKU.
{
  const i = srv.indexOf("app.post('/api/defeitos/adicionar'");
  const rota = srv.slice(i, i + 9000);
  ok(/_DET_PROD_CACHE/.test(rota), 'a gravacao guarda o detalhe do produto');
  ok(/6 \* 3600 \* 1000/.test(rota), '  por 6h (composicao muda pouco)');

  // ⚠️ erro NÃO pode ir pro cache: viraria erro permanente
  ok(/if \(rDet && rDet\.ok\) global\._DET_PROD_CACHE\.set/.test(rota),
     '  ⚠️ e SO guarda resposta boa (erro em cache = erro permanente)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
