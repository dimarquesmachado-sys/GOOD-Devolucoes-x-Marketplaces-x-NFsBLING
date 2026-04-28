// ============================================================
// GOOD Devolucoes - Marketplaces - NFs Bling
// Fase 1.1: Identificar venda + diagnostico de falhas
// ============================================================

const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CREDENCIAIS
// ============================================================
const ML_CLIENT_ID = process.env.ML_CLIENT_ID;
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
let ML_ACCESS_TOKEN = process.env.ML_ACCESS_TOKEN;
let ML_REFRESH_TOKEN = process.env.ML_REFRESH_TOKEN;
const ML_USER_ID = process.env.ML_USER_ID;

const RENDER_API_KEY = process.env.RENDER_API_KEY || null;
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || null;

// ============================================================
// EXPRESS
// ============================================================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// HELPER: Renovar token
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
      {
        headers: {
          Authorization: `Bearer ${RENDER_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('[Render] Tokens atualizados nas env vars');
  } catch (error) {
    console.error('[Render] Erro:', error.response?.data || error.message);
  }
}

// ============================================================
// HELPER: Chamada ao ML com retry
// ============================================================
async function chamarML(url, headersExtras = {}) {
  const fazer = () =>
    axios.get(url, {
      headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}`, ...headersExtras },
    });

  try {
    const r = await fazer();
    return { ok: true, data: r.data, status: r.status };
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('[ML] 401 - tentando renovar token');
      if (await renovarTokenML()) {
        try {
          const r = await fazer();
          return { ok: true, data: r.data, status: r.status };
        } catch (err2) {
          return {
            ok: false,
            status: err2.response?.status,
            error: err2.response?.data || err2.message,
          };
        }
      }
    }
    return {
      ok: false,
      status: error.response?.status,
      error: error.response?.data || error.message,
    };
  }
}

// ============================================================
// ROTAS
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'good-devolucoes-marketplaces-nfsbling',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
  });
});

// ----- BUSCAR CLAIM POR SHIPMENT -----
async function buscarClaimPorShipment(shipmentId) {
  console.log(`[CLAIM] Buscando claim para shipment ${shipmentId}`);
  return chamarML(
    `https://api.mercadolibre.com/post-purchase/v1/claims/search?resource=shipment&resource_id=${shipmentId}`
  );
}

async function buscarReturnPorClaim(claimId) {
  console.log(`[CLAIM] Buscando returns da claim ${claimId}`);
  return chamarML(
    `https://api.mercadolibre.com/post-purchase/v2/claims/${claimId}/returns`
  );
}

// ----- ROTA PRINCIPAL -----
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

  // BUSCAR ORDER
  let orderId = shipment?.order_id || pack?.orders?.[0]?.id;
  if (orderId) {
    const r = await chamarML(`https://api.mercadolibre.com/orders/${orderId}`);
    resultado.tentativas.push({
      tipo: 'order', codigo: orderId,
      ok: r.ok, status: r.status, erro: r.ok ? null : r.error,
    });
    if (r.ok) {
      order = r.data;
    } else {
      resultado.avisos.push({
        tipo: 'order_falhou',
        mensagem: `Nao consegui obter detalhes da venda (status ${r.status}).`,
      });
    }
  } else {
    resultado.avisos.push({
      tipo: 'sem_order_id',
      mensagem: 'Shipment sem order_id direto. Tentando achar via claim...',
    });
  }

  // BUSCAR CLAIM
  const ehDevolucao =
    shipment?.type === 'return' || shipment?.tags?.includes('claims_return');

  if (ehDevolucao && shipment?.id) {
    const rClaim = await buscarClaimPorShipment(shipment.id);
    resultado.tentativas.push({
      tipo: 'claim', codigo: shipment.id,
      ok: rClaim.ok, status: rClaim.status, erro: rClaim.ok ? null : rClaim.error,
    });

    if (rClaim.ok && rClaim.data?.data?.length > 0) {
      claim = rClaim.data.data[0];
    } else if (rClaim.ok && rClaim.data?.results?.length > 0) {
      claim = rClaim.data.results[0];
    }

    if (claim) {
      const rRet = await buscarReturnPorClaim(claim.id);
      if (rRet.ok) returnData = rRet.data;

      // Se nao temos order ainda, tenta pelo resource_id da claim
      if (!order && claim.resource_id) {
        const r = await chamarML(`https://api.mercadolibre.com/orders/${claim.resource_id}`);
        if (r.ok) order = r.data;
      }
    }
  }

  // BUSCAR PACK COMPLETO
  if (!pack && order?.pack_id) {
    const r = await chamarML(`https://api.mercadolibre.com/packs/${order.pack_id}`);
    if (r.ok) pack = r.data;
  }

  // RESULTADO
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
  const r = await chamarML(
    `https://api.mercadolibre.com/shipments/${req.params.id}`,
    { 'x-format-new': 'true' }
  );
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

// ============================================================
// INICIAR
// ============================================================
app.listen(PORT, () => {
  console.log('============================================');
  console.log('GOOD Devolucoes v1.1.0 - busca melhorada');
  console.log(`Porta: ${PORT}`);
  console.log(`ML_CLIENT_ID: ${ML_CLIENT_ID ? 'OK' : 'FALTA'}`);
  console.log(`ML_ACCESS_TOKEN: ${ML_ACCESS_TOKEN ? 'OK' : 'FALTA'}`);
  console.log(`ML_USER_ID: ${ML_USER_ID || 'FALTA'}`);
  console.log('============================================');
});
