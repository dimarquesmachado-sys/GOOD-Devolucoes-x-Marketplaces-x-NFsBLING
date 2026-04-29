// ============================================================
// GOOD Devolucoes - Marketplaces - NFs
// Fase 3.1: ML rapido + Bling enriquecimento (paralelo)
// ============================================================

const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const ML_CLIENT_ID = process.env.ML_CLIENT_ID;
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
let ML_ACCESS_TOKEN = process.env.ML_ACCESS_TOKEN;
let ML_REFRESH_TOKEN = process.env.ML_REFRESH_TOKEN;
const ML_USER_ID = process.env.ML_USER_ID;

const BLING_CLIENT_ID = process.env.BLING_CLIENT_ID;
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET;
let BLING_ACCESS_TOKEN = process.env.BLING_ACCESS_TOKEN;
let BLING_REFRESH_TOKEN = process.env.BLING_REFRESH_TOKEN;

const RENDER_API_KEY = process.env.RENDER_API_KEY || null;
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// Atualizar tokens no Render
// ============================================================
async function atualizarTokensNoRender(updates) {
  if (!RENDER_API_KEY || !RENDER_SERVICE_ID) return false;
  try {
    const current = await axios.get(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`,
      { headers: { Authorization: `Bearer ${RENDER_API_KEY}` } }
    );
    const allVars = (current.data || []).map(item => ({
      key: item.envVar.key,
      value: item.envVar.value,
    }));
    for (const u of updates) {
      const existing = allVars.find(v => v.key === u.key);
      if (existing) existing.value = u.value;
      else allVars.push(u);
    }
    await axios.put(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`,
      allVars,
      { headers: { Authorization: `Bearer ${RENDER_API_KEY}`, 'Content-Type': 'application/json' } }
    );
    return true;
  } catch (error) {
    console.error('[Render] Erro:', error.response?.data || error.message);
    return false;
  }
}

// ============================================================
// MERCADO LIVRE
// ============================================================
async function renovarTokenML() {
  console.log('[ML] Renovando access token...');
  try {
    const response = await axios.post(
      'https://api.mercadolibre.com/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ML_CLIENT_ID,
        client_secret: ML_CLIENT_SECRET,
        refresh_token: ML_REFRESH_TOKEN,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    ML_ACCESS_TOKEN = response.data.access_token;
    ML_REFRESH_TOKEN = response.data.refresh_token;
    await atualizarTokensNoRender([
      { key: 'ML_ACCESS_TOKEN', value: ML_ACCESS_TOKEN },
      { key: 'ML_REFRESH_TOKEN', value: ML_REFRESH_TOKEN },
    ]);
    return true;
  } catch (error) {
    console.error('[ML] ERRO renovar:', error.response?.data || error.message);
    return false;
  }
}

async function chamarML(url, headersExtras = {}) {
  const fazer = () => axios.get(url, { headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}`, ...headersExtras } });
  try {
    const r = await fazer();
    return { ok: true, data: r.data, status: r.status };
  } catch (error) {
    if (error.response?.status === 401) {
      if (await renovarTokenML()) {
        try {
          const r = await fazer();
          return { ok: true, data: r.data, status: r.status };
        } catch (err2) {
          return { ok: false, status: err2.response?.status, error: err2.response?.data || err2.message };
        }
      }
    }
    return { ok: false, status: error.response?.status, error: error.response?.data || error.message };
  }
}

async function buscarNFnoML(shipmentId) {
  console.log(`[ML] Buscando NF do shipment ${shipmentId}`);
  return chamarML(`https://api.mercadolibre.com/shipments/${shipmentId}/invoice_data?siteId=MLB`);
}

// ============================================================
// BLING
// ============================================================
async function renovarTokenBling() {
  console.log('[Bling] Renovando access token...');
  try {
    const basicAuth = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64');
    const response = await axios.post(
      'https://www.bling.com.br/Api/v3/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: BLING_REFRESH_TOKEN,
      }).toString(),
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    BLING_ACCESS_TOKEN = response.data.access_token;
    if (response.data.refresh_token) BLING_REFRESH_TOKEN = response.data.refresh_token;
    await atualizarTokensNoRender([
      { key: 'BLING_ACCESS_TOKEN', value: BLING_ACCESS_TOKEN },
      { key: 'BLING_REFRESH_TOKEN', value: BLING_REFRESH_TOKEN },
    ]);
    return true;
  } catch (error) {
    console.error('[Bling] ERRO renovar:', error.response?.data || error.message);
    return false;
  }
}

async function chamarBling(url, opcoes = {}) {
  const fazer = () => axios({
    url,
    method: opcoes.method || 'GET',
    headers: { Authorization: `Bearer ${BLING_ACCESS_TOKEN}`, ...(opcoes.headers || {}) },
    data: opcoes.data,
  });
  try {
    const r = await fazer();
    return { ok: true, data: r.data, status: r.status };
  } catch (error) {
    if (error.response?.status === 401) {
      if (await renovarTokenBling()) {
        try {
          const r = await fazer();
          return { ok: true, data: r.data, status: r.status };
        } catch (err2) {
          return { ok: false, status: err2.response?.status, error: err2.response?.data || err2.message };
        }
      }
    }
    if (error.response?.status === 429) {
      console.log('[Bling] 429 - aguardando 1.5s');
      await sleep(1500);
      try {
        const r = await fazer();
        return { ok: true, data: r.data, status: r.status };
      } catch (err2) {
        return { ok: false, status: err2.response?.status, error: err2.response?.data || err2.message };
      }
    }
    return { ok: false, status: error.response?.status, error: error.response?.data || error.message };
  }
}

async function buscarPedidoBlingPorNumeroLoja(numeroLoja, dataReferencia, opcoes = {}) {
  const numeroLojaStr = String(numeroLoja).trim();
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

  console.log(`[Bling] Busca numeroLoja=${numeroLojaStr} max ${MAX_PAGINAS}pgs`);

  let totalScanned = 0;
  let primeiraDataVista = null;
  let ultimaDataVista = null;

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    if (pagina > 1) await sleep(DELAY_MS);
    const url = `https://www.bling.com.br/Api/v3/pedidos/vendas?limite=${LIMITE_PAGINA}&pagina=${pagina}`;
    const r = await chamarBling(url);

    if (!r.ok) {
      return { ok: false, status: r.status, error: r.error, totalScanned, primeiraDataVista, ultimaDataVista };
    }

    const lista = r.data?.data || [];
    if (lista.length === 0) break;

    if (pagina === 1 && lista[0]?.data) primeiraDataVista = lista[0].data;
    if (lista[lista.length - 1]?.data) ultimaDataVista = lista[lista.length - 1].data;

    totalScanned += lista.length;

    const match = lista.find(p =>
      String(p.numeroLoja || '').trim() === numeroLojaStr
    );

    if (match) {
      console.log(`[Bling] Encontrado pag ${pagina}: id=${match.id}`);
      return { ok: true, match, pagina, totalScanned, primeiraDataVista, ultimaDataVista };
    }

    if (dataLimite && lista[lista.length - 1]?.data) {
      const dataPedido = new Date(lista[lista.length - 1].data);
      if (dataPedido < dataLimite) break;
    }

    if (lista.length < LIMITE_PAGINA) break;
  }

  return { ok: true, match: null, totalScanned, primeiraDataVista, ultimaDataVista };
}

async function buscarPedidoBlingPorId(idPedido) {
  return chamarBling(`https://www.bling.com.br/Api/v3/pedidos/vendas/${idPedido}`);
}

async function buscarNFePorId(idNFe) {
  return chamarBling(`https://www.bling.com.br/Api/v3/nfe/${idNFe}`);
}

// Helper: pega NF completa do Bling a partir do order_id ML
// Retorna { ok, pedido, nfe, tentativas }
async function pegarNFCompletaBling(orderIdML, dataReferencia) {
  const tentativas = [];
  const numeroLoja = String(orderIdML);

  // 1) Busca pedido por numeroLoja
  const rBusca = await buscarPedidoBlingPorNumeroLoja(numeroLoja, dataReferencia, { maxPaginas: 50 });
  tentativas.push({
    tipo: 'bling_busca_paginada',
    codigo: numeroLoja,
    ok: rBusca.ok,
    status: rBusca.ok ? 200 : (rBusca.status || 500),
    total_scanned: rBusca.totalScanned,
    pagina_match: rBusca.pagina,
    primeira_data: rBusca.primeiraDataVista,
    ultima_data: rBusca.ultimaDataVista,
    encontrou: !!rBusca.match,
  });

  if (!rBusca.ok || !rBusca.match) {
    return { ok: false, pedido: null, nfe: null, tentativas };
  }

  // 2) Busca pedido completo pra pegar notaFiscal.id
  await sleep(400);
  const rCompleto = await buscarPedidoBlingPorId(rBusca.match.id);
  if (!rCompleto.ok || !rCompleto.data?.data) {
    tentativas.push({ tipo: 'bling_pedido_completo', codigo: rBusca.match.id, ok: false, status: rCompleto.status });
    return { ok: false, pedido: null, nfe: null, tentativas };
  }

  const pedido = rCompleto.data.data;
  const nfeId = pedido.notaFiscal?.id;

  if (!nfeId) {
    return { ok: true, pedido, nfe: null, tentativas, sem_nfe: true };
  }

  // 3) Busca NF completa
  await sleep(400);
  const rNFe = await buscarNFePorId(nfeId);
  if (!rNFe.ok || !rNFe.data?.data) {
    tentativas.push({ tipo: 'bling_nfe', codigo: nfeId, ok: false, status: rNFe.status });
    return { ok: true, pedido, nfe: null, tentativas };
  }

  return { ok: true, pedido, nfe: rNFe.data.data, tentativas };
}

// ============================================================
// HELPERS ML claims/orders
// ============================================================
function extrairClaimsDaResposta(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.claims)) return data.claims;
  if (data.id) return [data];
  return [];
}

async function buscarClaimsPorShipment(shipmentId) {
  const tentativas = [
    `https://api.mercadolibre.com/post-purchase/v1/claims/search?resource=shipment&resource_id=${shipmentId}`,
    `https://api.mercadolibre.com/post-purchase/v1/claims/search?shipment_id=${shipmentId}`,
  ];
  for (const url of tentativas) {
    const r = await chamarML(url);
    if (r.ok) {
      const claims = extrairClaimsDaResposta(r.data);
      if (claims.length > 0) return { ok: true, claims, raw: r.data };
    }
  }
  return { ok: false, claims: [] };
}

async function buscarClaimDetalhada(claimId) {
  return chamarML(`https://api.mercadolibre.com/post-purchase/v1/claims/${claimId}`);
}

async function buscarReturnPorClaim(claimId) {
  return chamarML(`https://api.mercadolibre.com/post-purchase/v2/claims/${claimId}/returns`);
}

async function buscarOrdersPorComprador(buyerId, sellerId) {
  return chamarML(
    `https://api.mercadolibre.com/orders/search?seller=${sellerId}&buyer=${buyerId}&sort=date_desc&limit=20`
  );
}

// ============================================================
// ROTAS
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'good-devolucoes-marketplaces-nfsbling',
    version: '3.1.0',
    integrations: {
      ml: !!ML_ACCESS_TOKEN,
      bling: !!BLING_ACCESS_TOKEN,
      render_persist: !!(RENDER_API_KEY && RENDER_SERVICE_ID),
    },
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// ROTA PRINCIPAL
// ============================================================
app.get('/api/devolucao/identificar/:codigo', async (req, res) => {
  const codigoOriginal = String(req.params.codigo || '').trim();

  if (!codigoOriginal) {
    return res.status(400).json({ ok: false, erro: 'Codigo nao informado' });
  }

  console.log(`\n========== NOVA BUSCA: ${codigoOriginal} ==========`);
  const codigoLimpo = codigoOriginal.replace(/[^0-9]/g, '');

  const resultado = {
    codigo_buscado: codigoOriginal,
    codigo_limpo: codigoLimpo,
    tentativas: [],
    encontrado: false,
    avisos: [],
  };

  let shipment = null;
  let order = null;
  let pack = null;
  let claim = null;
  let returnData = null;
  let metodoUsado = null;

  // ML T1: shipment_id
  if (codigoLimpo.length >= 10 && codigoLimpo.length <= 13) {
    const r = await chamarML(
      `https://api.mercadolibre.com/shipments/${codigoLimpo}`,
      { 'x-format-new': 'true' }
    );
    resultado.tentativas.push({
      tipo: 'shipment_id', codigo: codigoLimpo,
      ok: r.ok, status: r.status, erro: r.ok ? null : r.error,
    });
    if (r.ok && r.data?.id) {
      shipment = r.data;
      metodoUsado = 'shipment_id';
    }
  }

  // ML T2: pack_id
  if (!shipment) {
    const possiveis = [];
    if (codigoLimpo.length >= 15) possiveis.push(codigoLimpo);
    if (codigoLimpo.length === 11) possiveis.push('20000' + codigoLimpo);

    for (const packId of possiveis) {
      const r = await chamarML(`https://api.mercadolibre.com/packs/${packId}`);
      resultado.tentativas.push({
        tipo: 'pack_id', codigo: packId,
        ok: r.ok, status: r.status, erro: r.ok ? null : r.error,
      });
      if (r.ok && r.data?.id) {
        pack = r.data;
        metodoUsado = 'pack_id';
        if (pack.shipment?.id) {
          const rShip = await chamarML(
            `https://api.mercadolibre.com/shipments/${pack.shipment.id}`,
            { 'x-format-new': 'true' }
          );
          if (rShip.ok) shipment = rShip.data;
        }
        break;
      }
    }
  }

  if (!shipment && !pack) {
    resultado.erro = 'Codigo nao encontrado em shipments nem packs';
    return res.status(404).json(resultado);
  }

  // ML: ORDER (3 caminhos)
  let orderId = shipment?.order_id || pack?.orders?.[0]?.id;
  if (orderId) {
    const r = await chamarML(`https://api.mercadolibre.com/orders/${orderId}`);
    resultado.tentativas.push({
      tipo: 'order_direto', codigo: orderId,
      ok: r.ok, status: r.status, erro: r.ok ? null : r.error,
    });
    if (r.ok) order = r.data;
  }

  const ehDevolucao = shipment?.type === 'return' || shipment?.tags?.includes('claims_return');

  if (!order && ehDevolucao && shipment?.id) {
    const rClaims = await buscarClaimsPorShipment(shipment.id);
    resultado.tentativas.push({
      tipo: 'claims_search', codigo: shipment.id,
      ok: rClaims.ok, status: rClaims.ok ? 200 : 404,
      claims_encontradas: rClaims.claims?.length || 0,
    });

    if (rClaims.ok && rClaims.claims.length > 0) {
      const claimResumo = rClaims.claims[0];
      const rDetalhada = await buscarClaimDetalhada(claimResumo.id);
      claim = rDetalhada.ok ? rDetalhada.data : claimResumo;

      const rRet = await buscarReturnPorClaim(claimResumo.id);
      if (rRet.ok) returnData = rRet.data;

      const possibleOrderId = claim.resource_id || claimResumo.resource_id;
      if (possibleOrderId) {
        const rOrder = await chamarML(`https://api.mercadolibre.com/orders/${possibleOrderId}`);
        if (rOrder.ok) order = rOrder.data;
      }
    }
  }

  if (!order && shipment) {
    const buyerId = shipment.origin?.sender_id || shipment.sender_id;
    const sellerId = shipment.destination?.receiver_id || shipment.receiver_id || ML_USER_ID;

    if (buyerId && sellerId) {
      const rSearch = await buscarOrdersPorComprador(buyerId, sellerId);
      resultado.tentativas.push({
        tipo: 'orders_por_comprador',
        codigo: `buyer=${buyerId}, seller=${sellerId}`,
        ok: rSearch.ok, status: rSearch.status, erro: rSearch.ok ? null : rSearch.error,
        encontradas: rSearch.data?.results?.length || 0,
      });

      if (rSearch.ok && rSearch.data?.results?.length > 0) {
        const orders = rSearch.data.results;
        let bestMatch = null;
        if (shipment?.id) bestMatch = orders.find(o => o.shipping?.id === shipment.id);
        if (!bestMatch && shipment?.declared_value) {
          bestMatch = orders.find(o => Math.abs(o.total_amount - shipment.declared_value) < 0.01);
        }
        if (!bestMatch) {
          bestMatch = orders.find(o => o.status === 'cancelled' || o.tags?.includes('not_paid') || o.mediations?.length > 0);
        }
        if (!bestMatch) bestMatch = orders[0];

        if (bestMatch?.id) {
          const rFull = await chamarML(`https://api.mercadolibre.com/orders/${bestMatch.id}`);
          if (rFull.ok) {
            order = rFull.data;
            resultado.avisos.push({
              tipo: 'order_via_fallback',
              mensagem: `Order encontrada via busca por comprador (${orders.length} candidatos)`,
            });
          }
        }
      }
    }
  }

  if (!pack && order?.pack_id) {
    const r = await chamarML(`https://api.mercadolibre.com/packs/${order.pack_id}`);
    if (r.ok) pack = r.data;
  }

  // ============================================================
  // BUSCA NF EM PARALELO: ML rapido + Bling enriquecimento
  // ============================================================
  let nfData = null;
  let blingPedido = null;

  // Shipment original (nao o de devolucao) pra busca ML
  const shipmentOriginalId = order?.shipping?.id || (!ehDevolucao ? shipment?.id : null);

  if (order?.id) {
    // Dispara as 2 buscas em PARALELO pra economizar tempo
    const promiseML = shipmentOriginalId
      ? buscarNFnoML(shipmentOriginalId)
      : Promise.resolve({ ok: false });

    const promiseBling = pegarNFCompletaBling(order.id, order.date_created || order.date_closed);

    const [rNFML, rBling] = await Promise.all([promiseML, promiseBling]);

    // Registra tentativas no resultado
    if (shipmentOriginalId) {
      resultado.tentativas.push({
        tipo: 'ml_invoice_data',
        codigo: shipmentOriginalId,
        ok: rNFML.ok,
        status: rNFML.status,
        erro: rNFML.ok ? null : rNFML.error,
        tem_fiscal_key: !!rNFML.data?.fiscal_key,
      });
    }

    rBling.tentativas?.forEach(t => resultado.tentativas.push(t));

    // Monta NF unificada usando o melhor de cada fonte
    const nfML = rNFML.ok && rNFML.data?.fiscal_key ? rNFML.data : null;
    const nfBling = rBling.nfe || null;
    blingPedido = rBling.pedido || null;

    if (nfBling) {
      // Bling tem todos os links bonitos - prioritario
      console.log(`[NF] Usando Bling como fonte (links completos)`);
      nfData = {
        fonte: nfML ? 'bling+ml' : 'bling',
        numero: nfBling.numero,
        serie: nfBling.serie,
        chaveAcesso: nfBling.chaveAcesso || nfBling.chave_acesso,
        valor: nfBling.valorNota || nfBling.valor || nfBling.totalNota,
        dataEmissao: nfBling.dataEmissao || nfBling.data_emissao,
        peso: nfBling.itens?.[0]?.pesoBruto ? Math.round(nfBling.itens[0].pesoBruto * 1000) : null,
        // Links Bling - permanentes, sem login!
        linkDanfe: nfBling.linkDanfe,
        linkPdf: nfBling.linkPDF,
        linkXml: nfBling.xml,
        // Link Meu Danfe como backup
        linkConsulta: (nfBling.chaveAcesso || nfBling.chave_acesso)
          ? `https://meudanfe.com.br/consulta/${nfBling.chaveAcesso || nfBling.chave_acesso}`
          : null,
        idBling: nfBling.id,
      };
    } else if (nfML) {
      // Bling falhou mas ML retornou - usa ML
      console.log(`[NF] Usando ML como fonte (Bling falhou)`);
      nfData = {
        fonte: 'ml',
        numero: nfML.invoice_number,
        serie: nfML.invoice_serie,
        chaveAcesso: nfML.fiscal_key,
        valor: nfML.invoice_amount,
        dataEmissao: nfML.invoice_date,
        peso: nfML.weight,
        linkConsulta: `https://meudanfe.com.br/consulta/${nfML.fiscal_key}`,
        idMLInvoice: nfML.id,
      };
    }
  }

  if (!nfData) {
    resultado.avisos.push({
      tipo: 'sem_nf',
      mensagem: 'NF-e nao encontrada nem no ML nem no Bling',
    });
  }

  if (!order) {
    resultado.avisos.push({
      tipo: 'sem_order',
      mensagem: 'Nao foi possivel obter detalhes da venda no ML',
    });
  }

  resultado.encontrado = true;
  resultado.metodo = metodoUsado;
  resultado.eh_devolucao = ehDevolucao;
  resultado.shipment = shipment;
  resultado.order = order;
  resultado.pack = pack;
  resultado.claim = claim;
  resultado.return = returnData;
  resultado.nf = nfData;
  resultado.bling = { pedido: blingPedido };

  console.log(`[BUSCA] OK | Order=${!!order} | NF=${nfData?.fonte || 'nao'}`);
  return res.json(resultado);
});

// ============================================================
// ADMIN
// ============================================================
app.post('/api/admin/renovar-token-ml', async (req, res) => {
  const ok = await renovarTokenML();
  res.json({ ok, timestamp: new Date().toISOString() });
});

app.post('/api/admin/renovar-token-bling', async (req, res) => {
  const ok = await renovarTokenBling();
  res.json({ ok, timestamp: new Date().toISOString() });
});

// ============================================================
// DEBUG
// ============================================================
app.get('/api/debug/shipment/:id', async (req, res) => {
  const r = await chamarML(`https://api.mercadolibre.com/shipments/${req.params.id}`, { 'x-format-new': 'true' });
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

app.get('/api/debug/order/:id', async (req, res) => {
  const r = await chamarML(`https://api.mercadolibre.com/orders/${req.params.id}`);
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

app.get('/api/debug/ml-invoice/:shipmentId', async (req, res) => {
  const r = await buscarNFnoML(req.params.shipmentId);
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

app.get('/api/debug/bling-busca/:numeroLoja', async (req, res) => {
  const dataRef = req.query.data || null;
  const r = await buscarPedidoBlingPorNumeroLoja(req.params.numeroLoja, dataRef, { maxPaginas: 50 });
  res.json(r);
});

app.get('/api/debug/bling-pedido/:id', async (req, res) => {
  const r = await buscarPedidoBlingPorId(req.params.id);
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

app.get('/api/debug/bling-nfe-cru/:idNFe', async (req, res) => {
  const r = await buscarNFePorId(req.params.idNFe);
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

// ============================================================
// CALLBACKS OAuth
// ============================================================
app.get('/callback', (req, res) => {
  res.send(`<h2>Callback ML recebido</h2><p>code: ${req.query.code || '(nenhum)'}</p>`);
});

app.get('/bling/callback', (req, res) => {
  res.send(`<h2>Callback Bling recebido</h2><p>code: ${req.query.code || '(nenhum)'}</p>`);
});

// ============================================================
// INICIAR
// ============================================================
app.listen(PORT, () => {
  console.log('============================================');
  console.log('GOOD Devolucoes v3.1.0 - ML+Bling em paralelo');
  console.log(`Porta: ${PORT}`);
  console.log(`ML: ${ML_ACCESS_TOKEN ? 'OK' : 'FALTA'}`);
  console.log(`Bling: ${BLING_ACCESS_TOKEN ? 'OK' : 'FALTA'}`);
  console.log(`Render persist: ${(RENDER_API_KEY && RENDER_SERVICE_ID) ? 'OK' : 'FALTA'}`);
  console.log('============================================');
});
