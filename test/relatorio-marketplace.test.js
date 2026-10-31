'use strict';
// Roda com: node test/relatorio-marketplace.test.js
//
// 31/10 — GOOD: o #519 (b648) corrigiu o canal na LISTA, mas o RELATORIO de
// devolucoes (lib/rotas-relatorios.js) lia o marketplace cru do banco:
//   (1) triagem antiga bipada pela chave da NF, com pedido Amazon/Magalu/
//       TikTok, contava como 'mercadolivre';
//   (2) o ML tinha DOIS rotulos ('ml' e 'mercadolivre') somados em separado;
//   (3) a planilha exportada trazia esses mesmos valores.
// Casos REAIS da lista da GOOD de 31/10. Roda a ROTA DE PRODUCAO com um
// Supabase simulado — nao uma copia da logica.

const registrarRotasRelatorios = require('../lib/rotas-relatorios');
const mx = require('../lib/marketplace-exibido');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const linhas = [
  { id: 'a', order_id: '702-9567465-0509861', marketplace: 'amazon', tipo: 'aprovado', produto_sku: 'KJDD-E-187' },        // Renata (ja certo)
  { id: 'b', order_id: '1576370107056840', marketplace: 'mercadolivre', tipo: 'aprovado', produto_sku: 'GLOBO15-BRANCO' }, // maria Bernadete: Magalu gravado como ML
  { id: 'c', order_id: '586452009971057828', marketplace: 'mercadolivre', tipo: 'aprovado', produto_sku: 'KJGD-021-BLACK' }, // Vanessa: TikTok gravado como ML
  { id: 'd', order_id: '701-4007338-3055422', marketplace: 'mercadolivre', tipo: 'aprovado', produto_sku: 'KJBD-597-BRANCO' }, // Darcio: Amazon gravado como ML
  { id: 'e', order_id: '2000018825130500', marketplace: 'ml', tipo: 'aprovado', produto_sku: 'KJDD-VG4' },                  // Renata Capellari: ML rotulo 'ml'
  { id: 'f', order_id: '2000018625511416', marketplace: 'mercadolivre', tipo: 'aprovado', produto_sku: 'GLOBO12-BRANCO' }, // Guilherme: ML rotulo antigo
  { id: 'g', order_id: '9914488', marketplace: 'mercadolivre', tipo: 'aprovado', produto_sku: 'KJDD-E-639-30CM' },          // Glaucia: formato que o detector NAO afirma
  { id: 'h', order_id: '261014JE047FHN', marketplace: 'shopee', tipo: 'problema', produto_sku: 'PT-06-VERMELHO' },          // Queila (ja certo)
  { id: 'i', order_id: null, marketplace: null, tipo: 'aprovado', produto_sku: 'X' },                                      // sem pedido e sem canal
];

// Supabase simulado: toda chamada encadeia e o await devolve as linhas.
// Guarda os filtros que a rota mandou ao banco.
function fakeSupabase(dados) {
  const chamadas = [];
  const q = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res) => res({ data: dados.map((x) => ({ ...x })), error: null });
      return (...args) => { chamadas.push([prop, ...args]); return q; };
    },
  });
  return { sb: { from: () => q }, chamadas };
}

async function chamarRota(query) {
  const { sb, chamadas } = fakeSupabase(linhas);
  let handler = null;
  const nada = () => {};
  const app = { get: (rota, _mw, h) => { if (rota === '/api/admin/relatorios/devolucoes') handler = h; }, post: nada, put: nada, delete: nada, patch: nada };
  registrarRotasRelatorios(app, {
    supabase: sb, requerAdmin: (q2, r2, n) => n(),
    // b650 - o contrato agora exige os nomes da empresa; aqui, os da GOOD.
    tabelas: { devolucoes: 'devolucoes', tags: 'tags', devolucaoTags: 'devolucao_tags' },
    buscarProdutos: null,
  });
  let corpo = null, status = 200;
  const res = { status(s) { status = s; return this; }, json(b) { corpo = b; return this; } };
  await handler({ query }, res);
  return { corpo, status, chamadas };
}

(async () => {
  // ── sem filtro: o "por marketplace" e a lista ───────────────────────
  {
    const { corpo, status } = await chamarRota({});
    ok(status === 200 && corpo && corpo.ok, 'a rota responde (Supabase simulado)');
    const por = Object.fromEntries((corpo.porMarketplace || []).map((x) => [x.nome, x.total]));
    const mk = (id) => (corpo.devolucoes.find((d) => d.id === id) || {}).marketplace;
    ok(mk('b') === 'magalu' && mk('c') === 'tiktok' && mk('d') === 'amazon',
      '⚠️ triagem antiga com pedido Magalu/TikTok/Amazon conta no canal CERTO (antes: mercadolivre)');
    ok(mk('e') === 'mercadolivre' && mk('f') === 'mercadolivre' && !('ml' in por),
      "⚠️ 'ml' e 'mercadolivre' viram UM rotulo so (antes: o ML partido em dois)");
    ok(mk('g') === 'mercadolivre', '  pedido 9914488 (formato que o detector nao afirma) fica como esta — sem chute');
    ok(mk('a') === 'amazon' && mk('h') === 'shopee', '  canal ja certo nao muda');
    ok(por.mercadolivre === 4 && por.amazon === 2 && por.magalu === 1 && por.tiktok === 1 && por.shopee === 1,
      '  contagem por marketplace: ML 4 (e, f, g e o sem canal), Amazon 2, Magalu 1, TikTok 1, Shopee 1 — total ' + JSON.stringify(por));
    ok(corpo.cards.total === linhas.length, '  nenhuma devolucao some do total');
  }
  // ── filtro: aplicado DEPOIS da correcao, nunca no banco ─────────────
  {
    const r1 = await chamarRota({ marketplace: 'amazon' });
    ok(!r1.chamadas.some((c) => c[0] === 'eq' && c[1] === 'marketplace'), '⚠️ o filtro de marketplace nao vai mais ao banco (la o canal antigo esta errado)');
    ok(r1.corpo.devolucoes.map((d) => d.id).sort().join() === 'a,d', '  ?marketplace=amazon traz a Amazon gravada como ML (d) junto da que ja estava certa (a)');
    const r2 = await chamarRota({ marketplace: 'ml' });
    const r3 = await chamarRota({ marketplace: 'mercadolivre' });
    ok(r2.corpo.devolucoes.length === 4 && r3.corpo.devolucoes.length === 4, "  ?marketplace=ml e =mercadolivre pedem o mesmo canal (4 cada)");
    ok(!r3.corpo.devolucoes.some((d) => ['b', 'c', 'd'].includes(d.id)), '  o filtro do ML nao traz mais Magalu/TikTok/Amazon gravados como ML');
  }
  // ── a peca isolada ───────────────────────────────────────────────────
  ok(mx.marketplaceNoRelatorio(null) === null, '  registro nulo nao quebra');
  ok(mx.filtroMarketplaceRelatorio('') === null && mx.filtroMarketplaceRelatorio(' ML ') === 'mercadolivre', '  filtro vazio = sem filtro; ML em qualquer caixa vira o rotulo unico');
  const sem = mx.marketplaceNoRelatorio({ order_id: '2000018825130500', marketplace: '' });
  ok(sem.marketplace === '', '  registro sem canal continua sem canal (o relatorio o conta como mercadolivre)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exit(1); });
