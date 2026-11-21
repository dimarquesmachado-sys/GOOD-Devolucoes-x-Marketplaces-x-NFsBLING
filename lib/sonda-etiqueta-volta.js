'use strict';
/* ============================================================
 * lib/sonda-etiqueta-volta.js  (b786; b787 e b788: revisao do Codex #637)
 * ------------------------------------------------------------
 * SONDA: O QUE O MERCADO LIVRE EXPOE SOBRE A ETIQUETA DE VOLTA.
 *
 * ⚠️ O CASO (AMB, 21/11/2026 — pedido do dono: "tem certeza que nao deixa consultar? investiga a fundo... senao e
 * problema pra minha triagem"): a caixa de uma venda NAO ENTREGUE volta pro vendedor com uma etiqueta do ML sem
 * cliente nem NF (remetente "MELI #0"). Ela traz DOIS numeros:
 *   - o CODIGO DE BARRAS / QR ({"id":"48133297953","t":"lm"}) = o envio DE VOLTA;
 *   - o "Ref. ID" impresso (48126024340) = o envio ORIGINAL da venda (confirmado pelo dono no app do ML).
 * O bipe le o codigo de barras, e `GET /shipments/48133297953` responde 404. Isso e TUDO o que foi medido: nenhum
 * outro caminho da API foi tentado. Antes de programar a solucao (indice dos nao entregues? leitura do Ref. ID?),
 * esta sonda MEDE, numa chamada, o que o ML responde sobre os dois numeros — em vez de eu deduzir.
 *
 * O que ela faz (so GET, caminhos FIXOS montados com numeros validados — nao e consulta livre ao ML):
 *   1. o envio de volta (barras): os dois formatos do /shipments, historico, itens, pedidos, e a busca de vendas por
 *      esse numero;
 *   2. o envio original (ref): os dois formatos (o ANTIGO traz `return_details`, `sibling`, `return_tracking_number`,
 *      que o formato novo — o unico que o sistema le hoje — nao traz), historico, itens, o pedido, e as reclamacoes
 *      e devolucoes ligadas a ele;
 *   3. se da pra LISTAR os nao entregues da conta (base de um indice volta → venda);
 *   4. ONDE o numero do codigo de barras aparece em tudo o que voltou (o caminho do campo) — e a resposta de
 *      "o ML liga os dois numeros? em que campo?".
 *
 * ⚠️ SEM DADO PESSOAL NO RELATORIO: so nomes de campo, status, datas, ids e o que tem a ver com devolucao. Nome,
 * endereco, telefone, documento e apelido do comprador NAO saem (o relatorio e pra colar numa conversa). A regra vale
 * pelo CAMINHO, nao so pelo nome do campo: nada de dentro de um bloco pessoal (endereco, destinatario, comprador) e
 * examinado ou copiado, texto livre nao e copiado, e de um texto com o numero sai so o pedaco do numero (Codex #637).
 * ⚠️ "NAO SEI" != "NAO EXISTE": cada consulta guarda o HTTP e o erro do ML, e so 2xx e 404 sao conclusivos. Negada
 * (401/403), limite (429), erro (5xx/rede), recusada (400...) e pulada vao pra `consultas_sem_conclusao` — e, havendo
 * uma delas no caminho, a leitura diz "NAO SEI" em vez de "NAO" (Codex #637).
 * ============================================================ */

const PAUSA_MS = 150;       // entre uma consulta e outra (cota do ML)
const TETO_MS = 45000;      // a sonda inteira; o que nao couber sai como "pulada"
const LIMITE_RECLAMACOES = 3;   // reclamacoes seguidas por rodada (cada uma custa ate 2 consultas)

/** so digitos, do tamanho esperado — nada de aproveitar "o que der" de um texto (isto vira caminho de URL).
 *  ⚠️ Codex #637 (P1): so TEXTO ou NUMERO entram. O Express 4 entrega um OBJETO pra `?barras[toString]=x` (o qs dele roda
 *  com allowPrototypes), e `String(objeto)` com um toString que nao e funcao ESTOURA. Lista e objeto nao sao "um
 *  numero": saem recusados SEM passar por String(). */
function soDigitos(v, min, max) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return new RegExp('^\\d{' + min + ',' + max + '}$').test(s) ? s : null;
}

/**
 * O que a resposta de UMA consulta permite concluir. So duas respostas sao conclusivas: 2xx (respondeu) e 404 (o ML
 * disse que aquilo nao existe pra esta conta). ⚠️ Codex #637: 401/403 (token ou permissao), 429/5xx/rede, as recusas
 * (400...) e o que foi pulado NAO provam ausencia — sao "nao sei", e a leitura nao pode virar "NAO" em cima delas.
 */
function desfecho(c) {
  if (!c) return null;
  if (c.pulada) return { conclusivo: false, motivo: 'pulada: ' + c.pulada };
  if (c.http == null) return { conclusivo: false, motivo: 'sem resposta' + (c.erro ? ' (' + cortar(c.erro, 80) + ')' : '') };
  if (c.http >= 200 && c.http < 300) return { conclusivo: true, respondeu: true };
  if (c.http === 404) return { conclusivo: true, nao_existe: true };
  if (c.http === 401 || c.http === 403) return { conclusivo: false, motivo: 'HTTP ' + c.http + ' (acesso negado: token ou permissao)' };
  if (c.http === 429) return { conclusivo: false, motivo: 'HTTP 429 (limite de consultas)' };
  if (c.http >= 500) return { conclusivo: false, motivo: 'HTTP ' + c.http + ' (erro do ML)' };
  return { conclusivo: false, motivo: 'HTTP ' + c.http + ' (o ML recusou este pedido)' };
}

// `reference`/`references` SOZINHOS sao o ponto de referencia do endereco ("casa ao lado da farmacia") — dado do cliente.
// (`external_reference`, `reference_id`... continuam sendo campo de ligacao.)
const CHAVE_PESSOAL = /name|phone|address|street|zip|email|doc_|document|identif|comment|latitude|longitude|geoloc|nickname|city|state|neighborhood|municipality|country|receiver|buyer|billing|contact|^references?$|apartment|floor|intersection|landmark|complement/i;
const CHAVE_DE_LIGACAO = /return|revers|sibling|related|parent|child|reference|claim|mediation|original/i;
const cortar = (t, n) => { const s = String(t == null ? '' : t); return s.length > n ? s.slice(0, n) + '…' : s; };

/** copia sem dado pessoal: valor de chave com cara de dado do cliente vira '[omitido]' */
function redigir(v, prof = 0) {
  if (v == null || prof > 6) return v == null ? v : '[…]';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redigir(x, prof + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).slice(0, 60)) o[k] = (CHAVE_PESSOAL.test(k) && v[k] != null) ? '[omitido]' : redigir(v[k], prof + 1);
    return o;
  }
  return typeof v === 'string' ? cortar(v, 120) : v;
}

/** percorre o JSON chamando visita(caminho, chave, valor, temChavePessoalNoCaminho) em cada no */
function percorrer(v, visita, caminho = '', chave = '', pessoal = false, prof = 0) {
  if (prof > 9) return;
  if (Array.isArray(v)) { v.slice(0, 60).forEach((x, i) => { visita(caminho + '[' + i + ']', chave, x, pessoal); percorrer(x, visita, caminho + '[' + i + ']', chave, pessoal, prof + 1); }); return; }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v).slice(0, 120)) {
      const c = caminho ? caminho + '.' + k : k;
      const p = pessoal || CHAVE_PESSOAL.test(k);
      visita(c, k, v[k], p);
      percorrer(v[k], visita, c, k, p, prof + 1);
    }
  }
}

/** em que campos o numero aparece (igual ou DENTRO de um texto, ex.: rastreio "MEL48133297953XYZ") */
function ondeAparece(json, digitos) {
  const out = [];
  if (!digitos) return out;
  percorrer(json, (caminho, _k, valor, pessoal) => {
    if (out.length >= 20 || valor == null || typeof valor === 'object') return;
    if (!String(valor).includes(digitos)) return;
    // so o PEDACO (sem espacos) em que o numero esta — "MEL48133297953FMXDR01". Num texto livre ("pacote 4813... recebido
    // por Fulano") o que esta em volta do numero pode ser dado do cliente, e nao serve pra nada aqui.
    const pedaco = String(valor).split(/\s+/).find((t) => t.includes(digitos)) || digitos;
    out.push({ caminho, valor: pessoal ? '[omitido]' : cortar(pedaco, 80) });
  });
  return out;
}

/** os campos com nome de devolucao/ligacao: os preenchidos (com o valor) e os que EXISTEM mas vieram vazios */
function camposDeLigacao(json) {
  const preenchidos = [], vazios = [];
  const descer = (v, caminho, prof) => {
    if (prof > 8 || v == null || typeof v !== 'object') return;
    const pares = Array.isArray(v) ? v.slice(0, 30).map((x, i) => ['[' + i + ']', x]) : Object.keys(v).slice(0, 120).map((k) => [k, v[k]]);
    for (const [k, val] of pares) {
      const c = Array.isArray(v) ? caminho + k : (caminho ? caminho + '.' + k : k);
      // ⚠️ Codex #637: chave pessoal NAO e examinada nem por dentro. Antes so a propria chave era conferida, e a descida
      // continuava: `receiver_address.reference` ("casa de Fulano ao lado da farmacia") tem nome de campo de ligacao e
      // saia inteiro no relatorio. Nada dentro de endereco/comprador/destinatario e ligacao entre envios.
      if (!Array.isArray(v) && CHAVE_PESSOAL.test(k)) continue;
      if (!Array.isArray(v) && CHAVE_DE_LIGACAO.test(k)) {
        const vazio = val == null || val === '' || (Array.isArray(val) && !val.length)
          || (typeof val === 'object' && !Array.isArray(val) && Object.values(val).every((x) => x == null || x === ''));
        if (vazio) { if (vazios.length < 30) vazios.push(c); } else if (preenchidos.length < 30) {
          preenchidos.push({ caminho: c, valor: typeof val === 'object' ? cortar(JSON.stringify(redigir(val)), 400) : cortar(val, 120) });
        }
        continue;   // o campo inteiro ja saiu: nao desce nele (evita repetir cada subcampo)
      }
      descer(val, c, prof + 1);
    }
  };
  descer(json, '', 0);
  return { preenchidos, vazios };
}

const pegar = (o, caminho) => caminho.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function escolher(o, caminhos) {
  const out = {};
  for (const c of caminhos) { const v = pegar(o, c); if (v !== undefined) out[c] = redigir(v); }
  return out;
}

/* ── o resumo de cada tipo de resposta (so o que interessa; nada do comprador) ── */
const resumoEnvio = (d) => Object.assign({ chaves: Object.keys(d || {}).sort() },
  escolher(d, ['id', 'status', 'substatus', 'type', 'mode', 'logistic_type', 'logistic', 'order_id', 'tracking_number', 'tracking_method',
    'date_created', 'last_updated', 'tags', 'external_reference', 'origin.type', 'destination.type', 'sender_id', 'status_history', 'substatus_history']),
  { ligacao: camposDeLigacao(d) });
function resumoHistorico(d) {
  const lista = Array.isArray(d) ? d : (Array.isArray(d && d.history) ? d.history : null);
  const out = { chaves: Array.isArray(d) ? ['(lista de ' + d.length + ')'] : Object.keys(d || {}).sort(), ligacao: camposDeLigacao(d) };
  // sem `tracking.description`: e texto livre da transportadora ("entregue a Fulano") — o numero, se estiver la, o
  // `ondeAparece` acha e mostra so o pedaco dele
  if (lista) out.eventos = lista.slice(0, 30).map((e) => escolher(e, ['status', 'substatus', 'date', 'date_created', 'tracking.checkpoint']));
  if (d && d.date_history) out.date_history = redigir(d.date_history);
  return out;
}
function resumoItens(d) {
  const lista = Array.isArray(d) ? d : [];
  return { quantos: lista.length, itens: lista.slice(0, 5).map((i) => escolher(i, ['order_id', 'item_id', 'quantity', 'description'])) };
}
const resumoPedido = (d) => Object.assign({ chaves: Object.keys(d || {}).sort() },
  escolher(d, ['id', 'status', 'status_detail', 'tags', 'cancel_detail', 'shipping.id', 'pack_id', 'date_created', 'date_closed', 'last_updated']),
  { mediations: (Array.isArray(d && d.mediations) ? d.mediations : []).map((m) => escolher(m, ['id', 'status', 'type', 'stage'])), ligacao: camposDeLigacao(d) });
function resumoBuscaDePedidos(d) {
  const r = Array.isArray(d && d.results) ? d.results : [];
  return { total: (d && d.paging && d.paging.total != null) ? d.paging.total : null,
    pedidos: r.slice(0, 5).map((o) => escolher(o, ['id', 'status', 'tags', 'shipping.id', 'date_created'])) };
}
function resumoReclamacoes(d) {
  const r = Array.isArray(d && d.data) ? d.data : (Array.isArray(d && d.results) ? d.results : []);
  return { total: (d && d.paging && d.paging.total != null) ? d.paging.total : r.length,
    reclamacoes: r.slice(0, 5).map((c) => escolher(c, ['id', 'type', 'stage', 'status', 'resource', 'resource_id', 'reason_id', 'date_created'])) };
}
const resumoReclamacao = (d) => Object.assign({ chaves: Object.keys(d || {}).sort() },
  escolher(d, ['id', 'type', 'stage', 'status', 'resource', 'resource_id', 'reason_id', 'date_created', 'last_updated']));
const resumoDevolucao = (d) => Object.assign({ chaves: Object.keys(d || {}).sort() },
  escolher(d, ['id', 'status', 'subtype', 'status_money', 'resource_type', 'resource_id', 'date_created', 'last_updated']),
  { envios: (Array.isArray(d && d.shipments) ? d.shipments : []).slice(0, 6).map((s) => escolher(s, ['shipment_id', 'id', 'tracking_number', 'status', 'type', 'destination.name'])) });

/**
 * Roda a sonda.
 * @param {object} p
 * @param {(caminho: string, headers?: object) => Promise<{ok:boolean,status?:number,data?:*,error?:*}>} p.get  GET no ML (o chamarML da casa)
 * @param {() => (string|null|Promise<string|null>)} [p.vendedor]  id da conta do vendedor, quando o cliente ja sabe
 * @param {*} [p.barras]  o codigo de barras / QR da etiqueta (o envio DE VOLTA)
 * @param {*} [p.ref]     o "Ref. ID" impresso (o envio ORIGINAL)
 * @param {*} [p.pedido]  o numero da venda, se ja for conhecido (senao sai do envio original)
 */
async function sondarEtiquetaDeVolta({ get, vendedor, barras, ref, pedido, pausaMs = PAUSA_MS, tetoMs = TETO_MS, agora = Date.now }) {
  const B = barras == null || barras === '' ? null : soDigitos(barras, 9, 13);
  const R = ref == null || ref === '' ? null : soDigitos(ref, 9, 13);
  let P = pedido == null || pedido === '' ? null : soDigitos(pedido, 12, 20);
  if ((barras != null && barras !== '' && !B) || (ref != null && ref !== '' && !R) || (pedido != null && pedido !== '' && !P)) {
    return { ok: false, status: 400, erro: 'barras e ref sao o numero do envio (so digitos, 9 a 13); pedido e o numero da venda (so digitos)' };
  }
  if (!B && !R) return { ok: false, status: 400, erro: 'informe ?barras= (o codigo de barras da etiqueta) e/ou ?ref= (o Ref. ID impresso nela)' };
  if (B && R && B === R) return { ok: false, status: 400, erro: 'barras e ref sao o MESMO numero — a etiqueta de volta traz dois numeros diferentes' };

  const t0 = agora();
  const consultas = {};
  const brutos = [];   // { nome, grupo: 'barras'|'ref'|'conta', data } — pra procurar onde os numeros aparecem
  const NOVO = { 'x-format-new': 'true' };
  const pausa = () => (pausaMs > 0 ? new Promise((ok) => setTimeout(ok, pausaMs)) : Promise.resolve());

  async function ver(nome, grupo, caminho, headers, resumir, extra) {
    if (agora() - t0 > tetoMs) { consultas[nome] = Object.assign({ caminho, pulada: 'passou do teto de tempo da sonda' }, extra || {}); return null; }
    let r;
    try { r = await get(caminho, headers); } catch (e) {
      consultas[nome] = Object.assign({ caminho, http: null, erro: cortar((e && e.message) || e, 200) }, extra || {});
      await pausa();
      return null;
    }
    const reg = Object.assign({ caminho, formato: headers ? 'novo' : undefined, http: (r && r.status != null) ? r.status : ((r && r.ok) ? 200 : null) }, extra || {});
    if (r && r.ok) {
      try { Object.assign(reg, resumir ? resumir(r.data) : {}); } catch (e) { reg.erro_resumo = cortar((e && e.message) || e, 120); }
      brutos.push({ nome, grupo, data: r.data });
    } else {
      // o corpo do erro tambem passa pelo redator: nada garante que ele so traga `message`/`status`
      let corpo = ''; try { corpo = JSON.stringify(redigir((r && r.error) != null ? r.error : null)); } catch (e) { corpo = '(erro sem corpo legivel)'; }
      reg.erro_ml = cortar(corpo, 300);
    }
    consultas[nome] = reg;
    await pausa();
    return (r && r.ok) ? r.data : null;
  }

  // ── a conta (pras buscas de vendas) ──
  let conta = null;
  try { conta = vendedor ? soDigitos(await vendedor(), 3, 20) : null; } catch (e) { conta = null; }
  if (!conta) {
    const eu = await ver('conta', 'conta', '/users/me', null, (d) => ({ id: d && d.id ? String(d.id) : null }));
    conta = eu && eu.id ? soDigitos(eu.id, 3, 20) : null;
  }

  // ── 1. o envio DE VOLTA (o codigo de barras) ──
  if (B) {
    await ver('volta_envio_formato_novo', 'barras', '/shipments/' + B, NOVO, resumoEnvio);
    await ver('volta_envio_formato_antigo', 'barras', '/shipments/' + B, null, resumoEnvio);
    await ver('volta_historico', 'barras', '/shipments/' + B + '/history', null, resumoHistorico);
    await ver('volta_itens', 'barras', '/shipments/' + B + '/items', null, resumoItens);
    await ver('volta_pedidos_do_envio', 'barras', '/shipments/' + B + '/orders', null, (d) => ({ chaves: Object.keys(d || {}).sort(), ligacao: camposDeLigacao(d) }),
      { sem_documentacao: true });
  }

  // ── 2. o envio ORIGINAL (o Ref. ID) ──
  let antigo = null;
  let pedidoVeioDe = P ? 'entrada' : null;
  if (R) {
    await ver('original_envio_formato_novo', 'ref', '/shipments/' + R, NOVO, resumoEnvio);
    antigo = await ver('original_envio_formato_antigo', 'ref', '/shipments/' + R, null, resumoEnvio);
    await ver('original_historico', 'ref', '/shipments/' + R + '/history', null, resumoHistorico);
    const itens = await ver('original_itens', 'ref', '/shipments/' + R + '/items', null, resumoItens);
    if (!P) {
      P = soDigitos(antigo && antigo.order_id, 12, 20) || soDigitos(Array.isArray(itens) && itens[0] && itens[0].order_id, 12, 20);
      if (P) pedidoVeioDe = 'envio original';
    }
  }

  // O pedido, as reclamacoes dele e a devolucao de cada uma. E funcao porque o numero da venda pode so aparecer DEPOIS,
  // na busca de vendas pelo Ref. ID (passo 3).
  let pedidoSeguido = false;
  async function seguirPedido() {
    pedidoSeguido = true;
    const ped = await ver('pedido', 'ref', '/orders/' + P, null, resumoPedido);
    // as reclamacoes que o proprio pedido aponta (mediations)...
    const doPedido = (Array.isArray(ped && ped.mediations) ? ped.mediations : []).map((m) => soDigitos(m && m.id, 3, 20)).filter(Boolean);
    // ...e a busca de reclamacoes pelo pedido (a busca do ML exige um filtro principal: status).
    // ⚠️ Codex #637: a busca pode achar reclamacao que o pedido NAO listou (ou o pedido nem respondeu), e a ligacao com
    // o codigo de barras mora na DEVOLUCAO dela. Os ids achados aqui tambem sao seguidos — validados e sem repetir.
    const daBusca = [];
    for (const st of ['opened', 'closed']) {
      const d = await ver('reclamacoes_do_pedido_' + st, 'ref', '/post-purchase/v1/claims/search?status=' + st + '&resource=order&resource_id=' + P + '&limit=5', null, resumoReclamacoes);
      const lista = Array.isArray(d && d.data) ? d.data : (Array.isArray(d && d.results) ? d.results : []);
      for (const c of lista) { const id = soDigitos(c && c.id, 3, 20); if (id) daBusca.push(id); }
    }
    const todas = [...new Set(doPedido.concat(daBusca))];
    for (const id of todas.slice(0, LIMITE_RECLAMACOES)) {
      // a que veio da busca ja esta inteira na resposta da busca: dela so falta a devolucao
      if (doPedido.includes(id)) await ver('reclamacao_' + id, 'ref', '/post-purchase/v1/claims/' + id, null, resumoReclamacao);
      await ver('devolucao_da_reclamacao_' + id, 'ref', '/post-purchase/v2/claims/' + id + '/returns', null, resumoDevolucao);
    }
    if (todas.length > LIMITE_RECLAMACOES) {   // o que ficou de fora NAO some: entra como "sem conclusao"
      consultas.reclamacoes_alem_do_limite = { pulada: 'a sonda segue ' + LIMITE_RECLAMACOES + ' reclamacoes por rodada; estas ficaram de fora', ids: todas.slice(LIMITE_RECLAMACOES, LIMITE_RECLAMACOES + 20) };
    }
  }
  if (P) await seguirPedido();

  // ── 3. as buscas de vendas: por numero, e se da pra LISTAR os nao entregues (base de um indice) ──
  // Todas com a MESMA ordem e o MESMO limite da busca de controle (sem filtro): da pra comparar o total E os resultados.
  if (conta) {
    const base = '/orders/search?seller=' + conta;
    const cauda = '&sort=date_desc&limit=5';
    await ver('vendas_controle', 'conta', base + cauda, null, resumoBuscaDePedidos);
    if (B) await ver('vendas_buscando_o_codigo_de_barras', 'conta', base + '&q=' + B + cauda, null, resumoBuscaDePedidos);
    const doRef = R ? await ver('vendas_buscando_o_ref_id', 'conta', base + '&q=' + R + cauda, null, resumoBuscaDePedidos) : null;
    await ver('vendas_com_tag_nao_entregue', 'conta', base + '&tags=not_delivered' + cauda, null, resumoBuscaDePedidos);
    await ver('vendas_com_envio_nao_entregue', 'conta', base + '&shipping.status=not_delivered' + cauda, null, resumoBuscaDePedidos);
    await ver('vendas_canceladas', 'conta', base + '&order.status=cancelled' + cauda, null, resumoBuscaDePedidos);
    // o envio original nao deu o numero da venda, mas a busca pelo Ref. ID achou a venda DESSE envio: segue ela
    if (!P && R) {
      const achada = (Array.isArray(doRef && doRef.results) ? doRef.results : []).find((o) => soDigitos(o && o.shipping && o.shipping.id, 9, 13) === R);
      P = soDigitos(achada && achada.id, 12, 20);
      if (P) pedidoVeioDe = 'busca de vendas pelo Ref. ID';
    }
  } else {
    consultas.vendas = { pulada: 'nao consegui o id da conta do vendedor (veja "conta")' };
  }
  if (P && !pedidoSeguido) await seguirPedido();
  if (R && !pedidoSeguido) {   // o lado da venda ficou sem exame: isso tem que aparecer, senao "nao achei ligacao" pareceria conclusivo
    consultas.pedido = { pulada: 'nao descobri o numero da venda (o envio original nao trouxe order_id e a busca pelo Ref. ID nao achou) — repita com ?pedido=' };
  }

  // ── 4. a leitura MECANICA do que voltou (sem deducao: so o que os dados mostram) ──
  const nomes = Object.keys(consultas);
  // "nao sei" != "nao existe": estas NAO provam nada (negada, limite, erro, recusada, pulada) — repita a sonda
  const semConclusao = nomes.map((n) => ({ consulta: n, d: desfecho(consultas[n]) })).filter((x) => x.d && !x.d.conclusivo).map((x) => ({ consulta: x.consulta, motivo: x.d.motivo }));
  const onde = (digitos, grupos) => {
    const out = [];
    if (!digitos) return out;
    for (const b of brutos) if (grupos.includes(b.grupo)) for (const a of ondeAparece(b.data, digitos)) out.push(Object.assign({ consulta: b.nome }, a));
    return out.slice(0, 30);
  };

  // o codigo de barras e consultavel direto? SIM se algo respondeu; NAO so se TUDO respondeu 404; senao, nao sei
  const daVolta = nomes.filter((n) => /^volta_/.test(n));
  const voltaRespondeu = daVolta.filter((n) => desfecho(consultas[n]).respondeu);
  const voltaSemConclusao = semConclusao.filter((x) => /^volta_/.test(x.consulta));
  let consultavel = null;
  if (B) {
    if (voltaRespondeu.length) consultavel = 'SIM — respondeu em: ' + voltaRespondeu.join(', ');
    else if (voltaSemConclusao.length) {
      consultavel = 'NAO SEI — nenhuma consulta do envio de volta respondeu 200, e ' + voltaSemConclusao.length + ' de ' + daVolta.length
        + ' ficaram sem conclusao (ex.: ' + voltaSemConclusao[0].consulta + ': ' + voltaSemConclusao[0].motivo + ')';
    } else consultavel = 'NAO — o ML respondeu 404 (nao existe pra esta conta) nas ' + daVolta.length + ' consultas diretas do envio de volta';
  }

  // o ML liga o codigo de barras a venda? (o numero aparece no que ele respondeu sobre o envio original/pedido/devolucoes/buscas)
  const aparece = onde(B, ['ref', 'conta']);
  const ladoDaVendaSemConclusao = semConclusao.filter((x) => !/^volta_/.test(x.consulta));
  let liga = null;
  if (B) {
    if (aparece.length) liga = 'SIM — o numero do codigo de barras aparece em ' + aparece.length + ' campo(s) do que o ML respondeu sobre a venda (veja onde_o_codigo_de_barras_aparece)';
    else if (!R && !P) liga = 'NAO SEI — so com o codigo de barras nao ha o que examinar do lado da venda: repita com ?ref= (o Ref. ID)';
    else if (ladoDaVendaSemConclusao.length) liga = 'NAO SEI — nao aparece no que respondeu, mas ' + ladoDaVendaSemConclusao.length + ' consulta(s) do lado da venda ficaram sem conclusao (veja consultas_sem_conclusao)';
    else liga = 'NAO APARECE — o envio original, o pedido, as reclamacoes/devolucoes e as buscas responderam, e o numero nao esta em nenhum campo';
  }

  const total = (n) => { const c = consultas[n]; const d = desfecho(c); return (d && d.respondeu && c.total != null) ? c.total : null; };
  const controle = total('vendas_controle');
  const resultadosDe = (n) => { const b = brutos.find((x) => x.nome === n); return (b && b.data && Array.isArray(b.data.results)) ? b.data.results : []; };
  const idsDe = (n) => resultadosDe(n).map((v) => soDigitos(v && v.id, 1, 30) || '?').join(',');
  /**
   * O filtro (ou a busca por numero) mexeu no resultado?
   * ⚠️ Codex #637: total IGUAL ao da busca sem filtro, sozinho, NAO prova que o ML ignorou o filtro — todas as vendas da
   * conta podem casar com ele (conta com uma venda so, conta vazia). "IGNORADO" so sai com PROVA: resultado devolvido
   * que nao casa com o filtro. `confere(venda)` diz se a venda casa (true/false), ou null quando a resposta da busca
   * nao traz o campo pra conferir. Sem prova, e INCONCLUSIVO — com os fatos que ha.
   */
  const filtro = (n, confere) => {
    const c = consultas[n];
    if (!c) return null;
    const d = desfecho(c);
    if (!d.respondeu) return 'nao sei (' + (d.motivo || 'HTTP ' + c.http) + ')';
    if (c.total == null) return 'nao sei (a resposta veio sem o total)';
    if (controle == null) return 'nao sei (total ' + c.total + ', mas a busca de controle, sem filtro, nao respondeu: nao ha com o que comparar)';
    if (c.total !== controle) return 'respeitado (' + c.total + ' de ' + controle + ')';
    const res = resultadosDe(n);
    const notas = res.map((v) => (confere ? confere(v) : null));
    const naoCasam = notas.filter((x) => x === false).length;
    const casam = notas.filter((x) => x === true).length;
    if (naoCasam) return 'IGNORADO pelo ML (mesmo total da busca sem filtro: ' + controle + ' — e ' + naoCasam + ' de ' + res.length + ' resultados NAO casam com o filtro)';
    const fato = !res.length ? 'nenhum resultado pra conferir'
      : (casam === res.length ? 'os ' + res.length + ' resultados conferidos casam com o filtro'
        : (idsDe(n) === idsDe('vendas_controle') ? 'os resultados sao os MESMOS da busca sem filtro' : 'os resultados sao DIFERENTES dos da busca sem filtro'));
    return 'INCONCLUSIVO (mesmo total da busca sem filtro: ' + controle + '; ' + fato + ') — total igual, sozinho, nao prova que o filtro foi ignorado';
  };
  const leitura = {
    codigo_de_barras_consultavel: consultavel,
    o_ml_liga_o_codigo_de_barras_a_venda: liga,
    onde_o_codigo_de_barras_aparece: aparece,                        // nos dados do envio original, do pedido, das reclamacoes e das buscas
    onde_o_ref_id_aparece_na_volta: onde(R, ['barras']),             // se o envio de volta responder, ele aponta o original?
    busca_de_vendas_pelo_codigo_de_barras: B && consultas.vendas_buscando_o_codigo_de_barras ? filtro('vendas_buscando_o_codigo_de_barras') : null,
    busca_de_vendas_pelo_ref_id: R && consultas.vendas_buscando_o_ref_id ? filtro('vendas_buscando_o_ref_id') : null,
    listar_nao_entregues: {
      por_tag: filtro('vendas_com_tag_nao_entregue', (v) => (Array.isArray(v && v.tags) ? v.tags.includes('not_delivered') : null)),
      por_status_do_envio: filtro('vendas_com_envio_nao_entregue'),   // a busca de vendas nao devolve o status do envio: nao ha como conferir
      cancelados: filtro('vendas_canceladas', (v) => (v && typeof v.status === 'string' ? v.status === 'cancelled' : null)),
    },
    consultas_sem_conclusao: semConclusao,
  };
  return { ok: true, entrada: { barras: B, ref: R, pedido: P, pedido_veio_de: pedidoVeioDe }, leitura, consultas, ms: agora() - t0 };
}

/**
 * A ROTA da sonda (uma instancia por empresa). Ela aceita a SESSAO do admin — e pra abrir do celular, sem chave — e
 * cada rodada faz ~25 consultas ao ML com o token da empresa. Entao: UMA sonda por vez, no maximo uma a cada 15 s, e a
 * mesma pergunta repetida em 2 min sai da memoria. Um link de fora (o cookie e SameSite=Lax) nao vira metralhadora de
 * consultas, e recarregar a pagina nao gasta a cota de novo.
 *
 * `obterMl` devolve o cliente do ML DA EMPRESA (a instancia de lib-AMB/ml-AMB.js — a GOOD usa a mesma fabrica, por
 * lib/ml.js `.instancia`): `chamarML(caminho, { headers })` e `userId()`. E funcao (e nao o objeto) pra ser lida na
 * hora do pedido: registrar a rota nao pode depender de o cliente ja existir.
 */
function criarRotaDaSonda({ obterMl, versao, empresa, agora = Date.now, intervaloMs = 15000, memoriaMs = 120000, sondar = sondarEtiquetaDeVolta }) {
  let rodando = false;
  let ultimaEm = 0;
  const memoria = new Map();   // pergunta -> { em, resposta }
  return async function rotaDaSondaEtiquetaDeVolta(req, res) {
    // ⚠️ Codex #637 (P1): TUDO dentro do try. Este handler e async e o Express 4 nao olha a promessa que ele devolve:
    // um erro fora do try vira rejeicao sem dono e o Node DERRUBA o processo. Foi o que `?barras[toString]=x` fazia —
    // o Express entrega um objeto, e o String() dele estoura. Por isso a entrada so e aceita como TEXTO, sem converter.
    let peguei = false;   // so a chamada que ligou a trava a solta
    try {
      const q = (req && req.query) || {};
      const campo = (x) => (x == null ? '' : (typeof x === 'string' ? x.trim() : null));
      const partes = [campo(q.barras), campo(q.ref), campo(q.pedido)];
      if (partes.includes(null)) {
        return res.status(400).json({ versao, empresa, ok: false, status: 400, erro: 'barras, ref e pedido sao UM numero cada — veio uma lista ou um objeto na URL' });
      }
      const pergunta = partes.join('|');
      const m = memoria.get(pergunta);
      if (m && agora() - m.em < memoriaMs) {
        return res.status(200).json(Object.assign({}, m.resposta, { da_memoria: true, idade_s: Math.round((agora() - m.em) / 1000) }));
      }
      if (rodando) return res.status(429).json({ ok: false, erro: 'ja ha uma sonda rodando nesta empresa — espere terminar (leva uns 10 a 20 s) e recarregue' });
      const falta = intervaloMs - (agora() - ultimaEm);
      if (ultimaEm && falta > 0) {
        return res.status(429).json({ ok: false, erro: 'aguarde ' + Math.ceil(falta / 1000) + ' s pra rodar outra sonda (limite pra nao gastar a cota do ML)' });
      }
      let ml = null;
      try { ml = typeof obterMl === 'function' ? obterMl() : null; } catch (e) { ml = null; }
      if (!ml || typeof ml.chamarML !== 'function') return res.status(503).json({ ok: false, erro: 'o cliente do Mercado Livre desta empresa nao esta disponivel' });
      rodando = true; peguei = true;
      const r = await sondar({
        get: (caminho, headers) => ml.chamarML(caminho, headers ? { headers } : {}),
        vendedor: () => (typeof ml.userId === 'function' ? ml.userId() : null),
        barras: partes[0], ref: partes[1], pedido: partes[2],
      });
      const resposta = Object.assign({ versao, empresa }, r);
      if (r && r.ok) {   // entrada invalida (400) nao consultou o ML: nao conta no limite nem vai pra memoria
        ultimaEm = agora();
        memoria.set(pergunta, { em: agora(), resposta });
        while (memoria.size > 20) memoria.delete(memoria.keys().next().value);
      }
      return res.status(r && r.ok ? 200 : ((r && r.status) || 500)).json(resposta);
    } catch (e) {
      if (res && res.headersSent) return undefined;   // a resposta ja saiu: responder de novo estouraria AQUI, fora de qualquer try
      return res.status(500).json({ ok: false, erro: cortar((e && e.message) || e, 200) });
    } finally { if (peguei) rodando = false; }
  };
}

module.exports = { sondarEtiquetaDeVolta, criarRotaDaSonda, ondeAparece, camposDeLigacao, redigir, soDigitos, desfecho };
