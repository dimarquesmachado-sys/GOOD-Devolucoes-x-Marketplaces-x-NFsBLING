'use strict';
// Codex #460 — mensagens do ticket: sem o campo do parceiro como rastreio, PAGINADAS e com RITMO (Magalu ~200/min).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const A = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'magalu-AMB.js'), 'utf8');
ok(/const CAMPOS_CODIGO = \['reverse_code', 'tracking_code', 'object_code', 'tracking', 'reverse_tracking_code'\];/.test(A), "⚠️ 'code' (identificador do parceiro) fora dos campos de rastreio");
ok(/messages\?_limit=100&_offset=\$\{pg \* 100\}/.test(A) && /if \(lote\.length < 100\) break;/.test(A), '⚠️ mensagens PAGINADAS (o codigo pode estar alem da 1a pagina)');
ok(/await aguardarVagaMensagem\(\);/.test(A) && /_proximaVagaMensagem = vez \+ 400;/.test(A), '⚠️ uma leitura de mensagem a cada 400 ms (<= 150/min, abaixo do limite do Magalu), em ordem mesmo com 4 simultaneas');
// a vaga e reservada em ordem: 4 chamadas simultaneas ficam espacadas
(async () => {
  const i = A.indexOf('let _proximaVagaMensagem = 0;'); const j = A.indexOf('async function mensagensDoTicket');
  const f = new Function(A.slice(i, j) + '; return aguardarVagaMensagem;')();
  const t0 = Date.now(); const marcas = [];
  await Promise.all([0, 1, 2, 3].map(async () => { await f(); marcas.push(Date.now() - t0); }));
  marcas.sort((a, b) => a - b);
  ok(marcas[3] >= 1150, '  4 leituras simultaneas espacadas (~0, 400, 800, 1200 ms) — ' + marcas.join(','));
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
