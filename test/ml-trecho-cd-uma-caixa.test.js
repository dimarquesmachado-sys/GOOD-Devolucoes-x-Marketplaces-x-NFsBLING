'use strict';
// 31/10 — Girassol, pedido ML 2000018944533088 (tosquiadeira, Rogerio Rodrigues): card 'CAIXA 1/2' numa devolucao de
// 1 pacote. O ML levou ao CD dele pra revisao (envio 48294903291) e de la pro galpao (48361290766). Roda a peca de
// PRODUCAO (lib/devolucao-parcial).
const { esperadoDeCapturadas } = require('../lib/devolucao-parcial');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const real = [
  { pedido: '2000018944533088', marketplace: 'ml', status: 'shipped', shipment: '48294903291', claim_id: '5596027698', no_cd_ml: 'true', visto_por_ultimo: '2026-10-20T10:00:00Z' },
  { pedido: '2000018944533088', marketplace: 'ml', status: 'delivered', shipment: '48361290766', claim_id: '5596027698', no_cd_ml: 'false', visto_por_ultimo: '2026-10-28T10:00:00Z' },
];
ok(esperadoDeCapturadas(real)['2000018944533088'] === 1, '⚠️ caso real: trecho pro CD do ML + trecho CD -> galpao = 1 caixa (era 2)');
ok(esperadoDeCapturadas(real.map((r) => ({ ...r, no_cd_ml: undefined, cru: { no_cd_ml: r.no_cd_ml === 'true' } })))['2000018944533088'] === 1, '  a marca do CD tambem vale vinda dentro do cru (booleano)');
ok(esperadoDeCapturadas([
  { pedido: '9', marketplace: 'ml', status: 'shipped', shipment: 'A', claim_id: '1', no_cd_ml: 'false' },
  { pedido: '9', marketplace: 'ml', status: 'delivered', shipment: 'B', claim_id: '1', no_cd_ml: 'false' },
])['9'] === 2, '⚠️ duas caixas de verdade na mesma claim (nenhuma pelo CD) continuam 2 (decisao de 14/10)');
ok(esperadoDeCapturadas([
  { pedido: '8', marketplace: 'ml', status: 'shipped', shipment: 'A', claim_id: '1', no_cd_ml: 'true' },
])['8'] === 1, '  so o trecho do CD (o reenvio ainda nao existe): 1 caixa — a que esta vindo');
ok(esperadoDeCapturadas([
  { pedido: '7', marketplace: 'ml', status: 'shipped', shipment: 'A', claim_id: '1', no_cd_ml: 'true' },
  { pedido: '7', marketplace: 'ml', status: 'shipped', shipment: 'B', claim_id: '2', no_cd_ml: 'false' },
])['7'] === 2, '  claims DIFERENTES nao se misturam (duas devolucoes)');
ok(esperadoDeCapturadas([
  { pedido: '6', marketplace: 'ml', status: 'shipped', shipment: 'A', claim_id: '1' },
  { pedido: '6', marketplace: 'ml', status: 'delivered', shipment: 'B', claim_id: '1' },
])['6'] === 2, '  captura antiga sem a marca do CD: igual a antes (nao chuta)');
// Codex #517: etiqueta velha (nunca saiu, superada) + trecho do CD ativo = 1 caixa (antes do conserto do Codex: 0)
ok(esperadoDeCapturadas([
  { pedido: '5', marketplace: 'ml', status: 'ready_to_ship', shipment: 'VELHA', claim_id: '1', no_cd_ml: 'false', visto_por_ultimo: '2026-10-20T10:00:00Z' },
  { pedido: '5', marketplace: 'ml', status: 'shipped', shipment: 'CD', claim_id: '1', no_cd_ml: 'true', visto_por_ultimo: '2026-10-28T10:00:00Z' },
])['5'] === 1, '⚠️ Codex: etiqueta velha superada + trecho do CD ativo = 1 caixa (nunca zero)');
// as tres juntas: etiqueta velha + trecho do CD + reenvio pro galpao = 1
ok(esperadoDeCapturadas([
  { pedido: '4', marketplace: 'ml', status: 'ready_to_ship', shipment: 'VELHA', claim_id: '1', no_cd_ml: 'false', visto_por_ultimo: '2026-10-15T10:00:00Z' },
  { pedido: '4', marketplace: 'ml', status: 'shipped', shipment: 'CD', claim_id: '1', no_cd_ml: 'true', visto_por_ultimo: '2026-10-20T10:00:00Z' },
  { pedido: '4', marketplace: 'ml', status: 'delivered', shipment: 'GALPAO', claim_id: '1', no_cd_ml: 'false', visto_por_ultimo: '2026-10-28T10:00:00Z' },
])['4'] === 1, '  etiqueta velha + trecho do CD + reenvio pro galpao = 1 caixa');
// salvaguarda: com outra claim no pedido, a conta nao fica abaixo do real
ok(esperadoDeCapturadas([
  { pedido: '3', marketplace: 'ml', status: 'ready_to_ship', shipment: 'VELHA', claim_id: '1', no_cd_ml: 'false', visto_por_ultimo: '2026-10-20T10:00:00Z' },
  { pedido: '3', marketplace: 'ml', status: 'shipped', shipment: 'CD', claim_id: '1', no_cd_ml: 'true', visto_por_ultimo: '2026-10-28T10:00:00Z' },
  { pedido: '3', marketplace: 'ml', status: 'shipped', shipment: 'OUTRA', claim_id: '2', no_cd_ml: 'false', visto_por_ultimo: '2026-10-28T10:00:00Z' },
])['3'] === 2, '  com outra claim no pedido: 2 (uma por claim), sem perder a ativa');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
