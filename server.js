// ============================================================
// GOOD Devolucoes - Marketplaces - NFs Bling
// Fase 1: Identificar venda a partir da etiqueta de devolucao
// ============================================================

const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CREDENCIAIS (lidas das Environment Variables do Render)
// ============================================================
const ML_CLIENT_ID = process.env.ML_CLIENT_ID;
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
let ML_ACCESS_TOKEN = process.env.ML_ACCESS_TOKEN;
let ML_REFRESH_TOKEN = process.env.ML_REFRESH_TOKEN;
const ML_USER_ID = process.env.ML_USER_ID;

// Render API - para salvar tokens renovados de volta nas env vars
const RENDER_API_KEY = process.env.RENDER_API_KEY || null;
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || null;

// ============================================================
// CONFIGURACAO EXPRESS
// ============================================================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// HELPER: Renovar token do ML automaticamente
// ============================================================
async function renovarTokenML() {
  console.log('[ML] Renovando access token via refresh token...');
  try {
    const response = await axios.post(
      'https://api.mercadolibre.com/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ML_CLIENT_ID,
        client_secret: ML_CLIENT_SECRET,
        refresh_token: ML_REFRESH_TOKEN,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    ML_ACCESS_TOKEN = response.data.access_token;
    ML_REFRESH_TOKEN = response.data.refresh_token;

    console.log('[ML] Token renovado com sucesso!');
    console.log('[ML] Novo token expira em:', response.data.expires_in, 'segundos');

    // Atualiza no Render se as credenciais estiverem configuradas
    if (RENDER_API_KEY && RENDER_SERVICE_ID) {
      await atualizarTokensNoRender();
    } else {
      console.log('[ML] AVISO: tokens renovados em memoria. Configure RENDER_API_KEY e RENDER_SERVICE_ID para persistencia automatica.');
    }

    return true;
  } catch (error) {
    console.error('[ML] ERRO ao renovar token:', error.response?.data || error.message);
    return false;
  }
}

// ============================================================
// HELPER: Persistir tokens novos no Render (opcional)
// ============================================================
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
    console.log('[Render] Tokens atualizados nas env vars com sucesso!');
  } catch (error) {
    console.error('[Render] Erro ao atualizar env vars:', error.response?.data || error.message);
  }
}

// ============================================================
// HELPER: Fazer chamada ao ML com retry automatico em 401
// ============================================================
async function chamarML(url, headersExtras = {}) {
  const fazerChamada = async () => {
    return axios.get(url, {
      headers: {
        Authorization: `Bearer ${ML_ACCESS_TOKEN}`,
        ...headersExtras,
      },
    });
  };

  try {
    const response = await fazerChamada();
    return { ok: true, data: response.data };
  } catch (error) {
    // Se for 401 (token expirado), tenta renovar e refazer
    if (error.response?.status === 401) {
      console.log('[ML] Token expirado. Tentando renovar...');
      const renovou = await renovarTokenML();
      if (renovou) {
        try {
          const response = await fazerChamada();
          return { ok: true, data: response.data };
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
// ROTA: Health check (pra ver se ta no ar)
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'good-devolucoes-marketplaces-nfsbling',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// ROTA PRINCIPAL: Identificar devolucao por codigo da etiqueta
// Aceita: shipment_id ou pack_id (sistema descobre qual eh)
// ============================================================
app.get('/api/devolucao/identificar/:codigo', async (req, res) => {
  const codigoOriginal = String(req.params.codigo || '').trim();

  if (!codigoOriginal) {
    return res.status(400).json({
      ok: false,
      erro: 'Codigo nao informado',
    });
  }

  console.log(`\n[BUSCA] Codigo recebido: ${codigoOriginal}`);

  // Tenta varios formatos: limpa caracteres especiais, espacos, etc
  const codigoLimpo = codigoOriginal.replace(/[^0-9]/g, '');
  console.log(`[BUSCA] Codigo limpo (so numeros): ${codigoLimpo}`);

  // ============================================================
  // ESTRATEGIA EM CASCATA - tenta varios caminhos
  // ============================================================
  const resultado = {
    codigo_buscado: codigoOriginal,
    codigo_limpo: codigoLimpo,
    tentativas: [],
    encontrado: false,
  };

  // ----- TENTATIVA 1: Buscar como SHIPMENT_ID -----
  // Codigo de barras de envio costuma ter 10-11 digitos
  if (codigoLimpo.length >= 10 && codigoLimpo.length <= 13) {
    console.log(`[TENTATIVA 1] Buscando como shipment_id: ${codigoLimpo}`);
    const r1 = await chamarML(
      `https://api.mercadolibre.com/shipments/${codigoLimpo}`,
      { 'x-format-new': 'true' }
    );

    resultado.tentativas.push({
      tipo: 'shipment_id',
      codigo: codigoLimpo,
      ok: r1.ok,
      status: r1.status || 200,
    });

    if (r1.ok && r1.data?.id) {
      console.log(`[TENTATIVA 1] Sucesso! Shipment encontrado.`);
      const shipment = r1.data;
      const orderId = shipment.order_id;

      let order = null;
      if (orderId) {
        const r2 = await chamarML(`https://api.mercadolibre.com/orders/${orderId}`);
        if (r2.ok) order = r2.data;
      }

      resultado.encontrado = true;
      resultado.metodo = 'shipment_id';
      resultado.shipment = shipment;
      resultado.order = order;
      return res.json(resultado);
    }
  }

  // ----- TENTATIVA 2: Buscar como PACK_ID -----
  // Pack IDs sao mais longos. Etiqueta mostra "20000 12153272513" (15 digitos)
  // Mas as vezes vem so o nucleo "12153272513" (11 digitos), entao testamos com prefixo
  const possiveisPackIds = [];

  // Se ja tem 15+ digitos, usa direto
  if (codigoLimpo.length >= 15) {
    possiveisPackIds.push(codigoLimpo);
  }

  // Se tem 11 digitos, pode ser nucleo de pack_id - testa com prefixo "20000"
  if (codigoLimpo.length === 11) {
    possiveisPackIds.push('20000' + codigoLimpo);
  }

  for (const packId of possiveisPackIds) {
    console.log(`[TENTATIVA 2] Buscando como pack_id: ${packId}`);
    const r = await chamarML(`https://api.mercadolibre.com/packs/${packId}`);

    resultado.tentativas.push({
      tipo: 'pack_id',
      codigo: packId,
      ok: r.ok,
      status: r.status || 200,
    });

    if (r.ok && r.data?.id) {
      console.log(`[TENTATIVA 2] Sucesso! Pack encontrado.`);
      const pack = r.data;
      const orderId = pack.orders?.[0]?.id;
      const shipmentId = pack.shipment?.id;

      let order = null;
      let shipment = null;

      if (orderId) {
        const rOrder = await chamarML(`https://api.mercadolibre.com/orders/${orderId}`);
        if (rOrder.ok) order = rOrder.data;
      }
      if (shipmentId) {
        const rShip = await chamarML(
          `https://api.mercadolibre.com/shipments/${shipmentId}`,
          { 'x-format-new': 'true' }
        );
        if (rShip.ok) shipment = rShip.data;
      }

      resultado.encontrado = true;
      resultado.metodo = 'pack_id';
      resultado.pack = pack;
      resultado.order = order;
      resultado.shipment = shipment;
      return res.json(resultado);
    }
  }

  // ----- NADA ENCONTRADO -----
  console.log(`[BUSCA] Nada encontrado para o codigo ${codigoOriginal}`);
  resultado.erro = 'Codigo nao encontrado em nenhum dos metodos';
  return res.status(404).json(resultado);
});

// ============================================================
// ROTA: Renovar token manualmente (util pra debug)
// ============================================================
app.post('/api/admin/renovar-token', async (req, res) => {
  const ok = await renovarTokenML();
  res.json({
    ok,
    mensagem: ok ? 'Token renovado com sucesso' : 'Falha ao renovar token',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(PORT, () => {
  console.log('============================================');
  console.log('GOOD Devolucoes - Marketplaces - NFs Bling');
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`ML_CLIENT_ID: ${ML_CLIENT_ID ? 'configurado' : 'NAO CONFIGURADO'}`);
  console.log(`ML_ACCESS_TOKEN: ${ML_ACCESS_TOKEN ? 'configurado' : 'NAO CONFIGURADO'}`);
  console.log(`ML_USER_ID: ${ML_USER_ID || 'NAO CONFIGURADO'}`);
  console.log('============================================');
});
