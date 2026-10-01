'use strict';
// CARD ORFAO x "A ESPREITA" — sugere de onde o pacote veio, casando pelo SKU.
// 30/09, Girassol: 3 cards so com SKU e quantidade (codigo de barras do
// produto bipado no lugar do rastreio). A informacao nunca entrou no card; o
// que o sistema TEM e a lista das devolucoes que esperava.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const { sugerirOrigem, ehOrfao, CAMPOS_ORIGEM } = require('../lib/orfaos-sugerir-origem');

// ── ehOrfao: a lista de origem e a MESMA da trava (triagem-tem-origem) ──
const trava = require('../lib/triagem-tem-origem');
ok(trava.CAMPOS_ORIGEM.every((k) => CAMPOS_ORIGEM.includes(k)),
   '⚠️ todo identificador que a trava aceita conta como origem aqui (as duas listas nao divergem)');
ok(ehOrfao({ produto_sku: 'x', produto_qtd: 1 }) === true, '  so produto = orfao');
ok(ehOrfao({ produto_sku: 'x', nf_numero: '-' }) === true, '  nf_numero "-" = orfao (e como o painel mostra vazio)');
for (const k of CAMPOS_ORIGEM) ok(ehOrfao({ produto_sku: 'x', [k]: '1' }) === false, `  com ${k} NAO e orfao`);

// ── sugerirOrigem: o caso real, com 3 fontes e formatos diferentes ──
const cards = [
  { id: 1, produto_sku: '10-AE-8f-g80-180mm', produto_qtd: 5 },
  { id: 2, produto_sku: 'parlamplaina', produto_qtd: 1 },
  { id: 3, produto_sku: 'DISCOPRATO', nf_numero: '125217', order_id: '2000014580295263' },
];
const esp = [
  { marketplace: 'ml', pedido: '200001', tracking: 'NX1', cliente_ml: 'Ana', itens: [{ sku: '10-ae-8f-g80-180mm', qtd: 5 }], dias_em_transito: 3 },  // ML: itens[].sku
  { marketplace: 'shopee', pedido: '2609ABC', tracking: 'BR123Z', cliente: 'Bruno', itens: [{ sku: '10-AE-8F-G80-180MM ', qtd: 2 }], dias_em_transito: 1 },
  { marketplace: 'tiktok', pedido: '5861', tracking: 'TT9', produto_sku: '10-AE-8f-g80-180mm, OUTRO', dias_desde: 8 },   // captura: produto_sku "a, b"
  { marketplace: 'good', pedido: '77', tracking: 'G1', sku: '10-ae-8f-g80-180mm' },                                      // GOOD: sku na raiz
];
const r = sugerirOrigem(cards, esp, { jaTriado: (it) => it.tracking === 'TT9' });
ok(r.total_orfaos === 2, `  acha os 2 orfaos e ignora o card com origem (achou ${r.total_orfaos})`);
const o1 = r.orfaos.find((x) => x.orfao.id === 1);
ok(o1.candidatos.length === 4, `⚠️ casa o SKU nos 4 formatos: itens[].sku, produto_sku "a, b", sku na raiz, com caixa/espaco diferentes (${o1.candidatos.length})`);
ok(o1.candidatos[0].tracking === 'NX1' && o1.candidatos[0].qtd_bate === true, '  o primeiro e o nao-triado com a quantidade batendo');
ok(o1.candidatos[o1.candidatos.length - 1].tracking === 'TT9' && o1.candidatos[o1.candidatos.length - 1].ja_triado === true, '  o ja triado vai por ultimo, marcado');
ok(/mais de um candidato/.test(o1.dica), '  com varios candidatos, a dica manda conferir cliente e data');
const o2 = r.orfaos.find((x) => x.orfao.id === 2);
ok(o2.candidatos.length === 0 && /Bling/.test(o2.dica), '  sem candidato: a dica manda pro Bling / estoquista');
ok(sugerirOrigem(null, null).total_orfaos === 0, '  entradas nulas nao lancam');
ok(sugerirOrigem([{ id: 9, produto_sku: '' }], esp).orfaos[0].candidatos.length === 0, '  orfao sem SKU: zero candidatos (nao casa com tudo)');

// ── as rotas existem nas 3 empresas e usam a lib ──
const compat = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js'), 'utf8');
const good = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
ok(/router\.get\('\/api\/admin\/orfaos'/.test(compat) && /orfaos-sugerir-origem/.test(compat), '  rota na fabrica (AMB + Girassol)');
ok(/app\.get\('\/api\/admin\/orfaos'/.test(good) && /orfaos-sugerir-origem/.test(good), '  rota na GOOD (portar tudo, sempre)');
// Regra 12: a fabrica usa deps.chaveDados (CHAVE_DADOS nao existe no compat)
const iR = compat.indexOf("router.get('/api/admin/orfaos'");
const rota = compat.slice(iR, iR + 2500);
ok(!/\bCHAVE_DADOS\b/.test(rota) && /deps\.chaveDados/.test(rota), '⚠️ a rota da fabrica usa deps.chaveDados (CHAVE_DADOS nao existe la — 1a versao usava)');
ok(/deps\.espreitaMontada/.test(rota), '  e le a espreita por deps.espreitaMontada (que o app-AMB passa)');
ok(/espreitaMontada: \(\) => CACHES\.espreita/.test(fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8')),
   '  e o app-AMB passa espreitaMontada nas deps');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
