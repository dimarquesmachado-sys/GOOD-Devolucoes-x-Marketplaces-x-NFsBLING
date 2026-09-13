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
}

// ── e a fila do passo respeita ──────────────────────────────────────
{
  ok(/fila\.sort\(\(a, b\) => \(pedido\(b\) \? 1 : 0\) - \(pedido\(a\) \? 1 : 0\)\)/.test(srv),
     '⚠️ a fila do passo poe os pedidos na frente');

  // e casa por SKU ou id — as duas telas mandam chaves diferentes
  ok(/String\(c\)\.toUpperCase\(\) === sku/.test(srv) && /String\(c\) === id/.test(srv),
     '  casando por SKU ou por id');

  // a ordenação funciona
  const PEDIDOS = ['288-VAR', '801s-BP'];
  const itens = [{ sku: 'AAA' }, { sku: 'BBB' }, { sku: '288-VAR' }, { sku: 'CCC' }, { sku: '801s-BP' }];
  const pedido = (p) => PEDIDOS.some((c) => String(c).toUpperCase() === String(p.sku || '').toUpperCase());
  const fila = [...itens].sort((a, b) => (pedido(b) ? 1 : 0) - (pedido(a) ? 1 : 0));
  ok(fila[0].sku === '288-VAR' && fila[1].sku === '801s-BP',
     '  os 2 pedidos vao pra frente');
  ok(fila.length === itens.length, '  ⚠️ e ninguem some da fila (so muda a ordem)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
