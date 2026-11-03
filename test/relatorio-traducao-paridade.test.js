'use strict';
// Roda com: node test/relatorio-traducao-paridade.test.js
//
// b653 (PR #522 r3) — a MESMA regra de vocabulario ("tipo 'devolucao' =>
// desfecho no status") vive em DOIS lugares de proposito:
//   - linhaNoVocabularioDaGood (supabase-AMB), que triagensDe usa;
//   - a normalizacao inline de lib/rotas-relatorios (b652), porque a lib
//     compartilhada nao pode importar modulo de empresa.
// Copia e o jeito que divergencia nasce (licao da casa). Este teste trava
// a PARIDADE rodando AS DUAS DE PRODUCAO sobre os mesmos casos — quem
// mudar uma sem a outra fica vermelho aqui, com o caso nomeado.

const { linhaNoVocabularioDaGood } = require('../amb-devolucoes/lib-AMB/supabase-AMB');
const registrarRotasRelatorios = require('../lib/rotas-relatorios');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// casos canonicos do vocabulario desta empresa
const CASOS = [
  { nome: 'desfecho aprovado no status', linha: { tipo: 'devolucao', status: 'aprovado' } },
  { nome: 'desfecho problema no status', linha: { tipo: 'devolucao', status: 'problema' } },
  { nome: 'sem status (padrao aprovado)', linha: { tipo: 'devolucao', status: null } },
  { nome: 'tipo ja e o desfecho (nao mexe)', linha: { tipo: 'problema', status: 'aprovado' } },
  { nome: 'defeito de estoque preservado', linha: { tipo: 'defeito_estoque', status: 'problema' } },
  { nome: 'sem tipo nenhum', linha: { tipo: null, status: 'problema' } },
];

// o tipo que o RELATORIO (peca de producao, tipoNoStatus: true) atribui a
// uma linha: registra a rota de verdade com um Supabase simulado que devolve
// SO essa linha, e le o tipo na resposta.
async function tipoPeloRelatorio(linha) {
  const q = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res) => res({ data: [{ id: 'x', produto_sku: 'S', devolucao_tags: [], ...linha }], error: null });
      return () => q;
    },
  });
  let handler = null;
  const app = {
    get: (rota, _mw, h) => { if (rota === '/api/admin/relatorios/devolucoes') handler = h; },
    post() {}, put() {}, delete() {}, patch() {},
  };
  registrarRotasRelatorios(app, {
    supabase: { from: () => q },
    requerAdmin: (rq, rs, n) => n(),
    tabelas: { devolucoes: 'devolucoes_amb', tags: 'tags_amb', devolucaoTags: 'devolucao_tags_amb' },
    buscarProdutos: null,
    colunaData: 'criado_em',
    tipoNoStatus: true,
  });
  let corpo = null;
  await handler({ query: {} }, { status() { return this; }, json(b) { corpo = b; return this; } });
  return corpo.devolucoes[0].tipo;
}

(async () => {
  for (const c of CASOS) {
    const daFuncao = linhaNoVocabularioDaGood({ ...c.linha }).tipo;
    const doRelatorio = await tipoPeloRelatorio({ ...c.linha });
    ok(daFuncao === doRelatorio,
      `${c.nome}: triagensDe=${JSON.stringify(daFuncao)} × relatorio=${JSON.stringify(doRelatorio)} — tem que ser IGUAL`);
  }
  // e a parte que so a funcao faz a mais (data) continua garantida por ela
  const r = linhaNoVocabularioDaGood({ tipo: 'devolucao', status: 'aprovado', criado_em: '2026-10-30T10:00:00Z' });
  ok(r.created_at === '2026-10-30T10:00:00Z', 'a funcao segue traduzindo criado_em -> created_at (o relatorio resolve isso no select, com alias)');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
})();
