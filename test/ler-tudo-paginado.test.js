'use strict';
// b728 — V-01 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): O POSTGREST CORTA EM max-rows SEM AVISAR.
//
// lib/ler-tudo.js le pagina a pagina (range) ate a pagina vir curta. Aqui: (1) a peca sozinha — paginas, parada,
// erro na 2a pagina, teto; (2) o relatorio financeiro REAL (lib/rotas-relatorios.js) com um Supabase simulado que
// corta em max-rows como o de verdade: com teto 2 e 5 devolucoes, sem paginar o relatorio somava 2.
// Roda com: node test/ler-tudo-paginado.test.js
const { lerTudo } = require('../lib/ler-tudo');
const registrarRotasRelatorios = require('../lib/rotas-relatorios');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// duble: honra range; sem range corta em maxRows com error null (igual ao PostgREST)
function duble(linhas, { maxRows = 1000, falharNaPagina = null } = {}) {
  const chamadas = [];
  const fazer = () => {
    const q = { faixa: null };
    const chain = new Proxy({}, { get(_, prop) {
      if (prop === 'range') return (de, ate) => { q.faixa = [de, ate]; return chain; };
      if (prop === 'then') return (res) => {
        chamadas.push(q.faixa);
        if (falharNaPagina !== null && chamadas.length - 1 === falharNaPagina) return res({ data: null, error: { message: 'caiu na pagina ' + falharNaPagina } });
        const dados = q.faixa ? linhas.slice(q.faixa[0], q.faixa[1] + 1) : linhas.slice(0, maxRows);
        return res({ data: dados.map((x) => ({ ...x })), error: null });
      };
      return () => chain;
    } });
    return chain;
  };
  return { montar: fazer, chamadas, sb: { from: () => fazer() } };
}

(async () => {
  // ── a peca ──
  {
    const d = duble(Array.from({ length: 7 }, (_, i) => ({ id: i + 1 })));
    const tudo = await lerTudo(d.montar, { tamanho: 3 });
    ok(tudo.map((x) => x.id).join() === '1,2,3,4,5,6,7', '⚠️ 7 linhas com pagina de 3: le as 3 paginas (3+3+1). Veio: ' + tudo.map((x) => x.id).join());
    ok(d.chamadas.length === 3 && d.chamadas[2].join() === '6,8', '  3 chamadas, a ultima range(6,8)');
    const d2 = duble(Array.from({ length: 6 }, (_, i) => ({ id: i + 1 })));
    const t2 = await lerTudo(d2.montar, { tamanho: 3 });
    ok(t2.length === 6 && d2.chamadas.length === 3, '  6 linhas (multiplo exato): 3 chamadas, a 3a vem vazia e para');
    const d3 = duble([]);
    ok((await lerTudo(d3.montar, { tamanho: 3 })).length === 0 && d3.chamadas.length === 1, '  vazio: 1 chamada');
    let erro = null;
    try { await lerTudo(duble(Array.from({ length: 7 }, (_, i) => ({ id: i + 1 })), { falharNaPagina: 1 }).montar, { tamanho: 3 }); } catch (e) { erro = e; }
    ok(erro && /caiu na pagina 1/.test(erro.message) && erro.pagina === 1, '⚠️ erro na 2a pagina ESTOURA (nunca devolve parcial)');
    erro = null;
    try { await lerTudo(duble(Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }))).montar, { tamanho: 10, maximo: 30 }); } catch (e) { erro = e; }
    ok(erro && /passou de 30/.test(erro.message), '  teto de seguranca estoura em vez de ler sem fim');
    erro = null;
    try { await lerTudo(null); } catch (e) { erro = e; }
    ok(erro instanceof TypeError, '  montar que nao e funcao: TypeError');
  }
  // ── o relatorio real com max-rows = 2 ──
  {
    const linhas = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, created_at: '2026-11-1' + i + 'T10:00:00Z', tipo: 'aprovado', status: 'aprovado', marketplace: 'ml', produto_sku: 'S', produto_qtd: 1, produto_valor_unit: 10, devolucao_tags: [] }));
    const roda = async (tamanhoDaPagina) => {
      const d = duble(linhas, { maxRows: 2 });
      const handlers = {}; const pega = (m) => (r, _mw, h) => { handlers[m + ' ' + r] = h; };
      registrarRotasRelatorios({ get: pega('GET'), post: pega('POST'), put: pega('PUT'), delete: pega('DELETE'), patch: pega('PATCH') },
        { supabase: d.sb, requerAdmin: (rq, rs, n) => n(), tabelas: { devolucoes: 'devolucoes_girassol', tags: 'tags_girassol', devolucaoTags: 'devolucao_tags_girassol' }, buscarProdutos: null, colunaData: 'created_at', tamanhoDaPagina });
      let corpo = null; const res = { status() { return this; }, json(c) { corpo = c; return this; } };
      await handlers['GET /api/admin/relatorios/devolucoes']({ query: {}, params: {}, body: {} }, res);
      return { corpo, chamadas: d.chamadas };
    };
    const r = await roda(2);
    ok(r.corpo && r.corpo.ok && r.corpo.cards.total === 5 && r.corpo.cards.valorTotal === 50, '⚠️ relatorio com max-rows 2 e 5 devolucoes: conta 5 e soma R$50 (sem paginar: 2 / R$20). Veio: ' + (r.corpo && r.corpo.cards.total) + ' / ' + (r.corpo && r.corpo.cards.valorTotal));
    ok(r.chamadas.length === 3 && r.chamadas.every((f) => Array.isArray(f)), '  3 paginas com range');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
