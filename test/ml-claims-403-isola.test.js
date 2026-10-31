'use strict';
// 30/10 — GOOD: 'claims/search(closed) HTTP 403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES' (abertas ok) parava a coleta
// das ENCERRADAS inteira. Se for UMA reclamacao que o ML nao deixa ver derrubando a pagina dela, agora a faixa e
// reconsultada uma por uma, a bloqueada e pulada e a coleta segue. Roda a peca de PRODUCAO (ml-returns-AMB).
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const ARQ = path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'ml-returns-AMB.js');
const P403 = { ok: false, status: 403, error: { code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES', message: 'At least one policy returned UNAUTHORIZED.' } };
function montar(chamar) {
  delete require.cache[require.resolve(ARQ)];
  return require(ARQ).criar({ PREFIXO_ENV: 'GOOD_', ml: { janelaDias: 120 }, clienteMl: { userId: () => '777', chamarML: chamar } });
}
(async () => {
  // A) 45 encerradas; a de offset 35 (pagina 2) e proibida: a pagina 2 inteira volta 403
  const TOTAL = 45, PROIBIDA = 35;
  let chamadas = 0;
  const fA = montar(async (p) => {
    chamadas++;
    const off = Number((/offset=(\d+)/.exec(p) || [])[1] || 0), lim = Number((/limit=(\d+)/.exec(p) || [])[1] || 30);
    if (/status=opened/.test(p)) return { ok: true, status: 200, data: { data: off === 0 ? [{ id: 1, status: 'opened' }] : [] } };
    if (/status=closed/.test(p)) {
      const ids = []; for (let i = off; i < Math.min(off + lim, TOTAL); i++) ids.push(i);
      if (ids.includes(PROIBIDA)) return P403;
      return { ok: true, status: 200, data: { data: ids.map((i) => ({ id: 1000 + i, status: 'closed' })) } };
    }
    return { ok: true, status: 200, data: {} };
  });
  await fA.construirIndice().catch(() => {});
  const sA = fA.statusIndice();
  ok(sA.total_claims === 1 + TOTAL - 1, '⚠️ uma reclamacao proibida NAO derruba mais as encerradas: ' + sA.total_claims + ' de ' + (1 + TOTAL - 1) + ' coletadas');
  ok(sA.claims_bloqueadas === 1 && !sA.erro, '  a proibida e pulada e contada (claims_bloqueadas: 1), sem erro de coleta');
  // B) o status INTEIRO bloqueado: para como antes, com a mensagem dizendo isso
  const fB = montar(async (p) => {
    if (/status=opened/.test(p)) return { ok: true, status: 200, data: { data: /offset=0&/.test(p) ? [{ id: 1, status: 'opened' }] : [] } };
    if (/status=closed/.test(p)) return P403;
    return { ok: true, status: 200, data: {} };
  });
  await fB.construirIndice().catch(() => {});
  const sB = fB.statusIndice();
  ok(/claims\/search\(closed\) pagina 1 .*HTTP 403 em TODAS as 30 da faixa/.test(String(sB.erro || '')) && /status inteiro parece bloqueado/.test(String(sB.erro || '')),
    '⚠️ status inteiro bloqueado: para e diz isso com todas as letras');
  ok(sB.total_claims === 1, '  as abertas continuam no indice');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
