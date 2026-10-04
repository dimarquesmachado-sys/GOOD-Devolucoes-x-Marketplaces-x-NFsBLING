'use strict';
// b505 — o card do RETIRO mostra a etapa da retirada (reservada / saiu do CD), lida do estoque do Full.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
for (const arq of ['lib/ml-returns.js', 'amb-devolucoes/lib-AMB/ml-returns-AMB.js']) {
  const s = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
  ok(/if \(reg\.destino === 'seller'\) \{/.test(s) && /\/stock\/fulfillment\/operations\/search\?seller_id=' \+ sel \+ '&inventory_id=' \+ inv/.test(s), '⚠️ ' + arq + ': so a peca que vai pro vendedor consulta o estoque do Full');
  ok(/&date_from=' \+ de/.test(s) && /rr\.data && rr\.data\.date_created/.test(s), '⚠️ ' + arq + ': so operacoes DEPOIS da abertura desta devolucao (o anuncio pode ter outras retiradas)');
  ok(/quando\('WITHDRAWAL_RESERVATION'\)/.test(s) && /quando\('WITHDRAWAL_DELIVERY'\)/.test(s), '  ' + arq + ': reservada e saiu do CD');
  ok(/saiu do CD em/.test(s) && /retirada reservada em/.test(s), '  ' + arq + ': o status do card mostra a etapa');
  ok(/catch \(e\) \{ \/\* linha do tempo e extra \*\/ \}/.test(s) && /REVISAO_CD\.set\(id, reg\);/.test(s), '  ' + arq + ': sem a linha do tempo (cota do ML), o card continua no retiro');
}
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
