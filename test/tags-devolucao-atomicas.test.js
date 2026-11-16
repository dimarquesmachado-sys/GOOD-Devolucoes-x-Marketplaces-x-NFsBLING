'use strict';
// b726 — P2-04 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): APLICAR TAGS NUNCA PERDE TAG.
//
// POST /api/admin/devolucao/:id/tags (lib/rotas-relatorios.js, peca das 3 empresas) fazia DELETE de tudo sem olhar o
// erro e INSERT das novas: DELETE com erro respondia ok (nada mudou, tela achava que mudou); DELETE ok + INSERT com
// erro deixava a devolucao SEM NENHUMA tag. Agora e um diff na ordem que nunca perde: le → insere o que falta → apaga
// so o que saiu; cada passo confere o erro. A rota REAL roda aqui com um Supabase simulado por tabela.
// Roda com: node test/tags-devolucao-atomicas.test.js
const registrarRotasRelatorios = require('../lib/rotas-relatorios');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

function banco(inicial, falhas = {}) {
  const linhas = inicial.map((x) => ({ ...x }));
  const ops = [];
  const sb = { from(tabela) {
    const q = { tabela, op: 'select', filtros: [], campos: null };
    const chain = {
      select() { q.op = q.op === 'insert' ? 'insert' : 'select'; return chain; },
      insert(c) { q.op = 'insert'; q.campos = c; return chain; },
      delete() { q.op = 'delete'; return chain; },
      eq(col, v) { q.filtros.push((x) => String(x[col]) === String(v)); return chain; },
      in(col, vs) { q.filtros.push((x) => vs.map(String).includes(String(x[col]))); return chain; },
      then(res0) {
        // atrasoSelect: o SELECT responde so depois de N ms (deixa duas requisicoes lerem o mesmo retrato)
        const res = (v) => (q.op === 'select' && falhas.atrasoSelect ? setTimeout(() => res0(v), falhas.atrasoSelect) : res0(v));
        ops.push(q.op);
        if (falhas[q.op]) return res({ data: null, error: { message: 'falhou ' + q.op, code: falhas[q.op] === true ? 'XX' : falhas[q.op] } });
        const bate = linhas.filter((x) => q.filtros.every((f) => f(x)));
        if (q.op === 'select') return res({ data: bate.filter((x) => !(falhas.ocultaNoSelect || []).includes(String(x.tag_id))).map((x) => ({ tag_id: x.tag_id })), error: null });
        if (q.op === 'insert') {
          // como o Postgres: chave repetida = 23505 e o LOTE INTEIRO e desfeito
          if (q.campos.some((c) => linhas.some((x) => String(x.devolucao_id) === String(c.devolucao_id) && String(x.tag_id) === String(c.tag_id)))) return res({ data: null, error: { message: 'duplicate key', code: '23505' } });
          linhas.push(...q.campos); return res({ data: q.campos, error: null });
        }
        if (q.op === 'delete') { for (const x of bate) linhas.splice(linhas.indexOf(x), 1); return res({ data: null, error: null }); }
      },
    };
    return chain;
  } };
  return { sb, linhas, ops };
}
function rota(b) {
  const handlers = {};
  const pega = (m) => (r, _mw, h) => { handlers[m + ' ' + r] = h; };
  registrarRotasRelatorios({ get: pega('GET'), post: pega('POST'), put: pega('PUT'), delete: pega('DELETE'), patch: pega('PATCH') },
    { supabase: b.sb, requerAdmin: (rq, rs, n) => n(), tabelas: { devolucoes: 'devolucoes_girassol', tags: 'tags_girassol', devolucaoTags: 'devolucao_tags_girassol' }, buscarProdutos: null, colunaData: 'criado_em' });
  const h = handlers['POST /api/admin/devolucao/:id/tags'];
  return async (tag_ids) => { let corpo = null, status = 200; const res = { status(s) { status = s; return this; }, json(c) { corpo = c; return this; } }; await h({ params: { id: '77' }, body: { tag_ids }, query: {} }, res); return { status, corpo }; };
}
const tagsDe = (b) => b.linhas.filter((x) => String(x.devolucao_id) === '77').map((x) => String(x.tag_id)).sort();

(async () => {
  // diff normal: tinha A,B; quer B,C → insere C, apaga A; B nao e tocada
  {
    const b = banco([{ devolucao_id: 77, tag_id: 'A' }, { devolucao_id: 77, tag_id: 'B' }, { devolucao_id: 78, tag_id: 'A' }]);
    const r = await rota(b)(['B', 'C']);
    ok(r.status === 200 && r.corpo.ok && r.corpo.tag_ids.join() === 'B,C', 'aplicar [B,C] sobre [A,B]: ok, resposta diz o aplicado');
    ok(tagsDe(b).join() === 'B,C', '  no banco ficou B,C. Veio: ' + tagsDe(b).join());
    ok(b.linhas.some((x) => x.devolucao_id === 78), '  a tag de OUTRA devolucao nao foi tocada');
    ok(b.ops.join() === 'select,insert,delete', '  ordem: le → insere → apaga (nunca apaga antes de inserir). Veio: ' + b.ops.join());
  }
  // INSERT falha: as antigas FICAM (antes: DELETE ja tinha apagado tudo → devolucao sem tag)
  {
    const b = banco([{ devolucao_id: 77, tag_id: 'A' }], { insert: true });
    const r = await rota(b)(['C']);
    ok(r.status === 500 && r.corpo.ok === false && /antigas continuam/.test(r.corpo.erro), '⚠️ INSERT falhou: 500 dizendo que as antigas continuam. Veio: ' + r.status + ' ' + (r.corpo.erro || ''));
    ok(tagsDe(b).join() === 'A', '⚠️ a tag A NAO foi perdida (antes ficava sem nenhuma). Veio: ' + tagsDe(b).join());
    ok(!b.ops.includes('delete'), '  nenhum DELETE rodou');
  }
  // DELETE falha: antes respondia ok com as antigas no lugar; agora 500 honesto, novas aplicadas, antigas no banco
  {
    const b = banco([{ devolucao_id: 77, tag_id: 'A' }], { delete: true });
    const r = await rota(b)(['C']);
    ok(r.status === 500 && r.corpo.ok === false && /novas entraram/.test(r.corpo.erro), '⚠️ DELETE falhou: 500 (antes: ok mentiroso). Veio: ' + r.status);
    ok(tagsDe(b).join() === 'A,C' && r.corpo.tag_ids.sort().join() === 'A,C', '  banco e resposta dizem A,C (nada perdido)');
  }
  // leitura falha: nada muda
  {
    const b = banco([{ devolucao_id: 77, tag_id: 'A' }], { select: true });
    const r = await rota(b)(['C']);
    ok(r.status === 500 && tagsDe(b).join() === 'A' && b.ops.join() === 'select', '  SELECT falhou: 500 e nenhuma escrita');
  }
  // sem mudanca: nenhuma escrita; limpar tudo: so DELETE; duplicata na entrada
  {
    const b = banco([{ devolucao_id: 77, tag_id: 'A' }]);
    const f = rota(b);
    await f(['A', 'A']);
    ok(b.ops.join() === 'select', '  mesmas tags (com duplicata): so leitura, nenhuma escrita');
    const r = await f([]);
    ok(r.corpo.ok && tagsDe(b).length === 0 && !b.ops.includes('insert'), '  [] limpa as tags sem INSERT');
    const inv = await f('x');
    ok(inv.status === 400, '  tag_ids que nao e array: 400');
  }
  // 23505 (outro admin aplicou UMA das tags no meio): o lote inteiro e desfeito pelo Postgres — as outras tem que
  // entrar mesmo assim, ANTES de apagar (Codex #594). Cena: tinha [A]; outro admin pos B depois do SELECT; pedimos [B,C]
  {
    const b = banco([{ devolucao_id: 77, tag_id: 'A' }, { devolucao_id: 77, tag_id: 'B' }], { ocultaNoSelect: ['B'] });
    const r = await rota(b)(['B', 'C']);
    ok(r.status === 200 && r.corpo.ok, '  lote com 23505: segue ok');
    ok(tagsDe(b).join() === 'B,C', '⚠️ (Codex #594) C entrou mesmo com o lote desfeito, e A saiu: banco = B,C. Veio: ' + tagsDe(b).join());
    const insercoes = b.ops.filter((o) => o === 'insert').length;
    ok(insercoes === 3, '  lote (1) + uma a uma (2)');
  }
  // dois admins na MESMA devolucao ao mesmo tempo (Codex #594): [A,B] + pedidos [A] e [B]. Sem fila, os dois leem
  // [A,B], nenhum insere e cada um apaga o que o outro queria → zero tags. Com fila, o 2o le depois do 1o escrever.
  {
    const b = banco([{ devolucao_id: 77, tag_id: 'A' }, { devolucao_id: 77, tag_id: 'B' }], { atrasoSelect: 20 });
    const f = rota(b);
    const [r1, r2] = await Promise.all([f(['A']), f(['B'])]);
    ok(r1.status === 200 && r2.status === 200, '  concorrentes: as duas respondem ok');
    ok(tagsDe(b).join() === 'B', '⚠️ (Codex #594) a ultima a chegar vence e a devolucao NAO fica sem tags. Veio: [' + tagsDe(b).join() + ']');
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
