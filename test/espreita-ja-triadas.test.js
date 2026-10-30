'use strict';
// 30/10 — a espreita da fabrica (Girassol/AMB) nunca cruzava com as triagens: a tosquiadeira 2609069UWS4UFX, triada,
// continuou no bloco 'chegou e ninguem bipou', e os cards 117/129 (triados) tambem. Roda a peca de PRODUCAO.
const fs = require('fs'); const path = require('path');
const { chavesTriadas, semTriadas } = require('../lib/espreita-ja-triadas');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const TRIAGENS = [
  { order_id: '2609069UWS4UFX', shipment_id: 'AP487838326BR', problema_descricao: null },           // tosquiadeira (Shopee)
  { order_id: '2000018478090602', shipment_id: '48075103729', problema_descricao: null },           // card 129, Jonatas (ML)
  { order_id: '2000099999999999', shipment_id: null, problema_descricao: 'estornada [caso:#777] sem retorno' },  // caso, nao bipe
  { order_id: null, shipment_id: null, tracking: 'BR999888777666X', problema_descricao: null },     // Codex: triagem SO com rastreio
  { order_id: null, pack_id: '2000015000000001', shipment_id: null, problema_descricao: null },      // triagem pelo pack (carrinho ML)
];
function sbFalso({ erro } = {}) {
  return { from: () => ({ select: () => ({ in: async (col, vals) => (erro ? { data: null, error: { message: 'timeout' } }
    : { data: TRIAGENS.filter((r) => vals.includes(String(r[col]))), error: null }) }) }) };
}
(async () => {
  const entregues = [
    { marketplace: 'shopee', pedido: '2609069UWS4UFX', tracking: 'AP487838326BR' },                  // triada
    { marketplace: 'ml', pedido: '2000018478090602', tracking: 'E7SKWJGYQRLJJODKORQCNPJ5MI', shipment_devolucao: 48075103729 },  // triada
    { marketplace: 'ml', pedido: '2000099999999999', tracking: 'XYZ' },                              // so tem 'caso' registrado
    { marketplace: 'shopee', pedido: '260813898DFEWW', tracking: 'BR260236192139R' },                // nao triada
  ];
  const r = await chavesTriadas(sbFalso(), 'devolucoes', entregues);
  const fica = semTriadas(entregues, r.achados).map((d) => d.pedido);
  ok(!fica.includes('2609069UWS4UFX'), '⚠️ tosquiadeira triada sai do bloco "chegou e ninguem bipou" (pelo rastreio/pedido)');
  ok(!fica.includes('2000018478090602'), '⚠️ card 129 (ML, triado) sai — casou pelo pedido e pelo envio de devolucao');
  ok(fica.includes('2000099999999999'), '  registro de "caso" das estornadas (nao e bipe fisico) NAO tira o card');
  ok(fica.includes('260813898DFEWW'), '  devolucao nao triada continua no bloco');
  // so pelo envio de devolucao do ML (o pedido nao bate)
  const r2 = await chavesTriadas(sbFalso(), 'devolucoes', [{ marketplace: 'ml', pedido: 'OUTRO', shipment_devolucao: '48075103729' }]);
  ok(semTriadas([{ marketplace: 'ml', pedido: 'OUTRO', shipment_devolucao: '48075103729' }], r2.achados).length === 0, '  ML: o numero do envio de devolucao sozinho ja identifica a triagem');
  // Codex #512: triagem registrada SO com o rastreio (coluna tracking) tira o card
  const soRastreio = [{ marketplace: 'shopee', pedido: 'PSR', tracking: 'BR999888777666X' }];
  const r4 = await chavesTriadas(sbFalso(), 'devolucoes', soRastreio);
  ok(semTriadas(soRastreio, r4.achados).length === 0, '⚠️ Codex: triagem feita so com o rastreio (coluna tracking) tira o card');
  const doPack = [{ marketplace: 'ml', pedido: '2000018000000001', pack_id: '2000015000000001' }];
  const r5 = await chavesTriadas(sbFalso(), 'devolucoes', doPack);
  ok(semTriadas(doPack, r5.achados).length === 0, '  triagem registrada pelo pack do carrinho tira o card');
  // em transito: so Shopee (como a GOOD v3.79)
  const emT = [{ marketplace: 'shopee', pedido: '2609069UWS4UFX', tracking: 'AP487838326BR' }, { marketplace: 'ml', pedido: '2000018478090602' }];
  ok(semTriadas(emT, r.achados, { soShopee: true }).map((d) => d.marketplace).join() === 'ml', '  em transito: tira so a Shopee triada (paridade com a GOOD)');
  // falha na consulta: nao esconde nada
  const r3 = await chavesTriadas(sbFalso({ erro: true }), 'devolucoes', entregues);
  ok(r3.ok === false && semTriadas(entregues, r3.achados).length === entregues.length, '⚠️ consulta falhou: a lista vai INTEIRA (nao some com pendente)');
  ok((await chavesTriadas(null, 'devolucoes', entregues)).ok === false, '  sem banco: nao filtra');
  // a fabrica usa a peca nas listas da tela e na lista da busca
  const app = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/const triadas = await espreitaTriadas\.chavesTriadas\(db\.cliente\(\), db\.tabelas && db\.tabelas\.devolucoes,/.test(app)
    && /\n    entregues: entreguesFinal,\n/.test(app) && /\n    em_transito: emTransitoFinal,\n/.test(app) && /entregues: entreguesFinal,\n    ts: Date\.now\(\)/.test(app),
    '⚠️ Girassol/AMB: a espreita (tela e busca) sai sem o que ja foi triado');
  ok(/if \(!fonteFria\) capturarDevolucoesEmpresa\(emTransito\.concat\(extrasShopee\)\)/.test(app), '  a captura continua recebendo a lista inteira (registro do marketplace)');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
