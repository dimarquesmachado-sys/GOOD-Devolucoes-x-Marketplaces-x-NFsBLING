// Roda com: node test/fotos-prioriza-a-tela.test.js
//
// [stated 13/09] "uns 70% sem imagem."
//
// ⚠️ A CAUSA, medida: a LISTAGEM do Bling não devolve imagem — só o DETALHE
// de cada produto traz. São 1.091 produtos a 350ms = **6,4 minutos** de
// trabalho contínuo, e o Render REINICIA quando fica ocioso. O cache vive em
// memória, então cada reinício joga tudo fora e o passo recomeça do zero.
//
// E com a conta em pausa, as poucas chamadas que passam eram gastas em
// produtos que ninguém está olhando — porque a varredura segue a ordem do
// catálogo.
//
// 📌 O conserto de verdade é cache no banco (migração, que não faço
// sozinho). O que dá para fazer sem isso é a ORDEM.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const rota = fs.readFileSync(path.join(RAIZ, 'lib', 'rotas-admin-nf.js'), 'utf8');

// ── a tela avisa o que precisa ──────────────────────────────────────
{
  ok(/const FOTOS_PEDIDAS = \[\];/.test(srv), 'ha uma lista de SKUs pedidos');
  ok(/anotarFotoPedida: \(chave\) => \{/.test(srv), 'o server expoe o registro');
  ok(/deps\.anotarFotoPedida\(chave\)/.test(rota), '  e a rota da foto registra');

  // ⚠️ teto: sem ele, uma tela com muitos itens encheria a lista e
  // "prioritário" perderia o sentido
  ok(/if \(FOTOS_PEDIDAS\.length > 200\) FOTOS_PEDIDAS\.shift\(\)/.test(srv),
     '⚠️ com teto (senao tudo vira prioritario, e nada e)');

  // revisao Codex #272 (P2): so registra DEPOIS que o indice ja disse que
  // nao tem a foto agora — senao fura a fila de detalhe com quem o indice
  // ja tinha imagem pronta pra devolver, gastando cota sem precisar
  const iRota = rota.indexOf("app.get('/api/produto/imagem/:id'");
  const iIdx = rota.indexOf("via: 'indice'", iRota);
  const iAnota = rota.indexOf('deps.anotarFotoPedida(chave)', iRota);
  ok(iIdx > 0 && iAnota > iIdx,
     '⚠️ o registro do pedido vem DEPOIS da consulta ao indice, nao antes');
}

// ── e a fila do passo respeita, mesmo pedido DEPOIS do inicio ───────
{
  // revisao Codex #272 (P1): a 1a versao so ordenava a fila UMA VEZ, no
  // snapshot de antes do loop comecar. Um pedido que chegasse depois da
  // varredura ja rodando NUNCA era priorizado (o `EAN_RODANDO` impede
  // reconstruir a fila) — exatamente o cenario que o passo existe pra
  // resolver (Render reiniciando antes do fim). Agora cada item e
  // escolhido NA HORA de processar (`proximoDaFila`), consultando
  // `FOTOS_PEDIDAS` de novo a cada passo.
  ok(/const proximoDaFila = \(\) => \{/.test(srv),
     '⚠️ a escolha do proximo item e dinamica (nao um sort de uma vez so)');
  ok(/const idx = fila\.findIndex\(pedido\);/.test(srv),
     '  ⚠️ e ela re-consulta os pedidos a cada item, nao so no comeco');
  ok(/while \(\(p = proximoDaFila\(\)\)\)/.test(srv),
     '  o loop de baixo usa essa escolha dinamica');

  // e casa por SKU ou id — as duas telas mandam chaves diferentes
  ok(/String\(c\)\.toUpperCase\(\) === sku/.test(srv) && /String\(c\) === id/.test(srv),
     '  casando por SKU ou por id');

  // a escolha dinamica funciona, INCLUSIVE pra quem pede DEPOIS de
  // itens ja terem sido processados (o caso que a 1a versao perdia)
  const FOTOS_PEDIDAS = ['288-VAR'];
  const pedido = (p) => FOTOS_PEDIDAS.some((c) => String(c).toUpperCase() === String(p.sku || '').toUpperCase());
  const proximoDaFila = (fila) => {
    if (FOTOS_PEDIDAS.length) {
      const idx = fila.findIndex(pedido);
      if (idx !== -1) return fila.splice(idx, 1)[0];
    }
    return fila.shift();
  };
  const fila = [{ sku: 'AAA' }, { sku: 'BBB' }, { sku: 'CCC' }, { sku: 'DDD' }];
  const processados = [proximoDaFila(fila)];         // AAA, ninguem pedido ainda
  FOTOS_PEDIDAS.push('CCC');                          // pedido chega NO MEIO da varredura
  processados.push(proximoDaFila(fila));              // CCC deve furar a fila
  processados.push(proximoDaFila(fila));
  processados.push(proximoDaFila(fila));
  ok(processados[0].sku === 'AAA', '  antes de qualquer pedido, segue a ordem do catalogo');
  ok(processados[1].sku === 'CCC',
     '⚠️ pedido que chega DEPOIS do inicio da varredura AINDA fura a fila (o bug do #272)');
  ok(processados.map(p => p.sku).sort().join(',') === 'AAA,BBB,CCC,DDD',
     '  ⚠️ e ninguem some da fila (so muda a ordem)');
  ok(fila.length === 0, '  a fila esvazia por completo');
}

// ── e a prioridade CHEGA de volta na tela que pediu ─────────────────
{
  // revisao Codex #272 (P1): furar a fila de nada adianta se a rota so
  // atualiza o INDICE em segundo plano e nunca avisa a tela — cada
  // chamador (buscarFotosDefeitos/buscarFotosItens/buscarFotosDefeito)
  // faz UMA requisicao e nao repete. Sem essa espera curta, a foto so
  // apareceria num recarregamento manual mesmo com a prioridade
  // funcionando certinho.
  const iRota = rota.indexOf("app.get('/api/produto/imagem/:id'");
  const iAnota = rota.indexOf('deps.anotarFotoPedida(chave);', iRota);
  const iEspera = rota.indexOf('await sleep(300)', iRota);
  const iPriorizado = rota.indexOf("via: 'indice_priorizado'", iRota);
  const iTry = rota.indexOf('try {', iRota);
  ok(iAnota > 0 && iEspera > iAnota,
     '⚠️ depois de registrar o pedido, espera uma chance curta do passo priorizado entregar');
  ok(iPriorizado > iEspera, '  e devolve a foto (marcando de onde veio) se ela chegar a tempo');
  ok(iTry > iPriorizado,
     '  ⚠️ so cai no caminho sincrono do Bling (reserva) se a espera nao resolver');

  // e o registro ACORDA o passo na hora, em vez de esperar o retry de
  // 1500ms — senao a espera curta acima quase sempre estoura sem nada
  const iAnotaFn = srv.indexOf('anotarFotoPedida: (chave) => {');
  const corpoAnota = srv.slice(iAnotaFn, srv.indexOf('\n  },', iAnotaFn));
  ok(/if \(!EAN_RODANDO\) enriquecerEansEmBackground\(\);/.test(corpoAnota),
     '⚠️ anotar o pedido acorda o passo de enriquecimento na hora, se ele estiver parado');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
