// ============================================================
// GOOD Devolucoes - Marketplaces - NFs Bling
// Fase 1.3: parsing correto da resposta de claims
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

const RENDER_API_KEY = process.env.RENDER_API_KEY || null;
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || null;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    console.log('[ML] Token renovado!');
    if (RENDER_API_KEY && RENDER_SERVICE_ID) await atualizarTokensNoRender();
    return true;
  } catch (error) {
    console.error('[ML] ERRO renovar token:', error.response?.data || error.message);
    return false;
  }
}

async function atualizarTokensNoRender() {
  try {
    await axios.put(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`,
      [
        { key: 'ML_ACCESS_TOKEN', value: ML_ACCESS_TOKEN },
        { key: 'ML_REFRESH_TOKEN', value: ML_REFRESH_TOKEN },
      ],
      { headers: { Authorization: `Bearer ${RENDER_API_KEY}`, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Render] Erro:', error.response?.data || error.message);
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

// ============================================================
// Extrair claim de varios formatos possiveis de resposta
// ============================================================
function extrairClaimsDaResposta(data) {
  if (!data) return [];
  // Possiveis estruturas que a API pode retornar
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.claims)) return data.claims;
  if (data.id) return [data]; // claim unica retornada direta
  return [];
}

// ============================================================
// HEALTH
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'good-devolucoes-marketplaces-nfsbling',
    version: '1.3.0',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// HELPERS - busca em varios endpoints de claims
// ============================================================
async function buscarClaimsPorShipment(shipmentId) {
  // Tenta varios endpoints e formatos
  const tentativas = [
    `https://api.mercadolibre.com/post-purchase/v1/claims/search?resource=shipment&resource_id=${shipmentId}`,
    `https://api.mercadolibre.com/post-purchase/v1/claims/search?shipment_id=${shipmentId}`,
  ];

  for (const url of tentativas) {
    const r = await chamarML(url);
    if (r.ok) {
      const claims = extrairClaimsDaResposta(r.data);
      if (claims.length > 0) {
        return { ok: true, claims, raw: r.data, urlUsada: url };
      }
    }
  }
  return { ok: false, claims: [], raw: null };
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

  // T1: shipment_id
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

  // T2: pack_id
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

  // CAMINHO A: order_id direto
  let orderId = shipment?.order_id || pack?.orders?.[0]?.id;
  if (orderId) {
    const r = await chamarML(`https://api.mercadolibre.com/orders/${orderId}`);
    resultado.tentativas.push({
      tipo: 'order_direto', codigo: orderId,
      ok: r.ok, status: r.status, erro: r.ok ? null : r.error,
    });
    if (r.ok) order = r.data;
  }

  // CAMINHO B: via claim
  const ehDevolucao = shipment?.type === 'return' || shipment?.tags?.includes('claims_return');

  if (!order && ehDevolucao && shipment?.id) {
    const rClaims = await buscarClaimsPorShipment(shipment.id);
    resultado.tentativas.push({
      tipo: 'claims_search', codigo: shipment.id,
      ok: rClaims.ok, status: rClaims.ok ? 200 : 404,
      claims_encontradas: rClaims.claims?.length || 0,
      url_usada: rClaims.urlUsada,
    });

    if (rClaims.ok && rClaims.claims.length > 0) {
      const claimResumo = rClaims.claims[0];
      console.log(`[CLAIM] Encontrada claim ID=${claimResumo.id}, resource_id=${claimResumo.resource_id}`);

      // Busca detalhes completos da claim
      const rDetalhada = await buscarClaimDetalhada(claimResumo.id);
      claim = rDetalhada.ok ? rDetalhada.data : claimResumo;

      // Busca return data
      const rRet = await buscarReturnPorClaim(claimResumo.id);
      if (rRet.ok) returnData = rRet.data;

      // Busca order pelo resource_id da claim
      const possibleOrderId = claim.resource_id || claimResumo.resource_id;
      if (possibleOrderId) {
        const rOrder = await chamarML(`https://api.mercadolibre.com/orders/${possibleOrderId}`);
        resultado.tentativas.push({
          tipo: 'order_via_claim', codigo: possibleOrderId,
          ok: rOrder.ok, status: rOrder.status, erro: rOrder.ok ? null : rOrder.error,
        });
        if (rOrder.ok) order = rOrder.data;
      }
    }
  }

  // CAMINHO C: fallback via comprador (sender_id)
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
          bestMatch = orders.find(o =>
            o.status === 'cancelled' || o.tags?.includes('not_paid') || o.mediations?.length > 0
          );
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

  // PACK COMPLETO
  if (!pack && order?.pack_id) {
    const r = await chamarML(`https://api.mercadolibre.com/packs/${order.pack_id}`);
    if (r.ok) pack = r.data;
  }

  if (!order) {
    resultado.avisos.push({
      tipo: 'sem_order',
      mensagem: 'Nao foi possivel obter detalhes da venda. Mostrando o que tem do shipment.',
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

  console.log(`[BUSCA] OK | Devolucao=${ehDevolucao} | Order=${!!order} | Claim=${!!claim}`);
  return res.json(resultado);
});

// ----- ADMIN -----
app.post('/api/admin/renovar-token', async (req, res) => {
  const ok = await renovarTokenML();
  res.json({ ok, timestamp: new Date().toISOString() });
});

// ----- DEBUG -----
app.get('/api/debug/shipment/:id', async (req, res) => {
  const r = await chamarML(`https://api.mercadolibre.com/shipments/${req.params.id}`, { 'x-format-new': 'true' });
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

app.get('/api/debug/order/:id', async (req, res) => {
  const r = await chamarML(`https://api.mercadolibre.com/orders/${req.params.id}`);
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

app.get('/api/debug/pack/:id', async (req, res) => {
  const r = await chamarML(`https://api.mercadolibre.com/packs/${req.params.id}`);
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

app.get('/api/debug/orders-buyer/:buyerId', async (req, res) => {
  const sellerId = req.query.seller || ML_USER_ID;
  const r = await chamarML(
    `https://api.mercadolibre.com/orders/search?seller=${sellerId}&buyer=${req.params.buyerId}&sort=date_desc&limit=20`
  );
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

// IMPORTANTE: debug das claims (raw)
app.get('/api/debug/claims-search/:shipmentId', async (req, res) => {
  const url = `https://api.mercadolibre.com/post-purchase/v1/claims/search?resource=shipment&resource_id=${req.params.shipmentId}`;
  const r = await chamarML(url);
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

app.get('/api/debug/claim/:claimId', async (req, res) => {
  const r = await chamarML(`https://api.mercadolibre.com/post-purchase/v1/claims/${req.params.claimId}`);
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

// ============================================================
// INICIAR
// ============================================================
app.listen(PORT, () => {
  console.log('============================================');
  console.log('GOOD Devolucoes v1.3.0 - parsing correto de claims');
  console.log(`Porta: ${PORT}`);
  console.log(`ML_CLIENT_ID: ${ML_CLIENT_ID ? 'OK' : 'FALTA'}`);
  console.log(`ML_ACCESS_TOKEN: ${ML_ACCESS_TOKEN ? 'OK' : 'FALTA'}`);
  console.log(`ML_USER_ID: ${ML_USER_ID || 'FALTA'}`);
  console.log('============================================');
});
