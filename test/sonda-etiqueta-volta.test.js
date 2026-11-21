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
// Roda com: node test/sonda-etiqueta-volta.test.js
const path = require('path');
const { sondarEtiquetaDeVolta, criarRotaDaSonda, ondeAparece, camposDeLigacao, soDigitos } = require('../lib/sonda-etiqueta-volta');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const BARRAS = '48133297953', REF = '48126024340', PEDIDO = '2000018696282248', CONTA = '123456';
// dado pessoal de mentira: NADA disto pode aparecer no relatorio
const PESSOAL = ['Fulano de Tal', 'Rua Secreta 123', '11999990000', '01234000', 'DANDARO4X4', 'comprador@exemplo.com', 'COMPRADORZE', '12345678900'];
const endereco = () => ({ address_line: 'Rua Secreta 123', street_name: 'Rua Secreta', street_number: '123', zip_code: '01234000', city: { name: 'Sao Paulo' }, receiver_name: 'Fulano de Tal', receiver_phone: '11999990000' });

/** um ML de mentira. `opcoes` muda o cenario; devolve { get, chamadas, emVoo } */
function mlFalso(opcoes = {}) {
  const o = Object.assign({ ligacao: true, barrasResponde: false, medHostil: false, estoura: null }, opcoes);
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
    if (caminho === '/shipments/' + BARRAS) {
      if (!o.barrasResponde) return nao(404, { message: 'Shipment not found', error: 'not_found_shipping', status: 404, cause: [] });
      return novo ? sim({ id: Number(BARRAS), status: 'delivered', logistic: { direction: 'return', mode: 'me2', type: 'cross_docking' }, destination: { type: 'selling_address', receiver_name: 'Fulano de Tal', shipping_address: endereco() } })
        : sim({ id: Number(BARRAS), status: 'delivered', type: 'return', order_id: Number(PEDIDO), sibling: { sibling_id: Number(REF), reason: 'not_delivered' }, receiver_address: endereco() });
    }
    if (caminho.startsWith('/shipments/' + BARRAS + '/')) return nao(404, { message: 'Shipment not found', error: 'not_found_shipping', status: 404 });
    // ── o envio original ──
    if (caminho === '/shipments/' + REF) {
      if (novo) return sim({ id: Number(REF), status: 'not_delivered', substatus: 'returned', date_created: '2026-09-29T08:17:00Z', last_updated: '2026-10-01T10:00:00Z', tracking_number: 'MEL' + REF + 'FMXDF01',
        logistic: { direction: 'forward', mode: 'me2', type: 'cross_docking' }, tags: ['test'], external_reference: null,
        origin: { type: 'selling_address', sender_id: Number(CONTA), shipping_address: endereco() },
        destination: { type: 'buying_address', receiver_id: 999, receiver_name: 'Fulano de Tal', receiver_phone: '11999990000', comments: 'deixar com Fulano de Tal', shipping_address: endereco() } });
      return sim({ id: Number(REF), order_id: Number(PEDIDO), status: 'not_delivered', substatus: 'returned', type: 'forward', mode: 'me2', logistic_type: 'cross_docking', tags: [],
        return_details: null,
        return_tracking_number: o.ligacao ? 'MEL' + BARRAS + 'FMXDR01' : null,
        sibling: o.ligacao ? { sibling_id: Number(BARRAS), reason: 'not_delivered', description: null, source: 'logistics', date_created: '2026-10-01T09:00:00Z', last_updated: null }
          : { sibling_id: null, reason: null, description: null, source: null, date_created: null, last_updated: null },
        status_history: { date_shipped: '2026-09-29T12:00:00Z', date_returned: '2026-10-01T10:00:00Z', date_not_delivered: '2026-09-30T18:00:00Z' },
        receiver_address: endereco(), sender_address: endereco(), receiver_id: 999 });
    }
    if (caminho === '/shipments/' + REF + '/history') return sim([{ status: 'shipped', substatus: null, date: '2026-09-29T12:00:00Z' }, { status: 'not_delivered', substatus: 'returning_to_sender', date: '2026-09-30T18:00:00Z' }]);
    if (caminho === '/shipments/' + REF + '/items') return sim([{ order_id: Number(PEDIDO), item_id: 'MLB1', quantity: 1, description: '2 Cavaletes 6t' }]);
    if (caminho === '/orders/' + PEDIDO) return sim({ id: Number(PEDIDO), status: 'cancelled', status_detail: null, tags: ['not_delivered', 'cancelled'], pack_id: null, date_created: '2026-09-29T08:17:00Z',
      cancel_detail: { group: 'shipment', code: 'shipment_not_delivered', description: 'nao entregue', requested_by: 'ml' }, shipping: { id: Number(REF) },
      mediations: o.medHostil ? [{ id: '../../users/me' }, { id: '5001234567?x=1' }] : [{ id: 5001234567, status: 'closed' }],
      buyer: { id: 999, nickname: 'DANDARO4X4', first_name: 'Fulano de Tal', email: 'comprador@exemplo.com', billing_info: { doc_number: '12345678900' } } });
    if (caminho === '/post-purchase/v1/claims/5001234567') return sim({ id: 5001234567, type: 'cancel_purchase', stage: 'claim', status: 'closed', resource: 'order', resource_id: Number(PEDIDO), players: [{ role: 'complainant', user_id: 999 }] });
    if (caminho === '/post-purchase/v2/claims/5001234567/returns') return o.ligacao
      ? sim({ id: 777, status: 'delivered', subtype: 'return_total', status_money: 'refunded', resource_type: 'order', resource_id: Number(PEDIDO), shipments: [{ shipment_id: Number(BARRAS), tracking_number: 'MEL' + BARRAS + 'FMXDR01', status: 'delivered', type: 'return', destination: { name: 'seller_address', shipping_address: endereco() } }] })
      : nao(404, { message: 'return not found' });
    if (caminho.startsWith('/post-purchase/v1/claims/search')) return sim({ paging: { total: 0 }, data: [] });
    // ── as buscas de vendas ──
    if (caminho.startsWith('/orders/search?seller=' + CONTA)) {
      const res = (total, lista) => sim({ paging: { total }, results: lista || [] });
      const venda = { id: Number(PEDIDO), status: 'cancelled', tags: ['not_delivered'], shipping: { id: Number(REF) }, date_created: '2026-09-29T08:17:00Z', buyer: { nickname: 'COMPRADORZE', first_name: 'Fulano de Tal' } };
      if (caminho.includes('&q=' + BARRAS)) return res(0, []);
      if (caminho.includes('&q=' + REF)) return res(1, [venda]);
      if (caminho.includes('&tags=not_delivered')) return res(37, [venda]);
      if (caminho.includes('&shipping.status=not_delivered')) return res(5000, [venda]);   // filtro IGNORADO: mesmo total do controle
      if (caminho.includes('&order.status=cancelled')) return nao(429, { message: 'too many requests' });
      return res(5000, [venda]);   // o controle (sem filtro)
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

  { // cenario A: o ML LIGA os dois numeros (no formato antigo do envio original e na devolucao da reclamacao)
    const ml = mlFalso({ ligacao: true });
    const r = await sondarEtiquetaDeVolta(Object.assign({ get: ml.get, vendedor: () => CONTA, barras: BARRAS, ref: REF }, semPausa));
    const texto = JSON.stringify(r);
    ok(r.ok === true && r.entrada.barras === BARRAS && r.entrada.ref === REF && r.entrada.pedido === PEDIDO, '  rodou; o pedido saiu do envio original (formato antigo: order_id)');
    ok(/^NAO/.test(r.leitura.codigo_de_barras_consultavel), '⚠️ o codigo de barras NAO e consultavel direto (404 nos dois formatos) — ' + r.leitura.codigo_de_barras_consultavel.slice(0, 40));
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
    ok(r.leitura.busca_de_vendas_pelo_ref_id === 'respeitado (1 de 5000)' && r.leitura.busca_de_vendas_pelo_codigo_de_barras === 'respeitado (0 de 5000)',
      '  busca de vendas: acha pelo Ref. ID (1) e nao acha pelo codigo de barras (0)');
    ok(r.leitura.listar_nao_entregues.por_tag === 'respeitado (37 de 5000)', '⚠️ listar os nao entregues por TAG: respeitado (37 de 5000)');
    ok(/^IGNORADO/.test(r.leitura.listar_nao_entregues.por_status_do_envio), '⚠️ filtro que o ML ignora (mesmo total do controle) sai como IGNORADO — nao como "5000 nao entregues"');
    ok(/^nao sei \(HTTP 429\)/.test(r.leitura.listar_nao_entregues.cancelados) && r.leitura.consultas_que_nao_responderam.includes('vendas_canceladas'),
      '⚠️ "nao sei" != "nao existe": consulta com 429 sai como "nao sei" e na lista das que nao responderam');
    ok(PESSOAL.every((p) => !texto.includes(p)), '⚠️ NENHUM dado pessoal do comprador no relatorio (nome, endereco, telefone, CEP, apelido, e-mail, documento)' + (PESSOAL.filter((p) => texto.includes(p)).length ? ' — VAZOU: ' + PESSOAL.filter((p) => texto.includes(p)).join(', ') : ''));
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

  { // so o codigo de barras (sem Ref. ID): roda o que da
    const ml = mlFalso();
    const r = await sondarEtiquetaDeVolta(Object.assign({ get: ml.get, vendedor: () => CONTA, barras: BARRAS }, semPausa));
    ok(r.ok && r.entrada.ref === null && !ml.chamadas.some((c) => c.caminho.includes(REF)) && r.leitura.busca_de_vendas_pelo_ref_id === null, '  so com o codigo de barras: nao inventa consulta do original');
  }

  // entrada invalida: NENHUMA chamada ao ML
  for (const [nome, entrada] of [
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
    ok(r.ok && /socket hang up/.test(r.consultas.original_historico.erro) && r.consultas.pedido.http === 200 && r.leitura.consultas_que_nao_responderam.includes('original_historico'),
      '⚠️ consulta que estoura: fica com o erro, a sonda segue, e entra na lista das que nao responderam');
    let t = 0; const ml2 = mlFalso();
    const r2 = await sondarEtiquetaDeVolta({ get: ml2.get, vendedor: () => CONTA, barras: BARRAS, ref: REF, pausaMs: 0, tetoMs: 5000, agora: () => (t += 1000) });
    const puladas = Object.keys(r2.consultas).filter((n) => r2.consultas[n].pulada);
    ok(r2.ok && puladas.length > 5 && ml2.chamadas.length <= 6 && puladas.every((n) => r2.leitura.consultas_que_nao_responderam.includes(n)),
      '  teto de tempo: o que nao coube sai como "pulada" (' + puladas.length + ') e NAO como "sem ligacao"');
  }

  // as duas buscas no JSON, isoladas
  ok(JSON.stringify(ondeAparece({ a: { b: ['x', 'MEL48133297953Z'] }, receiver_name: 'Sr 48133297953' }, BARRAS)) === JSON.stringify([{ caminho: 'a.b[1]', valor: 'MEL48133297953Z' }, { caminho: 'receiver_name', valor: '[omitido]' }]),
    '  ondeAparece: acha DENTRO de texto e em lista; em campo pessoal diz o caminho mas omite o valor');
  const cl = camposDeLigacao({ return_details: { shipment_id: 9, receiver_name: 'Fulano de Tal' }, claim_id: null, x: { related_ids: [] }, receiver_reference: 'casa' });
  ok(cl.preenchidos.length === 1 && cl.preenchidos[0].caminho === 'return_details' && !/Fulano/.test(cl.preenchidos[0].valor) && cl.vazios.join(',') === 'claim_id,x.related_ids',
    '  camposDeLigacao: valor redigido, vazios listados, campo pessoal fora (' + JSON.stringify(cl) + ')');

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
    }
  } catch (err) {
    falhas++; console.log('FALHA ' + (err && err.stack || err));
  } finally {
    await s.matar();
  }
  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
