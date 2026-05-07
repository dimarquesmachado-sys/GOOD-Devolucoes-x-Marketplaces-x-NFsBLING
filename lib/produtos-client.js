// ============================================================
// lib/produtos-client.js
// ------------------------------------------------------------
// Cliente unificado pra buscar dados de produto.
//
// Estratégia:
// 1. Pra buscar produto por SKU exato → usa render-bling-api (cache rápido)
// 2. Pra busca textual (autocomplete de "globo" etc) → usa fragil-skus
// 3. Cache em memória de 30 min pra evitar chamadas repetidas
// 4. Fallback: se ambos falharem, retorna null (não quebra)
// ============================================================

const RENDER_BLING_API_URL = process.env.RENDER_BLING_API_URL || 'https://render-bling-api.onrender.com';
const RENDER_BLING_API_KEY = process.env.RENDER_BLING_API_KEY || '';

const FRAGIL_API_URL = process.env.FRAGIL_API_URL || 'https://good-checkout-alerta-fragil-skus.onrender.com';
const FRAGIL_API_KEY = process.env.FRAGIL_API_KEY || ''; // chave compartilhada (vamos adicionar no FRAGIL)

// Cache em memória (id -> {produto, expira})
const TTL_MS = 30 * 60 * 1000; // 30 minutos
const cacheBySku = new Map();
const cacheById = new Map();

function getCacheBySku(sku) {
  const entry = cacheBySku.get(String(sku).toLowerCase());
  if (!entry) return null;
  if (Date.now() > entry.expira) {
    cacheBySku.delete(String(sku).toLowerCase());
    return null;
  }
  return entry.produto;
}

function setCacheBySku(sku, produto) {
  if (!sku || !produto) return;
  cacheBySku.set(String(sku).toLowerCase(), {
    produto,
    expira: Date.now() + TTL_MS,
  });
  if (produto.id) {
    cacheById.set(String(produto.id), {
      produto,
      expira: Date.now() + TTL_MS,
    });
  }
}

/**
 * Busca produto por SKU exato no render-bling-api.
 * Retorna {id, codigo, nome, ean, imagem, custo} ou null.
 */
async function buscarPorSku(sku) {
  if (!sku) return null;
  const skuStr = String(sku).trim();
  if (!skuStr) return null;

  // 1. Cache primeiro
  const cached = getCacheBySku(skuStr);
  if (cached) return cached;

  // 2. Tenta render-bling-api
  try {
    const url = `${RENDER_BLING_API_URL}/buscar?key=${encodeURIComponent(RENDER_BLING_API_KEY)}&tipo=SKU&codigo=${encodeURIComponent(skuStr)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const d = await r.json();
      if (d?.ok && d.produto) {
        const produto = normalizar(d.produto);
        setCacheBySku(skuStr, produto);
        return produto;
      }
    }
  } catch (e) {
    console.warn('[produtos-client] render-bling-api falhou:', e.message);
  }

  // 3. Fallback: tenta fragil-skus (com API_KEY se configurada)
  try {
    if (FRAGIL_API_KEY) {
      const url = `${FRAGIL_API_URL}/api/buscar-public?key=${encodeURIComponent(FRAGIL_API_KEY)}&q=${encodeURIComponent(skuStr)}&limite=5`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const d = await r.json();
        const lista = d?.resultados || [];
        // Tenta match exato
        const match = lista.find(p => String(p.codigo || '').toLowerCase() === skuStr.toLowerCase());
        if (match) {
          const produto = normalizar(match);
          setCacheBySku(skuStr, produto);
          return produto;
        }
      }
    }
  } catch (e) {
    console.warn('[produtos-client] fragil-skus falhou:', e.message);
  }

  return null;
}

/**
 * Busca textual (autocomplete) - usa fragil-skus.
 * Retorna array de produtos.
 */
async function buscarTextual(termo, limite = 20) {
  if (!termo || termo.length < 2) return [];

  if (!FRAGIL_API_KEY) {
    console.warn('[produtos-client] FRAGIL_API_KEY nao configurada, busca textual desabilitada');
    return [];
  }

  try {
    const url = `${FRAGIL_API_URL}/api/buscar-public?key=${encodeURIComponent(FRAGIL_API_KEY)}&q=${encodeURIComponent(termo)}&limite=${limite}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const d = await r.json();
    const lista = d?.resultados || [];
    return lista.map(normalizar);
  } catch (e) {
    console.warn('[produtos-client] busca textual falhou:', e.message);
    return [];
  }
}

/**
 * Busca em lote por SKUs. Usa cache + chamadas paralelas com limite.
 * @param {string[]} skus
 * @returns {Promise<Map<string, object>>} Map de SKU -> produto
 */
async function buscarLote(skus) {
  const result = new Map();
  if (!Array.isArray(skus) || skus.length === 0) return result;

  // Dedup
  const unicos = [...new Set(skus.filter(Boolean).map(s => String(s).trim()).filter(Boolean))];

  // Processa em batches de 5 (paralelo)
  const BATCH = 5;
  for (let i = 0; i < unicos.length; i += BATCH) {
    const fatia = unicos.slice(i, i + BATCH);
    const promises = fatia.map(async sku => {
      const p = await buscarPorSku(sku);
      if (p) result.set(sku, p);
    });
    await Promise.all(promises);
  }

  return result;
}

/**
 * Extrai custo unitário do produto Bling. 
 * Custo fica em fornecedores[] - preciso do ativo (que tem alguma flag).
 */
function extrairCustoBling(produtoCompleto) {
  if (!produtoCompleto) return null;

  // 1. Campo direto (preco_custo, precoCusto)
  const direto = produtoCompleto.precoCusto ?? produtoCompleto.preco_custo;
  if (direto !== undefined && direto !== null && Number(direto) > 0) {
    return Number(direto);
  }

  // 2. Tributacao -> precoCusto (alguns produtos)
  const trib = produtoCompleto?.tributacao?.precoCusto;
  if (trib !== undefined && trib !== null && Number(trib) > 0) {
    return Number(trib);
  }

  // 3. fornecedores[] - pega o ativo (a "bolinha verde" do Bling)
  const fornecedores = produtoCompleto?.fornecedores || [];
  if (Array.isArray(fornecedores) && fornecedores.length > 0) {
    // Primeiro tenta achar fornecedor "ativo" ou "padrao"
    const ativo = fornecedores.find(f =>
      f?.ativo === true ||
      f?.padrao === true ||
      f?.principal === true
    );
    if (ativo && Number(ativo.precoCusto || 0) > 0) {
      return Number(ativo.precoCusto);
    }
    // Senao pega o primeiro com custo > 0
    const primeiro = fornecedores.find(f => Number(f?.precoCusto || 0) > 0);
    if (primeiro) return Number(primeiro.precoCusto);
  }

  return null;
}

/**
 * Normaliza produto vindo de qualquer fonte pra formato unificado.
 */
function normalizar(p) {
  if (!p) return null;
  return {
    id: p.id || null,
    sku: p.codigo || p.sku || '',
    nome: p.nome || p.descricao || '',
    ean: p.ean || p.gtin || '',
    imagem: p.imagem || '',
    custo: p.custo ?? p.precoCusto ?? null,
    // Mantem objeto original pra extrair mais coisas se precisar
    raw: p,
  };
}

module.exports = {
  buscarPorSku,
  buscarTextual,
  buscarLote,
  extrairCustoBling,
  // pra testes/diagnostico
  _cache: { cacheBySku, cacheById },
  isConfigured: () => !!(RENDER_BLING_API_KEY || FRAGIL_API_KEY),
};
