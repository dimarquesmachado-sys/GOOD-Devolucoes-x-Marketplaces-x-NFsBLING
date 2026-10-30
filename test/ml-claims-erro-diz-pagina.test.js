'use strict';
// 29/10 — GOOD: 'claims/search(closed) HTTP 403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES' com as abertas ok. O erro passa a
// dizer EM QUAL pagina parou, quantas desse status ja tinham vindo e a mensagem inteira. Roda a fabrica de producao.
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const ARQ = path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'ml-returns-AMB.js');
(async () => {
  delete require.cache[require.resolve(ARQ)];
  const MSG = 'At least one policy returned UNAUTHORIZED. ' + 'x'.repeat(150) + ' FIM-DA-MENSAGEM';
  const f = require(ARQ).criar({ PREFIXO_ENV: 'GOOD_', ml: { janelaDias: 120 }, clienteMl: {
    userId: () => '777',
    chamarML: async (p) => {
      const off = Number((/offset=(\d+)/.exec(p) || [])[1] || 0);
      if (/status=opened/.test(p)) return { ok: true, status: 200, data: { data: off === 0 ? [{ id: 1, status: 'opened' }] : [] } };
      // 30/10: da pagina 3 em diante TUDO bloqueado (a faixa inteira, uma por uma) — e ai que a coleta para com o erro
      if (/status=closed/.test(p) && off >= 60) return { ok: false, status: 403, error: { code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES', message: MSG } };
      if (/status=closed/.test(p)) return { ok: true, status: 200, data: { data: Array.from({ length: 30 }, (_, i) => ({ id: 1000 + off + i, status: 'closed' })) } };
      return { ok: true, status: 200, data: {} };
    },
  } });
  await f.construirIndice().catch(() => {});
  const st = f.statusIndice();
  const e = String(st.erro || '');
  ok(/claims\/search\(closed\) pagina 3 \(offset 60, 60 desse status ja coletadas\) HTTP 403/.test(e), '⚠️ o erro diz a pagina (3), o offset (60) e quantas encerradas ja tinham vindo (60)');
  ok(/FIM-DA-MENSAGEM/.test(e), '⚠️ a mensagem do ML vem inteira (antes cortava em 120 caracteres)');
  ok(st.total_claims === 61, '  as reclamacoes que vieram antes do erro continuam no indice (1 aberta + 60 encerradas)');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
