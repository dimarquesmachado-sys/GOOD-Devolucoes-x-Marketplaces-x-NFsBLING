'use strict';
// b796 (V-13) — A LISTA DAS VENDAS NAO ENTREGUES DO MERCADO LIVRE, pro cartao "pacote MELI" (lib/pacote-meli-nao-entregues.js).
//
// O caso (AMB, 21/11): a caixa de venda NAO ENTREGUE volta com etiqueta sem cliente; o codigo de barras nao acha a venda
// e a API do ML nao liga um numero ao outro (medido pela sonda em producao). O que acha e o "Ref. ID" impresso = o
// `shipping.id` da venda. A sonda mediu de onde sai a lista: `/orders/search?…&shipping.status=not_delivered` (36 de
// 6180 na AMB; a TAG `not_delivered` trouxe 254 vendas pagas, a caminho — nao serve).
//
// Roda as funcoes de PRODUCAO com um ML de mentira que responde no formato medido (ids como NUMERO, `paging`, o eco
// `query` no envelope) e um banco de mentira no formato do Supabase. A rota de verdade, registrada no server.js das 3
// empresas, esta em test/pacote-meli-lista-navegador.test.js (Chromium) e na secao 6 daqui (subida real).
// Roda com: node test/pacote-meli-nao-entregues.test.js
const { listarNaoEntregues, linhaDaVenda, marcarTriadas, criarRotaNaoEntregues } = require('../lib/pacote-meli-nao-entregues');
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const CONTA = '3148025116';
// a venda do caso real (o que a sonda trouxe do pedido 2000018696282248 e do envio 48126024340), no formato da busca
const VENDA_REAL = {
  id: 2000018696282248, status: 'cancelled', tags: ['b2b', 'order_has_discount', 'catalog', 'not_delivered', 'not_paid'], pack_id: null,
  date_created: '2026-09-29T07:17:55.000-04:00', shipping: { id: 48126024340 },
  buyer: { id: 99887766, nickname: 'COMPRADOR_SECRETO', first_name: 'Fulano', last_name: 'de Tal' },
  order_items: [{ item: { id: 'MLB7620476266', title: '2 Cavaletes 6t 6000kg 13 Níveis Apoios Suportes Oficina Auto', seller_sku: 'CAV6T' }, quantity: 1, unit_price: 219.9 }],
};
const venda = (n, extra) => Object.assign({
  id: 2000019000000000 + n, status: 'cancelled', tags: ['not_delivered', 'not_paid'], pack_id: null,
  date_created: '2026-10-' + String(1 + (n % 28)).padStart(2, '0') + 'T10:00:00.000-04:00', shipping: { id: 48200000000 + n },
  order_items: [{ item: { id: 'MLB' + n, title: 'Produto ' + n, seller_sku: 'SKU' + n }, quantity: 1 }],
}, extra || {});

/** ML de mentira: responde a busca de vendas paginando `vendas`; anota cada caminho pedido */
function mlFalso(vendas, { falhaNaPagina = null, statusDaFalha = 429, semResultados = false, contaPeloUsersMe = null, atrasoMs = 0 } = {}) {
  const pedidos = [];
  const get = async (caminho) => {
    pedidos.push(caminho);
    if (atrasoMs) await new Promise((r) => setTimeout(r, atrasoMs));
    if (caminho === '/users/me') return contaPeloUsersMe ? { ok: true, status: 200, data: { id: Number(contaPeloUsersMe) } } : { ok: false, status: 401, error: 'unauthorized' };
    const u = new URL('https://x' + caminho);
    const limite = Number(u.searchParams.get('limit')); const offset = Number(u.searchParams.get('offset'));
    const pag = offset / limite;
    if (falhaNaPagina === pag) return { ok: false, status: statusDaFalha, error: { message: 'too many requests' } };
    if (semResultados) return { ok: true, status: 200, data: { query: '', paging: { total: 0 } } };
    return { ok: true, status: 200, data: { query: '', sort: { id: 'date_desc' }, paging: { total: vendas.length, offset, limit: limite }, results: vendas.slice(offset, offset + limite) } };
  };
  return { get, pedidos };
}
/** banco de mentira, no formato do Supabase; `semColuna` devolve erro pra coluna que a tabela nao tem (a GOOD nao tem `tracking`) */
function sbFalso(triagens, { semColuna = null, erro = false } = {}) {
  const consultas = [];
  return { consultas, from: () => ({ select: () => ({ in: async (col, vals) => {
    consultas.push(col);
    if (erro) return { data: null, error: { message: 'timeout' } };
    if (col === semColuna) return { data: null, error: { message: 'column devolucoes.' + col + ' does not exist' } };
    return { data: triagens.filter((r) => r[col] != null && vals.includes(String(r[col]))), error: null };
  } }) }) };
}
function resFalso() {
  const r = { status: null, corpo: null, headersSent: false };
  r.res = { headersSent: false, status(s) { r.status = s; return this; }, json(c) { r.corpo = c; r.headersSent = true; this.headersSent = true; return this; } };
  return r;
}

(async () => {
  console.log('── 1. uma venda da busca → a linha da lista');
  {
    const l = linhaDaVenda(VENDA_REAL);
    ok(l && l.ref_id === '48126024340' && l.pedidos.join() === '2000018696282248' && l.data === '2026-09-29',
      '⚠️ o caso real: o Ref. ID da etiqueta e o `shipping.id` da venda (48126024340), com o pedido e o dia da venda — ' + JSON.stringify(l && { ref_id: l.ref_id, pedidos: l.pedidos, data: l.data }));
    ok(l && l.produtos.length === 1 && /2 Cavaletes 6t/.test(l.produtos[0].titulo) && l.produtos[0].sku === 'CAV6T' && l.produtos[0].qtd === 1, '  com o produto (titulo, SKU, quantidade) — e ele que bate com a caixa');
    ok(!/COMPRADOR_SECRETO|Fulano|99887766/.test(JSON.stringify(l)), '⚠️ nada do comprador sai na linha (a etiqueta do pacote MELI nem traz cliente)');
    ok(linhaDaVenda(Object.assign({}, VENDA_REAL, { shipping: {} })) === null && linhaDaVenda(Object.assign({}, VENDA_REAL, { shipping: null })) === null,
      '  venda sem numero de envio nao tem Ref. ID: nao vira linha');
    for (const [nome, ruim] of [['objeto', { a: 1 }], ['lista', [48126024340]], ['texto com letra', '4812602434O'], ['curto', 4812], ['numero quebrado', 4.8e30]]) {
      ok(linhaDaVenda(Object.assign({}, VENDA_REAL, { shipping: { id: ruim } })) === null, '  `shipping.id` que nao e um numero de envio (' + nome + ') nao vira Ref. ID');
    }
    const semItens = linhaDaVenda(Object.assign({}, VENDA_REAL, { order_items: undefined }));
    ok(semItens && semItens.produtos.length === 0, '  venda sem `order_items` na resposta: a linha sai (Ref. ID, pedido, data) com a lista de produtos vazia — a tela diz que o produto nao veio');
    const comprido = linhaDaVenda(Object.assign({}, VENDA_REAL, { order_items: [{ item: { title: 'T'.repeat(500) + '\n  fim', seller_custom_field: 'ANTIGO' }, quantity: 0 }] }));
    ok(comprido.produtos[0].titulo.length === 140 && comprido.produtos[0].sku === 'ANTIGO' && comprido.produtos[0].qtd === 1, '  titulo cortado em 140, SKU do campo antigo quando o novo nao vem, quantidade invalida vira 1');
    ok(linhaDaVenda(Object.assign({}, VENDA_REAL, { pack_id: 2000015000000001 })).pack_id === '2000015000000001' && linhaDaVenda(Object.assign({}, VENDA_REAL, { date_created: 'ontem' })).data === null,
      '  pack do carrinho vai junto (texto); data que nao e data sai vazia');
  }

  console.log('\n── 2. a busca no ML');
  {
    const real = [VENDA_REAL].concat(Array.from({ length: 35 }, (_, i) => venda(i + 1)));
    const m = mlFalso(real);
    const r = await listarNaoEntregues({ get: m.get, vendedor: () => 3148025116 });
    ok(r.ok && r.itens.length === 36 && r.total_no_ml === 36 && r.cortada === false, '⚠️ o tamanho medido na AMB (36 vendas): uma pagina, a lista inteira, nada cortado');
    ok(m.pedidos.length === 1 && m.pedidos[0] === '/orders/search?seller=' + CONTA + '&shipping.status=not_delivered&sort=date_desc&limit=50&offset=0',
      '⚠️ a consulta e pelo STATUS DO ENVIO (`shipping.status=not_delivered`), mais recentes primeiro — ' + m.pedidos[0]);
    ok(!/tags=/.test(m.pedidos.join()), '⚠️ e NAO pela tag `not_delivered` (medido: a tag traz 254 vendas pagas, a caminho)');
    ok(r.itens[0].ref_id === '48126024340' && r.itens[1].ref_id === '48200000001', '  na ordem que o ML mandou');

    const m3 = mlFalso(Array.from({ length: 120 }, (_, i) => venda(i + 1)));
    const r3 = await listarNaoEntregues({ get: m3.get, vendedor: () => CONTA });
    ok(r3.ok && r3.itens.length === 120 && r3.cortada === false && m3.pedidos.map((c) => new URL('https://x' + c).searchParams.get('offset')).join() === '0,50,100',
      '⚠️ 120 vendas: tres paginas (offset 0, 50, 100), todas na lista');
    const m4 = mlFalso(Array.from({ length: 100 }, (_, i) => venda(i + 1)));
    const r4 = await listarNaoEntregues({ get: m4.get, vendedor: () => CONTA });
    ok(r4.ok && r4.itens.length === 100 && m4.pedidos.length === 2 && r4.cortada === false, '  100 vendas (duas paginas cheias): para em duas — nao pede uma terceira vazia');

    const m5 = mlFalso(Array.from({ length: 500 }, (_, i) => venda(i + 1)));
    const r5 = await listarNaoEntregues({ get: m5.get, vendedor: () => CONTA });
    ok(r5.ok && r5.itens.length === 200 && m5.pedidos.length === 4 && r5.cortada === true && r5.total_no_ml === 500,
      '⚠️ 500 vendas: quatro paginas (as 200 mais recentes) e `cortada` — a lista DIZ que nao e tudo, com o total do ML');

    const carrinho = [venda(1, { pack_id: 2000015000000001 }), venda(2, { pack_id: 2000015000000001, shipping: { id: 48200000001 } }), venda(3)];
    const r6 = await listarNaoEntregues({ get: mlFalso(carrinho).get, vendedor: () => CONTA });
    ok(r6.ok && r6.itens.length === 2 && r6.itens[0].pedidos.length === 2 && r6.itens[0].produtos.map((p) => p.sku).join() === 'SKU1,SKU2' && r6.itens[0].pack_id === '2000015000000001',
      '⚠️ carrinho (duas vendas no MESMO envio): UMA linha, com os dois pedidos e os produtos das duas');

    // a lista do ML ANDA entre uma pagina e outra (entrou uma venda nova no topo): a ultima da pagina 1 volta como a primeira da 2
    const sessenta = Array.from({ length: 60 }, (_, i) => venda(i + 1));
    const anda = mlFalso(sessenta);
    const getQueAnda = async (c) => { const r = await anda.get(c); if (/offset=50/.test(c)) r.data.results = [sessenta[49]].concat(r.data.results); return r; };
    const ra = await listarNaoEntregues({ get: getQueAnda, vendedor: () => CONTA });
    const repetida = ra.itens.find((i) => i.ref_id === String(48200000000 + 50));
    ok(ra.ok && ra.itens.length === 60 && repetida.pedidos.length === 1 && repetida.produtos.length === 1,
      '⚠️ a mesma venda veio em DUAS paginas (a lista do ML andou no meio): uma linha so, com o produto UMA vez — ' + JSON.stringify(repetida && { pedidos: repetida.pedidos.length, produtos: repetida.produtos.length }));

    const r7 = await listarNaoEntregues({ get: mlFalso([venda(1), venda(2, { shipping: null }), venda(3)]).get, vendedor: () => CONTA });
    ok(r7.ok && r7.itens.length === 2 && r7.sem_envio === 1, '  venda sem envio fica fora e e contada (`sem_envio`)');
  }

  console.log('\n── 3. o ML falhou: a lista NAO sai pela metade nem vazia');
  {
    const muitas = Array.from({ length: 120 }, (_, i) => venda(i + 1));
    const r = await listarNaoEntregues({ get: mlFalso(muitas, { falhaNaPagina: 1 }).get, vendedor: () => CONTA });
    ok(r.ok === false && r.status === 502 && /HTTP 429/.test(r.erro) && !('itens' in r), '⚠️ a SEGUNDA pagina falhou (429): falha da lista inteira, com o motivo — nao devolve as 50 primeiras como se fosse tudo — ' + r.erro);
    const r0 = await listarNaoEntregues({ get: mlFalso(muitas, { falhaNaPagina: 0, statusDaFalha: 403 }).get, vendedor: () => CONTA });
    ok(r0.ok === false && /HTTP 403/.test(r0.erro), '  primeira pagina recusada (403): falha, com o status');
    const rs = await listarNaoEntregues({ get: async () => null, vendedor: () => CONTA });
    ok(rs.ok === false && /não respondeu/.test(rs.erro), '  o cliente nao devolveu nada: falha ("nao respondeu"), sem estourar');
    const rf = await listarNaoEntregues({ get: mlFalso([], { semResultados: true }).get, vendedor: () => CONTA });
    ok(rf.ok === false && /formato/.test(rf.erro), '⚠️ resposta 200 SEM a lista de resultados nao e "nenhuma venda": e formato desconhecido (falha)');
    const vazia = await listarNaoEntregues({ get: mlFalso([]).get, vendedor: () => CONTA });
    ok(vazia.ok === true && vazia.itens.length === 0 && vazia.total_no_ml === 0, '  ja a lista vazia DE VERDADE (200, resultados = []) e sucesso com zero linhas');

    // a conta
    const m1 = mlFalso([venda(1)], { contaPeloUsersMe: CONTA });
    const c1 = await listarNaoEntregues({ get: m1.get, vendedor: () => null });
    ok(c1.ok && m1.pedidos[0] === '/users/me' && /seller=3148025116&/.test(m1.pedidos[1]), '  o cliente nao sabe a conta: pergunta ao ML (/users/me) e segue');
    const c2 = await listarNaoEntregues({ get: mlFalso([venda(1)]).get, vendedor: () => { throw new Error('x'); } });
    ok(c2.ok === false && /conta do Mercado Livre/.test(c2.erro), '  nem o ML diz a conta: falha clara (nao busca com `seller=null`)');
    const c3 = await listarNaoEntregues({ get: mlFalso([venda(1)]).get, vendedor: () => 'abc; drop' });
    ok(c3.ok === false, '  conta que nao e numero nao entra no endereco da consulta');

    // o teto de tempo
    let relogio = 0;
    const lento = mlFalso(Array.from({ length: 500 }, (_, i) => venda(i + 1)));
    const getLento = async (c) => { relogio += 15000; return lento.get(c); };
    const rt = await listarNaoEntregues({ get: getLento, vendedor: () => CONTA, agora: () => relogio });
    ok(rt.ok && rt.cortada === true && lento.pedidos.length === 2 && rt.itens.length === 100, '⚠️ ML lento (15 s por pagina): para no teto de tempo com o que ja tem e avisa (`cortada`) — o pedido nao fica pendurado');
  }

  console.log('\n── 4. quais ja foram triadas');
  {
    const itens = (await listarNaoEntregues({ get: mlFalso([VENDA_REAL, venda(1), venda(2), venda(3, { pack_id: 2000015000000009 }), venda(4)]).get, vendedor: () => CONTA })).itens;
    const TRIAGENS = [
      { shipment_id: '48126024340', order_id: null, pack_id: null, problema_descricao: null },                 // triada pelo envio (o Ref. ID)
      { shipment_id: 'OUTRO', order_id: String(2000019000000001), pack_id: null, problema_descricao: null },   // triada pelo pedido
      { shipment_id: 'X', order_id: null, pack_id: '2000015000000009', problema_descricao: null },             // triada pelo pack do carrinho
      { shipment_id: null, order_id: String(2000019000000004), pack_id: null, problema_descricao: 'estornada [caso:#12] sem retorno' },   // registro de caso: nao e bipe
    ];
    const sb = sbFalso(TRIAGENS);
    const m = await marcarTriadas(itens, { sb, tabela: 'devolucoes_amb' });
    const marca = (ref) => (m.itens.find((i) => i.ref_id === ref) || {}).ja_triado;
    ok(m.conferida === true && marca('48126024340') === true, '⚠️ venda ja triada pelo ENVIO (o Ref. ID) sai marcada');
    ok(marca('48200000001') === true, '⚠️ triada pelo PEDIDO (gravada por outro numero de envio): marcada');
    ok(marca('48200000003') === true, '  triada pelo PACK do carrinho: marcada');
    ok(marca('48200000002') === false, '  a que ninguem triou continua esperando');
    ok(marca('48200000004') === false, '  registro de "caso" (estornada sem retorno) nao e bipe da caixa: nao marca');
    ok(sb.consultas.join() === 'order_id,pack_id,shipment_id,tracking', '  fabrica (AMB/Girassol): cruza pedido, pack e as duas colunas de envio — ' + sb.consultas.join());
    ok(itens.every((i) => !('ja_triado' in i)), '  (a lista guardada na memoria nao e alterada pela marcacao)');

    // a GOOD nao tem a coluna `tracking`
    const sbGood = sbFalso(TRIAGENS, { semColuna: 'tracking' });
    const mg = await marcarTriadas(itens, { sb: sbGood, tabela: 'devolucoes', colunasDoEnvio: ['shipment_id'] });
    ok(mg.conferida === true && sbGood.consultas.join() === 'order_id,pack_id,shipment_id' && mg.itens.filter((i) => i.ja_triado).length === 3,
      '⚠️ GOOD (tabela sem a coluna `tracking`): so `shipment_id` e consultada, e a conferencia funciona');
    const mgSem = await marcarTriadas(itens, { sb: sbFalso(TRIAGENS, { semColuna: 'tracking' }), tabela: 'devolucoes' });
    ok(mgSem.conferida === false && mgSem.itens.every((i) => i.ja_triado === false), '  (sem a opcao, a coluna que nao existe derruba a consulta: nada e escondido e `conferida` diz que nao conferiu)');

    const mf = await marcarTriadas(itens, { sb: sbFalso(TRIAGENS, { erro: true }), tabela: 'devolucoes_amb' });
    ok(mf.conferida === false && mf.itens.length === itens.length && mf.itens.every((i) => i.ja_triado === false), '⚠️ a consulta ao banco falhou: a lista vai INTEIRA, sem marcar ninguem, e avisa que nao conferiu');
    const ms = await marcarTriadas(itens, { sb: null, tabela: null });
    ok(ms.conferida === false && ms.itens.length === itens.length, '  sem banco: idem');
    const mx = await marcarTriadas(itens, { sb, tabela: 't', triadas: async () => { throw new Error('caiu'); } });
    ok(mx.conferida === false && mx.itens.length === itens.length, '  a conferencia estourou: idem (nao derruba a rota)');
  }

  console.log('\n── 5. a rota');
  {
    let relogio = 1000000;
    const agora = () => relogio;
    const vendas = [VENDA_REAL, venda(1), venda(2)];
    const triagens = [];
    let buscas = 0; let soltar = null; let modo = 'ok';
    const ml = {
      userId: () => CONTA,
      chamarML: async (caminho, opcoes) => {
        buscas++;
        ml.ultimasOpcoes = opcoes;
        if (modo === 'preso') await new Promise((r) => { soltar = r; });
        if (modo === 'falha') return { ok: false, status: 429, error: { message: 'limite', access_token: 'APP_USR-nao-pode-sair' } };
        if (modo === 'estoura') throw new Error('socket hang up em https://api.mercadolibre.com/orders/search?access_token=APP_USR-nao-pode-sair');
        return mlFalso(vendas).get(caminho);
      },
    };
    const rota = criarRotaNaoEntregues({ obterMl: () => ml, obterBanco: () => ({ sb: sbFalso(triagens), tabela: 'devolucoes_amb' }), agora });
    const pedir = async (r = rota) => { const x = resFalso(); await r({ query: {} }, x.res); return x; };

    const a = await pedir();
    ok(a.status === 200 && a.corpo.ok === true && a.corpo.itens.length === 3 && a.corpo.total_no_ml === 3 && a.corpo.cortada === false && a.corpo.triagem_conferida === true && a.corpo.idade_s === 0,
      '⚠️ responde a lista com o total do ML, se foi cortada, se as triagens foram conferidas e a idade — ' + JSON.stringify(Object.assign({}, a.corpo, { itens: a.corpo.itens.length })));
    ok(a.corpo.itens[0].ref_id === '48126024340' && a.corpo.itens[0].ja_triado === false && Array.isArray(a.corpo.itens[0].produtos), '  cada linha: Ref. ID, pedidos, pack, data, produtos e `ja_triado`');
    ok(ml.ultimasOpcoes && ml.ultimasOpcoes.timeout === 10000, '  cada consulta ao ML tem prazo de 10 s (o padrao do cliente e 30)');

    relogio += 60000;
    const b = await pedir();
    ok(buscas === 1 && b.corpo.idade_s === 60, '⚠️ um minuto depois: a lista sai da MEMORIA (o ML nao e consultado de novo) e diz a idade');
    triagens.push({ shipment_id: '48126024340', order_id: null, pack_id: null, problema_descricao: null });
    const c = await pedir();
    ok(buscas === 1 && c.corpo.itens.find((i) => i.ref_id === '48126024340').ja_triado === true,
      '⚠️ a venda que ACABOU de ser triada ja sai marcada — as triagens sao conferidas a cada pedido, sem esperar a memoria do ML vencer');
    relogio += 5 * 60000;
    await pedir();
    ok(buscas === 2, '  passados os 5 minutos, a lista e buscada de novo');

    // tres celulares abrindo o cartao juntos
    relogio += 6 * 60000; modo = 'preso';
    const tres = [pedir(), pedir(), pedir()];
    await new Promise((r) => setTimeout(r, 20));
    ok(buscas === 3, '⚠️ tres pedidos ao mesmo tempo, com a memoria vencida: UMA consulta ao ML (os outros esperam a mesma)');
    modo = 'ok'; soltar();
    const rs = await Promise.all(tres);
    ok(rs.every((x) => x.status === 200 && x.corpo.itens.length === 3) && buscas === 3, '  e os tres recebem a lista');

    // falha
    relogio += 6 * 60000; modo = 'falha';
    const f = await pedir();
    ok(f.status === 502 && f.corpo.ok === false && /HTTP 429/.test(f.corpo.erro) && !('itens' in f.corpo),
      '⚠️ o ML falhou (429) com a memoria vencida: 502 com o motivo — NAO devolve lista vazia como se nao houvesse venda — ' + f.corpo.erro);
    ok(!/APP_USR|access_token/.test(JSON.stringify(f.corpo)), '⚠️ o corpo do erro do ML nao vai pra resposta');
    const antes = buscas;
    relogio += 5000;
    const f2 = await pedir();
    ok(f2.status === 502 && buscas === antes, '⚠️ 5 s depois da falha: a mesma falha, SEM consultar o ML de novo (recarregar a tela com o ML fora nao vira rajada)');
    relogio += 20000; modo = 'ok';
    const g = await pedir();
    ok(g.status === 200 && buscas === antes + 1, '  passados os 20 s, tenta de novo — e a lista volta');

    relogio += 6 * 60000; modo = 'estoura';
    const e = await pedir();
    ok(e.status === 502 && e.corpo.ok === false && !/APP_USR|access_token|api\.mercadolibre/.test(JSON.stringify(e.corpo)),
      '⚠️ o cliente do ML ESTOUROU (mensagem com endereco e token): 502 curto, sem repassar a mensagem — ' + e.corpo.erro);
    modo = 'ok';

    // sem ML / sem banco
    const semMl = await pedir(criarRotaNaoEntregues({ obterMl: () => null, obterBanco: () => ({}), agora }));
    ok(semMl.status === 503 && semMl.corpo.ok === false && /Mercado Livre/.test(semMl.corpo.erro), '  empresa sem o ML ligado: 503 com o motivo');
    const mlQuebra = await pedir(criarRotaNaoEntregues({ obterMl: () => { throw new Error('ainda nao subiu'); }, obterBanco: () => ({}), agora }));
    ok(mlQuebra.status === 503, '  `obterMl` estourou: 503 (nao derruba)');
    const semBanco = await pedir(criarRotaNaoEntregues({ obterMl: () => ml, obterBanco: () => { throw new Error('sem banco'); }, agora }));
    ok(semBanco.status === 200 && semBanco.corpo.itens.length === 3 && semBanco.corpo.triagem_conferida === false,
      '⚠️ banco fora: a lista do ML sai inteira, com `triagem_conferida: false` (a tela avisa que pode trazer venda ja triada)');
    // a resposta estourou depois de comecar: nao tenta responder de novo
    const quebrada = { headersSent: false, status() { return this; }, json() { this.headersSent = true; throw new Error('conexao caiu'); } };
    let estourou = false;
    try { await rota({ query: {} }, quebrada); } catch (err) { estourou = true; }
    ok(!estourou, '  a conexao caiu no meio da resposta: o handler nao rejeita (rejeicao sem dono derruba o processo)');
  }

  console.log('\n── 6. a rota no server.js de verdade, nas 3 empresas');
  {
    const EMPRESAS = [{ nome: 'GOOD', pre: '', cookie: 'sessao=' }, { nome: 'AMB', pre: '/amb', prefixo: 'AMB_' }, { nome: 'Girassol', pre: '/girassol', prefixo: 'GIRASSOL_' }];
    const env = {
      USERS: 'esto:s1:Esto,dono:s2:Dono', ADMIN_USER: 'dono', GOOD_USERS: 'esto:s1:Esto,dono:s2:Dono', GOOD_ADMIN_USER: 'dono',
      SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789', ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!',
    };
    for (const e of EMPRESAS.slice(1)) { env[e.prefixo + 'USERS'] = 'esto:s1,dono:s2'; env[e.prefixo + 'ADMIN_USER'] = 'dono'; env[e.prefixo + 'SESSION_SECRET'] = 'segredo-da-' + e.nome.toLowerCase() + '-so-pra-teste-0123456789'; }
    const s = await subir({ env, tetoMs: 45000 });
    try {
      ok(s.subiu, '⚠️ o server.js subiu' + (!s.subiu ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
      if (s.subiu) {
        for (const e of EMPRESAS) {
          const caminho = e.pre + '/api/pacote-meli/nao-entregues';
          const sem = await s.pedir(caminho);
          ok(sem.status === 401, '⚠️ ' + e.nome + ': sem login, 401 (a lista e so pra quem esta logado) — veio ' + sem.status);
          const login = await s.pedir(e.pre + '/api/auth/login', { metodo: 'POST', corpo: { usuario: 'esto', senha: 's1' } });
          const cookie = (login.headers['set-cookie'] || []).map((x) => x.split(';')[0]).join('; ');
          const com = await s.pedir(caminho, { cookie, timeoutMs: 30000 });
          let corpo = null; try { corpo = JSON.parse(com.corpo); } catch (err) { corpo = null; }
          // aqui nao ha conta do ML: o que se prova e que a rota EXISTE pra esta empresa, responde JSON e diz que falhou
          ok(cookie && corpo && typeof corpo.ok === 'boolean' && (corpo.ok ? Array.isArray(corpo.itens) : (typeof corpo.erro === 'string' && [502, 503].includes(com.status))),
            '⚠️ ' + e.nome + ': com login de estoquista, a rota responde no formato combinado (sem o ML ligado: falha dita, nao lista vazia) — HTTP ' + com.status + ' ' + String(com.corpo).slice(0, 110));
          ok(!/\bat \w+.*\.js:\d+/.test(String(com.corpo)), '  ' + e.nome + ': sem pilha de erro na resposta');
        }
        const vivo = await s.pedir('/health');
        ok(vivo.status === 200, '  o processo continua de pe depois dos pedidos');
      }
    } finally { s.matar(); }
  }

  console.log(falhas === 0 ? '\n=== TODOS OS CASOS PASSARAM' : '\n=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
