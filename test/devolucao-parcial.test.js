// Roda com: node test/devolucao-parcial.test.js
//
// O TikTok abre UMA solicitacao de devolucao por ITEM da nota, cada uma com
// seu rastreio — o mesmo pedido volta em VARIAS CAIXAS, em dias diferentes.
//
// Medido no pedido 585110624384091852 da Girassol: nota com duas linhas de
// R$ 59,90 (total R$ 114,80), duas solicitacoes de R$ 57,40, dois rastreios,
// entregues em 31/07 e 03/08.
//
// Na bancada isso ja esta resolvido. Este modulo e o lado do ADMIN:
//   "faz tipo um merge, ou deixa o card tipo 1o Devolucao triada /
//    AGUARDADO 2a devolucao"
//   "As 2 sendo devolvidas e triadas, mudar a condicao do card, e saberei
//    q posso emitir a NF"

const dp = require('../lib/devolucao-parcial');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// ── a chave e o PEDIDO, nao o envio ──────────────────────────────────
{
  ok(dp.chaveDoGrupo({ order_id: '585110624384091852' }) === '585110624384091852',
     'agrupa pelo PEDIDO');
  ok(dp.chaveDoGrupo({ order_id: '5851-1062/4384091852' }) === '585110624384091852',
     '  ignorando separadores');
  ok(dp.chaveDoGrupo({ shipment_id: '47501559178' }) === null,
     'SEM pedido nao agrupa — envio nao serve, e justamente o que MUDA entre as caixas');
  ok(dp.chaveDoGrupo(null) === null, 'nulo nao quebra');
}

// ── quantas caixas esperar, vindo da captura ─────────────────────────
{
  const capturadas = [
    { pedido: '585110624384091852', tipo_tiktok: 'RETURN_AND_REFUND', status: 'RETURN_OR_REFUND_REQUEST_COMPLETE' },
    { pedido: '585110624384091852', tipo_tiktok: 'RETURN_AND_REFUND', status: 'RETURN_OR_REFUND_REQUEST_COMPLETE' },
    // reembolso puro NAO vira caixa (metade das devolucoes do TikTok)
    { pedido: '585514776487560610', tipo_tiktok: 'REFUND', status: 'RETURN_OR_REFUND_REQUEST_COMPLETE' },
    // cancelada tambem nao
    { pedido: '585431760714434388', tipo_tiktok: 'RETURN_AND_REFUND', status: 'RETURN_OR_REFUND_REQUEST_CANCEL' },
  ];
  const mapa = dp.esperadoDeCapturadas(capturadas);
  ok(mapa['585110624384091852'] === 2, 'o pedido das duas caixas espera 2');
  ok(mapa['585514776487560610'] === undefined,
     'reembolso PURO nao entra: nunca vira caixa');
  ok(mapa['585431760714434388'] === undefined, 'cancelada tambem nao');
}

// ── o estado do grupo ────────────────────────────────────────────────
{
  const esperado = { '585110624384091852': 2 };

  // so a primeira caixa triada
  const uma = dp.agrupar(
    [{ id: 1, order_id: '585110624384091852', created_at: '2026-07-31T12:00:00Z' }],
    esperado);
  ok(uma.length === 1 && uma[0].vieram === 1 && uma[0].esperadas === 2,
     'com 1 de 2 triadas: sabe que vieram 1 e esperam 2');
  ok(uma[0].completo === false, '  e NAO esta completo');
  ok(uma[0].faltam === 1, '  falta 1 pacote');
  ok(/aguardando 1 pacote/.test(uma[0].rotulo), '  com rotulo dizendo isso: ' + uma[0].rotulo);

  // as duas triadas
  const duas = dp.agrupar([
    { id: 1, order_id: '585110624384091852', created_at: '2026-07-31T12:00:00Z' },
    { id: 2, order_id: '585110624384091852', created_at: '2026-08-03T13:00:00Z' },
  ], esperado);
  ok(duas[0].completo === true, 'com as 2 triadas: COMPLETO');
  ok(duas[0].faltam === 0, '  nada faltando');
  ok(/pode emitir a NF/.test(duas[0].rotulo), '  e o rotulo libera a emissao');
}

// ── na duvida, NAO libera ────────────────────────────────────────────
{
  // pedido que nao esta na captura: nao sei quantas esperar
  const semInfo = dp.agrupar(
    [{ id: 9, order_id: '999888777', created_at: '2026-08-01T10:00:00Z' }], {});
  ok(semInfo[0].esperadas === null, 'pedido fora da captura: esperado desconhecido');
  ok(semInfo[0].completo === false,
     '  e NAO se declara completo — emitir cedo e pior que esperar');
  ok(semInfo[0].parcial === false, '  triagem unica sem info nao vira "parcial"');
}

// ── anotar: campos NOVOS, sem mexer no que a tela ja usa ─────────────
{
  const triagens = [
    { id: 1, order_id: '585110624384091852', tipo: 'aprovado', produto_sku: 'KIT65', created_at: '2026-07-31T12:00:00Z' },
    { id: 2, order_id: '585110624384091852', tipo: 'aprovado', produto_sku: 'KIT9', created_at: '2026-08-03T13:00:00Z' },
    { id: 3, order_id: '111222333', tipo: 'aprovado', produto_sku: 'XYZ', created_at: '2026-08-05T09:00:00Z' },
  ];
  const anotadas = dp.anotar(triagens, { '585110624384091852': 2 });

  ok(anotadas.length === 3, 'devolve a MESMA quantidade de triagens');
  ok(anotadas[0].tipo === 'aprovado' && anotadas[0].produto_sku === 'KIT65',
     '  com os campos originais intactos (a tela ja os consome)');

  ok(anotadas[0].parcial && anotadas[0].parcial.esta === 1,
     'a 1a caixa sabe que e a numero 1');
  ok(anotadas[1].parcial && anotadas[1].parcial.esta === 2, '  e a 2a que e a numero 2');
  ok(anotadas[0].parcial.completo === true, '  as duas chegaram: completo');
  ok(anotadas[0].parcial.irmas.indexOf(2) !== -1, '  e cada uma conhece a irma');

  ok(!anotadas[2].parcial, 'triagem de pedido normal NAO ganha o campo (nao polui a tela)');
}

// ── ordem de chegada, nao de id ──────────────────────────────────────
{
  // a caixa gravada com id MENOR pode ter chegado depois
  const fora = dp.anotar([
    { id: 50, order_id: 'P1', created_at: '2026-08-10T10:00:00Z' },
    { id: 10, order_id: 'P1', created_at: '2026-08-01T10:00:00Z' },
  ], { P1: 2 });
  const a10 = fora.find((x) => x.id === 10);
  ok(a10.parcial.esta === 1, 'a ordem e por DATA de chegada, nao por id');
}

// ── esta ligado na rota e no painel? ────────────────────────────────
{
  const fs = require('fs');
  const path = require('path');
  const RAIZ = path.join(__dirname, '..');
  const SERVER = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const PAINEL = fs.readFileSync(path.join(RAIZ, 'public', 'painel-devolucoes.html'), 'utf8');

  ok(/devParcial\.anotar\(data, devParcial\.esperadoDeCapturadas/.test(SERVER),
     'a rota do admin cruza as triagens com as devolucoes capturadas');
  ok(/from\('devolucoes_capturadas'\)/.test(SERVER),
     '  buscando quantas caixas o marketplace disse que viriam');
  ok(/catch \(e\) \{[\s\S]{0,200}cruzamento de entrega parcial falhou/.test(SERVER),
     '  e falha no cruzamento NAO derruba a listagem (volta a ser a de antes)');
  ok(/pedidos\.slice\(0, 300\)/.test(SERVER),
     '  com teto na consulta, pra nao montar um IN gigante');

  ok(/const multi = d\.parcial \|\| null;/.test(PAINEL), 'o painel le o campo novo');
  ok(/CAIXA ' \+ \(multi\.esta/.test(PAINEL), '  e mostra "CAIXA 1/2" no titulo');
  ok(/AGUARDANDO OUTRA CAIXA/.test(PAINEL),
     '  com aviso laranja enquanto falta caixa');
  ok(/TODAS AS CAIXAS CHEGARAM/.test(PAINEL), '  e verde quando fecha');
  ok(/Espere todas<\/b> antes de emitir a NF/.test(PAINEL),
     '  dizendo explicitamente pra nao emitir a NF antes');
  ok(/escapeHtml\(multi\.rotulo/.test(PAINEL), '  e o texto passa por escapeHtml');

  // nao confundir com o "parcial" que ja existia
  ok(/const ehParcial = \(d\.problema_descricao/.test(PAINEL),
     'o ehParcial antigo (menos itens DENTRO da caixa) continua existindo');
  ok(PAINEL.indexOf('badgeParcial}${badgeMulti}') !== -1,
     '  e as duas badges convivem no titulo, sem se substituir');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
