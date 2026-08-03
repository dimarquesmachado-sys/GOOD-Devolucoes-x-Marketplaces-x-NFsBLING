// ════════════════════════════════════════════════════════════════════
//  amb-devolucoes · lib/admin-helpers  (AMB Devol. b71)
//  Os dois ajudantes que o modulo de rotas do painel pede e que a AMB
//  nao tinha. Sao os MESMOS da GOOD (lib/ml.js e lib/bling.js),
//  recebendo por injecao o chamarBling/chamarML/sleep da AMB — que
//  ja tem a mesma assinatura e o mesmo retorno {ok, data, status}.
// ════════════════════════════════════════════════════════════════════
'use strict';

module.exports = function criar({ chamarBling, chamarML, buscarNFePorId, sleep }) {

/** A NF que o ML guarda pro envio (invoice_data). */
async function buscarNFnoML(shipmentId) {
  return chamarML(`https://api.mercadolibre.com/shipments/${shipmentId}/invoice_data?siteId=MLB`);
}

async function buscarNFBlindada(opts = {}) {
  // Aceita orderId (string) e/ou orderIds (array) - em vendas de CARRINHO
  // o Bling pode registrar o numeroLoja como o PACK, nao a order.
  const brutos = [];
  if (Array.isArray(opts.orderIds)) {
    for (const v of opts.orderIds) {
      if (v != null && String(v).trim() !== '') brutos.push(String(v).trim());
    }
  }
  if (opts.orderId != null && String(opts.orderId).trim() !== '') {
    brutos.push(String(opts.orderId).trim());
  }
  const orderIds = [...new Set(brutos)];
  const numeroNF = opts.numeroNF != null ? String(opts.numeroNF).trim() : null;
  const serieNF = opts.serieNF != null && String(opts.serieNF).trim() !== '' ? String(opts.serieNF).trim() : null;
  const LIMITE = 100;
  const DELAY_MS = 400;
  const MAXP_JANELA = opts.maxPaginasJanela || 6;
  const tentado = [];
  const trace = []; // raio-x de cada passo (pro debug se explicar sozinho)

  // Janela: 2 dias antes da venda ate N dias depois (NF sai perto da venda)
  let ini = null, fim = null;
  if (opts.dataReferencia) {
    const ref = new Date(opts.dataReferencia);
    if (!isNaN(ref.getTime())) {
      const DIAS_ANTES = 2;
      const DIAS_DEPOIS = opts.janelaDias || 12;
      const f = (d) => d.toISOString().slice(0, 10);
      ini = f(new Date(ref.getTime() - DIAS_ANTES * 864e5));
      fim = f(new Date(ref.getTime() + DIAS_DEPOIS * 864e5));
    }
  }

  const bateOrder = (nf) => orderIds.length > 0 && orderIds.includes(String(nf.numeroPedidoLoja || '').trim());
  const bateNumero = (nf) => {
    if (!numeroNF) return false;
    const a = String(nf.numero || '').trim().replace(/^0+/, '');
    const b = numeroNF.replace(/^0+/, '');
    if (!a || a !== b) return false;
    if (serieNF && nf.serie != null && String(nf.serie).trim() !== serieNF) return false;
    return true;
  };

  async function completar(idNF, via) {
    await sleep(DELAY_MS);
    const rFull = await buscarNFePorId(idNF);
    const nf = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
    return { ok: true, via, nf, idNF: String(idNF), trace };
  }

  // ---- FASE 0: filtro DIRETO numeroLoja no /nfe (1 chamada por id!) ----
  // Descoberta na doc oficial: /nfe aceita ?numeroLoja= - dispensa varredura.
  for (let i = 0; i < orderIds.length; i++) {
    if (i > 0) await sleep(DELAY_MS);
    const oid = orderIds[i];
    const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=1&tipo=1&numeroLoja=${encodeURIComponent(oid)}`;
    const r = await chamarBling(url);
    const lista = (r.ok && r.data?.data) ? r.data.data : [];
    trace.push({ passo: 'nfe-numeroLoja', id: oid, status: r.status || null, qtd: lista.length });
    if (!r.ok) { tentado.push(`nfe-numeroLoja(${oid}): HTTP ${r.status}`); continue; }
    if (lista.length > 0) {
      const m = lista.find(bateOrder) || lista[0];
      console.log(`[Bling/blindada] ACHOU via numeroLoja=${oid}: NF ${m.numero} (id ${m.id})`);
      return completar(m.id, 'nfe-numeroLoja');
    }
    tentado.push(`nfe-numeroLoja(${oid}): 0 NFs`);
  }

  // ---- FASE 1: /nfe com janela de datas ----
  if (ini && fim) {
    console.log(`[Bling/blindada] /nfe janela ${ini}..${fim} ids=${orderIds.join(',') || '-'} numero=${numeroNF || '-'}${serieNF ? '/s' + serieNF : ''}`);
    for (let pg = 1; pg <= MAXP_JANELA; pg++) {
      if (pg > 1) await sleep(DELAY_MS);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=${LIMITE}&pagina=${pg}&tipo=1&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) { trace.push({ passo: 'nfe-janela', pg, status: r.status || null }); tentado.push(`nfe-janela pg${pg}: HTTP ${r.status}`); break; }
      const lista = r.data?.data || [];
      trace.push({ passo: 'nfe-janela', pg, status: 200, qtd: lista.length, primeira: lista[0]?.dataEmissao || null, ultima: lista[lista.length - 1]?.dataEmissao || null });
      if (lista.length === 0) { tentado.push(`nfe-janela: sem NFs na janela (pg${pg})`); break; }
      let m = lista.find(bateOrder);
      if (m) return completar(m.id, 'nfe-janela-orderId');
      m = lista.find(bateNumero);
      if (m) return completar(m.id, 'nfe-janela-numero');
      if (lista.length < LIMITE) { tentado.push(`nfe-janela: ${(pg - 1) * LIMITE + lista.length} NFs sem match`); break; }
      if (pg === MAXP_JANELA) tentado.push(`nfe-janela: ${pg * LIMITE}+ NFs sem match (limite de paginas)`);
    }
  } else {
    tentado.push('nfe-janela: sem data de referencia da venda');
  }

  // ---- FASE 2: /pedidos/vendas com janela -> NF vinculada ----
  if (orderIds.length > 0 && ini && fim) {
    for (let pg = 1; pg <= MAXP_JANELA; pg++) {
      await sleep(DELAY_MS);
      const url = `https://api.bling.com.br/Api/v3/pedidos/vendas?limite=${LIMITE}&pagina=${pg}&dataInicial=${ini}&dataFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) { trace.push({ passo: 'pedidos-janela', pg, status: r.status || null }); tentado.push(`pedidos-janela pg${pg}: HTTP ${r.status}`); break; }
      const lista = r.data?.data || [];
      trace.push({ passo: 'pedidos-janela', pg, status: 200, qtd: lista.length, primeira: lista[0]?.data || null, ultima: lista[lista.length - 1]?.data || null });
      if (lista.length === 0) { tentado.push(`pedidos-janela: vazio (pg${pg})`); break; }
      const m = lista.find(p => orderIds.includes(String(p.numeroLoja || '').trim()));
      if (m) {
        await sleep(DELAY_MS);
        const rPed = await buscarPedidoBlingPorId(m.id);
        const idNF = rPed.ok ? rPed.data?.data?.notaFiscal?.id : null;
        if (idNF) return completar(idNF, 'pedido-janela');
        tentado.push(`pedidos-janela: pedido ${m.id} achado mas SEM NF vinculada`);
        break;
      }
      if (lista.length < LIMITE) { tentado.push('pedidos-janela: pedido nao achado na janela'); break; }
    }
  }

  // ---- FASE 3: fundo (varredura limitada, ultimo recurso) ----
  for (const oid of orderIds) {
    const r = await buscarNFnoBlingPorOrderId(oid, opts.dataReferencia || null, { maxPaginas: opts.maxPaginasFundo || 15 });
    trace.push({ passo: 'nfe-fundo', id: oid, qtd: r.totalScanned || 0, primeira: r.primeiraDataVista || null, ultima: r.ultimaDataVista || null });
    if (r.ok && r.match) return completar(r.match.id, 'nfe-fundo-orderId');
    tentado.push(`nfe-fundo(${oid}): ${r.totalScanned || 0} NFs varridas sem match`);
  }

  console.log('[Bling/blindada] NAO ACHOU:', tentado.join(' | '));
  return { ok: false, tentado, trace };
}


// ── b71: os 2 que a rota identificar da GOOD tambem pede ──

function classificarMotivoDevolucao(order, shipment) {
  if (!order) return null;
  const tags = order.tags || [];
  const cd = order.cancel_detail || {};
  const st = String(shipment?.status || '');
  const sub = String(shipment?.substatus || '');
  const temReclamacao = Array.isArray(order.mediations) && order.mediations.length > 0;
  const fraude = tags.includes('fraud_risk_detected');

  const naoEntregue = cd.code === 'shipment_not_delivered'
    || cd.group === 'shipment'
    || st === 'not_delivered'
    || sub === 'returned'
    || (tags.includes('not_delivered') && !tags.includes('delivered'));

  if (naoEntregue) {
    // v4.16 - se o ML marcou irregularidade E o produto nao foi entregue, foi
    // ELE que bloqueou o envio no meio do caminho. O produto nem chegou perto
    // do cliente - nao faz sentido pedir "cuidado ao conferir".
    return {
      tipo: 'nao_entregue',
      titulo: '🚫 O cliente NUNCA recebeu este produto',
      detalhe: fraude
        ? 'O Mercado Livre bloqueou este envio no meio do caminho por irregularidade na operação. O produto nem chegou ao cliente — deve estar LACRADO e intacto.'
        : 'Voltou sem ser entregue (recusa, endereço não encontrado ou ausente). O produto deve estar LACRADO e intacto — confira e devolva ao estoque.',
      cor: '#1565c0',
      reclamacao_id: null,
      risco_fraude: false,          // nada a alertar: o produto nao circulou
      bloqueado_pelo_ml: fraude,
    };
  }
  if (temReclamacao || cd.group === 'mediations') {
    return {
      tipo: 'reclamacao',
      titulo: '⚠️ O cliente ABRIU RECLAMAÇÃO',
      detalhe: 'Foi entregue e o cliente reclamou. Abra e confira bem o produto antes de decidir.',
      cor: '#e65100',
      reclamacao_id: temReclamacao ? String(order.mediations[0].id) : null,
      risco_fraude: fraude,
    };
  }
  return {
    tipo: 'devolucao_simples',
    titulo: '📦 Devolução sem reclamação registrada',
    detalhe: 'Confira o produto normalmente.',
    cor: '#616161',
    reclamacao_id: null,
    risco_fraude: fraude,
  };
}

async function buscarNFnoBlingPorNumero(numeroNF, dataReferencia, opcoes = {}) {
  const numeroNFStr = String(numeroNF).trim().padStart(6, '0'); // 71932 -> 071932
  const numeroNFLimpo = String(numeroNF).trim().replace(/^0+/, ''); // remove zeros a esquerda
  const MAX_PAGINAS = opcoes.maxPaginas || 50;
  const LIMITE_PAGINA = 100;
  const DELAY_MS = 400;
  const DIAS_FOLGA = 5;

  let dataLimite = null;
  if (dataReferencia) {
    const ref = new Date(dataReferencia);
    if (!isNaN(ref.getTime())) {
      dataLimite = new Date(ref.getTime() - DIAS_FOLGA * 24 * 60 * 60 * 1000);
    }
  }

  console.log(`[Bling] BUSCA NF por numero=${numeroNFStr} (alt: ${numeroNFLimpo}) max ${MAX_PAGINAS}pgs`);

  let totalScanned = 0;
  let primeiraDataVista = null;
  let ultimaDataVista = null;

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    if (pagina > 1) await sleep(DELAY_MS);
    const url = `https://api.bling.com.br/Api/v3/nfe?limite=${LIMITE_PAGINA}&pagina=${pagina}&tipo=1`;
    const r = await chamarBling(url);

    if (!r.ok) {
      return { ok: false, status: r.status, error: r.error, totalScanned, primeiraDataVista, ultimaDataVista };
    }

    const lista = r.data?.data || [];
    if (lista.length === 0) break;

    if (pagina === 1 && lista[0]) primeiraDataVista = lista[0].dataEmissao;
    if (lista[lista.length - 1]) ultimaDataVista = lista[lista.length - 1].dataEmissao;

    totalScanned += lista.length;

    // Match por numero - tenta varias formas
    const match = lista.find(nf => {
      const numeroBling = String(nf.numero || '').trim();
      const numeroBlingLimpo = numeroBling.replace(/^0+/, '');
      return numeroBling === numeroNFStr ||
             numeroBlingLimpo === numeroNFLimpo ||
             numeroBling === String(numeroNF);
    });

    if (match) {
      console.log(`[Bling] NF ENCONTRADA pag ${pagina}: numero=${match.numero} id=${match.id}`);
      return { ok: true, match, pagina, totalScanned, primeiraDataVista, ultimaDataVista };
    }

    if (dataLimite && lista[lista.length - 1]?.dataEmissao) {
      const dataNF = new Date(lista[lista.length - 1].dataEmissao);
      if (dataNF < dataLimite) break;
    }

    if (lista.length < LIMITE_PAGINA) break;
  }

  return { ok: true, match: null, totalScanned, primeiraDataVista, ultimaDataVista };
}

return { buscarNFnoML, buscarNFBlindada, classificarMotivoDevolucao, buscarNFnoBlingPorNumero };
};
