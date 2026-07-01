// ============================================================
// lib/bling.js
// ------------------------------------------------------------
// Cliente Bling ERP v3.
// - renovarTokenBling: refresh OAuth
// - chamarBling: GET/POST com retry de 401 e 429
// - buscarPedidoBlingPorNumeroLoja: paginar /pedidos/vendas
// - buscarPedidoBlingPorId: GET /pedidos/vendas/{id}
// - buscarNFePorId: GET /nfe/{id}
// - buscarProdutoBlingPorSku: produto + EAN
// - buscarNFnoBlingPorNumero: paginar /nfe por numero
// - buscarNFnoBlingPorOrderId: paginar /nfe por numeroPedidoLoja
// ============================================================

const axios = require('axios');
const { atualizarTokensNoRender } = require('./render-tokens');

const BLING_CLIENT_ID = process.env.BLING_CLIENT_ID;
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET;
let BLING_ACCESS_TOKEN = process.env.BLING_ACCESS_TOKEN;
let BLING_REFRESH_TOKEN = process.env.BLING_REFRESH_TOKEN;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// AUTH
// ============================================================
async function renovarTokenBling() {
  console.log('[Bling] Renovando access token...');
  try {
    const basicAuth = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64');
    const response = await axios.post(
      'https://api.bling.com.br/Api/v3/oauth/token',
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

// ============================================================
// Reconexao: troca um authorization_code por access+refresh token
// (usado quando escopos do app mudam e precisa reautorizar)
// ============================================================
async function trocarCodePorTokenBling(code) {
  const basicAuth = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64');
  const response = await axios.post(
    'https://api.bling.com.br/Api/v3/oauth/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
    }).toString(),
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '1.0',
      },
    }
  );
  BLING_ACCESS_TOKEN = response.data.access_token;
  if (response.data.refresh_token) BLING_REFRESH_TOKEN = response.data.refresh_token;
  await atualizarTokensNoRender([
    { key: 'BLING_ACCESS_TOKEN', value: BLING_ACCESS_TOKEN },
    { key: 'BLING_REFRESH_TOKEN', value: BLING_REFRESH_TOKEN },
  ]);
  return response.data; // { access_token, refresh_token, scope, expires_in, ... }
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

// ============================================================
// PEDIDOS (vendas)
// ============================================================

/**
 * Busca pedido por numeroLoja (= order_id ML). Pagina ate achar ou estourar limite.
 * @param {string|number} numeroLoja  order_id ML
 * @param {string|Date} [dataReferencia]  data pra cortar busca depois de DIAS_FOLGA dias antes dela
 * @param {{maxPaginas?:number}} [opcoes]
 * @returns {Promise<{ok:boolean, match:object|null, pagina?:number, totalScanned:number, primeiraDataVista:string|null, ultimaDataVista:string|null, status?:number, error?:any}>}
 */
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
    const url = `https://api.bling.com.br/Api/v3/pedidos/vendas?limite=${LIMITE_PAGINA}&pagina=${pagina}`;
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
  return chamarBling(`https://api.bling.com.br/Api/v3/pedidos/vendas/${idPedido}`);
}

// ============================================================
// NFe
// ============================================================
async function buscarNFePorId(idNFe) {
  return chamarBling(`https://api.bling.com.br/Api/v3/nfe/${idNFe}`);
}

/**
 * Busca NF no Bling pelo numero. Pagina /nfe ate achar.
 */
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

/**
 * Pagina /nfe procurando por numeroPedidoLoja=order_id ML.
 * Vantagem: NFs nao somem mesmo se o pedido for cancelado depois.
 * E se acharmos a NF aqui, ja temos linkDanfe direto sem precisar buscar pedido.
 */
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
    const url = `https://api.bling.com.br/Api/v3/nfe?limite=${LIMITE_PAGINA}&pagina=${pagina}&tipo=1`;
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
// PRODUTOS
// ============================================================

/**
 * Busca produto por SKU/codigo. Retorna detalhes completos (com EAN).
 * Licoes do projeto Localizacao Estoque GOOD: produtos com variacoes tem
 * codigo='COR:DOURADO' na listagem, EAN em varios campos diferentes.
 */
async function buscarProdutoBlingPorSku(sku) {
  const skuClean = String(sku).trim();
  if (!skuClean) return { ok: true, produto: null };

  const skuEnc = encodeURIComponent(skuClean);
  // Aumenta limite pra pegar produtos pai+filhos (variacoes)
  const url = `https://api.bling.com.br/Api/v3/produtos?codigo=${skuEnc}&limite=20`;
  const r = await chamarBling(url);
  if (!r.ok) return { ok: false, error: r.error };

  const lista = r.data?.data || [];
  if (lista.length === 0) return { ok: true, produto: null };

  // 1) Tenta match EXATO pelo codigo (case-sensitive)
  let match = lista.find(p => String(p.codigo || '').trim() === skuClean);

  // 2) Tenta match case-insensitive (estoquista pode ter mudado caixa)
  if (!match) {
    const skuUpper = skuClean.toUpperCase();
    match = lista.find(p => String(p.codigo || '').trim().toUpperCase() === skuUpper);
  }

  // 3) Ultima tentativa: pega o primeiro
  if (!match) match = lista[0];

  // Busca detalhes individuais (EAN so vem aqui)
  if (match.id) {
    await sleep(300); // evita rate limit
    const rDetalhe = await chamarBling(`https://api.bling.com.br/Api/v3/produtos/${match.id}`);
    if (rDetalhe.ok && rDetalhe.data?.data) {
      return { ok: true, produto: rDetalhe.data.data };
    }
  }

  return { ok: true, produto: match };
}

/**
 * v3.19 - BUSCA BLINDADA DE NF (janela de datas)
 * ------------------------------------------------------------
 * Em vez de varrer /nfe ou /pedidos do presente pro passado (que
 * estoura o limite de paginas quando a venda e antiga), consulta
 * DIRETO a janela de datas da venda (dataEmissaoInicial/Final).
 * Ordem de tentativas:
 *  1. /nfe na janela, match por numeroPedidoLoja=orderId (a prova
 *     de serie 1 vs 2) e, em falta, por numero(+serie) da NF.
 *  2. /pedidos/vendas na janela, match numeroLoja -> notaFiscal.id.
 *  3. Fundo: varredura antiga por orderId (limitada) - ultimo recurso.
 * Retorna { ok, via, nf (objeto completo), idNF } ou { ok:false, tentado[] }.
 */
async function buscarNFBlindada(opts = {}) {
  const orderId = opts.orderId != null ? String(opts.orderId).trim() : null;
  const numeroNF = opts.numeroNF != null ? String(opts.numeroNF).trim() : null;
  const serieNF = opts.serieNF != null && String(opts.serieNF).trim() !== '' ? String(opts.serieNF).trim() : null;
  const LIMITE = 100;
  const DELAY_MS = 400;
  const MAXP_JANELA = opts.maxPaginasJanela || 6;
  const tentado = [];

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

  const bateOrder = (nf) => orderId && String(nf.numeroPedidoLoja || '').trim() === orderId;
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
    return { ok: true, via, nf, idNF: String(idNF) };
  }

  // ---- FASE 1: /nfe com janela de datas ----
  if (ini && fim) {
    console.log(`[Bling/blindada] /nfe janela ${ini}..${fim} orderId=${orderId || '-'} numero=${numeroNF || '-'}${serieNF ? '/s' + serieNF : ''}`);
    for (let pg = 1; pg <= MAXP_JANELA; pg++) {
      if (pg > 1) await sleep(DELAY_MS);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=${LIMITE}&pagina=${pg}&tipo=1&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) { tentado.push(`nfe-janela pg${pg}: HTTP ${r.status}`); break; }
      const lista = r.data?.data || [];
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
  if (orderId && ini && fim) {
    for (let pg = 1; pg <= MAXP_JANELA; pg++) {
      await sleep(DELAY_MS);
      const url = `https://api.bling.com.br/Api/v3/pedidos/vendas?limite=${LIMITE}&pagina=${pg}&dataInicial=${ini}&dataFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) { tentado.push(`pedidos-janela pg${pg}: HTTP ${r.status}`); break; }
      const lista = r.data?.data || [];
      if (lista.length === 0) { tentado.push(`pedidos-janela: vazio (pg${pg})`); break; }
      const m = lista.find(p => String(p.numeroLoja || '').trim() === orderId);
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
  if (orderId) {
    const r = await buscarNFnoBlingPorOrderId(orderId, opts.dataReferencia || null, { maxPaginas: opts.maxPaginasFundo || 20 });
    if (r.ok && r.match) return completar(r.match.id, 'nfe-fundo-orderId');
    tentado.push(`nfe-fundo: ${r.totalScanned || 0} NFs varridas sem match`);
  }

  console.log('[Bling/blindada] NAO ACHOU:', tentado.join(' | '));
  return { ok: false, tentado };
}

module.exports = {
  // Auth
  chamarBling,
  renovarTokenBling,

  // Pedidos
  buscarPedidoBlingPorNumeroLoja,
  buscarPedidoBlingPorId,

  // NFe
  buscarNFePorId,
  buscarNFnoBlingPorNumero,
  buscarNFnoBlingPorOrderId,
  buscarNFBlindada,

  // Produtos
  buscarProdutoBlingPorSku,

  // Status
  hasToken: () => !!BLING_ACCESS_TOKEN,

  // Reconexao (reautorizar apos mudar escopos)
  trocarCodePorTokenBling,
};
