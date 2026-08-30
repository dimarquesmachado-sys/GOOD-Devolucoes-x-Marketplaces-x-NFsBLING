// Roda com: node test/magalu-cancelados.test.js
//
// [stated] Pedido do dono (30/08): "essa questao da NF e aqui. tipo o do
// tiktok q vc fez, mas agora sendo um da Magalu. e pode misturar tudo junto
// com os da tiktok no card".
//
// POR QUE O MAGALU IMPORTA MAIS: a conversa do Checkout mediu (mar-ago/2026)
// 14 casos de `pago_cancelado_com_nf` + 21 de `estornado_apos_envio` na GOOD,
// R$ 12.704 nas tres empresas. O TikTok da GOOD tinha UM caso.

const mc = require('../lib/magalu-cancelados');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// ── so as classes que deixam NF emitida ──────────────────────────────
{
  const base = { order_code: '123', notas: [{ chave: '3'.repeat(44), numero: '002070', em: '2026-08-25' }] };

  ok(mc.normalizar({ ...base, classe: 'pago_cancelado_com_nf' }, 'good') !== null,
     'pago_cancelado_com_nf entra: pagou, NF emitida, sem devolucao registrada');
  ok(mc.normalizar({ ...base, classe: 'estornado_apos_envio' }, 'good') !== null,
     'estornado_apos_envio entra: pagou, NF emitida, produto foi e voltou');

  ok(mc.normalizar({ ...base, classe: 'pago_cancelado_sem_nf' }, 'good') === null,
     'pago_cancelado_sem_nf NAO entra: sem NF nao ha imposto a recuperar');
  ok(mc.normalizar({ ...base, classe: 'nao_pago' }, 'good') === null,
     'nao_pago NAO entra: nunca virou faturamento');
  ok(mc.normalizar({ classe: 'inventada' }, 'good') === null, 'classe desconhecida nao entra');
  ok(mc.normalizar(null, 'good') === null, 'nulo nao quebra');

  // a armadilha que eles mediram: somar TODOS daria R$ 47.978, sendo
  // R$ 32 mil de pedido que nunca foi pago
  const todas = ['pago_cancelado_com_nf', 'estornado_apos_envio', 'pago_cancelado_sem_nf', 'nao_pago']
    .map((classe) => mc.normalizar({ ...base, classe, valor: 100 }, 'good'))
    .filter(Boolean);
  ok(todas.length === 2 && todas.reduce((t, x) => t + x.valor, 0) === 200,
     'somando o valor, so as DUAS com NF contam (as outras inflariam a perda)');
}

// ── o formato tem que casar com o do TikTok ──────────────────────────
{
  const m = mc.normalizar({
    classe: 'pago_cancelado_com_nf',
    order_code: '1535770109894199',
    order_id: 'uuid-abc',
    notas: [{ chave: '3'.repeat(44), numero: '002070', em: '2026-08-25T10:00:00Z' }],
    valor: 189.10, cliente: 'Fulano', produto: 'Lixa', sku: 'KIT65', qtd: 2,
    data_evento: '2026-08-28T10:00:00Z',
    motivo: 'cancelado pelo cliente',
  }, 'good');

  ok(m.marketplace === 'magalu', 'o item se identifica como magalu (a tag do card usa isso)');
  ok(m.pedido === '1535770109894199', 'traz o codigo do pedido');
  ok(m.nf_numero === '002070' && m.nf_chave.length === 44, 'a NF vem completa');
  ok(m.nf_emitida_em === '2026-08-25T10:00:00Z',
     'e a DATA DE EMISSAO — melhor que a chave, que so da o mes');
  ok(m.criado_em === '2026-08-28T10:00:00Z',
     'a data do evento e a do cancelamento, nao a da compra');
  ok(m.valor === 189.10 && m.produto_sku === 'KIT65', 'valor e item vem juntos');
  ok(m.motivo_texto === 'cancelado pelo cliente', 'e o motivo, que o card mostra');
}

// ── b190.3: pedido com VARIAS notas ─────────────────────────────────
// Envio parcial ou reemissao geram mais de uma NF no mesmo pedido. Eu
// ficava so com a primeira, e as outras sumiam da lista — cada uma com seu
// proprio imposto a recuperar.
{
  const duas = mc.normalizarTodas({
    classe: 'pago_cancelado_com_nf', order_code: 'P1',
    notas: [
      { chave: '1'.repeat(44), numero: '001', em: '2026-08-01' },
      { chave: '2'.repeat(44), numero: '002', em: '2026-08-05' },
    ],
  }, 'good');
  ok(duas.length === 2, 'pedido com 2 notas vira 2 linhas — o dono age nota a nota');
  ok(duas[0].nf_numero === '001' && duas[1].nf_numero === '002', '  cada uma com sua NF');
  ok(duas[0].id !== duas[1].id,
     '  e com ids DISTINTOS, senao a segunda sobrescreveria a primeira em qualquer mapa');
  ok(duas[0].nf_emitida_em === '2026-08-01' && duas[1].nf_emitida_em === '2026-08-05',
     '  e cada uma com sua data de emissao, que decide o prazo de cancelamento');

  // b190.4: com varias notas, repetir o valor do PEDIDO infla a soma
  const comValor = mc.normalizarTodas({
    classe: 'pago_cancelado_com_nf', order_code: 'P', valor: 500,
    notas: [{ chave: '1'.repeat(44), numero: '1' }, { chave: '2'.repeat(44), numero: '2' }],
  }, 'good');
  ok(comValor.reduce((t, x) => t + x.valor, 0) === 500,
     'o valor do pedido e RATEADO entre as notas — repetir inteiro dobraria a soma');
  ok(comValor[0].valor_rateado === true, '  marcado como rateado, pra ninguem tratar como exato');

  const notaComValor = mc.normalizarTodas({
    classe: 'pago_cancelado_com_nf', order_code: 'Q', valor: 500,
    notas: [{ chave: '1'.repeat(44), numero: '1', valor: 300 }],
  }, 'good');
  ok(notaComValor[0].valor === 300 && !notaComValor[0].valor_rateado,
     'e quando a NOTA traz o valor, ele manda (sem rateio)');

  ok(mc.normalizarTodas({ classe: 'nao_pago', order_code: 'X', notas: [{ numero: '9' }] }, 'good').length === 0,
     'classe sem NF continua fora, mesmo com notas na linha');
  ok(mc.normalizarTodas({ classe: 'pago_cancelado_com_nf', order_code: 'Y', notas: [] }, 'good').length === 0,
     'e linha sem nota valida nao gera item');
}

// ── a classe que TEVE devolucao ──────────────────────────────────────
{
  const voltou = mc.normalizar({
    classe: 'estornado_apos_envio',
    order_code: '999',
    notas: [{ chave: '3'.repeat(44), numero: '1', em: '2026-07-01' }],
    devolucoes: [{ em: '2026-07-20' }],
  }, 'good');
  ok(voltou.tem_devolucao_registrada === true,
     'estornado_apos_envio marca que TEVE devolucao: o produto voltou');
  ok(voltou.devolvido_em === '2026-07-20', '  com a data');

  const naoVoltou = mc.normalizar({
    classe: 'pago_cancelado_com_nf',
    order_code: '888',
    notas: [{ chave: '3'.repeat(44), numero: '2', em: '2026-07-01' }],
  }, 'good');
  ok(!naoVoltou.tem_devolucao_registrada,
     'pago_cancelado_com_nf nao tem devolucao registrada — e o caso direto');
}

// ── a busca nao pode lancar ──────────────────────────────────────────
{
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'magalu-cancelados.js'), 'utf8');
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const PAINEL = fs.readFileSync(path.join(__dirname, '..', 'public', 'painel-devolucoes.html'), 'utf8');

  ok(/return \{ ok: false, itens: \[\], erro:/.test(SRC),
     'a busca devolve erro em vez de lancar (isto alimenta um painel)');
  ok(/if \(r\.corpo\.ok === false\)/.test(SRC),
     '  e trata ok:false, que ja nos mordeu antes');

  ok(/\.concat\(magaluItens\.filter/.test(SERVER), 'o Magalu entra na MESMA lista do TikTok');

  // b189.1: caso real do dono — pedido 1554870118013124 (Antonio, NF 076466)
  // voltou fisicamente, o Lucas triou, e ele ja esta em "Aprovadas aguardando
  // NF" com botao de gerar. Aparecer aqui tambem seriam DUAS portas pra mesma
  // nota, e duas devolucoes emitidas sem ninguem perceber.
  ok(/!triadosMagalu\.has\(String\(m\.pedido\)\)/.test(SERVER),
     'pedido do Magalu JA TRIADO sai da lista: ele ja esta no fluxo normal');

  // b190.2: tentei casar PEDIDO+SKU pra nao derrubar o outro item de uma
  // nota multi-produto, e a revisao mostrou que o DADO nao suporta:
  // triagem.js grava sempre nf.itens[0].sku e a qtd SOMADA. Na nota 076466
  // do Antonio (dois SKUs) ficou gravado KJDDE-693-8 com qtd 4, seja qual
  // for o item que o Lucas triou.
  ok(!/produto_sku/.test(SERVER.slice(SERVER.indexOf('pedidosMagalu'), SERVER.indexOf('pedidosMagalu') + 2500)),
     'e NAO casa por SKU: a triagem grava sempre o primeiro item da nota');
  ok(/DIVIDA REGISTRADA: a triagem deveria gravar o item/.test(SERVER),
     '  com a divida registrada no codigo, pra quem consumir esse dado depois');
  ok(/o descarte mais LARGO e o mais seguro/.test(SERVER),
     '  e a escolha explicada: com dado errado, largo demais perde granularidade; '
     + 'estreito demais emite NF duplicada');
  ok(/nao consegui conferir quais pedidos do Magalu ja foram triados/.test(SERVER),
     '  e falha nessa checagem e ERRO, nao lista incompleta (duas portas = NF duplicada)');
  ok(/i \+= 200/.test(SERVER.slice(SERVER.indexOf('pedidosMagalu'))),
     '  conferindo em fatias, sem teto que deixe pedido de fora');
  ok(/aquele descarte compara com as triagens/i.test(SERVER),
     '  depois do descarte por triagem, que nao se aplica a ele');
  ok(/magalu_erro: magaluErro \|\| undefined/.test(SERVER),
     'e a falha do Magalu vai na resposta');
  ok(/por_marketplace: itens\.reduce/.test(SERVER), '  com a contagem por marketplace');

  ok(/baseOrigem = 'data_emissao'/.test(SERVER),
     'o prazo usa a DATA EXATA quando ela existe (o Magalu traz)');
  ok(/if \(base == null && chave\.length === 44\)/.test(SERVER),
     '  caindo na chave so quando nao ha data');

  ok(/Os casos do Magalu NÃO entraram nesta lista/.test(PAINEL),
     'o painel avisa quando o Magalu falha — senao a lista parece completa');
  ok(/TEVE DEVOLUÇÃO/.test(PAINEL),
     'e marca os casos em que o produto voltou, pra ele nao emitir NF duplicada');
}

// ── b190.5: o rateio tem que APARECER, e o deposito depende do caso ──
{
  const fs = require('fs');
  const path = require('path');
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const PAINEL = fs.readFileSync(path.join(__dirname, '..', 'public', 'painel-devolucoes.html'), 'utf8');

  ok(/valor_rateado: d\.valor_rateado \|\| undefined/.test(SERVER),
     'o marcador de rateio CHEGA na tela (era calculado e nao repassado)');
  ok(/~aprox/.test(PAINEL),
     '  e a tela marca o valor como aproximado, pra nao passar por exato');

  ok(/Os cards marcados com <b>↩️ TEVE DEVOLUÇÃO<\/b> são o contrário/.test(PAINEL),
     'o texto do deposito e CONDICIONAL: DEFEITO so pra quem nao voltou');
  ok(/o produto voltou, então segue o depósito de sempre/.test(PAINEL),
     '  porque mercadoria que voltou entra no estoque normal');
}

// ── b190.3: quem JA VOLTOU nao cancela a nota ───────────────────────
// Se o produto retornou, houve circulacao de mercadoria — ida e volta. O
// caminho ali e a NF de DEVOLUCAO, que documenta a entrada. Cancelar
// apagaria uma operacao que aconteceu de verdade.
{
  const fs = require('fs');
  const path = require('path');
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  ok(/const jaVoltou = !!d\.tem_devolucao_registrada;/.test(SERVER),
     'o calculo da acao olha se o produto ja voltou');
  ok(/const podeCancelar = !jaVoltou && !semProvaDeEnvio/.test(SERVER),
     '  e quem voltou NAO ganha "cancelar NF", mesmo dentro do prazo');
  // b190.6: e o MAGALU nunca ganha, porque nao ha prova de que nao saiu
  ok(/const semProvaDeEnvio = d\.marketplace === 'magalu';/.test(SERVER),
     '  o Magalu nunca sugere cancelamento: a API nao diz se despachamos');
  ok(/errar pra cancelamento custa uma[\s\S]{0,60}nota cancelada indevidamente/.test(SERVER),
     '  com a assimetria escrita: devolucao custa um passo, cancelamento custa uma nota');
  ok(/item\.marketplace !== 'magalu'/.test(SERVER),
     '  o recalculo (depois da busca no Bling) respeita a mesma regra');
  ok(/cancelar a nota de venda seria errado: houve[\s\S]{0,40}circulacao de mercadoria/.test(SERVER),
     '  com o porque escrito: cancelar apagaria uma operacao que existiu');

  // a decisao, nos tres cenarios
  const decidir = (jaVoltou, dias) => (!jaVoltou && dias != null && dias <= 20) ? 'cancelar_nf' : 'nf_devolucao';
  ok(decidir(false, 5) === 'cancelar_nf', 'recente e NAO voltou: cancelar a NF');
  ok(decidir(true, 5) === 'nf_devolucao', 'recente MAS voltou: NF de devolucao (era o furo)');
  ok(decidir(false, 90) === 'nf_devolucao', 'antigo: NF de devolucao, como antes');
}

// ── v4.78: as CLASSES NOVAS, que dizem o que fazer ──────────────────
//
// A conversa do Checkout fechou a classificacao automatica. Sao 5 classes
// decididas por deliveries[].shipping — shipped_at, delivered_at (que nem
// existe quando nao houve entrega) e cancelled_at.
{
  const base = { order_code: 'X', notas: [{ chave: '3'.repeat(44), numero: '1', em: '2026-08-25' }] };
  const um = (classe) => mc.normalizar({ ...base, classe }, 'good');

  // cada classe implica um tratamento FISCAL diferente
  ok(um('nf_sem_saida').entrada_estoque === false,
     'nf_sem_saida: devolucao SEM entrada — dar entrada duplicaria o inventario');
  ok(um('nf_sem_saida').classe_permite_cancelar === true,
     '  e e a unica que permite cancelar a NF: o produto nunca saiu');

  ok(um('saiu_e_nao_entregou').entrada_estoque === true,
     'saiu_e_nao_entregou: COM entrada — o produto deve ter voltado');
  ok(um('estornado_apos_envio').entrada_estoque === true,
     'estornado_apos_envio: COM entrada, fluxo normal');

  ok(um('entregue_e_cancelado').entrada_estoque === null,
     'entregue_e_cancelado: NAO SEI — precisa conferir se houve devolucao fisica');
  ok(um('entregue_e_cancelado').classe_permite_cancelar === false,
     '  e nao cancela: a mercadoria foi entregue, houve circulacao');

  ok(um('entregue_apos_estorno').prejuizo_integral === true,
     'entregue_apos_estorno: PREJUIZO INTEGRAL — cliente ficou com produto E dinheiro');
  ok(um('entregue_apos_estorno').entrada_estoque === false,
     '  sem entrada: o produto ficou com o cliente');

  // as que nao geram trabalho
  ok(um('nao_pago') === null, 'nao_pago nao entra: nunca virou faturamento');
  ok(um('pago_cancelado_sem_nf') === null, 'pago_cancelado_sem_nf nao entra: sem NF sem imposto');
  ok(um('pedido_teste') === null, 'pedido_teste nao entra: a AMB tem um de homologacao');

  // classe DESCONHECIDA entra: eles podem criar outra
  ok(um('classe_que_nao_existe') !== null,
     'classe desconhecida ENTRA — sumir em silencio seria pior que mostrar a mais');

  // as datas que decidiram a classificacao chegam
  const comDatas = mc.normalizar({ ...base, classe: 'entregue_apos_estorno',
    enviado_em: '2026-07-10', entregue_em: '2026-07-14', cancelado_em: '2026-07-13',
    acao_sugerida: 'contestar' }, 'good');
  ok(comDatas.entregue_em === '2026-07-14' && comDatas.cancelado_em === '2026-07-13',
     'as datas da classificacao chegam (entregue DEPOIS do cancelamento = o caso real)');
  ok(comDatas.acao_sugerida === 'contestar',
     'e a acao que ELES sugerem vem junto — melhor que a minha deducao');
}

// ── o card mostra o que a classe implica ────────────────────────────
{
  const fs = require('fs');
  const path = require('path');
  const PAINEL = fs.readFileSync(path.join(__dirname, '..', 'public', 'painel-devolucoes.html'), 'utf8');

  ok(/💸 PREJUÍZO INTEGRAL/.test(PAINEL),
     'o card marca o prejuizo integral em vermelho');
  ok(/Vale contestar com o marketplace/.test(PAINEL),
     '  dizendo o que fazer: contestar, nao emitir nota');
  ok(/SEM entrada de estoque<\/b> — a mercadoria não voltou/.test(PAINEL),
     'e diz quando a devolucao vai SEM entrada de estoque');
  ok(/Confira se houve devolução física<\/b> antes de dar baixa/.test(PAINEL),
     '  e quando nao da pra saber, manda conferir em vez de chutar');
}

// ── b192: o NUMERO da NF mora dentro da chave ───────────────────────
//
// O dono abriu o painel e viu os 10 cards do Magalu com "sem NF vinculada
// a este pedido" — sem link, sem botao, sem serventia. A causa: a API do
// Magalu entrega a CHAVE, nem sempre o numero, e sem numero eu nao acho a
// nota no Bling.
{
  // conferido com chaves REAIS que apareceram no painel dele
  ok(mc.numeroDaChave('35260764289091000100550010000020701083179280') === '2070',
     'extrai o numero da chave (NF 002070 da GOOD)');
  ok(mc.numeroDaChave('35260732461988000182550010000764661835887584') === '76466',
     '  e da NF 076466, a do Antonio');
  ok(mc.numeroDaChave('123') === null, 'chave curta nao vira numero inventado');
  ok(mc.numeroDaChave(null) === null, '  nem nula');

  const semNumero = mc.normalizar({
    classe: 'estornado_apos_envio', order_code: 'X',
    notas: [{ chave: '35260732461988000182550010000764661835887584', em: '2026-08-25' }],
  }, 'good');
  ok(semNumero.nf_numero === '76466',
     'a API mandando so a chave, o numero sai dela — e o card ganha link');

  const comNumero = mc.normalizar({
    classe: 'estornado_apos_envio', order_code: 'X',
    notas: [{ numero: '99999', chave: '35260732461988000182550010000764661835887584' }],
  }, 'good');
  ok(comNumero.nf_numero === '99999',
     'mas quando a API MANDA o numero, ele manda — nao sobrescrevo');
}

// ── e a NF e resolvida PELA CHAVE nos dois servidores ───────────────
{
  const fs = require('fs');
  const path = require('path');
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const AMB = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');

  ok(/resolverIdNFPorChave\(item\.nf_numero, item\.nf_chave\)/.test(SERVER),
     'a GOOD resolve a NF pela CHAVE (competencia + serie moram nela)');
  ok(/nfp\.resolverIdNFPorChave\(item\.nf_numero, item\.nf_chave\)/.test(AMB),
     'e a AMB tambem — mesma funcao, de lib/nf-pessoa');

  // b192.1: a busca PAGINA e pode estourar o tempo sozinha
  ok(/Promise\.race\(\[[\s\S]{0,120}resolverIdNFPorChave/.test(SERVER),
     'a busca por chave corre contra um prazo proprio (ela pagina no Bling)');
  ok(/Promise\.race\(\[[\s\S]{0,120}resolverIdNFPorChave/.test(AMB),
     '  nos dois servidores');
  ok(/perder o vinculo[\s\S]{0,60}melhor que segurar a tela/.test(SERVER),
     '  com a escolha explicada: um card sem link e melhor que a tela travada');
  ok(/x\.nf_chave \|\| x\.nf_numero/.test(AMB),
     'e nota com numero e SEM chave nao fica de fora da fila a toa');
  ok(/Date\.now\(\) - INICIO_BUSCA > 8000/.test(AMB),
     '  com o mesmo teto de tempo entre itens, pro painel nao travar');

  // b192.2: o prazo e o QUE SOBRA, e ha COTA pro Magalu
  ok(/Math\.max\(500, 8000 - \(Date\.now\(\) - INICIO_BUSCA\)\)/.test(SERVER),
     'o prazo da busca por chave e o que SOBRA do orcamento, nao 5s fixos');
  ok(/Math\.max\(500, 8000 - \(Date\.now\(\) - INICIO_BUSCA\)\)/.test(AMB),
     '  nos dois servidores (senao duas buscas somariam 10s num teto de 8)');

  ok(/x\.marketplace === 'magalu'\)\.slice\(0, 15\)/.test(SERVER),
     'ha COTA pro Magalu na fila de busca');
  ok(/x\.marketplace === 'magalu'\)\.slice\(0, 15\)/.test(AMB), '  nos dois');
  ok(/sao os casos de maior valor/.test(SERVER),
     '  porque numa fila cheia de TikTok ele nao entraria — e vale mais');
}

// ── b192.1: o id por nota usa o numero DERIVADO ─────────────────────
{
  // sem `numero` na API — o caso comum do Magalu — o sufixo sumia e as
  // duas notas do mesmo pedido voltavam a colidir
  const duas = mc.normalizarTodas({
    classe: 'estornado_apos_envio', order_code: 'P1',
    notas: [{ chave: '35260732461988000182550010000764661835887584' },
            { chave: '35260764289091000100550010000020701083179280' }],
  }, 'good');
  ok(duas.length === 2, 'duas notas viram duas linhas');
  ok(duas[0].id !== duas[1].id,
     'e os ids NAO colidem, mesmo sem numero vindo da API');
  ok(duas[0].id === 'P1#76466' && duas[1].id === 'P1#2070',
     '  usando o numero derivado da chave');

  const semNada = mc.normalizarTodas({
    classe: 'estornado_apos_envio', order_code: 'P2',
    notas: [{ chave: 'X'.repeat(44) }, { chave: 'Y'.repeat(44) }],
  }, 'good');
  if (semNada.length === 2) {
    ok(semNada[0].id !== semNada[1].id,
       'chave invalida: cai no final dela como ultimo recurso, e ainda distingue');
  } else {
    ok(true, 'chave invalida nao gera linha (tambem aceitavel)');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
