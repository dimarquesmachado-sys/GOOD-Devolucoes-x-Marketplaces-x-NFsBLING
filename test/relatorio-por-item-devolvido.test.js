'use strict';
// b721 — P1-08 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): O RELATORIO AGREGA POR ITEM QUE VOLTOU.
//
// lib/rotas-relatorios.js (peca das 3 empresas) multiplicava `produto_qtd` (soma de TUDO que voltou) pelo preco de UM
// produto (`produto_valor_unit`, o 1o order_item do ML) e punha tudo no SKU principal. Devolucao A 1×R$10 + B 1×R$100
// virava R$20 com A=2. A triagem ja grava `itens_devolvidos` (docs/ITENS-DEVOLVIDOS.md); o relatorio nao lia.
// Aqui a rota REAL roda com Supabase simulado (o mesmo harness do relatorio-peca-multiempresa).
// Roda com: node test/relatorio-por-item-devolvido.test.js

const fs = require('fs');
const path = require('path');
const registrarRotasRelatorios = require('../lib/rotas-relatorios');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

function fakeSupabase(dados) {
  const selects = [];
  const q = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res) => res({ data: (dados || []).map((x) => ({ ...x })), error: null });
      return (...args) => { if (prop === 'select' && typeof args[0] === 'string') selects.push(args[0]); return q; };
    },
  });
  return { sb: { from: () => q }, selects };
}
function relatorio(dados) {
  const { sb, selects } = fakeSupabase(dados);
  const handlers = {};
  const pega = (m) => (rota, _mw, h) => { handlers[m + ' ' + rota] = h; };
  const app = { get: pega('GET'), post: pega('POST'), put: pega('PUT'), delete: pega('DELETE'), patch: pega('PATCH') };
  registrarRotasRelatorios(app, { supabase: sb, requerAdmin: (rq, rs, n) => n(), tabelas: { devolucoes: 'devolucoes_girassol', tags: 'tags_girassol', devolucaoTags: 'devolucao_tags_girassol' }, buscarProdutos: null, colunaData: 'criado_em' });
  const h = handlers['GET /api/admin/relatorios/devolucoes'];
  return { selects, async rodar(query = {}) { let corpo = null, status = 200; const res = { status(s) { status = s; return this; }, json(b) { corpo = b; return this; } }; await h({ query, params: {}, body: {} }, res); return { corpo, status }; } };
}
const base = (x) => ({ id: 1, created_at: '2026-11-10T10:00:00Z', tipo: 'aprovado', status: 'aprovado', marketplace: 'ml', order_id: '2000012345678901', devolucao_tags: [], ...x });

(async () => {
  // ── a cena do Codex: A 1×R$10 + B 1×R$100 numa devolucao so ──
  {
    const r = relatorio([base({ id: 1, produto_sku: 'A', produto_titulo: 'Produto A', produto_qtd: 2, produto_valor_unit: 10,
      itens_devolvidos: [{ sku: 'A', titulo: 'Produto A', qtd: 1, valor_unit: 10 }, { sku: 'B', titulo: 'Produto B', qtd: 1, valor_unit: 100 }] })]);
    const { corpo } = await r.rodar();
    ok(corpo && corpo.ok, 'rota responde');
    ok(corpo.cards.valorTotal === 110, '⚠️ valor total = R$110 (A 1×10 + B 1×100) — antes: R$20 (qtd 2 × preco de A). Veio: ' + corpo.cards.valorTotal);
    const porSku = Object.fromEntries((corpo.rankingSKUs || []).map((s) => [s.sku, s]));
    ok(porSku.A && porSku.A.qtde_total === 1 && porSku.B && porSku.B.qtde_total === 1, '⚠️ ranking: A=1 e B=1 (antes: A=2, B inexistente). Veio: ' + JSON.stringify(Object.keys(porSku).map((k) => k + '=' + porSku[k].qtde_total)));
    ok(porSku.A.valor_total === 10 && porSku.B.valor_total === 100, '  valor por SKU: A=10, B=100');
    ok(porSku.A.num_devolucoes === 1 && porSku.B.num_devolucoes === 1, '  cada SKU conta 1 devolucao (a mesma bipagem)');
    ok(/itens_devolvidos/.test(r.selects[0] || ''), '  a consulta pede a coluna itens_devolvidos');
  }
  // ── devolucao SO do 2o item da NF: o produtor gravava SKU/preco do 1o — o relatorio segue o item que voltou ──
  {
    const r = relatorio([base({ id: 2, produto_sku: 'B', produto_titulo: 'Produto B', produto_qtd: 1, produto_valor_unit: 10 /* preco do 1o order_item, errado */,
      itens_devolvidos: [{ sku: 'B', titulo: 'Produto B', qtd: 1, valor_unit: 100 }] })]);
    const { corpo } = await r.rodar();
    const porSku = Object.fromEntries(corpo.rankingSKUs.map((s) => [s.sku, s]));
    ok(corpo.cards.valorTotal === 100 && porSku.B && porSku.B.valor_total === 100 && !porSku.A, '⚠️ so o 2o produto voltou: R$100 no SKU B (nao o preco do 1o order_item). Veio: ' + corpo.cards.valorTotal);
  }
  // ── item sem preco: nao inventa com o preco do principal; marca desconhecido ──
  {
    const r = relatorio([base({ id: 3, produto_sku: 'A', produto_qtd: 2, produto_valor_unit: 10,
      itens_devolvidos: [{ sku: 'A', qtd: 1, valor_unit: 10 }, { sku: 'C', qtd: 1 }] })]);
    const { corpo } = await r.rodar();
    ok(corpo.cards.valorTotal === 10 && corpo.cards.valorItensDesconhecidos === 1, '⚠️ item C sem preco: entra na quantidade, NAO no valor (R$10), e conta em valorItensDesconhecidos=1. Veio: ' + corpo.cards.valorTotal + '/' + corpo.cards.valorItensDesconhecidos);
    const porSku = Object.fromEntries(corpo.rankingSKUs.map((s) => [s.sku, s]));
    ok(porSku.C && porSku.C.qtde_total === 1 && porSku.C.valor_total === 0 && porSku.C.valor_desconhecido === true, '  o SKU C aparece no ranking com qtd 1 e valor marcado como desconhecido');
  }
  // ── triagem antiga (sem itens_devolvidos): calculo legado, marcado como APROXIMADO ──
  {
    const r = relatorio([base({ id: 4, produto_sku: 'Z', produto_qtd: 3, produto_valor_unit: 7 })]);
    const { corpo } = await r.rodar();
    ok(corpo.cards.valorTotal === 21 && corpo.cards.valorAproximadoDevolucoes === 1, '⚠️ sem itens_devolvidos: 3×7 = R$21 como antes, mas contado em valorAproximadoDevolucoes=1. Veio: ' + corpo.cards.valorTotal + '/' + corpo.cards.valorAproximadoDevolucoes);
    // um item so, sem valor_unit no item: o preco da linha descreve ESSE item — vale, sem marcar aproximado
    const r2 = relatorio([base({ id: 5, produto_sku: 'Z', produto_qtd: 2, produto_valor_unit: 7, itens_devolvidos: [{ sku: 'Z', qtd: 2 }] })]);
    const c2 = (await r2.rodar()).corpo;
    ok(c2.cards.valorTotal === 14 && c2.cards.valorAproximadoDevolucoes === 0 && c2.cards.valorItensDesconhecidos === 0, '  um item so e sem preco no item: usa o preco da linha (14), sem marcar');
  }
  // ── itens_devolvidos torto (qtd 0, item nulo, string) nao derruba nem inventa ──
  {
    const r = relatorio([base({ id: 6, produto_sku: 'A', produto_qtd: 1, produto_valor_unit: 5, itens_devolvidos: [null, { sku: 'A', qtd: 0 }, { sku: 'A', qtd: 'x' }] }), base({ id: 7, produto_sku: 'B', produto_qtd: 1, produto_valor_unit: 5, itens_devolvidos: 'lixo' })]);
    const { corpo, status } = await r.rodar();
    ok(status === 200 && corpo.cards.valorTotal === 10 && corpo.cards.valorAproximadoDevolucoes === 2, '  itens_devolvidos sem item valido = cai no legado (2 × R$5, as duas aproximadas). Veio: ' + corpo.cards.valorTotal + '/' + corpo.cards.valorAproximadoDevolucoes);
  }
  // ── a tela que grava: itens_devolvidos leva o valor unitario do item da NF; produto_valor_unit e do 1o item BIPADO ──
  {
    const T = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'triagem.js'), 'utf8');
    ok(/valor_unit: /.test(T) && /bipagemEstado\.itensEsperados\.push\(\{[\s\S]{0,200}valor:/.test(T), 'triagem.js: itens esperados guardam o valor da NF e itens_devolvidos leva valor_unit');
    ok(!/produto_valor_unit: itemOrder\?\.unit_price,/.test(T), '⚠️ produto_valor_unit nao e mais o preco do 1o order_item do ML');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
