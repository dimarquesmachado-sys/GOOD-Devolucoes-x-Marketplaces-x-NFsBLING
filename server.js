// ============================================================
// GOOD Devolucoes - Marketplaces - NFs
// Fase 3.6: Triagem (estoquista), area admin, email, fotos
// ============================================================

const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// === ML / Bling / Render (Fase 1+2) ===
// Movidos para modulos em lib/ na v3.15.3
const blingClient = require('./lib/bling');
const mlClient = require('./lib/ml');

// v3.16.0 - Dashboard de relatorios
const registrarRotasRelatorios = require('./lib/rotas-relatorios');

// Re-exports pra manter mesma sintaxe nas chamadas existentes
const chamarBling = blingClient.chamarBling;
const renovarTokenBling = blingClient.renovarTokenBling;
const buscarPedidoBlingPorNumeroLoja = blingClient.buscarPedidoBlingPorNumeroLoja;
const buscarPedidoBlingPorId = blingClient.buscarPedidoBlingPorId;
const buscarNFePorId = blingClient.buscarNFePorId;
const buscarNFnoBlingPorNumero = blingClient.buscarNFnoBlingPorNumero;
const buscarNFnoBlingPorOrderId = blingClient.buscarNFnoBlingPorOrderId;
const buscarNFBlindada = blingClient.buscarNFBlindada;

// v3.30 - itens da NF no formato salvo em devolucoes.nf_itens (jsonb)
function mapItensNF(nf) {
  return (nf && Array.isArray(nf.itens)) ? nf.itens.map(it => ({
    titulo: it.descricao || null,
    sku: it.codigo || null,
    quantidade: it.quantidade || null,
    valor: it.valor || null,
  })) : null;
}

// v3.31.1 - acha o ID Bling de uma NF de VENDA usando a chave de acesso.
// Estrategia: numeros de NF sao SEQUENCIAIS no tempo -> busca binaria
// pelo DIA dentro do mes da chave (AAMM, pos. 3-6): sonda um dia,
// compara os numeros, divide o mes ao meio (~5-7 requisicoes, qualquer
// volume). Plano B: varre o mes inteiro (ate 30 paginas).
async function resolverIdNFPorChave(numero, chaveBruta) {
  const chave = String(chaveBruta || '').replace(/\D/g, '');
  const alvoStr = String(numero || '').replace(/^0+/, '');
  const alvoInt = parseInt(alvoStr, 10);
  if (chave.length !== 44 || !alvoStr || isNaN(alvoInt)) return null;
  const ano = 2000 + parseInt(chave.substr(2, 2), 10);
  const mes = parseInt(chave.substr(4, 2), 10);
  const serieChave = String(parseInt(chave.substr(22, 3), 10));
  if (!(mes >= 1 && mes <= 12)) return null;

  const DIA_MS = 864e5;
  const f = (t) => new Date(t).toISOString().slice(0, 10);
  const t0 = Date.UTC(ano, mes - 1, 1);
  const t1 = Date.UTC(ano, mes, 0) + 5 * DIA_MS; // +5d de folga

  const bateSerie = (nf) => nf.serie == null || String(parseInt(nf.serie, 10)) === serieChave;
  const bateNumero = (nf) => String(nf.numero || '').replace(/^0+/, '') === alvoStr && bateSerie(nf);

  async function pagDia(dia, pg) {
    const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=1&dataEmissaoInicial=${dia}&dataEmissaoFinal=${dia}`;
    const r = await chamarBling(url);
    return r.ok ? (r.data?.data || []) : null;
  }

  // Sonda: menor/maior numero da serie-alvo na pagina 1 do dia
  const cache = {};
  async function sondaDia(t) {
    const dia = f(t);
    if (cache[dia]) return cache[dia];
    await sleep(350);
    const lista = await pagDia(dia, 1);
    if (lista === null) return (cache[dia] = { erro: true });
    const nums = lista.filter(bateSerie)
      .map(nf => parseInt(String(nf.numero || '').replace(/^0+/, ''), 10))
      .filter(n => !isNaN(n));
    if (nums.length === 0) return (cache[dia] = { vazio: true });
    return (cache[dia] = { min: Math.min(...nums), max: Math.max(...nums), cheia: lista.length === 100 });
  }

  // ---- BUSCA BINARIA pelo dia ----
  let lo = t0, hi = t1, diaAlvo = null;
  for (let passo = 0; passo < 12 && lo <= hi; passo++) {
    let midT = Math.floor(((lo + hi) / 2) / DIA_MS) * DIA_MS;
    let a = await sondaDia(midT);
    // Dia sem NF (fim de semana etc): tenta vizinhos +-1..3 dentro do range
    for (let off = 1; a && a.vazio && off <= 3; off++) {
      const candidatos = [midT + off * DIA_MS, midT - off * DIA_MS].filter(t => t >= lo && t <= hi);
      for (const t of candidatos) {
        const b = await sondaDia(t);
        if (b && !b.vazio && !b.erro) { a = b; midT = t; break; }
      }
      if (a && !a.vazio) break;
    }
    if (!a || a.erro) break;
    if (a.vazio) { hi = midT - DIA_MS; continue; } // regiao morta: encolhe
    if (alvoInt >= a.min && alvoInt <= a.max) { diaAlvo = midT; break; }
    if (alvoInt < a.min) { hi = midT - DIA_MS; } else { lo = midT + DIA_MS; }
  }

  // Dia achado: pagina o dia (e vizinhos, por seguranca de borda)
  if (diaAlvo != null) {
    for (const dd of [0, 1, -1]) {
      const dia = f(diaAlvo + dd * DIA_MS);
      for (let pg = 1; pg <= 4; pg++) {
        await sleep(350);
        const lista = await pagDia(dia, pg);
        if (lista === null || lista.length === 0) break;
        const m = lista.find(bateNumero);
        if (m) { console.log(`[resolverIdNFPorChave] ${alvoStr}: achou por bissecao (${dia})`); return String(m.id); }
        if (lista.length < 100) break;
      }
      if (dd === 0 && !cache[f(diaAlvo)]?.cheia) break; // dia nao lotado: vizinhos desnecessarios
    }
  }

  // ---- PLANO B: varre o mes inteiro (ate 30 paginas) ----
  const ini = f(t0 - 2 * DIA_MS), fim = f(t1);
  console.log(`[resolverIdNFPorChave] ${alvoStr}: bissecao nao cravou, varrendo ${ini}..${fim}`);
  for (let pg = 1; pg <= 30; pg++) {
    await sleep(350);
    const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=1&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
    const r = await chamarBling(url);
    if (!r.ok) break;
    const lista = r.data?.data || [];
    if (lista.length === 0) break;
    const m = lista.find(bateNumero);
    if (m) { console.log(`[resolverIdNFPorChave] ${alvoStr}: achou no plano B (pg${pg})`); return String(m.id); }
    if (lista.length < 100) break;
  }
  return null;
}
const buscarProdutoBlingPorSku = blingClient.buscarProdutoBlingPorSku;
const trocarCodePorTokenBling = blingClient.trocarCodePorTokenBling;
const chamarML = mlClient.chamarML;
const renovarTokenML = mlClient.renovarTokenML;
const buscarNFnoML = mlClient.buscarNFnoML;

const ML_USER_ID = process.env.ML_USER_ID;

// === FASE 3: Supabase + Email + Auth ===
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

// ============================================================
// v3.33 - SHOPEE: devolucoes via proxy interno do shopee-nf-sync
// (la vivem os tokens saudaveis da loja; aqui so consultamos).
const SHOPEE_PROXY_URL = (process.env.SHOPEE_PROXY_URL || '').replace(/\/+$/, '');
const SHOPEE_PROXY_KEY = process.env.SHOPEE_PROXY_KEY || '';
const SHOPEE_LOJA_KEY = process.env.SHOPEE_LOJA_KEY || 'good';

let _shopeeDevCache = { ts: 0, dados: [] };

async function buscarDevolucoesShopeeProxy(forcar) {
  if (!SHOPEE_PROXY_URL || !SHOPEE_PROXY_KEY) return null; // integracao desligada
  const idade = Date.now() - _shopeeDevCache.ts;
  if (!forcar && _shopeeDevCache.ts > 0 && idade < 5 * 60 * 1000) {
    return _shopeeDevCache.dados;
  }
  const url = `${SHOPEE_PROXY_URL}/${SHOPEE_LOJA_KEY}/interno/devolucoes${forcar ? '?refresh=1' : ''}`;
  const r = await fetch(url, { headers: { 'x-internal-key': SHOPEE_PROXY_KEY } });
  const d = await r.json().catch(() => null);
  if (!d || !d.ok) {
    throw new Error('proxy shopee: ' + (d && d.erro ? d.erro : 'HTTP ' + r.status));
  }
  _shopeeDevCache = { ts: Date.now(), dados: d.devolucoes || [] };
  return _shopeeDevCache.dados;
}

const normShopee = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function acharDevolucaoShopee(codigo) {
  // v3.34.3: retorna diagnostico junto -> { hit, qtd, exemplo, usouRefresh }
  // qtd = -1 significa integracao sem as variaveis (proxy desligado)
  const vazio = { hit: null, qtd: -1, exemplo: null, usouRefresh: false };
  const alvo = normShopee(codigo);
  if (!alvo || alvo.length < 6) return vazio;
  const alvoDig = String(codigo).replace(/\D/g, '');
  const mTok = String(codigo).toUpperCase().match(/BR[A-Z0-9]{9,}/);
  const alvoTok = mTok ? mTok[0] : null;
  let lista = await buscarDevolucoesShopeeProxy(false);
  if (lista === null) return vazio;
  const casa = (d) => [d.tracking_number, d.return_sn, d.order_sn].some(v => {
    if (!v) return false;
    const nv = normShopee(v);
    if (nv === alvo) return true;
    if (alvoTok && nv === alvoTok) return true; // token SPX dentro de URL/QR
    // leitor/camera que comeu as letras: compara so os digitos (>=10 evita
    // colidir com order_sn, que tem poucos digitos)
    const dv = String(v).replace(/\D/g, '');
    return alvoDig.length >= 10 && dv.length >= 10 && dv === alvoDig;
  });
  let hit = lista.find(casa);
  let usouRefresh = false;
  if (!hit) {
    // etiqueta de devolucao recem-criada pode nao estar no cache: fura 1x
    usouRefresh = true;
    lista = await buscarDevolucoesShopeeProxy(true);
    hit = lista.find(casa);
  }
  const exemplo = lista[0]
    ? (lista[0].tracking_number || lista[0].return_sn || lista[0].order_sn)
    : null;
  return { hit: hit || null, qtd: lista.length, exemplo, usouRefresh };
}

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
  // Tenta varias formas - inclui claims fechados (status nao filtrado)
  const tentativas = [
    `https://api.mercadolibre.com/post-purchase/v1/claims/search?resource=shipment&resource_id=${shipmentId}`,
    `https://api.mercadolibre.com/post-purchase/v1/claims/search?shipment_id=${shipmentId}`,
    `https://api.mercadolibre.com/post-purchase/v1/claims/search?resource=shipment&resource_id=${shipmentId}&status=closed`,
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

// NOVO v3.13: pra shipment com tags=claims_return mas sem order_id direto
// Tenta buscar a order original via endpoint /shipments/{id}/orders
async function buscarOrderViaShipmentReturn(shipmentId) {
  const tentativas = [
    // Endpoint que retorna a(s) order(s) vinculadas ao shipment
    `https://api.mercadolibre.com/shipments/${shipmentId}/orders`,
    // Alternativo - shipment items com expand de pack
    `https://api.mercadolibre.com/shipments/${shipmentId}/items`,
  ];
  for (const url of tentativas) {
    const r = await chamarML(url);
    if (r.ok && r.data) {
      // Busca order_id em varios formatos possiveis de resposta
      const possiveis = [
        r.data?.order_id,
        r.data?.id,
        r.data?.[0]?.order_id,
        r.data?.[0]?.id,
        r.data?.results?.[0]?.id,
        r.data?.orders?.[0]?.id,
      ].filter(Boolean);

      if (possiveis.length > 0) {
        return { ok: true, orderId: String(possiveis[0]), raw: r.data, url };
      }
    }
  }
  return { ok: false };
}

async function buscarClaimDetalhada(claimId) {
  return chamarML(`https://api.mercadolibre.com/post-purchase/v1/claims/${claimId}`);
}

async function buscarReturnPorClaim(claimId) {
  return chamarML(`https://api.mercadolibre.com/post-purchase/v2/claims/${claimId}/returns`);
}

async function buscarOrdersPorComprador(buyerId, sellerId) {
  // Limita a 20 mais recentes pra nao pegar venda antiga aleatoria
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
    version: '3.38 (shopee + fila + fotos)',
    integrations: {
      ml: mlClient.hasToken(),
      bling: blingClient.hasToken(),
      render_persist: !!(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID),
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
// v3.18.1 - KEEPALIVE: rota publica que toca no Supabase
// Pra evitar que o projeto free-tier pause apos 7 dias de inatividade.
// Configurar cron-job.org pra bater nessa URL a cada 3-5 dias.
// Faz um SELECT minimo (count) na tabela devolucoes - rapido e barato.
// ============================================================
app.get('/api/keepalive', async (req, res) => {
  const inicio = Date.now();
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  try {
    // Query minima que toca no banco (count nao baixa dados, so contagem)
    const { count, error } = await supabase
      .from('devolucoes')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('[KEEPALIVE] erro:', error.message);
      return res.status(500).json({ ok: false, erro: error.message });
    }

    const tempoMs = Date.now() - inicio;
    console.log(`[KEEPALIVE] OK - ${count} devolucoes no banco - ${tempoMs}ms`);
    return res.json({
      ok: true,
      total_devolucoes: count,
      tempo_ms: tempoMs,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[KEEPALIVE] erro:', err.message);
    return res.status(500).json({ ok: false, erro: err.message });
  }
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

  // ===== CHAVE NF-e (v3.34): bipou a chave de 44 digitos da DANFE =====
  // Cobre devolucao com a embalagem original (qualquer marketplace) e o
  // caso Shopee "recusa/insucesso" que volta com a etiqueta de IDA.
  if (!shipment && !pack && codigoLimpo.length === 44) {
    const modelo = codigoLimpo.substr(20, 2);
    if (modelo !== '55') {
      // DACE/DC-e do transporte (modelo 99) e afins: nao e a NF do produto
      resultado.erro = `Isso e uma chave de documento de TRANSPORTE (modelo ${modelo}), nao a NF do produto. Bipe a chave da DANFE do produto ou o codigo de rastreio.`;
      resultado.tentativas.push({ tipo: 'chave_danfe', codigo: codigoLimpo, ok: false, status: 422 });
      return res.status(404).json(resultado);
    }
    const numeroDaChave = String(parseInt(codigoLimpo.substr(25, 9), 10));
    const serieDaChave = String(parseInt(codigoLimpo.substr(22, 3), 10));
    console.log(`[BUSCA] CHAVE DANFE: serie=${serieDaChave} numero=${numeroDaChave}`);
    let idNF = null;
    try { idNF = await resolverIdNFPorChave(numeroDaChave, codigoLimpo); } catch (e) { idNF = null; }
    resultado.tentativas.push({ tipo: 'chave_danfe', codigo: codigoLimpo, ok: !!idNF, status: idNF ? 200 : 404 });
    if (!idNF) {
      resultado.erro = `Chave lida, mas a NF ${numeroDaChave} (serie ${serieDaChave}) nao foi localizada no Bling.`;
      return res.status(404).json(resultado);
    }
    const rFullNF = await buscarNFePorId(idNF);
    const nfCh = (rFullNF.ok && rFullNF.data?.data) ? rFullNF.data.data : null;
    if (!nfCh) {
      resultado.erro = `NF ${numeroDaChave} achada (id ${idNF}) mas falhou ao carregar do Bling.`;
      return res.status(404).json(resultado);
    }
    const itensCh = Array.isArray(nfCh.itens) ? nfCh.itens.map(it => ({
      titulo: it.descricao || null,
      sku: it.codigo || null,
      ean: it.gtin || null,
      quantidade: it.quantidade || null,
      valor: it.valor || null,
      unidade: it.unidade || null,
    })) : [];
    resultado.nf = {
      fonte: 'bling',
      numero: nfCh.numero,
      serie: nfCh.serie,
      chaveAcesso: nfCh.chaveAcesso || codigoLimpo,
      valor: nfCh.valorNota,
      dataEmissao: nfCh.dataEmissao,
      linkDanfe: nfCh.linkDanfe,
      linkPdf: nfCh.linkPDF,
      linkXml: nfCh.xml,
      idBling: nfCh.id,
      numeroPedidoLoja: nfCh.numeroPedidoLoja,
      situacao: nfCh.situacao,
      itens: itensCh,
    };
    const nomeClienteCh = (nfCh.contato && nfCh.contato.nome) ? nfCh.contato.nome : null;
    const primeiroCh = itensCh.length ? itensCh[0] : null;
    resultado.order = {
      id: nfCh.numeroPedidoLoja || null,
      pack_id: null,
      buyer: { id: null, first_name: nomeClienteCh, last_name: '', nickname: null },
      order_items: primeiroCh
        ? [{ unit_price: Number(primeiroCh.valor) || null, quantity: null, item: { id: null, title: null, seller_sku: null } }]
        : [],
    };
    resultado.shipment = { id: null };
    resultado.encontrado = true;
    resultado.metodo = 'chave_danfe';
    resultado.eh_devolucao = true;
    resultado.avisos.push({ tipo: 'nf_via_chave', mensagem: `NF ${nfCh.numero} localizada pela chave da DANFE (bissecao)` });
    console.log(`[BUSCA] OK (CHAVE) | NF=${nfCh.numero} pedido=${nfCh.numeroPedidoLoja || '-'}`);
    return res.json(resultado);
  }

  // ===== SHOPEE (v3.33): tenta casar como etiqueta de devolucao Shopee =====
  if (!shipment && !pack) {
    let devShopee = null;
    let infoShopee = null;
    if (SHOPEE_PROXY_URL && SHOPEE_PROXY_KEY) {
      try {
        infoShopee = await acharDevolucaoShopee(codigoOriginal);
        devShopee = infoShopee.hit;
        resultado.tentativas.push({
          tipo: 'shopee_return', v: '3.34.3', codigo: codigoOriginal,
          ok: !!devShopee, status: devShopee ? 200 : 404,
          lista_qtd: infoShopee.qtd, exemplo_tracking: infoShopee.exemplo,
        });
      } catch (e) {
        resultado.tentativas.push({ tipo: 'shopee_return', v: '3.34.3', codigo: codigoOriginal, ok: false, status: 500, erro: e.message || String(e) });
        console.error('[BUSCA][shopee] proxy falhou:', e.message || e);
      }
    } else {
      // v3.34.3: mesmo desligada, a tentativa aparece e se explica
      resultado.tentativas.push({ tipo: 'shopee_return', v: '3.34.3', codigo: codigoOriginal, ok: false, status: 0, erro: 'SHOPEE_PROXY_URL/SHOPEE_PROXY_KEY ausentes no Render deste servico' });
    }
    if (!devShopee) {
      const pareceSPX = /^BR[A-Z0-9]{8,}$/i.test(String(codigoOriginal).trim());
      const diag = infoShopee
        ? ` [diag: lista com ${infoShopee.qtd} devolucoes; exemplo de tracking: ${infoShopee.exemplo || '-'}]`
        : ' [diag: integracao Shopee SEM as variaveis no Render!]';
      resultado.erro = (pareceSPX
        ? 'Etiqueta Shopee (SPX) nao casou com as devolucoes. Tente: digitar o "Pedido" impresso na etiqueta (ex: 260527FMTSJM8C), ou bipar a chave da DANFE se o pacote voltou com a nota.'
        : 'Codigo nao encontrado em shipments/packs do ML nem nas devolucoes Shopee.') + diag;
      return res.status(404).json(resultado);
    }

    console.log(`[BUSCA] SHOPEE: return_sn=${devShopee.return_sn} order_sn=${devShopee.order_sn} tracking=${devShopee.tracking_number}`);

    // NF pela blindada: order_sn da Shopee = numeroLoja da NF serie 1 (Fase 0 direto)
    let nfData = null;
    let nomeCliente = null;
    const rBlind = await buscarNFBlindada({
      orderIds: [devShopee.order_sn],
      dataReferencia: devShopee.create_time
        ? new Date(devShopee.create_time * 1000).toISOString().slice(0, 10)
        : null,
      janelaDias: 60,
    });
    if (rBlind.ok && rBlind.nf) {
      const nf = rBlind.nf;
      const itensBling = Array.isArray(nf.itens) ? nf.itens.map(it => ({
        titulo: it.descricao || null,
        sku: it.codigo || null,
        ean: it.gtin || null,
        quantidade: it.quantidade || null,
        valor: it.valor || null,
        unidade: it.unidade || null,
      })) : [];
      nfData = {
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
        situacao: nf.situacao,
        itens: itensBling,
      };
      nomeCliente = (nf.contato && nf.contato.nome) ? nf.contato.nome : null;
      resultado.avisos.push({
        tipo: 'nf_via_blindada',
        mensagem: `NF ${nf.numero} achada via busca blindada (${rBlind.via})`,
      });
      console.log(`[BUSCA][shopee] BLINDADA SUCESSO: NF=${nf.numero} via=${rBlind.via}`);
    } else {
      resultado.avisos.push({
        tipo: 'sem_nf',
        mensagem: `Devolucao Shopee ${devShopee.return_sn} localizada, mas a NF do pedido ${devShopee.order_sn} nao foi achada no Bling`,
      });
    }

    // order/shipment "minimos" no formato que o frontend ja entende
    // (NF-first cobre titulo/SKU/EAN/qtd; aqui vai cliente + valor + ids)
    const primeiroItem = nfData && nfData.itens.length ? nfData.itens[0] : null;
    resultado.order = {
      id: devShopee.order_sn,
      pack_id: null,
      buyer: { id: null, first_name: nomeCliente, last_name: '', nickname: 'SHOPEE' },
      order_items: primeiroItem
        ? [{ unit_price: Number(primeiroItem.valor) || null, quantity: null, item: { id: null, title: null, seller_sku: null } }]
        : [],
    };
    resultado.shipment = { id: devShopee.tracking_number || devShopee.return_sn || null };
    resultado.encontrado = true;
    resultado.metodo = 'shopee_return';
    resultado.marketplace = 'shopee';
    resultado.eh_devolucao = true;
    resultado.shopee = devShopee;
    resultado.nf = nfData;
    console.log(`[BUSCA] OK (SHOPEE) | NF=${nfData ? nfData.numero : 'nao'}`);
    return res.json(resultado);
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

  // NOVO v3.13: pra shipment de devolucao SEM order_id direto
  // Tenta buscar order via /shipments/{id}/orders ou /items
  if (!order && ehDevolucao && shipment?.id) {
    const rRetOrder = await buscarOrderViaShipmentReturn(shipment.id);
    resultado.tentativas.push({
      tipo: 'shipment_orders_return',
      codigo: shipment.id,
      ok: rRetOrder.ok, status: rRetOrder.ok ? 200 : 404,
      url_que_funcionou: rRetOrder.url || null,
    });
    if (rRetOrder.ok && rRetOrder.orderId) {
      const rOrder = await chamarML(`https://api.mercadolibre.com/orders/${rRetOrder.orderId}`);
      if (rOrder.ok) {
        order = rOrder.data;
        resultado.avisos.push({
          tipo: 'order_via_shipment_return',
          mensagem: `Order ${rRetOrder.orderId} achada via shipment de devolucao`,
        });
      }
    }
  }

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

        // 1) Match exato por shipment.id (se a venda tem o mesmo shipment ASSOCIADO)
        if (shipment?.id) {
          bestMatch = orders.find(o => String(o.shipping?.id) === String(shipment.id));
        }

        // 2) NOVO v3.13: Match por valor declarado E que tenha mediação/devolução em curso
        // (devoluções aparecem com mediations não vazio)
        if (!bestMatch && shipment?.declared_value) {
          bestMatch = orders.find(o =>
            Math.abs((o.total_amount || 0) - shipment.declared_value) < 0.01 &&
            (o.mediations?.length > 0 || o.tags?.includes('claims_with_resolution'))
          );
        }

        // 3) Match por valor declarado simples
        if (!bestMatch && shipment?.declared_value) {
          bestMatch = orders.find(o => Math.abs((o.total_amount || 0) - shipment.declared_value) < 0.01);
        }

        // 4) Order com mediação/cancelamento (sinal de devolução)
        if (!bestMatch) {
          bestMatch = orders.find(o => o.status === 'cancelled' || o.tags?.includes('not_paid') || o.mediations?.length > 0);
        }

        // 5) Ultima opção - primeira venda do array (mais recente)
        if (!bestMatch) bestMatch = orders[0];

        if (bestMatch?.id) {
          const rFull = await chamarML(`https://api.mercadolibre.com/orders/${bestMatch.id}`);
          if (rFull.ok) {
            order = rFull.data;
            resultado.avisos.push({
              tipo: 'order_via_fallback',
              mensagem: `Order encontrada via busca por comprador (${orders.length} candidatos, valor=${shipment?.declared_value || '?'})`,
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
  let mlInvoice = null; // v3.19: guarda numero/serie do ML mesmo sem fiscal_key

  const shipmentOriginalId = order?.shipping?.id || (!ehDevolucao ? shipment?.id : null);

  if (shipmentOriginalId) {
    const rNFML = await buscarNFnoML(shipmentOriginalId);
    if (rNFML.ok && rNFML.data) mlInvoice = rNFML.data;
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

      // v3.14.8: enriquecer com itens do Bling (titulo limpo + EAN) quando ML achou NF
      // Adiciona ~1s a busca mas evita clique manual em "Buscar links Bling" e da EAN no card
      if (order?.id && rNFML.data.invoice_number) {
        try {
          const rEnriq = await buscarNFnoBlingPorNumero(rNFML.data.invoice_number, order.date_created, { maxPaginas: 30 });
          if (rEnriq.ok && rEnriq.match?.id) {
            await sleep(400);
            const rCompleta = await buscarNFePorId(rEnriq.match.id);
            if (rCompleta.ok && rCompleta.data?.data) {
              const nfBling = rCompleta.data.data;
              const itensBling = Array.isArray(nfBling.itens) ? nfBling.itens.map(it => ({
                titulo: it.descricao || null,
                sku: it.codigo || null,
                ean: it.gtin || null,
                quantidade: it.quantidade || null,
                valor: it.valor || null,
                unidade: it.unidade || null,
              })) : [];
              nfData.itens = itensBling;
              nfData.idBling = nfBling.id;
              nfData.linkDanfe = nfBling.linkDanfe || nfData.linkConsulta;
              nfData.linkPdf = nfBling.linkPDF;
              nfData.linkXml = nfBling.xml;
              resultado.avisos.push({
                tipo: 'enriquecido_bling',
                mensagem: `Itens e links Bling carregados automaticamente`,
              });
            }
          }
        } catch (e) {
          console.warn('[ENRIQ] Erro ao enriquecer NF ML com itens Bling:', e.message);
        }
      }
    }
  }

  if (!nfData) {
    // v3.19 BLINDADA: busca por JANELA DE DATAS da venda (rapida e a prova
    // de serie 1/2). Substitui a varredura antiga de 50 paginas sem filtro.
    if (order?.id) {
      console.log(`[BUSCA] ML sem NF, acionando busca BLINDADA pra order=${order.id}`);
      const rBlind = await buscarNFBlindada({
        orderIds: [order.id, order.pack_id || pack?.id || null],
        numeroNF: mlInvoice?.invoice_number || null,
        serieNF: mlInvoice?.invoice_serie || null,
        dataReferencia: order.date_created || null,
      });

      resultado.tentativas.push({
        tipo: 'bling_blindada',
        codigo: order.id,
        ok: rBlind.ok,
        via: rBlind.via || null,
        tentado: rBlind.tentado || null,
      });

      if (rBlind.ok && rBlind.nf) {
        const nf = rBlind.nf;
        const itensBling = Array.isArray(nf.itens) ? nf.itens.map(it => ({
          titulo: it.descricao || null,
          sku: it.codigo || null,
          ean: it.gtin || null,
          quantidade: it.quantidade || null,
          valor: it.valor || null,
          unidade: it.unidade || null,
        })) : [];

        nfData = {
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
          situacao: nf.situacao,
          itens: itensBling,
        };

        resultado.avisos.push({
          tipo: 'nf_via_blindada',
          mensagem: `NF ${nf.numero} achada via busca blindada (${rBlind.via})`,
        });
        console.log(`[BUSCA] BLINDADA SUCESSO: NF=${nf.numero} via=${rBlind.via}`);
      } else {
        resultado.avisos.push({
          tipo: 'sem_nf',
          mensagem: `NF-e nao localizada nem pela busca blindada (${(rBlind.tentado || []).join(' | ')})`,
        });
      }
    } else {
      resultado.avisos.push({
        tipo: 'sem_nf_ml',
        mensagem: 'NF-e nao localizada via ML. Use o botao "Buscar links Bling" pra tentar via Bling.',
      });
    }
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

  // Buscar NF completa pra ter linkDanfe e ITENS
  await sleep(400);
  const rCompleta = await buscarNFePorId(rBusca.match.id);
  const nf = (rCompleta.ok && rCompleta.data?.data) ? rCompleta.data.data : rBusca.match;

  // Extrai itens (com titulo, SKU, EAN do Bling)
  const itensBling = Array.isArray(nf.itens) ? nf.itens.map(it => ({
    titulo: it.descricao || null,
    sku: it.codigo || null,
    ean: it.gtin || null,
    quantidade: it.quantidade || null,
    valor: it.valor || null,
    unidade: it.unidade || null,
  })) : [];

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
      itens: itensBling,
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

// NOVO v3.14.4: rota pra buscar EAN do produto pelo SKU
// Usado quando a NF nao foi achada automaticamente e o frontend precisa do EAN pra bipagem
app.get('/api/produto/ean-por-sku/:sku', async (req, res) => {
  const sku = String(req.params.sku || '').trim();
  if (!sku) return res.status(400).json({ ok: false, erro: 'sku obrigatorio' });

  const r = await buscarProdutoBlingPorSku(sku);
  if (!r.ok) return res.status(500).json(r);
  if (!r.produto) return res.json({ ok: true, encontrado: false, sku });

  // EAN pode estar em VARIOS campos no Bling - licao do projeto Localizacao Estoque
  const p = r.produto;
  const ean = p.gtin
           || p.gtinEmbalagem
           || p.gtinTributario
           || p.gtinEan
           || p.ean
           || p.codigoBarras
           || p.tributacao?.gtin
           || p.tributacao?.ean
           || null;

  return res.json({
    ok: true,
    encontrado: true,
    sku,
    produto: {
      id: p.id,
      nome: p.nome,
      codigo: p.codigo,
      gtin: ean, // campo unificado
      // Debug - todos os campos possiveis
      _debug: {
        gtin: p.gtin,
        gtinEmbalagem: p.gtinEmbalagem,
        gtinTributario: p.gtinTributario,
        gtinEan: p.gtinEan,
        ean: p.ean,
        codigoBarras: p.codigoBarras,
        tributacao_gtin: p.tributacao?.gtin,
        tributacao_ean: p.tributacao?.ean,
      },
    },
  });
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
  const r = await chamarBling(`https://api.bling.com.br/Api/v3/nfe?limite=${limite}&pagina=1&tipo=1`);
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

// v3.19 DEBUG: testa se obter-dados-devolucao funciona na API oficial
// (api.bling.com.br + Bearer). Decide se dá pra o BACKEND buscar os dados
// da devolucao (com os IDs reais dos itens) em vez da extensao.
app.get('/api/debug/dados-devolucao-numero/:numero', async (req, res) => {
  const numero = String(req.params.numero || '').trim();
  try {
    const rBusca = await buscarNFnoBlingPorNumero(numero, null, { maxPaginas: 50 });
    if (!rBusca.ok || !rBusca.match) {
      return res.json({ ok: false, etapa: 'buscar-numero', achou_nf: false });
    }
    const idNF = rBusca.match.id;

    // Descobre o idLoja pela API v3 (a NF individual traz "loja").
    // Esse e o valor que vai no ULTIMO segmento do obter-dados-devolucao.
    const rNFind = await buscarNFePorId(idNF);
    const lojaId = rNFind.ok ? (rNFind.data?.data?.loja?.id ?? null) : null;

    // Testa o obter-dados-devolucao via API oficial (Bearer) COM o idLoja real.
    // Esperado: 403 - esse endpoint e INTERNO (so cookie/sessao no www), nao e
    // exposto a apps de API. Serve so pra confirmar (a extensao e quem chama de verdade).
    const seg = lojaId != null ? String(lojaId) : '0';
    const url = `https://api.bling.com.br/Api/v3/nfe/${idNF}/obter-dados-devolucao/${seg}`;
    const r = await chamarBling(url);
    return res.json({
      ok: r.ok,
      status: r.status,
      idNF: String(idNF),
      idLoja_apiV3: lojaId != null ? String(lojaId) : null,
      url_testada: url,
      tem_data: !!r.data?.data,
      tem_itens: !!(r.data?.data?.itens),
      qtd_itens: r.data?.data?.itens ? Object.keys(r.data.data.itens).length : 0,
      ids_itens: r.data?.data?.itens ? Object.keys(r.data.data.itens) : [],
      dadosNota_id: r.data?.data?.dadosNota?.id || null,
      idDeposito: r.data?.data?.dadosNota?.idDeposito || null,
      devolucaoExistente: r.data?.data?.devolucaoExistente,
      error: r.error || null,
    });
  } catch (e) {
    return res.json({ ok: false, erro: e.message });
  }
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

// v3.19 - Reconexao do app Bling (troca o code por token com os escopos novos)
// Uso: /bling/setup?code=SEU_CODE  (o code expira em 1 minuto!)
app.get('/bling/setup', async (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) {
    return res.send('<h2>Falta o code</h2><p>Abra assim: <code>/bling/setup?code=SEU_CODE</code></p>');
  }
  try {
    const data = await trocarCodePorTokenBling(code);
    res.send(`
      <h2 style="color:#2e7d32;">✅ Bling reconectado com sucesso!</h2>
      <p><strong>Escopos ativos agora:</strong></p>
      <pre style="background:#f5f5f5;padding:12px;border-radius:8px;white-space:pre-wrap;">${(data.scope || '(nao informado)')}</pre>
      <p>Token salvo. Pode fechar esta aba.</p>
    `);
  } catch (e) {
    const detalhe = e.response?.data ? JSON.stringify(e.response.data, null, 2) : (e.message || String(e));
    res.send(`
      <h2 style="color:#c62828;">❌ Erro ao reconectar</h2>
      <pre style="background:#fff0f0;padding:12px;border-radius:8px;white-space:pre-wrap;">${detalhe}</pre>
      <p><strong>Dica:</strong> o code expira em <strong>1 minuto</strong>. Se demorou, gere um novo (cole o link de convite de novo) e refaça rapidinho.</p>
    `);
  }
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

  // v3.17.0 - Validacoes especificas pra devolucao parcial
  const ehParcial = !!dados.eh_parcial;
  const fotosParcial = Array.isArray(dados.fotos_parcial) ? dados.fotos_parcial : [];
  if (ehParcial) {
    if (fotosParcial.length < 6) {
      return res.status(400).json({
        ok: false,
        erro: `Devolucao parcial requer no minimo 6 fotos (recebido: ${fotosParcial.length})`,
      });
    }
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
    // v3.15.2 - Antes de gravar, busca numero do pedido Bling pelo order_id
    // v3.37 - teto de 20s: passou disso, salva SEM o numero (campo cosmetico)
    // e responde - nunca mais "salvando infinito" pro estoquista.
    let pedidoBlingNumero = null;
    if (dados.order_id) {
      const dataRef = dados.nf_data_emissao || null;
      const r = await Promise.race([
        buscarPedidoBlingPorNumeroLoja(String(dados.order_id), dataRef, { maxPaginas: 12 }),
        new Promise(resolve => setTimeout(() => resolve({ ok: false, timeout: true }), 20000)),
      ]);
      if (r?.timeout) console.warn(`[TRIAGEM] busca do pedido ${dados.order_id} estourou 20s - seguindo sem`);
      if (r?.ok && r.match?.numero) {
        pedidoBlingNumero = String(r.match.numero);
      }
    }

    // v3.30: guarda os itens da NF pro card das Aprovadas ja abrir com
    // produtos e quantidades (1 busca no Bling na hora da aprovacao).
    // v3.31: se nao veio o id Bling mas ha chave, descobre pela janela.
    let nfItens = null;
    let idBlingAprovar = dados.nf_id_bling || null;
    if (!idBlingAprovar && dados.nf_chave && dados.nf_numero) {
      try { idBlingAprovar = await resolverIdNFPorChave(dados.nf_numero, dados.nf_chave); } catch (e) { idBlingAprovar = null; }
    }
    if (idBlingAprovar) {
      try {
        const rIt = await buscarNFePorId(String(idBlingAprovar));
        nfItens = (rIt.ok && rIt.data?.data) ? mapItensNF(rIt.data.data) : null;
      } catch (e) { nfItens = null; }
    }

    // v3.17.0 - monta descricao do registro
    let descricaoRegistro;
    if (ehParcial) {
      const obs = (dados.observacao_parcial || '').trim();
      descricaoRegistro = `[DEVOLUCAO PARCIAL por ${req.usuario}] Recebido: ${dados.produto_qtd} de ${dados.produto_qtd_original || '?'} unidades.${obs ? ' OBS: ' + obs : ''}`;
    } else if (dados.bipagem_forcada) {
      descricaoRegistro = `Aprovado por ${req.usuario} [BIPAGEM FORCADA] OBS: ${dados.bipagem_observacao}`;
    } else {
      descricaoRegistro = `Aprovado por ${req.usuario} [bipagem OK]`;
    }

    const { data, error } = await supabase
      .from('devolucoes')
      .insert([{
        shipment_id: String(dados.shipment_id),
        order_id: dados.order_id ? String(dados.order_id) : null,
        pack_id: dados.pack_id ? String(dados.pack_id) : null,
        buyer_id: dados.buyer_id ? String(dados.buyer_id) : null,
        buyer_nome: dados.buyer_nome || null,
        buyer_nickname: dados.buyer_nickname || null,
        pedido_bling_numero: pedidoBlingNumero,
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
        nf_id_bling: idBlingAprovar || null,
        nf_link_danfe: dados.nf_link_danfe || null,
        nf_itens: nfItens,
        tipo: 'aprovado',
        status: 'pendente',
        funcionario: req.usuario,
        problema_descricao: descricaoRegistro,
        // v3.17.0 - se for parcial, salva as fotos no mesmo campo das fotos de problema
        problema_fotos: ehParcial ? fotosParcial : null,
      }])
      .select()
      .single();

    if (error) {
      console.error('[TRIAGEM] Erro Supabase:', error);
      return res.status(500).json({ ok: false, erro: error.message });
    }

    // v3.17.0 - Aplica tag automatica "Devolucao Parcial"
    if (ehParcial) {
      try {
        // Busca tag (cria se nao existir)
        let tagId = null;
        const { data: tagsExistentes } = await supabase
          .from('tags')
          .select('id, nome')
          .eq('nome', 'Devolucao Parcial')
          .limit(1);
        if (tagsExistentes && tagsExistentes.length > 0) {
          tagId = tagsExistentes[0].id;
        } else {
          const { data: novaTag } = await supabase
            .from('tags')
            .insert([{ nome: 'Devolucao Parcial', cor: '#f57c00' }])
            .select()
            .single();
          tagId = novaTag?.id;
        }
        // Vincula a tag a essa devolucao
        if (tagId) {
          await supabase
            .from('devolucao_tags')
            .insert([{ devolucao_id: data.id, tag_id: tagId }]);
        }
      } catch (e) {
        console.warn('[TRIAGEM] Erro ao aplicar tag Parcial (nao critico):', e.message);
      }
    }

    const flagLog = ehParcial ? '[PARCIAL]' : (dados.bipagem_forcada ? '[FORCADO]' : '');
    console.log(`[TRIAGEM] APROVADO por ${req.usuario}: shipment=${dados.shipment_id} NF=${dados.nf_numero} ${flagLog}`);
    // v3.17.0 - NAO dispara email pra parcial (Diego pediu)
    return res.json({ ok: true, id: data.id, registro: data, eh_parcial: ehParcial });
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
  if (fotos.length < 6) {
    return res.status(400).json({ ok: false, erro: `Minimo 6 fotos obrigatorias (recebido: ${fotos.length})` });
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
    // v3.15.2 - Antes de gravar, busca numero do pedido Bling pelo order_id
    let pedidoBlingNumero = null;
    if (dados.order_id) {
      // Usa data da NF como referencia pra otimizar busca paginada
      const dataRef = dados.nf_data_emissao || null;
      const r = await buscarPedidoBlingPorNumeroLoja(String(dados.order_id), dataRef, { maxPaginas: 50 });
      if (r?.ok && r.match?.numero) {
        pedidoBlingNumero = String(r.match.numero);
        console.log(`[TRIAGEM] Pedido Bling achado: ${pedidoBlingNumero} (order_id ML=${dados.order_id})`);
      }
    }

    const { data, error } = await supabase
      .from('devolucoes')
      .insert([{
        shipment_id: String(dados.shipment_id),
        order_id: dados.order_id ? String(dados.order_id) : null,
        pack_id: dados.pack_id ? String(dados.pack_id) : null,
        buyer_id: dados.buyer_id ? String(dados.buyer_id) : null,
        buyer_nome: dados.buyer_nome || null,
        buyer_nickname: dados.buyer_nickname || null,
        pedido_bling_numero: pedidoBlingNumero,
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
        funcionario: req.usuario,
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

// ============================================================
// v3.18.0 - PRODUTO DIVERGENTE (envio errado do estoque)
// Quando estoquista bipa devolucao mas o produto que voltou
// nao e o que estava na NF (ex: cliente comprou A, voltou B).
// Diferenca pro PROBLEMA: nao tem defeito, foi erro do estoque.
// Diferenca pro APROVADO: SKU eh diferente, precisa de bipagem
// do EAN do produto que voltou (B), nao do esperado (A).
// ============================================================
app.post('/api/triagem/divergente', requerEstoquista, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  const dados = req.body || {};

  if (!dados.shipment_id) {
    return res.status(400).json({ ok: false, erro: 'shipment_id obrigatorio' });
  }
  // Validacoes especificas: produto correto bipado + minimo 3 fotos
  if (!dados.produto_correto_sku) {
    return res.status(400).json({ ok: false, erro: 'produto_correto_sku obrigatorio (SKU do que voltou)' });
  }
  const fotos = Array.isArray(dados.fotos) ? dados.fotos : [];
  if (fotos.length < 3) {
    return res.status(400).json({ ok: false, erro: `Minimo 3 fotos obrigatorias (recebido: ${fotos.length})` });
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
    // Busca pedido Bling
    let pedidoBlingNumero = null;
    if (dados.order_id) {
      const dataRef = dados.nf_data_emissao || null;
      const r = await buscarPedidoBlingPorNumeroLoja(String(dados.order_id), dataRef, { maxPaginas: 50 });
      if (r?.ok && r.match?.numero) {
        pedidoBlingNumero = String(r.match.numero);
      }
    }

    const obs = (dados.observacao || '').trim();
    const skuEsperado = dados.produto_sku_esperado || '?';
    const skuVoltou = dados.produto_correto_sku;
    const descricao = `[DIVERGENTE por ${req.usuario}] NF tinha SKU ${skuEsperado}, mas voltou SKU ${skuVoltou} (${dados.produto_correto_titulo || '?'})${obs ? '. OBS: ' + obs : ''}`;

    const { data, error } = await supabase
      .from('devolucoes')
      .insert([{
        shipment_id: String(dados.shipment_id),
        order_id: dados.order_id ? String(dados.order_id) : null,
        pack_id: dados.pack_id ? String(dados.pack_id) : null,
        buyer_id: dados.buyer_id ? String(dados.buyer_id) : null,
        buyer_nome: dados.buyer_nome || null,
        buyer_nickname: dados.buyer_nickname || null,
        pedido_bling_numero: pedidoBlingNumero,
        // SKU e titulo agora sao do produto que VOLTOU (nao do que estava na NF)
        produto_titulo: dados.produto_correto_titulo || null,
        produto_mlb: dados.produto_mlb || null,
        produto_sku: skuVoltou,
        produto_qtd: dados.produto_qtd || 1,
        produto_valor_unit: dados.produto_valor_unit || null,
        // NF original mantida pra rastrear o pedido que originou
        nf_numero: dados.nf_numero || null,
        nf_serie: dados.nf_serie || null,
        nf_chave: dados.nf_chave || null,
        nf_valor: dados.nf_valor || null,
        nf_data_emissao: dados.nf_data_emissao || null,
        nf_id_bling: dados.nf_id_bling || null,
        nf_link_danfe: dados.nf_link_danfe || null,
        tipo: 'divergente',
        status: 'pendente',
        funcionario: req.usuario,
        problema_descricao: descricao,
        problema_fotos: fotos,
      }])
      .select()
      .single();

    if (error) {
      console.error('[TRIAGEM] Erro Supabase divergente:', error);
      return res.status(500).json({ ok: false, erro: error.message });
    }

    console.log(`[TRIAGEM] DIVERGENTE por ${req.usuario}: shipment=${dados.shipment_id} esperado=${skuEsperado} voltou=${skuVoltou} fotos=${fotos.length}`);
    // v3.18.0 - NAO dispara email (Diego pediu)
    return res.json({ ok: true, id: data.id, registro: data });
  } catch (err) {
    console.error('[TRIAGEM] Erro divergente:', err);
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

      <h3 style="border-bottom:1px solid #eee;padding-bottom:5px;">Origem da Venda</h3>
      <p>
        <strong>Pedido ML:</strong> ${devolucao.order_id ? `#${devolucao.order_id}` : '—'}${devolucao.pack_id ? ` (pack #${devolucao.pack_id})` : ''}<br>
        <strong>Apelido ML:</strong> ${devolucao.buyer_nickname || '—'}<br>
        <strong>Pedido Bling:</strong> ${devolucao.pedido_bling_numero ? `#${devolucao.pedido_bling_numero}` : '—'}
      </p>

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
        Sistema GOOD Devolucoes v3.18.0
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

// v3.16.0: Pagina de relatorios (requer auth)
app.get('/admin/relatorios.html', requerAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'relatorios.html'));
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
      .limit(1000);

    if (error) {
      return res.status(500).json({ ok: false, erro: error.message });
    }

    // Separa por tipo
    const aprovadas = data.filter(d => d.tipo === 'aprovado');
    const problemas = data.filter(d => d.tipo === 'problema');
    const divergentes = data.filter(d => d.tipo === 'divergente'); // v3.18.0

    return res.json({
      ok: true,
      aprovadas,
      problemas,
      divergentes, // v3.18.0
      total: data.length,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// ============================================================
// v3.15.0 (Fase 3B) - Helpers pra montar payload de devolucao
// ============================================================

// Formata CPF/CNPJ no padrao Bling (com pontos e hifen)
function formatarCpfCnpj(numero) {
  const digitos = String(numero || '').replace(/\D/g, '');
  if (digitos.length === 11) {
    // CPF: 055.640.477-70
    return digitos.slice(0,3) + '.' + digitos.slice(3,6) + '.' + digitos.slice(6,9) + '-' + digitos.slice(9);
  }
  if (digitos.length === 14) {
    // CNPJ: 33.602.095/0001-72
    return digitos.slice(0,2) + '.' + digitos.slice(2,5) + '.' + digitos.slice(5,8) + '/' + digitos.slice(8,12) + '-' + digitos.slice(12);
  }
  return numero || '';
}

// Detecta tipo de pessoa (F ou J) pelo numero de digitos do documento
function detectarTipoPessoa(numero) {
  const digitos = String(numero || '').replace(/\D/g, '');
  if (digitos.length === 14) return 'J';
  if (digitos.length === 11) return 'F';
  return null; // indeterminado
}

// Cache em memoria pra busca IBGE (evita repetir chamadas)
const ibgeCache = new Map();

// Busca codigo IBGE de um municipio pelo nome + UF
// Usa API publica do IBGE (gratuita, sem auth)
async function buscarIdMunicipioIBGE(nomeMunicipio, uf) {
  if (!nomeMunicipio || !uf) return null;
  const cacheKey = (uf + '|' + nomeMunicipio).toLowerCase();
  if (ibgeCache.has(cacheKey)) return ibgeCache.get(cacheKey);

  try {
    const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf)}/municipios`;
    const r = await fetch(url);
    if (!r.ok) {
      console.warn('[IBGE] HTTP', r.status, 'pra UF', uf);
      return null;
    }
    const lista = await r.json();
    if (!Array.isArray(lista)) return null;

    // Normaliza nome (sem acento, lowercase) pra comparar
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const alvo = norm(nomeMunicipio);

    const match = lista.find(m => norm(m.nome) === alvo);
    if (match && match.id) {
      const id = String(match.id);
      ibgeCache.set(cacheKey, id);
      return id;
    }
    console.warn('[IBGE] Municipio nao achado:', nomeMunicipio, uf);
    return null;
  } catch (e) {
    console.warn('[IBGE] Erro:', e.message);
    return null;
  }
}

// Fallback: busca codigo IBGE via CEP (BrasilAPI)
async function buscarIdMunicipioPorCep(cep) {
  if (!cep) return null;
  const cepLimpo = String(cep).replace(/\D/g, '');
  if (cepLimpo.length !== 8) return null;
  if (ibgeCache.has('cep|' + cepLimpo)) return ibgeCache.get('cep|' + cepLimpo);

  try {
    const url = `https://brasilapi.com.br/api/cep/v2/${cepLimpo}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    const id = data?.city_ibge ? String(data.city_ibge) : null;
    if (id) ibgeCache.set('cep|' + cepLimpo, id);
    return id;
  } catch (e) {
    console.warn('[BrasilAPI CEP] Erro:', e.message);
    return null;
  }
}

// ============================================================
// v3.19 (Fase 3B) - Resolve o ID interno do Bling pelo numero da NF
// ============================================================
// v3.33 - DEBUG: lista as devolucoes Shopee que o proxy enxerga
// (v3.34.1: passthrough FIEL do proxy - inclui debug_amostra_crua
//  quando a lista vier vazia, pra diagnostico em 1 clique)
app.get('/api/debug/shopee-devolucoes', requerAdmin, async (req, res) => {
  try {
    if (!SHOPEE_PROXY_URL || !SHOPEE_PROXY_KEY) {
      return res.status(400).json({ ok: false, erro: 'Configure SHOPEE_PROXY_URL e SHOPEE_PROXY_KEY no Render deste servico' });
    }
    const url = `${SHOPEE_PROXY_URL}/${SHOPEE_LOJA_KEY}/interno/devolucoes${req.query.refresh === '1' ? '?refresh=1' : ''}`;
    const r = await fetch(url, { headers: { 'x-internal-key': SHOPEE_PROXY_KEY } });
    const d = await r.json().catch(() => null);
    return res.status(r.ok ? 200 : 502).json(d || { ok: false, erro: 'resposta invalida do proxy (HTTP ' + r.status + ')' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || String(e) });
  }
});

// ============================================================
// v3.36 - QZ TRAY ASSINADO: o servidor entrega o certificado e
// ASSINA cada pedido de impressao (RSA-SHA512). Com o mesmo
// certificado que o checkout ja usa (override.crt confiado no
// QZ Tray do notebook), o popup "Allow" some por completo.
// Nomes iguais aos do checkout no Mover-Pedidos (GOODBKP_*) pra copiar
// nome+valor ao pe da letra; aceita QZ_CERT/QZ_PRIVKEY como fallback.
const QZ_CERT = process.env.GOODBKP_QZ_CERT || process.env.QZ_CERT || '';
const QZ_PRIVKEY = process.env.GOODBKP_QZ_PRIVKEY || process.env.QZ_PRIVKEY || '';

app.get('/api/qz/cert', requerEstoquista, (req, res) => {
  if (!QZ_CERT) return res.status(404).send('');
  res.type('text/plain').send(QZ_CERT);
});

app.get('/api/qz/sign', requerEstoquista, (req, res) => {
  try {
    if (!QZ_PRIVKEY) return res.status(404).send('');
    const toSign = String(req.query.request || '');
    if (!toSign) return res.status(400).send('');
    const signer = crypto.createSign('RSA-SHA512');
    signer.update(toSign);
    signer.end();
    const assinatura = signer.sign(QZ_PRIVKEY, 'base64');
    res.type('text/plain').send(assinatura);
  } catch (e) {
    console.error('[QZ-SIGN]', e.message);
    res.status(500).send('erro: ' + e.message);
  }
});

// ============================================================
// v3.38 - FILA DE IMPRESSAO REMOTA: o celular clica 🏷️ e a
// etiqueta sai na Zebra da ESTACAO (qualquer PC com esta pagina
// aberta + QZ Tray). O index vira estacao sozinho ao carregar.
const filaEtiquetas = [];
let estacaoUltimoPoll = 0;

app.post('/api/etiqueta/fila', requerEstoquista, (req, res) => {
  try {
    const zpl = String((req.body && req.body.zpl) || '');
    if (!zpl.startsWith('^XA') || zpl.length > 20000) {
      return res.status(400).json({ ok: false, erro: 'ZPL invalido' });
    }
    const agora = Date.now();
    // limpeza: jobs com mais de 4h caem fora
    while (filaEtiquetas.length && agora - filaEtiquetas[0].criadoEm > 4 * 3600e3) filaEtiquetas.shift();
    if (filaEtiquetas.length >= 50) {
      return res.status(429).json({ ok: false, erro: 'fila cheia (50 etiquetas aguardando)' });
    }
    const job = {
      id: agora + '-' + Math.random().toString(36).slice(2, 7),
      zpl,
      resumo: String((req.body && req.body.resumo) || '').slice(0, 120),
      por: req.usuario,
      criadoEm: agora,
    };
    filaEtiquetas.push(job);
    const estacaoOnline = (agora - estacaoUltimoPoll) < 60e3;
    console.log(`[FILA-ETQ] +job de ${req.usuario} (${job.resumo}) | fila=${filaEtiquetas.length} | estacao=${estacaoOnline ? 'online' : 'offline'}`);
    return res.json({ ok: true, id: job.id, aguardando: filaEtiquetas.length, estacao_online: estacaoOnline });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || String(e) });
  }
});

// Long-poll da estacao: segura a resposta ate ~25s esperando job chegar
app.get('/api/etiqueta/fila/proximo', requerEstoquista, async (req, res) => {
  const esperaMax = Math.min(25, parseInt(req.query.espera, 10) || 25) * 1000;
  const inicio = Date.now();
  estacaoUltimoPoll = inicio;
  while (Date.now() - inicio < esperaMax) {
    if (filaEtiquetas.length > 0) {
      const job = filaEtiquetas.shift();
      estacaoUltimoPoll = Date.now();
      console.log(`[FILA-ETQ] entregue: ${job.resumo || job.id} (restam ${filaEtiquetas.length})`);
      return res.json({ ok: true, job, restam: filaEtiquetas.length });
    }
    await sleep(500);
    estacaoUltimoPoll = Date.now();
  }
  return res.json({ ok: true, vazio: true });
});

// ============================================================
// v3.35 - FOTOS via servidor: baixa do bucket com a chave do
// servico (funciona com bucket publico OU privado) e entrega
// protegida pelo login do admin. Cura o "foto" quebrado quando
// o bucket deixa de ser publico no Supabase.
// ============================================================
// v3.35.1 - FOTOS via servidor, agora INDESTRUTIVEL:
//   1) tenta o download autenticado (cobre bucket PRIVADO)
//   2) se a chave/politica negar, busca a URL PUBLICA por dentro
//      do servidor e repassa (cobre bucket publico)
// Funciona em qualquer combinacao de bucket/chave. Erro vira
// texto explicativo (abrir a imagem numa aba mostra o motivo).
app.get('/api/admin/foto/*', requerAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).send('Supabase nao configurado');
    const arquivo = String(req.params[0] || '')
      .replace(/\\/g, '/')
      .replace(/\.\./g, '')
      .replace(/^\/+/, '')
      .replace(/[^a-zA-Z0-9._/-]/g, '');
    if (!arquivo) return res.status(400).send('arquivo invalido');

    let buf = null;
    let tipo = null;
    let erroDownload = null;

    try {
      const { data, error } = await supabase.storage.from('fotos-problema').download(arquivo);
      if (!error && data) {
        buf = Buffer.from(await data.arrayBuffer());
        tipo = data.type || null;
      } else {
        erroDownload = error ? error.message : 'resposta vazia';
      }
    } catch (e) {
      erroDownload = e.message || String(e);
    }

    if (!buf) {
      const urlPub = `${SUPABASE_URL}/storage/v1/object/public/fotos-problema/` +
        arquivo.split('/').map(encodeURIComponent).join('/');
      const r2 = await fetch(urlPub);
      if (r2.ok) {
        buf = Buffer.from(await r2.arrayBuffer());
        tipo = r2.headers.get('content-type');
      } else {
        console.error('[FOTO]', arquivo, '| download:', erroDownload, '| publico: HTTP', r2.status);
        return res.status(404).send(`foto nao encontrada (download: ${erroDownload || '-'} | publico: HTTP ${r2.status})`);
      }
    }

    res.set('Content-Type', tipo || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=86400');
    return res.send(buf);
  } catch (e) {
    return res.status(500).send('erro: ' + (e.message || String(e)));
  }
});

// ============================================================
// v3.31 - RETROFIT: grava os itens da NF num card antigo (e o
// nf_id_bling, se faltava e a chave permitir descobrir).
app.post('/api/admin/carregar-itens/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  try {
    const { data: reg, error: errReg } = await supabase
      .from('devolucoes')
      .select('id, nf_id_bling, nf_numero, nf_chave, nf_itens')
      .eq('id', req.params.id)
      .single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    if (Array.isArray(reg.nf_itens) && reg.nf_itens.length > 0) {
      return res.json({ ok: true, ja_tinha: true, qtd: reg.nf_itens.length });
    }

    let idBling = reg.nf_id_bling ? String(reg.nf_id_bling) : null;
    let idDescoberto = false;
    if (!idBling && reg.nf_chave && reg.nf_numero) {
      idBling = await resolverIdNFPorChave(reg.nf_numero, reg.nf_chave);
      idDescoberto = !!idBling;
    }
    if (!idBling) {
      return res.status(404).json({ ok: false, erro: 'Card sem nf_id_bling e sem chave utilizavel pra localizar a NF' });
    }

    await sleep(400);
    const rFull = await buscarNFePorId(idBling);
    const nf = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
    if (!nf) return res.status(404).json({ ok: false, erro: 'NF nao encontrada no Bling (id ' + idBling + ')' });

    const itens = mapItensNF(nf) || [];
    const upd = { nf_itens: itens };
    if (idDescoberto) upd.nf_id_bling = idBling; // brinde: card ganha o link Bling
    const { error: errUpd } = await supabase.from('devolucoes').update(upd).eq('id', req.params.id);
    if (errUpd) return res.status(500).json({ ok: false, erro: 'Falhou ao gravar: ' + errUpd.message });

    return res.json({ ok: true, qtd: itens.length, id_descoberto: idDescoberto });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.29 - Itens completos de uma NF (pro expansor "▼ itens da NF")
app.get('/api/admin/nf-itens/:idBling', requerAdmin, async (req, res) => {
  try {
    const r = await buscarNFePorId(String(req.params.idBling).trim());
    const nf = (r.ok && r.data?.data) ? r.data.data : null;
    if (!nf) return res.status(404).json({ ok: false, erro: 'NF nao encontrada no Bling' });
    const itens = Array.isArray(nf.itens) ? nf.itens.map(it => ({
      titulo: it.descricao || null,
      sku: it.codigo || null,
      quantidade: it.quantidade || null,
      valor: it.valor || null,
    })) : [];
    return res.json({ ok: true, numero: nf.numero, serie: nf.serie, itens });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.26 - INTELIGÊNCIA FULL
// ============================================================
// (1) full-vincular: acha no Bling a NF de ENTRADA série 2 que o
//     ML emitiu pra devolução (janela da venda, match valor/nome,
//     confirma série na NF completa) e vincula ao card.
// (2) full-lancar-estoque: lança o estoque de entrada da devolução
//     vinculada, via API OFICIAL, no depósito GERAL (caso "voltou
//     pra matriz e está ok pra revenda").
const DEPOSITO_GERAL_GOOD = '4956031259';

app.post('/api/admin/full-vincular/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  try {
    const { data: reg, error: errReg } = await supabase
      .from('devolucoes').select('*').eq('id', req.params.id).single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    if (reg.nf_devolucao_id_bling) {
      return res.json({ ok: true, ja_tinha: true, nf_devolucao_numero: reg.nf_devolucao_numero });
    }

    // Confere que e FULL (serie 2 da NF de venda)
    const chaveV = String(reg.nf_chave || '').replace(/\D/g, '');
    const ehFull = String(reg.nf_serie || '').trim() === '2' ||
      (chaveV.length === 44 && chaveV.substr(22, 3) === '002');
    if (!ehFull) return res.status(400).json({ ok: false, erro: 'Este card nao e FULL (serie 2) - use o Gerar NF Devolucao normal' });

    const f = (dt) => dt.toISOString().slice(0, 10);
    const base = reg.nf_data_emissao ? new Date(reg.nf_data_emissao) : (reg.created_at ? new Date(reg.created_at) : new Date(Date.now() - 60 * 864e5));
    const ini = f(new Date(base.getTime() - 864e5));
    const fim = f(new Date(Date.now() + 864e5));

    const nomeBusca = String(reg.buyer_nome || '').trim().toLowerCase();
    const valorEsperado = (Number(reg.produto_valor_unit) || 0) * (Number(reg.produto_qtd) || 1);

    // Varre notas de ENTRADA na janela e junta candidatas por valor/nome
    const candidatos = [];
    for (let pg = 1; pg <= 5; pg++) {
      if (pg > 1) await sleep(400);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=0&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) break;
      const lista = r.data?.data || [];
      if (lista.length === 0) break;
      for (const nf of lista) {
        const nomeNF = String(nf.contato?.nome || '').toLowerCase();
        const bateNome = nomeBusca && nomeNF.includes(nomeBusca);
        const bateValor = valorEsperado > 0 && nf.valorNota != null &&
          Math.abs(Number(nf.valorNota) - valorEsperado) < 0.05;
        if (bateNome || bateValor) candidatos.push(nf);
      }
      if (lista.length < 100) break;
    }
    candidatos.sort((a, b) => new Date(b.dataEmissao || 0) - new Date(a.dataEmissao || 0));

    // Confirma a serie 2 na NF completa (a lista pode nao trazer serie)
    for (const cand of candidatos.slice(0, 3)) {
      await sleep(400);
      const rFull = await buscarNFePorId(cand.id);
      const nf = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
      if (!nf) continue;
      const chaveD = String(nf.chaveAcesso || '').replace(/\D/g, '');
      const serieOk = String(nf.serie || '').trim() === '2' ||
        (chaveD.length === 44 && chaveD.substr(22, 3) === '002');
      if (!serieOk) continue;

      const { error: errUpd } = await supabase
        .from('devolucoes')
        .update({
          nf_devolucao_id_bling: String(nf.id),
          nf_devolucao_numero: String(nf.numero || ''),
        })
        .eq('id', req.params.id);
      if (errUpd) return res.status(500).json({ ok: false, erro: 'Achei a NF ' + nf.numero + ' mas falhou ao gravar: ' + errUpd.message });

      console.log(`[FULL-VINCULAR] ${req.params.id}: entrada serie 2 nº ${nf.numero} (id ${nf.id})`);
      return res.json({ ok: true, nf_devolucao_numero: String(nf.numero || ''), nf_devolucao_id_bling: String(nf.id) });
    }

    return res.status(404).json({
      ok: false,
      erro: `Nenhuma NF de entrada serie 2 correspondente na janela ${ini}..${fim} (${candidatos.length} candidata(s) testada(s)). Se ainda nao importou o XML no Bling, use o selo 🏬 pra baixar.`,
    });
  } catch (e) {
    console.error('[FULL-VINCULAR] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

app.post('/api/admin/full-lancar-estoque/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  try {
    const { data: reg, error: errReg } = await supabase
      .from('devolucoes').select('id, nf_devolucao_id_bling, nf_devolucao_numero').eq('id', req.params.id).single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    if (!reg.nf_devolucao_id_bling) {
      return res.status(400).json({ ok: false, erro: 'Card sem devolucao vinculada - use o 🔗 Achar devolucao primeiro' });
    }

    // v3.28: deposito escolhido no painel (whitelist), padrao Geral
    const DEPOSITOS_VALIDOS = new Set(['4956031259', '14888156920', '14888947655', '9596855161']);
    const pedidoDep = String(req.body?.idDeposito || '').trim();
    const deposito = DEPOSITOS_VALIDOS.has(pedidoDep) ? pedidoDep : DEPOSITO_GERAL_GOOD;

    const url = `https://api.bling.com.br/Api/v3/nfe/${reg.nf_devolucao_id_bling}/lancar-estoque/${deposito}`;
    const r = await chamarBling(url, { method: 'POST', data: {} });
    if (!r.ok) {
      const detalhe = r.error?.error?.description || r.error?.error?.message || JSON.stringify(r.error || {}).slice(0, 180);
      return res.status(502).json({ ok: false, erro: `Bling recusou (HTTP ${r.status}): ${detalhe}` });
    }

    console.log(`[FULL-ESTOQUE] ${req.params.id}: estoque lancado (NF dev ${reg.nf_devolucao_numero}, deposito ${deposito})`);
    return res.json({ ok: true, nf_devolucao_numero: reg.nf_devolucao_numero, deposito });
  } catch (e) {
    console.error('[FULL-ESTOQUE] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.25 - LANÇAR POR NF: cria cards em "Aprovadas" a partir do
// número da NF de venda (série 1). Porta lateral pra devoluções
// que não passaram pela bipagem — depois a esteira 🏭 emite tudo.
// Guardas: pula série 2 (FULL), pula número já lançado.
// ============================================================
app.post('/api/admin/lancar-por-nf', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  const brutos = Array.isArray(req.body?.numeros) ? req.body.numeros : [];
  const numeros = [...new Set(brutos.map(n => String(n).replace(/\D/g, '')).filter(n => n.length >= 3))].slice(0, 15);
  if (numeros.length === 0) return res.status(400).json({ ok: false, erro: 'Nenhum numero de NF valido informado' });

  const resultados = [];
  let criados = 0;

  for (const num of numeros) {
    try {
      // 1) Ja existe card com essa NF?
      const candidatos = [...new Set([num, num.padStart(6, '0'), num.replace(/^0+/, '')])];
      const { data: jaTem } = await supabase
        .from('devolucoes')
        .select('id, status')
        .in('nf_numero', candidatos)
        .limit(1);
      if (jaTem && jaTem.length > 0) {
        resultados.push({ numero: num, ok: false, motivo: `ja existe card (${jaTem[0].status})` });
        continue;
      }

      // 2) Busca a NF no Bling (varredura por numero, tipo=1)
      const rBusca = await buscarNFnoBlingPorNumero(num, null, { maxPaginas: 30 });
      if (!rBusca.ok || !rBusca.match?.id) {
        resultados.push({ numero: num, ok: false, motivo: `NF nao achada no Bling (${rBusca.totalScanned || 0} varridas)` });
        continue;
      }
      await sleep(400);
      const rFull = await buscarNFePorId(rBusca.match.id);
      const nf = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
      if (!nf) {
        resultados.push({ numero: num, ok: false, motivo: 'falha ao ler NF completa' });
        continue;
      }

      // 3) Guarda FULL: serie 2 = devolucao emitida pelo proprio ML
      const serie = nf.serie != null ? String(nf.serie).trim() : null;
      const chave = nf.chaveAcesso ? String(nf.chaveAcesso).replace(/\D/g, '') : '';
      if (serie === '2' || (chave.length === 44 && chave.substr(22, 3) === '002')) {
        resultados.push({ numero: num, ok: false, motivo: 'serie 2 (FULL) - devolucao e emitida pelo ML, nao lancar aqui' });
        continue;
      }

      // 4) Monta o card com os dados da propria NF
      const itens = Array.isArray(nf.itens) ? nf.itens : [];
      const it0 = itens[0] || {};
      const titulo = (it0.descricao || 'Produto da NF ' + num) + (itens.length > 1 ? ` (+${itens.length - 1} itens)` : '');

      const { data: novo, error: errIns } = await supabase
        .from('devolucoes')
        .insert([{
          shipment_id: 'manual-nf-' + num,
          order_id: nf.numeroPedidoLoja ? String(nf.numeroPedidoLoja) : null,
          pack_id: null,
          buyer_id: null,
          buyer_nome: nf.contato?.nome || null,
          buyer_nickname: null,
          pedido_bling_numero: null,
          produto_titulo: titulo,
          produto_mlb: null,
          produto_sku: it0.codigo || null,
          produto_qtd: it0.quantidade || null,
          produto_valor_unit: it0.valor || null,
          nf_numero: String(nf.numero),
          nf_serie: serie,
          nf_chave: nf.chaveAcesso || null,
          nf_valor: nf.valorNota || null,
          nf_data_emissao: nf.dataEmissao || null,
          nf_id_bling: String(nf.id),
          nf_link_danfe: nf.linkDanfe || (nf.chaveAcesso ? 'https://meudanfe.com.br/consulta/' + nf.chaveAcesso : null),
          nf_itens: mapItensNF(nf),
          tipo: 'aprovado',
          status: 'pendente',
          funcionario: req.usuario,
          problema_descricao: `[LANCAMENTO MANUAL por ${req.usuario}] card criado pelo nº da NF`,
        }])
        .select('id')
        .single();

      if (errIns) {
        resultados.push({ numero: num, ok: false, motivo: 'erro ao gravar: ' + errIns.message });
        continue;
      }
      criados++;
      resultados.push({ numero: num, ok: true, id: novo.id, cliente: nf.contato?.nome || null, valor: nf.valorNota || null });
      console.log(`[LANCAR-NF] card criado: NF ${nf.numero} (${nf.contato?.nome || '?'}) id=${novo.id}`);
    } catch (e) {
      resultados.push({ numero: num, ok: false, motivo: e.message || 'erro' });
    }
    await sleep(400);
  }

  return res.json({ ok: true, criados, resultados });
});

// ============================================================
// v3.20.1 - VINCULAR DEVOLUCAO JA EXISTENTE no Bling
// ============================================================
// Quando a NF de devolucao foi criada mas o resultado se perdeu
// (timeout do painel), o card fica "orfao". Esta rota procura a
// NF de ENTRADA (tipo=0) com a natureza de devolucao da GOOD na
// janela recente, casa por nome do comprador OU valor, e grava.
app.post('/api/admin/vincular-devolucao-existente/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  const NATUREZA_DEVOLUCAO_GOOD = '5776118802';
  try {
    const { data: reg, error: errReg } = await supabase
      .from('devolucoes')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    if (reg.nf_devolucao_id_bling) {
      return res.json({ ok: true, ja_tinha: true, nf_devolucao_numero: reg.nf_devolucao_numero });
    }

    // Janela: da criacao do registro (menos 1 dia) ate amanha
    const f = (d) => d.toISOString().slice(0, 10);
    const iniData = reg.created_at ? new Date(new Date(reg.created_at).getTime() - 864e5) : new Date(Date.now() - 30 * 864e5);
    const ini = f(iniData);
    const fim = f(new Date(Date.now() + 864e5));

    const nomeBusca = String(reg.buyer_nome || '').trim().toLowerCase();
    const valorEsperado = (Number(reg.produto_valor_unit) || 0) * (Number(reg.produto_qtd) || 1);

    const candidatos = [];
    for (let pg = 1; pg <= 4; pg++) {
      if (pg > 1) await sleep(400);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=0&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) break;
      const lista = r.data?.data || [];
      if (lista.length === 0) break;
      for (const nf of lista) {
        if (String(nf.naturezaOperacao?.id || '') !== NATUREZA_DEVOLUCAO_GOOD) continue;
        const nomeNF = String(nf.contato?.nome || '').toLowerCase();
        const bateNome = nomeBusca && nomeNF.includes(nomeBusca);
        const bateValor = valorEsperado > 0 && nf.valorNota != null &&
          Math.abs(Number(nf.valorNota) - valorEsperado) < 0.05;
        if (bateNome || bateValor) candidatos.push(nf);
      }
      if (lista.length < 100) break;
    }

    if (candidatos.length === 0) {
      return res.status(404).json({ ok: false, erro: 'Nenhuma NF de devolucao correspondente achada no Bling (janela ' + ini + '..' + fim + ')' });
    }

    // Mais recente primeiro
    candidatos.sort((a, b) => new Date(b.dataEmissao || 0) - new Date(a.dataEmissao || 0));
    const nf = candidatos[0];

    const { error: errUpd } = await supabase
      .from('devolucoes')
      .update({
        nf_devolucao_id_bling: String(nf.id),
        nf_devolucao_numero: String(nf.numero || ''),
      })
      .eq('id', req.params.id);
    if (errUpd) return res.status(500).json({ ok: false, erro: 'Achei a NF ' + nf.numero + ' mas falhou ao gravar: ' + errUpd.message });

    console.log(`[VINCULAR-DEV] ${req.params.id}: NF devolucao ${nf.numero} (id ${nf.id}) vinculada (${candidatos.length} candidata(s))`);
    return res.json({ ok: true, nf_devolucao_numero: String(nf.numero || ''), nf_devolucao_id_bling: String(nf.id), candidatas: candidatos.length });
  } catch (e) {
    console.error('[VINCULAR-DEV] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.19.2 - RAIO-X do resgate de NF (dry-run, abre no navegador)
// GET /api/debug/resgate-nf/:orderId
// Roda o MESMO fluxo do resgate mas NAO grava nada - mostra cada
// passo (ML invoice, pack, blindada com trace) pra diagnostico.
// ============================================================
app.get('/api/debug/resgate-nf/:orderId', async (req, res) => {
  const orderIdParam = String(req.params.orderId || '').trim();
  const saida = { orderId: orderIdParam };
  try {
    // Registro no Supabase (se existir)
    let reg = null;
    if (supabase) {
      const { data } = await supabase
        .from('devolucoes')
        .select('id, order_id, pack_id, nf_numero, nf_id_bling, created_at')
        .eq('order_id', orderIdParam)
        .order('created_at', { ascending: false })
        .limit(1);
      reg = data && data[0] ? data[0] : null;
    }
    saida.registro = reg;

    // Order no ML
    let order = null;
    const rOrder = await chamarML(`https://api.mercadolibre.com/orders/${orderIdParam}`);
    if (rOrder.ok) order = rOrder.data;
    saida.order_ml = order ? {
      date_created: order.date_created,
      pack_id: order.pack_id || null,
      shipping_id: order.shipping?.id || null,
      tags: order.tags || [],
      fulfillment: (order.tags || []).some(t => String(t).includes('fulfillment')) || order.shipping?.logistic_type === 'fulfillment',
    } : { erro: rOrder.status || 'sem resposta' };

    // ML invoice_data (shipment da venda)
    const shipVenda = order?.shipping?.id || null;
    if (shipVenda) {
      const rNF = await buscarNFnoML(shipVenda);
      saida.ml_invoice_venda = {
        shipment: shipVenda, ok: rNF.ok, status: rNF.status,
        invoice_number: rNF.data?.invoice_number || null,
        invoice_serie: rNF.data?.invoice_serie || null,
        tem_fiscal_key: !!rNF.data?.fiscal_key,
      };
    } else saida.ml_invoice_venda = { erro: 'order sem shipping.id' };

    // ML invoice_data (shipment do PACK)
    const packId = reg?.pack_id || order?.pack_id || null;
    if (packId) {
      const rPack = await chamarML(`https://api.mercadolibre.com/packs/${packId}`);
      const shipPack = rPack.ok ? rPack.data?.shipment?.id : null;
      if (shipPack && String(shipPack) !== String(shipVenda || '')) {
        const rNF2 = await buscarNFnoML(shipPack);
        saida.ml_invoice_pack = {
          shipment: shipPack, ok: rNF2.ok, status: rNF2.status,
          invoice_number: rNF2.data?.invoice_number || null,
          tem_fiscal_key: !!rNF2.data?.fiscal_key,
        };
      } else saida.ml_invoice_pack = { shipment: shipPack, igual_ao_da_venda: true };
    }

    // Blindada (dry-run)
    const rBlind = await buscarNFBlindada({
      orderIds: [orderIdParam, packId],
      numeroNF: saida.ml_invoice_venda?.invoice_number || null,
      serieNF: saida.ml_invoice_venda?.invoice_serie || null,
      dataReferencia: order?.date_created || reg?.created_at || null,
    });
    saida.blindada = {
      ok: rBlind.ok,
      via: rBlind.via || null,
      nf_numero: rBlind.nf?.numero || null,
      nf_serie: rBlind.nf?.serie || null,
      nf_id_bling: rBlind.idNF || null,
      numeroPedidoLoja_na_nf: rBlind.nf?.numeroPedidoLoja || null,
      tentado: rBlind.tentado || null,
      trace: rBlind.trace || null,
    };

    return res.json(saida);
  } catch (e) {
    saida.erro = e.message || String(e);
    return res.status(500).json(saida);
  }
});

// ============================================================
// v3.19 - RESGATE DE NF pra registros gravados sem NF ("NF: -")
// ============================================================
// Fluxo: le o registro -> busca a order no ML (data + shipment da
// venda) -> tenta invoice_data do ML -> se falhar, busca BLINDADA
// no Bling (janela de datas) -> grava nf_* no registro.
app.post('/api/admin/buscar-nf/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  const devId = req.params.id;

  try {
    const { data: reg, error: errReg } = await supabase
      .from('devolucoes')
      .select('*')
      .eq('id', devId)
      .single();
    if (errReg || !reg) {
      return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    }
    if (reg.nf_numero) {
      return res.json({ ok: true, ja_tinha: true, nf_numero: reg.nf_numero });
    }
    if (!reg.order_id) {
      return res.status(400).json({ ok: false, erro: 'Registro sem order_id - nao da pra localizar a NF automaticamente' });
    }

    // 1) Order no ML: da a data da venda e o shipment ORIGINAL
    let order = null;
    const rOrder = await chamarML(`https://api.mercadolibre.com/orders/${reg.order_id}`);
    if (rOrder.ok) order = rOrder.data;

    // 2) Tenta invoice_data do ML (rapido, ja traz chave/serie)
    let nfInfo = null; // { numero, serie, chave, valor, dataEmissao, idBling, linkDanfe }
    let via = null;

    async function tentarInvoiceML(sid) {
      if (!sid) return false;
      const rNFML = await buscarNFnoML(sid);
      if (rNFML.ok && rNFML.data?.fiscal_key) {
        nfInfo = {
          numero: String(rNFML.data.invoice_number || ''),
          serie: rNFML.data.invoice_serie != null ? String(rNFML.data.invoice_serie) : null,
          chave: rNFML.data.fiscal_key,
          valor: rNFML.data.invoice_amount || null,
          dataEmissao: rNFML.data.invoice_date || null,
          idBling: null,
          linkDanfe: `https://meudanfe.com.br/consulta/${rNFML.data.fiscal_key}`,
        };
        via = 'ml_invoice';
        return true;
      }
      return false;
    }

    const shipVenda = order?.shipping?.id || null;
    let achouML = await tentarInvoiceML(shipVenda);

    // v3.19.1: venda de CARRINHO - a NF pode estar no shipment do PACK
    if (!achouML) {
      const packId = reg.pack_id || order?.pack_id || null;
      if (packId) {
        const rPack = await chamarML(`https://api.mercadolibre.com/packs/${packId}`);
        const shipPack = rPack.ok ? rPack.data?.shipment?.id : null;
        if (shipPack && String(shipPack) !== String(shipVenda || '')) {
          achouML = await tentarInvoiceML(shipPack);
          if (achouML) via = 'ml_invoice_pack';
        }
      }
    }

    // 3) BLINDADA no Bling (janela de datas da venda) - acha o id Bling
    //    Roda mesmo se o ML deu a NF, pra vincular o nf_id_bling (necessario
    //    pro botao Gerar NF Devolucao usar o caminho rapido).
    const dataRef = order?.date_created || reg.created_at || null;
    const rBlind = await buscarNFBlindada({
      orderIds: [reg.order_id, reg.pack_id || order?.pack_id || null],
      numeroNF: nfInfo?.numero || null,
      serieNF: nfInfo?.serie || null,
      dataReferencia: dataRef,
    });
    if (rBlind.ok && rBlind.nf) {
      const nf = rBlind.nf;
      nfInfo = {
        numero: String(nf.numero || nfInfo?.numero || ''),
        serie: nf.serie != null ? String(nf.serie) : (nfInfo?.serie || null),
        chave: nf.chaveAcesso || nfInfo?.chave || null,
        valor: nf.valorNota || nfInfo?.valor || null,
        dataEmissao: nf.dataEmissao || nfInfo?.dataEmissao || null,
        idBling: nf.id ? String(nf.id) : null,
        linkDanfe: nf.linkDanfe || nfInfo?.linkDanfe || (nf.chaveAcesso ? `https://meudanfe.com.br/consulta/${nf.chaveAcesso}` : null),
      };
      via = via ? via + '+' + rBlind.via : rBlind.via;
    }

    if (!nfInfo || !nfInfo.numero) {
      const detalhe = (rBlind.tentado || []).join(' | ') || 'sem detalhes';
      return res.status(404).json({
        ok: false,
        erro: 'NF nao localizada no ML nem no Bling. Tentado: ' + detalhe,
        tentado: rBlind.tentado || [],
      });
    }

    // 4) Grava no registro
    const nfItensResgate = (rBlind.ok && rBlind.nf) ? mapItensNF(rBlind.nf) : null;
    const { error: errUpd } = await supabase
      .from('devolucoes')
      .update({
        nf_numero: nfInfo.numero,
        nf_serie: nfInfo.serie,
        nf_chave: nfInfo.chave,
        nf_valor: nfInfo.valor,
        nf_data_emissao: nfInfo.dataEmissao,
        nf_id_bling: nfInfo.idBling,
        nf_link_danfe: nfInfo.linkDanfe,
        nf_itens: nfItensResgate,
      })
      .eq('id', devId);
    if (errUpd) {
      return res.status(500).json({ ok: false, erro: 'Achei a NF mas falhou ao gravar: ' + errUpd.message });
    }

    console.log(`[RESGATE-NF] ${devId}: NF ${nfInfo.numero}${nfInfo.serie ? '/s' + nfInfo.serie : ''} via ${via}`);
    return res.json({ ok: true, via, nf_numero: nfInfo.numero, nf_serie: nfInfo.serie, nf_id_bling: nfInfo.idBling });
  } catch (e) {
    console.error('[RESGATE-NF] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// Usado quando a devolucao tem nf_numero mas NAO tem nf_id_bling salvo.
// O botao "Gerar NF Devolucao" chama isto pra descobrir o ID interno
// que o endpoint obter-dados-devolucao precisa.
app.get('/api/admin/resolver-id-nf', requerAdmin, async (req, res) => {
  const numero = String(req.query.numero || '').trim();
  const idParam = String(req.query.id || '').trim();
  const chave = String(req.query.chave || '').replace(/\D/g, '');
  const data = req.query.data || null;
  if (!numero && !idParam) {
    return res.status(400).json({ ok: false, erro: 'numero ou id da NF obrigatorio' });
  }

  try {
    let idBling = idParam;
    let numeroNF = numero;
    let idLoja = null;

    // v3.31.1 - FASE JANELA: a chave de acesso diz o MES de emissao;
    // o helper faz busca binaria pelo DIA (rapida em qualquer volume)
    // com plano B varrendo o mes inteiro.
    if (!idBling && chave.length === 44 && numero) {
      const achado = await resolverIdNFPorChave(numero, chave);
      if (achado) {
        idBling = achado;
        console.log(`[resolver-id-nf] achou pela chave: id=${idBling}`);
      }
    }

    // Se nao veio o id interno, descobre pelo numero (varre /nfe)
    if (!idBling) {
      const r = await buscarNFnoBlingPorNumero(numero, data, { maxPaginas: 50 });
      if (!r.ok) {
        return res.status(502).json({ ok: false, erro: 'Erro ao consultar o Bling ao buscar a NF' });
      }
      if (!r.match) {
        return res.status(404).json({
          ok: false,
          erro: `NF ${numero} nao encontrada nas ultimas ${r.totalScanned || 0} NFs do Bling`,
        });
      }
      idBling = String(r.match.id);
      numeroNF = r.match.numero;
      if (r.match.loja && r.match.loja.id != null) idLoja = String(r.match.loja.id);
    }

    // Garante o idLoja: busca a NF individual (GET /nfe/{id}), que traz "loja".
    // Esse idLoja e o ULTIMO segmento do obter-dados-devolucao - a extensao precisa dele.
    if (!idLoja && idBling) {
      const rNF = await buscarNFePorId(idBling);
      const nf = rNF.ok ? rNF.data?.data : null;
      if (nf) {
        if (nf.loja && nf.loja.id != null) idLoja = String(nf.loja.id);
        if (!numeroNF && nf.numero) numeroNF = nf.numero;
      }
    }

    return res.json({
      ok: true,
      idBling: String(idBling),
      numero: numeroNF || null,
      idLoja: idLoja || null,
    });
  } catch (e) {
    console.error('[resolver-id-nf] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.15.0 (Fase 3B) - Preparar dados pra gerar NF Devolucao no Bling
// ============================================================
// Frontend (admin.html) chama esse endpoint pra obter os dados completos
// (produtos com idBling + contato com idMunicipio etc) que sao necessarios
// pra montar o XML xajax do salvarNotaDevolucao.
// Usa a API v3 oficial do Bling (escopo NF Leitura ja tem).
app.get('/api/admin/preparar-devolucao/:idBling', requerAdmin, async (req, res) => {
  const idBling = String(req.params.idBling || '').trim();
  if (!idBling || !/^\d+$/.test(idBling)) {
    return res.status(400).json({ ok: false, erro: 'idBling invalido' });
  }

  try {
    // Busca a NF completa via API v3 oficial
    const url = `https://api.bling.com.br/Api/v3/nfe/${idBling}`;
    const r = await chamarBling(url);

    if (!r.ok) {
      return res.status(r.status || 500).json({
        ok: false,
        erro: `Bling API v3 retornou ${r.status || 'erro'}: ${(r.error?.error?.description || JSON.stringify(r.error || {})).slice(0, 200)}`,
      });
    }

    const nf = r.data?.data;
    if (!nf) {
      return res.status(404).json({ ok: false, erro: 'NF nao encontrada no Bling' });
    }

    // Extrai itens. API v3 NF nao retorna idProduto direto.
    // Buscamos cada produto pelo SKU pra pegar o idBling (necessario pro XML xajax).
    const itensNF = Array.isArray(nf.itens) ? nf.itens : [];
    if (itensNF.length === 0) {
      return res.status(400).json({ ok: false, erro: 'NF sem itens' });
    }

    const produtos = [];
    for (const it of itensNF) {
      const sku = it.codigo;
      if (!sku) {
        return res.status(400).json({ ok: false, erro: `Item da NF sem SKU: ${JSON.stringify(it).slice(0, 200)}` });
      }
      const rProd = await buscarProdutoBlingPorSku(sku);
      if (!rProd.ok || !rProd.produto) {
        return res.status(400).json({ ok: false, erro: `Produto nao encontrado no Bling para SKU ${sku}` });
      }
      produtos.push({
        idBling: String(rProd.produto.id),
        sku,
        descricao: it.descricao,
        quantidade: Number(it.quantidade) || 1,
        valor: Number(it.valor) || 0,
      });
    }

    // Extrai contato (vem completo na NF v3)
    const contato = nf.contato || {};
    const endereco = contato.endereco || {};

    // BUG 1 FIX: Detecta tipo F/J pelo numero de digitos do CPF/CNPJ
    // (a API v3 nem sempre retorna tipoPessoa direito)
    const docDigitos = String(contato.numeroDocumento || '').replace(/\D/g, '');
    const tipoDetectado = detectarTipoPessoa(docDigitos);
    const tipoFinal = tipoDetectado || (contato.tipoPessoa === 'J' ? 'J' : 'F');

    // BUG 1 FIX: Formata CPF/CNPJ no padrao Bling
    const cnpjFormatado = formatarCpfCnpj(docDigitos);

    // BUG 2 FIX: Se idMunicipio nao veio, busca via IBGE pelo nome+UF
    // Fallback: se IBGE falhar, busca pelo CEP (BrasilAPI)
    let idMunicipioFinal = String(endereco.codigoMunicipio || '').trim();
    if (!idMunicipioFinal && endereco.municipio && endereco.uf) {
      console.log('[preparar-devolucao] Buscando idMunicipio via IBGE:', endereco.municipio, endereco.uf);
      idMunicipioFinal = (await buscarIdMunicipioIBGE(endereco.municipio, endereco.uf)) || '';
    }
    if (!idMunicipioFinal && endereco.cep) {
      console.log('[preparar-devolucao] Fallback - Buscando idMunicipio pelo CEP:', endereco.cep);
      idMunicipioFinal = (await buscarIdMunicipioPorCep(endereco.cep)) || '';
    }

    const contatoOut = {
      id: String(contato.id || ''),
      nome: contato.nome || '',
      tipo: tipoFinal,
      cnpj: cnpjFormatado,
      ie: contato.ie || '',
      indIEDest: String(contato.indicadorIE || '9'),
      rg: contato.rg || '',
      nomePais: '',
      idPais: '',
      cep: endereco.cep || '',
      cidade: endereco.municipio || '',
      idMunicipio: idMunicipioFinal,
      uf: endereco.uf || '',
      endereco: endereco.endereco || '',
      enderecoNro: endereco.numero || '',
      bairro: endereco.bairro || '',
      complemento: endereco.complemento || '',
      email: contato.email || '',
      fone: contato.telefone || '',
      celular: '',
      dataNascimento: '',
    };

    if (!contatoOut.id) {
      return res.status(400).json({ ok: false, erro: 'NF sem ID de contato' });
    }
    if (!contatoOut.idMunicipio) {
      console.warn('[preparar-devolucao] AVISO: contato sem idMunicipio - Bling pode rejeitar');
    }

    return res.json({
      ok: true,
      idNFOriginal: idBling,
      numeroNF: nf.numero,
      produtos,
      contato: contatoOut,
    });

  } catch (e) {
    console.error('[preparar-devolucao] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// v3.15.0: Registra no Supabase que a NF de devolucao foi gerada
// pra evitar duplicatas e mostrar link direto no admin
app.put('/api/admin/registrar-devolucao-gerada/:id', requerAdmin, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }

  const id = String(req.params.id || '').trim();
  const { nf_devolucao_id_bling, nf_devolucao_numero } = req.body || {};

  if (!id) return res.status(400).json({ ok: false, erro: 'id obrigatorio' });
  if (!nf_devolucao_id_bling) return res.status(400).json({ ok: false, erro: 'nf_devolucao_id_bling obrigatorio' });

  try {
    const { error } = await supabase
      .from('devolucoes')
      .update({
        nf_devolucao_id_bling: String(nf_devolucao_id_bling),
        nf_devolucao_numero: String(nf_devolucao_numero || ''),
        nf_devolucao_gerada_em: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      return res.status(500).json({ ok: false, erro: error.message });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
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
// v3.16.0: REGISTRA ROTAS DO DASHBOARD DE RELATORIOS
// (deve vir DEPOIS das declaracoes de supabase, requerAdmin, etc)
// ============================================================
registrarRotasRelatorios(app, { supabase, requerAdmin });

// ============================================================
// FASE 3: LIMPEZA AUTOMATICA - DESABILITADA (Diego pediu)
// Registros sao mantidos para sempre. Quando atingir limite do plano free
// Supabase, migrar pro Pro ($25/mes) com 100GB Storage.
// ============================================================
// (codigo de limpeza removido em v3.10)

// ============================================================
// INICIAR
// ============================================================
app.listen(PORT, () => {
  console.log('============================================');
  console.log('GOOD Devolucoes v3.38 - shopee + fila de impressao + fotos blindadas');
  console.log(`Porta: ${PORT}`);
  console.log(`ML: ${mlClient.hasToken() ? 'OK' : 'FALTA'}`);
  console.log(`Bling: ${blingClient.hasToken() ? 'OK' : 'FALTA'}`);
  console.log(`Render persist: ${(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID) ? 'OK' : 'FALTA'}`);
  console.log(`Supabase: ${supabase ? 'OK' : 'FALTA'}`);
  console.log(`Shopee proxy: ${(SHOPEE_PROXY_URL && SHOPEE_PROXY_KEY) ? 'OK (loja ' + SHOPEE_LOJA_KEY + ' via ' + SHOPEE_PROXY_URL + ')' : 'AUSENTE - configure SHOPEE_PROXY_URL e SHOPEE_PROXY_KEY'}`);
  console.log(`QZ assinatura: ${(QZ_CERT && QZ_PRIVKEY) ? 'OK (impressao sem popup)' : 'sem certificado (modo Allow) - configure GOODBKP_QZ_CERT e GOODBKP_QZ_PRIVKEY'}`);
  console.log(`Email: ${mailer ? 'OK (' + EMAIL_USER + ' -> ' + EMAIL_TO + ')' : 'FALTA'}`);
  console.log(`Usuarios: ${Object.keys(USERS).length > 0 ? Object.keys(USERS).join(', ') : 'FALTA'}`);
  console.log(`Admin: ${(ADMIN_USER && USERS[ADMIN_USER]) ? `OK (${ADMIN_USER})` : 'FALTA - defina ADMIN_USER e inclua no USERS'}`);
  console.log('============================================');
});
