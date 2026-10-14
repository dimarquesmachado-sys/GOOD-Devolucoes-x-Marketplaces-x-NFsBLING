'use strict';
// 14/10 — ETIQUETA TROCADA NAO E CAIXA NOVA. Caso real (Girassol, pedido 2000018478090602): o card dizia "CAIXA 1/2"
// numa devolucao de 1 pacote — a captura tinha 2 registros da MESMA claim do ML com rastreios diferentes (o ML trocou a
// etiqueta de retorno; a 1a ficou em ready_to_ship, a 2a viajou). Roda a funcao de PRODUCAO com os registros reais.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const dp = require('../lib/devolucao-parcial.js');
// os 2 registros como vieram de /api/debug/capturadas (so os campos que a conta usa)
const real = [
  { pedido: '2000018478090602', status: 'shipped', rastreio: 'E7SKWJGYQRLJJODKORQCNPJ5MI', claim_id: '5581409961' },
  { pedido: '2000018478090602', status: 'ready_to_ship', rastreio: 'MEL48075103729FMDOR01', claim_id: '5581409961' },
];
ok(dp.esperadoDeCapturadas(real)['2000018478090602'] === 1, '⚠️ caso real: mesma claim, etiqueta trocada (uma parada em ready_to_ship) -> 1 caixa (era 2)');
ok(dp.esperadoDeCapturadas(real.map((r) => ({ ...r, claim_id: undefined, cru: { claim_id: 5581409961 } })))['2000018478090602'] === 1, '  a claim tambem vale vinda dentro do cru');
ok(dp.esperadoDeCapturadas([
  { pedido: '9', status: 'shipped', rastreio: 'A', claim_id: '1' },
  { pedido: '9', status: 'delivered', rastreio: 'B', claim_id: '1' },
])['9'] === 2, '⚠️ duas caixas DE VERDADE na mesma claim (as duas viajaram) continuam contando 2');
ok(dp.esperadoDeCapturadas([
  { pedido: '8', status: 'ready_to_ship', rastreio: 'A', claim_id: '1' },
  { pedido: '8', status: 'ready_to_ship', rastreio: 'B', claim_id: '1' },
])['8'] === 2, '  nenhuma saiu ainda: nao da pra saber qual e a trocada — conta como antes');
ok(dp.esperadoDeCapturadas([
  { pedido: '7', status: 'ready_to_ship', rastreio: 'A', claim_id: '1' },
  { pedido: '7', status: 'shipped', rastreio: 'B', claim_id: '2' },
])['7'] === 2, '  claims DIFERENTES nao se misturam (sao duas devolucoes)');
ok(dp.esperadoDeCapturadas([
  { pedido: '6', status: 'ready_to_ship', rastreio: 'A' },
  { pedido: '6', status: 'shipped', rastreio: 'B' },
])['6'] === 2, '  sem claim (Shopee, TikTok, Magalu): igual a antes');
// as duas listas do painel (GOOD e Girassol/AMB) buscam a claim junto
for (const arq of ['server.js', 'amb-devolucoes/lib-AMB/compat-AMB.js']) {
  const s = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
  ok(/\.select\('pedido, tipo_tiktok, status, shipment, rastreio, claim_id:cru->>claim_id'\)/.test(s), '⚠️ ' + arq + ' busca a claim junto com a captura');
}
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
