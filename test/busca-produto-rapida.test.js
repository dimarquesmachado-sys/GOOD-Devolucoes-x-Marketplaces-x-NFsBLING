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

// ── ⚠️ e a GRAVAÇÃO resolve o SKU pelo índice ───────────────────────
//
// [stated 11/09] "pra gravar q ta o problema so, ta demorado d+ pra gravar"
//
// A gravação fazia TRÊS esperas na fila do porteiro:
//   `buscarProdutoBlingPorSku` → 2 chamadas (lista + detalhe)
//   o detalhe para saber se é KIT → 1 chamada
//
// ⚠️ E o produto JÁ foi escolhido na busca: o front manda o SKU de um item
// que a lista devolveu, e o índice local tem o `id` dele. Não há por que
// perguntar ao Bling quem é o produto.
{
  const i = srv.indexOf("app.post('/api/defeitos/adicionar'");
  const rota = srv.slice(i, i + 12000);
  ok(/resolvido pelo INDICE \(sem ir no Bling\)/.test(rota),
     '⚠️ a gravacao resolve o SKU pelo indice');
  ok(/if \(!rP\) rP = await buscarProdutoBlingPorSku\(sku\)/.test(rota),
     '  e o Bling segue como RESERVA (SKU que o indice nao tem)');

  // ⚠️ o id tem que vir junto: sem ele, o detalhe do kit nao tem o que
  // consultar e a gravacao quebraria
  ok(/doIndice && doIndice\.id/.test(rota),
     '  ⚠️ e so usa o indice quando ha `id` (o detalhe do kit precisa dele)');
}

// ── revisao Codex #253: o match do indice NAO pode ignorar acento ──
//
// `normProd` usa NFD (tira acento) pra tolerar CAIXA — mas junto com isso
// fundia SKUs que so diferem no acento (ex: "ABCA" e "ABCÁ"), e o `.find()`
// pegava o primeiro da lista: produto ERRADO. `buscarProdutoBlingPorSku`
// (o caminho antigo) nunca ignorou acento: so tenta exato, depois so-caixa.
{
  const i = srv.indexOf("app.post('/api/defeitos/adicionar'");
  const rota = srv.slice(i, i + 12000);
  const iResolveIndice = rota.indexOf('IDX_PROD.ts && Array.isArray');
  const trechoIndice = rota.slice(iResolveIndice, rota.indexOf('if (!rP) rP ='));
  ok(!/normProd/.test(trechoIndice),
     '⚠️ o match do SKU no indice nao usa normProd (nao ignora mais acento)');
  ok(/=== skuClean/.test(trechoIndice) && /toUpperCase\(\) === skuUpper/.test(trechoIndice),
     '  e replica o criterio do Bling: exato, depois so-caixa');
}

// ── revisao Codex #253: indice desatualizado (produto excluido/renomeado)
//
// O indice e populado so no BOOT (ou rebuild manual de debug). Se o
// produto sumiu do Bling depois disso, o 404 na chamada de detalhe (o
// UNICO ponto que ainda fala com o Bling pra esse SKU) tem que barrar a
// gravacao, nao ser engolido pelo catch generico.
{
  const i = srv.indexOf("app.post('/api/defeitos/adicionar'");
  const rota = srv.slice(i, i + 12000);
  ok(/prodViaIndice && rDet && rDet\.ok === false && rDet\.status === 404/.test(rota),
     '⚠️ 404 no detalhe de produto resolvido pelo indice barra a gravacao');
  const iCheck = rota.indexOf('prodViaIndice && rDet');
  const iDet = rota.indexOf('const det = (rDet.ok');
  ok(iCheck > 0 && iCheck < iDet,
     '  e a checagem roda ANTES de usar `det` (senao o kit-check mascara o erro)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
