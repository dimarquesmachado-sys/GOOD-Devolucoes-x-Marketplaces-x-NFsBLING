// ============================================================
// GOOD Devolucoes - Marketplaces - NFs
// Fase 3.6: Triagem (estoquista), area admin, email, fotos
// ============================================================

const express = require('express');
const axios = require('axios');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// === ML / Bling / Render (Fase 1+2) ===
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

// === FASE 3: Supabase + Email + Auth ===
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '465', 10);
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO;
const mailer = (EMAIL_HOST && EMAIL_USER && EMAIL_PASS) ? nodemailer.createTransport({
  host: EMAIL_HOST,
  port: EMAIL_PORT,
  secure: EMAIL_PORT === 465,
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
}) : null;

// USERS=Diego:senha,Lucas:senha,Ygor:senha,Adriano:senha
function parseUsers(envStr) {
  if (!envStr) return {};
  const out = {};
  envStr.split(',').forEach(p => {
    const [u, s] = p.split(':');
    if (u && s) out[u.trim()] = s.trim();
  });
  return out;
}
const USERS = parseUsers(process.env.USERS || '');
const ADMIN_USER = process.env.ADMIN_USER || null; // nome do usuario admin (deve estar no USERS tb)

// Sessoes em memoria (token -> {usuario, criado, tipo})
const sessoes = new Map();
function novaSessao(usuario, tipo = 'estoquista') {
  const token = crypto.randomBytes(24).toString('hex');
  sessoes.set(token, { usuario, tipo, criado: Date.now() });
  return token;
}
function validarSessao(token, tipoEsperado = null) {
  if (!token) return null;
  const s = sessoes.get(token);
  if (!s) return null;
  // Sessao expira em 12h
  if (Date.now() - s.criado > 12 * 60 * 60 * 1000) {
    sessoes.delete(token);
    return null;
  }
  if (tipoEsperado && s.tipo !== tipoEsperado) return null;
  return s;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Multer pra receber uploads de fotos (em memoria, 6 MB max por foto)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de log basico
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

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

// NOVO v3.5: paginar /nfe procurando por NUMERO da NF (que vem do ML)
// Estrategia mais robusta - listing do /nfe nao traz numeroPedidoLoja,
// mas traz numero. Usamos invoice_number do ML pra match.
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
    const url = `https://www.bling.com.br/Api/v3/nfe?limite=${LIMITE_PAGINA}&pagina=${pagina}&tipo=1`;
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

// NOVO: paginar /nfe procurando por numeroPedidoLoja=order_id ML
// Vantagem: NFs nao somem mesmo se o pedido for cancelado depois
// E se acharmos a NF aqui, ja temos linkDanfe direto sem precisar buscar pedido
async function buscarNFnoBlingPorOrderId(orderIdML, dataReferencia, opcoes = {}) {
  const orderIdStr = String(orderIdML).trim();
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

  console.log(`[Bling] BUSCA NFs por numeroPedidoLoja=${orderIdStr} max ${MAX_PAGINAS}pgs`);

  let totalScanned = 0;
  let primeiraDataVista = null;
  let ultimaDataVista = null;
  let primeiraNumero = null;
  let ultimaNumero = null;

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    if (pagina > 1) await sleep(DELAY_MS);
    const url = `https://www.bling.com.br/Api/v3/nfe?limite=${LIMITE_PAGINA}&pagina=${pagina}&tipo=1`;
    const r = await chamarBling(url);

    if (!r.ok) {
      return { ok: false, status: r.status, error: r.error, totalScanned, primeiraDataVista, ultimaDataVista };
    }

    const lista = r.data?.data || [];
    if (lista.length === 0) break;

    if (pagina === 1 && lista[0]) {
      primeiraDataVista = lista[0].dataEmissao;
      primeiraNumero = lista[0].numero;
    }
    if (lista[lista.length - 1]) {
      ultimaDataVista = lista[lista.length - 1].dataEmissao;
      ultimaNumero = lista[lista.length - 1].numero;
    }

    totalScanned += lista.length;

    // Match por numeroPedidoLoja (order_id ML)
    const match = lista.find(nf =>
      String(nf.numeroPedidoLoja || '').trim() === orderIdStr
    );

    if (match) {
      console.log(`[Bling] NF ENCONTRADA pag ${pagina}: numero=${match.numero} id=${match.id}`);
      return { ok: true, match, pagina, totalScanned, primeiraDataVista, ultimaDataVista, primeiraNumero, ultimaNumero };
    }

    // Parada por data
    if (dataLimite && lista[lista.length - 1]?.dataEmissao) {
      const dataNF = new Date(lista[lista.length - 1].dataEmissao);
      if (dataNF < dataLimite) {
        console.log(`[Bling] Passou data limite, encerrando`);
        break;
      }
    }

    if (lista.length < LIMITE_PAGINA) break;
  }

  return {
    ok: true,
    match: null,
    totalScanned,
    primeiraDataVista,
    ultimaDataVista,
    primeiraNumero,
    ultimaNumero,
  };
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
    version: '3.8.0',
    integrations: {
      ml: !!ML_ACCESS_TOKEN,
      bling: !!BLING_ACCESS_TOKEN,
      render_persist: !!(RENDER_API_KEY && RENDER_SERVICE_ID),
      supabase: !!supabase,
      email: !!mailer,
      auth: Object.keys(USERS).length > 0,
      admin: !!(ADMIN_USER && USERS[ADMIN_USER]),
    },
    usuarios_cadastrados: Object.keys(USERS),
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// ROTA PRINCIPAL - SO ML (rapido!)
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
  // NF: APENAS via ML (rapido, ~1seg)
  // Se falhar, frontend mostra botao "Buscar links Bling" sob demanda
  // ============================================================
  let nfData = null;

  const shipmentOriginalId = order?.shipping?.id || (!ehDevolucao ? shipment?.id : null);

  if (shipmentOriginalId) {
    const rNFML = await buscarNFnoML(shipmentOriginalId);
    resultado.tentativas.push({
      tipo: 'ml_invoice_data',
      codigo: shipmentOriginalId,
      ok: rNFML.ok,
      status: rNFML.status,
      erro: rNFML.ok ? null : rNFML.error,
      tem_fiscal_key: !!rNFML.data?.fiscal_key,
    });

    if (rNFML.ok && rNFML.data?.fiscal_key) {
      nfData = {
        fonte: 'ml',
        numero: rNFML.data.invoice_number,
        serie: rNFML.data.invoice_serie,
        chaveAcesso: rNFML.data.fiscal_key,
        valor: rNFML.data.invoice_amount,
        dataEmissao: rNFML.data.invoice_date,
        peso: rNFML.data.weight,
        linkConsulta: `https://meudanfe.com.br/consulta/${rNFML.data.fiscal_key}`,
        idMLInvoice: rNFML.data.id,
      };
    }
  }

  if (!nfData) {
    resultado.avisos.push({
      tipo: 'sem_nf_ml',
      mensagem: 'NF-e nao localizada via ML. Use o botao "Buscar links Bling" pra tentar via Bling.',
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

  console.log(`[BUSCA] OK | Order=${!!order} | NF=${nfData ? 'sim' : 'nao'}`);
  return res.json(resultado);
});

// ============================================================
// NOVO v3.5: Buscar links Bling sob demanda - PAGINANDO NFs
// Estrategia rapida: usa invoice_number do ML (que vem rapido) e busca por NUMERO da NF.
// Fallback: se nao tem numero, busca por numeroPedidoLoja (mais lento).
// Funciona pra TUDO (canceladas, ativas, etc) - NFs nunca somem do Bling.
// ============================================================
app.get('/api/nf/buscar-links-bling/:orderId', async (req, res) => {
  const orderId = String(req.params.orderId || '').trim();
  const dataRef = req.query.data || null;
  const numeroNF = req.query.numeroNF || null;

  if (!orderId && !numeroNF) {
    return res.status(400).json({ ok: false, erro: 'orderId ou numeroNF necessario' });
  }

  console.log(`[BLING-DEMANDA v3.5] orderId=${orderId} numeroNF=${numeroNF} dataRef=${dataRef}`);

  let rBusca;
  let estrategia;

  // Se passou o numero da NF (do ML), busca rapida por numero
  if (numeroNF) {
    estrategia = 'por_numero_nf';
    rBusca = await buscarNFnoBlingPorNumero(numeroNF, dataRef, { maxPaginas: 50 });
  } else {
    // Fallback: busca por numeroPedidoLoja (cada NF precisa GET individual, lento)
    estrategia = 'por_numero_pedido_loja';
    rBusca = await buscarNFnoBlingPorOrderId(orderId, dataRef, { maxPaginas: 50 });
  }

  if (!rBusca.ok) {
    return res.json({
      ok: false,
      estrategia,
      erro: 'Erro ao buscar NF no Bling',
      detalhes: rBusca,
    });
  }

  if (!rBusca.match) {
    return res.json({
      ok: false,
      estrategia,
      erro: `NF nao encontrada em ${rBusca.totalScanned} NFs verificadas (de ${rBusca.primeiraDataVista || '?'} a ${rBusca.ultimaDataVista || '?'})`,
      detalhes: rBusca,
    });
  }

  // Buscar NF completa pra ter linkDanfe etc
  await sleep(400);
  const rCompleta = await buscarNFePorId(rBusca.match.id);
  const nf = (rCompleta.ok && rCompleta.data?.data) ? rCompleta.data.data : rBusca.match;

  return res.json({
    ok: true,
    estrategia,
    paginas_verificadas: rBusca.pagina,
    total_scanned: rBusca.totalScanned,
    nf: {
      fonte: 'bling',
      numero: nf.numero,
      serie: nf.serie,
      chaveAcesso: nf.chaveAcesso,
      valor: nf.valorNota,
      dataEmissao: nf.dataEmissao,
      linkDanfe: nf.linkDanfe,
      linkPdf: nf.linkPDF,
      linkXml: nf.xml,
      idBling: nf.id,
      numeroPedidoLoja: nf.numeroPedidoLoja,
    },
  });
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

// v3.4: ver primeira pagina de NFs (pra debug)
app.get('/api/debug/bling-nfe-primeira-pagina', async (req, res) => {
  const limite = req.query.limite || 20;
  const r = await chamarBling(`https://www.bling.com.br/Api/v3/nfe?limite=${limite}&pagina=1&tipo=1`);
  if (r.ok && r.data?.data) {
    const resumo = r.data.data.map(nf => ({
      id: nf.id,
      numero: nf.numero,
      serie: nf.serie,
      numeroPedidoLoja: nf.numeroPedidoLoja,
      dataEmissao: nf.dataEmissao,
      situacao: nf.situacao,
      valorNota: nf.valorNota,
      contato: nf.contato?.nome,
    }));
    return res.json({ ok: true, total_na_pagina: r.data.data.length, primeiros: resumo });
  }
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

// v3.4: busca NF por order_id ML (manual, pra debug)
app.get('/api/debug/bling-busca-nf/:orderId', async (req, res) => {
  const dataRef = req.query.data || null;
  const r = await buscarNFnoBlingPorOrderId(req.params.orderId, dataRef, { maxPaginas: 50 });
  res.json(r);
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
// FASE 3: AUTH (LOGIN ESTOQUISTA)
// ============================================================

// Login unificado (estoquista + admin)
// Se usuario == ADMIN_USER, recebe sessao com tipo='admin'
app.post('/api/auth/login', (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) {
    return res.status(400).json({ ok: false, erro: 'Usuario ou senha faltando' });
  }
  const senhaCorreta = USERS[usuario];
  if (!senhaCorreta || senhaCorreta !== senha) {
    return res.status(401).json({ ok: false, erro: 'Usuario ou senha invalidos' });
  }

  // Define o tipo: admin se usuario == ADMIN_USER, senao estoquista
  const tipo = (ADMIN_USER && usuario === ADMIN_USER) ? 'admin' : 'estoquista';

  const token = novaSessao(usuario, tipo);
  res.cookie('sessao', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000, // 12h
  });
  console.log(`[LOGIN] ${usuario} (${tipo})`);
  return res.json({ ok: true, usuario, tipo });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const t = req.cookies?.sessao;
  if (t) sessoes.delete(t);
  res.clearCookie('sessao');
  return res.json({ ok: true });
});

// Quem sou eu (frontend usa pra validar sessao + saber se admin)
app.get('/api/auth/me', (req, res) => {
  const t = req.cookies?.sessao;
  const s = validarSessao(t);
  if (s) return res.json({ ok: true, usuario: s.usuario, tipo: s.tipo });
  return res.json({ ok: false });
});

// Middleware: requer sessao (qualquer tipo)
function requerLogin(req, res, next) {
  const token = req.cookies?.sessao;
  const sessao = validarSessao(token);
  if (!sessao) {
    return res.status(401).json({ ok: false, erro: 'Sessao invalida ou expirada' });
  }
  req.usuario = sessao.usuario;
  req.tipoUsuario = sessao.tipo;
  next();
}

// Middleware: requer sessao admin
function requerAdmin(req, res, next) {
  const token = req.cookies?.sessao;
  const sessao = validarSessao(token, 'admin');
  if (!sessao) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ ok: false, erro: 'Acesso restrito a admin' });
    }
    // Redireciona pro login (tela principal)
    return res.redirect('/');
  }
  req.usuario = sessao.usuario;
  next();
}

// Alias antigo pra compatibilidade
const requerEstoquista = requerLogin;

// ============================================================
// FASE 3: TRIAGEM - INCLUIR ESTOQUE / REPORTAR PROBLEMA
// ============================================================

// Verificar se shipment_id ja foi triado
app.get('/api/triagem/status/:shipmentId', requerEstoquista, async (req, res) => {
  if (!supabase) {
    return res.json({ ok: false, erro: 'Supabase nao configurado' });
  }
  const shipmentId = String(req.params.shipmentId || '').trim();
  if (!shipmentId) {
    return res.status(400).json({ ok: false, erro: 'shipment_id obrigatorio' });
  }
  try {
    const { data, error } = await supabase
      .from('devolucoes')
      .select('id, created_at, tipo, status, problema_descricao, problema_fotos, data_concluido, nf_numero, produto_qtd')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ ok: false, erro: error.message });
    }
    return res.json({ ok: true, registros: data || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// Caminho APROVAR (INCLUIR ESTOQUE)
app.post('/api/triagem/aprovar', requerEstoquista, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  const dados = req.body || {};

  if (!dados.shipment_id) {
    return res.status(400).json({ ok: false, erro: 'shipment_id obrigatorio' });
  }

  // Bloqueia duplicata - exceto se cliente passar forcar=true (re-triagem proposital)
  if (!dados.forcar) {
    const { data: existentes, error: errBusca } = await supabase
      .from('devolucoes')
      .select('id, created_at, tipo, status, problema_descricao')
      .eq('shipment_id', String(dados.shipment_id))
      .limit(1);
    if (errBusca) {
      console.error('[TRIAGEM] Erro busca duplicata:', errBusca);
    } else if (existentes && existentes.length > 0) {
      return res.status(409).json({
        ok: false,
        erro: 'duplicata',
        mensagem: 'Esta devolucao ja foi triada antes',
        registro_existente: existentes[0],
      });
    }
  }

  try {
    const { data, error } = await supabase
      .from('devolucoes')
      .insert([{
        shipment_id: String(dados.shipment_id),
        order_id: dados.order_id ? String(dados.order_id) : null,
        pack_id: dados.pack_id ? String(dados.pack_id) : null,
        buyer_id: dados.buyer_id ? String(dados.buyer_id) : null,
        buyer_nome: dados.buyer_nome || null,
        produto_titulo: dados.produto_titulo || null,
        produto_mlb: dados.produto_mlb || null,
        produto_sku: dados.produto_sku || null,
        produto_qtd: dados.produto_qtd || null,
        produto_valor_unit: dados.produto_valor_unit || null,
        nf_numero: dados.nf_numero || null,
        nf_serie: dados.nf_serie || null,
        nf_chave: dados.nf_chave || null,
        nf_valor: dados.nf_valor || null,
        nf_data_emissao: dados.nf_data_emissao || null,
        nf_id_bling: dados.nf_id_bling || null,
        nf_link_danfe: dados.nf_link_danfe || null,
        tipo: 'aprovado',
        status: 'pendente',
        problema_descricao: `Aprovado por ${req.usuario}`,
      }])
      .select()
      .single();

    if (error) {
      console.error('[TRIAGEM] Erro Supabase:', error);
      return res.status(500).json({ ok: false, erro: error.message });
    }

    console.log(`[TRIAGEM] APROVADO por ${req.usuario}: shipment=${dados.shipment_id} NF=${dados.nf_numero}`);
    return res.json({ ok: true, id: data.id, registro: data });
  } catch (err) {
    console.error('[TRIAGEM] Erro:', err);
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// Upload de uma foto pro Supabase Storage
// Retorna URL publica pra frontend acumular ate ter as 6+ fotos
app.post('/api/triagem/upload-foto', requerEstoquista, upload.single('foto'), async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  if (!req.file) {
    return res.status(400).json({ ok: false, erro: 'Foto nao enviada' });
  }

  const ext = (req.file.originalname || 'foto.jpg').split('.').pop().toLowerCase();
  const ts = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  const filename = `${req.usuario}/${ts}-${random}.${ext}`;

  try {
    const { error } = await supabase.storage
      .from('fotos-problema')
      .upload(filename, req.file.buffer, {
        contentType: req.file.mimetype || 'image/jpeg',
        upsert: false,
      });

    if (error) {
      console.error('[UPLOAD] Erro:', error);
      return res.status(500).json({ ok: false, erro: error.message });
    }

    const { data: pub } = supabase.storage
      .from('fotos-problema')
      .getPublicUrl(filename);

    console.log(`[UPLOAD] ${req.usuario}: ${filename} (${(req.file.size / 1024).toFixed(0)}KB)`);
    return res.json({ ok: true, url: pub.publicUrl, filename });
  } catch (err) {
    console.error('[UPLOAD] Erro:', err);
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// Caminho PROBLEMA - registra com fotos ja uploadadas + manda email
app.post('/api/triagem/problema', requerEstoquista, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  const dados = req.body || {};

  if (!dados.shipment_id) {
    return res.status(400).json({ ok: false, erro: 'shipment_id obrigatorio' });
  }
  const fotos = Array.isArray(dados.fotos) ? dados.fotos : [];
  if (fotos.length < 1) {
    return res.status(400).json({ ok: false, erro: 'Pelo menos 1 foto necessaria' });
  }

  // Bloqueia duplicata
  if (!dados.forcar) {
    const { data: existentes, error: errBusca } = await supabase
      .from('devolucoes')
      .select('id, created_at, tipo, status, problema_descricao')
      .eq('shipment_id', String(dados.shipment_id))
      .limit(1);
    if (errBusca) {
      console.error('[TRIAGEM] Erro busca duplicata:', errBusca);
    } else if (existentes && existentes.length > 0) {
      return res.status(409).json({
        ok: false,
        erro: 'duplicata',
        mensagem: 'Esta devolucao ja foi triada antes',
        registro_existente: existentes[0],
      });
    }
  }

  try {
    const { data, error } = await supabase
      .from('devolucoes')
      .insert([{
        shipment_id: String(dados.shipment_id),
        order_id: dados.order_id ? String(dados.order_id) : null,
        pack_id: dados.pack_id ? String(dados.pack_id) : null,
        buyer_id: dados.buyer_id ? String(dados.buyer_id) : null,
        buyer_nome: dados.buyer_nome || null,
        produto_titulo: dados.produto_titulo || null,
        produto_mlb: dados.produto_mlb || null,
        produto_sku: dados.produto_sku || null,
        produto_qtd: dados.produto_qtd || null,
        produto_valor_unit: dados.produto_valor_unit || null,
        nf_numero: dados.nf_numero || null,
        nf_serie: dados.nf_serie || null,
        nf_chave: dados.nf_chave || null,
        nf_valor: dados.nf_valor || null,
        nf_data_emissao: dados.nf_data_emissao || null,
        nf_id_bling: dados.nf_id_bling || null,
        nf_link_danfe: dados.nf_link_danfe || null,
        tipo: 'problema',
        status: 'pendente',
        problema_descricao: `[Reportado por ${req.usuario}] ${dados.descricao || ''}`.trim(),
        problema_fotos: fotos,
      }])
      .select()
      .single();

    if (error) {
      console.error('[TRIAGEM] Erro Supabase:', error);
      return res.status(500).json({ ok: false, erro: error.message });
    }

    console.log(`[TRIAGEM] PROBLEMA por ${req.usuario}: shipment=${dados.shipment_id} fotos=${fotos.length}`);

    // Enviar email (nao bloqueia a resposta)
    if (mailer && EMAIL_TO) {
      enviarEmailProblema(data, fotos, req.usuario)
        .then(() => console.log(`[EMAIL] enviado pra ${EMAIL_TO}`))
        .catch(err => console.error('[EMAIL] Erro:', err.message));
    } else {
      console.warn('[EMAIL] Mailer nao configurado, pulando envio');
    }

    return res.json({ ok: true, id: data.id, registro: data });
  } catch (err) {
    console.error('[TRIAGEM] Erro:', err);
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

async function enviarEmailProblema(devolucao, fotos, usuario) {
  if (!mailer) return;

  const baseUrl = (process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  const linkAdmin = baseUrl ? `${baseUrl}/admin.html` : '/admin.html';

  const fotosHtml = fotos.map((url, i) =>
    `<a href="${url}" target="_blank" style="display:inline-block;margin:4px;text-decoration:none;">
      <img src="${url}" alt="Foto ${i+1}" style="max-width:200px;max-height:200px;border:2px solid #ddd;border-radius:8px;"/>
    </a>`
  ).join('');

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:auto;padding:20px;">
      <h2 style="color:#b00020;">⚠️ Devolucao com PROBLEMA reportada</h2>
      <p><strong>Reportado por:</strong> ${usuario}<br>
         <strong>Quando:</strong> ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>

      <h3 style="border-bottom:1px solid #eee;padding-bottom:5px;">Produto</h3>
      <p><strong>${devolucao.produto_titulo || '-'}</strong><br>
         SKU: ${devolucao.produto_sku || '-'} | MLB: ${devolucao.produto_mlb || '-'}<br>
         Quantidade: ${devolucao.produto_qtd || '-'} un | Valor: R$ ${(devolucao.produto_valor_unit || 0).toFixed(2)}</p>

      <h3 style="border-bottom:1px solid #eee;padding-bottom:5px;">Comprador</h3>
      <p>${devolucao.buyer_nome || '-'} | ID: ${devolucao.buyer_id || '-'}</p>

      <h3 style="border-bottom:1px solid #eee;padding-bottom:5px;">NF-e</h3>
      <p>Numero: <strong>${devolucao.nf_numero || '-'}</strong> | Valor: R$ ${(devolucao.nf_valor || 0).toFixed(2)}<br>
         ${devolucao.nf_link_danfe ? `<a href="${devolucao.nf_link_danfe}">Abrir DANFE</a>` : ''}</p>

      <h3 style="border-bottom:1px solid #eee;padding-bottom:5px;">Descricao do problema</h3>
      <p style="background:#fff8e1;padding:12px;border-radius:8px;border-left:4px solid #f57c00;">
        ${(devolucao.problema_descricao || '').replace(/\n/g, '<br>')}
      </p>

      <h3 style="border-bottom:1px solid #eee;padding-bottom:5px;">Fotos (${fotos.length})</h3>
      ${fotosHtml}

      <p style="margin-top:30px;text-align:center;">
        <a href="${linkAdmin}" style="background:#007AFF;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          🔗 Abrir area admin
        </a>
      </p>

      <p style="margin-top:20px;font-size:11px;color:#888;text-align:center;">
        ID interno: ${devolucao.id}<br>
        Sistema GOOD Devolucoes v3.6
      </p>
    </div>
  `;

  await mailer.sendMail({
    from: `"GOOD Estoque" <${EMAIL_USER}>`,
    to: EMAIL_TO,
    subject: `⚠️ PROBLEMA na devolucao - NF ${devolucao.nf_numero || '?'} - ${devolucao.produto_titulo?.substring(0, 50) || '?'}`,
    html,
  });
}

// ============================================================
// FASE 3: AREA ADMIN
// ============================================================

// Pagina admin (requer auth)
app.get('/admin.html', requerAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API: lista devolucoes pendentes (aprovadas + problemas)
app.get('/api/admin/devolucoes', requerAdmin, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  try {
    const { data, error } = await supabase
      .from('devolucoes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      return res.status(500).json({ ok: false, erro: error.message });
    }

    // Separa por tipo
    const aprovadas = data.filter(d => d.tipo === 'aprovado');
    const problemas = data.filter(d => d.tipo === 'problema');

    return res.json({
      ok: true,
      aprovadas,
      problemas,
      total: data.length,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// API: marcar como concluido
app.put('/api/admin/concluir/:id', requerAdmin, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  try {
    const { error } = await supabase
      .from('devolucoes')
      .update({
        status: 'concluido',
        data_concluido: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    if (error) {
      return res.status(500).json({ ok: false, erro: error.message });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// API: deletar (caso tenha sido criado por engano)
app.delete('/api/admin/devolucao/:id', requerAdmin, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  try {
    const { error } = await supabase
      .from('devolucoes')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ ok: false, erro: error.message });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// ============================================================
// FASE 3: LIMPEZA AUTOMATICA (registros >30 dias)
// ============================================================
async function limparRegistrosAntigos() {
  if (!supabase) return;
  try {
    const limite = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('devolucoes')
      .delete()
      .lt('created_at', limite)
      .select('id, problema_fotos');

    if (error) {
      console.error('[LIMPEZA] Erro:', error.message);
      return;
    }

    // Apaga fotos do storage tambem
    let totalFotosApagadas = 0;
    for (const reg of (data || [])) {
      const fotos = Array.isArray(reg.problema_fotos) ? reg.problema_fotos : [];
      for (const url of fotos) {
        const m = url.match(/\/fotos-problema\/(.+)$/);
        if (m) {
          await supabase.storage.from('fotos-problema').remove([m[1]]).catch(() => {});
          totalFotosApagadas++;
        }
      }
    }

    if ((data || []).length > 0) {
      console.log(`[LIMPEZA] ${data.length} registros + ${totalFotosApagadas} fotos apagados (>30 dias)`);
    }
  } catch (err) {
    console.error('[LIMPEZA] Erro:', err);
  }
}

// Roda 1x ao iniciar e depois 1x por dia
if (supabase) {
  setTimeout(limparRegistrosAntigos, 5000);
  setInterval(limparRegistrosAntigos, 24 * 60 * 60 * 1000);
}

// ============================================================
// INICIAR
// ============================================================
app.listen(PORT, () => {
  console.log('============================================');
  console.log('GOOD Devolucoes v3.8.0 - anti-duplicata + filtros admin');
  console.log(`Porta: ${PORT}`);
  console.log(`ML: ${ML_ACCESS_TOKEN ? 'OK' : 'FALTA'}`);
  console.log(`Bling: ${BLING_ACCESS_TOKEN ? 'OK' : 'FALTA'}`);
  console.log(`Render persist: ${(RENDER_API_KEY && RENDER_SERVICE_ID) ? 'OK' : 'FALTA'}`);
  console.log(`Supabase: ${supabase ? 'OK' : 'FALTA'}`);
  console.log(`Email: ${mailer ? 'OK (' + EMAIL_USER + ' -> ' + EMAIL_TO + ')' : 'FALTA'}`);
  console.log(`Usuarios: ${Object.keys(USERS).length > 0 ? Object.keys(USERS).join(', ') : 'FALTA'}`);
  console.log(`Admin: ${(ADMIN_USER && USERS[ADMIN_USER]) ? `OK (${ADMIN_USER})` : 'FALTA - defina ADMIN_USER e inclua no USERS'}`);
  console.log('============================================');
});
