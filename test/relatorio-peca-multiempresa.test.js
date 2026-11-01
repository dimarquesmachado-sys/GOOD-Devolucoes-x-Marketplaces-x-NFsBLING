'use strict';
// Roda com: node test/relatorio-peca-multiempresa.test.js
//
// b650 — o relatorio de devolucoes (lib/rotas-relatorios.js) virou peca
// MULTIEMPRESA: tabelas e busca de produto entram por parametro. Este teste
// trava a CLASSE de vazamento que a migracao cria: um literal da GOOD
// ('devolucoes', 'tags', 'devolucao_tags') sobrando dentro da peca faria o
// relatorio da AMB/Girassol contar devolucao DE OUTRA EMPRESA — em silencio.
//
// Prova com a PECA DE PRODUCAO (require real), nunca copia da logica:
//   1. registrada com os nomes da GOOD, so toca tabelas da GOOD;
//   2. registrada com nomes *_amb, TODAS as 6 rotas so tocam *_amb —
//      qualquer from() sem o sufixo e FALHA nomeada;
//   3. o alias do embed mantem o shape da resposta identico nas empresas
//      (filtro por tag e normalizacao `tags:[...]` seguem funcionando);
//   4. sem os nomes, ou sem decidir buscarProdutos, o registro DERRUBA
//      (fail-fast), em vez de cair em default silencioso;
//   5. buscarProdutos injetado e o chamado; null explicito = rota explica.

const registrarRotasRelatorios = require('../lib/rotas-relatorios');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// Supabase simulado: registra cada from(nome) e cada select(texto), encadeia
// qualquer metodo, e o await devolve as linhas passadas.
function fakeSupabase(dados) {
  const froms = [];
  const selects = [];
  const q = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res) => res({ data: (dados || []).map((x) => ({ ...x })), error: null });
      if (prop === 'single') return () => Promise.resolve({ data: (dados || [])[0] || null, error: null });
      return (...args) => {
        if (prop === 'select' && typeof args[0] === 'string') selects.push(args[0]);
        return q;
      };
    },
  });
  return { sb: { from: (nome) => { froms.push(nome); return q; } }, froms, selects };
}

// Registra a peca num app falso e devolve os handlers por "METODO rota".
function registrar(deps, dados) {
  const { sb, froms, selects } = fakeSupabase(dados);
  const handlers = {};
  const pega = (metodo) => (rota, _mw, h) => { handlers[metodo + ' ' + rota] = h; };
  const app = { get: pega('GET'), post: pega('POST'), put: pega('PUT'), delete: pega('DELETE'), patch: pega('PATCH') };
  registrarRotasRelatorios(app, { supabase: sb, requerAdmin: (rq, rs, n) => n(), ...deps });
  return { handlers, froms, selects };
}

async function roda(handler, { query = {}, params = {}, body = {} } = {}) {
  let corpo = null; let status = 200;
  const res = { status(s) { status = s; return this; }, json(b) { corpo = b; return this; } };
  await handler({ query, params, body }, res);
  return { corpo, status };
}

const GOOD = { devolucoes: 'devolucoes', tags: 'tags', devolucaoTags: 'devolucao_tags' };
const AMB = { devolucoes: 'devolucoes_amb', tags: 'tags_amb', devolucaoTags: 'devolucao_tags_amb' };

(async () => {
  // ── 1. GOOD: mesmos nomes de sempre ─────────────────────────────────
  {
    const { handlers, froms, selects } = registrar({ tabelas: GOOD, buscarProdutos: null }, [
      { id: 'a', order_id: '2000018825130500', marketplace: 'ml', tipo: 'aprovado', produto_sku: 'X', devolucao_tags: [] },
    ]);
    const { corpo, status } = await roda(handlers['GET /api/admin/relatorios/devolucoes']);
    ok(status === 200 && corpo && corpo.ok === true, 'GOOD: a rota principal responde');
    ok(froms.length === 1 && froms[0] === 'devolucoes', "GOOD: a lista le SO 'devolucoes' — " + JSON.stringify(froms));
    ok(selects.length === 1 && selects[0].includes('devolucao_tags:devolucao_tags ( tag_id, tags:tags ( id, nome, cor ) )'),
      'GOOD: o embed leva os nomes da GOOD com o MESMO alias de resposta');
    ok(Array.isArray(corpo.porMarketplace) && corpo.cards && Array.isArray(corpo.devolucoes),
      'GOOD: shape da resposta preservado (cards, porMarketplace, devolucoes)');
  }

  // ── 2. AMB: as 6 rotas so tocam *_amb — literal da GOOD e FALHA ─────
  {
    const dados = [{ id: 'd1', order_id: '2000018825130500', marketplace: 'ml', tipo: 'aprovado', produto_sku: 'X', devolucao_tags: [] }];
    const { handlers, froms, selects } = registrar({ tabelas: AMB, buscarProdutos: null }, dados);
    await roda(handlers['GET /api/admin/relatorios/devolucoes']);
    await roda(handlers['GET /api/admin/tags']);
    await roda(handlers['POST /api/admin/tags'], { body: { nome: 'Quebra', cor: '#aa0000' } });
    await roda(handlers['PUT /api/admin/tags/:id'], { params: { id: 't1' }, body: { nome: 'Quebra 2' } });
    await roda(handlers['DELETE /api/admin/tags/:id'], { params: { id: 't1' } });
    await roda(handlers['POST /api/admin/devolucao/:id/tags'], { params: { id: 'd1' }, body: { tag_ids: ['t1'] } });
    const esperadas = new Set(Object.values(AMB));
    const vazadas = froms.filter((f) => !esperadas.has(f));
    ok(vazadas.length === 0,
      '⚠️ AMB: NENHUM from() fora de *_amb nas 6 rotas (vazou: ' + JSON.stringify(vazadas) + ' | todos: ' + JSON.stringify([...new Set(froms)]) + ')');
    ok(froms.includes('devolucoes_amb') && froms.includes('tags_amb') && froms.includes('devolucao_tags_amb'),
      '  AMB: as tres tabelas da empresa foram de fato usadas');
    ok(selects[0].includes('devolucao_tags:devolucao_tags_amb ( tag_id, tags:tags_amb ( id, nome, cor ) )'),
      '  AMB: o embed consulta *_amb mas RESPONDE com o alias de sempre (front igual nas 3)');
  }

  // ── 3. o alias preserva o shape: filtro por tag e normalizacao ──────
  {
    const dados = [
      { id: 'd1', tipo: 'aprovado', produto_sku: 'A', devolucao_tags: [{ tag_id: 't1', tags: { id: 't1', nome: 'Quebra', cor: '#aa0000' } }] },
      { id: 'd2', tipo: 'aprovado', produto_sku: 'B', devolucao_tags: [] },
    ];
    const { handlers } = registrar({ tabelas: AMB, buscarProdutos: null }, dados);
    const { corpo } = await roda(handlers['GET /api/admin/relatorios/devolucoes'], { query: { tag_id: 't1' } });
    ok(corpo.devolucoes.length === 1 && corpo.devolucoes[0].id === 'd1',
      'filtro ?tag_id= continua lendo o campo `devolucao_tags` da resposta (alias)');
    ok(Array.isArray(corpo.devolucoes[0].tags) && corpo.devolucoes[0].tags[0].nome === 'Quebra' && corpo.devolucoes[0].devolucao_tags === undefined,
      '  e a normalizacao `tags:[...]` do front segue identica');
  }

  // ── 4. fail-fast: sem os nomes da empresa, o registro DERRUBA ───────
  {
    const casos = [
      [{ buscarProdutos: null }, 'sem tabelas'],
      [{ tabelas: { devolucoes: 'devolucoes_amb', tags: 'tags_amb' }, buscarProdutos: null }, 'faltando devolucaoTags'],
      [{ tabelas: { devolucoes: ' ', tags: 'tags_amb', devolucaoTags: 'devolucao_tags_amb' }, buscarProdutos: null }, 'nome vazio'],
      [{ tabelas: AMB }, 'sem decidir buscarProdutos'],
    ];
    for (const [deps, nome] of casos) {
      let caiu = false;
      try { registrar(deps, []); } catch (e) { caiu = true; }
      ok(caiu, '⚠️ registro sem contrato completo DERRUBA (' + nome + ') — nada de default silencioso');
    }
  }

  // ── 5. buscarProdutos: injetado e o chamado; null explica ───────────
  {
    const chamadas = [];
    const { handlers } = registrar({ tabelas: GOOD, buscarProdutos: async (termo, limite) => { chamadas.push([termo, limite]); return [{ sku: 'GLOBO12' }]; } }, []);
    const { corpo } = await roda(handlers['GET /api/admin/produtos/buscar'], { query: { q: 'globo' } });
    ok(chamadas.length === 1 && chamadas[0][0] === 'globo' && corpo.ok && corpo.resultados.length === 1,
      'a busca textual usada e a INJETADA (da empresa), com termo e limite');
    const { handlers: h2 } = registrar({ tabelas: AMB, buscarProdutos: null }, []);
    const r2 = await roda(h2['GET /api/admin/produtos/buscar'], { query: { q: 'globo' } });
    ok(r2.status === 501 && r2.corpo.ok === false && /indisponivel/.test(r2.corpo.erro),
      '  empresa que declarou null recebe recusa que EXPLICA, nao resultado vazio fingido');
    const r3 = await roda(h2['GET /api/admin/produtos/buscar'], { query: { q: 'g' } });
    ok(r3.status === 200 && r3.corpo.ok === true && r3.corpo.resultados.length === 0,
      '  termo curto continua respondendo vazio SEM precisar da peca');
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
})();
