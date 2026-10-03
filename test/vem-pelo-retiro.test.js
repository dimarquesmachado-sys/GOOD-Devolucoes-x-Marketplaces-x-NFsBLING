'use strict';
// b503 — devolucao do FULL que o CD manda pro VENDEDOR (retirada) nao some mais da fila (caso Marcos, 02/10).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
for (const arq of ['lib/ml-returns.js', 'amb-devolucoes/lib-AMB/ml-returns-AMB.js']) {
  const s = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
  ok(/=== 'closed' && !segueVindoPeloRetiro\(d\)\) \{/.test(s), '⚠️ ' + arq + ': CD + reclamacao fechada so sai da fila se a revisao NAO mandar pro vendedor');
  ok(/return !r \|\| !!r\.erro \|\| r\.destino === 'seller';/.test(s), '⚠️ ' + arq + ': "seller" fica; ainda nao consultou ou erro tambem fica (nao sei != nao vem)');
  ok(/post-purchase\/v2\/claims\/' \+ id \+ '\/returns/.test(s) && /post-purchase\/v1\/returns\/' \+ retId \+ '\/reviews/.test(s), '  ' + arq + ': consulta a revisao do CD (claim -> return -> reviews)');
  ok(/90 \* 864e5/.test(s), '  ' + arq + ': so reclamacoes dos ultimos 90 dias (as antigas seguem a regra de antes)');
  ok(/status: statusCD\(d, '/.test(s) && /vem pelo RETIRO/.test(s), '  ' + arq + ': o card mostra "vem pelo RETIRO" com o motivo do ML');
  ok(/setTimeout\(ok, 700\)/.test(s) && /REVISAO_RODANDO/.test(s), '  ' + arq + ': uma consulta por vez, com pausa (cota do ML)');
}
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
