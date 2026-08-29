// Roda com: node test/tiktok-devolucoes.test.js
//
// Reconhecimento de devolucao do TikTok no bipe, e a distincao que o dono
// levantou em 29/08:
//
//   "o devoluções precisa identificar então que o pedido é ou não um pacote
//    em retorno. pode ser q o tiktok equipe tenha só estornado o valor,
//    compensado a loja, e daí a devolução nunca vai existir"
//
// Medido nas 99 devolucoes reais da Girassol: cerca de METADE e reembolso
// puro. O caso conferido no painel foi o pedido 585654590105159643 —
// entregue e assinado em 24/08, cliente abriu "pacote nao recebido" no dia
// seguinte, TikTok reembolsou R$ 29,90 e COMPENSOU a loja. Pacote nenhum
// vai chegar.

const tk = require('../lib/tiktok-devolucoes');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// ── dados REAIS, copiados da coleta da Girassol ──────────────────────
const COM_RETORNO = {
  id: '4041987387092076103', order_id: '585498846084564551',
  tipo: 'RETURN_AND_REFUND', status: 'RETURN_OR_REFUND_REQUEST_COMPLETE',
  motivo_texto: "Item doesn't match description", valor: 29.9,
  return_tracking_number: 'TT123456789BR',
  criado_em: 1786985629, atualizado_em: 1787763463,
};
const SO_REEMBOLSO = {   // o caso conferido no painel
  id: '4042074755696855003', order_id: '585654590105159643',
  tipo: 'REFUND', status: 'RETURN_OR_REFUND_REQUEST_COMPLETE',
  motivo_texto: "Package wasn't received", valor: 29.9,
  criado_em: 1787636992, atualizado_em: 1787709728,
};
const EM_ABERTO = {
  id: '4042106320854681196', order_id: '585729047986079340',
  tipo: 'REFUND', status: 'RETURN_OR_REFUND_REQUEST_PENDING',
  motivo_texto: 'Package received but missing item', valor: 29.9,
  criado_em: 1787872849,
};
const AGUARDANDO_ENVIO = {
  id: '4042124431075673800', order_id: '585677127324436168',
  tipo: 'RETURN_AND_REFUND', status: 'AWAITING_BUYER_SHIP',
  motivo_texto: "Item doesn't match description", valor: 29.9,
  criado_em: 1788004640,
};

// ── vai chegar pacote? ───────────────────────────────────────────────
{
  ok(tk.vaiChegarPacote(COM_RETORNO) === true,
     'RETURN_AND_REFUND: vai chegar pacote');
  ok(tk.vaiChegarPacote(SO_REEMBOLSO) === false,
     'REFUND: nao vai chegar nada (o caso do pedido 5856545901... conferido no painel)');
  ok(tk.vaiChegarPacote({ tipo: 'COISA_NOVA' }) === null,
     'tipo desconhecido: nao chuta');

  const n1 = tk.normalizar(COM_RETORNO, 'girassol');
  ok(n1.vai_chegar === true, '  e o normalizado carrega vai_chegar=true');
  const n2 = tk.normalizar(SO_REEMBOLSO, 'girassol');
  ok(n2.vai_chegar === false, '  e false no reembolso puro');

  // em aberto: o desfecho ainda pode mudar
  const n3 = tk.normalizar(EM_ABERTO, 'girassol');
  ok(n3.vai_chegar === null,
     'solicitacao EM ABERTO marcada como indefinida (REFUND agora pode virar devolucao depois)');
  ok(n3.em_aberto === true, '  e sinalizada como em aberto');

  const n4 = tk.normalizar(AGUARDANDO_ENVIO, 'girassol');
  ok(n4.vai_chegar === true,
     'AWAITING_BUYER_SHIP com RETURN_AND_REFUND: vai chegar (o comprador ainda vai postar)');
}

// ── por onde o bipe casa ─────────────────────────────────────────────
{
  const chaves = tk.chavesDe(COM_RETORNO);
  ok(chaves.indexOf('TT123456789BR') !== -1, 'casa pelo RASTREIO (o que a etiqueta traz)');
  ok(chaves.indexOf('585498846084564551') !== -1, '  e pelo pedido');
  ok(chaves.indexOf('4041987387092076103') !== -1, '  e pelo id da devolucao');

  const semRastreio = tk.chavesDe(SO_REEMBOLSO);
  ok(semRastreio.indexOf('585654590105159643') !== -1,
     'reembolso puro nao tem rastreio, mas casa pelo pedido');
  ok(semRastreio.length === 2, '  com as duas chaves que existem, sem entradas vazias');
}

// ── achar na lista ───────────────────────────────────────────────────
{
  const lista = [COM_RETORNO, SO_REEMBOLSO, EM_ABERTO];

  const porRastreio = tk.acharNaLista(lista, 'TT123456789BR', 'girassol');
  ok(porRastreio && porRastreio.id === '4041987387092076103', 'acha pelo rastreio bipado');
  ok(porRastreio.vai_chegar === true, '  e ja diz que o pacote vem');

  const porPedido = tk.acharNaLista(lista, '585654590105159643', 'girassol');
  ok(porPedido && porPedido.vai_chegar === false,
     'acha pelo pedido, e avisa que NAO vem pacote (era o ponto do dono)');

  // etiqueta impressa costuma trazer separador que o codigo nao tem
  ok(tk.acharNaLista(lista, 'TT-123456789-BR', 'girassol') !== null,
     'casa mesmo com separadores na etiqueta (compara so letras e numeros)');
  ok(tk.acharNaLista(lista, 'tt123456789br', 'girassol') !== null, '  e sem diferenciar maiusculas');

  ok(tk.acharNaLista(lista, '99999999', 'girassol') === null, 'codigo desconhecido: null');
  ok(tk.acharNaLista(lista, '', 'girassol') === null, 'codigo vazio: null');
  ok(tk.acharNaLista(null, 'x', 'girassol') === null, 'lista ausente: null');
}

// ── datas: o TikTok manda em SEGUNDOS ────────────────────────────────
{
  const n = tk.normalizar(COM_RETORNO, 'girassol');
  ok(n.criado_em === new Date(1786985629 * 1000).toISOString(),
     'criado_em convertido de segundos pra data (o TikTok nao usa milissegundos)');
  ok(n.criado_em.indexOf('2026') === 0, '  e cai em 2026, nao em 1970');
}

// ── "nao achei" com coleta pendente NAO e "nao existe" ───────────────
{
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tiktok-devolucoes.js'), 'utf8');
  ok(/coleta_pendente: !!r\.coleta_pendente/.test(SRC),
     'o resultado repassa se a coleta esta pendente');
  ok(/aviso: r\.aviso \|\| null/.test(SRC),
     '  e o aviso da ponte, pra "nao achei" nao virar "nao existe"');
  ok(/if \(!r \|\| !r\.ok\)/.test(SRC),
     '  e ponte com erro nao vira lista vazia silenciosa');
}

// ── esta ligado na cascata do bipe? ─────────────────────────────────
{
  const fs = require('fs');
  const path = require('path');
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  ok(/tiktokDev\.procurar\(tiktokPonte, 'good', codigoOriginal/.test(SERVER),
     'a busca consulta o TikTok quando nada antes resolveu');
  ok(/tipo: 'tiktok_devolucao'/.test(SERVER),
     '  e registra a tentativa, como os outros marketplaces');

  // a ordem importa: TikTok e o que tem menos etiqueta bipavel
  const iShopee = SERVER.indexOf("tipo: 'shopee_return'");
  const iTikTok = SERVER.indexOf("tipo: 'tiktok_devolucao'");
  const iNome = SERVER.indexOf('ULTIMO RECURSO: o texto tem cara de NOME');
  ok(iShopee < iTikTok, 'o TikTok e tentado DEPOIS da Shopee (so 30 de 99 tem rastreio)');
  ok(iTikTok < iNome, '  e ANTES do ultimo recurso por nome');

  // o aviso que o dono pediu
  ok(/tipo: 'tiktok_sem_retorno'/.test(SERVER),
     'reembolso puro gera AVISO na tela: nenhum pacote vai chegar');
  ok(/e REEMBOLSO, sem devolucao fisica/.test(SERVER),
     '  com o texto dizendo isso em portugues claro');
  ok(/tipo: 'tiktok_indefinido'/.test(SERVER),
     'e solicitacao em aberto avisa que o desfecho ainda pode mudar');
  ok(/coleta_pendente: rTk && rTk\.coleta_pendente/.test(SERVER),
     'a tentativa carrega se a coleta estava pendente ("nao achei" != "nao existe")');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
