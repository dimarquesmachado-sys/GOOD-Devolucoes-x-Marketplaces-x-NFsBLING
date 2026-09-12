// Roda com: node test/imagem-da-variacao.test.js
//
// ⚠️ CASO REAL (11/09): vários defeitos na lista aparecendo com ícone de
// caixa em vez da foto. O padrão saltou no print — `288-VAR`, `801s-BP`,
// `RA-45-GOLD-ASH`, `KJDD-E-003-GOLD`. **Todos variações.**
//
// NO BLING, A FOTO DA VARIAÇÃO COSTUMA ESTAR NO PAI. A variação herda
// visualmente, mas o registro dela vem sem imagem própria — e as 3
// tentativas da rota procuravam só por ela.
//
// v8.3.2 (revisão do Codex no #254) - a 1a versão adivinhava o pai cortando
// o sufixo da SKU no texto (`288-VAR` -> `288`), rodava ANTES do detalhe do
// próprio produto (podia esconder a foto de verdade da variação) e aceitava
// o 1o item da listagem por esse código adivinhado sem checar se batia —
// pra um SKU comum como `ABC-RED`, um produto `ABC` qualquer no cadastro
// virava "o pai" e a foto errada ficava fixa no cache. Corrigido: o pai só
// vem do campo `produtoPai` que o próprio Bling devolve (nunca de um
// palpite em cima do texto da SKU), e só depois que lista + detalhe do
// próprio produto já procuraram e não acharam foto.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const src = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'rotas-admin-nf.js'), 'utf8');
const i = src.indexOf("app.get('/api/produto/imagem/:id'");
// ⚠️ recorto ate o FIM do handler contando chaves, nao por janela fixa: a
// de 6000 chars quebrou quando o bloco cresceu (o `pai_da_variacao` foi
// parar em 6215). DECIMA vez hoje que janela fixa me da resposta errada.
let prof = 0;
let fim = i;
for (let k = src.indexOf('{', i); k < src.length; k++) {
  if (src[k] === '{') prof++;
  else if (src[k] === '}') { prof--; if (prof === 0) { fim = k; break; } }
}
const rota = src.slice(i, fim);

// ── ⚠️ a rota tenta o produto pai, mas SO pelo metadado do Bling ────
{
  ok(/pai_da_variacao/.test(rota),
     '⚠️ a rota tenta o PAI da variacao quando nao acha a foto');

  // ⚠️ nao pode mais adivinhar o pai cortando o sufixo da SKU no texto —
  // foi isso que deixou "ABC-RED" herdar a foto de um "ABC" sem parentesco
  ok(!/chave\.replace\(\/\[-_\]/.test(rota),
     '  ⚠️ NAO adivinha mais o pai cortando o sufixo da SKU no texto');

  // o id do pai tem que vir do campo que o Bling devolve, do detalhe
  // (prioridade) ou da lista — nunca de regex em cima da SKU
  ok(/detalhe\.produtoPai && detalhe\.produtoPai\.id/.test(rota),
     '  o pai vem do `produtoPai` do DETALHE do proprio produto (prioridade)');
  ok(/prod\.produtoPai && prod\.produtoPai\.id/.test(rota),
     '  ou do `produtoPai` que ja veio na LISTAGEM, como reserva');

  // e busca o DETALHE do pai — a listagem do Bling nao traz imagem
  ok(/rPai = await chamarBling\(`https:\/\/api\.bling\.com\.br\/Api\/v3\/produtos\/\$\{encodeURIComponent\(idPai\)\}`\)/.test(rota),
     '  e busca o DETALHE do pai pelo id (a listagem nao traz imagem)');

  // ⚠️ b301.2: e o ORCAMENTO continua — a abordagem do robo e melhor (o
  // Bling DIZ quem e o pai), mas ainda gasta 1 chamada por produto sem
  // foto, e a lista pede 12 de uma vez. Foi assim que a cota estourou e
  // TODAS as fotos sumiram.
  ok(/function podeGastarNaFoto/.test(src),
     '⚠️ ha orcamento de chamadas pra foto');
  ok(/if \(idPai && podeGastarNaFoto\(\)\)/.test(rota),
     '  e a busca do pai passa por ele');
}

// ── ⚠️ e SO depois que o detalhe do PROPRIO produto foi conferido ──
{
  const iDetalheProprio = rota.indexOf("// 4) o DETALHE do proprio produto");
  const iPaiDaVariacao = rota.indexOf('idPai');
  ok(iDetalheProprio > 0 && iPaiDaVariacao > iDetalheProprio,
     '⚠️ o pai da variacao so entra DEPOIS do detalhe do proprio produto'
     + ' (senao esconde a foto real da variacao)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
