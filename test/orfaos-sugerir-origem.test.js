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

// ── b467: a Girassol tem metade do catalogo em variacao — a Shopee/ML informam
// o SKU do PAI, o card tem o da VARIACAO. Exato nao casa; pai e titulo casam,
// marcados como aproximados. Os limites foram medidos com os titulos REAIS
// do "a espreita" da Girassol (01/10).
{
  const { raizSku, tituloCasa } = require('../lib/orfaos-sugerir-origem');
  ok(raizSku('10-AE-8f-g80-180mm') === raizSku('10-AE-8F-180mm-PAI'), '⚠️ raiz do SKU: a variacao (g80) casa com o pai (-PAI)');
  ok(raizSku('10-AE-8f-g80-180mm') !== raizSku('10-furo-180mm-PAI'), '  mas anti-empastamento NAO casa com lisa');
  const AE80 = '10 X Lixas Disco Anti-Empastamento 7 Polegadas 180mm 8 Furos Pluma Lixadeira Politriz KaQi GRÃO:80';
  ok(tituloCasa('Par Lâminas Faca 82mm Corte p/ Plaina Elétrica PB-92 1900b HSS 82 Universal KaQi',
                '4 x Lâminas Faca 82mm Corte p/ Plaina Elétrica PB-92 1900b HSS 82 Universal KaQi'),
     '⚠️ titulo: "Par Laminas..." casa com "4 x Laminas..." (mesmo produto, kit diferente)');
  ok(!tituloCasa(AE80, '10 X Lixas Disco Grão 7 Polegadas 180mm 8 Furos Lixadeira Politriz KaQi'),
     '  titulo: anti-empastamento NAO casa com lisa (10 palavras iguais em 12 nao basta)');
  ok(!tituloCasa(AE80, '30 X Lixas Disco Anti-Empastamento 5 Polegadas 125mm 8 Furos Pluma Lixadeira Politriz KaQi'),
     '⚠️ titulo: 180mm NAO casa com 125mm (medida que nao bate derruba)');
  ok(!tituloCasa('Suporte Prato Disco 4 Polegadas 100mm Politriz Esmerilhadeira Lixadeira M14 KaQi',
                 'Suporte Disco Prato 125mm 5 Polegadas p/ Politriz Esmerilhadeira Lixadeira M14 KaQi'),
     '  titulo: prato 100mm NAO casa com 125mm');
  // o caso real dos 3 orfaos x a lista real (recorte)
  const cards = [
    { id: 1, produto_sku: '10-AE-8f-g80-180mm', produto_qtd: 5, produto_titulo: AE80 },
    { id: 2, produto_sku: '10-AE-8f-g800-180mm', produto_qtd: 2, produto_titulo: AE80.replace('GRÃO:80', 'GRÃO:800') },
    { id: 3, produto_sku: 'parlamplaina', produto_qtd: 1, produto_titulo: 'Par Lâminas Faca 82mm Corte p/ Plaina Elétrica PB-92 1900b HSS 82 Universal KaQi' },
  ];
  const esp2 = [
    { marketplace: 'shopee', pedido: '260703PQQ2XJC2', tracking: 'BR260329038134J', itens: [{ titulo: '10 X Lixas Disco Anti-Empastamento 7 Polegadas 180mm 8 Furos Grão Lixadeira Politriz KaQi', sku: '10-AE-8F-180mm-PAI', qtd: 2 }] },
    { marketplace: 'shopee', pedido: '260804ECX604PK', tracking: 'BR262733569134U', itens: [{ titulo: '4 x Lâminas Faca 82mm Corte p/ Plaina Elétrica PB-92 1900b HSS 82 Universal KaQi', sku: '2xpareslaminas', qtd: 1 }] },
    { marketplace: 'shopee', pedido: '260819Q58K3AWF', tracking: 'BR263672109548S', itens: [{ titulo: '10 X Lixas Disco Grão 7 Polegadas 180mm 8 Furos Lixadeira Politriz KaQi', sku: '10-furo-180mm-PAI', qtd: 1 }] },
  ];
  const r2 = sugerirOrigem(cards, esp2);
  const c1 = r2.orfaos.find((x) => x.orfao.id === 1).candidatos;
  const c2 = r2.orfaos.find((x) => x.orfao.id === 2).candidatos;
  const c3 = r2.orfaos.find((x) => x.orfao.id === 3).candidatos;
  ok(c1.length === 1 && c1[0].pedido === '260703PQQ2XJC2' && c1[0].via === 'sku_pai', '⚠️ orfao g80: casa o pedido das AE pelo pai, e SO ele (nao a lisa)');
  ok(c2.length === 1 && c2[0].via === 'sku_pai' && c2[0].qtd_bate === true, '  orfao g800: o mesmo, e a quantidade bate');
  ok(c3.length === 1 && c3[0].pedido === '260804ECX604PK' && c3[0].via === 'titulo', '⚠️ orfao laminas: casa pelo titulo (SKU "parlamplaina" x "2xpareslaminas" nao tem raiz comum)');
  ok(/via = como casou/.test(r2.orfaos.find((x) => x.orfao.id === 3).dica), '  e a dica explica que via != sku e aproximado');
}

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
// ⚠️ b466 — REGRA 12 NA FORMA MAIS TRAICOEIRA: o nome EXISTIA no app-AMB, mas
// num objeto de deps que vai pra OUTRO modulo. O compat recebia
// { auth, db, bling, cfg, multer, versao } — sem espreitaMontada nem
// chaveDados — e a rota dizia "nao montado" pra sempre em producao. O teste
// anterior conferia que o nome existia no arquivo, nao que chegava NA
// CHAMADA DO COMPAT. Agora confere a chamada.
{
  const app = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  const iM = app.indexOf('compat.montar(router,');
  const chamada = app.slice(iM, app.indexOf(');', iM) + 2);
  ok(iM > 0 && /espreitaMontada: \(\) => CACHES\.espreita/.test(chamada),
     '⚠️ espreitaMontada e passada NA CHAMADA compat.montar(...) (nao so em algum objeto do arquivo)');
  ok(/chaveDados: CHAVE_DADOS/.test(chamada),
     '  e chaveDados tambem (a rota responde "empresa")');
  // e todo deps.X que a rota de orfaos le esta na chamada
  const usados = [...new Set([...rota.matchAll(/deps\.(\w+)/g)].map((m) => m[1]))];
  const faltam = usados.filter((k) => !new RegExp('\\b' + k + '\\b').test(chamada));
  ok(faltam.length === 0, `  todo deps.X que a rota le chega na chamada (faltam: ${faltam.join(', ') || 'nenhum'})`);
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
