'use strict';
/* ============================================================
 * lib/sonda-etiqueta-volta.js  (b786)
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
 * endereco, telefone, documento e apelido do comprador NAO saem (o relatorio e pra colar numa conversa).
 * ⚠️ "NAO SEI" != "NAO EXISTE": cada consulta guarda o HTTP e o erro do ML; consulta que falhou nao vira "sem ligacao".
 * ============================================================ */

const PAUSA_MS = 150;       // entre uma consulta e outra (cota do ML)
const TETO_MS = 45000;      // a sonda inteira; o que nao couber sai como "pulada"

/** so digitos, do tamanho esperado — nada de aproveitar "o que der" de um texto (isto vira caminho de URL) */
function soDigitos(v, min, max) {
  const s = String(v == null ? '' : v).trim();
  return new RegExp('^\\d{' + min + ',' + max + '}$').test(s) ? s : null;
}

const CHAVE_PESSOAL = /name|phone|address|street|zip|email|doc_|document|identif|comment|latitude|longitude|geoloc|nickname|city|state|neighborhood|municipality|country|receiver|buyer|billing|contact/i;
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
    if (String(valor).includes(digitos)) out.push({ caminho, valor: pessoal ? '[omitido]' : cortar(valor, 80) });
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
      if (!Array.isArray(v) && CHAVE_DE_LIGACAO.test(k) && !CHAVE_PESSOAL.test(k)) {
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
  if (lista) out.eventos = lista.slice(0, 30).map((e) => escolher(e, ['status', 'substatus', 'date', 'date_created', 'tracking.checkpoint', 'tracking.description']));
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
      let corpo = ''; try { corpo = JSON.stringify((r && r.error) != null ? r.error : null); } catch (e) { corpo = String(r && r.error); }
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
  if (R) {
    await ver('original_envio_formato_novo', 'ref', '/shipments/' + R, NOVO, resumoEnvio);
    antigo = await ver('original_envio_formato_antigo', 'ref', '/shipments/' + R, null, resumoEnvio);
    await ver('original_historico', 'ref', '/shipments/' + R + '/history', null, resumoHistorico);
    const itens = await ver('original_itens', 'ref', '/shipments/' + R + '/items', null, resumoItens);
    if (!P) P = soDigitos(antigo && antigo.order_id, 12, 20) || soDigitos(Array.isArray(itens) && itens[0] && itens[0].order_id, 12, 20);
  }
  if (P) {
    const ped = await ver('pedido', 'ref', '/orders/' + P, null, resumoPedido);
    // as reclamacoes que o proprio pedido aponta (mediations) e a devolucao de cada uma
    const ids = (Array.isArray(ped && ped.mediations) ? ped.mediations : []).map((m) => soDigitos(m && m.id, 3, 20)).filter(Boolean).slice(0, 3);
    for (const id of ids) {
      await ver('reclamacao_' + id, 'ref', '/post-purchase/v1/claims/' + id, null, resumoReclamacao);
      await ver('devolucao_da_reclamacao_' + id, 'ref', '/post-purchase/v2/claims/' + id + '/returns', null, resumoDevolucao);
    }
    // e a busca de reclamacoes pelo pedido (a busca do ML exige um filtro principal: status)
    // ⚠️ e as devolucoes das reclamacoes que SO a busca achou (o pedido pode nao listar mediations, ou nem ter respondido)
    const achadas = [];
    for (const st of ['opened', 'closed']) {
      const busca = await ver('reclamacoes_do_pedido_' + st, 'ref', '/post-purchase/v1/claims/search?status=' + st + '&resource=order&resource_id=' + P + '&limit=5', null, resumoReclamacoes);
      const lista = Array.isArray(busca && busca.data) ? busca.data : (Array.isArray(busca && busca.results) ? busca.results : []);
      for (const c of lista) { const id = soDigitos(c && c.id, 3, 20); if (id && !ids.includes(id) && !achadas.includes(id)) achadas.push(id); }
    }
    for (const id of achadas.slice(0, 3)) {
      await ver('devolucao_da_reclamacao_' + id, 'ref', '/post-purchase/v2/claims/' + id + '/returns', null, resumoDevolucao);
    }
  }

  // ── 3. as buscas de vendas: por numero, e se da pra LISTAR os nao entregues (base de um indice) ──
  if (conta) {
    const base = '/orders/search?seller=' + conta;
    await ver('vendas_controle_total', 'conta', base + '&limit=1', null, resumoBuscaDePedidos);
    if (B) await ver('vendas_buscando_o_codigo_de_barras', 'conta', base + '&q=' + B + '&limit=5', null, resumoBuscaDePedidos);
    if (R) await ver('vendas_buscando_o_ref_id', 'conta', base + '&q=' + R + '&limit=5', null, resumoBuscaDePedidos);
    await ver('vendas_com_tag_nao_entregue', 'conta', base + '&tags=not_delivered&sort=date_desc&limit=5', null, resumoBuscaDePedidos);
    await ver('vendas_com_envio_nao_entregue', 'conta', base + '&shipping.status=not_delivered&sort=date_desc&limit=5', null, resumoBuscaDePedidos);
    await ver('vendas_canceladas', 'conta', base + '&order.status=cancelled&sort=date_desc&limit=5', null, resumoBuscaDePedidos);
  } else {
    consultas.vendas = { pulada: 'nao consegui o id da conta do vendedor (veja "conta")' };
  }

  // ── 4. a leitura MECANICA do que voltou (sem deducao: so o que os dados mostram) ──
  const barrasRespondeu = Object.keys(consultas).filter((n) => /^volta_/.test(n) && consultas[n].http === 200);
  const onde = (digitos, grupos) => {
    const out = [];
    if (!digitos) return out;
    for (const b of brutos) if (grupos.includes(b.grupo)) for (const a of ondeAparece(b.data, digitos)) out.push(Object.assign({ consulta: b.nome }, a));
    return out.slice(0, 30);
  };
  const total = (n) => (consultas[n] && consultas[n].http === 200 && consultas[n].total != null ? consultas[n].total : null);
  const controle = total('vendas_controle_total');
  // filtro que o ML IGNORA devolve o mesmo total da busca sem filtro — nao e "muitos nao entregues" (licao dos filtros do Bling)
  const filtro = (n) => {
    const c = consultas[n];
    if (!c) return null;
    if (c.http !== 200) return 'nao sei (HTTP ' + (c.http == null ? 'sem resposta' : c.http) + ')';
    if (c.total == null || controle == null) return 'nao sei (sem total)';
    // total igual ao do controle NAO prova filtro ignorado: se TODA venda da conta casa (ou a conta esta vazia, ou o numero
    // achou a unica venda), o filtro funcionou e da o mesmo total. So "diferente" prova que foi respeitado.
    return c.total === controle ? 'INCONCLUSIVO (mesmo total da busca sem filtro: ' + controle + ' — o ML pode ter ignorado o filtro, ou todas as vendas da conta casam)' : 'respeitado (' + c.total + ' de ' + controle + ')';
  };
  const falharam = Object.keys(consultas).filter((n) => { const c = consultas[n]; return c.pulada || c.http == null || c.http === 401 || c.http === 403 || c.http === 429 || c.http >= 500; });
  const voltaSemConclusao = falharam.filter((n) => /^volta_/.test(n));
  const leitura = {
    codigo_de_barras_consultavel: B ? (barrasRespondeu.length ? 'SIM — respondeu em: ' + barrasRespondeu.join(', ')
      : (voltaSemConclusao.length ? 'NAO SEI — sem 200, e estas consultas diretas nao concluiram (401/403/429/5xx/erro/pulada): ' + voltaSemConclusao.join(', ')
        : 'NAO — nenhuma consulta direta do envio de volta respondeu 200')) : null,
    onde_o_codigo_de_barras_aparece: onde(B, ['ref', 'conta']),     // nos dados do envio original, do pedido, das reclamacoes e das buscas
    onde_o_ref_id_aparece_na_volta: onde(R, ['barras']),             // se o envio de volta responder, ele aponta o original?
    busca_de_vendas_pelo_codigo_de_barras: B && consultas.vendas_buscando_o_codigo_de_barras ? filtro('vendas_buscando_o_codigo_de_barras') : null,
    busca_de_vendas_pelo_ref_id: R && consultas.vendas_buscando_o_ref_id ? filtro('vendas_buscando_o_ref_id') : null,
    listar_nao_entregues: { por_tag: filtro('vendas_com_tag_nao_entregue'), por_status_do_envio: filtro('vendas_com_envio_nao_entregue'), cancelados: filtro('vendas_canceladas') },
    consultas_que_nao_responderam: falharam,   // "nao sei" != "nao existe": estas nao provam nada — repita a sonda
  };
  return { ok: true, entrada: { barras: B, ref: R, pedido: P }, leitura, consultas, ms: agora() - t0 };
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
    const q = (req && req.query) || {};
    // ⚠️ `?barras[toString]=x` chega como OBJETO e String() estouraria FORA do try (rejeicao nao tratada derruba o
    // processo no Express 4). So texto (ou ausente) passa, antes de qualquer coisa que possa lancar.
    if ([q.barras, q.ref, q.pedido].some((x) => x != null && typeof x !== 'string')) {
      return res.status(400).json({ ok: false, erro: 'barras, ref e pedido sao um unico numero (so digitos) — nao lista nem objeto' });
    }
    const pergunta = [q.barras, q.ref, q.pedido].map((x) => (x == null ? '' : x).trim()).join('|');
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
    rodando = true;
    try {
      const r = await sondar({
        get: (caminho, headers) => ml.chamarML(caminho, headers ? { headers } : {}),
        vendedor: () => (typeof ml.userId === 'function' ? ml.userId() : null),
        barras: q.barras, ref: q.ref, pedido: q.pedido,
      });
      const resposta = Object.assign({ versao, empresa }, r);
      if (r && r.ok) {   // entrada invalida (400) nao consultou o ML: nao conta no limite nem vai pra memoria
        ultimaEm = agora();
        memoria.set(pergunta, { em: agora(), resposta });
        while (memoria.size > 20) memoria.delete(memoria.keys().next().value);
      }
      return res.status(r && r.ok ? 200 : ((r && r.status) || 500)).json(resposta);
    } catch (e) {
      return res.status(500).json({ ok: false, erro: cortar((e && e.message) || e, 200) });
    } finally { rodando = false; }
  };
}

module.exports = { sondarEtiquetaDeVolta, criarRotaDaSonda, ondeAparece, camposDeLigacao, redigir, soDigitos };
