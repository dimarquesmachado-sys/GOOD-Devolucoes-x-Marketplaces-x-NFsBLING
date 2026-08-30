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
  ok(postou2.risco === 'atencao', '  ja em atencao (o prazo mais curto observado e 4 dias)');
  ok(postou2.dias_ate_revelia === 2, '  com 2 dias ate o pior caso');
}

// ── o escalonamento ──────────────────────────────────────────────────
{
  // b182.2: recalibrado com 19 casos reais — o prazo mais curto foi de
  // 4 DIAS, entao o aviso precisa vir antes disso
  const d = (n) => rev.avaliar([{ evento: 'BUYER_SHIPPED', data: diasAtras(n) }], HOJE);
  ok(d(1).risco === 'ok', '1 dia: ok');
  ok(d(2).risco === 'atencao', '2 dias: ATENCAO (2 dias de folga sobre o pior caso)');
  ok(d(3).risco === 'urgente', '3 dias: URGENTE');
  ok(d(4).risco === 'urgente', '4 dias: o prazo mais curto ja observado — tem que estar urgente HA DIAS');
  ok(d(8).risco === 'urgente', '8 dias: continua urgente');
  ok(d(4).dias_ate_revelia === 0, '  e o contador nao vira negativo');

  // a calibragem antiga (aviso no 4o) deixaria o pior caso sem folga
  ok(rev.AVISO_A_PARTIR_DE < 4,
     'o aviso vem ANTES do prazo mais curto observado (4 dias) — errar pra mais custa olhar um caso a toa; pra menos custa o produto');
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

// ── b182.1: so o timeout DO VENDEDOR e revelia nossa ─────────────────
// Timeout do COMPRADOR (nao postou no prazo) e o oposto: ali quem perdeu
// foi ele e a devolucao cai a nosso favor. Contar como revelia inflaria o
// prejuizo e mandaria o dono olhar caso que nao existe.
{
  ok(rev.ehTimeoutDoVendedor('SELLER_REJECT_RECEIVE_DELIVERED_TIMEOUT') === true,
     'o evento real da revelia e reconhecido');
  ok(rev.ehTimeoutDoVendedor('BUYER_SHIP_TIMEOUT') === false,
     'timeout do COMPRADOR nao e revelia nossa');
  ok(rev.ehTimeoutDoVendedor('RETURN_TIMEOUT') === false,
     '  e timeout generico tambem nao (na duvida, nao acusa)');

  const doComprador = rev.avaliar([
    { evento: 'ORDER_RETURN', data: diasAtras(20) },
    { evento: 'BUYER_SHIP_TIMEOUT', data: diasAtras(10) },
  ], HOJE);
  ok(doComprador.perdido_por_revelia === false,
     'linha do tempo com timeout do comprador NAO vira revelia');
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
  ok(r.urgentes === 2, '  ambos urgentes na calibragem nova (4 e 5 dias, com o pior caso em 4)');
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

// ── b182: o formato REAL, medido em producao ────────────────────────
// A rota deles NAO devolve os eventos crus — devolve a conta pronta. Eu
// procurava eventos e a resposta vinha ZERADA com 50 revelias reais.
{
  const REAL = {
    ok: true, loja: 'girassol', total_com_eventos: 99,
    perdidas_por_revelia: 50,
    valor_das_devolucoes_com_revelia: 2715.41,
    aguardando_analise: [],
  };
  const r = rev.separar(REAL, HOJE);
  ok(r.total_perdidas === 50,
     'aproveita a contagem que o outro servico ja fez (50 revelias na Girassol)');
  ok(r.valor_perdido === 2715.41, '  e o valor somado (R$ 2.715,41)');
  ok(r.valor_e_da_tela === true,
     '  marcando que e valor de TELA, nao prejuizo (o extrato debita mais)');
  ok(r.total_com_eventos === 99, '  e quantas foram analisadas');

  // se eu conseguir ver MAIS que eles, o meu numero vale — nunca menos
  const comEventos = rev.separar({
    perdidas_por_revelia: 1,
    valor_das_devolucoes_com_revelia: 10,
    devolucoes: [
      { id: 'X', refund_amount: 50, eventos: [
        { evento: 'BUYER_SHIPPED', data: diasAtras(13) },
        { evento: 'SELLER_REJECT_RECEIVE_DELIVERED_TIMEOUT', data: diasAtras(6) } ] },
      { id: 'Y', refund_amount: 30, eventos: [
        { evento: 'BUYER_SHIPPED', data: diasAtras(13) },
        { evento: 'SELLER_REJECT_RECEIVE_DELIVERED_TIMEOUT', data: diasAtras(6) } ] },
    ],
  }, HOJE);
  ok(comEventos.total_perdidas === 2,
     'se eu enxergo MAIS que eles nos eventos, vale o maior (nunca esconder problema)');

  // sem a conta pronta, o caminho antigo continua valendo
  const soEventos = rev.separar({ devolucoes: [
    { id: 'Z', refund_amount: 20, eventos: [{ evento: 'BUYER_SHIPPED', data: diasAtras(5) }] },
  ] }, HOJE);
  ok(soEventos.total_em_risco === 1 && soEventos.valor_e_da_tela === undefined,
     'e sem a conta pronta, calculo pelos eventos como antes');
}

// ── b183: a lista `aguardando_analise` NAO pode ser descartada ──────
// Ela e a selecao que o proprio servico ja fez de quem esta no relogio.
// Como o formato real nao traz eventos crus, eu nao consigo calcular os
// dias — mas descartar seria jogar fora exatamente quem o alerta existe
// pra mostrar.
{
  const comLista = rev.separar({
    ok: true, loja: 'girassol',
    perdidas_por_revelia: 50, valor_das_devolucoes_com_revelia: 2715.41,
    aguardando_analise: [
      { return_id: 'A', order_id: '111', refund_amount: 57.40 },
      { return_id: 'B', order_id: '222', refund_amount: 29.90 },
    ],
  }, HOJE);
  ok(comLista.total_em_risco === 2,
     'quem esta na lista deles entra em risco, mesmo sem eventos pra calcular os dias');
  ok(comLista.valor_em_risco === 87.30, '  com o valor somado');
  ok(comLista.em_risco[0].origem === 'lista_do_servico',
     '  marcado como vindo pronto, nao calculado por mim');
  ok(/sem eventos pra calcular os dias/.test(comLista.em_risco[0].nota || ''),
     '  com nota explicando a limitacao');
  ok(comLista.total_perdidas === 50, '  e a contagem de perdidas continua vindo deles');

  // se vierem eventos, o calculo manda
  const comEventos = rev.separar({
    aguardando_analise: [
      { return_id: 'C', refund_amount: 10, records: [{ event: 'BUYER_SHIPPED', create_time: diasAtras(3) }] },
    ],
  }, HOJE);
  ok(comEventos.em_risco[0].risco === 'urgente' && !comEventos.em_risco[0].origem,
     'com eventos, o calculo manda e o risco e o real (urgente aos 3 dias)');

  // e quem ja esta fechado nao entra, mesmo vindo da lista
  const fechadoNaLista = rev.separar({
    aguardando_analise: [
      { return_id: 'D', refund_amount: 10, records: [
        { event: 'BUYER_SHIPPED', create_time: diasAtras(9) },
        { event: 'REFUND_SUCCESS', create_time: diasAtras(1) } ] },
    ],
  }, HOJE);
  ok(fechadoNaLista.total_em_risco === 0, 'caso ja resolvido nao entra, mesmo vindo da lista');
}

// ── b183: erro de aplicacao vem ANTES da checagem de loja ───────────
{
  const fs = require('fs');
  const path = require('path');
  const PONTE = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tiktok-ponte.js'), 'utf8');
  const i = PONTE.indexOf('async function eventosDevolucoes');
  const trecho = PONTE.slice(i, i + 2500);
  const iErro = trecho.indexOf('r.corpo.ok === false');
  const iLoja = trecho.indexOf('!r.corpo.loja');
  ok(iErro !== -1 && iLoja !== -1 && iErro < iLoja,
     'o erro de APLICACAO e reportado antes da checagem de loja');
  ok(/resposta de erro costuma nao trazer o campo/.test(trecho),
     '  porque resposta de erro nao costuma trazer a loja — a mensagem apontaria pro lugar errado');
}

// ── b183: o link do impacto aponta pro servico CERTO ────────────────
{
  const fs = require('fs');
  const path = require('path');
  const DEBUG = fs.readFileSync(path.join(__dirname, '..', 'lib', 'rotas-debug.js'), 'utf8');
  ok(/MOVER_PEDIDOS_URL/.test(DEBUG.slice(DEBUG.indexOf('aviso_valor'), DEBUG.indexOf('aviso_valor') + 700)),
     'a dica aponta pro host do Mover-Pedidos, onde a rota realmente mora');
  ok(/k=SUA_ADMIN_KEY/.test(DEBUG),
     '  com a URL inteira e a chave, que e a regra da casa');
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
  // b182.1: a invariante e "so aceitar loja VERIFICADA", nao "recusar so o
  // que divergir" — resposta SEM loja pode ter vindo da padrao em silencio
  ok(/eventos responderam SEM identificar a loja/.test(PONTE),
     '  e resposta SEM o campo loja tambem e recusada');
  ok(/os eventos responderam ok:false/.test(PONTE),
     '  e falha de APLICACAO (HTTP 200 com ok:false) nao vira "zero revelias" silencioso');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
