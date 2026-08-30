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

  ok(/\.concat\(magaluItens\)/.test(SERVER), 'o Magalu entra na MESMA lista do TikTok');
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

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
