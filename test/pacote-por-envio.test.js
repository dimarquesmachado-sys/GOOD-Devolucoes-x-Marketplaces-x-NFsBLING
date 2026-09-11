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
// ⚠️ O que identifica um pacote é o ENVIO (shipment/rastreio), não o
// registro. Dois registros com o mesmo shipment são O MESMO pacote.
//
// b232.3 (Codex): os campos aqui usam os nomes REAIS da tabela
// `devolucoes_capturadas` (`shipment`, `rastreio` — ver
// lib/devolucoes-capturadas.js:93,103), nao os nomes do formato cru do "a
// espreita" (`shipment_devolucao`, `tracking`). O primeiro round destes
// testes passava com um shape que a rota (server.js) nunca entrega: ela lê
// da tabela persistida, nao do espreita.

const dp = require('../lib/devolucao-parcial.js');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// ── ⚠️ o caso que quebrou ───────────────────────────────────────────
{
  const r = dp.esperadoDeCapturadas([
    { pedido: '2000018197293466', shipment: '47909770652' },
    { pedido: '2000018197293466', shipment: '47909770652' },
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
    { pedido: '123', shipment: 'AAA' },
    { pedido: '123', shipment: 'BBB' },
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

// ── e o rastreio serve de envio quando o shipment falta ─────────────
{
  const r = dp.esperadoDeCapturadas([
    { pedido: '555', rastreio: 'BR123' },
    { pedido: '555', rastreio: 'BR123' },
  ]);
  ok(r['555'] === 1, 'o rastreio tambem identifica o pacote');
}

// ── e cancelada/refund seguem fora ──────────────────────────────────
//
// ⚠️ Sem retorno físico não há caixa — isso já existia e o conserto não
// pode ter derrubado.
{
  const r = dp.esperadoDeCapturadas([
    { pedido: '777', shipment: 'X', status: 'CANCELLED' },
    { pedido: '777', shipment: 'Y', tipo: 'REFUND' },
    { pedido: '777', shipment: 'Z' },
  ]);
  ok(r['777'] === 1, 'cancelada e refund continuam fora da contagem');
}

// ── e a rota realmente busca os campos que a funcao le ──────────────
//
// ⚠️ b232.3 (Codex): o select de server.js so trazia `pedido, tipo_tiktok,
// status` — sem `shipment`/`rastreio` a funcao nunca via o envio, mesmo
// depois de consertados os nomes acima.
{
  const fs = require('fs');
  const path = require('path');
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok(/from\('devolucoes_capturadas'\)[\s\S]{0,300}\.select\('pedido, tipo_tiktok, status, shipment, rastreio'\)/.test(SERVER),
     'a rota do admin busca shipment e rastreio, os campos que esperadoDeCapturadas() le');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
