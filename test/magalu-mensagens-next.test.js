'use strict';
// Codex #460 — paginacao das mensagens guiada por meta.links.next (executando o codigo).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const A = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'magalu-AMB.js'), 'utf8');
(async () => {
  const i = A.indexOf('async function mensagensDoTicket'); const j = A.indexOf('function codigoNoTexto');
  ok(i >= 0 && j > i, 'marcadores existem na ordem esperada');
  const monta = (paginas) => {
    const chamadas = [];
    const f = new Function('chamarMagalu', 'aguardarVagaMensagem', A.slice(i, j) + '; return mensagensDoTicket;')(
      async (u) => { const off = Number(/_offset=(\d+)/.exec(u)[1]) / 100; chamadas.push(off); return paginas(off); },
      async () => {});
    return { f, chamadas };
  };
  const cheia = () => Array.from({ length: 100 }, (_, k) => ({ k }));
  // 7 paginas cheias, a ultima sem 'next': passa do antigo teto de 5
  let m = monta((p) => ({ ok: true, data: { results: cheia(), meta: { links: p < 6 ? { next: 'x' } : {} } } }));
  let r = await m.f('t');
  ok(m.chamadas.length === 7 && r.data.results.length === 700, 'segue enquanto houver meta.links.next (7 paginas) — ' + m.chamadas.length);
  m = monta(() => ({ ok: true, data: { results: cheia(), meta: { links: {} } } }));
  await m.f('t'); ok(m.chamadas.length === 1, 'sem next, para mesmo com pagina cheia');
  m = monta((p) => ({ ok: true, data: { results: p < 1 ? cheia() : [{}] } }));
  await m.f('t'); ok(m.chamadas.length === 2, 'sem meta, usa o tamanho da pagina');
  // codigo de mensagem ANTERIOR a remessa mais recente (sem codigo) nao vale como atual
  const a = A.indexOf('async function _fase2ReverseCodes'); const b = A.indexOf('async function construirIndiceDevolucoes');
  const c0 = A.indexOf('function codigoNoTexto'); const c1 = A.indexOf('async function remessasReversasDoTicket');
  ok(a >= 0 && b > a && c0 >= 0 && c1 > c0, 'marcadores da fase 2 existem');
  const roda = async (remessas, msgs) => {
    const dev = { ticket_id: 't1' };
    const f = new Function('INDICES', 'TIDX', 'remessasReversasDoTicket', 'mensagensDoTicket', '_TAG',
      A.slice(c0, c1) + A.slice(a, b) + '; return _fase2ReverseCodes;')(
      {}, { mapa: {} }, async () => ({ ok: true, data: { results: remessas } }),
      async () => ({ ok: true, data: { results: msgs } }), 'T');
    await f([dev]);
    return dev;
  };
  let d = await roda([{ created_at: '2026-10-05' }], [{ created_at: '2026-10-01', body: 'objeto DA597697016BR' }]);
  ok(d.reverse_code === 'DA597697016BR' && d.codigo_possivelmente_obsoleto === true, 'mensagem anterior a remessa: indexa, mas marcado obsoleto');
  d = await roda([{ created_at: '2026-10-05' }], [{ created_at: '2026-10-06', body: 'objeto XY111111111BR' }, { created_at: '2026-10-01', body: 'objeto DA597697016BR' }]);
  ok(d.reverse_code === 'XY111111111BR' && !d.codigo_possivelmente_obsoleto, 'mensagem posterior a remessa vale e nao e obsoleta');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
