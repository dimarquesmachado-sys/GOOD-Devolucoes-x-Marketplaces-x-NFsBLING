'use strict';
// b587 (Codex #472) — com o relogio da espreita remontando o indice sozinho, uma falha GERAL da busca nao pode apagar
// o indice bom anterior. Executa o modulo de producao com um cliente ML falso.
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
let busca500 = false;
const ml = {
  userId: () => '1',
  quemSouEu: async () => ({ ok: true, user_id: 1 }),
  chamarML: async (url) => {
    if (url.includes('/claims/search')) {
      if (busca500) return { ok: false, status: 500, error: 'x' };
      return { ok: true, data: { data: [{ id: 7, resource: 'order', resource_id: 99, status: 'opened', stage: 'x', date_created: '2026-10-01' }] } };
    }
    if (url.includes('/returns')) {
      return { ok: true, data: { shipments: [{ tracking_number: 'AB123', shipment_id: 5, status: 'shipped', destination: { name: 'seller_address' } }] } };
    }
    return { ok: false, status: 404 };
  },
};
const mod = require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'ml-returns-AMB.js'));
const r = mod.criar({ clienteMl: ml, ml: { janelaDias: 120 }, PREFIXO_ENV: 'AMB_' });
(async () => {
  await r.construirIndice();
  ok(r.tamanho() === 1, 'primeira montagem publica o indice (1 rastreio)');
  busca500 = true;
  await r.construirIndice();
  ok(r.tamanho() === 1, '⚠️ falha geral na remontagem NAO apaga o indice anterior');
  const st = r.statusIndice();
  ok(st.quente === true && /HTTP 500/.test(st.erro || ''), '  indice segue quente (velho) e o erro fica registrado');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
