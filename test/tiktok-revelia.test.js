// Roda com: node test/tiktok-revelia.test.js
//
// Os dois prejuizos que o dono conferiu no extrato em 29/08 NAO foram
// julgamento — foram REVELIA. O TikTok aprovou o reembolso porque ninguem
// respondeu no prazo:
//
//   "This refund was approved because it was not reviewed within the
//    required timeframe"
//
// No pedido 585514776487560610 o cliente ficou com o produto, o valor voltou
// inteiro, e ainda foram cobrados frete e comissao: R$ 21,12 creditados
// contra R$ 41,01 debitados.
//
// O RELOGIO (medido pela conversa do Checkout nos dois casos reais): a
// revelia caiu 6 e 7 dias depois do BUYER_SHIPPED.

const rev = require('../lib/tiktok-revelia');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const HOJE = new Date('2026-08-29T12:00:00Z');
const diasAtras = (n) => Math.floor(new Date(HOJE.getTime() - n * 864e5).getTime() / 1000);

// ── o relogio comeca quando o cliente POSTA ──────────────────────────
{
  const semPostar = rev.avaliar([
    { evento: 'ORDER_RETURN', data: diasAtras(10) },
    { evento: 'SELLER_AGGREE_RETURN', data: diasAtras(9) },
  ], HOJE);
  ok(semPostar.risco === null && semPostar.postou_em === null,
     'cliente ainda NAO postou: nao ha relogio correndo');

  const postou2 = rev.avaliar([
    { evento: 'ORDER_RETURN', data: diasAtras(5) },
    { evento: 'BUYER_SHIPPED', data: diasAtras(2) },
  ], HOJE);
  ok(postou2.dias_desde_postagem === 2, 'postou ha 2 dias: conta a partir do BUYER_SHIPPED');
  ok(postou2.risco === 'ok', '  ainda tranquilo');
  ok(postou2.dias_ate_revelia === 4, '  com 4 dias ate o prazo observado');
}

// ── o escalonamento ──────────────────────────────────────────────────
{
  const d = (n) => rev.avaliar([{ evento: 'BUYER_SHIPPED', data: diasAtras(n) }], HOJE);
  ok(d(3).risco === 'ok', '3 dias: ok');
  ok(d(4).risco === 'atencao', '4 dias: ATENCAO (2 dias de folga antes do prazo)');
  ok(d(5).risco === 'urgente', '5 dias: URGENTE (ultimo dia util pra agir)');
  ok(d(8).risco === 'urgente', '8 dias: continua urgente');
  ok(d(6).dias_ate_revelia === 0, '  e o contador nao vira negativo');
}

// ── caso fechado sai da janela ───────────────────────────────────────
{
  const fechado = rev.avaliar([
    { evento: 'BUYER_SHIPPED', data: diasAtras(9) },
    { evento: 'REFUND_SUCCESS', data: diasAtras(2) },
  ], HOJE);
  ok(fechado.fechado === true && fechado.risco === null,
     'caso ja resolvido nao entra na lista de risco');

  const cancelado = rev.avaliar([
    { evento: 'BUYER_SHIPPED', data: diasAtras(9) },
    { evento: 'RETURN_OR_REFUND_REQUEST_CANCEL', data: diasAtras(1) },
  ], HOJE);
  ok(cancelado.risco === null, 'cancelado tambem sai');
}

// ── o que JA se perdeu: o evento real ────────────────────────────────
{
  const perdido = rev.avaliar([
    { evento: 'ORDER_RETURN', data: diasAtras(20) },
    { evento: 'BUYER_SHIPPED', data: diasAtras(13) },
    { evento: 'SELLER_REJECT_RECEIVE_DELIVERED_TIMEOUT', data: diasAtras(6) },
  ], HOJE);
  ok(perdido.perdido_por_revelia === true,
     'o evento SELLER_REJECT_RECEIVE_DELIVERED_TIMEOUT marca a revelia');
  ok(perdido.fechado === true, '  e fecha o caso');
  ok(perdido.risco === null, '  entao nao aparece como "em risco" (ja era)');
}

// ── postagem repetida reinicia o relogio ─────────────────────────────
{
  const repostou = rev.avaliar([
    { evento: 'BUYER_SHIPPED', data: diasAtras(10) },
    { evento: 'BUYER_SHIPPED', data: diasAtras(1) },
  ], HOJE);
  ok(repostou.dias_desde_postagem === 1,
     'se o cliente postou de novo, vale a postagem MAIS RECENTE');
}

// ── datas em formatos diferentes ─────────────────────────────────────
{
  const segundos = rev.avaliar([{ evento: 'BUYER_SHIPPED', data: diasAtras(5) }], HOJE);
  const ms = rev.avaliar([{ evento: 'BUYER_SHIPPED', data: diasAtras(5) * 1000 }], HOJE);
  const iso = rev.avaliar([{ evento: 'BUYER_SHIPPED', data: new Date(HOJE.getTime() - 5 * 864e5).toISOString() }], HOJE);
  ok(segundos.dias_desde_postagem === 5, 'aceita data em segundos (o padrao do TikTok)');
  ok(ms.dias_desde_postagem === 5, '  em milissegundos');
  ok(iso.dias_desde_postagem === 5, '  e em texto ISO');
}

// ── a separacao em lote ──────────────────────────────────────────────
{
  const corpo = {
    devolucoes: [
      { id: 'A', order_id: '111', refund_amount: 57.40, eventos: [{ evento: 'BUYER_SHIPPED', data: diasAtras(5) }] },
      { id: 'B', order_id: '222', refund_amount: 29.90, eventos: [{ evento: 'BUYER_SHIPPED', data: diasAtras(4) }] },
      { id: 'C', order_id: '333', refund_amount: 14.95, eventos: [{ evento: 'BUYER_SHIPPED', data: diasAtras(1) }] },
      { id: 'D', order_id: '444', refund_amount: 36.00, eventos: [
        { evento: 'BUYER_SHIPPED', data: diasAtras(13) },
        { evento: 'SELLER_REJECT_RECEIVE_DELIVERED_TIMEOUT', data: diasAtras(6) },
      ] },
      { id: 'E', order_id: '555', refund_amount: 99.00, eventos: [
        { evento: 'BUYER_SHIPPED', data: diasAtras(8) },
        { evento: 'REFUND_SUCCESS', data: diasAtras(2) },
      ] },
    ],
  };
  const r = rev.separar(corpo, HOJE);

  ok(r.total_em_risco === 2, 'separa quem esta em risco: A (5d) e B (4d)');
  ok(r.urgentes === 1, '  com 1 urgente');
  ok(r.valor_em_risco === 87.30, '  e o valor somado: 57,40 + 29,90 = 87,30');
  ok(r.em_risco[0].id === 'A', '  o mais antigo primeiro (menos tempo pra agir)');

  ok(r.total_perdidas === 1 && r.perdidas[0].id === 'D',
     'e conta o que JA se perdeu por revelia');
  ok(r.valor_perdido === 36.00, '  com o valor: R$ 36,00');

  ok(!r.em_risco.some((x) => x.id === 'C'), 'C postou ha 1 dia: fora da janela');
  ok(!r.em_risco.some((x) => x.id === 'E'), 'E ja foi resolvido: fora tambem');
}

// ── o formato de la pode variar ──────────────────────────────────────
{
  const alt = rev.separar({ aguardando_analise: [
    { return_id: 'X', order_id: '9', refund_amount: 10, records: [{ event: 'BUYER_SHIPPED', create_time: diasAtras(6) }] },
  ] }, HOJE);
  ok(alt.total_em_risco === 1,
     'aceita os nomes alternativos de campo (aguardando_analise/records/event/create_time)');
  ok(rev.separar({}, HOJE).total_em_risco === 0, 'corpo vazio nao quebra');
  ok(rev.separar(null, HOJE).total_perdidas === 0, 'corpo nulo tambem nao');
}

// ── esta ligado? ────────────────────────────────────────────────────
{
  const fs = require('fs');
  const path = require('path');
  const RAIZ = path.join(__dirname, '..');
  const DEBUG = fs.readFileSync(path.join(RAIZ, 'lib', 'rotas-debug.js'), 'utf8');
  const SERVER = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const PONTE = fs.readFileSync(path.join(RAIZ, 'lib', 'tiktok-ponte.js'), 'utf8');

  ok(/api\/debug\/tiktok-revelia/.test(DEBUG), 'ha rota pra ver quem esta na janela');
  ok(/tiktokRevelia\.separar\(r\.corpo\)/.test(DEBUG), '  usando a analise');
  ok(/tiktokRevelia,/.test(SERVER), '  com a dep passada por parametro (nao pelo escopo)');
  ok(/tiktokRevelia,\s+\/\/ v4\.68/.test(DEBUG), '  e recebida no modulo');
  ok(/if \(adminOk\(req\)\) return next\(\);/.test(DEBUG.slice(DEBUG.indexOf('tiktok-revelia'), DEBUG.indexOf('tiktok-revelia') + 400)),
     '  aceitando ?k=ADMIN_KEY, como as outras de diagnostico');

  ok(/async function eventosDevolucoes/.test(PONTE), 'a ponte le os eventos do outro servico');
  ok(/\/tiktok\/devolucoes-eventos/.test(PONTE), '  na rota que eles criaram');
  ok(/eventos responderam a loja/.test(PONTE),
     '  mantendo a invariante da loja (nunca aceitar dado de loja que nao pedi)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
