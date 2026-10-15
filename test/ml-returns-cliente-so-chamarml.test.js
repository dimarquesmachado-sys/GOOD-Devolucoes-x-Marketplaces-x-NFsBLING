'use strict';
// 15/10 — log do Render: '[GOOD/ML-RETURNS] pre-aquecimento falhou: ml.userId is not a function' (3/3, a cada boot).
// Desde a unificacao (b510, 04/10) a GOOD entrega a fabrica do ML um cliente SO com chamarML. A fabrica agora usa o que
// o cliente tiver e, sem userId/quemSouEu, pergunta ao ML (/users/me). Roda a fabrica DE PRODUCAO com um ML de mentira.
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const ARQ = path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'ml-returns-AMB.js');
function fabrica(cliente) {
  delete require.cache[require.resolve(ARQ)];
  return require(ARQ).criar({ PREFIXO_ENV: 'GOOD_', ml: { janelaDias: 120 }, clienteMl: cliente });
}
function mlDeMentira(chamadas) {
  return async (p) => {
    chamadas.push(String(p));
    if (/\/users\/me/.test(p)) return { ok: true, status: 200, data: { id: 777001 } };
    return { ok: true, status: 200, data: { data: [], results: [], paging: { total: 0, offset: 0, limit: 50 } } };
  };
}
(async () => {
  // 1) cliente so com chamarML (o formato da GOOD antes do conserto)
  { const ch = []; const f = fabrica({ chamarML: mlDeMentira(ch) });
    let erro = null; try { await f.construirIndice(); } catch (e) { erro = e.message; }
    const st = f.statusIndice ? f.statusIndice() : {};
    ok(!erro && !/is not a function/.test(JSON.stringify(st)), '⚠️ cliente SO com chamarML: o indice monta (antes: "ml.userId is not a function")' + (erro ? ' — ' + erro : ''));
    ok(ch.filter((x) => /\/users\/me/.test(x)).length === 1, '  sem userId no cliente, pergunta ao ML quem e o vendedor (/users/me) uma vez');
    ok(ch.some((x) => /777001/.test(x)), '  e usa o vendedor respondido pelo ML nas consultas das devolucoes'); }
  // 2) cliente com userId (a GOOD depois do conserto, com ML_USER_ID)
  { const ch = []; const f = fabrica({ chamarML: mlDeMentira(ch), userId: () => '555' });
    await f.construirIndice().catch(() => {});
    ok(!ch.some((x) => /\/users\/me/.test(x)) && ch.some((x) => /555/.test(x)), '  cliente com userId: usa o dele e nao pergunta ao ML'); }
  // 3) a GOOD entrega o vendedor dela (ML_USER_ID) a fabrica
  { const src = require('fs').readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const i = src.indexOf("require('./amb-devolucoes/lib-AMB/ml-returns-AMB').criar({");
    const bloco = i >= 0 ? src.slice(i, i + 1200) : '';
    ok(/userId: \(\) => \(ML_USER_ID \? String\(ML_USER_ID\) : null\)/.test(bloco), '⚠️ a GOOD entrega o proprio vendedor (ML_USER_ID) a fabrica do ML'); }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
