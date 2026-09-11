// Roda com: node test/pacote-por-envio.test.js
//
// ⚠️ CASO REAL (11/09, pedido 2000018197293466 do Charles Alexandre):
//
//   o cliente comprou 1 unidade de 1 produto
//   devolveu em 1 caixa
//   e o card disse "1 de 2 caixas triadas — aguardando 1 pacote(s)"
//
// O estoquista foi orientado a ESPERAR uma caixa que não existe, e a NF de
// devolução fica travada até alguém perceber.
//
// A CAUSA: `mapa[pedido] += 1` contava UM POR REGISTRO capturado. Se o ML
// devolve 2 registros do MESMO pedido — duas claims, ou a mesma claim vista
// por duas rotas da coleta — vira "2 caixas".
//
// ⚠️ O que identifica um pacote é o ENVIO (shipment/tracking), não o
// registro. Dois registros com o mesmo shipment são O MESMO pacote.

const dp = require('../lib/devolucao-parcial.js');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// ── ⚠️ o caso que quebrou ───────────────────────────────────────────
{
  const r = dp.esperadoDeCapturadas([
    { pedido: '2000018197293466', shipment_devolucao: '47909770652' },
    { pedido: '2000018197293466', shipment_devolucao: '47909770652' },
  ]);
  ok(r['2000018197293466'] === 1,
     '⚠️ 2 registros com o MESMO envio = 1 pacote (era 2)');
}

// ── e a devolução que REALMENTE tem 2 pacotes continua certa ────────
//
// ⚠️ O conserto não pode matar o caso que motivou a funcionalidade: pedido
// que volta em várias entregas precisa esperar todas antes da NF.
{
  const r = dp.esperadoDeCapturadas([
    { pedido: '123', shipment_devolucao: 'AAA' },
    { pedido: '123', shipment_devolucao: 'BBB' },
  ]);
  ok(r['123'] === 2, '2 envios DIFERENTES = 2 pacotes (o caso que a feature existe pra tratar)');
}

// ── ⚠️ e sem envio cai no comportamento antigo ──────────────────────
//
// Melhor errar para mais numa devolução que realmente tem 2 caixas do que
// somar pacotes inexistentes — mas só quando não há como saber.
{
  const r = dp.esperadoDeCapturadas([{ pedido: '999' }, { pedido: '999' }]);
  ok(r['999'] === 2, 'sem envio nenhum, conta por registro (nao da pra saber)');
}

// ── e o tracking serve de envio quando o shipment falta ─────────────
{
  const r = dp.esperadoDeCapturadas([
    { pedido: '555', tracking: 'BR123' },
    { pedido: '555', tracking: 'BR123' },
  ]);
  ok(r['555'] === 1, 'o tracking tambem identifica o pacote');
}

// ── e cancelada/refund seguem fora ──────────────────────────────────
//
// ⚠️ Sem retorno físico não há caixa — isso já existia e o conserto não
// pode ter derrubado.
{
  const r = dp.esperadoDeCapturadas([
    { pedido: '777', shipment_devolucao: 'X', status: 'CANCELLED' },
    { pedido: '777', shipment_devolucao: 'Y', tipo: 'REFUND' },
    { pedido: '777', shipment_devolucao: 'Z' },
  ]);
  ok(r['777'] === 1, 'cancelada e refund continuam fora da contagem');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
