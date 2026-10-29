'use strict';
// 29/10 — GOOD, pedido Shopee 260929A0A15CVV: card 'CAIXA 1/2 — aguardando outra caixa' numa devolucao de 1 pacote.
// A captura tinha a MESMA devolucao duas vezes: com o numero da devolucao no lugar do rastreio (em analise) e depois
// com o BR... de verdade. Roda a peca de PRODUCAO (lib/devolucao-parcial).
const fs = require('fs'); const path = require('path');
const { esperadoDeCapturadas } = require('../lib/devolucao-parcial');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
// 1) o caso real (GOOD: linha antiga sem return_sn)
let m = esperadoDeCapturadas([
  { pedido: '260929A0A15CVV', marketplace: 'shopee', rastreio: '2610010QT7D9UC5', status: 'REQUESTED' },
  { pedido: '260929A0A15CVV', marketplace: 'shopee', rastreio: 'BR261615626582T', status: 'ACCEPTED' },
]);
ok(m['260929A0A15CVV'] === 1, '⚠️ caso real GOOD: numero da devolucao + BR... da MESMA devolucao = 1 caixa (era 2)');
// 2) fabrica: a linha traz o return_sn
m = esperadoDeCapturadas([
  { pedido: 'P2', marketplace: 'shopee', rastreio: '2610010AAAAAAAA', return_sn: '2610010AAAAAAAA' },
  { pedido: 'P2', marketplace: 'shopee', rastreio: 'BR111111111111A', return_sn: '2610010AAAAAAAA' },
]);
ok(m.P2 === 1, '⚠️ com o return_sn na linha: a mesma devolucao em duas linhas = 1 caixa');
// 3) duas devolucoes de verdade no mesmo pedido continuam 2
m = esperadoDeCapturadas([
  { pedido: 'P3', marketplace: 'shopee', rastreio: 'BR111111111111A', return_sn: '2610010AAAAAAAA' },
  { pedido: 'P3', marketplace: 'shopee', rastreio: 'BR222222222222B', return_sn: '2610020BBBBBBBB' },
]);
ok(m.P3 === 2, '  duas devolucoes diferentes no mesmo pedido continuam 2 caixas');
// 4) duas linhas antigas da GOOD, duas devolucoes com BR... cada (sem return_sn) — continuam 2
m = esperadoDeCapturadas([
  { pedido: 'P4', marketplace: 'shopee', rastreio: 'BR111111111111A' },
  { pedido: 'P4', marketplace: 'shopee', rastreio: 'BR222222222222B' },
]);
ok(m.P4 === 2, '  dois rastreios reais (linhas antigas sem return_sn) continuam 2');
// 5) ML nao muda: dois envios diferentes = 2; mesmo envio repetido = 1
m = esperadoDeCapturadas([
  { pedido: 'ML1', marketplace: 'ml', shipment: '48000000001' }, { pedido: 'ML1', marketplace: 'ml', shipment: '48000000002' },
  { pedido: 'ML2', marketplace: 'ml', shipment: '48000000003' }, { pedido: 'ML2', marketplace: 'ml', shipment: '48000000003' },
]);
ok(m.ML1 === 2 && m.ML2 === 1, '  ML continua igual (2 envios = 2 caixas; o mesmo envio repetido = 1)');
// 6) cancelada nao conta (regra antiga mantida)
m = esperadoDeCapturadas([{ pedido: 'P6', marketplace: 'shopee', rastreio: 'BR333333333333C', status: 'CANCELLED' }]);
ok(m.P6 === undefined, '  devolucao cancelada continua sem contar');
// 7) quem alimenta a contagem traz marketplace e return_sn; a Shopee da GOOD passa a mandar o return_sn no card
const sel = /\.select\('pedido, marketplace, tipo_tiktok, status, shipment, rastreio, visto_por_ultimo, claim_id:cru->>claim_id, return_sn:cru->>return_sn'\)/;
ok(sel.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')) && sel.test(fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js'), 'utf8')),
  '⚠️ as duas consultas (GOOD e Girassol/AMB) trazem marketplace e return_sn pra contagem');
const sp = fs.readFileSync(path.join(__dirname, '..', 'lib', 'shopee-proxy.js'), 'utf8');
ok((sp.match(/return_sn: d\.return_sn \|\| null,/g) || []).length === 2, '  espreita da Shopee da GOOD manda o return_sn (em transito e entregues)');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
