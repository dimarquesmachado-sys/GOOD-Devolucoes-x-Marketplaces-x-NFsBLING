'use strict';
// b786 — SONDA DA ETIQUETA DE VOLTA DO ML (lib/sonda-etiqueta-volta.js).
//
// O caso (AMB, 21/11): a caixa de uma venda NAO ENTREGUE volta com etiqueta sem cliente; o codigo de barras/QR e o envio
// DE VOLTA (o ML responde 404) e o "Ref. ID" impresso e o envio ORIGINAL. O dono: "tem certeza que nao deixa consultar?
// investiga a fundo". A sonda mede, numa chamada, o que o ML expoe sobre os dois numeros e ONDE um aponta o outro.
//
// Este teste executa a peca de PRODUCAO:
//   1. `sondarEtiquetaDeVolta` com um ML falso — a leitura mecanica (onde o numero aparece, filtro ignorado x
//      respeitado, "nao sei" x "nao existe"), a validacao da entrada (isto vira caminho de URL), e que NENHUM dado
//      pessoal do comprador sai no relatorio;
//   2. a ROTA (`criarRotaDaSonda`) passando pelo CLIENTE DE PRODUCAO do ML (lib-AMB/ml-AMB.js) com a rede simulada —
//      o contrato produtor→consumidor (caminho + header do formato novo) e os limites (memoria, uma por vez, intervalo);
//   3. HTTP no server.js de verdade, nas 3 empresas: sem sessao e estoquista nao entram; admin com numero invalido
//      recebe 400 da propria sonda (prova que a rota esta ligada) — sem nenhuma chamada ao ML de verdade.
//
// b787 — REVISAO DO CODEX (#637), 4 apontamentos, cada um com o teste que falhava antes:
//   P1  `?barras[toString]=x` DERRUBAVA o processo (o Express entrega um objeto; o String() dele estoura fora do try de
//       um handler async) — provado no server.js de verdade: responde 400 e o servidor continua de pe;
//   P2  401/403 nao provam ausencia: a leitura diz "NAO SEI" e a consulta entra na lista das sem conclusao;
//   P2  total IGUAL ao da busca sem filtro nao prova "filtro ignorado" (todas as vendas podem casar): INCONCLUSIVO, e
//       "IGNORADO" so com prova (resultado devolvido que nao casa com o filtro);
//   P2  reclamacao achada pela BUSCA (e nao pelo pedido) tambem tem a devolucao consultada.
// Roda com: node test/sonda-etiqueta-volta.test.js
const path = require('path');
const { sondarEtiquetaDeVolta, criarRotaDaSonda, ondeAparece, camposDeLigacao, soDigitos, desfecho } = require('../lib/sonda-etiqueta-volta');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const BARRAS = '48133297953', REF = '48126024340', PEDIDO = '2000018696282248', CONTA = '123456';
// dado pessoal de mentira: NADA disto pode aparecer no relatorio
const PESSOAL = ['Fulano de Tal', 'Rua Secreta 123', '11999990000', '01234000', 'DANDARO4X4', 'comprador@exemplo.com', 'COMPRADORZE', '12345678900',
  // Codex #637: campo com NOME de ligacao (reference, related...) DENTRO de um bloco pessoal, e texto livre em volta do numero
  'ao lado da farmacia', 'portao azul', 'vizinha Beltrana', 'Sicrano', 'recebido por', 'apto 42'];
const endereco = () => ({ address_line: 'Rua Secreta 123', street_name: 'Rua Secreta', street_number: '123', zip_code: '01234000', city: { name: 'Sao Paulo' }, receiver_name: 'Fulano de Tal', receiver_phone: '11999990000',
  reference: 'Casa de Fulano de Tal ao lado da farmacia', references: 'portao azul', apartment: 'apto 42', related_contacts: [{ parent_note: 'vizinha Beltrana recebe' }], return_instructions: 'entregar pra vizinha Beltrana' });

/** um ML de mentira. `opcoes` muda o cenario; devolve { get, chamadas, emVoo } */
function mlFalso(opcoes = {}) {
  const o = Object.assign({ ligacao: true, barrasResponde: false, medHostil: false, estoura: null,
    canceladas429: false,      // a busca de cancelados leva 429
    voltaHttp: null,           // HTTP de TODAS as consultas do envio de volta (ex.: 403)
    pedidoHttp: null,          // HTTP do /orders/{pedido} (ex.: 403)
    reclamacaoNaBusca: null,   // id(s) que a BUSCA de reclamacoes devolve (o pedido nao lista)
    semMediations: false,      // o pedido vem sem mediations
    originalSemPedido: false,  // o envio original (e os itens) nao trazem o numero da venda
    tagIgnorada: false,        // o ML ignora ?tags=: devolve o mesmo da busca sem filtro
    conta: 'grande',           // 'grande' (5000 vendas), 'uma' (so a venda do caso) ou 'vazia'
  }, opcoes);
  const chamadas = []; let emVoo = 0, maxEmVoo = 0;
  const nao = (status, corpo) => ({ ok: false, status, error: corpo || { message: 'erro ' + status, status } });
  const sim = (data) => ({ ok: true, status: 200, data });
  async function get(caminho, headers) {
    chamadas.push({ caminho, headers: headers || null });
    emVoo++; maxEmVoo = Math.max(maxEmVoo, emVoo);
    await new Promise((r) => setTimeout(r, 2));
    emVoo--;
    if (o.estoura && o.estoura.test(caminho)) throw new Error('socket hang up');
    const novo = !!(headers && headers['x-format-new']);
    if (caminho === '/users/me') return sim({ id: Number(CONTA), nickname: 'LOJA', email: 'comprador@exemplo.com' });
    // ── o envio de volta ──
    if (o.voltaHttp && (caminho === '/shipments/' + BARRAS || caminho.startsWith('/shipments/' + BARRAS + '/'))) {
      const st = typeof o.voltaHttp === 'function' ? o.voltaHttp(caminho, novo) : o.voltaHttp;
      if (st) return nao(st, { message: 'forbidden', status: st });
    }
    if (caminho === '/shipments/' + BARRAS) {
      if (!o.barrasResponde) return nao(404, { message: 'Shipment not found', error: 'not_found_shipping', status: 404, cause: [] });
      return novo ? sim({ id: Number(BARRAS), status: 'delivered', logistic: { direction: 'return', mode: 'me2', type: 'cross_docking' }, destination: { type: 'selling_address', receiver_name: 'Fulano de Tal', shipping_address: endereco() } })
        : sim({ id: Number(BARRAS), status: 'delivered', type: 'return', order_id: Number(PEDIDO), sibling: { sibling_id: Number(REF), reason: 'not_delivered' }, receiver_address: endereco() });
    }
    if (caminho.startsWith('/shipments/' + BARRAS + '/')) return nao(404, { message: 'Shipment not found', error: 'not_found_shipping', status: 404, receiver_name: 'Fulano de Tal', cause: [{ contact: 'Sicrano' }] });
    // ── o envio original ──
    if (caminho === '/shipments/' + REF) {
      if (novo) return sim({ id: Number(REF), status: 'not_delivered', substatus: 'returned', date_created: '2026-09-29T08:17:00Z', last_updated: '2026-10-01T10:00:00Z', tracking_number: 'MEL' + REF + 'FMXDF01',
        logistic: { direction: 'forward', mode: 'me2', type: 'cross_docking' }, tags: ['test'], external_reference: null,
        origin: { type: 'selling_address', sender_id: Number(CONTA), shipping_address: endereco() },
        destination: { type: 'buying_address', receiver_id: 999, receiver_name: 'Fulano de Tal', receiver_phone: '11999990000', comments: 'deixar com Fulano de Tal', shipping_address: endereco() } });
      return sim({ id: Number(REF), order_id: o.originalSemPedido ? null : Number(PEDIDO), status: 'not_delivered', substatus: 'returned', type: 'forward', mode: 'me2', logistic_type: 'cross_docking', tags: [],
        return_details: null,
        return_tracking_number: o.ligacao ? 'MEL' + BARRAS + 'FMXDR01' : null,
        sibling: o.ligacao ? { sibling_id: Number(BARRAS), reason: 'not_delivered', description: null, source: 'logistics', date_created: '2026-10-01T09:00:00Z', last_updated: null }
          : { sibling_id: null, reason: null, description: null, source: null, date_created: null, last_updated: null },
        status_history: { date_shipped: '2026-09-29T12:00:00Z', date_returned: '2026-10-01T10:00:00Z', date_not_delivered: '2026-09-30T18:00:00Z' },
        receiver_address: endereco(), sender_address: endereco(), receiver_id: 999 });
    }
    if (caminho === '/shipments/' + REF + '/history') return sim([{ status: 'shipped', substatus: null, date: '2026-09-29T12:00:00Z', tracking: { checkpoint: 'CP1', description: 'Objeto recebido por Sicrano na unidade' } },
      { status: 'not_delivered', substatus: 'returning_to_sender', date: '2026-09-30T18:00:00Z', tracking: { checkpoint: 'CP2', description: 'Destinatario ausente' } },
      { status: 'returned', date: '2026-10-01T10:00:00Z', note: o.ligacao ? 'pacote MEL' + BARRAS + 'FMXDR01 recebido por Sicrano' : 'pacote recebido por Sicrano' }]);
    if (caminho === '/shipments/' + REF + '/items') return sim(o.originalSemPedido ? [] : [{ order_id: Number(PEDIDO), item_id: 'MLB1', quantity: 1, description: '2 Cavaletes 6t' }]);
    if (caminho === '/orders/' + PEDIDO && o.pedidoHttp) return nao(o.pedidoHttp, { message: 'forbidden', status: o.pedidoHttp });
    if (caminho === '/orders/' + PEDIDO) return sim({ id: Number(PEDIDO), status: 'cancelled', status_detail: null, tags: ['not_delivered', 'cancelled'], pack_id: null, date_created: '2026-09-29T08:17:00Z',
      cancel_detail: { group: 'shipment', code: 'shipment_not_delivered', description: 'nao entregue', requested_by: 'ml' }, shipping: { id: Number(REF) },
      mediations: o.medHostil ? [{ id: '../../users/me' }, { id: '5001234567?x=1' }, { id: { toString: 'x' } }] : (o.semMediations ? [] : [{ id: 5001234567, status: 'closed' }]),
      buyer: { id: 999, nickname: 'DANDARO4X4', first_name: 'Fulano de Tal', email: 'comprador@exemplo.com', billing_info: { doc_number: '12345678900' } } });
    if (caminho === '/post-purchase/v1/claims/5001234567') return sim({ id: 5001234567, type: 'cancel_purchase', stage: 'claim', status: 'closed', resource: 'order', resource_id: Number(PEDIDO), players: [{ role: 'complainant', user_id: 999 }] });
    if (caminho === '/post-purchase/v2/claims/5001234567/returns') return o.ligacao
      ? sim({ id: 777, status: 'delivered', subtype: 'return_total', status_money: 'refunded', resource_type: 'order', resource_id: Number(PEDIDO), shipments: [{ shipment_id: Number(BARRAS), tracking_number: 'MEL' + BARRAS + 'FMXDR01', status: 'delivered', type: 'return', destination: { name: 'seller_address', shipping_address: endereco() } }] })
      : nao(404, { message: 'return not found' });
    // a devolucao de uma reclamacao que so a BUSCA mostra: e nela que mora a ligacao com o codigo de barras
    const mDev = caminho.match(/^\/post-purchase\/v2\/claims\/(\d+)\/returns$/);
    if (mDev && o.reclamacaoNaBusca && o.reclamacaoNaBusca.some((id) => (typeof id === 'number' || typeof id === 'string') && String(id) === mDev[1])) {
      return sim({ id: 778, status: 'delivered', subtype: 'return_total', resource_type: 'order', resource_id: Number(PEDIDO), shipments: [{ shipment_id: Number(BARRAS), status: 'delivered', type: 'return', destination: { name: 'seller_address', shipping_address: endereco() } }] });
    }
    if (caminho.startsWith('/post-purchase/v1/claims/search')) {
      const lista = (o.reclamacaoNaBusca && caminho.includes('status=closed')) ? o.reclamacaoNaBusca.map((id) => ({ id, type: 'cancel_purchase', stage: 'claim', status: 'closed', resource: 'order', resource_id: Number(PEDIDO), players: [{ role: 'complainant', user_id: 999 }] })) : [];
      return sim({ paging: { total: lista.length }, data: lista });
    }
    // ── as buscas de vendas ──
    if (caminho.startsWith('/orders/search?seller=' + CONTA)) {
      // o ENVELOPE de verdade da busca do ML: ele devolve em `query` o proprio texto que foi buscado (o ECO da pergunta)
      const eco = (caminho.match(/[?&]q=([^&]*)/) || [])[1] || '';
      const res = (total, lista) => sim({ query: eco, results: lista || [], sort: { id: 'date_desc', name: 'Date descending' }, available_sorts: [{ id: 'date_asc', name: 'Date ascending' }],
        filters: [], paging: { total, offset: 0, limit: 5 }, display: 'complete' });
      const venda = { id: Number(PEDIDO), status: 'cancelled', tags: ['not_delivered'], shipping: { id: Number(REF) }, date_created: '2026-09-29T08:17:00Z', buyer: { nickname: 'COMPRADORZE', first_name: 'Fulano de Tal' } };
      const comum = { id: 2000019999000001, status: 'paid', tags: ['delivered'], shipping: { id: 48999000001 }, date_created: '2026-11-20T08:00:00Z', buyer: { nickname: 'COMPRADORZE' } };
      if (o.conta === 'vazia') return res(0, []);
      if (o.conta === 'real') {   // o que a conta da AMB devolveu em 21/11 (ids trocados; status e tags como vieram)
        const ped = (i, status, tags) => ({ id: 2000019000000000 + i, status, tags, shipping: { id: 48500000000 + i }, date_created: '2026-11-2' + (i % 2) + 'T04:27:36.000-04:00', buyer: { nickname: 'COMPRADORZE' } });
        const aCaminho = [1, 2, 3, 4, 5].map((i) => ped(i, 'paid', ['order_has_discount', 'paid', 'not_delivered']));
        const naoEntregues = [11, 12, 13, 14, 15].map((i) => ped(i, 'cancelled', ['catalog', 'not_delivered', 'not_paid']));
        if (caminho.includes('&q=')) return res(0, []);                                        // a busca por numero nao acha nenhum dos dois
        if (caminho.includes('&tags=not_delivered')) return res(254, aCaminho);                // a TAG pega o que ainda esta a caminho
        if (caminho.includes('&shipping.status=not_delivered')) return res(36, naoEntregues);  // o STATUS DO ENVIO pega os nao entregues
        if (caminho.includes('&order.status=cancelled')) return res(322, naoEntregues);
        return res(6180, aCaminho);
      }
      if (o.conta === 'uma') return caminho.includes('&q=' + BARRAS) ? res(0, []) : res(1, [venda]);   // TODAS as vendas (1) casam com os filtros
      const controle = () => res(5000, [comum, venda]);   // a busca sem filtro
      if (caminho.includes('&q=' + BARRAS)) return res(0, []);
      if (caminho.includes('&q=' + REF)) return res(1, [venda]);
      if (caminho.includes('&tags=not_delivered')) return o.tagIgnorada ? controle() : res(37, [venda]);
      if (caminho.includes('&shipping.status=not_delivered')) return controle();   // mesmo total e mesmos resultados — e a resposta nao traz o status do envio pra conferir
      if (caminho.includes('&order.status=cancelled')) return o.canceladas429 ? nao(429, { message: 'too many requests' }) : res(212, [venda]);
      return controle();
    }
    return nao(404, { message: 'not found' });
  }
  return { get, chamadas, maxEmVoo: () => maxEmVoo };
}
const semPausa = { pausaMs: 0 };

(async () => {
  // ══ 1. a peca, com o ML falso ══
  console.log('── 1. a sonda (ML falso)');
  ok(soDigitos('48133297953', 9, 13) === '48133297953' && soDigitos(' 48133297953 ', 9, 13) === '48133297953' && soDigitos('48133297953/../x', 9, 13) === null && soDigitos('4813329795a', 9, 13) === null && soDigitos('123', 9, 13) === null,
    '  soDigitos: so o numero inteiro, do tamanho certo — texto com barra, letra ou curto demais e recusado');
  let estourou = null, tipos = null;
  try { tipos = [soDigitos({ toString: 'x' }, 9, 13), soDigitos({ toString: 'x', valueOf: 'y' }, 9, 13), soDigitos(['48133297953'], 9, 13), soDigitos({ a: 1 }, 9, 13), soDigitos(true, 1, 9), soDigitos(null, 9, 13), soDigitos(48133297953, 9, 13)]; } catch (e) { estourou = e; }
  ok(!estourou && JSON.stringify(tipos) === JSON.stringify([null, null, null, null, null, null, '48133297953']),
    '⚠️ Codex #637 (P1) soDigitos: objeto (inclusive com toString que nao e funcao), lista e booleano sao recusados SEM estourar; numero e texto valem' + (estourou ? ' — ESTOUROU: ' + estourou.message : ''));
  ok(desfecho({ http: 200 }).respondeu === true && desfecho({ http: 404 }).nao_existe === true && desfecho({ http: 404 }).conclusivo === true
    && [401, 403, 429, 500, 503, 400, 422, null].every((h) => desfecho({ http: h }).conclusivo === false && desfecho({ http: h }).motivo) && desfecho({ pulada: 'x' }).conclusivo === false && desfecho(undefined) === null,
    '⚠️ Codex #637 (P2) desfecho: so 2xx e 404 sao conclusivos — 401, 403, 429, 5xx, 400/422, sem resposta e pulada sao "nao sei"');

  { // cenario A: o ML LIGA os dois numeros (no formato antigo do envio original e na devolucao da reclamacao)
    const ml = mlFalso({ ligacao: true, canceladas429: true });
    const r = await sondarEtiquetaDeVolta(Object.assign({ get: ml.get, vendedor: () => CONTA, barras: BARRAS, ref: REF }, semPausa));
    const texto = JSON.stringify(r);
    ok(r.ok === true && r.entrada.barras === BARRAS && r.entrada.ref === REF && r.entrada.pedido === PEDIDO && r.entrada.pedido_veio_de === 'envio original', '  rodou; o pedido saiu do envio original (formato antigo: order_id)');
    ok(/^NAO — o ML respondeu 404 \(nao existe pra esta conta\) nas 5 consultas diretas/.test(r.leitura.codigo_de_barras_consultavel) && !r.leitura.consultas_sem_conclusao.some((x) => /^volta_/.test(x.consulta)),
      '⚠️ o codigo de barras NAO e consultavel direto — conclusivo: 404 em todas as consultas do envio de volta (' + r.leitura.codigo_de_barras_consultavel.slice(0, 44) + '…)');
    ok(/^SIM — o numero do codigo de barras aparece em \d+ campo/.test(r.leitura.o_ml_liga_o_codigo_de_barras_a_venda), '⚠️ a pergunta principal sai respondida: o ML LIGA o codigo de barras a venda — SIM');
    ok(r.consultas.volta_envio_formato_novo.http === 404 && /not_found_shipping/.test(r.consultas.volta_envio_formato_novo.erro_ml) && r.consultas.volta_envio_formato_antigo.http === 404,
      '  e o relatorio guarda o HTTP e o erro do ML de cada formato');
    const onde = r.leitura.onde_o_codigo_de_barras_aparece.map((x) => x.consulta + ' → ' + x.caminho);
    ok(onde.includes('original_envio_formato_antigo → sibling.sibling_id') && onde.includes('original_envio_formato_antigo → return_tracking_number'),
      '⚠️ ONDE o numero da etiqueta aparece: no formato ANTIGO do envio original (sibling.sibling_id e return_tracking_number, DENTRO do rastreio)');
    ok(onde.includes('devolucao_da_reclamacao_5001234567 → shipments[0].shipment_id'), '  e na devolucao da reclamacao do pedido (shipments[0].shipment_id)');
    ok(!onde.some((x) => /^original_envio_formato_novo/.test(x)), '  o formato NOVO (o unico que o sistema le hoje) nao traz a ligacao');
    const lig = r.consultas.original_envio_formato_antigo.ligacao;
    ok(lig.preenchidos.some((x) => x.caminho === 'sibling' && /"sibling_id":48133297953/.test(x.valor)) && lig.preenchidos.some((x) => x.caminho === 'return_tracking_number')
      && lig.vazios.includes('return_details'), '  campos de ligacao: os preenchidos com valor, e os que EXISTEM mas vieram vazios (return_details)');
    ok(r.consultas.pedido.cancel_detail && r.consultas.pedido.cancel_detail.code === 'shipment_not_delivered' && r.consultas.pedido.tags.includes('not_delivered'), '  o pedido: motivo do cancelamento e tags');
    ok(r.leitura.busca_de_vendas_pelo_ref_id === 'ACHA 1 venda(s) (a conta tem 5000)' && r.leitura.busca_de_vendas_pelo_codigo_de_barras === 'NAO ACHA — a busca de vendas por esse numero volta 0 (a conta tem 5000)',
      '  busca de vendas: acha pelo Ref. ID (1) e nao acha pelo codigo de barras (0)');
    ok(r.leitura.listar_nao_entregues.por_tag === 'respeitado (37 de 5000) — amostra dos 1 primeiros: 1 cancelled', '⚠️ listar os nao entregues por TAG: respeitado (37 de 5000), com a amostra do que veio');
    // Codex #637 (P2): mesmo total da busca sem filtro NAO e prova de "ignorado" — e tambem nao e "5000 nao entregues"
    ok(/^INCONCLUSIVO \(mesmo total da busca sem filtro: 5000; os resultados sao os MESMOS da busca sem filtro\)/.test(r.leitura.listar_nao_entregues.por_status_do_envio),
      '⚠️ Codex #637: mesmo total do controle, sem como conferir → INCONCLUSIVO, com o fato (resultados iguais aos da busca sem filtro) — nem "IGNORADO", nem "5000 nao entregues"');
    ok(/^nao sei \(HTTP 429/.test(r.leitura.listar_nao_entregues.cancelados) && r.leitura.consultas_sem_conclusao.some((x) => x.consulta === 'vendas_canceladas' && /429/.test(x.motivo)),
      '⚠️ "nao sei" != "nao existe": consulta com 429 sai como "nao sei" e na lista das sem conclusao, com o motivo');
    ok(PESSOAL.every((p) => !texto.includes(p)), '⚠️ NENHUM dado pessoal do comprador no relatorio (nome, endereco, telefone, CEP, apelido, e-mail, documento)' + (PESSOAL.filter((p) => texto.includes(p)).length ? ' — VAZOU: ' + PESSOAL.filter((p) => texto.includes(p)).join(', ') : ''));
    // Codex #637 (P2): campo com NOME de ligacao dentro de bloco pessoal — `receiver_address.reference` saia inteiro
    const ligs = ['original_envio_formato_novo', 'original_envio_formato_antigo', 'pedido'].map((n) => r.consultas[n].ligacao);
    ok(ligs.every((l) => !l.preenchidos.concat(l.vazios.map((c) => ({ caminho: c }))).some((x) => /address|receiver|buyer|destination\.shipping/.test(x.caminho))),
      '⚠️ Codex #637: campos de ligacao NAO sao catados dentro de bloco pessoal (endereco, destinatario, comprador) — nem pelo caminho');
    ok(r.consultas.original_envio_formato_antigo.ligacao.preenchidos.some((x) => x.caminho === 'sibling') && r.consultas.original_envio_formato_antigo.ligacao.preenchidos.some((x) => x.caminho === 'return_tracking_number'),
      '  e os campos de ligacao de verdade (sibling, return_tracking_number) continuam saindo');
    // a mesma classe: texto livre da transportadora, texto em volta do numero, e o corpo do erro do ML
    ok(r.consultas.original_historico.eventos.length === 3 && r.consultas.original_historico.eventos.every((ev) => !('tracking.description' in ev)) && r.consultas.original_historico.eventos[0]['tracking.checkpoint'] === 'CP1',
      '⚠️ (mesma classe) o historico sai sem o texto livre do rastreio ("recebido por Fulano") — so status, datas e o codigo do ponto');
    const noTexto = r.leitura.onde_o_codigo_de_barras_aparece.find((x) => x.consulta === 'original_historico');
    ok(noTexto && noTexto.caminho === '[2].note' && noTexto.valor === 'MEL' + BARRAS + 'FMXDR01', '⚠️ (mesma classe) numero achado no meio de um texto livre: mostra SO o pedaco do numero, nao o texto em volta (' + JSON.stringify(noTexto) + ')');
    ok(/not_found_shipping/.test(r.consultas.volta_itens.erro_ml) && /"receiver_name":"\[omitido\]"/.test(r.consultas.volta_itens.erro_ml) && /"contact":"\[omitido\]"/.test(r.consultas.volta_itens.erro_ml),
      '⚠️ (mesma classe) o corpo do erro do ML tambem passa pelo redator');
    ok(texto.length < 14000, '  relatorio enxuto pra colar numa conversa (' + texto.length + ' caracteres)');
    // as chamadas: so GET nos caminhos previstos, uma por vez, header so no formato novo
    const permitido = /^\/(users\/me$|shipments\/\d{9,13}(\/(history|items|orders))?$|orders\/\d{12,20}$|orders\/search\?seller=\d+&|post-purchase\/v1\/claims\/\d+$|post-purchase\/v2\/claims\/\d+\/returns$|post-purchase\/v1\/claims\/search\?status=(opened|closed)&resource=order&resource_id=\d+&limit=5$)/;
    ok(ml.chamadas.every((c) => permitido.test(c.caminho)), '⚠️ so caminhos FIXOS com numeros (nada de caminho livre)' + (ml.chamadas.filter((c) => !permitido.test(c.caminho)).map((c) => ' ' + c.caminho).join('')));
    ok(ml.maxEmVoo() === 1, '  uma consulta por vez (' + ml.chamadas.length + ' consultas, no maximo ' + ml.maxEmVoo() + ' em voo)');
    const comHeader = ml.chamadas.filter((c) => c.headers).map((c) => c.caminho);
    ok(comHeader.length === 2 && comHeader.includes('/shipments/' + BARRAS) && comHeader.includes('/shipments/' + REF) && ml.chamadas.filter((c) => c.caminho === '/shipments/' + REF).length === 2,
      '  cada envio e lido nos DOIS formatos (com e sem x-format-new)');
    ok(!ml.chamadas.some((c) => c.caminho === '/users/me'), '  com o id da conta em maos, nao consulta /users/me');
  }

  { // cenario B: o ML NAO liga os numeros em lugar nenhum — e todas as consultas responderam (conclusivo)
    const ml = mlFalso({ ligacao: false });
    const r = await sondarEtiquetaDeVolta(Object.assign({ get: ml.get, barras: BARRAS, ref: REF }, semPausa));
    ok(r.ok && r.leitura.onde_o_codigo_de_barras_aparece.length === 0, '⚠️ sem ligacao: a lista de onde o numero aparece vem VAZIA');
    ok(/^NAO APARECE — /.test(r.leitura.o_ml_liga_o_codigo_de_barras_a_venda) && r.leitura.consultas_sem_conclusao.length === 0,
      '⚠️ e como TODAS as consultas responderam (200 ou 404), a leitura e conclusiva: NAO APARECE (sem conclusao: ' + JSON.stringify(r.leitura.consultas_sem_conclusao) + ')');
    ok(/^respeitado \(212 de 5000\)/.test(r.leitura.listar_nao_entregues.cancelados), '  filtro com total diferente do controle: respeitado (212 de 5000)');
    ok(r.consultas.original_envio_formato_antigo.ligacao.vazios.includes('sibling') && r.consultas.original_envio_formato_antigo.ligacao.vazios.includes('return_tracking_number'),
      '  e os campos de ligacao aparecem como existentes e vazios (sibling so com nulos conta como vazio)');
    ok(ml.chamadas.some((c) => c.caminho === '/users/me') && r.consultas.conta && r.consultas.conta.id === CONTA && !JSON.stringify(r).includes('comprador@exemplo.com'),
      '  sem o id da conta: pergunta ao ML (/users/me) e guarda SO o id');
    ok(r.consultas.devolucao_da_reclamacao_5001234567.http === 404, '  a devolucao da reclamacao que nao existe fica registrada com o 404');
  }

  { // cenario C: o envio de volta RESPONDE — e aponta o original
    const ml = mlFalso({ barrasResponde: true });
    const r = await sondarEtiquetaDeVolta(Object.assign({ get: ml.get, vendedor: () => CONTA, barras: BARRAS, ref: REF }, semPausa));
    ok(/^SIM/.test(r.leitura.codigo_de_barras_consultavel) && r.leitura.onde_o_ref_id_aparece_na_volta.some((x) => x.caminho === 'sibling.sibling_id'),
      '⚠️ se o envio de volta responder, a leitura diz SIM e mostra onde ele aponta o original (' + JSON.stringify(r.leitura.onde_o_ref_id_aparece_na_volta[0]) + ')');
    ok(r.consultas.volta_envio_formato_novo.logistic && r.consultas.volta_envio_formato_novo.logistic.direction === 'return' && !JSON.stringify(r).includes('Fulano'), '  com a direcao do envio (return) e sem o destinatario');
  }

  { // ══ b795 — O CASO REAL (AMB, 21/11): o que a sonda devolveu, e o que a leitura tinha que ter dito ══
    // O dono rodou a sonda em producao (b788). A leitura disse "SIM — o numero do codigo de barras aparece em 1 campo(s)":
    // o campo era `query`, da busca de vendas pelo proprio codigo de barras — o ML devolve ali o TEXTO BUSCADO. Era o eco
    // da minha pergunta, nao uma ligacao. Os dados diziam o contrario: `sibling`, `return_tracking_number` e
    // `return_details` existem e vem vazios; o pedido nao tem reclamacao; e a busca por numero volta 0.
    const ml = mlFalso({ ligacao: false, semMediations: true, conta: 'real' });
    const r = await sondarEtiquetaDeVolta(Object.assign({ get: ml.get, vendedor: () => CONTA, barras: BARRAS, ref: REF }, semPausa));
    ok(r.leitura.onde_o_codigo_de_barras_aparece.length === 0, '⚠️ b795: o ECO da busca (`query` = o texto que eu mesmo busquei) NAO conta como lugar onde o numero aparece (' + JSON.stringify(r.leitura.onde_o_codigo_de_barras_aparece) + ')');
    ok(/^NAO APARECE — /.test(r.leitura.o_ml_liga_o_codigo_de_barras_a_venda), '⚠️ b795: a pergunta principal, no caso real: o ML NAO liga o codigo de barras a venda (a sonda tinha dito SIM) — ' + String(r.leitura.o_ml_liga_o_codigo_de_barras_a_venda).slice(0, 40));
    ok(/^NAO — o ML respondeu 404/.test(r.leitura.codigo_de_barras_consultavel) && r.leitura.consultas_sem_conclusao.length === 0, '  e e conclusivo: 404 nas consultas diretas e nenhuma consulta sem conclusao');
    ok(r.leitura.busca_de_vendas_pelo_codigo_de_barras === 'NAO ACHA — a busca de vendas por esse numero volta 0 (a conta tem 6180)' && r.leitura.busca_de_vendas_pelo_ref_id === 'NAO ACHA — a busca de vendas por esse numero volta 0 (a conta tem 6180)',
      '⚠️ b795: a busca de vendas por numero que volta ZERO diz "NAO ACHA" (dizia "respeitado (0 de 6180)", que parecia "funciona")');
    ok(r.leitura.listar_nao_entregues.por_tag === 'respeitado (254 de 6180) — amostra dos 5 primeiros: 5 paid'
      && r.leitura.listar_nao_entregues.por_status_do_envio === 'respeitado (36 de 6180) — amostra dos 5 primeiros: 5 cancelled'
      && r.leitura.listar_nao_entregues.cancelados === 'respeitado (322 de 6180) — amostra dos 5 primeiros: 5 cancelled',
    '⚠️ b795: a listagem leva a AMOSTRA do que veio — a tag `not_delivered` traz venda PAGA a caminho (254), o status do envio traz as canceladas nao entregues (36): "254 nao entregues" seria leitura errada');
    ok(r.consultas.vendas_buscando_o_codigo_de_barras.total === 0 && r.consultas.vendas_buscando_o_codigo_de_barras.http === 200 && !/"query"/.test(JSON.stringify(r.leitura)), '  (a consulta em si continua registrada: HTTP 200, total 0)');
  }

  { // a mesma classe: o eco tambem nao pode virar "ligacao" quando a busca ACHA a venda por outro motivo
    const ml = mlFalso({ ligacao: false, semMediations: true });   // conta grande: a busca pelo Ref. ID acha a venda (1), a do codigo de barras nao (0)
    const r = await sondarEtiquetaDeVolta(Object.assign({ get: ml.get, vendedor: () => CONTA, barras: BARRAS, ref: REF }, semPausa));
    ok(r.leitura.onde_o_codigo_de_barras_aparece.length === 0 && /^NAO APARECE — /.test(r.leitura.o_ml_liga_o_codigo_de_barras_a_venda), '  sem ligacao nos dados, com as buscas respondendo: NAO APARECE (o eco de nenhuma busca entra)');
    // e quando o numero esta DENTRO de um resultado da busca (ai sim e dado da venda), aparece — com o caminho do resultado
    const get = async (c, h) => {
      const x = await ml.get(c, h);
      if (c.includes('&q=' + REF) && x.ok) x.data.results = [Object.assign({}, x.data.results[0], { shipping: { id: Number(REF), return_shipment: Number(BARRAS) } })];
      return x;
    };
    const r2 = await sondarEtiquetaDeVolta(Object.assign({ get, vendedor: () => CONTA, barras: BARRAS, ref: REF }, semPausa));
    ok(JSON.stringify(r2.leitura.onde_o_codigo_de_barras_aparece) === JSON.stringify([{ consulta: 'vendas_buscando_o_ref_id', caminho: 'results[0].shipping.return_shipment', valor: BARRAS }]) && /^SIM — /.test(r2.leitura.o_ml_liga_o_codigo_de_barras_a_venda),
      '⚠️ numero DENTRO de um resultado da busca (dado da venda) continua contando — com o caminho do resultado (' + JSON.stringify(r2.leitura.onde_o_codigo_de_barras_aparece) + ')');
  }

  { // so o codigo de barras (sem Ref. ID): roda o que da
    const ml = mlFalso();
    const r = await sondarEtiquetaDeVolta(Object.assign({ get: ml.get, vendedor: () => CONTA, barras: BARRAS }, semPausa));
    ok(r.ok && r.entrada.ref === null && !ml.chamadas.some((c) => c.caminho.includes(REF)) && r.leitura.busca_de_vendas_pelo_ref_id === null, '  so com o codigo de barras: nao inventa consulta do original');
  }

  { // ══ Codex #637 (P2): acesso NEGADO nao prova que o envio nao existe ══
    const rodar = async (opcoes) => sondarEtiquetaDeVolta(Object.assign({ get: mlFalso(opcoes).get, vendedor: () => CONTA, barras: BARRAS, ref: REF }, semPausa));
    const CINCO = ['volta_envio_formato_novo', 'volta_envio_formato_antigo', 'volta_historico', 'volta_itens', 'volta_pedidos_do_envio'];
    for (const http of [403, 401]) {
      const r = await rodar({ voltaHttp: http });
      const semC = r.leitura.consultas_sem_conclusao;
      ok(/^NAO SEI — nenhuma consulta do envio de volta respondeu 200, e 5 de 5 ficaram sem conclusao/.test(r.leitura.codigo_de_barras_consultavel)
        && CINCO.every((n) => semC.some((x) => x.consulta === n && new RegExp('^HTTP ' + http + ' \\(acesso negado').test(x.motivo))),
      '⚠️ Codex #637: envio de volta com HTTP ' + http + ' → "NAO SEI" (e nao "NAO"), e as 5 consultas entram nas sem conclusao com o motivo');
    }
    // um formato 404 e o outro negado: ainda nao da pra dizer NAO
    const misto = await rodar({ voltaHttp: (caminho, novo) => (novo ? null : 403) });
    ok(/^NAO SEI — .* 4 de 5 ficaram sem conclusao/.test(misto.leitura.codigo_de_barras_consultavel) && misto.consultas.volta_envio_formato_novo.http === 404,
      '  um formato com 404 e o outro negado: continua "NAO SEI" (4 de 5 sem conclusao)');
    // o lado da VENDA negado: "nao aparece" nao pode sair como conclusivo
    const vendaNegada = await rodar({ ligacao: false, pedidoHttp: 403 });
    ok(vendaNegada.leitura.onde_o_codigo_de_barras_aparece.length === 0 && /^NAO SEI — nao aparece no que respondeu, mas 1 consulta\(s\) do lado da venda ficaram sem conclusao/.test(vendaNegada.leitura.o_ml_liga_o_codigo_de_barras_a_venda)
      && vendaNegada.leitura.consultas_sem_conclusao.some((x) => x.consulta === 'pedido' && /^HTTP 403/.test(x.motivo)),
    '⚠️ Codex #637 (a mesma classe): pedido com 403 e nenhuma ligacao achada → "NAO SEI", nao "NAO APARECE"');
  }

  { // ══ Codex #637 (P2): total IGUAL ao da busca sem filtro nao prova "filtro ignorado" ══
    const rodar = async (opcoes) => sondarEtiquetaDeVolta(Object.assign({ get: mlFalso(opcoes).get, vendedor: () => CONTA, barras: BARRAS, ref: REF }, semPausa));
    // (a) a conta tem UMA venda: ela casa com todos os filtros e com a busca pelo Ref. ID — os filtros FUNCIONAM e o total e igual
    const uma = await rodar({ conta: 'uma' });
    ok(!/IGNORADO/.test(JSON.stringify(uma.leitura)), '⚠️ Codex #637: conta em que TODAS as vendas casam com o filtro — nada sai como "IGNORADO"');
    ok(/^INCONCLUSIVO \(mesmo total da busca sem filtro: 1; os resultados sao os MESMOS da busca sem filtro\)/.test(uma.leitura.busca_de_vendas_pelo_ref_id),
      '⚠️ a busca pelo Ref. ID que acha a UNICA venda da conta: INCONCLUSIVO (e nao "o ML ignora a busca")');
    ok(/^INCONCLUSIVO \(mesmo total da busca sem filtro: 1; os 1 resultados conferidos casam com o filtro\)/.test(uma.leitura.listar_nao_entregues.por_tag)
      && /os 1 resultados conferidos casam com o filtro/.test(uma.leitura.listar_nao_entregues.cancelados), '  e quando da pra conferir, o fato vai junto: os resultados casam com o filtro');
    ok(uma.leitura.busca_de_vendas_pelo_codigo_de_barras === 'NAO ACHA — a busca de vendas por esse numero volta 0 (a conta tem 1)', '  total diferente do controle: a busca por numero diz que NAO ACHA (0, a conta tem 1)');
    // (b) conta vazia: 0 nos dois
    const vazia = await rodar({ conta: 'vazia' });
    ok(/^INCONCLUSIVO \(mesmo total da busca sem filtro: 0; nenhum resultado pra conferir\)/.test(vazia.leitura.listar_nao_entregues.por_tag) && !/IGNORADO/.test(JSON.stringify(vazia.leitura)),
      '⚠️ conta sem vendas (0 nos dois): INCONCLUSIVO, nada pra conferir');
    // (c) "IGNORADO" so com PROVA: o ML devolveu venda que NAO casa com o filtro
    const ignorada = await rodar({ tagIgnorada: true });
    ok(/^IGNORADO pelo ML \(mesmo total da busca sem filtro: 5000 — e 1 de 2 resultados NAO casam com o filtro\)/.test(ignorada.leitura.listar_nao_entregues.por_tag),
      '⚠️ "IGNORADO" so com prova: mesmo total E resultado devolvido que nao casa com o filtro (' + ignorada.leitura.listar_nao_entregues.por_tag.slice(0, 60) + '…)');
  }

  { // ══ Codex #637 (P2): reclamacao achada pela BUSCA (o pedido nao lista) — a devolucao dela tambem e consultada ══
    const DEV = '/post-purchase/v2/claims/5009999999/returns';
    const rodar = async (opcoes) => { const ml = mlFalso(opcoes); const r = await sondarEtiquetaDeVolta(Object.assign({ get: ml.get, vendedor: () => CONTA, barras: BARRAS, ref: REF }, semPausa)); return { ml, r }; };
    const a = await rodar({ ligacao: false, semMediations: true, reclamacaoNaBusca: [5009999999] });
    ok(a.ml.chamadas.filter((c) => c.caminho === DEV).length === 1, '⚠️ Codex #637: a reclamacao que so a BUSCA mostrou tem a devolucao consultada (1 chamada)');
    ok(a.r.leitura.onde_o_codigo_de_barras_aparece.some((x) => x.consulta === 'devolucao_da_reclamacao_5009999999' && x.caminho === 'shipments[0].shipment_id') && /^SIM — /.test(a.r.leitura.o_ml_liga_o_codigo_de_barras_a_venda),
      '⚠️ e e la que a ligacao aparece (shipments[0].shipment_id) — antes ficava de fora e a leitura dizia "nao aparece"');
    ok(!a.ml.chamadas.some((c) => c.caminho === '/post-purchase/v1/claims/5009999999'), '  a reclamacao da busca ja veio inteira na busca: nao gasta outra consulta com ela');
    // o pedido NEM respondeu (403): a busca acha a reclamacao e a devolucao e seguida do mesmo jeito
    const b = await rodar({ ligacao: false, pedidoHttp: 403, reclamacaoNaBusca: [5009999999] });
    ok(b.ml.chamadas.some((c) => c.caminho === DEV) && b.r.leitura.onde_o_codigo_de_barras_aparece.some((x) => x.consulta === 'devolucao_da_reclamacao_5009999999'),
      '⚠️ com o pedido negado (403), a reclamacao da busca e a devolucao dela sao seguidas');
    // sem repetir: a busca devolve a MESMA reclamacao que o pedido ja lista
    const c = await rodar({ ligacao: true, reclamacaoNaBusca: [5001234567] });
    ok(c.ml.chamadas.filter((x) => x.caminho === '/post-purchase/v2/claims/5001234567/returns').length === 1 && c.ml.chamadas.filter((x) => x.caminho === '/post-purchase/v1/claims/5001234567').length === 1,
      '  reclamacao que esta no pedido E na busca: consultada uma vez so');
    // id hostil vindo da BUSCA nao vira caminho (e objeto com toString nao estoura)
    const d = await rodar({ ligacao: false, semMediations: true, reclamacaoNaBusca: ['../../users/me', { toString: 'x' }, '5009999999?x=1', 5009999999] });
    ok(d.r.ok && d.ml.chamadas.filter((x) => /claims\/[^s]/.test(x.caminho)).map((x) => x.caminho).join() === DEV, '⚠️ id hostil vindo da busca de reclamacoes NAO vira caminho — so o valido e seguido');
    // limite por rodada: o que fica de fora NAO some — aparece como pulada (sem conclusao)
    const e = await rodar({ ligacao: false, semMediations: true, reclamacaoNaBusca: [5009999991, 5009999992, 5009999993, 5009999994, 5009999995] });
    ok(e.ml.chamadas.filter((x) => /\/returns$/.test(x.caminho)).length === 3 && JSON.stringify(e.r.consultas.reclamacoes_alem_do_limite.ids) === '["5009999994","5009999995"]'
      && e.r.leitura.consultas_sem_conclusao.some((x) => x.consulta === 'reclamacoes_alem_do_limite'), '  mais reclamacoes que o limite da rodada (3): as de fora ficam listadas como puladas');
    // o envio original NAO trouxe o numero da venda: a busca pelo Ref. ID acha a venda desse envio, e ela e seguida
    const f = await rodar({ ligacao: true, originalSemPedido: true });
    ok(f.r.entrada.pedido === PEDIDO && f.r.entrada.pedido_veio_de === 'busca de vendas pelo Ref. ID' && f.r.consultas.pedido.http === 200 && f.ml.chamadas.filter((x) => x.caminho === '/orders/' + PEDIDO).length === 1
      && f.r.leitura.onde_o_codigo_de_barras_aparece.some((x) => x.consulta === 'devolucao_da_reclamacao_5001234567'),
    '⚠️ (a mesma classe) sem order_id no envio original: a venda achada na busca pelo Ref. ID e seguida — pedido, reclamacao e devolucao');
    // e se nem a busca achar: o lado da venda aparece como NAO examinado
    const g = await rodar({ ligacao: false, originalSemPedido: true, conta: 'vazia' });
    ok(g.r.entrada.pedido === null && /nao descobri o numero da venda/.test(g.r.consultas.pedido.pulada) && /^NAO SEI — /.test(g.r.leitura.o_ml_liga_o_codigo_de_barras_a_venda),
      '⚠️ sem conseguir o numero da venda: o pedido sai como "pulada" e a leitura e "NAO SEI" (nao "NAO APARECE")');
  }

  // entrada invalida: NENHUMA chamada ao ML
  for (const [nome, entrada] of [
    ['barras objeto com toString que nao e funcao (Codex #637)', { barras: { toString: 'x' }, ref: REF }], ['ref objeto aninhado (Codex #637)', { barras: BARRAS, ref: { a: { b: '1' } } }],
    ['pedido objeto sem toString nem valueOf validos (Codex #637)', { barras: BARRAS, pedido: { toString: 'x', valueOf: 'y' } }], ['barras lista de um so (Codex #637)', { barras: [BARRAS] }],
    ['barras com caminho', { barras: BARRAS + '/../users/me', ref: REF }], ['ref com letra', { barras: BARRAS, ref: '4812602434O' }],
    ['nada informado', {}], ['os dois iguais', { barras: BARRAS, ref: BARRAS }], ['pedido curto', { barras: BARRAS, pedido: '12' }], ['barras em lista', { barras: [BARRAS, REF] }],
  ]) {
    const ml = mlFalso();
    const r = await sondarEtiquetaDeVolta(Object.assign({ get: ml.get }, entrada, semPausa));
    ok(r.ok === false && r.status === 400 && ml.chamadas.length === 0, '⚠️ entrada invalida (' + nome + '): 400 e ZERO chamadas ao ML');
  }

  { // id que vem DO ML tambem e validado antes de virar caminho
    const ml = mlFalso({ medHostil: true });
    const r = await sondarEtiquetaDeVolta(Object.assign({ get: ml.get, vendedor: () => CONTA, barras: BARRAS, ref: REF }, semPausa));
    ok(r.ok && !ml.chamadas.some((c) => /\.\.|\?x=1|claims\/[^s\d]/.test(c.caminho)) && !Object.keys(r.consultas).some((n) => /^reclamacao_/.test(n)),
      '⚠️ id de reclamacao hostil vindo do ML ("../../users/me") NAO vira caminho');
  }

  { // excecao numa consulta: registra e SEGUE; e o teto de tempo
    const ml = mlFalso({ estoura: /\/history$/ });
    const r = await sondarEtiquetaDeVolta(Object.assign({ get: ml.get, vendedor: () => CONTA, barras: BARRAS, ref: REF }, semPausa));
    ok(r.ok && /socket hang up/.test(r.consultas.original_historico.erro) && r.consultas.pedido.http === 200 && r.leitura.consultas_sem_conclusao.some((x) => x.consulta === 'original_historico' && /sem resposta \(socket hang up\)/.test(x.motivo)),
      '⚠️ consulta que estoura: fica com o erro, a sonda segue, e entra na lista das sem conclusao');
    let t = 0; const ml2 = mlFalso();
    const r2 = await sondarEtiquetaDeVolta({ get: ml2.get, vendedor: () => CONTA, barras: BARRAS, ref: REF, pausaMs: 0, tetoMs: 5000, agora: () => (t += 1000) });
    const puladas = Object.keys(r2.consultas).filter((n) => r2.consultas[n].pulada);
    ok(r2.ok && puladas.length > 5 && ml2.chamadas.length <= 6 && puladas.every((n) => r2.leitura.consultas_sem_conclusao.some((x) => x.consulta === n && /^pulada: /.test(x.motivo))),
      '  teto de tempo: o que nao coube sai como "pulada" (' + puladas.length + ') e NAO como "sem ligacao"');
  }

  // as duas buscas no JSON, isoladas
  ok(JSON.stringify(ondeAparece({ a: { b: ['x', 'MEL48133297953Z'] }, receiver_name: 'Sr 48133297953' }, BARRAS)) === JSON.stringify([{ caminho: 'a.b[1]', valor: 'MEL48133297953Z' }, { caminho: 'receiver_name', valor: '[omitido]' }]),
    '  ondeAparece: acha DENTRO de texto e em lista; em campo pessoal diz o caminho mas omite o valor');
  const cl = camposDeLigacao({ return_details: { shipment_id: 9, receiver_name: 'Fulano de Tal' }, claim_id: null, x: { related_ids: [] }, receiver_reference: 'casa' });
  ok(cl.preenchidos.length === 1 && cl.preenchidos[0].caminho === 'return_details' && !/Fulano/.test(cl.preenchidos[0].valor) && cl.vazios.join(',') === 'claim_id,x.related_ids',
    '  camposDeLigacao: valor redigido, vazios listados, campo pessoal fora (' + JSON.stringify(cl) + ')');
  // Codex #637: o exemplo do apontamento, e as variacoes da mesma classe
  const cl2 = camposDeLigacao({
    receiver_address: { reference: 'Casa de Fulano ao lado da farmacia', related_contacts: [{ parent_note: 'vizinha Beltrana' }], return_instructions: null },
    destination: { shipping_address: { references: 'portao azul', original_address: { reference: 'fundos' } }, related_shipment: 77 },
    lista: [{ buyer: { claim_note: 'reclamou o Sicrano' } }, { claim_id: 5 }],
    reference: 'ponto de referencia solto', external_reference: 'PED-9', return_details: { reference: 'casa do Sicrano', shipment_id: 9 },
  });
  ok(JSON.stringify(cl2.preenchidos.map((x) => x.caminho)) === JSON.stringify(['destination.related_shipment', 'lista[1].claim_id', 'external_reference', 'return_details']) && cl2.vazios.length === 0,
    '⚠️ Codex #637 camposDeLigacao: nada de dentro de receiver_address / shipping_address / buyer (nem nos vazios); o que e ligacao de verdade fica (' + cl2.preenchidos.map((x) => x.caminho).join(', ') + ')');
  ok(!/Fulano|farmacia|Beltrana|portao|fundos|Sicrano|ponto de referencia/.test(JSON.stringify(cl2)), '⚠️ e nenhum dos textos pessoais aparece — inclusive o `reference` (ponto de referencia) solto ou dentro de um campo de ligacao');
  ok(JSON.stringify(ondeAparece({ nota: 'pacote 48133297953 recebido por Fulano', codigo: 48133297953 }, BARRAS)) === JSON.stringify([{ caminho: 'nota', valor: '48133297953' }, { caminho: 'codigo', valor: '48133297953' }]),
    '  ondeAparece: numero no meio de um texto → so o pedaco do numero');

  // ══ 2. a ROTA, pelo cliente de PRODUCAO do ML (rede simulada) ══
  console.log('\n── 2. a rota, pelo cliente de producao do ML');
  {
    const RAIZ = path.join(__dirname, '..'); const abs = (p) => require.resolve(path.join(RAIZ, p));
    const falso = mlFalso({ ligacao: true });
    const pedidosHttp = [];
    const axiosFalso = async (cfgReq) => {
      const u = new URL(cfgReq.url);
      pedidosHttp.push({ host: u.host, caminho: u.pathname + u.search, metodo: cfgReq.method, auth: (cfgReq.headers || {}).Authorization, formatoNovo: (cfgReq.headers || {})['x-format-new'] || null });
      const r = await falso.get(u.pathname + u.search, (cfgReq.headers || {})['x-format-new'] ? { 'x-format-new': 'true' } : null);
      if (r.ok) return { status: 200, data: r.data };
      const e = new Error('HTTP ' + r.status); e.response = { status: r.status, data: r.error, headers: {} }; throw e;
    };
    axiosFalso.get = async (url) => axiosFalso({ url, method: 'GET', headers: {} });
    axiosFalso.post = async () => ({ status: 200, data: {} });
    axiosFalso.isAxiosError = () => false; axiosFalso.create = () => axiosFalso;
    for (const k of Object.keys(process.env)) if (/^TOKEN_POLITICA_/.test(k)) delete process.env[k];
    process.env.TOKEN_POLITICA_GIRASSOL_ML = 'local';   // sem dono: o cliente usa o token local da ficha de teste
    for (const m of ['lib/token-leitor.js', 'amb-devolucoes/lib-AMB/ml-AMB.js', 'lib/render-tokens.js', 'lib/ritmo-por-empresa.js']) delete require.cache[abs(m)];
    const idAxios = require.resolve('axios');
    require.cache[idAxios] = { id: idAxios, filename: idAxios, loaded: true, exports: axiosFalso };
    require.cache[abs('lib/render-tokens.js')] = { id: abs('lib/render-tokens.js'), filename: abs('lib/render-tokens.js'), loaded: true, exports: { atualizarTokensNoRender: async () => true } };
    const silencio = { log: console.log, warn: console.warn, error: console.error };
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    let mlReal;
    try {
      mlReal = require(abs('amb-devolucoes/lib-AMB/ml-AMB.js')).criar({
        CHAVE_REGISTRO: 'girassol', PREFIXO_ENV: 'GIRASSOL_', PREFIXO_ROTA: '/girassol',
        ml: { accessToken: 'TOK-LOCAL', refreshToken: 'REF', userId: CONTA, clientId: 'c', clientSecret: 's', apiBase: 'https://api.ml.teste', chaveAccess: 'A', chaveRefresh: 'R', chaveUserId: 'U' },
      });
    } finally { Object.assign(console, silencio); }
    let relogio = 1000000;
    const rota = criarRotaDaSonda({ obterMl: () => mlReal, versao: 'teste', empresa: 'girassol', agora: () => relogio });
    const pedir = async (query) => { const res = { codigo: null, corpo: null, status(c) { this.codigo = c; return this; }, json(o) { this.corpo = o; return this; } }; await rota({ query }, res); return res; };

    const calado = async (f) => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; try { return await f(); } finally { Object.assign(console, silencio); } };
    const r1 = await calado(() => pedir({ barras: BARRAS, ref: REF }));
    ok(r1.codigo === 200 && r1.corpo.ok === true && r1.corpo.empresa === 'girassol' && r1.corpo.versao === 'teste', '  200 com a empresa e a versao');
    ok(pedidosHttp.length > 15 && pedidosHttp.every((p) => p.host === 'api.ml.teste' && p.metodo === 'GET' && p.auth === 'Bearer TOK-LOCAL'),
      '⚠️ o cliente de PRODUCAO fez as consultas: so GET, no host da API da ficha, com o token da empresa (' + pedidosHttp.length + ')');
    const doRef = pedidosHttp.filter((p) => p.caminho === '/shipments/' + REF);
    ok(doRef.length === 2 && doRef.filter((p) => p.formatoNovo === 'true').length === 1, '⚠️ contrato com o cliente: o header x-format-new chega no formato novo e NAO vai no antigo');
    ok(r1.corpo.leitura.onde_o_codigo_de_barras_aparece.some((x) => x.caminho === 'sibling.sibling_id'), '  e a leitura sai igual pela rota');
    ok(!pedidosHttp.some((p) => p.caminho === '/users/me'), '  o id da conta vem do cliente (userId), sem consulta extra');

    // memoria: a mesma pergunta em 2 min nao consulta o ML de novo
    const n1 = pedidosHttp.length; relogio += 30000;
    const r2 = await calado(() => pedir({ barras: BARRAS, ref: REF }));
    ok(r2.codigo === 200 && r2.corpo.da_memoria === true && r2.corpo.idade_s === 30 && pedidosHttp.length === n1, '⚠️ a mesma pergunta em 2 min sai da MEMORIA (zero consultas novas ao ML)');
    // intervalo: outra pergunta antes de 15 s e recusada
    relogio += 0;
    const sondarContado = { n: 0 };
    const rota2 = criarRotaDaSonda({ obterMl: () => mlReal, agora: () => relogio, sondar: async (p) => { sondarContado.n++; if (p.barras === '11111111111') throw new Error('quebrou'); return p.barras === 'x' ? { ok: false, status: 400, erro: 'invalida' } : { ok: true, leitura: {} }; } });
    const pedir2 = async (query) => { const res = { codigo: null, corpo: null, status(c) { this.codigo = c; return this; }, json(o) { this.corpo = o; return this; } }; await rota2({ query }, res); return res; };
    const a = await pedir2({ barras: BARRAS });
    const b = await pedir2({ barras: REF });
    ok(a.codigo === 200 && b.codigo === 429 && /aguarde 15 s/.test(b.corpo.erro) && sondarContado.n === 1, '⚠️ outra sonda antes de 15 s: 429 "aguarde" (limite da cota), sem rodar');
    relogio += 15001;
    const c = await pedir2({ barras: REF });
    ok(c.codigo === 200 && sondarContado.n === 2, '  passados os 15 s, roda');
    // entrada invalida nao arma o intervalo; excecao vira 500 e solta a trava
    relogio += 15001;
    const d = await pedir2({ barras: 'x' });
    const e = await pedir2({ barras: '22222222222' });
    ok(d.codigo === 400 && e.codigo === 200, '  entrada invalida (400) nao conta no intervalo');
    relogio += 15001;
    const f = await pedir2({ barras: '11111111111' });
    relogio += 15001;
    const g = await pedir2({ barras: '33333333333' });
    ok(f.codigo === 500 && /quebrou/.test(f.corpo.erro) && g.codigo === 200, '  excecao vira 500 com o motivo e a trava e solta (a proxima roda)');
    // uma por vez
    let soltar; const preso = new Promise((r) => { soltar = r; });
    const rota3 = criarRotaDaSonda({ obterMl: () => mlReal, agora: () => relogio, sondar: async () => { await preso; return { ok: true }; } });
    const res3 = () => ({ codigo: null, corpo: null, status(cd) { this.codigo = cd; return this; }, json(o) { this.corpo = o; return this; } });
    const x1 = res3(), x2 = res3();
    const p1 = rota3({ query: { barras: BARRAS } }, x1);
    await rota3({ query: { barras: REF } }, x2);
    soltar(); await p1;
    ok(x2.codigo === 429 && /ja ha uma sonda rodando/.test(x2.corpo.erro) && x1.codigo === 200, '⚠️ UMA sonda por vez: a segunda, com a primeira em andamento, leva 429');
    // sem cliente do ML: 503, sem estourar
    const rota4 = criarRotaDaSonda({ obterMl: () => null });
    const x4 = res3(); await rota4({ query: { barras: BARRAS } }, x4);
    ok(x4.codigo === 503, '  sem cliente do ML disponivel: 503 (a rota existe mesmo sem o cliente)');

    // ── Codex #637 (P1): lista/objeto na URL. O Express entrega OBJETO pra ?barras[toString]=x e o String() dele estoura;
    //    fora do try de um handler async, isso e rejeicao sem dono = o Node derruba o processo. Aqui: 400, sem rejeitar.
    relogio += 15001;
    const contado = { n: 0 };
    const rota5 = criarRotaDaSonda({ obterMl: () => mlReal, versao: 'teste', empresa: 'girassol', agora: () => relogio, sondar: async () => { contado.n++; return { ok: true }; } });
    const pedir5 = async (query) => { const res = res3(); let rejeitou = null; try { await rota5({ query }, res); } catch (err) { rejeitou = err; } return { res, rejeitou }; };
    for (const [nome, query] of [
      ['objeto com toString que nao e funcao', { barras: { toString: 'x' } }], ['objeto aninhado no ref', { barras: BARRAS, ref: { a: { b: '1' } } }],
      ['lista', { barras: [BARRAS, REF] }], ['pedido sem toString nem valueOf validos', { barras: BARRAS, pedido: { toString: 'x', valueOf: 'y' } }],
    ]) {
      const x = await pedir5(query);
      ok(!x.rejeitou && x.res.codigo === 400 && x.res.corpo && x.res.corpo.ok === false && /uma lista ou um objeto/.test(x.res.corpo.erro) && x.res.corpo.empresa === 'girassol' && contado.n === 0,
        '⚠️ Codex #637 (P1): ' + nome + ' na URL → 400, a promessa do handler NAO rejeita e a sonda nao roda' + (x.rejeitou ? ' — REJEITOU: ' + x.rejeitou.message : ''));
    }
    const depois = await pedir5({ barras: BARRAS });
    ok(depois.res.codigo === 200 && contado.n === 1, '  a entrada recusada nao arma o intervalo: a sonda valida seguinte roda');
    // a resposta JA SAIU e o envio estourou: responder de novo estouraria fora de qualquer try
    relogio += 15001;
    const resQuebra = { headersSent: false, chamadas: 0, status() { return this; }, json() { this.chamadas++; this.headersSent = true; throw new Error('quebrou ao enviar'); } };
    let rej = null; try { await rota5({ query: { barras: REF } }, resQuebra); } catch (err) { rej = err; }
    ok(rej === null && resQuebra.chamadas === 1, '⚠️ erro DEPOIS de a resposta sair: o handler nao tenta responder de novo e nao rejeita' + (rej ? ' — REJEITOU: ' + rej.message : ''));
    relogio += 15001;
    const livre = await pedir5({ barras: '44444444444' });
    ok(livre.res.codigo === 200, '  e a trava foi solta (a proxima roda)');
    delete require.cache[idAxios];
    for (const m of ['lib/token-leitor.js', 'amb-devolucoes/lib-AMB/ml-AMB.js', 'lib/render-tokens.js', 'lib/ritmo-por-empresa.js']) delete require.cache[abs(m)];
  }

  // ══ 3. HTTP no server.js de verdade (3 empresas) — so as portas; nenhuma chamada ao ML ══
  console.log('\n── 3. a rota no server.js de verdade (3 empresas)');
  const { subir } = require('./_boot-real');
  const EMPRESAS = [{ nome: 'GOOD', rota: '', cookie: 'sessao' }, { nome: 'AMB', rota: '/amb', prefixo: 'AMB_', cookie: 'sessao_amb' }, { nome: 'Girassol', rota: '/girassol', prefixo: 'GIRASSOL_', cookie: 'sessao_girassol' }];
  const env = {
    USERS: 'esto:s1:Esto,dono:s2:Dono', ADMIN_USER: 'dono', GOOD_USERS: 'esto:s1:Esto,dono:s2:Dono', GOOD_ADMIN_USER: 'dono',
    SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789', ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!',
  };
  for (const e of EMPRESAS.slice(1)) { env[e.prefixo + 'USERS'] = 'esto:s1,dono:s2'; env[e.prefixo + 'ADMIN_USER'] = 'dono'; env[e.prefixo + 'SESSION_SECRET'] = 'segredo-da-' + e.nome.toLowerCase() + '-so-pra-teste-0123456789'; }
  const s = await subir({ env, tetoMs: 45000 });
  try {
    ok(s.subiu, '⚠️ o server.js subiu com as 3 empresas' + (!s.subiu ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
    if (!s.subiu) throw new Error('nao subiu');
    const json = (r) => { try { return JSON.parse(r.corpo); } catch (e) { return null; } };
    const login = async (e, u, p) => {
      const r = await s.pedir(e.rota + '/api/auth/login', { metodo: 'POST', corpo: { usuario: u, senha: p } });
      return ((r.headers['set-cookie'] || []).find((x) => x.startsWith(e.cookie + '=')) || '').split(';')[0];
    };
    for (const e of EMPRESAS) {
      const url = e.rota + '/api/debug/etiqueta-volta';
      const esto = await login(e, 'esto', 's1'), dono = await login(e, 'dono', 's2');
      const semSessao = await s.pedir(url + '?barras=abc');
      const comEsto = await s.pedir(url + '?barras=abc', { cookie: esto });
      const comDono = await s.pedir(url + '?barras=4813329795x&ref=' + REF, { cookie: dono });
      const vazio = await s.pedir(url, { cookie: dono });
      ok(esto && dono && semSessao.status >= 400 && semSessao.status < 500 && !/informe|barras e ref/.test(semSessao.corpo), '⚠️ ' + e.nome + ': sem sessao NAO entra (' + semSessao.status + ')');
      ok(comEsto.status >= 400 && comEsto.status < 500 && !/informe|barras e ref/.test(comEsto.corpo), '⚠️ ' + e.nome + ': estoquista NAO entra (' + comEsto.status + ')');
      ok(comDono.status === 400 && (json(comDono) || {}).ok === false && /so digitos/.test((json(comDono) || {}).erro || ''), '⚠️ ' + e.nome + ': admin chega na sonda — numero invalido leva 400 dela (' + comDono.status + ' ' + String(comDono.corpo).slice(0, 90) + ')');
      ok(vazio.status === 400 && /informe \?barras=/.test((json(vazio) || {}).erro || ''), '  ' + e.nome + ': sem numero nenhum, a sonda explica o que mandar');
      // Codex #637 (P1): isto DERRUBAVA o processo (medido: `?barras[toString]=x` como admin → o Node saia com erro)
      const hostis = [];
      for (const qs of ['?barras[toString]=x', '?barras=' + BARRAS + '&ref[a][b]=1', '?barras=' + BARRAS + '&barras=' + REF, '?pedido[valueOf]=1&pedido[toString]=2&barras=' + BARRAS]) {
        hostis.push(await s.pedir(url + qs, { cookie: dono }));
      }
      const vivo = await s.pedir(url, { cookie: dono });
      ok(hostis.every((h) => h.status === 400 && /uma lista ou um objeto/.test((json(h) || {}).erro || '')), '⚠️ Codex #637 (P1) ' + e.nome + ': lista/objeto na URL → 400 da sonda (' + hostis.map((h) => h.status).join(', ') + ')');
      ok(vivo.status === 400 && /informe \?barras=/.test((json(vivo) || {}).erro || ''), '⚠️ ' + e.nome + ': e o servidor continua DE PE depois disso (' + vivo.status + ')');
    }
  } catch (err) {
    falhas++; console.log('FALHA ' + (err && err.stack || err));
  } finally {
    await s.matar();
  }
  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
