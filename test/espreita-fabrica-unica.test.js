'use strict';
// b510 — unificacao multiempresa, passo 1: a GOOD usa a MESMA fabrica da espreita do ML da AMB/Girassol.
const fs = require('fs'); const path = require('path');
process.env.NODE_TEST_SEM_TIMERS = '1';
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
ok(/const mlReturns = require\('\.\/amb-devolucoes\/lib-AMB\/ml-returns-AMB'\)\.criar\(\{/.test(s), '⚠️ a GOOD instancia a fabrica unica da espreita (nao mais a copia lib/ml-returns.js)');
ok(!/require\('\.\/lib\/ml-returns'\)/.test(s), '  nenhum require da copia antiga sobrou na GOOD');
(async () => {
  const urls = [];
  const m = require('../amb-devolucoes/lib-AMB/ml-returns-AMB').criar({ PREFIXO_ENV: 'GOOD_', ml: { janelaDias: 120 },
    clienteMl: { chamarML: async (p) => { const u = /^https?:\/\//i.test(String(p)) ? String(p) : 'https://api.mercadolibre.com' + String(p); urls.push(u); return { ok: true, data: { results: [], paging: { total: 0 } } }; } } });
  for (const f of ['acharPorTracking', 'resumoEspreita', 'preAquecer', 'statusIndice', 'construirIndice']) ok(typeof m[f] === 'function', '  a fabrica entrega ' + f + ' (a GOOD usa)');
  const r = m.resumoEspreita();
  ok(['quente', 'em_transito', 'aguardando_postagem', 'entregues_indice', 'entregues'].every((k) => k in r), '⚠️ o resumo tem todos os campos que a GOOD lia da copia antiga');
  ok((await m.acharPorTracking('NAOEXISTE1')) === null, '  rastreio desconhecido = null (igual a copia antiga)');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.message); process.exit(1); });
