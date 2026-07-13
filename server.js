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
// v3.43 - helpers NF/pessoa/municipio movidos p/ lib/nf-pessoa.js
// (instanciados abaixo, apos chamarBling e sleep existirem)
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
// v3.41 - SHOPEE extraida para lib/shopee-proxy.js (enxugamento)
const shopee = require('./lib/shopee-proxy');

// ── Chave p/ rotas de diagnóstico/admin/setup (acessadas com ?k=CHAVE na URL) ──
// Sem a env ADMIN_KEY configurada no Render, essas rotas ficam DESLIGADAS (404).
const ADMIN_KEY = process.env.ADMIN_KEY || '';
function adminOk(req) { return ADMIN_KEY && req.query.k === ADMIN_KEY; }

shopee.iniciarPreAquecimento();

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

// v3.43 - modulo nf-pessoa (deps ja existem acima)
const nfp = require('./lib/nf-pessoa')({ chamarBling, sleep });
const {
  mapItensNF,
  resolverIdNFPorChave,
  formatarCpfCnpj,
  detectarTipoPessoa,
  buscarIdMunicipioIBGE,
  buscarIdMunicipioPorCep,
} = nfp;

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
// v3.42 - helpers de busca ML extraidos para lib/ml-buscas.js
const mlBuscas = require('./lib/ml-buscas')(chamarML);
const {
  extrairClaimsDaResposta,
  buscarClaimsPorShipment,
  buscarOrderViaShipmentReturn,
  buscarClaimDetalhada,
  buscarReturnPorClaim,
  buscarOrdersPorComprador,
} = mlBuscas;

// ============================================================
// ROTAS
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'good-devolucoes-marketplaces-nfsbling',
    version: '3.49 (triagem p outros marketplaces - fim da rodinha eterna)',
    integrations: {
      ml: mlClient.hasToken(),
      bling: blingClient.hasToken(),
      render_persist: !!((process.env.RENDER_API_KEY || process.env.RENDER_API_KEY_v2) && (process.env.RENDER_SERVICE_ID || process.env.RENDER_SERVICE_ID_v2)),
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
app.get('/api/devolucao/identificar/:codigo', requerLogin, async (req, res) => {
  const codigoOriginal = String(req.params.codigo || '').trim();

  if (!codigoOriginal) {
    return res.status(400).json({ ok: false, erro: 'Codigo nao informado' });
  }

  console.log(`\n========== NOVA BUSCA: ${codigoOriginal} ==========`);

  // v3.39 - QR das etiquetas ML vem como {"id":"47416667668","t":"lm"}
  // (leitor USB cospe o JSON cru no campo). Extrai o id e ja sabemos
  // que e ML - se o shipment nao existir, falha RAPIDO com orientacao
  // (padrao de devolucao FULL) em vez de vagar pela cascata.
  let origemQrML = false;
  let codigoLimpo = codigoOriginal.replace(/[^0-9]/g, '');
  let mQrML = codigoOriginal.match(/["']?[ïi]d["']?\s*[:=]\s*["']?(\d{8,20})/i);
  if (!mQrML && /^\{|"?t"?\s*[:=]\s*"?lm/i.test(codigoOriginal)) {
    // leitor mutilou o "id" (layout de teclado): pesca o unico numerao
    const runs = codigoOriginal.match(/\d{8,20}/g) || [];
    if (runs.length === 1) mQrML = [null, runs[0]];
  }
  if (mQrML) {
    codigoLimpo = mQrML[1];
    origemQrML = true;
    console.log(`[BUSCA] QR do ML detectado → shipment ${codigoLimpo}`);
  }

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

  // v3.47.2 - PISTA SPX (nao atalho destrutivo!): codigo BR + 12+ digitos +
  // 1 letra final e o padrao da etiqueta Shopee SPX. Correios tb comeca com
  // BR mas TERMINA em "BR" (2 letras) - e ML usa Correios. Entao aqui a
  // regra e CONSERVADORA: se parece SPX, a Shopee e tentada PRIMEIRO (mais
  // abaixo). Mas o ML NUNCA e eliminado - se a Shopee nao achar, a cascata
  // ML roda igual. Nenhum caminho e perdido (insucesso ML existe!).
  const pistaSPX = /^BR\d{11,}[A-Z]$/i.test(codigoOriginal.trim());

  // v3.47.2 - Quando o codigo tem PISTA de SPX (BR+12dig+1letra), tenta a
  // Shopee JA AQUI (antes da cascata ML), pra o bipe de insucesso Shopee
  // responder rapido sem os 404 de shipment/pack. MAS se a Shopee nao achar,
  // NAO retorna - deixa a cascata ML rodar normal logo abaixo (insucesso ML
  // usa etiqueta Correios, que tb comeca com BR). Nenhum caminho e perdido.
  if (pistaSPX && shopee.cfg.ativo) {
    try {
      const infoSPX = await shopee.acharDevolucao(codigoOriginal);
      if (infoSPX && infoSPX.hit) {
        resultado.tentativas.push({ tipo: 'shopee_return', v: 'spx-first', codigo: codigoOriginal, ok: true, status: 200, lista_qtd: infoSPX.qtd });
        const dev = infoSPX.hit;
        // reaproveita o MESMO tratamento shopee da cascata (montagem + NF)
        returnData = dev;
        metodoUsado = 'shopee_return';
        resultado._shopeeDev = dev; // sinaliza pro bloco shopee abaixo pular a re-busca
      } else {
        resultado.tentativas.push({ tipo: 'shopee_return', v: 'spx-first', codigo: codigoOriginal, ok: false, status: 404, lista_qtd: infoSPX ? infoSPX.qtd : null, nota: 'nao achou na Shopee - seguindo cascata ML (pode ser insucesso ML/Correios)' });
      }
    } catch (e) {
      resultado.tentativas.push({ tipo: 'shopee_return', v: 'spx-first', codigo: codigoOriginal, ok: false, status: 500, erro: e.message || String(e) });
    }
  }

  // ML T1: shipment_id
  if (!returnData && codigoLimpo.length >= 10 && codigoLimpo.length <= 13) {
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
  if (!returnData && !shipment) {
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

  // ===== QR-ML sem shipment (v3.39): falha RAPIDA com orientacao =====
  // Etiqueta era do ML (QR) mas a API nao achou o envio por esse id.
  // Nao adianta vagar por chave/Shopee: responde em segundos com os
  // caminhos certos (a etiqueta fisica tem barras E Pack ID impressos).
  if (!shipment && !pack && origemQrML) {
    const stShip = (resultado.tentativas.find(t => t.tipo === 'shipment_id') || {}).status;
    if (stShip === 403) {
      resultado.erro = `QR do ML lido (shipment ${codigoLimpo}) mas a API RECUSOU o acesso (403). Duas causas possíveis: token do ML expirado (teste com um shipment antigo — se também der 403, avise o Diego) OU devolução recém-criada que o ML ainda não liberou (tente de novo em algumas horas). Enquanto isso: digite o Pack ID impresso na etiqueta (2000...).`;
    } else {
      resultado.erro = `QR do ML lido (shipment ${codigoLimpo}) mas a API não achou esse envio. Na MESMA etiqueta: (1) bipe o CÓDIGO DE BARRAS grande, ou (2) digite o Pack ID impresso (2000...). Se for devolução FULL (endereçada ao CD do ML), use a chave da DANFE ou ➕ Lançar por NF.`;
    }
    resultado.qr_ml_sem_shipment = true;
    return res.status(404).json(resultado);
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
    let devShopee = resultado._shopeeDev || null; // v3.47.2: reusa o spx-first
    delete resultado._shopeeDev; // campo interno - nao vaza no JSON
    let infoShopee = null;
    if (!devShopee && shopee.cfg.ativo) {
      try {
        infoShopee = await shopee.acharDevolucao(codigoOriginal);
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
      const houve403 = resultado.tentativas.some(t => t.status === 403);
      const diag = infoShopee
        ? ` [diag: lista com ${infoShopee.qtd} devolucoes; exemplo de tracking: ${infoShopee.exemplo || '-'}]`
        : (shopee.cfg.ativo ? '' : ' [diag: integracao Shopee SEM as variaveis no Render!]');
      const nota403 = houve403 ? ' ⚠️ O ML respondeu 403 (acesso recusado): token expirado ou devolução recém-criada ainda embargada — tente o Pack ID impresso ou aguarde algumas horas.' : '';
      resultado.erro = (pareceSPX
        ? 'Etiqueta Shopee (SPX) nao casou com as devolucoes. Se ela diz "SPX INSUCESSO": o QR/barras so contem o rastreio (a Shopee nao indexa esse codigo) — DIGITE o "Pedido" impresso na etiqueta (ex: 260623TX31XFMT) que o sistema busca o pedido cancelado. Devolucao normal: tente o "Pedido" ou a chave da DANFE.'
        : 'Codigo nao encontrado em shipments/packs do ML nem nas devolucoes Shopee.') + diag + nota403;
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
app.get('/api/nf/buscar-links-bling/:orderId', requerLogin, async (req, res) => {
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
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  const ok = await renovarTokenML();
  res.json({ ok, timestamp: new Date().toISOString() });
});

app.post('/api/admin/renovar-token-bling', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  const ok = await renovarTokenBling();
  res.json({ ok, timestamp: new Date().toISOString() });
});

// ============================================================
// DEBUG
// ============================================================
app.get('/api/debug/shipment/:id', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  const r = await chamarML(`https://api.mercadolibre.com/shipments/${req.params.id}`, { 'x-format-new': 'true' });
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

app.get('/api/debug/order/:id', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  const r = await chamarML(`https://api.mercadolibre.com/orders/${req.params.id}`);
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

app.get('/api/debug/ml-invoice/:shipmentId', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  const r = await buscarNFnoML(req.params.shipmentId);
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

app.get('/api/debug/bling-busca/:numeroLoja', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  const dataRef = req.query.data || null;
  const r = await buscarPedidoBlingPorNumeroLoja(req.params.numeroLoja, dataRef, { maxPaginas: 50 });
  res.json(r);
});

// NOVO v3.14.4: rota pra buscar EAN do produto pelo SKU
// Usado quando a NF nao foi achada automaticamente e o frontend precisa do EAN pra bipagem
app.get('/api/produto/ean-por-sku/:sku', requerLogin, async (req, res) => {
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
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  const r = await buscarPedidoBlingPorId(req.params.id);
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

app.get('/api/debug/bling-nfe-cru/:idNFe', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  const r = await buscarNFePorId(req.params.idNFe);
  res.status(r.ok ? 200 : r.status || 500).json(r);
});

// v3.4: ver primeira pagina de NFs (pra debug)
app.get('/api/debug/bling-nfe-primeira-pagina', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
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
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  const dataRef = req.query.data || null;
  const r = await buscarNFnoBlingPorOrderId(req.params.orderId, dataRef, { maxPaginas: 50 });
  res.json(r);
});

// v3.19 DEBUG: testa se obter-dados-devolucao funciona na API oficial
// (api.bling.com.br + Bearer). Decide se dá pra o BACKEND buscar os dados
// da devolucao (com os IDs reais dos itens) em vez da extensao.
app.get('/api/debug/dados-devolucao-numero/:numero', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
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
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
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
// v3.40 - EXAME DE SANGUE do token ML: chama /users/me (dispara o
// auto-refresh se preciso) e conta a verdade em 1 clique.
app.get('/api/debug/ml-token', requerAdmin, async (req, res) => {
  const r = await mlClient.chamarML('https://api.mercadolibre.com/users/me');
  if (r.ok) {
    return res.json({
      ok: true,
      veredito: '✅ TOKEN VIVO (renovou sozinho se precisou)',
      user_id: r.data?.id,
      nickname: r.data?.nickname,
    });
  }
  return res.status(502).json({
    ok: false,
    veredito: '💀 TOKEN MORTO - o refresh falhou. Use o /ml/setup (instrucoes na resposta)',
    status_ml: r.status,
    erro_ml: r.error,
    como_ressuscitar: [
      '1) Logado na conta ML da GOOD, abra: https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=SEU_ML_CLIENT_ID&redirect_uri=' + 'https://good-devolucoes-x-marketplaces-x-nfsbling.onrender.com/callback',
      '2) Autorize - a pagina /callback mostra o CODE',
      '3) EM ATE 1 MINUTO abra: /ml/setup?code=SEU_CODE',
    ],
  });
});

// v3.40 - Reconexao do app ML (espelho do /bling/setup)
// Uso: /ml/setup?code=SEU_CODE  (o code expira em ~1 minuto!)
app.get('/ml/setup', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  const code = String(req.query.code || '').trim();
  if (!code) {
    return res.send('<h2>Falta o code</h2><p>Abra assim: <code>/ml/setup?code=SEU_CODE</code></p>');
  }
  try {
    const { clientId, clientSecret } = mlClient.getClientML();
    const r = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: 'https://good-devolucoes-x-marketplaces-x-nfsbling.onrender.com/callback',
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) {
      throw new Error(JSON.stringify(data, null, 2) || ('HTTP ' + r.status));
    }
    const persist = await mlClient.definirTokensML(data.access_token, data.refresh_token);
    res.send(`
      <h2 style="color:#2e7d32;">✅ Mercado Livre reconectado!</h2>
      <p><strong>User ID:</strong> ${data.user_id || '?'} · <strong>Escopo:</strong> ${data.scope || '?'}</p>
      <p><strong>Cofre (Render):</strong> ${persist.persistiu
        ? 'tokens salvos ✅ (sobrevivem a redeploy)'
        : '⚠️ NÃO persistiu (' + (persist.erro || 'RENDER_API_KEY/RENDER_SERVICE_ID ausentes?') + ') — tokens ativos só na memória: funcionam AGORA, mas o próximo deploy apaga. Reponha as 2 vars e refaça o setup.'}</p>
      <p>Teste bipando uma etiqueta ML.</p>
    `);
  } catch (e) {
    const detalhe = e.message || String(e);
    res.send(`
      <h2 style="color:#c62828;">❌ Erro ao reconectar o ML</h2>
      <pre style="background:#fff0f0;padding:12px;border-radius:8px;white-space:pre-wrap;">${detalhe}</pre>
      <p><strong>Dica:</strong> o code expira em ~1 minuto. Gere um novo (link de autorização) e refaça rapidinho.</p>
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
  const ident = String(req.params.shipmentId || '').trim();
  if (!ident) {
    return res.status(400).json({ ok: false, erro: 'identificador obrigatorio' });
  }
  // v3.49 - vendas de outros marketplaces (Magalu, Amazon...) chegam pela
  // chave da DANFE e NAO tem shipment_id. Se o identificador for uma chave
  // de 44 digitos, procura por nf_chave; senao, por shipment_id (ML/Shopee).
  const ehChaveNF = /^\d{44}$/.test(ident);
  const coluna = ehChaveNF ? 'nf_chave' : 'shipment_id';
  try {
    const { data, error } = await supabase
      .from('devolucoes')
      .select('id, created_at, tipo, status, problema_descricao, problema_fotos, data_concluido, nf_numero, produto_qtd')
      .eq(coluna, ident)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ ok: false, erro: error.message });
    }
    return res.json({ ok: true, registros: data || [], via: coluna });
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
        shipment_id: String(dados.shipment_id || dados.nf_chave || ''), // v3.49: outros marketplaces (Magalu...) nao tem shipment - usa a chave da NF
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
        shipment_id: String(dados.shipment_id || dados.nf_chave || ''), // v3.49: outros marketplaces (Magalu...) nao tem shipment - usa a chave da NF
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
        shipment_id: String(dados.shipment_id || dados.nf_chave || ''), // v3.49: outros marketplaces (Magalu...) nao tem shipment - usa a chave da NF
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
// v3.43 - formatarCpfCnpj/detectarTipoPessoa/municipios -> lib/nf-pessoa.js

// ============================================================
// v3.19 (Fase 3B) - Resolve o ID interno do Bling pelo numero da NF
// ============================================================
// v3.33 - DEBUG: lista as devolucoes Shopee que o proxy enxerga
// (v3.34.1: passthrough FIEL do proxy - inclui debug_amostra_crua
//  quando a lista vier vazia, pra diagnostico em 1 clique)
// v3.45.2 - PONTES de debug pro shopee-sync: usam o login admin (cookie)
// e repassam a chave por HEADER (o caminho que comprovadamente funciona).
// Zero chave na URL - fim do 401 por caractere quebrado.
// Uso (logado como admin):
//   /api/debug/shopee-procurar?q=260623TX31XFMT&dias=180
//   /api/debug/shopee-pedido?q=260623TX31XFMT
app.get('/api/debug/shopee-indice-status', requerAdmin, async (req, res) => {
  try {
    if (!shopee.cfg.ativo) return res.status(400).json({ ok: false, erro: 'Shopee proxy sem envs' });
    const extra = (req.query.rebuild === '1' ? '?rebuild=1' : (req.query.amostra === '1' ? '?amostra=1' : ''));
    const url = `${shopee.cfg.url}/${shopee.cfg.loja}/interno/indice-status${extra}`;
    const r = await fetch(url, { headers: { 'x-internal-key': shopee.cfg.key } });
    const d = await r.json().catch(() => null);
    return res.status(r.ok ? 200 : 502).json(d || { ok: false, erro: 'resposta invalida (HTTP ' + r.status + ')' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || String(e) });
  }
});

app.get('/api/debug/shopee-procurar', requerAdmin, async (req, res) => {
  try {
    if (!shopee.cfg.ativo) return res.status(400).json({ ok: false, erro: 'Shopee proxy sem envs' });
    const q = encodeURIComponent(String(req.query.q || '').trim());
    if (!q) return res.status(400).json({ ok: false, erro: 'informe ?q=CODIGO' });
    const dias = Math.min(180, parseInt(req.query.dias, 10) || 150);
    const url = `${shopee.cfg.url}/${shopee.cfg.loja}/interno/devolucoes?procurar=${q}&dias=${dias}`;
    const r = await fetch(url, { headers: { 'x-internal-key': shopee.cfg.key } });
    const d = await r.json().catch(() => null);
    return res.status(r.ok ? 200 : 502).json(d || { ok: false, erro: 'resposta invalida (HTTP ' + r.status + ')' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || String(e) });
  }
});

app.get('/api/debug/shopee-pedido', requerAdmin, async (req, res) => {
  try {
    if (!shopee.cfg.ativo) return res.status(400).json({ ok: false, erro: 'Shopee proxy sem envs' });
    const q = encodeURIComponent(String(req.query.q || '').trim());
    if (!q) return res.status(400).json({ ok: false, erro: 'informe ?q=ORDER_SN' });
    const bruto = req.query.bruto === '1' ? '&bruto=1' : '';
    const url = `${shopee.cfg.url}/${shopee.cfg.loja}/interno/devolucoes?pedido=${q}${bruto}`;
    const r = await fetch(url, { headers: { 'x-internal-key': shopee.cfg.key } });
    const d = await r.json().catch(() => null);
    return res.status(r.ok ? 200 : 502).json(d || { ok: false, erro: 'resposta invalida (HTTP ' + r.status + ')' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || String(e) });
  }
});

app.get('/api/debug/shopee-devolucoes', requerAdmin, async (req, res) => {
  try {
    if (!shopee.cfg.ativo) {
      return res.status(400).json({ ok: false, erro: 'Configure SHOPEE_PROXY_URL e SHOPEE_PROXY_KEY no Render deste servico' });
    }
    const dados = await shopee.buscarDevolucoesProxy(req.query.refresh === '1');
    return res.json({ ok: true, qtd: (dados || []).length, devolucoes: dados });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || String(e) });
  }
});

// ============================================================
// v3.45 - rotas de impressao (QZ + fila) movidas p/ lib/rotas-impressao.js

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
// v3.44 - rotas admin-NF movidas p/ lib/rotas-admin-nf.js
// (registradas junto do rotas-relatorios, apos as deps existirem)

// ============================================================
// v3.16.0: REGISTRA ROTAS DO DASHBOARD DE RELATORIOS
// (deve vir DEPOIS das declaracoes de supabase, requerAdmin, etc)
// ============================================================
registrarRotasRelatorios(app, { supabase, requerAdmin });

// v3.44 - rotas admin-NF (mesmo ponto: todas as deps ja declaradas acima)
const registrarRotasAdminNF = require('./lib/rotas-admin-nf');
registrarRotasAdminNF(app, {
  supabase, requerAdmin, adminOk, sleep,
  chamarBling, chamarML, buscarNFnoML,
  buscarNFePorId, buscarNFBlindada,
  resolverIdNFPorChave, mapItensNF,
});

// v3.45 - rotas de impressao (QZ assinado + fila remota)
const registrarRotasImpressao = require('./lib/rotas-impressao');
registrarRotasImpressao(app, { requerEstoquista, crypto, sleep });

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
  console.log('GOOD Devolucoes v3.49 - triagem outros marketplaces');
  console.log(`Porta: ${PORT}`);
  console.log(`ML: ${mlClient.hasToken() ? 'OK' : 'FALTA'}`);
  console.log(`Bling: ${blingClient.hasToken() ? 'OK' : 'FALTA'}`);
  console.log(`Render persist: ${((process.env.RENDER_API_KEY || process.env.RENDER_API_KEY_v2) && (process.env.RENDER_SERVICE_ID || process.env.RENDER_SERVICE_ID_v2)) ? 'OK' : 'FALTA'}`);
  console.log(`Supabase: ${supabase ? 'OK' : 'FALTA'}`);
  console.log(`Shopee proxy: ${shopee.cfg.ativo ? 'OK (loja ' + shopee.cfg.loja + ' via ' + shopee.cfg.url + ')' : 'AUSENTE - configure SHOPEE_PROXY_URL e SHOPEE_PROXY_KEY'}`);
  console.log(`QZ assinatura: ${((process.env.GOODBKP_QZ_CERT || process.env.QZ_CERT) && (process.env.GOODBKP_QZ_PRIVKEY || process.env.QZ_PRIVKEY)) ? 'OK (impressao sem popup)' : 'sem certificado (modo Allow) - configure GOODBKP_QZ_CERT e GOODBKP_QZ_PRIVKEY'}`);
  console.log(`Email: ${mailer ? 'OK (' + EMAIL_USER + ' -> ' + EMAIL_TO + ')' : 'FALTA'}`);
  console.log(`Usuarios: ${Object.keys(USERS).length > 0 ? Object.keys(USERS).join(', ') : 'FALTA'}`);
  console.log(`Admin: ${(ADMIN_USER && USERS[ADMIN_USER]) ? `OK (${ADMIN_USER})` : 'FALTA - defina ADMIN_USER e inclua no USERS'}`);
  console.log('============================================');
});
