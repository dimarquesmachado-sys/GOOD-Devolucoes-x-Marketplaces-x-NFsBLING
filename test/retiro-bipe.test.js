'use strict';
// b504 — bipe que nao acha nada (etiqueta de RETIRADA do Full) mostra as pecas "vem pelo RETIRO" pra escolher.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const rd = (a) => fs.readFileSync(path.join(__dirname, '..', a), 'utf8');
ok(/app\.get\('\/api\/espreita\/retiro', requerLogin,/.test(rd('server.js')), '⚠️ GOOD: rota do retiro pra tela do galpao (login de funcionario)');
ok(/router\.get\('\/api\/espreita\/retiro', auth\.requerLogin,/.test(rd('amb-devolucoes/app-AMB.js')), '⚠️ AMB/Girassol: a mesma rota');
for (const a of ['server.js', 'amb-devolucoes/app-AMB.js']) ok(/filter\(\(x\) => x && x\.vem_pelo_retiro\)/.test(rd(a)), '  ' + a + ': so as pecas marcadas "vem pelo RETIRO" (#414)');
for (const a of ['public/js/busca.js', 'amb-devolucoes/public-AMB/js-AMB/busca.js']) {
  const s = rd(a);
  ok(/sugerirRetiro\(\);   \/\/ b504\n    return;/.test(s), '⚠️ ' + a + ': o "nao encontrado" chama a sugestao do retiro');
  ok(/function buscarPedidoRetiro\(pedido\)/.test(s) && /onclick="buscarPedidoRetiro\(/.test(s), '  ' + a + ': o toque busca pelo numero do pedido (funcao existe)');
  ok(/'\/api\/espreita\/retiro'/.test(s) && /window\.APP_BASE/.test(s), '  ' + a + ': chama a rota da propria empresa');
}
ok(/js\/busca\.js\?v=4781/.test(rd('public/index.html')) && /js-AMB\/busca\.js\?v=b514/.test(rd('amb-devolucoes/public-AMB/index-AMB.html')), '  ?v= bumpado nas duas telas (sem cache velho)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
