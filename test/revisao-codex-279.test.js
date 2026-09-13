// Roda com: node test/revisao-codex-279.test.js
//
// Terceiro apontamento P2 do Codex no #279 (os outros dois — rodadas
// cancelam ao fechar/buscar de novo, e a tela para de insistir em variacao
// orfa — ja tem cobertura em test/foto-de-todos-os-cards.test.js).
//
// `proximoDaFila` RETIRA o item da `fila` local antes da chamada ao Bling.
// Se essa chamada falha por transitorio, o item so volta quando a varredura
// INTEIRA do catalogo termina (minutos) — bem depois das ~12 rodadas de
// 700ms que a tela de defeitos faz. `recolocarPedidoNaFila` reinsere quem
// foi PEDIDO explicitamente, com um teto de tentativas.

const fs = require('fs');
const path = require('path');
const { entreMarcadores } = require('./_recorte');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');

// ── pedido explicito que falha por transitorio volta pra fila ────────
{
  ok(/const recolocarPedidoNaFila = \(p\) => \{/.test(srv),
     'o passo de enriquecimento expoe recolocarPedidoNaFila (apontamento do Codex #279)');

  const corpoLoop = entreMarcadores(srv,
    'while ((p = proximoDaFila())) {', "EAN_PROGRESSO.concluido = true;");
  ok(/\} else if \(pedido\(p\)\) \{\s*recolocarPedidoNaFila\(p\);/.test(corpoLoop),
     '⚠️ resposta que NAO deu certo (r.ok falso) recoloca, se foi PEDIDO pela tela');
  ok(/catch \(e\) \{[\s\S]*if \(pedido\(p\)\) recolocarPedidoNaFila\(p\);/.test(corpoLoop),
     '  ⚠️ e excecao (timeout, rede) tambem recoloca nas mesmas condicoes');

  const corpoRecoloca = entreMarcadores(srv,
    'const MAX_RETENTATIVAS_PEDIDO = 3;', '\n  (async () => {');
  ok(/if \(p\._retentativasFoto <= MAX_RETENTATIVAS_PEDIDO\) fila\.push\(p\);/.test(corpoRecoloca),
     '⚠️ com TETO — sem ele, um pedido que nunca responde travaria o resto'
     + ' da fila (ele seria sempre o "proximo pedido")');

  // comportamento de verdade: a mesma logica de recolocar, isolada
  const pedido = (p, FOTOS_PEDIDAS) => FOTOS_PEDIDAS.some((c) => String(c).toUpperCase() === String(p.sku || '').toUpperCase());
  const MAX = 3;
  const recolocarPedidoNaFila = (p, fila) => {
    p._retentativasFoto = (p._retentativasFoto || 0) + 1;
    if (p._retentativasFoto <= MAX) fila.push(p);
  };
  const FOTOS_PEDIDAS = ['ORFAO-VAR'];
  const fila = [];
  const item = { sku: 'ORFAO-VAR' };
  for (let i = 0; i < 5; i++) {
    if (pedido(item, FOTOS_PEDIDAS)) recolocarPedidoNaFila(item, fila);
  }
  ok(fila.length === MAX,
     '⚠️ recoloca ate o teto (3 vezes) e para — nao fica reinserindo pra sempre');
  ok(item._retentativasFoto === 5, '  ⚠️ mas continua contando (so para de EMPURRAR de volta)');

  // e um item que NAO foi pedido nao recebe o tratamento especial —
  // continua so na retomada de fim de varredura, como sempre foi
  const semPedido = { sku: 'QUALQUER' };
  ok(pedido(semPedido, FOTOS_PEDIDAS) === false,
     '  item fora de FOTOS_PEDIDAS nao e tratado como "pedido"');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
