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
// seg1.2 - no Render a aplicacao roda atras do proxy da plataforma. Sem
// isto, req.ip seria o IP do proxy (todo mundo igual) e o freio do login
// nao distinguiria clientes; com 1 salto confiavel, req.ip e o endereco
// carimbado pelo proxy - nao o X-Forwarded-For cru enviado pelo cliente.
app.set('trust proxy', 1);
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

// v3.52 - MAGALU: devolucao la e um TICKET de pos-venda com "remessa reversa".
// OAuth 2.0 via ID Magalu; tokens persistidos nas env vars do Render.
const { atualizarTokensNoRender: _attRender } = require('./lib/render-tokens');
const magalu = require('./lib/magalu')({ atualizarTokensNoRender: _attRender });

// v3.65 - CORREIOS REVERSO: devolucoes ML "por agencia" chegam com etiqueta
// dos Correios (AD/AP...BR). O indice claims->returns mapeia esse rastreio
// de volta pra venda. ~95% das devolucoes Correios do GOOD sao ML.
const mlReturns = require('./lib/ml-returns')({ chamarML });

// v3.71 - busca de NF pelo NOME do remetente (etiquetas Correios da Amazon
// etc). O nome vem COLADO na etiqueta (RENATONEVES) - o indice colapsa os
// nomes do Bling tambem e compara colapsado com colapsado.
const nfNomes = require('./lib/nf-nomes')({ chamarBling });

// v3.76 - devolucoes ESPERADAS do portal Magalu Entregas (indice 'a espreita')
const espreita = require('./lib/magalu-espreita')({ chamarMagalu: magalu.chamarMagalu });
const devCapturadas = require('./lib/devolucoes-capturadas');   // v4.63
const tiktokPonte = require('./lib/tiktok-ponte');              // v4.66
const tiktokDev = require('./lib/tiktok-devolucoes');           // v4.66
const vinculoCache = require('./lib/vinculo-nf-cache');   // b204 - vinculo NF ja achado
const marcadores = require('./lib/marcadores-estornada');   // b200 - peca unica dos marcadores
// b201 - `magaluCancelados` NUNCA foi importado nesta empresa.
//
// A rota chamava a variavel desde o #123, e o try/catch em volta
// transformava o ReferenceError em `magalu_erro` — que a tela mostrava
// como "falha do Magalu". Ou seja: o Magalu nunca apareceu no card da GOOD,
// e o erro parecia da ponte deles.
//
// O dono viu porque a mensagem finalmente chegou na tela:
//   "magalu_erro": "magaluCancelados is not defined"
//
// PIOR: o mesmo catch derrubava a busca da NF logo abaixo, entao o botao
// "Gerar NF de devolucao" sumia junto — foi o sintoma que ele relatou.
const magaluCancelados = require('./lib/magalu-cancelados');
const devParcial = require('./lib/devolucao-parcial');          // v4.67
const tiktokRevelia = require('./lib/tiktok-revelia');          // v4.68

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
  // v4.50 - token ASSINADO: nao depende da memoria, entao o deploy nao
  // desloga mais ninguem. O Map segue alimentado como ponte pros antigos.
  const token = novaSessaoAssinada(usuario, tipo, 12 * 60 * 60 * 1000);
  sessoes.set(token, { usuario, tipo, criado: Date.now() });
  return token;
}
function validarSessao(token, tipoEsperado = null) {
  if (!token) return null;
  // 1) token assinado - vale mesmo depois do restart
  const assinada = validarSessaoAssinada(token);
  if (assinada) {
    if (tipoEsperado && assinada.tipo !== tipoEsperado) return null;
    return assinada;
  }
  // 2) token antigo, ainda na memoria deste processo
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
  buscarNFsPorNumero,
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
app.use('/amb', require('./amb-devolucoes/app-AMB'));
app.use(cookieParser());
// ── seg2 - O HTML DO PAINEL PRECISA PASSAR PELO LOGIN ────────────────
// Achado da auditoria de 26/08, conferido no codigo: as rotas protegidas
// existem (app.get('/painel-devolucoes.html', requerAdmin, ...) e
// app.get('/admin/relatorios.html', requerAdmin, ...)), mas o
// express.static abaixo vem MUITO antes delas e entrega o arquivo direto
// de public/, encerrando a requisicao. Ou seja: as rotas com requerAdmin
// nunca eram alcancadas para o HTML.
//
// As APIs seguiam fechadas, entao nao havia dado de cliente exposto — o
// que vazava era a tela: nomes de campos, endpoints chamados e a logica
// do painel, que e mapa pronto pra quem quiser tentar o resto.
//
// Este freio vem ANTES do static de proposito. Nao cobre /admin.html
// (que e so um redirect de compatibilidade) nem /defeitos.html, publico
// por decisao da v3.91 — quem protege ali e a API.
// seg2.1 (apontamento do Codex no PR #85): comparar req.path CRU deixava
// passar /%70ainel-devolucoes.html — o static decodifica, o req.path nao.
// A comparacao agora decodifica antes, na lib compartilhada com a AMB.
const { ehCaminhoProtegido } = require('./lib/caminho-pedido');
function exigirAdminNoHtmlAdministrativo(req, res, next) {
  const ehPaginaAdmin = ehCaminhoProtegido(req.path, {
    exatos: ['/painel-devolucoes.html'],
    prefixos: ['/admin/'],
  });
  if (ehPaginaAdmin) return requerAdmin(req, res, next);
  return next();
}
app.use(exigirAdminNoHtmlAdministrativo);

app.use(express.static(path.join(__dirname, 'public'), {
  // v3.64 - HTML sempre revalida (celular segurava js velho em cache; agora
  // o HTML fresco traz os ?v= novos e os scripts recarregam sozinhos).
  setHeaders: (res, caminho) => {
    if (caminho.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

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
    version: '4.96.0 (rodizio: quem falha nao trava a fila pra sempre)',
    integrations: {
      ml: mlClient.hasToken(),
      bling: blingClient.hasToken(),
      render_persist: !!((process.env.RENDER_API_KEY || process.env.RENDER_API_KEY_v2) && (process.env.RENDER_SERVICE_ID || process.env.RENDER_SERVICE_ID_v2)),
      supabase: !!supabase,
      email: !!mailer,
      auth: Object.keys(USERS).length > 0,
      admin: !!(ADMIN_USER && USERS[ADMIN_USER]),
    },
    // seg1.2 - o /health e PUBLICO e devolvia a lista de logins, que e
    // meio caminho andado pra um ataque de senha. Agora so a contagem.
    usuarios_cadastrados: Object.keys(USERS).length,
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
// v3.83 - RECADOS DO DIEGO PRO ESTOQUISTA: aviso preso a uma venda/NF que
// aparece no momento do bipe (ex: "cliente disse que veio com vidro trincado
// - NAO reenviar"). Este middleware intercepta a resposta da identificacao e
// anexa os recados que casem com QUALQUER identificador do resultado - assim
// funciona em todos os caminhos (ML, Shopee, Magalu, Correios, NF, nome).
// v3.84 - TRAVA NO SERVIDOR: nao aceita triagem enquanto houver recado sem
// ciencia (o front ja bloqueia, mas celular com cache antigo burlaria).
// v4.45 - o recado deve SUMIR da triagem quando a devolucao ja foi resolvida
// (triada com status concluido, ou NF emitida). Mas continua no banco pro
// historico - agarrado ao pedido, pra consulta futura. Cruza os ids do recado
// com a tabela devolucoes.
async function devolucaoJaResolvida(ids) {
  try {
    if (!ids || !ids.length) return false;
    const ors = [];
    for (const idv of ids) {
      const seguro = String(idv).replace(/[",()]/g, '');
      if (!seguro) continue;
      ors.push(`shipment_id.eq.${seguro}`);
      ors.push(`order_id.eq.${seguro}`);
      if (/^\d{44}$/.test(seguro)) ors.push(`nf_chave.eq.${seguro}`);
    }
    if (!ors.length) return false;
    const { data } = await supabase
      .from('devolucoes')
      .select('status, nf_numero')
      .or(ors.join(','))
      .limit(20);
    if (!data || !data.length) return false;
    // resolvida = alguma triagem concluida OU com NF emitida
    return data.some(d => d.status === 'concluido' || (d.nf_numero != null && String(d.nf_numero).trim() !== ''));
  } catch (e) { return false; }
}

async function recadoPendente(dados) {
  try {
    const ids = new Set();
    for (const v of [dados?.shipment_id, dados?.order_id, dados?.pack_id, dados?.nf_chave, dados?.nf_numero, dados?.magalu_protocolo]) {
      for (const x of variantesId(v)) ids.add(x);
    }
    if (ids.size === 0) return null;
    const { data } = await supabase.from('recados').select('id, texto').eq('ativo', true).is('ciente_em', null).in('chave', [...ids]).limit(1);
    if (!data || !data[0]) return null;
    // v4.45 - se a devolucao ja foi triada/tem NF, o recado ja cumpriu o papel
    if (await devolucaoJaResolvida([...ids])) return null;
    return data[0];
  } catch (e) { return null; }
}
function normId(v) {
  const s = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s || null;
}
function variantesId(v) {
  const n = normId(v);
  if (!n) return [];
  const out = [n];
  if (/^\d+$/.test(n)) {
    const semZeros = n.replace(/^0+/, '');
    if (semZeros && semZeros !== n) out.push(semZeros);
    if (n.length < 9) out.push(n.padStart(6, '0'));
  }
  return out;
}
function idsDoResultado(b) {
  const brutos = [
    b.order?.id, b.order_id, b.pack?.id, b.pack_id,
    b.shipment?.id, b.shipment_id,
    b.nf?.numero, b.nf?.chaveAcesso, b.nf?.chave,
    b.magalu?.protocolo, b.magalu?.pedido, b.magalu?.reverse_code,
    b.shopee?.order_sn, b.shopee?.tracking_number,
    b.ml_return?.tracking, b.codigo, b.codigo_original,
  ];
  const set = new Set();
  for (const x of brutos) for (const v of variantesId(x)) set.add(v);
  return [...set];
}
async function buscarRecados(body) {
  const ids = idsDoResultado(body);
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from('recados')
    .select('id, chave, texto, criado_por, criado_em, ciente_por, ciente_em')
    .eq('ativo', true)
    .in('chave', ids)
    .order('criado_em', { ascending: false });
  return data || [];
}
// ev2 - o bipe consulta o registro do CHECKOUT OFFLINE (eventos_checkout):
// se o codigo bipado casar com um pedido/NF que passou pelo checkout, o
// card mostra — inclusive (e principalmente) quando NADA mais achou.
async function buscarEventosCheckout(empresa, codigo) {
  try {
    if (!supabase) return [];
    let q = String(codigo || '').trim();
    // v5.3 (Codex): o QR da Magalu chega como JSON — o proprio bipe pela
    // camera ja fazia isso. Com pontuacao e mais de 60 caracteres ele nao
    // passava no formato aceito abaixo, e o card nunca recebia os eventos do
    // checkout, mesmo havendo um gravado sob aquele pedido. Aqui a gente tira
    // o pedido de dentro, do mesmo jeito que a busca principal faz (~424).
    if (q.charAt(0) === '{' && /external_grouper_code/i.test(q)) {
      try {
        const j = JSON.parse(q);
        q = String(j.external_grouper_code || '').trim();
      } catch (e) { /* JSON quebrado: cai no teste abaixo e sai */ }
    }
    if (!/^[A-Za-z0-9_-]{5,60}$/.test(q)) return [];
    const { data } = await supabase.from('eventos_checkout')
      .select('tipo, codigo, quem, criado_em, extra')
      .eq('empresa', empresa)
      .or('codigo.eq.' + q + ',codigo.ilike.%' + q + '%')
      .order('criado_em', { ascending: false })
      .limit(3);
    return data || [];
  } catch (e) { return []; }
}

app.use('/api/devolucao/identificar', (req, res, next) => {
  const enviar = res.json.bind(res);
  const codigoBipado = decodeURIComponent(String(req.path.split('/').pop() || '')).trim();
  res.json = (body) => {
    if (!body) return enviar(body);
    const tarefas = [];
    if (body.encontrado) {
      tarefas.push(buscarRecados(body).then(recados => { if (recados.length) body.recados = recados; }).catch(() => {}));
    }
    // ev2 - eventos do checkout entram SEMPRE (achado ou nao)
    tarefas.push(buscarEventosCheckout('good', codigoBipado).then(evs => { if (evs.length) body.eventos_checkout = evs; }).catch(() => {}));
    Promise.all(tarefas).then(() => enviar(body)).catch(() => enviar(body));
    return res;
  };
  next();
});

app.get('/api/devolucao/identificar/:codigo', requerLogin, async (req, res) => {
  const codigoOriginal = String(req.params.codigo || '').trim();

  if (!codigoOriginal) {
    return res.status(400).json({ ok: false, erro: 'Codigo nao informado' });
  }

  console.log(`\n========== NOVA BUSCA: ${codigoOriginal} ==========`);

  // v3.62 - QR da etiqueta MAGALU: um JSON com external_grouper_code (= o
  // PROTOCOLO do ticket, que o indice Magalu ja resolve na hora), alem de
  // external_code e tag_code (o codigo de barras 196634440-01). Formato
  // decodificado de etiqueta real. Detecta e extrai o protocolo ANTES de
  // qualquer outra coisa - o bipe do QR vira busca instantanea.
  let origemQrMagalu = false;
  let codigoLimpo = codigoOriginal.replace(/[^0-9]/g, '');
  if (/external_grouper_code|tag_code|logistical_flow/i.test(codigoOriginal)) {
    let proto = null;
    try {
      const j = JSON.parse(codigoOriginal);
      proto = String(j.external_grouper_code || '').replace(/\D/g, '');
    } catch (e) {
      // leitor USB pode mutilar o JSON (layout de teclado): o protocolo e o
      // unico numerao de 16 digitos comecando com o ano (20...)
      const m = codigoOriginal.match(/20\d{14}/);
      if (m) proto = m[0];
    }
    if (proto) {
      codigoLimpo = proto;
      origemQrMagalu = true;
      console.log(`[BUSCA] QR MAGALU detectado → protocolo ${proto}`);
    }
  }

  // v3.39 - QR das etiquetas ML vem como {"id":"47416667668","t":"lm"}
  // (leitor USB cospe o JSON cru no campo). Extrai o id e ja sabemos
  // que e ML - se o shipment nao existir, falha RAPIDO com orientacao
  // (padrao de devolucao FULL) em vez de vagar pela cascata.
  let origemQrML = false;
  let mQrML = origemQrMagalu ? null : codigoOriginal.match(/["']?[ïi]d["']?\s*[:=]\s*["']?(\d{8,20})/i);
  if (!origemQrMagalu && !mQrML && /^\{|"?t"?\s*[:=]\s*"?lm/i.test(codigoOriginal)) {
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

  // MAGALU-FIRST (v3.63): QR da etiqueta ou protocolo digitado (16 digitos
  // comecando com o ano) vao DIRETO pro Magalu - sem gastar tempo na
  // cascata ML (16 digitos caia como "pack ML" e esperava 404s a toa).
  const pistaMagalu = origemQrMagalu || /^20\d{14}$/.test(codigoLimpo);
  if (pistaMagalu) {
    if (await tentarDevolucaoMagalu()) return;
  }

  // CORREIOS REVERSO (v3.65): AD/AP...BR = devolucao por agencia. O codigo
  // e o rastreio da VOLTA (nao e shipment ML). O indice claims->returns
  // resolve tracking -> order -> preenche o shipment de IDA e o fluxo ML
  // existente faz o resto (buyer, NF, triagem, duplicata por shipment).
  const mCorreios = String(codigoOriginal || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{2}\d{9}BR)$/);
  if (!shipment && !pack && mCorreios) {
    const trk = mCorreios[1];
    let devML = null;
    try { devML = await mlReturns.acharPorTracking(trk); } catch (e) { devML = null; }
    resultado.tentativas.push({ tipo: 'correios_reverso_ml', codigo: trk, ok: !!(devML && devML.order_id), status: devML ? 200 : 404 });

    if (devML && devML.order_id) {
      console.log(`[BUSCA] CORREIOS ${trk} -> claim ${devML.claim_id} -> order ${devML.order_id}`);
      const rO = await chamarML(`https://api.mercadolibre.com/orders/${devML.order_id}`);
      const shipIdIda = rO.ok ? rO.data?.shipping?.id : null;
      // v3.70 - o order do claim JA veio completo (comprador, itens): entrega
      // ao fluxo em vez de deixar o downstream refazer a busca (e falhar).
      if (rO.ok && rO.data?.id) order = rO.data;
      if (shipIdIda) {
        const rS = await chamarML(`https://api.mercadolibre.com/shipments/${shipIdIda}`, { 'x-format-new': 'true' });
        if (rS.ok && rS.data?.id) { shipment = rS.data; metodoUsado = 'correios_reverso_ml'; }
      }
      resultado.ml_return = {
        tracking: trk, claim_id: devML.claim_id,
        shipment_devolucao: devML.shipment_devolucao, status_devolucao: devML.status_devolucao,
      };
      resultado.eh_devolucao = true;
      resultado.avisos.push({ tipo: 'correios_ml', mensagem: `Devolucao ML via CORREIOS (${trk}) - claim ${devML.claim_id}${devML.status_devolucao ? ' (' + devML.status_devolucao + ')' : ''}` });
      if (!shipment) {
        resultado.erro = `Rastreio ${trk} achou a devolucao ML (claim ${devML.claim_id}, pedido ${devML.order_id}) mas falhou ao carregar o pedido. Tente digitar o pedido, ou identifique pela NF.`;
        return res.status(404).json(resultado);
      }
    } else {
      // Sem match: orientacao clara (nao vaga pela cascata - 9 digitos
      // limpos cairiam na bissecao de NF e perderiam tempo a toa).
      resultado.erro = `Rastreio CORREIOS ${trk} nao encontrado nas devolucoes ML recentes${devML && devML.claim_id ? ` (claim ${devML.claim_id} sem pedido vinculado)` : ''}. Pode ser devolucao de OUTRO marketplace orientada pelos Correios (Shopee, TikTok...) - confira o REMETENTE na etiqueta, ou bipe a chave da DANFE se a nota vier na caixa.`;
      return res.status(404).json(resultado);
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

  // ML T2b (v4.14): ORDER ID. Faltava esta porta - o numero da venda que
  // aparece no painel do ML (2000...) e o que o Diego tem na mao quando
  // esta olhando o pedido. Antes so tentavamos pack_id, que devolve 400
  // porque o formato e parecido mas o recurso e outro.
  if (!returnData && !shipment && !pack && codigoLimpo.length >= 15 && /^\d+$/.test(codigoLimpo)) {
    const rOrd = await chamarML(`https://api.mercadolibre.com/orders/${codigoLimpo}`);
    resultado.tentativas.push({
      tipo: 'order_id', codigo: codigoLimpo,
      ok: rOrd.ok, status: rOrd.status, erro: rOrd.ok ? null : rOrd.error,
    });
    if (rOrd.ok && rOrd.data?.id) {
      order = rOrd.data;
      metodoUsado = 'order_id';
      // do pedido chegamos no envio (e dali segue o fluxo normal)
      const shipDoPedido = rOrd.data.shipping?.id;
      if (shipDoPedido) {
        const rShip = await chamarML(
          `https://api.mercadolibre.com/shipments/${shipDoPedido}`,
          { 'x-format-new': 'true' }
        );
        if (rShip.ok) shipment = rShip.data;
      }
      // e no pack, quando a venda faz parte de um
      if (!pack && rOrd.data.pack_id) {
        const rPk = await chamarML(`https://api.mercadolibre.com/packs/${rOrd.data.pack_id}`);
        if (rPk.ok && rPk.data?.id) pack = rPk.data;
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
  // v3.50 - NF por CHAVE (44 digitos) OU por NUMERO (4-9 digitos, ex: 75053).
  // O numero da NF cai num vao livre da cascata: ML shipment usa 10-13,
  // pack usa 15+, chave usa 44. Aceita tambem "75053/2" ou "75053-2" pra
  // escolher a serie (default: serie 1, o padrao da casa).
  const ehChaveNFe = codigoLimpo.length === 44;
  const mNumSerie = String(codigoOriginal || '').trim().match(/^(\d{4,9})\s*[\/\-]\s*(\d{1,3})$/);

  // seg5 - O "Pedido" DA ETIQUETA SHOPEE NAO E NUMERO DE NF.
  //
  // `codigoLimpo` nasce de codigoOriginal.replace(/[^0-9]/g,'') la em cima,
  // ou seja, SEM as letras. O order_sn da Shopee tem a forma
  // AAMMDD + alfanumerico (ex: 250807PBTHEWQG, impresso como "Pedido" na
  // etiqueta SPX Devolucao): ele perdia as letras, virava "250807" — seis
  // digitos — e casava com a regra de numero de NF (4-9 digitos).
  //
  // Consequencia medida em 27/08 com etiqueta real: a busca respondia
  // "NF 250807 nao localizada no Bling" e RETORNAVA ali, sem nunca chegar
  // no bloco da Shopee. Pior: e exatamente o codigo que a nossa propria
  // mensagem de erro manda o estoquista digitar quando a etiqueta SPX nao
  // casa pelo rastreio — o caminho de saida estava fechado.
  //
  // Numero de NF nao tem letra. Se o que foi digitado/bipado tem letra, a
  // cascata segue para os marketplaces em vez de morrer aqui.
  // seg5.1 (Codex): "tem letra => nao e NF" era grosseiro demais. Quem
  // digita costuma escrever "NF 75053", "NF: 002605", "NFe 75053" — e a
  // normalizacao antiga reduzia isso aos digitos de proposito. Com a regra
  // crua, esses passariam a vagar pela cascata e voltar "codigo nao
  // encontrado", tornando NF valida impossivel de buscar.
  //
  // Entao: tira um prefixo textual de NF, se houver, e SO depois checa se
  // sobrou letra. "NF 75053" -> "75053" (sem letra) = NF.
  // "250807PBTHEWQG" -> nao tem prefixo, sobra letra = nao e NF.
  // seg5.2 (Codex): so tirar PREFIXO nao bastava. Aparecem tambem
  // "75053 NFe" (rotulo no fim), "N 75053" e "Nota Fiscal n 75053" — o
  // marcador de numero. Todos normalizavam pros digitos antes e
  // funcionavam; com a regra anterior virariam NF impossivel de buscar.
  //
  // Agora os ROTULOS caem em qualquer posicao (com \b, entao "nf" no meio
  // de um codigo tipo 250807PBNFEWQG NAO e tocado) e a checagem de letra e
  // no que sobrou.
  const semRotulosNF = String(codigoOriginal || '').trim()
    .replace(/\b([A-Za-z])\s*\.\s*(?=[A-Za-z]\b)/g, '$1')             // "N.F." -> "NF" (abreviacao pontuada)
    .replace(/[\u00ba\u00b0]/g, ' ')                                   // º e ° viram espaco
    .replace(/\b(?:nf-?e?|nota|fiscal|n[uu\u00fa]mero|num|n)\b/gi, ' ')  // rotulos, em qualquer posicao
    .replace(/[\s:.#\-]+/g, '');                                        // pontuacao de separacao
  const temLetraNoOriginal = /[A-Za-z]/.test(semRotulosNF);
  const ehNumeroNF = !ehChaveNFe && (mNumSerie || (/^\d{4,9}$/.test(codigoLimpo) && !temLetraNoOriginal));

  if (!shipment && !pack && (ehChaveNFe || ehNumeroNF)) {
    let numeroDaChave, serieDaChave, idNF = null, tipoTentativa;

    if (ehChaveNFe) {
      const modelo = codigoLimpo.substr(20, 2);
      if (modelo !== '55') {
        // DACE/DC-e do transporte (modelo 99) e afins: nao e a NF do produto
        resultado.erro = `Isso e uma chave de documento de TRANSPORTE (modelo ${modelo}), nao a NF do produto. Bipe a chave da DANFE do produto ou o codigo de rastreio.`;
        resultado.tentativas.push({ tipo: 'chave_danfe', codigo: codigoLimpo, ok: false, status: 422 });
        return res.status(404).json(resultado);
      }
      numeroDaChave = String(parseInt(codigoLimpo.substr(25, 9), 10));
      serieDaChave = String(parseInt(codigoLimpo.substr(22, 3), 10));
      tipoTentativa = 'chave_danfe';
      console.log(`[BUSCA] CHAVE DANFE: serie=${serieDaChave} numero=${numeroDaChave}`);
      try { idNF = await resolverIdNFPorChave(numeroDaChave, codigoLimpo); } catch (e) { idNF = null; }
    } else {
      // Numero da NF digitado. MULTI-SERIE: a casa emite em varias series
      // (1=normal, 2=ML FULL, outras p/ Magalu/Amazon FULL) e o MESMO numero
      // pode existir em mais de uma. Nunca escolhemos sozinhos: se der
      // ambiguidade, devolvemos as opcoes pro estoquista decidir.
      numeroDaChave = mNumSerie ? mNumSerie[1] : codigoLimpo;
      serieDaChave = mNumSerie ? String(parseInt(mNumSerie[2], 10)) : null;
      tipoTentativa = 'numero_nf';
      console.log(`[BUSCA] NUMERO NF: numero=${numeroDaChave} serie=${serieDaChave || '(todas)'}`);
      let achadas = [];
      try { achadas = await buscarNFsPorNumero(numeroDaChave, serieDaChave); } catch (e) { achadas = []; }

      if (achadas.length > 1) {
        // AMBIGUIDADE: mesma numeracao em series diferentes. Carrega o basico
        // de cada uma (data, valor, produto) pro estoquista bater com a caixa.
        const opcoes = [];
        for (const a of achadas) {
          const rr = await buscarNFePorId(a.id);
          const n = (rr.ok && rr.data?.data) ? rr.data.data : null;
          if (!n) continue;
          const it0 = Array.isArray(n.itens) && n.itens.length ? n.itens[0] : null;
          opcoes.push({
            idBling: String(n.id),
            numero: n.numero,
            serie: n.serie,
            chave: n.chaveAcesso || null,
            dataEmissao: n.dataEmissao,
            valor: n.valorNota,
            cliente: (n.contato && n.contato.nome) ? n.contato.nome : null,
            produto: it0 ? (it0.descricao || null) : null,
            sku: it0 ? (it0.codigo || null) : null,
            numeroPedidoLoja: n.numeroPedidoLoja || null,
          });
        }
        resultado.tentativas.push({ tipo: 'numero_nf', codigo: String(codigoOriginal || '').trim(), ok: false, status: 300, erro: 'ambiguo (varias series)' });
        resultado.ambiguidade_nf = { numero: numeroDaChave, opcoes };
        resultado.erro = `Existem ${opcoes.length} NFs com o numero ${numeroDaChave}, em series diferentes. Escolha a que bate com o pacote (ou bipe a chave da DANFE).`;
        console.log(`[BUSCA] NUMERO NF ${numeroDaChave}: AMBIGUO em ${opcoes.length} series`);
        return res.status(409).json(resultado);
      }
      idNF = achadas.length === 1 ? achadas[0].id : null;
      if (achadas.length === 1) serieDaChave = achadas[0].serie;
    }

    resultado.tentativas.push({
      tipo: tipoTentativa,
      codigo: ehChaveNFe ? codigoLimpo : String(codigoOriginal || '').trim(),
      ok: !!idNF, status: idNF ? 200 : 404,
    });
    if (!idNF) {
      resultado.erro = ehChaveNFe
        ? `Chave lida, mas a NF ${numeroDaChave} (serie ${serieDaChave}) nao foi localizada no Bling.`
        : `NF ${numeroDaChave} nao localizada no Bling (procurei em todas as series, ultimos 18 meses). Confira o numero, ou bipe a chave da DANFE.`;
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
      chaveAcesso: nfCh.chaveAcesso || (ehChaveNFe ? codigoLimpo : null),
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
    resultado.metodo = ehChaveNFe ? 'chave_danfe' : 'numero_nf';
    resultado.eh_devolucao = true;
    resultado.avisos.push({
      tipo: ehChaveNFe ? 'nf_via_chave' : 'nf_via_numero',
      mensagem: ehChaveNFe
        ? `NF ${nfCh.numero} localizada pela chave da DANFE (bissecao)`
        : `NF ${nfCh.numero} (serie ${nfCh.serie}) localizada pelo numero digitado`,
    });
    console.log(`[BUSCA] OK (${ehChaveNFe ? 'CHAVE' : 'NUMERO'}) | NF=${nfCh.numero} pedido=${nfCh.numeroPedidoLoja || '-'}`);
    return res.json(resultado);
  }

  // ===== MAGALU: protocolo da etiqueta, reverse_code ou pedido =====
  // A etiqueta Magalu imprime "Protocolo: 2026062600477033" - e ele bate
  // exatamente com o ticket.protocol da API (confirmado com dado real).
  // Do ticket sai o PEDIDO, e do pedido sai a NF no Bling (numeroLoja).
  // v3.63 - extraido em funcao pra rodar em DOIS pontos: magalu-first
  // (antes do ML, quando o codigo tem cara de protocolo/QR Magalu) e
  // fallback tardio (depois do ML, pra reverse_code/pedido).
  async function tentarDevolucaoMagalu() {
    if (!magalu.cfg.ativo || !magalu.cfg.autorizado) return false;
    let devMag = null;
    try { devMag = await magalu.acharDevolucao(codigoLimpo); } catch (e) { devMag = null; }
    resultado.tentativas.push({
      tipo: 'magalu_devolucao', codigo: codigoLimpo,
      ok: !!devMag, status: devMag ? 200 : 404,
    });

    if (devMag) {
      console.log(`[BUSCA] MAGALU: protocolo=${devMag.protocolo} pedido=${devMag.pedido} status=${devMag.status}`);
      // v3.63.1 - A NF vinha VAZIA (e o CONFIRMAR barrava sem nf_chave):
      // a janela usava a data do TICKET, que abre semanas DEPOIS da venda -
      // a NF, emitida NA venda, ficava fora da janela (pra tras).
      // Cura definitiva: a propria API Magalu entrega a CHAVE da NF no
      // pedido (invoices[].key - confirmado em JSON real). Pegamos a chave
      // la e resolvemos no Bling pela chave (caminho ja provado). Fallbacks:
      // janela pela data da COMPRA (purchased_at) e, no pior caso, a chave
      // da Magalu sozinha ja destrava a triagem (nf_chave no payload).
      let nfMag = null;
      let chaveMagalu = null;
      let compradoEm = null;
      if (devMag.pedido) {
        try {
          const rPed = await magalu.chamarMagalu(`/seller/v1/orders/${encodeURIComponent(devMag.pedido)}`);
          if (rPed.ok && rPed.data) {
            // v3.64 - CONFIRMADO em JSON real: no /orders/{code} os invoices
            // vem DENTRO de deliveries[] (nao na raiz). Varre raiz + entregas.
            const colecoesInv = [rPed.data.invoices, ...((rPed.data.deliveries || []).map(d => d && d.invoices))];
            for (const arr of colecoesInv) {
              const k = (arr || []).map(i => i && i.key).find(kk => /^\d{44}$/.test(String(kk || '')));
              if (k) { chaveMagalu = String(k); break; }
            }
            compradoEm = rPed.data.purchased_at || null;
          }
        } catch (e) { /* segue pros fallbacks */ }
        if (chaveMagalu) {
          try {
            const numeroDaChaveMag = String(parseInt(chaveMagalu.substr(25, 9), 10));
            const idNFMag = await resolverIdNFPorChave(numeroDaChaveMag, chaveMagalu);
            if (idNFMag) {
              const rFullMag = await buscarNFePorId(idNFMag);
              nfMag = (rFullMag.ok && rFullMag.data?.data) ? rFullMag.data.data : null;
            }
          } catch (e) { nfMag = null; }
        }
        if (!nfMag) {
          try {
            const rB = await buscarNFBlindada({ orderId: devMag.pedido, dataReferencia: compradoEm || null, janelaDias: 45 });
            if (rB.ok && rB.nf) nfMag = rB.nf;
          } catch (e) { /* segue sem NF do Bling */ }
        }
      }

      const itensMag = (devMag.itens || []).map(it => ({
        titulo: it.titulo, sku: it.sku, ean: null,
        quantidade: it.quantidade, valor: null, unidade: null,
      }));

      if (nfMag) {
        resultado.nf = {
          fonte: 'bling',
          numero: nfMag.numero,
          serie: nfMag.serie,
          chaveAcesso: nfMag.chaveAcesso || chaveMagalu || null,
          valor: nfMag.valorNota,
          dataEmissao: nfMag.dataEmissao,
          linkDanfe: nfMag.linkDanfe,
          linkPdf: nfMag.linkPDF,
          linkXml: nfMag.xml,
          idBling: nfMag.id,
          numeroPedidoLoja: nfMag.numeroPedidoLoja,
          situacao: nfMag.situacao,
          itens: mapItensNF(nfMag),
        };
      } else if (chaveMagalu) {
        // Bling nao achou, mas a Magalu deu a chave: NF minima ja permite
        // triar (nf_chave vai no payload) e o card mostra numero/serie.
        resultado.nf = {
          fonte: 'magalu',
          numero: String(parseInt(chaveMagalu.substr(25, 9), 10)),
          serie: String(parseInt(chaveMagalu.substr(22, 3), 10)),
          chaveAcesso: chaveMagalu,
          valor: null, dataEmissao: compradoEm || null,
          linkDanfe: null, linkPdf: null, linkXml: null,
          idBling: null, numeroPedidoLoja: devMag.pedido || null,
          situacao: null, itens: [],
        };
      }

      const prim = itensMag.length ? itensMag[0] : null;
      resultado.order = {
        id: devMag.pedido || null,
        pack_id: null,
        buyer: {
          id: null,
          first_name: (nfMag && nfMag.contato && nfMag.contato.nome) ? nfMag.contato.nome : null,
          last_name: '', nickname: null,
        },
        order_items: prim
          ? [{ unit_price: null, quantity: prim.quantidade, item: { id: null, title: prim.titulo, seller_sku: prim.sku } }]
          : [],
      };
      resultado.shipment = { id: null };
      resultado.itens_devolucao = itensMag;
      resultado.encontrado = true;
      resultado.metodo = 'magalu_devolucao';
      resultado.eh_devolucao = true;
      const esp = espreita.porPedido(devolucao.pedido_id || devolucao.order_id);
      if (esp) {
        resultado.avisos.push({ tipo: 'espreita', mensagem: `📮 Devolucao REGISTRADA no portal Magalu Entregas (${esp.categoria}${esp.status ? ' - ' + esp.status : ''}${esp.entregue_em ? ' - entregue ' + String(esp.entregue_em).slice(0, 10) : ''})` });
      }
      resultado.magalu = {
        protocolo: devMag.protocolo,
        reverse_code: devMag.reverse_code,
        tipo: devMag.tipo,
        motivo: devMag.motivo,
        status: devMag.status,
        fechado: devMag.fechado,
      };
      resultado.avisos.push({
        tipo: 'magalu',
        mensagem: `Devolucao MAGALU - protocolo ${devMag.protocolo}${devMag.status ? ' (' + devMag.status + ')' : ''}${nfMag ? ' - NF ' + nfMag.numero : ' - NF nao localizada no Bling'}`,
      });
      console.log(`[BUSCA] OK (MAGALU) | protocolo=${devMag.protocolo} pedido=${devMag.pedido} NF=${nfMag ? nfMag.numero : '-'}`);
      res.json(resultado);
      return true;
    }
    return false;
  }

  // MAGALU fallback tardio: reverse_code (10 dig) ou pedido (16 dig sem cara
  // de protocolo) - so tenta se nada acima resolveu e nao tentou ainda.
  if (!shipment && !pack && !pistaMagalu) {
    if (await tentarDevolucaoMagalu()) return;
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
    // ===== TIKTOK (v4.66): depois da Shopee, antes da busca por nome =====
    //
    // Fica aqui porque o TikTok e o marketplace com MENOS etiquetas
    // bipaveis: das 99 devolucoes da Girassol, so 30 tem rastreio (o resto
    // e reembolso puro, que nunca vira pacote). Tentar antes dos outros
    // gastaria uma chamada de rede na maioria dos bipes pra nada.
    if (!devShopee) {
      try {
        const rTk = await tiktokDev.procurar(tiktokPonte, 'good', codigoOriginal, { limite: 200 });
        resultado.tentativas.push({
          tipo: 'tiktok_devolucao', codigo: codigoOriginal,
          ok: !!(rTk && rTk.achado), status: (rTk && rTk.achado) ? 200 : (rTk && rTk.ok ? 404 : 502),
          erro: rTk && rTk.erro ? String(rTk.erro).slice(0, 160) : undefined,
          // se a coleta la esta rodando ou falhou, "nao achei" NAO quer
          // dizer "nao existe" — e o que a ponte aprendeu a distinguir
          coleta_pendente: rTk && rTk.coleta_pendente ? true : undefined,
        });

        if (rTk && rTk.achado) {
          const d = rTk.achado;
          resultado.encontrado = true;
          resultado.metodo = 'tiktok_devolucao';
          resultado.eh_devolucao = true;
          resultado.marketplace = 'tiktok';
          resultado.tiktok = d;
          resultado.order = { id: d.pedido || null };
          resultado.shipment = { id: d.rastreio || null };

          // O AVISO QUE O DONO PEDIU: dizer se o pacote vem ou nao.
          //
          // Metade das "devolucoes" do TikTok e reembolso puro: o cliente
          // reclama, o TikTok aceita e compensa a loja, e nunca existe
          // retorno fisico. Sem este aviso, o estoquista ficaria esperando
          // um pacote que nao vai chegar.
          if (d.vai_chegar === false) {
            resultado.avisos.push({
              tipo: 'tiktok_sem_retorno',
              mensagem: 'TikTok: e REEMBOLSO, sem devolucao fisica ('
                + (d.motivo_texto || d.motivo || 'motivo nao informado')
                + '). Nenhum pacote vai chegar por esta solicitacao.',
            });
          } else if (d.vai_chegar === null) {
            resultado.avisos.push({
              tipo: 'tiktok_indefinido',
              mensagem: 'TikTok: solicitacao ainda EM ABERTO — pode virar devolucao com retorno ou so reembolso.',
            });
          }

          console.log(`[BUSCA] TIKTOK: id=${d.id} pedido=${d.pedido} vai_chegar=${d.vai_chegar}`);
          return res.json(resultado);
        }
      } catch (e) {
        resultado.tentativas.push({ tipo: 'tiktok_devolucao', codigo: codigoOriginal, ok: false, status: 500, erro: String(e.message || e).slice(0, 160) });
      }
    }

    if (!devShopee) {
      // v3.71 - ULTIMO RECURSO: o texto tem cara de NOME? (>=5 letras apos
      // colapsar). Casos: remetente da etiqueta Correios digitado/colado
      // ("RENATONEVES", "Renato Neves"). Devolve CANDIDATOS - o estoquista
      // confere com a caixa e escolhe (nada de casamento automatico).
      const alvoNome = nfNomes.colapsar(codigoOriginal);
      if (alvoNome.length >= 5 && !/^\d+$/.test(String(codigoOriginal).trim())) {
        try {
          const rN = await nfNomes.buscarPorNome(codigoOriginal);
          resultado.tentativas.push({ tipo: 'nf_por_nome', codigo: alvoNome, ok: rN.candidatos.length > 0, status: rN.candidatos.length ? 200 : 404, qtd: rN.candidatos.length });
          if (rN.candidatos.length > 0) {
            resultado.candidatos_nome = rN.candidatos;
            resultado.erro = `Achei ${rN.candidatos.length} NF(s) recente(s) com esse nome. Confere com a CAIXA e escolhe abaixo:`;
            return res.status(300).json(resultado); // 300 Multiple Choices
          }
        } catch (e) { resultado.tentativas.push({ tipo: 'nf_por_nome', codigo: alvoNome, ok: false, status: 500, erro: e.message }); }
      }
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
  // v4.13 - POR QUE voltou + o resumo do caso (o ML explica em portugues)
  try {
    const mot = classificarMotivoDevolucao(order, shipment);
    if (mot) {
      if (mot.reclamacao_id) {
        const ctx = await contextoDaReclamacao(mot.reclamacao_id);
        if (ctx) {
          mot.contexto = ctx;
          const rot = { arrependimento: 'Cliente se ARREPENDEU da compra', defeito: 'Cliente relatou DEFEITO no produto', item_errado: 'Cliente diz que veio o produto ERRADO', incompleto: 'Cliente diz que veio INCOMPLETO', devolvido: 'Produto devolvido' };
          if (ctx.motivo && rot[ctx.motivo]) mot.titulo = '⚠️ ' + rot[ctx.motivo];
          if (ctx.motivo === 'arrependimento') mot.detalhe = 'Não é defeito: o cliente só desistiu. O produto tende a estar em bom estado — confira e, se estiver ok, inclua no estoque.';
          else if (ctx.motivo === 'defeito') mot.detalhe = 'O cliente relatou defeito. Abra e procure o problema com atenção.';
        }
      }
      resultado.motivo_devolucao = mot;
    }
  } catch (e) { /* opcional: nunca atrapalha o bipe */ }
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

// ═══════════════════════════════════════════════════════════════════
// b338 - SONDAS DE LEITURA das notas de ENTRADA (GOOD). Fatia 1 de 2.
//
// Na AMB (b335) descobrimos que o indice do aviso "ja tem NF de devolucao"
// usava `tipo=1` CRAVADO — e a sonda provou, naquela conta, que tipo=1 lista
// VENDAS e tipo=0 lista ENTRADAS. Ou seja: o indice indexava venda achando
// que era devolucao e o aviso nunca casava nada.
//
// O `montarIndiceNFDevolucao` daqui tem o MESMO tipo=1 cravado, mas a GOOD e
// outro CNPJ e outra conta no Bling: o numero do tipo pode nao ser igual.
// Estas duas rotas so LEEM, pra medir antes de mexer — nenhuma altera o
// indice, o painel ou emissao. O conserto vem na fatia 2, depois de ver o
// resultado real.
// ═══════════════════════════════════════════════════════════════════

// Quais tipos existem e o que cada um lista (amostra pequena, resposta rapida).
app.get('/api/nf/entrada/sonda', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  try {
    const tipos = {};
    const erros = {};
    let falhouAlgum = false;
    for (const t of [0, 1, 2, 3]) {
      const r = await chamarBling(`https://api.bling.com.br/Api/v3/nfe?tipo=${t}&pagina=1&limite=6`);
      const lista = (r.ok && r.data?.data) || [];
      // b338 r2 (Codex #81): {ok:false} (429 esgotado, auth, timeout, rede)
      // virava "amostra vazia" e o operador podia concluir que aquele tipo nao
      // existe — escolhendo o tipo errado pro conserto do indice. Falha em
      // QUALQUER tipo marca a sonda inteira como incompleta.
      if (!r.ok) { falhouAlgum = true; erros['tipo_' + t] = r.erro || ('status ' + (r.status || 'sem resposta')); }
      tipos['tipo_' + t] = {
        http: r.status || null,
        leitura_ok: !!r.ok,
        qtd_na_pagina: lista.length,
        amostra: lista.slice(0, 5).map((n) => ({
          numero: n.numero,
          natureza: n.naturezaOperacao || null,
          contato: n.contato?.nome || null,
          data: n.dataEmissao || null,
        })),
      };
    }
    return res.json({ ok: true, empresa: 'GOOD',
      procure: 'o tipo cujas amostras tenham CLIENTE devolvendo (entradas); o outro sera o de VENDAS',
      atencao: 'o indice do aviso hoje usa tipo=1 cravado — se aqui tipo=1 for VENDA, o aviso nunca casou nada nesta conta',
      leitura_incompleta: falhouAlgum,
      erros_por_tipo: falhouAlgum ? erros : null,
      o_que_fazer: falhouAlgum
        ? 'UM OU MAIS TIPOS NAO FORAM LIDOS (ver erros_por_tipo) — tipo sem amostra aqui pode ser falha, nao ausencia; rode de novo antes de concluir qual e o de entrada'
        : 'compare as amostras e mande o resultado pro Claude',
      tipos });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

// Inventario das naturezas das notas de entrada, com NOME vindo do catalogo.
// (Na AMB o Bling nao manda `naturezaOperacao.descricao` nem na listagem nem
//  no detalhe; o nome so existe em /naturezas-operacoes — b337.)
const NF_NAT_CACHE_GOOD = new Map();   // idDaNota -> { id, descricao, em }
const NF_NAT_CACHE_GOOD_MAX = 3000;
const NF_NAT_CACHE_GOOD_TTL = 6 * 60 * 60 * 1000;   // rascunho ainda pode trocar de natureza
function guardarNaturezaGood(idNota, natId, natDesc) {
  if (!natId) return;                                 // nao resolvida: nao vira cache
  NF_NAT_CACHE_GOOD.set(String(idNota), { id: natId, descricao: natDesc, em: Date.now() });
  while (NF_NAT_CACHE_GOOD.size > NF_NAT_CACHE_GOOD_MAX) {
    NF_NAT_CACHE_GOOD.delete(NF_NAT_CACHE_GOOD.keys().next().value);
  }
}
// b338 r2 (Codex #81): nota que o Bling devolveu SEM natureza nao entra no
// cache (o valor nao esta resolvido), mas gastava uma vaga do orcamento a cada
// rodada — 40 rascunhos assim travavam pra sempre as notas seguintes, apesar de
// a resposta prometer que "cada rodada avanca". O marcador diz "esta ja foi
// tentada agora ha pouco": ela nao gasta vaga de novo, e volta a ser tentada
// quando o marcador vence.
const NF_NAT_TENTADA_GOOD = new Map();   // idDaNota -> ts
const NF_NAT_TENTADA_TTL = 30 * 60 * 1000;
function tentadaRecenteGood(idNota) {
  const ts = NF_NAT_TENTADA_GOOD.get(String(idNota));
  if (!ts) return false;
  if ((Date.now() - ts) > NF_NAT_TENTADA_TTL) { NF_NAT_TENTADA_GOOD.delete(String(idNota)); return false; }
  return true;
}
function marcarTentadaGood(idNota) {
  NF_NAT_TENTADA_GOOD.set(String(idNota), Date.now());
  while (NF_NAT_TENTADA_GOOD.size > NF_NAT_CACHE_GOOD_MAX) {
    NF_NAT_TENTADA_GOOD.delete(NF_NAT_TENTADA_GOOD.keys().next().value);
  }
}

function naturezaDoCacheGood(idNota) {
  const at = NF_NAT_CACHE_GOOD.get(String(idNota));
  if (!at) return null;
  if ((Date.now() - at.em) > NF_NAT_CACHE_GOOD_TTL) { NF_NAT_CACHE_GOOD.delete(String(idNota)); return null; }
  return at;
}

app.get('/api/nf/entrada/naturezas', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  try {
    const tipo = String(req.query.tipo != null ? req.query.tipo : '0');
    // b338 r2 (Codex #81): ?paginas=0, negativo ou texto virava laco que nao
    // roda nenhuma vez, e a rota devolvia inventario VAZIO com cara de completo
    // — e e desse inventario que sai a calibragem de producao.
    const paginasBrutas = Math.floor(Number(req.query.paginas));
    const paginas = Math.min(Number.isFinite(paginasBrutas) && paginasBrutas >= 1 ? paginasBrutas : 6, 15);
    const DESCARTAVEL = new Set([2, 9]);                // cancelada e denegada nao contam
    const porNatureza = new Map();
    let falhaLista = false, falhaDetalhe = 0, lidas = 0, descartadas = 0;
    const semNatureza = [];

    for (let p = 1; p <= paginas; p++) {
      const r = await chamarBling(`https://api.bling.com.br/Api/v3/nfe?tipo=${tipo}&pagina=${p}&limite=100`);
      if (!r.ok) { falhaLista = true; break; }         // chamarBling devolve {ok:false}, nao lanca
      const lista = r.data?.data || [];
      if (!lista.length) break;
      for (const n of lista) {
        if (DESCARTAVEL.has(Number(n.situacao))) { descartadas++; continue; }
        lidas++;
        const nat = n.naturezaOperacao || null;
        const id = nat && nat.id != null ? String(nat.id) : null;
        if (!id) { semNatureza.push({ id: n.id, numero: n.numero, contato: n.contato?.nome || null }); continue; }
        const at = porNatureza.get(id) || { qtd: 0, exemplo_nf: n.numero, exemplo_contato: n.contato?.nome || null, descricao_nota: (nat && nat.descricao) || null };
        at.qtd++;
        if (!at.descricao_nota && nat && nat.descricao) at.descricao_nota = nat.descricao;
        porNatureza.set(id, at);
      }
      if (lista.length < 100) break;
    }

    // notas cuja natureza so aparece no detalhe: orcamento por rodada, e o que
    // ja foi resolvido fica guardado — rodadas seguintes SOMAM (licao da b336).
    const TETO = 40;
    let orcamento = TETO, naoLidas = 0, doCache = 0, semClassificacao = 0;
    for (const nota of semNatureza) {
      let natId = null, natDesc = null;
      const emCache = naturezaDoCacheGood(nota.id);
      if (emCache) { natId = emCache.id; natDesc = emCache.descricao; doCache++; }
      else if (tentadaRecenteGood(nota.id)) {
        // ja tentada ha pouco e voltou sem natureza: nao gasta vaga (r2)
      } else if (orcamento > 0) {
        orcamento--;
        const rD = await chamarBling(`https://api.bling.com.br/Api/v3/nfe/${nota.id}`);
        if (rD.ok) {
          const nat = rD.data?.data?.naturezaOperacao || null;
          natId = nat && nat.id != null ? String(nat.id) : null;
          natDesc = (nat && nat.descricao) || null;
          if (natId) guardarNaturezaGood(nota.id, natId, natDesc);
          else marcarTentadaGood(nota.id);   // lida, mas segue sem classificacao
        } else falhaDetalhe++;
        await new Promise((r) => setTimeout(r, 120));
      } else { naoLidas++; continue; }
      if (!natId) semClassificacao++;
      const chave = natId || 'sem_natureza';
      const at = porNatureza.get(chave) || { qtd: 0, exemplo_nf: nota.numero, exemplo_contato: nota.contato, descricao_nota: natDesc };
      at.qtd++;
      if (!at.descricao_nota && natDesc) at.descricao_nota = natDesc;
      porNatureza.set(chave, at);
    }

    // nome de exibicao: catalogo do Bling
    let catalogoOk = false, catalogoErro = null, semNome = 0;
    try {
      const rCat = await blingClient.listarNaturezas(false);
      if (rCat.ok) {
        catalogoOk = true;
        const porId = new Map((rCat.naturezas || []).map((n) => [String(n.id), n.descricao]));
        for (const [id, at] of porNatureza) {
          if (id === 'sem_natureza') continue;
          const bruto = porId.get(String(id));
          // a lib troca descricao vazia pelo rotulo sintetico "natureza <id>",
          // que nao identifica nada — trata-se como ausencia (b337 r4)
          const nome = (bruto && bruto !== ('natureza ' + id)) ? bruto : null;
          if (nome) { at.descricao = nome; at.descricao_via = 'catalogo'; }
          else if (at.descricao_nota) { at.descricao = at.descricao_nota; at.descricao_via = 'nota'; }
          else { at.descricao_indisponivel = true; semNome++; }
        }
      } else catalogoErro = rCat.erro || ('status ' + rCat.status);
    } catch (e) { catalogoErro = String(e.message || e); }
    if (!catalogoOk) {
      for (const [id, at] of porNatureza) {
        if (id === 'sem_natureza') continue;
        if (!at.descricao && at.descricao_nota) { at.descricao = at.descricao_nota; at.descricao_via = 'nota'; }
        if (!at.descricao) at.descricao_indisponivel = true;
      }
    }

    const naturezas = [...porNatureza.entries()].map(([id, at]) => ({
      id,
      descricao: at.descricao || null,
      descricao_via: at.descricao_via || null,
      descricao_da_nota: at.descricao_nota || null,
      descricao_indisponivel: !!at.descricao_indisponivel,
      qtd: at.qtd,
      exemplo_nf: at.exemplo_nf,
      exemplo_contato: at.exemplo_contato,
      parece_devolucao_pelo_nome: /devolu/i.test(String(at.descricao || '')),
    })).sort((a, b) => b.qtd - a.qtd);

    // b338 r2 (Codex #81): nota lida com sucesso mas que segue SEM natureza cai
    // no grupo `sem_natureza`, que o passe do catalogo pula — falhaDetalhe,
    // naoLidas e semNome ficavam zerados e o resultado se declarava completo
    // com notas nao identificadas dentro.
    const grupoSemNatureza = porNatureza.get('sem_natureza');
    const naoClassificadas = grupoSemNatureza ? grupoSemNatureza.qtd : 0;
    const incompleto = falhaLista || falhaDetalhe > 0 || naoLidas > 0 || !catalogoOk || semNome > 0 || naoClassificadas > 0;
    return res.json({ ok: true, empresa: 'GOOD', tipo_lido: tipo, paginas_pedidas: paginas,
      leitura_incompleta: incompleto,
      falha_na_listagem: falhaLista, descricoes_que_falharam: falhaDetalhe,
      catalogo_de_naturezas_ok: catalogoOk, catalogo_erro: catalogoErro,
      naturezas_sem_nome_no_catalogo: semNome,
      notas_sem_natureza_nenhuma: naoClassificadas, tentadas_sem_sucesso: semClassificacao,
      sem_natureza_total: semNatureza.length, sem_natureza_ja_resolvidas: doCache, sem_natureza_nao_lidas: naoLidas,
      notas_lidas: lidas, canceladas_ou_denegadas: descartadas,
      naturezas,
      o_que_fazer: !catalogoOk
        ? 'SEM O CATALOGO (o Bling nao respondeu /naturezas-operacoes) — as naturezas ficam sem nome; rode de novo daqui a pouco'
        : (falhaLista || falhaDetalhe > 0)
        ? 'LEITURA INCOMPLETA — o Bling falhou em parte das consultas; rode de novo daqui a pouco'
        : naoLidas > 0
        ? `FALTA LER ${naoLidas} nota(s) (nao e erro do Bling): abra ESTA MESMA URL de novo — cada rodada avanca e SOMA com as anteriores.`
          + (naoClassificadas > 0 ? ` E ATENCAO: ${naoClassificadas} nota(s) ja lidas seguem SEM natureza nenhuma — NAO calibre com este resultado.` : '')
        : semNome > 0
        ? `${semNome} natureza(s) em uso NAO tem nome (nem no catalogo, nem na nota) — NAO calibre com este resultado: nao da pra saber o que elas representam`
        : naoClassificadas > 0
        ? `${naoClassificadas} nota(s) foram lidas mas continuam SEM natureza nenhuma — NAO calibre ainda; me mande o resultado assim mesmo que eu analiso`
        : 'ESTA ROTA SO MEDE. Mande o resultado pro Claude: com o tipo certo e a lista de naturezas em maos, a fatia 2 conserta o indice do aviso e cria a env de calibragem da GOOD' });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

// ============================================================
// DEBUG
// ============================================================
// b299 - as rotas de diagnostico deste ponto foram pra lib/rotas-debug.js (fatia 2)

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

// b299 - idem (fatia 2)
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
// b302 - /api/debug/ml-token foi pra lib/rotas-debug.js (fatia 4)

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

// ── seg1.2 - FREIO DE FORCA-BRUTA NO LOGIN (2a rodada da review) ──────
// Historia: seg1 usava usuario+X-Forwarded-For (o cliente escolhe o header
// = furava); seg1.1 passou a usar so o usuario (= um estranho conseguia
// TRANCAR a conta de todo mundo, ainda mais com os nomes vazando no
// /health). Agora sao DOIS baldes, e nenhum deles pode ser fechado por
// terceiros:
//   1) usuario + cliente -> 8 falhas em 10 min = 429 por 5 min
//   2) cliente (IP)      -> 30 falhas em 10 min = 429 por 5 min (spray)
// O IP vem de req.ip com "trust proxy" ligado, ou seja, o endereco que o
// proxy do Render carimba - nao o primeiro valor que o cliente mandou.
// Quem esta de castigo NUNCA e despejado pelo teto (senao bastava encher
// o mapa pra zerar a punicao); com o mapa cheio, chave nova nao entra.
const LOGIN_FALHAS = new Map();
const LOGIN_MAX_USUARIO = 8;
const LOGIN_MAX_CLIENTE = 30;
const LOGIN_JANELA_MS = 10 * 60 * 1000;
const LOGIN_CASTIGO_MS = 5 * 60 * 1000;
const LOGIN_TETO_CHAVES = 1000;

// seg1.3 (P2 da 3a rodada) - loginNome e a identidade COMPLETA (sem corte):
// e ela que resolve a conta e decide privilegio. O corte de 60 chars vive
// so na CHAVE do freio, senao duas contas com os mesmos 60 primeiros
// caracteres virariam a mesma identidade - e uma delas podia herdar admin.
function loginNome(usuario) {
  return String(usuario || '').trim().toLowerCase();
}
function loginIdent(usuario) {
  return loginNome(usuario).slice(0, 60);
}
// seg1.4 (P1 da 4a rodada) - nome maior que isto nem e olhado: normalizar
// uma string de megabytes uma vez POR CONTA cadastrada travava o event loop
// de graca, e nenhum login real tem 100 caracteres.
const LOGIN_NOME_MAX = 100;
// seg1.4 (P1 da 4a rodada) - o de-para normalizado sai UMA vez, no boot,
// em vez de percorrer USERS a cada tentativa. Nomes que colidem depois de
// normalizar (ex.: "Diego" e "diego" cadastrados juntos) ficam de FORA:
// nesse caso so a digitacao exata resolve, e nenhuma conta herda a
// identidade - nem o privilegio - da outra.
const USERS_NORM = (() => {
  const mapa = new Map();
  const ambiguos = new Set();
  for (const u of Object.keys(USERS)) {
    const n = loginNome(u);
    if (mapa.has(n)) { ambiguos.add(n); continue; }
    mapa.set(n, u);
  }
  for (const n of ambiguos) {
    mapa.delete(n);
    console.warn(`[LOGIN] atencao: contas que so diferem por maiusculas ("${n}") — sera exigida a digitacao exata`);
  }
  return mapa;
})();
function loginIp(req) {
  return String((req && (req.ip || (req.socket && req.socket.remoteAddress))) || '').slice(0, 45);
}
function loginChaves(req, usuario) {
  const ip = loginIp(req);
  return { doUsuario: 'u:' + loginIdent(usuario) + '|' + ip, doCliente: 'c:' + ip };
}
function castigoRestante(chave, agora) {
  const reg = LOGIN_FALHAS.get(chave);
  if (!reg || !reg.ate) return 0;
  if (agora < reg.ate) return Math.ceil((reg.ate - agora) / 1000);
  // seg1.5 (P2 da 5a rodada) - castigo cumprido zerava o balde INTEIRO, e
  // dentro da mesma janela de 10 min dava pra gastar 8 tentativas, esperar
  // os 5 min e gastar mais 8 (o dobro do limite anunciado). Agora so a
  // PUNICAO e liberada; a contagem sobrevive ate a janela fechar, entao o
  // proximo erro dentro dela volta a bloquear na hora. O acerto continua
  // limpando o balde do usuario naquele cliente.
  if (agora - reg.desde > LOGIN_JANELA_MS) { LOGIN_FALHAS.delete(chave); return 0; }
  reg.ate = 0;
  LOGIN_FALHAS.set(chave, reg);
  return 0;
}
function loginBloqueado(chaves) {
  const agora = Date.now();
  return Math.max(castigoRestante(chaves.doUsuario, agora), castigoRestante(chaves.doCliente, agora));
}
function podarFalhas(agora) {
  for (const [k, v] of LOGIN_FALHAS) {
    if (agora - v.desde > LOGIN_JANELA_MS && (!v.ate || agora > v.ate)) LOGIN_FALHAS.delete(k);
  }
  if (LOGIN_FALHAS.size <= LOGIN_TETO_CHAVES) return;
  const descartaveis = [...LOGIN_FALHAS.entries()]
    .filter(([, v]) => !(v.ate && agora < v.ate))     // em castigo fica
    .sort((a, b) => a[1].desde - b[1].desde);          // mais antigos primeiro
  let sobrando = LOGIN_FALHAS.size - LOGIN_TETO_CHAVES;
  for (const [k] of descartaveis) {
    if (sobrando <= 0) break;
    LOGIN_FALHAS.delete(k);
    sobrando -= 1;
  }
}
function marcarFalha(chave, limite, agora) {
  const existente = LOGIN_FALHAS.get(chave);
  if (!existente && LOGIN_FALHAS.size >= LOGIN_TETO_CHAVES) return;   // cheio de castigos: nao cria chave nova
  const reg = existente || { n: 0, desde: agora, ate: 0 };
  if (agora - reg.desde > LOGIN_JANELA_MS) { reg.n = 0; reg.desde = agora; reg.ate = 0; }
  reg.n += 1;
  if (reg.n >= limite) reg.ate = agora + LOGIN_CASTIGO_MS;
  LOGIN_FALHAS.set(chave, reg);
}
// seg1.3 (P1 da 3a rodada) - com o mapa cheio, marcarFalha simplesmente
// nao registrava: um cliente novo ganhava tentativas ilimitadas (fail-OPEN).
// Agora, se nao ha capacidade nem chave existente, a tentativa e RECUSADA
// antes de olhar a senha - o limitador degrada FECHANDO, nao abrindo.
function loginSemCapacidade(chaves) {
  if (LOGIN_FALHAS.size < LOGIN_TETO_CHAVES) return false;
  podarFalhas(Date.now());
  if (LOGIN_FALHAS.size < LOGIN_TETO_CHAVES) return false;
  return !LOGIN_FALHAS.has(chaves.doUsuario) && !LOGIN_FALHAS.has(chaves.doCliente);
}
function loginErrou(chaves) {
  const agora = Date.now();
  podarFalhas(agora);
  marcarFalha(chaves.doUsuario, LOGIN_MAX_USUARIO, agora);
  marcarFalha(chaves.doCliente, LOGIN_MAX_CLIENTE, agora);
}
function loginAcertou(chaves) {
  // limpa so o balde do usuario naquele cliente; o do cliente segue
  // contando, senao um acerto no meio zeraria a varredura
  LOGIN_FALHAS.delete(chaves.doUsuario);
}

app.post('/api/auth/login', (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) {
    return res.status(400).json({ ok: false, erro: 'Usuario ou senha faltando' });
  }
  // seg1.2 (P2 da review) - o USERS da GOOD e sensivel a maiusculas, mas a
  // chave do freio normaliza. Resolvendo a conta REAL antes, as duas coisas
  // passam a falar da mesma identidade (e "diego" entra na conta "Diego",
  // igual a AMB ja fazia) - e o nome gravado na sessao sai na grafia
  // CADASTRADA, nao como foi digitado.
  if (String(usuario).length > LOGIN_NOME_MAX) {
    return res.status(401).json({ ok: false, erro: 'Usuario ou senha invalidos' });
  }
  // exata primeiro; senao o de-para normalizado (sem ambiguas)
  const contaReal = Object.prototype.hasOwnProperty.call(USERS, usuario)
    ? usuario
    : (USERS_NORM.get(loginNome(usuario)) || null);
  const chavesFreio = loginChaves(req, contaReal || usuario);
  const esperar = loginBloqueado(chavesFreio);
  if (esperar) {
    return res.status(429).json({ ok: false, erro: `Muitas tentativas. Tente de novo em ${Math.ceil(esperar / 60)} min.` });
  }
  if (loginSemCapacidade(chavesFreio)) {
    return res.status(429).json({ ok: false, erro: 'Sistema recebendo muitas tentativas de login. Tente de novo em alguns minutos.' });
  }
  const senhaCorreta = contaReal ? USERS[contaReal] : null;
  if (!senhaCorreta || senhaCorreta !== senha) {
    loginErrou(chavesFreio);
    return res.status(401).json({ ok: false, erro: 'Usuario ou senha invalidos' });
  }
  loginAcertou(chavesFreio);

  // Define o tipo: admin se a conta == ADMIN_USER, senao estoquista
  // seg1.4 (P1 da 4a rodada) - privilegio exige igualdade EXATA com a conta
  // configurada como admin. Comparar normalizado permitiria que a conta
  // "Diego" recebesse admin quando o ADMIN_USER e "diego" (ou vice-versa).
  const tipo = (ADMIN_USER && contaReal === ADMIN_USER) ? 'admin' : 'estoquista';

  const token = novaSessao(contaReal, tipo);
  res.cookie('sessao', token, {
    httpOnly: true,
    sameSite: 'lax',
    // v4.25 - em producao (Render, HTTPS) o cookie so trafega criptografado.
    // Em localhost fica desligado pra nao atrapalhar teste local.
    secure: process.env.NODE_ENV === 'production' || !!process.env.RENDER,
    maxAge: 12 * 60 * 60 * 1000, // 12h
  });
  console.log(`[LOGIN] ${contaReal} (${tipo})`);
  return res.json({ ok: true, usuario: contaReal, tipo });
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
// v4.50 - SESSAO ASSINADA: sobrevive ao restart do servico.
// Antes as sessoes viviam so em memoria e cada deploy deslogava todo mundo.
// Agora o token carrega usuario/tipo/validade com uma assinatura HMAC.
// Os tokens antigos continuam aceitos enquanto o processo viver.
function _segredoSessao() {
  return String(process.env.SESSION_SECRET || process.env.ADMIN_KEY || 'good-sem-segredo');
}
function _assinar(p) {
  return crypto.createHmac('sha256', _segredoSessao()).update(p).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function novaSessaoAssinada(usuario, tipo, validadeMs) {
  const payload = JSON.stringify({ u: usuario, t: tipo, e: Date.now() + (validadeMs || 12 * 60 * 60 * 1000) });
  const p = Buffer.from(payload).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return p + '.' + _assinar(p);
}
function validarSessaoAssinada(token) {
  if (!token || !token.includes('.')) return null;
  const [p, assin] = token.split('.');
  if (!p || !assin) return null;
  let esperada;
  try { esperada = _assinar(p); } catch (e) { return null; }
  if (esperada.length !== assin.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(assin))) return null;
    const d = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!d || !d.u) return null;
    if (d.e && Date.now() > d.e) return null;
    return { usuario: d.u, tipo: d.t };
  } catch (e) { return null; }
}

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
  // v3.64 - a MESMA devolucao pode ter sido gravada por identificadores
  // diferentes (chave da NF num bipe, protocolo Magalu noutro). A checagem
  // aceita um segundo id via ?tambem= e busca por OR nas duas colunas.
  // b166.1 - aceita VARIOS ?tambem= (o front agora manda todas as portas:
  // shipment, pedido, chave, numero da NF, rastreio). Express entrega
  // repetidos como array; um valor so vem como string.
  const brutos = req.query.tambem;
  const lista = Array.isArray(brutos) ? brutos : (brutos ? [brutos] : []);
  const ids = [ident];
  for (const t of lista) {
    const v = String(t || '').trim();
    if (v && !ids.includes(v)) ids.push(v);
  }
  const ors = [];
  for (const idv of ids) {
    const seguro = idv.replace(/[",()]/g, '');
    ors.push(`shipment_id.eq.${seguro}`);
    // b166.1 - as mesmas portas da AMB. O front manda todas agora, e um
    // registro gravado so pelo pedido, pelo numero da NF ou pelo rastreio
    // dos Correios passava batido — dava pra triar de novo sem aviso.
    ors.push(`order_id.eq.${seguro}`);
    // b167 - o PACK amarra IDA e VOLTA da mesma venda (ver comentario da AMB)
    ors.push(`pack_id.eq.${seguro}`);
    ors.push(`nf_numero.eq.${seguro}`);
    if (/^\d{44}$/.test(seguro)) ors.push(`nf_chave.eq.${seguro}`);
  }
  try {
    const { data, error } = await supabase
      .from('devolucoes')
      // b166.2 - funcionario entra no select: a tela usa esse campo pra dizer
      // QUEM triou. Sem ele, mostrava 'Por ?' mesmo com o nome no banco.
      .select('id, created_at, tipo, status, problema_descricao, problema_fotos, data_concluido, nf_numero, produto_qtd, funcionario')
      .or(ors.join(','))
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ ok: false, erro: error.message });
    }
    return res.json({ ok: true, registros: data || [], ids_buscados: ids });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// Caminho APROVAR (INCLUIR ESTOQUE)
// v4.59 - ENRIQUECIMENTO EM SEGUNDO PLANO
//
// Faz, DEPOIS de responder ao estoquista, o que antes travava o salvamento:
// descobre o numero do pedido no Bling e os itens da NF, e completa o
// registro. Se falhar, o registro continua valido -- os dois campos sao de
// conveniencia, nao de operacao (o proprio codigo antigo ja salvava sem eles
// quando estourava o tempo).
//
// Roda uma vez por registro, sem fila e sem retry: se nao vier agora, vem na
// proxima vez que alguem abrir o card ou pelo botao de gerar NF, que resolvem
// pelo mesmo caminho.
// Dispara o enriquecimento SEM segurar a resposta. O catch existe pra que
// uma falha aqui nunca vire promessa sem dono e derrube o processo.
function agendarEnriquecimento(registroId, dados) {
  setImmediate(() => {
    enriquecerTriagem(registroId, dados).catch((e) =>
      console.warn('[TRIAGEM] enriquecimento em background falhou:', e.message || e));
  });
}

async function enriquecerTriagem(registroId, dados) {
  if (!supabase || !registroId) return;
  const patch = {};

  try {
    if (dados.order_id) {
      const r = await Promise.race([
        buscarPedidoBlingPorNumeroLoja(String(dados.order_id), dados.nf_data_emissao || null, { maxPaginas: 12 }),
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, timeout: true }), 25000)),
      ]);
      if (r?.ok && r.match?.numero) patch.pedido_bling_numero = String(r.match.numero);
    }
  } catch (e) { /* cosmetico: segue */ }

  try {
    let idBling = dados.nf_id_bling || null;
    if (!idBling && dados.nf_chave && dados.nf_numero) {
      try { idBling = await resolverIdNFPorChave(dados.nf_numero, dados.nf_chave); } catch (e) { idBling = null; }
    }
    if (idBling) {
      patch.nf_id_bling = String(idBling);
      const rIt = await buscarNFePorId(String(idBling));
      const itens = (rIt.ok && rIt.data?.data) ? mapItensNF(rIt.data.data) : null;
      if (itens) patch.nf_itens = itens;
    }
  } catch (e) { /* idem */ }

  if (!Object.keys(patch).length) return;
  try {
    const { error } = await supabase.from('devolucoes').update(patch).eq('id', registroId);
    if (error) console.warn('[TRIAGEM] enriquecimento nao gravou:', error.message);
    else console.log(`[TRIAGEM] enriquecido ${registroId}: ${Object.keys(patch).join(', ')}`);
  } catch (e) {
    console.warn('[TRIAGEM] enriquecimento falhou:', e.message || e);
  }
}

app.post('/api/triagem/aprovar', requerEstoquista, async (req, res) => {
  {
    const pend = await recadoPendente(req.body?.dados || req.body);
    if (pend) return res.status(409).json({ ok: false, erro: 'RECADO PENDENTE: leia o recado e clique em "OK, ciente" antes de triar. ("' + String(pend.texto).slice(0, 120) + '")' });
  }
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  const dados = req.body || {};

  // v3.62.1 - vendas sem shipment (Magalu, chave DANFE, numero da NF) sao
  // identificadas pela nf_chave. A validacao aceita qualquer um dos dois -
  // era so o insert que aceitava (v3.49), a validacao ficou pra tras e
  // barrava o CONFIRMAR com "shipment_id obrigatorio".
  if (!dados.shipment_id && !dados.nf_chave && !dados.magalu_protocolo) {
    return res.status(400).json({ ok: false, erro: 'shipment_id, nf_chave ou magalu_protocolo obrigatorio' });
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
      .eq('shipment_id', String(dados.shipment_id || dados.nf_chave || dados.magalu_protocolo || '')) // v3.64: mesmo identificador que o insert grava
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
    // v4.59 - GRAVA PRIMEIRO, ENRIQUECE DEPOIS.
    //
    // Ate aqui a rota fazia DUAS consultas ao Bling ANTES de gravar: o
    // numero do pedido (varrendo ate 12 paginas, teto de 20s) e os itens da
    // NF. O estoquista ficava olhando "Salvando..." o tempo todo -- e o
    // proprio codigo ja admitia que o numero do pedido e cosmetico, porque
    // no timeout salvava sem ele.
    //
    // Pior que a espera: ela abria uma janela de CORRIDA. A checagem de
    // duplicata roda ANTES, e a gravacao SO DEPOIS das consultas; nesses
    // segundos, uma segunda requisicao (recarregar a pagina, rede do celular
    // reenviando) passava pela checagem tambem, porque a primeira ainda nao
    // tinha gravado. Foi o que gerou a triagem em dobro de 29/08 -- dois
    // registros com o MESMO shipment, com 2 minutos de diferenca.
    //
    // Agora o insert acontece de imediato e o resto chega depois, em
    // segundo plano. Nenhuma triagem depende mais de o Bling estar rapido
    // (ou no ar) pra ser salva.
    const idBlingAprovar = dados.nf_id_bling || null;
    const pedidoBlingNumero = null;   // preenchido pelo enriquecimento
    const nfItens = null;             // idem

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
        shipment_id: String(dados.shipment_id || dados.nf_chave || dados.magalu_protocolo || ''), // v3.64: identificador em cascata (shipment > chave NF > protocolo Magalu)
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
        // v4.77 - a lista do que REALMENTE voltou, quando a bipagem
        // registrou. O produto_sku sozinho descreve a NOTA em caso
        // multi-item, nao a devolucao.
        itens_devolvidos: dados.itens_devolvidos || null,
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
        problema_descricao: (dados.forcar ? '[RE-BIPE] ' : '') + descricaoRegistro,
        // v3.17.0 - se for parcial, salva as fotos no mesmo campo das fotos de problema
        problema_fotos: ehParcial ? fotosParcial : null,
      }])
      .select()
      .single();

    if (error) {
      // v4.59 - 23505 = violacao de unicidade. Com o indice unico em
      // shipment_id (docs/INDICE-UNICO-TRIAGEM.md), a corrida que escapa da
      // checagem la em cima morre AQUI -- no banco, o unico lugar onde duas
      // requisicoes simultaneas nao conseguem se enganar. O estoquista ve a
      // mensagem de sempre, nao um erro cru.
      if (error.code === '23505') {
        console.warn(`[TRIAGEM] duplicata barrada pelo banco: shipment=${dados.shipment_id}`);
        return res.status(409).json({ ok: false, erro: 'duplicata', mensagem: 'Esta devolucao ja foi triada antes' });
      }
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
    agendarEnriquecimento(data.id, dados);
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
  {
    // v4.09 - localizacao obrigatoria (o produto vai ficar guardado em algum
    // lugar; sem isso ninguem acha depois). Nao se aplica ao fluxo de conserto,
    // que tem rota propria e manda o item pro estoque.
    const dloc = String((req.body && (req.body.localizacao || (req.body.dados && req.body.dados.localizacao))) || '').trim();
    if (!dloc) return res.status(400).json({ ok: false, erro: 'Informe ONDE VAI GUARDAR o produto com defeito' });
  }
  {
    const pend = await recadoPendente(req.body?.dados || req.body);
    if (pend) return res.status(409).json({ ok: false, erro: 'RECADO PENDENTE: leia o recado e clique em "OK, ciente" antes de triar. ("' + String(pend.texto).slice(0, 120) + '")' });
  }
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  const dados = req.body || {};

  // v3.62.1 - vendas sem shipment (Magalu, chave DANFE, numero da NF) sao
  // identificadas pela nf_chave. A validacao aceita qualquer um dos dois -
  // era so o insert que aceitava (v3.49), a validacao ficou pra tras e
  // barrava o CONFIRMAR com "shipment_id obrigatorio".
  if (!dados.shipment_id && !dados.nf_chave && !dados.magalu_protocolo) {
    return res.status(400).json({ ok: false, erro: 'shipment_id, nf_chave ou magalu_protocolo obrigatorio' });
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
      .eq('shipment_id', String(dados.shipment_id || dados.nf_chave || dados.magalu_protocolo || '')) // v3.64: mesmo identificador que o insert grava
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
    // v4.59 - grava primeiro, enriquece depois (igual ao /aprovar). Aqui era
    // ainda pior: 50 paginas e SEM teto de tempo, entao o "Salvando..." podia
    // ficar preso indefinidamente. E essa espera era tambem a janela em que
    // uma segunda requisicao passava pela checagem de duplicata.
    const pedidoBlingNumero = null;   // preenchido pelo enriquecimento

    const { data, error } = await supabase
      .from('devolucoes')
      .insert([{
        shipment_id: String(dados.shipment_id || dados.nf_chave || dados.magalu_protocolo || ''), // v3.64: identificador em cascata (shipment > chave NF > protocolo Magalu)
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
        // v4.77 - a lista do que REALMENTE voltou, quando a bipagem
        // registrou. O produto_sku sozinho descreve a NOTA em caso
        // multi-item, nao a devolucao.
        itens_devolvidos: dados.itens_devolvidos || null,
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
        problema_descricao: ((dados.forcar ? '[RE-BIPE] ' : '') + `[Reportado por ${req.usuario}] ${dados.descricao || ''}`).trim(),
        problema_fotos: fotos,
        localizacao: dados.localizacao || null,
        defeito_qtd: dados.defeito_qtd || null,
      }])
      .select()
      .single();

    if (error) {
      // v4.59 - 23505 = violacao de unicidade. Com o indice unico em
      // shipment_id (docs/INDICE-UNICO-TRIAGEM.md), a corrida que escapa da
      // checagem la em cima morre AQUI -- no banco, o unico lugar onde duas
      // requisicoes simultaneas nao conseguem se enganar. O estoquista ve a
      // mensagem de sempre, nao um erro cru.
      if (error.code === '23505') {
        console.warn(`[TRIAGEM] duplicata barrada pelo banco: shipment=${dados.shipment_id}`);
        return res.status(409).json({ ok: false, erro: 'duplicata', mensagem: 'Esta devolucao ja foi triada antes' });
      }
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

    agendarEnriquecimento(data.id, dados);   // v4.59 - depois de responder
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
  {
    const pend = await recadoPendente(req.body?.dados || req.body);
    if (pend) return res.status(409).json({ ok: false, erro: 'RECADO PENDENTE: leia o recado e clique em "OK, ciente" antes de triar.' });
  }
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  const dados = req.body || {};

  // v3.62.1 - vendas sem shipment (Magalu, chave DANFE, numero da NF) sao
  // identificadas pela nf_chave. A validacao aceita qualquer um dos dois -
  // era so o insert que aceitava (v3.49), a validacao ficou pra tras e
  // barrava o CONFIRMAR com "shipment_id obrigatorio".
  if (!dados.shipment_id && !dados.nf_chave && !dados.magalu_protocolo) {
    return res.status(400).json({ ok: false, erro: 'shipment_id, nf_chave ou magalu_protocolo obrigatorio' });
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
      .eq('shipment_id', String(dados.shipment_id || dados.nf_chave || dados.magalu_protocolo || '')) // v3.64: mesmo identificador que o insert grava
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
    // v4.59 - grava primeiro, enriquece depois (igual as outras duas rotas
    // de triagem): 50 paginas sem teto travavam o "Salvando..." e abriam a
    // janela de duplicata.
    const pedidoBlingNumero = null;   // preenchido pelo enriquecimento

    const obs = (dados.observacao || '').trim();
    const skuEsperado = dados.produto_sku_esperado || '?';
    const skuVoltou = dados.produto_correto_sku;
    const descricao = `[DIVERGENTE por ${req.usuario}] NF tinha SKU ${skuEsperado}, mas voltou SKU ${skuVoltou} (${dados.produto_correto_titulo || '?'})${obs ? '. OBS: ' + obs : ''}`;

    const { data, error } = await supabase
      .from('devolucoes')
      .insert([{
        shipment_id: String(dados.shipment_id || dados.nf_chave || dados.magalu_protocolo || ''), // v3.64: identificador em cascata (shipment > chave NF > protocolo Magalu)
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
        problema_descricao: (dados.forcar ? '[RE-BIPE] ' : '') + descricao,
        problema_fotos: fotos,
      }])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {   // v4.59 - idem: duplicata barrada pelo banco
        console.warn(`[TRIAGEM] duplicata barrada pelo banco: shipment=${dados.shipment_id}`);
        return res.status(409).json({ ok: false, erro: 'duplicata', mensagem: 'Esta devolucao ja foi triada antes' });
      }
      console.error('[TRIAGEM] Erro Supabase divergente:', error);
      return res.status(500).json({ ok: false, erro: error.message });
    }

    console.log(`[TRIAGEM] DIVERGENTE por ${req.usuario}: shipment=${dados.shipment_id} esperado=${skuEsperado} voltou=${skuVoltou} fotos=${fotos.length}`);
    // v3.18.0 - NAO dispara email (Diego pediu)
    agendarEnriquecimento(data.id, dados);   // v4.59 - depois de responder
    return res.json({ ok: true, id: data.id, registro: data });
  } catch (err) {
    console.error('[TRIAGEM] Erro divergente:', err);
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

async function enviarEmailProblema(devolucao, fotos, usuario) {
  if (!mailer) return;

  const baseUrl = (process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  const linkAdmin = baseUrl ? `${baseUrl}/painel-devolucoes.html` : '/painel-devolucoes.html';

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
      <p style="font-size:14px;">
        <strong>🔧 Qtd com defeito:</strong> ${devolucao.defeito_qtd || '-'} &nbsp;|&nbsp;
        <strong>📍 Guardado em:</strong> ${devolucao.localizacao || '-'}
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
// v3.94 - arquivo renomeado para painel-devolucoes.html (admin.html se
// confundia com index.html na hora de subir). O /admin.html antigo continua
// funcionando como redirect, entao links e favoritos nao quebram.
app.get('/admin.html', (req, res) => res.redirect('/painel-devolucoes.html'));
app.get('/painel-devolucoes.html', requerAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'painel-devolucoes.html'));
});

// v3.16.0: Pagina de relatorios (requer auth)
// v3.91 - /defeitos.html e servido pelo express.static (public/). A API
// /api/defeitos e quem exige sessao de estoquista. (rota dedicada removida:
// era inalcancavel pois o static resolve primeiro, e causava confusao.)
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

    // v4.67 - ENTREGA PARCIAL: o mesmo pedido pode voltar em VARIAS caixas
    //
    // O TikTok abre uma solicitacao de devolucao por ITEM da nota, cada uma
    // com seu rastreio. Sem este cruzamento, o admin ve a 1a triagem e emite
    // a NF achando que acabou — e a 2a caixa chega depois, sem lugar.
    //
    // Pedido do dono: "deixa o card tipo 1o Devolucao triada / AGUARDADO 2a
    // devolucao" e "as 2 sendo devolvidas e triadas, mudar a condicao do
    // card, e saberei q posso emitir a NF".
    //
    // Falha aqui NAO pode derrubar a listagem: sem o cruzamento a tela
    // volta a ser a de antes, que ja funcionava.
    let comParcial = data;
    try {
      const pedidos = [...new Set(data.map(d => d.order_id).filter(Boolean))];
      if (pedidos.length && supabase) {
        const { data: cap } = await supabase
          .from('devolucoes_capturadas')
          .select('pedido, tipo_tiktok, status')
          .in('pedido', pedidos.slice(0, 300));
        comParcial = devParcial.anotar(data, devParcial.esperadoDeCapturadas(cap || []));
      }
    } catch (e) {
      console.warn('[ADMIN] cruzamento de entrega parcial falhou:', e.message || e);
    }

    // Separa por tipo
    const aprovadas = comParcial.filter(d => d.tipo === 'aprovado');
    const problemas = comParcial.filter(d => d.tipo === 'problema');
    const divergentes = comParcial.filter(d => d.tipo === 'divergente'); // v3.18.0

    // b200 - DECODIFICAR os marcadores no servidor.
    //
    // Os paineis liam a `problema_descricao` com regex, cada um por conta
    // propria — e eu esqueci de um leitor TRES vezes seguidas. Agora a peca
    // unica decodifica aqui, e a tela le campos normais.
    res.json({
      ok: true,
      aprovadas: marcadores.enriquecer(aprovadas),
      problemas: marcadores.enriquecer(problemas),
      divergentes, // v3.18.0
      total: comParcial.length,
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
// ============================================================
// MAGALU (v3.52) - OAuth + exploracao da API de devolucoes
// ------------------------------------------------------------
// PAGINAS PUBLICAS: a Magalu EXIGE URLs de Termos de Uso e Politica de
// Privacidade na criacao do client (parametros --terms-of-use e
// --privacy-term do IDM CLI). Servimos aqui pra nao depender de site externo.
// ============================================================
const _paginaLegal = (titulo, corpo) => `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo} - GOOD Import</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222}
h1{font-size:24px;border-bottom:2px solid #eee;padding-bottom:10px}h2{font-size:17px;margin-top:26px}
p,li{font-size:15px}footer{margin-top:40px;padding-top:16px;border-top:1px solid #eee;color:#888;font-size:13px}</style>
</head><body><h1>${titulo}</h1>${corpo}
<footer>GOOD Import — sistema interno de gestao de devolucoes.<br>Contato: pelo Portal do Seller Magalu.</footer></body></html>`;

app.get('/termos-de-uso', (req, res) => {
  res.type('html').send(_paginaLegal('Termos de Uso', `
    <p>Esta aplicacao e de uso <b>interno e exclusivo</b> da GOOD Import, destinada a
    organizar o recebimento e a triagem de produtos devolvidos pelos marketplaces
    em que a empresa vende.</p>
    <h2>1. Finalidade</h2>
    <p>O sistema identifica a venda de origem de um pacote devolvido, localiza a nota
    fiscal correspondente e registra a conferencia feita pela equipe do galpao.</p>
    <h2>2. Uso das integracoes</h2>
    <p>A aplicacao se conecta a APIs de marketplaces (incluindo o Grupo Magalu) apenas
    para <b>leitura</b> das informacoes das proprias vendas e devolucoes da GOOD Import,
    com autorizacao expressa do titular da conta de vendedor.</p>
    <h2>3. Acesso</h2>
    <p>O acesso e restrito a colaboradores autorizados, mediante login. Nao ha cadastro
    publico nem oferta do servico a terceiros.</p>
    <h2>4. Responsabilidade</h2>
    <p>A aplicacao e fornecida para uso operacional proprio, sem garantias comerciais,
    e pode ser alterada ou descontinuada a qualquer momento pela GOOD Import.</p>
  `));
});

app.get('/politica-de-privacidade', (req, res) => {
  res.type('html').send(_paginaLegal('Politica de Privacidade', `
    <p>Esta aplicacao e um sistema interno da GOOD Import. Nao coletamos dados de
    visitantes nem comercializamos qualquer informacao.</p>
    <h2>1. Dados acessados</h2>
    <p>Com a autorizacao do titular da conta de vendedor, acessamos, <b>somente para
    leitura</b>, dados das proprias vendas e devolucoes da GOOD Import nos marketplaces:
    identificadores de pedido, itens, notas fiscais e dados de remessa reversa.</p>
    <h2>2. Finalidade do tratamento</h2>
    <p>Os dados sao usados exclusivamente para identificar a qual venda pertence um
    pacote devolvido e registrar a conferencia interna do produto.</p>
    <h2>3. Compartilhamento</h2>
    <p>Nao compartilhamos dados com terceiros. As informacoes ficam restritas ao
    ambiente da propria empresa e aos colaboradores autorizados.</p>
    <h2>4. Armazenamento e seguranca</h2>
    <p>Os registros ficam em banco de dados de acesso restrito. As credenciais de
    integracao sao guardadas de forma segura no ambiente do servidor e usadas apenas
    para as chamadas autorizadas pelos escopos consentidos.</p>
    <h2>5. Revogacao</h2>
    <p>O titular da conta de vendedor pode revogar a autorizacao a qualquer momento
    pelo ID Magalu, encerrando imediatamente o acesso desta aplicacao.</p>
    <h2>6. Titular</h2>
    <p>Encarregado/contato: responsavel pela conta de vendedor da GOOD Import,
    acessivel pelo Portal do Seller Magalu.</p>
  `));
});

// Passo 1 do OAuth: manda o Diego (seller) pra tela de consentimento
app.get('/magalu/autorizar', requerAdmin, (req, res) => {
  if (!magalu.cfg.ativo) {
    return res.status(400).type('html').send(_paginaLegal('Magalu - falta configurar', `
      <p>Defina no Render as envs <b>MAGALU_CLIENT_ID</b>, <b>MAGALU_CLIENT_SECRET</b>
      e <b>MAGALU_REDIRECT_URI</b> antes de autorizar.</p>`));
  }
  return res.redirect(magalu.urlConsentimento('good'));
});

// Passo 2 do OAuth: a Magalu devolve o ?code= aqui. Trocamos por tokens.
// ATENCAO: esta rota e PUBLICA de proposito (o ID Magalu redireciona pra ca
// sem cookie da nossa sessao). Ela so aceita um code valido de 10 min e de
// uso unico - sem code valido, nao faz nada.
app.get('/magalu/callback', async (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) {
    return res.status(400).type('html').send(_paginaLegal('Magalu', '<p>Callback sem <b>code</b>. Refaca a autorizacao.</p>'));
  }
  try {
    const r = await magalu.trocarCodePorTokens(code);
    return res.type('html').send(_paginaLegal('Magalu conectada ✅', `
      <p><b>Autorizacao concluida.</b> Os tokens foram salvos.</p>
      <p>Escopos concedidos:<br><code>${(r.scope || '-').replace(/</g, '&lt;')}</code></p>
      <p>Pode fechar esta aba e voltar ao sistema.</p>`));
  } catch (e) {
    const det = e.response?.data ? JSON.stringify(e.response.data) : (e.message || String(e));
    return res.status(500).type('html').send(_paginaLegal('Magalu - erro', `
      <p>Falha ao trocar o code por tokens:</p><pre>${det.replace(/</g, '&lt;')}</pre>
      <p>O code vale 10 minutos e e de uso unico - tente autorizar de novo.</p>`));
  }
});

// Diagnostico: estado da conexao
// b301 - rotas de diagnostico do Magalu/ML foram pra lib/rotas-debug.js (fatia 3)

// v3.80 - baixa manual + comentario por item da espreita (tabela espreita_notas)
app.post('/api/admin/espreita/nota', requerAdmin, async (req, res) => {
  const chave = String(req.body?.chave || '').trim();
  if (!chave) return res.status(400).json({ ok: false, erro: 'chave obrigatoria' });
  const registro = { chave, atualizado_em: new Date().toISOString(), usuario: req.usuario || null };
  if (typeof req.body.baixado === 'boolean') registro.baixado = req.body.baixado;
  if (typeof req.body.comentario === 'string') registro.comentario = req.body.comentario.slice(0, 2000);
  if (typeof req.body.ticket === 'string') registro.ticket = req.body.ticket.slice(0, 60); // v4.31
  try {
    const { error } = await supabase.from('espreita_notas').upsert(registro, { onConflict: 'chave' });
    if (error) {
      const msg = String(error.message || '');
      if (/espreita_notas/.test(msg) && /not exist|find the table|schema cache/i.test(msg)) {
        return res.status(500).json({ ok: false, erro: 'Tabela espreita_notas ainda nao existe no Supabase - rode o SQL que o Claude passou.' });
      }
      return res.status(500).json({ ok: false, erro: msg });
    }
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

// v3.99 - "JA TENHO ESTE SKU EM DEFEITO?": mostrado pro estoquista no momento
// de reportar o problema. Se existe unidade do mesmo SKU guardada, ele pode
// canibalizar uma peca e salvar o produto que acabou de voltar.
app.get('/api/defeitos/por-sku', requerEstoquista, async (req, res) => {
  const sku = String(req.query.sku || '').trim();
  if (!sku) return res.json({ ok: true, itens: [] });
  try {
    const { data, error } = await supabase
      .from('devolucoes')
      .select('id, created_at, tipo, status, produto_titulo, produto_sku, localizacao, defeito_qtd, problema_descricao')
      .in('tipo', ['problema', 'defeito_estoque'])
      .ilike('produto_sku', sku)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    // so o que ja esta guardado de fato (regra: devolucao so conta apos a NF)
    const liberados = (data || []).filter(d => d.tipo === 'defeito_estoque' || d.status === 'concluido');
    if (liberados.length === 0) return res.json({ ok: true, itens: [] });
    // pecas ja retiradas de cada um (pra ele saber o que ainda tem)
    const ids = liberados.map(d => d.id);
    let porItem = {};
    try {
      const { data: pcs } = await supabase.from('pecas_retiradas').select('defeito_id, peca, quem, criado_em, usada_em').in('defeito_id', ids);
      for (const p of (pcs || [])) (porItem[p.defeito_id] = porItem[p.defeito_id] || []).push(p);
    } catch (e) { /* tabela pode nao existir ainda */ }
    const itens = liberados.map(d => ({
      id: d.id,
      produto: d.produto_titulo || null,
      sku: d.produto_sku || null,
      local: d.localizacao || null,
      qtd: d.defeito_qtd || 1,
      origem: d.tipo === 'defeito_estoque' ? 'estoque' : 'devolucao',
      defeito: (d.problema_descricao || '')
        .replace(/^\[RE-BIPE\]\s*/, '')
        .replace(/^\[Reportado por [^\]]+\]\s*/, '')
        .replace(/^\[LANCADO MANUAL por [^\]]+\]\s*/, ''),
      pecas_retiradas: (porItem[d.id] || []).map(p => ({ peca: p.peca, quem: p.quem, quando: p.criado_em, usada_em: p.usada_em })),
    }));
    return res.json({ ok: true, itens });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

// v3.99 - CONSERTADO: o estoquista salvou o produto (eventualmente com peca
// tirada de outra unidade em defeito). O item vai pra fila de APROVADAS - o
// Diego emite a NF incluindo em estoque e ainda contesta o marketplace. O
// item doador CONTINUA contando como defeito, so ganha a nota do que saiu.
app.post('/api/triagem/consertado', requerEstoquista, async (req, res) => {
  {
    const pend = await recadoPendente(req.body?.dados || req.body);
    if (pend) return res.status(409).json({ ok: false, erro: 'RECADO PENDENTE: leia o recado e clique em "OK, ciente" antes de triar.' });
  }
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  const dados = req.body || {};
  if (!dados.shipment_id && !dados.nf_chave && !dados.magalu_protocolo) {
    return res.status(400).json({ ok: false, erro: 'shipment_id, nf_chave ou magalu_protocolo obrigatorio' });
  }
  const problema = String(dados.descricao || '').trim();
  const peca = String(dados.peca || '').trim();
  const doadorId = dados.doador_id ? Number(dados.doador_id) : null;
  if (!problema) return res.status(400).json({ ok: false, erro: 'descreva o que estava com defeito' });

  const infoConserto = 'CONSERTADO por ' + req.usuario + ': ' + problema
    + (peca ? (' | peca usada: ' + peca) : '')
    + (doadorId ? (' | retirada do defeito #' + doadorId) : '');

  try {
    const { data, error } = await supabase
      .from('devolucoes')
      .insert([{
        shipment_id: String(dados.shipment_id || dados.nf_chave || dados.magalu_protocolo || ''),
        order_id: dados.order_id ? String(dados.order_id) : null,
        pack_id: dados.pack_id ? String(dados.pack_id) : null,
        buyer_id: dados.buyer_id ? String(dados.buyer_id) : null,
        buyer_nome: dados.buyer_nome || null,
        buyer_nickname: dados.buyer_nickname || null,
        produto_titulo: dados.produto_titulo || null,
        produto_mlb: dados.produto_mlb || null,
        produto_sku: dados.produto_sku || null,
        produto_qtd: dados.produto_qtd || null,
        // v4.77 - a lista do que REALMENTE voltou, quando a bipagem
        // registrou. O produto_sku sozinho descreve a NOTA em caso
        // multi-item, nao a devolucao.
        itens_devolvidos: dados.itens_devolvidos || null,
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
        funcionario: req.usuario,
        problema_descricao: '[CONSERTADO] ' + problema + (peca ? (' (peca: ' + peca + ')') : ''),
        problema_fotos: Array.isArray(dados.fotos) ? dados.fotos : null,
        conserto_info: infoConserto,
      }])
      .select()
      .single();
    if (error) {
      const m = String(error.message || '');
      if (/conserto_info/.test(m)) return res.status(500).json({ ok: false, erro: 'Coluna conserto_info ainda nao existe - rode o SQL.' });
      return res.status(500).json({ ok: false, erro: m });
    }

    // nota permanente no item que doou a peca (ele CONTINUA em defeito)
    if (doadorId && peca) {
      try {
        await supabase.from('pecas_retiradas').insert([{
          defeito_id: doadorId,
          peca: peca,
          usada_em: (dados.nf_numero ? ('NF ' + dados.nf_numero) : (dados.order_id ? ('pedido ' + dados.order_id) : null)),
          quem: req.usuario,
        }]);
      } catch (e) { console.warn('[CONSERTO] nao gravou a peca retirada:', e.message); }
    }

    try { await enviarEmailProblema({ ...data, problema_descricao: infoConserto }, [], req.usuario); } catch (e) { /* email e best-effort */ }
    return res.json({ ok: true, id: data.id, conserto: infoConserto });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

// v4.00 - BUSCA DE PRODUTO com INDICE LOCAL.
// Por que: o filtro textual do Bling ignorou o termo e devolveu a listagem
// padrao (buscar "930b" trouxe produtos aleatorios comecando com L). Entao
// paramos de confiar no filtro deles: montamos um indice do catalogo uma vez
// e filtramos AQUI por substring de verdade - acha "930b" dentro de
// "930bPRETO-1xLed-1xGarra", em qualquer posicao, no nome ou no codigo.
const IDX_PROD = { ts: 0, itens: [], construindo: false, erro: null };
// v4.07 - os EANs lidos ficam num cache por SKU. Antes viviam so dentro dos
// objetos do indice: qualquer rebuild (ou o pre-aquecimento apos um deploy)
// recriava os objetos e os EANs sumiam - enquanto a leitura antiga seguia
// preenchendo objetos orfaos. Agora o rebuild reaproveita o que ja foi lido.
const EAN_POR_SKU = new Map();
// v4.08 - imagem do produto: o Bling nao tem campo padrao (pode vir em
// imagemURL, linkImagem, imagens[], midia.imagens.internas[], anexos[]...).
// Varremos o objeto atras da primeira URL que pareca imagem.
const IMG_POR_SKU = new Map();
/**
 * v4.54 - IMAGEM DO PRODUTO sem exigir extensao na URL.
 * O extrairImagem abaixo so aceita link terminado em .jpg/.png/etc - e as
 * fotos do catalogo vem do Google Drive (lh3.googleusercontent.com/d/ID),
 * que NAO tem extensao. Resultado: a foto existia e era descartada.
 * Esta funcao le os lugares certos do Bling, na ordem, sem esse filtro -
 * e a mesma logica que ja funciona no checkout offline.
 */
function imagemDoProduto(prod) {
  if (!prod) return null;
  if (prod.imagemURL) return prod.imagemURL;
  const im = prod.midia && prod.midia.imagens;
  if (im) {
    if (im.externas && im.externas[0] && im.externas[0].link) return im.externas[0].link;
    if (im.imagensURL && im.imagensURL[0]) return im.imagensURL[0].link || im.imagensURL[0];
    if (im.internas && im.internas[0] && im.internas[0].link) return im.internas[0].link;
  }
  return extrairImagem(prod);   // ultimo recurso: a varredura antiga
}

function extrairImagem(obj, prof = 0) {
  if (!obj || prof > 6) return null;
  if (typeof obj === 'string') {
    const u = obj.trim();
    return /^https?:\/\//i.test(u) && /\.(jpe?g|png|webp|gif|bmp)(\?|$)/i.test(u) ? u : null;
  }
  if (Array.isArray(obj)) {
    for (const it of obj) { const r = extrairImagem(it, prof + 1); if (r) return r; }
    return null;
  }
  if (typeof obj === 'object') {
    // campos mais provaveis primeiro
    for (const k of ['link', 'linkMiniatura', 'imagemURL', 'imagemUrl', 'urlImagem', 'linkImagem', 'url', 'src']) {
      const r = extrairImagem(obj[k], prof + 1);
      if (r) return r;
    }
    for (const k of Object.keys(obj)) {
      const r = extrairImagem(obj[k], prof + 1);
      if (r) return r;
    }
  }
  return null;
}
const PROD_TTL_MS = 30 * 60 * 1000;

// v4.02 - O EAN no Bling aparece com MUITOS nomes diferentes (o produto do
// Diego guarda em "GTIN/EAN tributario"). Esta funcao varre todos os campos
// conhecidos - licao aprendida no projeto Localizacao x Estoque GOOD.
function possiveisGtins(p) {
  if (!p) return [];
  const t = p.tributacao || {};
  const cands = [
    p.gtin, p.ean, p.codigoBarras, p.gtinEan, p.gtinTributario, p.gtinEmbalagem,
    t.gtin, t.ean, t.gtinTributario, t.codigoBarras,
  ];
  const out = [];
  for (const c of cands) {
    const v = String(c == null ? '' : c).replace(/\D/g, '');
    if (v.length >= 8 && !out.includes(v)) out.push(v);
  }
  return out;
}

function normProd(t) {
  return String(t == null ? '' : t)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().trim();
}

async function construirIndiceProdutos() {
  if (IDX_PROD.construindo) return IDX_PROD;
  IDX_PROD.construindo = true;
  const t0 = Date.now();
  const itens = [];
  const falhas = [];
  let paginasLidas = 0;
  IDX_PROD.erro = null;
  try {
    // v4.03 - antes eu parava na PRIMEIRA recusa do Bling (ele derruba
    // requisicao muito seguida) e ainda apagava a mensagem de erro no fim -
    // o indice ficava com 1 pagina e dizia "erro: null". Agora insiste e
    // guarda o motivo real de cada falha.
    for (let pagina = 1; pagina <= 40; pagina++) {
      let r = null;
      for (let tent = 1; tent <= 3; tent++) {
        r = await chamarBling(`https://api.bling.com.br/Api/v3/produtos?pagina=${pagina}&limite=100`);
        if (r && r.ok) break;
        falhas.push(`pagina ${pagina} tentativa ${tent}: ${(r && (r.status || r.error)) || 'falhou'}`);
        await new Promise(r2 => setTimeout(r2, 1200 * tent));
      }
      if (!r || !r.ok) { IDX_PROD.erro = `parou na pagina ${pagina} apos 3 tentativas`; break; }
      paginasLidas++;
      const lista = (r.data && r.data.data) || [];
      for (const p of lista) {
        const skuItem = String(p.codigo || '').trim();
        const eansCache = EAN_POR_SKU.get(skuItem.toUpperCase()) || null;
        const imgCache = IMG_POR_SKU.get(skuItem.toUpperCase()) || extrairImagem(p) || null;
        itens.push({
          id: p.id || null,
          sku: skuItem,
          nome: p.nome || p.descricao || '',
          ean: (eansCache && eansCache[0]) || p.gtin || '',
          eans: eansCache || undefined,
          eansCarregados: !!eansCache,
          imagem: imgCache,
          busca: normProd(skuItem + ' ' + (p.nome || '') + ' ' + ((eansCache || []).join(' ') || p.gtin || '')),
        });
      }
      if (lista.length < 100) break;
      await new Promise(r2 => setTimeout(r2, 700));
    }
    IDX_PROD.itens = itens;
    IDX_PROD.ts = Date.now();
    IDX_PROD.paginas = paginasLidas;
    IDX_PROD.falhas = falhas.slice(0, 8);
    if (itens.length === 0 && !IDX_PROD.erro) IDX_PROD.erro = 'catalogo vazio';
    console.log(`[PRODUTOS] indice: ${itens.length} produtos, ${paginasLidas} pagina(s), ${falhas.length} falha(s), em ${Math.round((Date.now() - t0) / 1000)}s`);
    enriquecerEansEmBackground();
  } catch (e) {
    IDX_PROD.erro = e.message;
    console.error('[PRODUTOS] indice falhou:', e.message);
  } finally {
    IDX_PROD.construindo = false;
  }
  return IDX_PROD;
}

// v4.05 - RESTAURADO: este bloco foi apagado por engano na v4.03 (ao
// reescrever a funcao do indice por fatia de texto, levei junto o que vinha
// logo depois). O arquivo chamava enriquecerEansEmBackground() em 3 lugares
// sem a funcao existir: o servidor subia e caia ~70s depois, em loop.
//
// Busca o DETALHE de cada produto pra descobrir o EAN - e a unica fonte
// confiavel (a listagem do Bling nao traz GTIN). Roda em background, um por
// vez, pra nao tomar bloqueio.
let EAN_RODANDO = false;
const EAN_PROGRESSO = { feitos: 0, total: 0, comEan: 0, concluido: false };
function enriquecerEansEmBackground() {
  if (EAN_RODANDO) return;
  const fila = IDX_PROD.itens.filter(p => p.id && !p.eansCarregados);
  if (fila.length === 0) { EAN_PROGRESSO.concluido = true; return; }
  EAN_RODANDO = true;
  EAN_PROGRESSO.total = fila.length;
  EAN_PROGRESSO.feitos = 0;
  EAN_PROGRESSO.concluido = false;
  (async () => {
    console.log(`[PRODUTOS] buscando EAN de ${fila.length} produtos (background)...`);
    for (const p of fila) {
      try {
        await esperarVezDetalhe();                        // v4.67 - ritmo global
        const r = await chamarBling(`https://api.bling.com.br/Api/v3/produtos/${p.id}`);
        const det = (r && r.ok && ((r.data && r.data.data) || r.data)) || null;
        const eans = possiveisGtins(det);
        p.eans = eans;
        p.eansCarregados = true;
        if (eans.length) {
          p.ean = eans[0];
          p.busca = normProd(p.sku + ' ' + p.nome + ' ' + eans.join(' '));
          EAN_POR_SKU.set(String(p.sku || '').toUpperCase(), eans); // v4.07: sobrevive ao rebuild
          EAN_PROGRESSO.comEan++;
        }
        // v4.08 - mesma leitura ja traz a imagem (sem chamada extra)
        const img = extrairImagem(det);
        if (img) { p.imagem = img; IMG_POR_SKU.set(String(p.sku || '').toUpperCase(), img); }
      } catch (e) { p.eansCarregados = true; }
      EAN_PROGRESSO.feitos++;
      await new Promise(r2 => setTimeout(r2, 340));
    }
    EAN_PROGRESSO.concluido = true;
    console.log(`[PRODUTOS] EANs prontos: ${EAN_PROGRESSO.comEan} de ${fila.length} (cache: ${EAN_POR_SKU.size} SKUs)`);
    // v4.07 - se o indice foi reconstruido no meio do caminho, retoma o que ficou
    if (IDX_PROD.itens.some(x => x.id && !x.eansCarregados)) {
      EAN_RODANDO = false;
      setTimeout(() => enriquecerEansEmBackground(), 1500);
    }
  })().catch(e => console.error('[PRODUTOS] enriquecimento EAN falhou:', e.message))
    .finally(() => { EAN_RODANDO = false; });
}

// v4.53 - cache do FORMATO de cada produto. A listagem do Bling nem sempre
// diz se e kit; o detalhe diz. Como o mesmo produto reaparece em varias
// buscas, guardamos o resultado (o formato de um produto quase nunca muda).
// v4.66 (porte da AMB b180-b182) - COMPONENTES DO KIT.
// O Bling entrega a estrutura do kit com o produto SO PELO ID (sem
// `codigo`), entao o mapeamento que exigia c.produto.codigo saia VAZIO:
// a mensagem nao citava a composicao e a tela nao tinha o que oferecer.
const SKU_POR_ID = new Map();          // idProduto -> { sku, nome, ts }
const COMPS_POR_KIT = new Map();       // idKit -> { itens, faltando, ts }
const KIT_TTL_MS = 6 * 60 * 60 * 1000;
const COMPONENTES_MAX = 12;
const COMPONENTES_PRAZO_MS = 8000;
function skuCacheGet(id) {
  const reg = id ? SKU_POR_ID.get(id) : null;
  if (!reg) return null;
  if (Date.now() - reg.ts > KIT_TTL_MS) { SKU_POR_ID.delete(id); return null; }
  return reg;
}
function skuCacheSet(id, sku, nome, imagem) {
  if (id && sku) SKU_POR_ID.set(id, { sku, nome: nome || '', imagem: imagem || null, ts: Date.now() });
}
function compsCacheGet(id) {
  const reg = id ? COMPS_POR_KIT.get(id) : null;
  if (!reg) return null;
  if (Date.now() - reg.ts > KIT_TTL_MS) { COMPS_POR_KIT.delete(id); return null; }
  return reg;
}
function extrairComponentes(det) {
  if (!det) return [];
  const lugares = [
    det.estrutura && det.estrutura.componentes,
    det.componentes,
    det.estrutura && det.estrutura.itens,
  ];
  for (const l of lugares) if (Array.isArray(l) && l.length) return l;
  return [];
}
// Devolve TAMBEM o que nao resolveu: entregar so as pecas resolvidas como
// se fossem a composicao inteira faria o estoquista lancar em metade do
// kit sem saber (falha do Bling, kit grande, ou o prazo estourando).
async function resolverComponentesKit(comps, limiteExterno) {
  const brutos = Array.isArray(comps) ? comps : [];
  const lista = brutos.filter(Boolean);
  // v4.68 (review do Codex) - entrada NULA na estrutura tambem e uma peca
  // que o operador nao vai ver: some do array mas entra em `faltando`,
  // senao a composicao seria dada como completa (e cacheada por 6h).
  const nulos = brutos.length - lista.length;
  // v4.69 (review do Codex) - quando o chamador ja abriu um prazo (a busca
  // da estrutura do kit), ele e REAPROVEITADO: antes a estrutura gastava 8s
  // e a resolucao das pecas abria outros 8s, entao um unico kit podia
  // segurar a busca por ~16s (e a busca visita ate 3 kits).
  const limite = limiteExterno || (Date.now() + COMPONENTES_PRAZO_MS);
  const alvos = lista.slice(0, COMPONENTES_MAX);
  const truncados = Math.max(0, lista.length - alvos.length);
  const out = [];
  let naoResolvidos = nulos;
  // v4.79 - MOTIVO de cada peca que nao entrou (prazo? erro? sem codigo?):
  // sem isso o aviso "nao consegui listar N peca(s)" nao da pra consertar
  const motivos = { nulos: nulos, prazo: 0, fila: 0, erro: 0, sem_sku: 0, truncados: 0, tentou_de_novo: 0 };
  for (const c of alvos) {
    const p = (c && c.produto) || {};
    const id = p.id || c.idProduto || c.produtoId || null;
    let sku = String(p.codigo || p.sku || '').trim();
    let falhouComponente = false;
let imagem = null;   // v4.84   // b196/v4.80 - motivo DESTE componente
    let nome = String(p.nome || p.descricao || '').trim();
    if (!sku && id) {
      const emCache = skuCacheGet(id);
      if (emCache) { sku = emCache.sku; nome = nome || emCache.nome; imagem = emCache.imagem || null; }
      else if (Date.now() >= limite) { naoResolvidos++; motivos.prazo++; falhouComponente = true; continue; }
      else {
        try {
          // v4.71 - a vaga na fila ja nasce dentro do prazo do kit
          if (!(await esperarVezDetalhe(limite - Date.now()))) { naoResolvidos++; motivos.fila++; falhouComponente = true; continue; }
          const restante = limite - Date.now();
          if (restante <= 0) { naoResolvidos++; motivos.prazo++; falhouComponente = true; continue; }
          // v4.79 - UMA SEGUNDA CHANCE dentro do prazo: o `semRetentativa`
          // (que evita requisicao orfa) fazia qualquer tropeco do Bling — um
          // 429 no meio da rajada da propria busca — virar "peca faltando"
          // na tela, mesmo com prazo de sobra. Foi o caso do kit que veio
          // com uma peca listada e a outra nao.
          let d = null;
          let falhouNoBling = false;
          for (let tentativa = 0; tentativa < 2; tentativa++) {
            // v4.80 (review do Codex) - CADA tentativa reserva sua vaga na
            // fila global (a 2a ia direto ao Bling depois do sleep fixo)
            if (tentativa > 0 && !(await esperarVezDetalhe(limite - Date.now()))) { motivos.fila++; break; }
            const sobra = limite - Date.now();
            if (sobra <= 300) { motivos.prazo++; break; }
            const rr = await comPrazo(
              chamarBling(`https://api.bling.com.br/Api/v3/produtos/${id}`, { timeout: sobra, semRetentativa: true }),
              sobra);
          d = (rr && rr.ok && rr.data && rr.data.data) || null;
          if (d) { falhouNoBling = false; break; }
          falhouNoBling = true;   // resposta !ok NAO lanca excecao
          // v4.81 (review do Codex) - so re-tenta o que PODE dar certo sem
          // mudar nada: 429/5xx/rede. Em 401 o semRetentativa impede a
          // renovacao do token (a 2a tentativa usaria o mesmo token morto) e
          // 404 e deterministico — re-tentar so gastava prazo do kit.
          const st = (rr && rr.status) || 0;
          if (st === 401 || st === 403 || st === 404) break;

            motivos.tentou_de_novo++;
            if (limite - Date.now() <= 900) break;
            // v4.82 (review do Codex) - so espera se AINDA VAI tentar: depois
            // da ultima tentativa os 600ms eram prazo do kit jogado fora.
            if (tentativa === 0) await new Promise(r2 => setTimeout(r2, 600));
          }
          if (falhouNoBling) { motivos.erro++; falhouComponente = true; }   // v4.80 - erro do Bling, nao "sem codigo"
          if (d) {
            sku = String(d.codigo || d.sku || '').trim();
            nome = nome || String(d.nome || d.descricao || '').trim();
            // v4.84 (pedido do Diego) - a PECA leva a propria foto: sem ela
            // o front caia na imagem do KIT e parecia que ele tinha
            // selecionado o kit inteiro em vez da lampada.
            imagem = imagemDoProduto(d) || null;
            skuCacheSet(id, sku, nome, imagem);
          }
        } catch (e) {
          // b197/v4.81 (review do Codex) - a falha LANCADA (prazo do comPrazo)
          // tambem marca ESTE componente: sem a flag ele era contado duas
          // vezes (erro + sem_sku) e o diagnostico ficava mentiroso.
          motivos.erro++;
          falhouComponente = true;
        }
      }
    }
    const q = Number(c && (c.quantidade || c.qtd)) || 1;
    if (sku) out.push({ sku, quantidade: q, nome, imagem: imagem || null });
    else {
        naoResolvidos++;
        // b196/v4.80 (review do Codex) - a classificacao e DESTE componente:
        // antes eu olhava contadores agregados, entao o erro de um componente
        // anterior impedia o proximo de ser contado como "sem codigo".
        if (!falhouComponente) motivos.sem_sku++;
      }
  }
  motivos.truncados = truncados;
  const faltando = naoResolvidos + truncados;
  if (faltando) console.log('[KIT] composicao incompleta: ' + faltando + ' peca(s) fora — ' + JSON.stringify(motivos));
  return { itens: out, faltando, motivos };
}

// v4.67 (review do Codex) - CADENCIA COMPARTILHADA pelo processo. A pausa
// fixa dentro de cada laco so espacava as chamadas DAQUELE laco: duas
// buscas simultaneas (ou a busca + o enriquecimento por EAN) somavam o
// dobro do ritmo na API do Bling. Agora o intervalo e global, como na AMB.
const DETALHE_INTERVALO_MS = 350;
let DETALHE_PROXIMO = 0;
// v4.71 (review do Codex) - a ESPERA NA FILA tambem conta no prazo: com
// concorrencia, a vaga podia sair depois do prazo do kit e cada peca
// gastava a espera inteira antes de desistir. Passando `prazoMs`, a vaga
// nem e reservada quando ja nasceria tarde (e a fila nao anda a toa).
async function esperarVezDetalhe(prazoMs) {
  const agora = Date.now();
  const alvo = Math.max(agora, DETALHE_PROXIMO);
  const espera = alvo - agora;
  if (prazoMs !== undefined && espera > Math.max(0, prazoMs)) return false;
  DETALHE_PROXIMO = alvo + DETALHE_INTERVALO_MS;
  if (espera > 0) await new Promise(r => setTimeout(r, espera));
  return true;
}
// v4.67 (review do Codex) - o prazo tambem vale pra requisicao JA EM VOO:
// o chamarBling nao tem timeout proprio, entao uma consulta travada
// seguraria o POST inteiro muito alem dos 8s prometidos.
async function comPrazo(promessa, ms) {
  let t;
  try {
    return await Promise.race([
      promessa,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error('prazo da consulta esgotado')), Math.max(500, ms)); }),
    ]);
  } finally { clearTimeout(t); }
}

// v4.72 (review do Codex) - o veredito de formato da GOOD nunca expirava:
// um 'E' antigo deixava o produto marcado como kit PARA SEMPRE e, com o
// card do kit nao-clicavel, o item ficava impossivel de escolher mesmo
// depois de virar simples no Bling. TTL igual ao da AMB.
const FORMATO_CACHE = new Map();          // id -> { fmt, ts }
const FORMATO_TTL_MS = 6 * 60 * 60 * 1000;
function formatoCacheGet(id) {
  const reg = id ? FORMATO_CACHE.get(id) : null;
  if (!reg) return undefined;
  if (Date.now() - reg.ts > FORMATO_TTL_MS) { FORMATO_CACHE.delete(id); return undefined; }
  return reg.fmt;
}
function formatoCacheSet(id, fmt) {
  if (id && fmt) FORMATO_CACHE.set(id, { fmt, ts: Date.now() });
}

/**
 * Tira da lista o que o estoquista nao pode lancar: KIT e COMPOSICAO.
 * Variacao passa. So consulta o detalhe de quem ainda nao esta no cache,
 * e no maximo dos primeiros 12 - o resto passa (melhor mostrar um kit
 * raro do que fazer 30 chamadas e a busca demorar).
 */
async function tirarKits(lista, diag) {
  const saida = [];
  let consultados = 0;
  for (const item of lista) {
    const id = item.id;
    if (!id) { saida.push(item); continue; }

    // v4.55 - a LISTAGEM as vezes ja denuncia o kit; se denunciar, nem
    // precisa consultar o detalhe
    let fmt = formatoCacheGet(id);
    if (fmt === undefined) {
      const fmtLista = String(item.formato || '').toUpperCase();
      const compLista = (item.estrutura && Array.isArray(item.estrutura.componentes))
        ? item.estrutura.componentes.length : 0;
      if (fmtLista === 'E' || compLista > 0) { fmt = 'E'; formatoCacheSet(id, 'E'); }
    }

    let det = null;
    if (fmt === undefined && consultados < 12) {
      consultados++;
      // ═══════════════════════════════════════════════════════════════
      // v4.55 - O CALCULO FICA SOZINHO NO SEU PROPRIO try.
      // Na versao anterior o codigo da FOTO morava dentro deste mesmo
      // bloco, e o catch fazia `fmt = 'S'`. Bastava qualquer erro depois
      // do calculo pra o 'E' ja apurado virar 'S' - e o kit voltava pra
      // lista. Agora nada que venha depois consegue mexer no veredito.
      // ═══════════════════════════════════════════════════════════════
      try {
        await esperarVezDetalhe();                      // v4.67 - ritmo global
        const rD = await chamarBling(`https://api.bling.com.br/Api/v3/produtos/${id}`);
        det = (rD.ok && rD.data && rD.data.data) || null;
        if (det) {
          const comp = (det.estrutura && Array.isArray(det.estrutura.componentes))
            ? det.estrutura.componentes.length : 0;
          fmt = comp > 0 ? 'E' : String(det.formato || 'S').toUpperCase();
          formatoCacheSet(id, fmt);      // so cacheia o que foi APURADO
        }
        if (diag) {
          diag.push({
            sku: item.sku, id,
            bling_ok: !!det,
            formato: det ? (det.formato || null) : null,
            componentes: det && det.estrutura && Array.isArray(det.estrutura.componentes)
              ? det.estrutura.componentes.length : null,
            veredito: fmt || 'indefinido',
          });
        }
      } catch (e) {
        if (diag) diag.push({ sku: item.sku, id, erro: String(e.message || e) });
      }
    }

    // a foto vem do mesmo detalhe, mas em bloco separado: se falhar aqui,
    // o veredito de kit continua de pe
    try {
      if (det && !item.imagem) {
        const img = imagemDoProduto(det);
        if (img) {
          item.imagem = img;
          if (item.sku) IMG_POR_SKU.set(String(item.sku).toUpperCase(), img);
        }
      }
    } catch (e) { /* sem foto nao muda o veredito */ }

    // v4.62 - o kit apurado no detalhe tambem fica NA LISTA, marcado
    // (antes era descartado; agora a explosao da gravacao precisa dele)
    // v4.71 (review do Codex) - veredito SIMPLES limpa marca de kit antiga:
    // o item pode chegar marcado (metadado da listagem, cache de outra
    // rodada) e sem isso seguiria com o rotulo 📦 e o card travado.
    if (fmt && fmt !== 'E' && item.ehKit) {
      item.ehKit = false;
      item.componentes = undefined;
      item.componentes_faltando = undefined;
      item.nome = String(item.nome || '').replace('📦 KIT · ', '');
    }
    if (fmt === 'E') {
      item.ehKit = true;
      if (String(item.nome || '').indexOf('📦 KIT · ') !== 0) item.nome = '📦 KIT · ' + (item.nome || '');
      // v4.66 - guarda a estrutura crua deste detalhe (se veio), pra a
      // composicao ser resolvida sem pedir o produto de novo
      if (det) item._compsCru = extrairComponentes(det);
    }
    saida.push(item);
  }
  // v4.66 (pedido do Diego, portado da AMB) - os kits que vao pra tela
  // levam a COMPOSICAO junto: o estoquista escolhe a peca no proprio card,
  // sem popup e sem precisar preencher e salvar antes.
  let kitsResolvidos = 0;
  // v4.69 - teto de tempo do laco INTEIRO, alem do prazo de cada kit: no
  // pior caso a busca nao fica presa somando os prazos dos 3 kits.
  const prazoLaco = Date.now() + COMPONENTES_PRAZO_MS * 2;
  for (const item of saida) {
    if (!item.ehKit || !item.id) continue;
    if (kitsResolvidos >= 3) break;      // kit e excecao numa busca de estoquista
    if (Date.now() >= prazoLaco) break;  // v4.69 - tempo do laco esgotado
    const doCache = compsCacheGet(item.id);
    if (doCache) {
      item.componentes = doCache.itens;
      item.componentes_faltando = doCache.faltando;
      kitsResolvidos++;
      continue;
    }
    // v4.69 - UM prazo unico para este kit: estrutura + resolucao das pecas
    const prazoKit = Math.min(Date.now() + COMPONENTES_PRAZO_MS, prazoLaco);
    let estruturaFalhou = false;   // v4.80
    let cru = item._compsCru;
    if (!cru || !cru.length) {
      try {
        // v4.72 - a vaga na fila NEM E RESERVADA se nascer depois do prazo
        if (!(await esperarVezDetalhe(prazoKit - Date.now()))) throw new Error('fila alem do prazo do kit');
        // v4.70 (review do Codex) - a ESPERA NA FILA conta no prazo: com
        // buscas concorrentes, o agendador podia segurar mais que o prazo
        // do kit e o `Math.max(500, ...)` do comPrazo ressuscitava meio
        // segundo extra. Passado o prazo, a consulta nem comeca.
        const restanteKit = prazoKit - Date.now();
        if (restanteKit <= 0) throw new Error('prazo do kit esgotado na fila');
        // v4.68 - o prazo vale TAMBEM pra esta consulta: ela e pre-requisito
        // da composicao e travava a busca inteira.
        // v4.71 - timeout REAL no axios (o race so ignorava a resposta)
        const rK = await comPrazo(
          chamarBling(`https://api.bling.com.br/Api/v3/produtos/${item.id}`, { timeout: restanteKit, semRetentativa: true }),
          restanteKit);
        // v4.81 (review do Codex) - resposta {ok:false} (429, rede, timeout)
        // NAO lanca: sem isto o log dizia "Bling devolveu sem componentes"
        // quando na verdade a CONSULTA falhou — diagnostico errado.
        if (!rK || !rK.ok) estruturaFalhou = true;
        const dK = (rK && rK.ok && rK.data && rK.data.data) || null;
        cru = extrairComponentes(dK);
      } catch (e) { cru = null; estruturaFalhou = true; }   // v4.80
    }
    if (!cru || !cru.length) {
      // v4.80 (review do Codex) - a falha ao buscar a ESTRUTURA do kit
      // ficava MUDA: sem componentes, sem motivo, sem log — justamente uma
      // das causas plausiveis do kit que apareceu sem peca. Agora ela se
      // declara igual as outras, e a tela mostra o aviso.
      item.componentes = [];
      item.componentes_faltando = 1;
      item.componentes_motivo = { estrutura_falhou: estruturaFalhou ? 1 : 0, estrutura_vazia: estruturaFalhou ? 0 : 1 };
      console.log('[KIT] nao consegui a estrutura do kit ' + item.id + ' — '
        + (estruturaFalhou ? 'consulta falhou/prazo' : 'Bling devolveu sem componentes'));
      kitsResolvidos++;
      continue;
    }
    if (cru && cru.length) {
      const rC = await resolverComponentesKit(cru, prazoKit);
      item.componentes = rC.itens;
      item.componentes_faltando = rC.faltando;
      item.componentes_motivo = rC.motivos;   // v4.79 - diagnostico na resposta
      // v4.67 (review do Codex) - SO A COMPOSICAO COMPLETA vira cache de 6h.
      // Guardar a parcial fazia a proxima busca cair no cache e nunca mais
      // tentar as pecas que faltaram — o "tente de novo em instantes" da
      // tela viraria mentira por 6 horas.
      if (rC.faltando === 0) COMPS_POR_KIT.set(item.id, { itens: rC.itens, faltando: 0, ts: Date.now() });
    }
    kitsResolvidos++;
  }
  for (const item of saida) delete item._compsCru;
  return saida;
}

app.get('/api/produtos/buscar', requerEstoquista, async (req, res) => {
  // v4.55 - ?debugkit=1 mostra o que o Bling respondeu sobre cada produto
  // (formato, quantos componentes, veredito). Serve pra descobrir POR QUE
  // um kit passou, em vez de ficar no chute.
  const _diagKit = req.query.debugkit ? [] : null;
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ ok: true, produtos: [] });
  const alvo = normProd(q);
  const out = [];
  const vistos = new Set();
  const push = (p) => {
    const sku = String(p.sku || p.codigo || '').trim();
    if (!sku || vistos.has(sku)) return;
    // v4.53 - SEM KIT E SEM COMPOSICAO. Variacao PODE.
    // Regra do Diego: no estoque e na nota fiscal quem figura e sempre o
    // produto simples. Um kit (ex: LPR40x2 = 2x LPR40) nao existe como
    // peca na prateleira - se o estoquista lancar defeito nele, a baixa
    // sai errada. Ja variacao (cor/tamanho) e produto de verdade e vale.
    // ATENCAO: a LISTAGEM do Bling nem sempre traz o campo `formato` -
    // por isso o kit LPR40x2 passava batido. Quando o campo nao vem, o
    // produto e conferido no DETALHE (com cache) mais abaixo.
    if (String(p.tipo || 'P').toUpperCase() === 'S') return;      // servico
    const fmt = String(p.formato || '').toUpperCase();
    // v4.62 - o KIT agora APARECE marcado (a gravacao oferece a explosao
    // em N unidades do produto simples); esconder deixava a explosao sem
    // caminho. Pai de variacao e servico seguem fora.
    const ehKitLista = fmt === 'E'
      || !!(p.estrutura && Array.isArray(p.estrutura.componentes) && p.estrutura.componentes.length);
    vistos.add(sku);
    out.push({ sku, ehKit: ehKitLista, nome: (ehKitLista ? '📦 KIT · ' : '') + (p.nome || p.descricao || ''), ean: p.ean || p.gtin || '', id: p.id || null, imagem: p.imagem || IMG_POR_SKU.get(sku.toUpperCase()) || imagemDoProduto(p) || null });
  };
  try {
    // v4.01 - EAN: a LISTAGEM do Bling nao devolve o gtin (so o detalhe de cada
    // produto traz), entao o indice local nunca acha por EAN. Quando o termo
    // parece um codigo de barras, perguntamos direto ao Bling pelos filtros
    // dedicados - e se um deles responder, ja resolve.
    const pareceEan = /^\d{8,14}$/.test(q);
    if (pareceEan) {
      for (const filtro of ['gtin', 'codigo']) {
        const rE = await chamarBling(`https://api.bling.com.br/Api/v3/produtos?${filtro}=${encodeURIComponent(q)}&limite=10`);
        if (rE.ok) {
          for (const p of (rE.data?.data || [])) {
            // so aceita se o produto realmente casar com o termo (o Bling as
            // vezes ignora o filtro e devolve a listagem padrao)
            if (normProd(p.gtin).includes(alvo) || normProd(p.codigo).includes(alvo)) push(p);
          }
        }
        if (out.length > 0) break;
        await new Promise(r2 => setTimeout(r2, 200));
      }
      // ultimo recurso: confere o detalhe dos candidatos por codigo
      if (out.length === 0) {
        const rC = await chamarBling(`https://api.bling.com.br/Api/v3/produtos?codigo=${encodeURIComponent(q)}&limite=5`);
        for (const p of ((rC.ok && rC.data?.data) || [])) {
          if (!p.id) continue;
          const rD = await chamarBling(`https://api.bling.com.br/Api/v3/produtos/${p.id}`);
          const det = rD.ok ? (rD.data?.data || {}) : {};
          if (normProd(det.gtin).includes(alvo) || normProd(det.gtinEmbalagem).includes(alvo)) push({ ...p, gtin: det.gtin });
        }
      }
      if (out.length > 0) {
        return res.json({ ok: true, produtos: (await tirarKits(out, _diagKit)).slice(0, 30), diag_kit: _diagKit || undefined, via: 'ean_bling' });
      }

      // v4.02 - o filtro de EAN do Bling nao e confiavel (documentado no
      // projeto Localizacao x Estoque). A fonte boa e o indice enriquecido
      // com o detalhe de cada produto.
      // v4.04 - NAO espera o indice construir (isso derrubava a requisicao)
      if (!IDX_PROD.ts && !IDX_PROD.construindo) { construirIndiceProdutos().catch(() => {}); }
      for (const p of IDX_PROD.itens) {
        if ((p.eans || []).includes(q) || normProd(p.ean) === alvo) push(p);
        if (out.length >= 10) break;
      }
      if (out.length > 0) {
        return res.json({ ok: true, produtos: (await tirarKits(out, _diagKit)).slice(0, 30), diag_kit: _diagKit || undefined, via: 'ean_indice' });
      }
      // ainda montando o catalogo? avisa em vez de dizer que nao existe
      if (IDX_PROD.construindo || !IDX_PROD.ts) {
        return res.json({ ok: true, produtos: [], indexando: true, dica: 'Estou montando o catálogo agora. Tenta de novo em 1 minuto, ou busca pelo SKU/nome.' });
      }
      // ainda indexando? avisa em vez de dizer que nao existe
      if (!EAN_PROGRESSO.concluido && EAN_PROGRESSO.total > 0) {
        const pct = Math.round((EAN_PROGRESSO.feitos / EAN_PROGRESSO.total) * 100);
        return res.json({
          ok: true,
          produtos: [],
          indexando: true,
          dica: `Ainda estou lendo os códigos de barras do catálogo (${pct}% — ${EAN_PROGRESSO.feitos} de ${EAN_PROGRESSO.total}). Tenta daqui a pouco, ou busca pelo SKU/nome que já funciona.`,
        });
      }
      enriquecerEansEmBackground();
    }

    // 1) match exato pelo codigo - o caminho mais rapido (bipou ou digitou o SKU)
    const rSku = await chamarBling(`https://api.bling.com.br/Api/v3/produtos?codigo=${encodeURIComponent(q)}&limite=20`);
    if (rSku.ok) {
      for (const p of (rSku.data?.data || [])) {
        if (normProd(p.codigo).includes(alvo) || normProd(p.nome).includes(alvo)) push(p);
      }
    }
    // 2) indice local: TODAS as palavras do termo tem que aparecer (em
    // qualquer ordem/posicao). Assim "arandela 60" acha "Luminaria Arandela
    // 60cm Parede", e "930b" acha "930bPRETO-1xLed-1xGarra".
    // v4.04 - NAO espera o indice construir (isso derrubava a requisicao)
    if (!IDX_PROD.ts && !IDX_PROD.construindo) { construirIndiceProdutos().catch(() => {}); }
    const palavras = alvo.split(/\s+/).filter(Boolean);
    for (const p of IDX_PROD.itens) {
      if (out.length >= 30) break;
      if (palavras.every(w => p.busca.includes(w))) push(p);
    }
    return res.json({
      ok: true,
      produtos: (await tirarKits(out, _diagKit)).slice(0, 30),
      diag_kit: _diagKit || undefined,
      dica: (out.length === 0 && /^\d{8,14}$/.test(q))
        ? 'O Bling nao devolveu esse EAN na busca. Tenta pelo SKU ou por parte do nome do produto.'
        : null,
      indice: { total: IDX_PROD.itens.length, idade_min: IDX_PROD.ts ? Math.round((Date.now() - IDX_PROD.ts) / 60000) : null, erro: IDX_PROD.erro },
    });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

// v4.13 - limpa o HTML das mensagens do ML e resume o caso em portugues.
function limparHtmlML(t) {
  return String(t || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cache do contexto da reclamacao (o caso nao muda depois de fechado)
const CLAIM_CTX = new Map();
async function contextoDaReclamacao(claimId) {
  const k = String(claimId || '');
  if (!k) return null;
  if (CLAIM_CTX.has(k)) return CLAIM_CTX.get(k);
  const ctx = { claim_id: k, motivo: null, pontos: [], pacote_consolidado: false, sem_custo_pra_voce: false, resolucao: null };
  try {
    const rc = await chamarML(`https://api.mercadolibre.com/post-purchase/v1/claims/${k}`);
    if (rc.ok && rc.data) {
      ctx.resolucao = rc.data.resolution?.reason || null;
      ctx.reason_id = rc.data.reason_id || null;
      ctx.status_claim = rc.data.status || null;
    }
    const rm = await chamarML(`https://api.mercadolibre.com/post-purchase/v1/claims/${k}/messages`);
    const msgs = (rm.ok && Array.isArray(rm.data)) ? rm.data : [];
    const textoTudo = msgs.map(m => String(m.message || '')).join(' ');
    // os <li> da mensagem do mediador sao o resumo do caso
    const lis = [...textoTudo.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map(m => limparHtmlML(m[1])).filter(Boolean);
    ctx.pontos = lis.slice(0, 4);
    ctx.pacote_consolidado = /consolidad|um .{0,3}nico pacote|mesmo pacote/i.test(textoTudo);
    ctx.sem_custo_pra_voce = /n.{0,3}o precisa pagar nada|cobre todos os custos/i.test(textoTudo);
    // motivo em linguagem do galpao
    const t = limparHtmlML(textoTudo).toLowerCase();
    if (/arrepend|desist|n.{0,3}o quer mais/.test(t)) ctx.motivo = 'arrependimento';
    else if (/defeito|avaria|quebrad|trincad|n.{0,3}o funciona|n.{0,3}o liga|n.{0,3}o acende/.test(t)) ctx.motivo = 'defeito';
    else if (/diferente|errado|n.{0,3}o .{0,3}o que/.test(t)) ctx.motivo = 'item_errado';
    else if (/incomplet|falta/.test(t)) ctx.motivo = 'incompleto';
    if (!ctx.motivo && ctx.resolucao === 'item_returned') ctx.motivo = 'devolvido';
  } catch (e) { /* melhor sem contexto do que quebrar o bipe */ }
  CLAIM_CTX.set(k, ctx);
  return ctx;
}

// v4.12/4.13 - MOTIVO DA DEVOLUCAO com dados confirmados no ML.
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

// v4.15 - DIAGNOSTICO DO ALERTA: por que a contagem de dias ainda erra.
// Mostra, item a item, de onde saiu a data usada - e testa o /history do
// shipment de devolucao pra ver se ele responde a data certa.
// b302 - /api/debug/alerta-datas foi pra lib/rotas-debug.js (fatia 4)

// v4.22 - MANDAR PRA FILA DE NF direto do alerta. Cria o registro como se
// tivesse sido triado, com TODOS os itens da venda - e ele cai na fila
// "Aprovadas - aguardando NF", onde o Diego ja escolhe o deposito e emite.
// Regra dele: venda sem NF nao passa - se nao achou, e problema do app.
app.post('/api/admin/espreita/lancar-nf', requerAdmin, async (req, res) => {
  const pedidos = Array.isArray(req.body?.pedidos) ? req.body.pedidos : [];
  if (pedidos.length === 0) return res.status(400).json({ ok: false, erro: 'nenhum pedido selecionado' });
  const criados = [], semNf = [], jaExistiam = [], falhas = [];

  for (const orderId of pedidos.slice(0, 40)) {
    try {
      const oid = String(orderId).trim();
      // ja foi triado antes?
      const { data: existe } = await supabase.from('devolucoes').select('id').eq('order_id', oid).limit(1);
      if (existe && existe.length) { jaExistiam.push(oid); continue; }

      const rO = await chamarML(`https://api.mercadolibre.com/orders/${oid}`);
      if (!rO.ok || !rO.data) { falhas.push({ pedido: oid, erro: 'nao achei a venda no ML' }); continue; }
      const od = rO.data;

      // NF da venda - obrigatoria
      let nf = null;
      const shipIda = od.shipping?.id;
      if (shipIda) {
        const rN = await buscarNFnoML(shipIda);
        if (rN.ok && rN.data?.fiscal_key) {
          const ch = String(rN.data.fiscal_key);
          nf = { chave: ch, numero: ch.slice(25, 34).replace(/^0+/, ''), serie: ch.slice(22, 25).replace(/^0+/, '') || '1' };
        }
      }
      if (!nf) { semNf.push(oid); continue; }

      // v4.24 - BUSCA O ID DA NF NO BLING. Sem ele o gerador de devolucao
      // trabalha as cegas e a nota sai SEM VINCULO com a venda original (foi
      // o que aconteceu: as devolucoes saíram "Nao vinculado" no Bling).
      try {
        const rB = await buscarNFnoBlingPorNumero(nf.numero, nf.serie || '1');
        const nfB = (rB && rB.ok && (rB.nf || rB.data)) || null;
        if (nfB && nfB.id) {
          nf.id_bling = String(nfB.id);
          nf.link_danfe = nfB.linkDanfe || nfB.link_danfe || null;
          nf.valor = nfB.valorNota || nfB.valor || null;
          nf.data_emissao = nfB.dataEmissao || nfB.data_emissao || null;
        }
      } catch (e) { /* segue sem o id; o gerador ainda tenta pela chave */ }

      const b = od.buyer || {};
      const itens = od.order_items || [];
      const qtdTotal = itens.reduce((a, x) => a + (x.quantity || 0), 0);
      const primeiro = itens[0] || {};
      const resumoItens = itens.map(x => `${x.quantity || 1}x ${x.item?.seller_sku || x.item?.seller_custom_field || '?'} - ${x.item?.title || ''}`).join(' | ');

      const { data: novo, error } = await supabase.from('devolucoes').insert([{
        shipment_id: String(shipIda || oid),
        order_id: oid,
        pack_id: od.pack_id ? String(od.pack_id) : null,
        buyer_id: b.id ? String(b.id) : null,
        buyer_nome: [b.first_name, b.last_name].filter(Boolean).join(' ') || b.nickname || null,
        buyer_nickname: b.nickname || null,
        produto_titulo: primeiro.item?.title || null,
        produto_mlb: primeiro.item?.id || null,
        produto_sku: primeiro.item?.seller_sku || primeiro.item?.seller_custom_field || null,
        produto_qtd: qtdTotal || 1,
        produto_valor_unit: primeiro.unit_price || null,
        nf_numero: nf.numero,
        nf_serie: nf.serie,
        nf_chave: nf.chave,
        nf_id_bling: nf.id_bling || null,     // v4.24: sem isso a devolucao sai sem vinculo
        nf_link_danfe: nf.link_danfe || null,
        nf_valor: nf.valor || null,
        nf_data_emissao: nf.data_emissao || null,
        tipo: 'aprovado',
        status: 'pendente',
        funcionario: req.usuario || 'admin',
        problema_descricao: `[LANCADO DO PAINEL A ESPREITA por ${req.usuario || 'admin'}] itens da venda: ${resumoItens}`,
      }]).select().single();

      if (error) { falhas.push({ pedido: oid, erro: error.message }); continue; }
      criados.push({ pedido: oid, id: novo.id, nf: nf.numero, id_bling: nf.id_bling || null, itens: itens.length, qtd: qtdTotal });
      await new Promise(r => setTimeout(r, 250));
    } catch (e) { falhas.push({ pedido: String(orderId), erro: e.message }); }
  }

  return res.json({
    ok: true,
    criados: criados.length, detalhe_criados: criados,
    sem_nf: semNf, ja_existiam: jaExistiam, falhas,
    aviso: semNf.length ? 'Estas vendas nao tem NF identificada no app - confira no Bling antes de emitir' : null,
  });
});

// v4.24 - REPARO dos cards que ja foram criados sem o id da NF no Bling.
// Sao os 14 que ficaram na fila: sem esse id o gerador emitiu a devolucao
// sem vinculo com a nota de venda.
app.post('/api/admin/reparar-nf-bling', requerAdmin, async (req, res) => {
  try {
    const { data: cards } = await supabase
      .from('devolucoes')
      .select('id, nf_numero, nf_serie, nf_chave, nf_id_bling, produto_titulo')
      .is('nf_id_bling', null)
      .not('nf_numero', 'is', null)
      .neq('status', 'concluido')
      .limit(Number(req.query.n || 10));
    const corrigidos = [], naoAchados = [];
    for (const c of (cards || [])) {
      try {
        const rB = await buscarNFnoBlingPorNumero(c.nf_numero, c.nf_serie || '1');
        const nfB = (rB && rB.ok && (rB.nf || rB.data)) || null;
        if (nfB && nfB.id) {
          await supabase.from('devolucoes').update({
            nf_id_bling: String(nfB.id),
            nf_link_danfe: nfB.linkDanfe || nfB.link_danfe || null,
          }).eq('id', c.id);
          corrigidos.push({ card: c.id, nf: c.nf_numero, id_bling: String(nfB.id) });
        } else {
          naoAchados.push({ card: c.id, nf: c.nf_numero });
        }
      } catch (e) { naoAchados.push({ card: c.id, nf: c.nf_numero, erro: e.message }); }
      await new Promise(r => setTimeout(r, 350));
    }
    return res.json({
      ok: true,
      analisados: (cards || []).length,
      corrigidos: corrigidos.length, detalhe: corrigidos,
      nao_achados: naoAchados,
      dica: (cards || []).length >= Number(req.query.n || 10) ? 'ainda pode haver mais - rode de novo' : 'todos os pendentes foram analisados',
    });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

// v4.26 - DIAGNOSTICO SHOPEE: 39 devolucoes aparecem "em transito ha 80-118
// dias", mas pelo menos uma (260323UXCCNA3X) foi devolvida em 11/04. O status
// ACCEPTED que eu uso nao e o final. Esta rota mostra o objeto CRU que a
// Shopee devolve, pra achar o campo que diz que acabou - e o id interno da
// solicitacao, pro link da reclamacao que o Diego pediu.
// b302 - /api/debug/shopee-return foi pra lib/rotas-debug.js (fatia 4)

// v4.28 - SONDAGEM: como o Bling lista as NFs de DEVOLUCAO (entrada)?
// Objetivo: cruzar o "a espreita" com as notas de devolucao ja emitidas -
// se a NF de devolucao existe no Bling, o produto ja chegou, mesmo que o
// marketplace ainda nao tenha atualizado. Testa os filtros reais antes de
// construir, pra nao chutar.
// v4.50 - INDICE de pedidos que ja tem NF de devolucao emitida. O detalhe de
// cada nota de entrada traz numeroPedidoLoja (= o pedido do marketplace, ex
// 2000017611449926). Cruzando com o a espreita, sabemos quais devolucoes ja
// foram resolvidas - inclusive as antigas, de antes do app de triagem.
const NF_DEV_INDICE = new Map();     // pedido -> { nf, data, contato, sku }

// v4.51 - CACHE do resultado final do a espreita (o painel montado, pronto).
// Montar o a espreita e caro (junta 3 marketplaces, enriquece cliente/NF).
// Guardamos a ultima resposta boa e servimos ela instantaneo enquanto uma nova
// e montada em background. Assim o painel abre rapido mesmo com muitos itens.
let ESP_CACHE = null;            // ultima resposta boa (objeto json)
let ESP_CACHE_TS = 0;           // quando foi montada
let ESP_MONTANDO = null;        // promessa em voo (evita montar 2x ao mesmo tempo)
// v4.51.1 - so aceita cachear um resultado se as 3 fontes principais estao
// quentes. Sem isso, um pre-aquecimento que rodou antes da Magalu esquentar
// cacheava a Magalu VAZIA e servia por 3 min (bug: os Magalu sumiam).
function contarPorMarketplace(r) {
  const c = { magalu: 0, ml: 0, shopee: 0 };
  const arr = (r && r.em_transito) || [];
  for (const d of arr) { if (c[d.marketplace] != null) c[d.marketplace]++; }
  return c;
}
function guardarCacheEspreita(r) {
  if (!r || !r.ok) return false;
  // primeira vez: aceita
  if (!ESP_CACHE) { ESP_CACHE = r; ESP_CACHE_TS = Date.now(); return true; }
  // se o cache ja esta velho, qualquer resultado novo e melhor - aceita
  if ((Date.now() - ESP_CACHE_TS) > ESP_CACHE_TTL) { ESP_CACHE = r; ESP_CACHE_TS = Date.now(); return true; }
  // cache recente: protege contra a fonte DESABAR a zero (o bug dos Magalu
  // sumindo). So bloqueia quedas bruscas: o cache tinha varios (>=2) e o novo
  // veio ZERO - sinal de fonte que ainda nao aqueceu. Variacao de 1 e normal.
  const novo = contarPorMarketplace(r);
  const velho = contarPorMarketplace(ESP_CACHE);
  const desabou = (velho.magalu >= 2 && novo.magalu === 0) ||
                  (velho.ml >= 2 && novo.ml === 0) ||
                  (velho.shopee >= 2 && novo.shopee === 0);
  if (desabou) return false;   // mantem o cache anterior (a fonte deve estar fria)
  ESP_CACHE = r; ESP_CACHE_TS = Date.now();
  return true;
}
const ESP_CACHE_TTL = 3 * 60 * 1000;   // 3 min: abaixo disso, serve o cache na hora
let NF_DEV_INDICE_TS = 0;
let NF_DEV_CARREGANDO = null;
const NF_DEV_TTL = 15 * 60 * 1000;
// b339 - estados novos do indice (ver comentario do montarIndiceNFDevolucao)
let NF_DEV_SEM_PEDIDO = [];      // notas de devolucao SEM numero de pedido
let NF_DEV_IGNORADAS = {};       // natureza -> quantas ficaram de fora
let NF_DEV_CACHE_OK = false;     // o build terminou (vazio de verdade tambem vale)

/** b339 - INDICE DAS NOTAS DE DEVOLUCAO (GOOD). Fatia 2a de 2 (backend).
 *
 *  Ate a b338 este indice lia `tipo=1` CRAVADO. A sonda da b338 mediu nesta
 *  conta e o resultado foi o mesmo da AMB: **tipo=1 e "Venda de mercadorias -
 *  Saida"** (200 de 200 notas) e **tipo=0 sao as ENTRADAS** — "Devolucao de
 *  Mercadoria - Entrada" (173), "Compra de Mercadorias - Entrada" (22, Amazon)
 *  e "Devolucao de mercadorias" (5). Ou seja: o indice vinha comparando NOTA DE
 *  VENDA com pedido de devolucao e nunca casou nada — o aviso "ja tem NF" nunca
 *  funcionou na GOOD, e 178 notas de devolucao ficavam invisiveis.
 *
 *  Duas envs (as duas com padrao medido, entao o comportamento nao depende de
 *  configurar nada):
 *   - GOOD_NF_ENTRADA_TIPO         (padrao '0')
 *   - GOOD_NATUREZAS_DEVOLUCAO_IDS (padrao '5776118802,15110882187')
 *  Tipo=0 traz TAMBEM compra de fornecedor: sem o filtro de natureza, uma
 *  entrada da Amazon com numero de pedido diria "ja tem NF de devolucao" pra
 *  uma venda que ainda precisa da nota. O que fica de fora e contado em
 *  `naturezas_ignoradas`, que a rota expoe — e por ali que se descobre uma
 *  natureza legitima faltando na env.
 */
async function montarIndiceNFDevolucao(maxPaginas) {
  // b339 - o guard usava NF_DEV_INDICE.size: se as notas recentes fossem todas
  // sem pedido, o mapa ficava vazio e CADA request remontava tudo, ignorando o
  // TTL. A flag diz "o build terminou", independente do formato do resultado.
  if ((Date.now() - NF_DEV_INDICE_TS) < NF_DEV_TTL && NF_DEV_CACHE_OK) return;
  if (NF_DEV_CARREGANDO) return NF_DEV_CARREGANDO;
  NF_DEV_CARREGANDO = (async () => {
    const novo = new Map();
    const semPedido = [];
    const ignoradas = {};
    try {
      // b339 r2 (Codex #82): fracao <1 ou negativo sobrevivia ao `|| 5` (sao
      // truthy), o laco nao rodava nenhuma vez e o resultado VAZIO substituia o
      // indice bom — com a flag nova, cacheado por 15 min: o painel passaria a
      // dizer que nenhuma devolucao tem nota.
      const pedidas = Math.floor(Number(maxPaginas));
      const paginas = Math.min(Number.isFinite(pedidas) && pedidas >= 1 ? pedidas : 5, 15);
      const tipoEntrada = String(process.env.GOOD_NF_ENTRADA_TIPO || '0');
      const idsDevolucao = String(process.env.GOOD_NATUREZAS_DEVOLUCAO_IDS || '5776118802,15110882187')
        .split(',').map((x) => x.trim()).filter(Boolean);
      const DESCARTAVEL = new Set([2, 9]);   // cancelada e denegada nao valem como "ja tem nota"
      let falhaLista = false, falhasDetalhe = 0;

      // 1) lista as notas de entrada (so id + numero, rapido)
      const ids = [];
      for (let p = 1; p <= paginas; p++) {
        const r = await chamarBling(`https://api.bling.com.br/Api/v3/nfe?tipo=${tipoEntrada}&pagina=${p}&limite=100`);
        // chamarBling devolve {ok:false} em vez de lancar: sem esta checagem uma
        // queda do Bling virava "lista vazia" e o build seguia como se tivesse
        // dado certo, apagando o indice bom por 15 minutos.
        if (!r.ok) { falhaLista = true; break; }
        const lista = r.data?.data || [];
        if (!lista.length) break;
        for (const n of lista) {
          if (DESCARTAVEL.has(Number(n.situacao))) continue;
          ids.push({ id: n.id, numero: n.numero, serie: n.serie != null ? n.serie : null,
            dataEmissao: n.dataEmissao, contato: n.contato?.nome || null,
            situacao: n.situacao, natureza: n.naturezaOperacao || null });
        }
        if (lista.length < 100) break;
      }
      // queda logo na listagem: mantem o indice anterior e nao marca cache bom,
      // pra proxima chamada tentar de novo em vez de servir vazio por 15 min.
      if (falhaLista && !ids.length) return;

      // 2) detalha cada nota pra pegar o numeroPedidoLoja (em lotes, com pausa)
      for (const it of ids) {
        try {
          const rD = await chamarBling(`https://api.bling.com.br/Api/v3/nfe/${it.id}`);
          if (!rD.ok) { falhasDetalhe++; await new Promise(r => setTimeout(r, 120)); continue; }
          const d = rD.data?.data || {};
          if (DESCARTAVEL.has(Number(d.situacao != null ? d.situacao : it.situacao))) {
            await new Promise(r => setTimeout(r, 120)); continue;
          }
          // b339 r2 (Codex #82): o Bling as vezes manda naturezaOperacao como
          // TEXTO em vez de objeto — a rota /api/admin/nfs-devolucao logo abaixo
          // ja trata esse formato. Sem normalizar, id e descricao vinham
          // undefined e ate "Devolucao de Mercadoria - Entrada" era ignorada.
          const natBruta = d.naturezaOperacao || it.natureza || null;
          const nat = (typeof natBruta === 'string')
            ? { id: null, descricao: natBruta }
            : natBruta;
          const natId = String((nat && nat.id) || '');
          const ehDevolucao = (natId && idsDevolucao.indexOf(natId) >= 0)
            || /devolu/i.test(String((nat && nat.descricao) || ''));
          const pedido = String(d.numeroPedidoLoja || '').replace(/\s/g, '');
          if (!ehDevolucao) {
            ignoradas[natId || 'sem_natureza'] = (ignoradas[natId || 'sem_natureza'] || 0) + 1;
          } else {
            const base = {
              nf: it.numero, id: String(it.id),
              serie: it.serie != null ? it.serie : (d.serie != null ? d.serie : null),
              data: (it.dataEmissao || '').slice(0, 10),
              contato: it.contato,
              sku: (Array.isArray(d.itens) && d.itens[0]) ? d.itens[0].codigo : null,
              skus: (Array.isArray(d.itens) ? d.itens : []).map(i => String((i && i.codigo) || '').trim()).filter(Boolean),
              chave: d.chaveAcesso || null,
              natureza: nat ? { id: nat.id != null ? nat.id : null, descricao: nat.descricao || null } : null,
            };
            // forma antiga preservada (nf, data, contato, sku, chave) + campos novos
            if (pedido) novo.set(pedido, base);
            else semPedido.push(base);   // fica pronto pro casamento da fatia 2b
          }
        } catch (e) { falhasDetalhe++; }
        await new Promise(r => setTimeout(r, 120));
      }
      NF_DEV_INDICE.clear();
      for (const [k, v] of novo) NF_DEV_INDICE.set(k, v);
      NF_DEV_SEM_PEDIDO = semPedido;
      NF_DEV_IGNORADAS = ignoradas;
      NF_DEV_CACHE_OK = true;
      // build incompleto vale, mas com validade curta: nem serve resultado
      // furado por 15 min, nem remonta centenas de notas a cada request.
      const parcial = falhaLista || falhasDetalhe > 0;
      NF_DEV_INDICE_TS = parcial ? (Date.now() - NF_DEV_TTL + 2 * 60 * 1000) : Date.now();
    } catch (e) { /* mantem o indice anterior */ }
    finally { NF_DEV_CARREGANDO = null; }
  })();
  return NF_DEV_CARREGANDO;
}

// rota: dispara/consulta o indice. O front chama e depois cruza com o a espreita.
app.get('/api/admin/indice-nf-devolucao', requerAdmin, async (req, res) => {
  try {
    await montarIndiceNFDevolucao(Number(req.query.paginas || 5));
    const mapa = {};
    for (const [ped, info] of NF_DEV_INDICE) mapa[ped] = info;
    return res.json({ ok: true, total: NF_DEV_INDICE.size, atualizado_em: NF_DEV_INDICE_TS,
      tipo_usado: String(process.env.GOOD_NF_ENTRADA_TIPO || '0'),   // b339
      pedidos: mapa,
      sem_pedido: NF_DEV_SEM_PEDIDO,                 // b339 - o painel usa na fatia 2b
      naturezas_ignoradas: NF_DEV_IGNORADAS,         // b339 - calibragem da env
      cache_ok: NF_DEV_CACHE_OK,
      idade_ms: Math.max(0, Date.now() - NF_DEV_INDICE_TS) });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

// v4.48 - lista as NFs de DEVOLUCAO (entrada) do Bling pra cruzar com o a
// espreita. Cada nota de entrada referencia a NF de venda original; com isso
// sabemos quais devolucoes ja foram resolvidas (nota emitida) mesmo as antigas.
app.get('/api/admin/nfs-devolucao', requerAdmin, async (req, res) => {
  try {
    const paginas = Math.min(Number(req.query.paginas || 3), 10);
    const todas = [];
    for (let p = 1; p <= paginas; p++) {
      const r = await chamarBling(`https://api.bling.com.br/Api/v3/nfe?tipo=1&pagina=${p}&limite=100`);
      const lista = (r.ok && r.data?.data) || [];
      if (!lista.length) break;
      for (const n of lista) {
        todas.push({
          id: n.id, numero: n.numero, serie: n.serie,
          situacao: n.situacao, dataEmissao: n.dataEmissao,
          natureza: n.naturezaOperacao?.descricao || (typeof n.naturezaOperacao === 'string' ? n.naturezaOperacao : null),
          chave: n.chaveAcesso || null,
          contato: n.contato?.nome || null,
          numeroPedidoLoja: n.numeroLoja || n.numeroPedidoLoja || null,
          valor: n.valorNota || n.valor || null,
        });
      }
      if (lista.length < 100) break;
    }
    // detalhar ATE 3 notas pra ver o padrao (numeroPedidoLoja, chave referenciada, itens)
    let detalheExemplo = null;
    let detalhes3 = [];
    if (todas.length && req.query.detalhe === '1') {
      for (let k = 0; k < Math.min(3, todas.length); k++) {
        const rDx = await chamarBling(`https://api.bling.com.br/Api/v3/nfe/${todas[k].id}`);
        const dx = rDx.ok ? (rDx.data?.data || {}) : {};
        var ch44 = [];
        (function procura(o, path) {
          if (!o || typeof o !== 'object') return;
          for (var kk in o) { var vv = o[kk];
            if (typeof vv === 'string' && /^\d{44}$/.test(vv)) ch44.push({ campo: (path ? path + '.' : '') + kk, chave: vv });
            else if (typeof vv === 'object') procura(vv, (path ? path + '.' : '') + kk); }
        })(dx, '');
        detalhes3.push({
          numero: dx.numero,
          numeroPedidoLoja: dx.numeroPedidoLoja || null,
          contato: dx.contato?.nome || null,
          chaveAcesso_propria: dx.chaveAcesso || null,
          chaves_44_no_detalhe: ch44,
          qtd_itens: Array.isArray(dx.itens) ? dx.itens.length : 0,
          primeiro_item: (Array.isArray(dx.itens) && dx.itens[0]) ? { descricao: dx.itens[0].descricao, codigo: dx.itens[0].codigo } : null,
          observacoes: (dx.observacoes || '').slice(0, 200),
        });
        await new Promise(r => setTimeout(r, 200));
      }
    }
    if (false) {
      const rD = await chamarBling(`https://api.bling.com.br/Api/v3/nfe/${todas[0].id}`);
      const d = rD.ok ? (rD.data?.data || {}) : {};
      // varre atras de QUALQUER chave de NFe (44 digitos) e do pedido no detalhe
      var chaves44 = [];
      var procura = function (o, path) {
        if (!o || typeof o !== 'object') return;
        for (var k in o) {
          var v = o[k];
          if (typeof v === 'string' && /^\d{44}$/.test(v)) chaves44.push({ campo: (path ? path + '.' : '') + k, chave: v });
          else if (typeof v === 'object') procura(v, (path ? path + '.' : '') + k);
        }
      };
      procura(d, '');
      detalheExemplo = {
        id: d.id, numero: d.numero,
        numeroPedidoLoja: d.numeroPedidoLoja || null,
        contato: d.contato?.nome || null,
        chaveAcesso_propria: d.chaveAcesso || null,
        chaves_44_no_detalhe: chaves44,          // pode ter a chave da NF de venda referenciada
        tem_itens: Array.isArray(d.itens) ? d.itens.length : 0,
        primeiro_item: (Array.isArray(d.itens) && d.itens[0]) ? { descricao: d.itens[0].descricao, codigo: d.itens[0].codigo, valor: d.itens[0].valor } : null,
        observacoes: (d.observacoes || '').slice(0, 300),
      };
    }
    return res.json({
      ok: true,
      total: todas.length,
      dica: 'adicione &detalhe=1 pra ver os campos do detalhe de uma nota (achar a referencia ao pedido)',
      notas: todas,
      detalhes3,
      detalhe_exemplo: detalheExemplo,
    });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

// b302 - /api/debug/bling-nf-devolucao foi pra lib/rotas-debug.js (fatia 4)

// v4.10 - DIAGNOSTICO: o que da pra saber sobre o MOTIVO da devolucao antes
// do estoquista abrir o pacote. Testa cada fonte e diz o que veio e o que foi
// negado - sem chutar. Uso: /api/debug/motivo-devolucao?order=2000017466406326
//                       ou /api/debug/motivo-devolucao?claim=5546944136
// b302 - /api/debug/motivo-devolucao foi pra lib/rotas-debug.js (fatia 4)

// v4.01 - diagnostico do EAN: mostra QUAIS campos a listagem do Bling devolve
// e testa os filtros dedicados, pra parar de adivinhar.
// b302 - /api/debug/bling-ean foi pra lib/rotas-debug.js (fatia 4)

// diagnostico do indice de produtos
// b302 - /api/debug/produtos-indice foi pra lib/rotas-debug.js (fatia 4)

// v3.96 - LANCAR DEFEITO manualmente (produto que ja esta no galpao, sem
// passar por devolucao). So aceita SKU que existe no Bling - assim a relacao
// nunca fica com codigo inventado.
app.post('/api/defeitos/adicionar', requerEstoquista, async (req, res) => {
  const sku = String(req.body?.sku || '').trim();
  const defeito = String(req.body?.defeito || '').trim();
  const localizacao = String(req.body?.localizacao || '').trim();
  const qtd = Math.max(1, parseInt(req.body?.qtd, 10) || 1);
  if (!sku || !defeito) return res.status(400).json({ ok: false, erro: 'informe o produto e o defeito' });
  // v4.09 - localizacao OBRIGATORIA: sem ela o item nao entra na consulta de
  // localizacao e a peca some do mapa. Validado tambem aqui porque celular
  // com tela em cache burlaria a checagem do navegador.
  if (!localizacao) return res.status(400).json({ ok: false, erro: 'informe ONDE VAI GUARDAR o produto' });
  try {
    // valida o SKU no Bling (nunca grava codigo que nao existe)
    const rP = await buscarProdutoBlingPorSku(sku);
    const prod = rP.ok ? rP.produto : null;
    if (!prod) return res.status(400).json({ ok: false, erro: `SKU "${sku}" nao encontrado no Bling` });

    // ═══════════════════════════════════════════════════════════════════
    // v4.53 - TRAVA DE KIT NA GRAVACAO.
    // O filtro da busca ja tira os kits da lista, mas isso e conveniencia:
    // se um escapar (o Bling nem sempre manda o `formato` na listagem), o
    // estoquista olha a foto, nao repara, e lanca o kit. Aqui e o ponto
    // que nao depende de ele reparar - e a peca de verdade e sempre o
    // produto SIMPLES, que e o que figura no estoque e na nota.
    // ═══════════════════════════════════════════════════════════════════
    try {
      const rDet = await chamarBling(`https://api.bling.com.br/Api/v3/produtos/${prod.id}`);
      const det = (rDet.ok && rDet.data && rDet.data.data) || null;
      const comps = extrairComponentes(det);   // v4.66 - tolerante ao formato
      const ehKit = comps.length > 0 || String((det && det.formato) || '').toUpperCase() === 'E';
      if (ehKit) {
        // se der, ja diz QUAL produto simples ele deve usar no lugar
        // v4.66 - componentes resolvendo id -> SKU (o Bling manda so o id)
        const resolucao = await resolverComponentesKit(comps);
        const componentesDet = resolucao.itens;
        const sugestoes = componentesDet.map(c => `${c.quantidade}x ${c.sku}`);
        return res.status(400).json({
          ok: false,
          erro: `"${prod.codigo || sku}" e um KIT, nao um produto simples.`
            + (sugestoes.length ? ` Ele e composto por ${sugestoes.join(' + ')}.` : '')
            + ' Lance o defeito no produto simples - e ele que existe na prateleira,'
            + ' no estoque e na nota fiscal.',
          kit: true,
          componentes: sugestoes,
          kit_sku: prod.codigo || sku,
          componentes_det: componentesDet,
          // v4.66 - a tela precisa saber que a composicao veio INCOMPLETA
          composicao_completa: resolucao.faltando === 0,
          componentes_faltando: resolucao.faltando,
        });
      }
    } catch (e) { /* se o Bling nao responder, segue - nao trava o galpao */ }
    // v4.50 - as FOTOS do defeito e o retorno com o numero da peca (a
    // etiqueta imprime "PECA #N" e o card mostra as fotos)
    const fotos = Array.isArray(req.body?.fotos) ? req.body.fotos.filter(Boolean) : [];
    const { data: criado, error } = await supabase.from('devolucoes').insert([{
      // v3.97 - tipo PROPRIO: defeito de estoque NAO entra na fila de
      // "Problemas reportados" (aquela e a fila fiscal do Diego, de produto
      // que voltou de venda e precisa de NF de devolucao). Este aqui nao tem
      // NF de venda nem cliente - e controle interno de estoque.
      tipo: 'defeito_estoque',
      status: 'registrado',
      funcionario: req.usuario,
      produto_sku: String(prod.codigo || sku),
      produto_titulo: prod.nome || null,
      produto_ean: prod.gtin || prod.ean || null,
      problema_descricao: `[LANCADO MANUAL por ${req.usuario}] ${defeito}`,
      localizacao: localizacao || null,
      defeito_qtd: qtd,
      problema_fotos: fotos.length ? fotos : null,
    }]).select().limit(1);
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    const linha = (criado || [])[0] || null;
    return res.json({
      ok: true,
      sku: prod.codigo || sku, nome: prod.nome || null,
      ean: prod.gtin || prod.ean || null, qtd,
      peca_id: linha ? linha.id : null,
      registro: linha,
      gravado: linha ? {
        defeito: linha.problema_descricao || null,
        quantidade: linha.defeito_qtd,
        fotos: Array.isArray(linha.problema_fotos) ? linha.problema_fotos.length : 0,
      } : null,
    });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

// v3.89 - LOCALIZACAO DEFEITOS: consulta do estoque de defeitos (so itens
// que tem localizacao preenchida), agrupavel por SKU ou por local.
app.get('/api/defeitos', requerEstoquista, async (req, res) => { // v3.90: estoquista consulta (so tem acesso a triagem)
  try {
    const { data, error } = await supabase
      .from('devolucoes')
      .select('id, created_at, tipo, produto_titulo, produto_sku, nf_numero, localizacao, defeito_qtd, problema_descricao, status')
      .in('tipo', ['problema', 'defeito_estoque']) // v3.97: devolucao com defeito + defeito lancado do estoque
      .not('localizacao', 'is', null)
      .neq('localizacao', '')
      .order('localizacao', { ascending: true })
      .limit(1000);
    if (error) {
      const m = String(error.message || '');
      if (/localizacao|defeito_qtd/.test(m) && /column|does not exist|schema cache/i.test(m)) {
        return res.status(500).json({ ok: false, erro: 'Colunas localizacao/defeito_qtd ainda nao existem - rode o SQL.' });
      }
      return res.status(500).json({ ok: false, erro: m });
    }
    // v3.98 - REGRA DE NEGOCIO: defeito vindo de DEVOLUCAO so existe de verdade
    // na tabela de defeitos depois que o Diego emite a NF e conclui - e ai que o
    // item foi liquidado e foi pro deposito DEFEITO (e nao pro GERAL, que volta
    // pra venda). Defeito lancado do ESTOQUE entra na hora (nao depende de NF).
    const todos = data || [];
    const aguardandoNF = todos.filter(x => x.tipo === 'problema' && x.status !== 'concluido').length;
    const liberados = todos.filter(x => x.tipo === 'defeito_estoque' || x.status === 'concluido');

    const q = String(req.query.q || '').trim().toUpperCase();
    let itens = liberados.map(d => ({
      id: d.id,
      quando: d.created_at,
      produto: d.produto_titulo || null,
      sku: d.produto_sku || null,
      nf: d.nf_numero || null,
      local: d.localizacao || null,
      qtd: d.defeito_qtd || null,
      defeito: (d.problema_descricao || '').replace(/^\[RE-BIPE\]\s*/, '').replace(/^\[Reportado por [^\]]+\]\s*/, '').replace(/^\[LANCADO MANUAL por [^\]]+\]\s*/, ''),
      origem: d.tipo === 'defeito_estoque' ? 'estoque' : 'devolucao', // v3.97
      status: d.status,
    }));
    if (q) itens = itens.filter(x => [x.sku, x.local, x.produto, x.nf].some(v => String(v || '').toUpperCase().includes(q)));
    // v3.99 - anexa o historico de pecas retiradas (o item continua contando
    // como defeito; a nota mostra o que ja saiu dele)
    try {
      const ids = itens.map(x => x.id).filter(Boolean);
      if (ids.length > 0) {
        const { data: pcs } = await supabase.from('pecas_retiradas').select('defeito_id, peca, quem, criado_em, usada_em').in('defeito_id', ids);
        const porItem = {};
        for (const p of (pcs || [])) (porItem[p.defeito_id] = porItem[p.defeito_id] || []).push(p);
        for (const it of itens) {
          it.pecas_retiradas = (porItem[it.id] || []).map(p => ({ peca: p.peca, quem: p.quem, quando: p.criado_em, usada_em: p.usada_em }));
        }
      }
    } catch (e) { /* tabela pode nao existir ainda */ }

    const totalDefeitos = itens.reduce((a, x) => a + (Number(x.qtd) || 1), 0);
    return res.json({ ok: true, total_registros: itens.length, total_pecas: totalDefeitos, aguardando_nf: aguardandoNF, itens });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

// v3.76 - painel 'a espreita': devolucoes esperadas (em transito/atrasadas)
// v3.81 - ENRIQUECIMENTO da espreita (cliente + NF) com cache permanente:
// dados imutaveis, busca 1x em background e anexa pra sempre.
const ESP_ENRIQ = new Map();
// v3.95 - DATA REAL DA ENTREGA (bug: eu usava rr.last_updated do return, que
// e a ultima modificacao do registro - quando o ML mexe no return depois da
// entrega, a data "anda" e a conta de dias encolhe). A data certa esta no
// shipment: status_history.date_delivered. Busca em background, com cache
// permanente (a data nunca muda).
const ESP_ENTREGA = new Map();
let ESP_ENTREGA_RODANDO = false;
// v4.27 - versao que ESPERA (usada pelo alerta, onde a precisao importa mais
// que a velocidade). Busca so o que ainda nao esta no cache, em paralelo
// controlado, e nao mexe na trava do disparo em background.
async function garantirDatasEntrega(itens) {
  const faltam = [...new Set(
    (itens || [])
      .map(d => d.shipment_devolucao ? String(d.shipment_devolucao) : null)
      .filter(sid => sid && !ESP_ENTREGA.has(sid))
  )].slice(0, 40);
  if (faltam.length === 0) return;
  for (const sid of faltam) {
    try {
      const rh = await chamarML(`https://api.mercadolibre.com/shipments/${sid}/history`);
      const dt = (rh.ok && rh.data?.date_history?.date_delivered) || null;
      ESP_ENTREGA.set(sid, dt);
    } catch (e) { /* deixa sem data; melhor cair no fallback do que travar */ }
    await new Promise(r => setTimeout(r, 200));
  }
}

function dispararDatasEntrega(itens) {
  if (ESP_ENTREGA_RODANDO) return;
  const fila = itens.filter(d => d.shipment_devolucao && !ESP_ENTREGA.has(String(d.shipment_devolucao))).slice(0, 60);
  if (fila.length === 0) return;
  ESP_ENTREGA_RODANDO = true;
  (async () => {
    console.log(`[ESPREITA] buscando data real de entrega de ${fila.length} shipment(s)...`);
    for (const d of fila) {
      const sid = String(d.shipment_devolucao);
      try {
        const r = await chamarML(`https://api.mercadolibre.com/shipments/${sid}`, { 'x-format-new': 'true' });
        // v4.13 - a data REAL de entrega vem de /shipments/{id}/history, no
        // campo date_history.date_delivered. A v3.95 procurava em
        // status_history.date_delivered, que NAO existe nessa resposta -
        // por isso a contagem de dias do alerta seguia errada.
        let dt = r.ok ? (r.data?.status_history?.date_delivered || null) : null;
        if (!dt) {
          const rh = await chamarML(`https://api.mercadolibre.com/shipments/${sid}/history`);
          dt = (rh.ok && rh.data?.date_history?.date_delivered) || null;
        }
        ESP_ENTREGA.set(sid, dt);
      } catch (e) { ESP_ENTREGA.set(sid, null); }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log('[ESPREITA] datas de entrega atualizadas');
  })().catch(() => {}).finally(() => { ESP_ENTREGA_RODANDO = false; });
}
// v3.85 - logistic_type do ML -> rotulo curto (FULL/FLEX/Coletas/Correios)
function mapLogistica(lt) {
  const m = { fulfillment: 'FULL', self_service: 'FLEX', cross_docking: 'Coletas', xd_drop_off: 'Agência', drop_off: 'Correios', default: null };
  return m[String(lt || '')] || (lt || null);
}
let ESP_ENRIQ_RODANDO = false;
const nfDaChave = (k) => { const m = String(k || '').match(/^\d{44}$/) ? String(k).slice(25, 34).replace(/^0+/, '') : null; return m || null; };
// v4.38 - protocolos/tickets do SAC Magalu por pedido. A API oficial
// (/seller/v0/tickets?order_id=) devolve id (link), protocolo, motivo, status
// e prazo. Cache curto porque o status muda (waiting_seller -> respondido).
const MG_TICKETS = new Map();          // pedido(code) -> lista de tickets
let MG_TICKETS_TS = 0;                  // quando o indice global foi montado
let MG_TICKETS_CARREGANDO = null;       // promessa em voo (evita corrida)
const MG_TICKETS_TTL = 10 * 60 * 1000;
const MG_REASON = {
  defective_product: 'produto com defeito', product_not_received: 'não recebido',
  wrong_product: 'produto errado', give_up: 'desistência', regret: 'arrependimento',
  delivery_delay: 'atraso na entrega', missing_parts: 'faltando peças',
  different_product: 'produto diferente', damaged_product: 'produto danificado',
};
const MG_TYPE = { cancellation: 'cancelamento', general: 'dúvida/geral', return: 'devolução', exchange: 'troca' };
// v4.40 - a API de tickets IGNORA o filtro por pedido (order_id, orderNumber,
// tudo testado = trazia a loja inteira). Entao buscamos a lista completa UMA
// vez (paginando), montamos um indice por order.code, e cada pedido pega a sua
// fatia. Cache global de 10 min; uma so busca serve todos os cards.
async function montarIndiceTickets() {
  if ((Date.now() - MG_TICKETS_TS) < MG_TICKETS_TTL && MG_TICKETS.size) return;
  if (MG_TICKETS_CARREGANDO) return MG_TICKETS_CARREGANDO;
  MG_TICKETS_CARREGANDO = (async () => {
    const novo = new Map();
    try {
      for (let off = 0; off < 500; off += 50) {  // ate 500 tickets (10 paginas)
        const r = await magalu.chamarMagalu(`https://api.magalu.com/seller/v0/tickets?_limit=50&_offset=${off}`);
        const arr = (r.ok && (r.data?.results || r.data?.data || (Array.isArray(r.data) ? r.data : []))) || [];
        if (!arr.length) break;
        for (const t of arr) {
          const code = String(t.order?.code || t.order?.order_id || '').replace(/\D/g, '');
          if (!code) continue;
          if (!novo.has(code)) novo.set(code, []);
          novo.get(code).push({
            id: t.id || null,
            protocolo: t.protocol || null,
            tipo: MG_TYPE[t.type] || t.type || null,
            motivo: MG_REASON[t.reason] || t.reason || null,
            status: t.status || null,
            aguarda_voce: t.status === 'waiting_seller',
            prazo: t.due_date || null,
            fechado: !!t.closed,
            criado: t.created_at || null,
          });
        }
        if (arr.length < 50) break;
      }
      MG_TICKETS.clear();
      for (const [k, v] of novo) MG_TICKETS.set(k, v);
      MG_TICKETS_TS = Date.now();
    } catch (e) { /* mantem o indice anterior */ }
    finally { MG_TICKETS_CARREGANDO = null; }
  })();
  return MG_TICKETS_CARREGANDO;
}
async function magaluTicketsDoPedido(pedido) {
  const p = String(pedido || '').replace(/\D/g, '');
  if (!p) return [];
  await montarIndiceTickets();
  return MG_TICKETS.get(p) || [];
}

async function enriquecerItemEspreita(d) {
  const out = { cliente: null, nf: null, produto: null, sku: null, qtd: null, valor_nf: null, logistica: null, pack_id: null, itens: [], magalu_delivery_uuid: null, magalu_returns: [], magalu_tickets: [] }; // v4.22 / v4.32 / v4.36 / v4.38
  try {
    if (d.marketplace === 'ml' && d.pedido) {
      const rO = await chamarML(`https://api.mercadolibre.com/orders/${d.pedido}`);
      if (rO.ok && rO.data) {
        const b = rO.data.buyer || {};
        out.cliente = [b.first_name, b.last_name].filter(Boolean).join(' ') || b.nickname || null;
        const it = (rO.data.order_items || [])[0];
        if (it) { out.produto = it.item?.title || null; out.qtd = (rO.data.order_items || []).reduce((a, x) => a + (x.quantity || 0), 0); }
        // v4.22 - TODOS os itens da venda (o alerta mostra e a fila de NF usa)
        out.itens = (rO.data.order_items || []).map(x => ({
          titulo: x.item?.title || null,
          sku: x.item?.seller_sku || x.item?.seller_custom_field || null,
          mlb: x.item?.id || null,
          qtd: x.quantity || 1,
          valor_unit: x.unit_price || null,
        }));
        // v4.32 - SKU do 1o item e valor total da venda pro card
        if (out.itens[0]) out.sku = out.itens[0].sku || null;
        out.valor_nf = out.itens.reduce((a, x) => a + ((x.valor_unit || 0) * (x.qtd || 1)), 0) || null;
        out.pack_id = rO.data.pack_id ? String(rO.data.pack_id) : null; // v3.86: pack_id vem na etiqueta de devolucao ML
        const shipIda = rO.data.shipping?.id;
        if (shipIda) {
          const rS = await chamarML(`https://api.mercadolibre.com/shipments/${shipIda}`, { 'x-format-new': 'true' });
          if (rS.ok && rS.data) out.logistica = mapLogistica(rS.data.logistic_type);
          const rN = await buscarNFnoML(shipIda);
          if (rN.ok && rN.data?.fiscal_key) out.nf = nfDaChave(rN.data.fiscal_key);
        }
      }
    } else if (d.marketplace === 'magalu' && d.pedido) {
      const rP = await magalu.chamarMagalu(`https://api.magalu.com/seller/v1/orders/${d.pedido}`);
      if (rP.ok && rP.data) {
        out.cliente = rP.data.customer?.name || null;
        // v4.36 - UUID da entrega = o que monta o link do pedido no seller.magalu.com
        // (descoberto no HAR do Diego: deliveries[0].id). E as devolucoes associadas.
        const dlv = (rP.data.deliveries || [])[0];
        if (dlv?.id) out.magalu_delivery_uuid = dlv.id;
        out.magalu_returns = (dlv?.returns || rP.data.deliveries?.flatMap(x => x.returns || []) || [])
          .map(r => r.external_id).filter(Boolean);
        // v4.42 - nao busca mais tickets da API aqui: o card usa a pagina oficial
        // (seller.magalu.com/tickets/?orderNumber=) que e confiavel. A API de
        // tickets ficou so nas rotas de debug, se precisar investigar.
        // v4.43 - estrutura real: deliveries[].items[].info.{name,sku} + unit_price.value
        // (com normalizer 100 = centavos). O codigo antigo procurava items[].product,
        // que nao existe nesse formato - por isso vinha vazio.
        const items = (rP.data.deliveries || []).flatMap(x => x.items || []);
        const norm = (rP.data.amounts?.normalizer) || 100;
        if (items[0]) {
          const inf = items[0].info || {};
          out.produto = inf.name || inf.description || null;
          out.sku = inf.sku || (items[0].external_sku) || null;
          out.qtd = items.reduce((a, x) => a + (x.quantity || 0), 0);
        }
        // valor: soma dos unit_price.value * quantidade, convertendo o normalizer
        out.valor_nf = items.reduce((a, x) => {
          const v = (x.unit_price?.value != null) ? x.unit_price.value : (x.amounts?.total || 0);
          return a + (v * (x.quantity || 1));
        }, 0) / norm || null;
        // se preferir o total do pedido: rP.data.amounts.total / normalizer
        if (!out.valor_nf && rP.data.amounts?.total) out.valor_nf = rP.data.amounts.total / norm;
        out.logistica = 'Magalu';
        const cols = [rP.data.invoices, ...((rP.data.deliveries || []).map(x => x && x.invoices))];
        for (const arr of cols) {
          const k = (arr || []).map(i => i && i.key).find(kk => /^\d{44}$/.test(String(kk || '')));
          if (k) { out.nf = nfDaChave(k); break; }
        }
      }
    } else if (d.marketplace === 'shopee' && d.pedido) {
      const rB = await buscarNFBlindada({ orderId: d.pedido });
      if (rB && rB.ok && rB.nf) {
        out.nf = rB.nf.numero ? String(rB.nf.numero).replace(/^0+/, '') : null;
        out.cliente = rB.nf.contato?.nome || null;
        if (Array.isArray(rB.nf.itens) && rB.nf.itens[0]) { out.produto = rB.nf.itens[0].descricao || null; out.sku = rB.nf.itens[0].codigo || null; out.qtd = rB.nf.itens.reduce((a, x) => a + (Number(x.quantidade) || 0), 0); out.valor_nf = rB.nf.itens.reduce((a, x) => a + ((Number(x.valor) || 0) * (Number(x.quantidade) || 1)), 0) || null; }
        out.logistica = 'Shopee';
      }
    }
  } catch (e) { /* item fica sem enriquecer nesta rodada */ }
  return out;
}
// v4.33 - versao que ESPERA (usada pelo alerta: sao poucos itens e a gente
// quer os detalhes ja na primeira carga, nao daqui a um minuto).
async function garantirEnriquecimentoEspreita(itens) {
  const faltam = (itens || []).filter(d => d.chave_nota && !ESP_ENRIQ.has(d.chave_nota)).slice(0, 30);
  for (const d of faltam) {
    try {
      const en = await enriquecerItemEspreita(d);
      ESP_ENRIQ.set(d.chave_nota, en);
    } catch (e) { /* segue sem enriquecer este */ }
    await new Promise(r => setTimeout(r, 200));
  }
}

function dispararEnriquecimentoEspreita(itens) {
  if (ESP_ENRIQ_RODANDO) return;
  const fila = itens.filter(d => d.chave_nota && !ESP_ENRIQ.has(d.chave_nota)).slice(0, 80);
  if (fila.length === 0) return;
  ESP_ENRIQ_RODANDO = true;
  (async () => {
    console.log(`[ESPREITA] enriquecendo ${fila.length} item(ns) em background...`);
    for (const d of fila) {
      const en = await enriquecerItemEspreita(d);
      ESP_ENRIQ.set(d.chave_nota, en);
      await new Promise(r => setTimeout(r, 350));
    }
    console.log('[ESPREITA] enriquecimento concluido');
  })().catch(() => {}).finally(() => { ESP_ENRIQ_RODANDO = false; });
}

// v3.83 - CRUD dos recados
app.post('/api/admin/recado', requerAdmin, async (req, res) => {
  const chave = normId(req.body?.chave);
  const texto = String(req.body?.texto || '').trim();
  if (!chave || !texto) return res.status(400).json({ ok: false, erro: 'informe o identificador (pedido/NF/rastreio) e o texto' });
  try {
    const { error } = await supabase.from('recados').insert([{ chave, texto: texto.slice(0, 2000), criado_por: req.usuario || null, ativo: true }]);
    if (error) {
      const m = String(error.message || '');
      if (/recados/.test(m) && /not exist|find the table|schema cache/i.test(m)) {
        return res.status(500).json({ ok: false, erro: 'Tabela recados ainda nao existe no Supabase - rode o SQL.' });
      }
      return res.status(500).json({ ok: false, erro: m });
    }
    return res.json({ ok: true, chave });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});
app.get('/api/admin/recados', requerAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('recados').select('*').eq('ativo', true).order('criado_em', { ascending: false }).limit(100);
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    // v4.45 - anexa se a devolucao daquele recado ja foi resolvida (triada/NF).
    // O recado continua na lista (historico agarrado ao pedido), mas sinalizado.
    const recados = data || [];
    await Promise.all(recados.map(async (rc) => {
      try { rc.resolvido = await devolucaoJaResolvida(variantesId(rc.chave)); }
      catch (e) { rc.resolvido = false; }
    }));
    return res.json({ ok: true, recados });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});
app.post('/api/admin/recado/:id/remover', requerAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('recados').update({ ativo: false }).eq('id', req.params.id);
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});
// ciencia do estoquista (fica registrado quem leu e quando)
app.post('/api/recado/:id/ciente', requerLogin, async (req, res) => {
  try {
    const { error } = await supabase.from('recados')
      .update({ ciente_por: req.usuario || null, ciente_em: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    return res.json({ ok: true, usuario: req.usuario });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

async function montarEspreita() {
  // v3.77 - agregador: Magalu (BFF) + ML (indice claims->returns) + Shopee (proxy)
  const magaluR = espreita.resumo();
  const mlR = mlReturns.resumoEspreita();
  let shopeeR = { quente: false, em_transito: [] };
  try { shopeeR = await shopee.resumoEspreita(); } catch (e) { shopeeR = { quente: false, erro: e.message, em_transito: [] }; }
  let unificada = [
    ...magaluR.em_transito.map(d => ({ marketplace: 'magalu', pedido: d.pedido, tracking: null, status: (d.categoria || '') + (d.status ? ' / ' + d.status : ''), dias_em_transito: d.dias_em_transito, valor: d.valor, uuid: d.chave || null, tipo: d.tipo || null, categoria: d.categoria || null })),
    ...(mlR.em_transito || []).filter(d => (d.dias_em_transito == null) || d.dias_em_transito <= 120), // v4.18: corte de sanidade
    ...shopeeR.em_transito,
  ].sort((x, y) => (y.dias_em_transito || 0) - (x.dias_em_transito || 0));

  // v3.79 - BAIXA AUTOMATICA por triagem: devolucao Shopee ja BIPADA no
  // galpao sai do "em transito" (o status ACCEPTED congela na origem; a
  // triagem fisica e a verdade). Cruzamento pelo tracking == shipment_id.
  let recebidasShopee = 0;
  try {
    const trks = unificada.filter(d => d.marketplace === 'shopee' && d.tracking).map(d => String(d.tracking));
    if (trks.length > 0) {
      const { data: tri } = await supabase.from('devolucoes').select('shipment_id').in('shipment_id', trks);
      const bipados = new Set((tri || []).map(t => String(t.shipment_id)));
      if (bipados.size > 0) {
        recebidasShopee = unificada.filter(d => d.marketplace === 'shopee' && bipados.has(String(d.tracking))).length;
        unificada = unificada.filter(d => !(d.marketplace === 'shopee' && bipados.has(String(d.tracking))));
      }
    }
  } catch (e) { /* baixa e opcional: falha nao derruba o painel */ }

  // legado congelado: Shopee ACCEPTED ha 60+ dias = origem parou de atualizar
  for (const d of unificada) {
    if (d.marketplace === 'shopee' && (d.dias_em_transito || 0) > 60) d.congelada = true;
  }

  // v3.80 - notas manuais: "ja processado" some da lista; comentarios anexam
  const chaveEspreita = (d) => String(d.tracking || (d.marketplace + ':' + d.pedido));
  let baixadasManuais = 0;
  try {
    const chaves = unificada.map(chaveEspreita);
    if (chaves.length > 0) {
      const { data: notas } = await supabase.from('espreita_notas').select('chave, baixado, comentario, ticket').in('chave', chaves);
      const porChave = {};
      for (const n of (notas || [])) porChave[n.chave] = n;
      baixadasManuais = unificada.filter(d => porChave[chaveEspreita(d)]?.baixado).length;
      unificada = unificada.filter(d => !porChave[chaveEspreita(d)]?.baixado);
      for (const d of unificada) {
        const n = porChave[chaveEspreita(d)];
        if (n && n.comentario) d.comentario = n.comentario;
        if (n && n.ticket) d.ticket = n.ticket; // v4.31
        d.chave_nota = chaveEspreita(d);
      }
    }
  } catch (e) { for (const d of unificada) d.chave_nota = chaveEspreita(d); }
  // v4.50 - marca itens que ja tem NF de devolucao emitida (indice do Bling)
  for (const d of unificada) {
    const ped = String(d.pedido || '').replace(/\s/g, '');
    if (ped && NF_DEV_INDICE.has(ped)) d.nf_devolucao = NF_DEV_INDICE.get(ped);
  }

  // v3.81 - anexa cliente/NF do cache; dinheiro: ML tem status_money nativo
  // v4.34 - espera o enriquecimento dos itens ATRASADOS (+30 dias, os que a
  // gente de fato vai cobrar) antes de responder; o resto enriquece em
  // background pra nao deixar a carga lenta com dezenas de itens.
  const prioritarios = unificada.filter(d => (d.dias_em_transito || 0) > 30).slice(0, 25);
  await garantirEnriquecimentoEspreita(prioritarios);
  for (const d of unificada) {
    const en = ESP_ENRIQ.get(d.chave_nota);
    if (en) { d.cliente = en.cliente; d.nf = en.nf; d.produto = en.produto; d.sku = en.sku; d.qtd = en.qtd; d.valor_nf = en.valor_nf; d.pack_id = en.pack_id; d.magalu_delivery_uuid = en.magalu_delivery_uuid; d.magalu_returns = en.magalu_returns; d.magalu_tickets = en.magalu_tickets; if (en.logistica) d.logistica = en.logistica; }
    if (d.marketplace === 'ml') d.dinheiro = d.status_money === 'refunded' ? 'estornado_cliente' : (d.status_money === 'retained' ? 'retido_com_voce' : null);
  }
  dispararEnriquecimentoEspreita(unificada);

  // v3.82 - ALERTA "DEVERIA TER CHEGADO": a origem afirma que ENTREGOU no
  // seller, mas NINGUEM bipou aqui. Cruza por order_id (pedido) e por
  // shipment_id (tracking/chave) na tabela de triagens. Corte de 90 dias
  // pra nao inundar com o legado anterior ao sistema.
  let nuncaBipadas = [];
  try {
    // v3.87 - PISO de 5 dias: recem-entregue pode estar so na fila de
    // recebimento do galpao (caso real: entregue hoje 14h, alerta as 15h e
    // falso alarme). Alerta so entre 5 e 90 dias - tempo de sumico real.
    // v3.95 - usa a data REAL de entrega quando ja estiver no cache; o corte de
    // 5-90 dias e aplicado DEPOIS da correcao (antes, o last_updated do return
    // encolhia a conta e o item aparecia com menos dias do que os reais).
  const brutos = [...(mlR.entregues || []), ...(magaluR.entregues || [])];
    // v4.27 - a data REAL de entrega e o que decide os dias. Buscar em
    // background NAO chega a tempo na primeira carga (o alerta responde antes),
    // e o painel acaba mostrando o last_updated do return, que e sempre MAIOR
    // que a entrega real (a devolucao "fecha" dias depois de chegar). Como os
    // candidatos do alerta sao poucos, ESPERAMOS a data deles aqui.
    await garantirDatasEntrega(brutos);
    for (const d of brutos) {
      const real = d.shipment_devolucao ? ESP_ENTREGA.get(String(d.shipment_devolucao)) : null;
      if (real) {
        d.entregue_em = real;
        d.dias_desde = Math.floor((Date.now() - Date.parse(real)) / 864e5);
      }
    }
    const candidatos = brutos
      .filter(d => (d.dias_desde != null) && d.dias_desde >= 5 && d.dias_desde <= 90 && (d.pedido || d.tracking));
    if (candidatos.length > 0) {
      const pedidos = [...new Set(candidatos.map(d => String(d.pedido || '')).filter(Boolean))];
      const trks = [...new Set(candidatos.map(d => String(d.tracking || '')).filter(Boolean))];
      const achados = new Set();
      if (pedidos.length) {
        const { data } = await supabase.from('devolucoes').select('order_id').in('order_id', pedidos);
        for (const r of (data || [])) achados.add(String(r.order_id));
      }
      if (trks.length) {
        const { data } = await supabase.from('devolucoes').select('shipment_id').in('shipment_id', trks);
        for (const r of (data || [])) achados.add(String(r.shipment_id));
      }
      const chavesN = candidatos.map(d => String(d.tracking || (d.marketplace + ':' + d.pedido)));
      const notasN = {};
      try {
        const { data } = await supabase.from('espreita_notas').select('chave, baixado, comentario').in('chave', chavesN);
        for (const n of (data || [])) notasN[n.chave] = n;
      } catch (e) { /* segue sem notas */ }
      const baseAlerta = candidatos
        .filter(d => !achados.has(String(d.pedido || '')) && !achados.has(String(d.tracking || '')))
        .map(d => ({ ...d, chave_nota: String(d.tracking || (d.marketplace + ':' + d.pedido)) }))
        .filter(d => !notasN[d.chave_nota]?.baixado);
      // v4.33 - espera os detalhes ANTES de responder (na primeira carga vinham
      // vazios porque o enriquecimento era so disparado em background)
      await garantirEnriquecimentoEspreita(baseAlerta);
      nuncaBipadas = baseAlerta.map(d => {
        const en = ESP_ENRIQ.get(d.chave_nota);
        return { ...d, comentario: notasN[d.chave_nota]?.comentario || null, ticket: notasN[d.chave_nota]?.ticket || null, cliente: en?.cliente || null, nf: en?.nf || null, produto: en?.produto || null, sku: en?.sku || null, qtd: en?.qtd || null, valor_nf: en?.valor_nf || null, logistica: en?.logistica || null, pack_id: en?.pack_id || null, itens: en?.itens || [], magalu_delivery_uuid: en?.magalu_delivery_uuid || null, magalu_returns: en?.magalu_returns || [], magalu_tickets: en?.magalu_tickets || [] };
      });
    }
  } catch (e) { nuncaBipadas = []; }
  return ({
    ok: true,
    quente: magaluR.quente || mlR.quente || shopeeR.quente,
    em_transito: unificada,
    atrasadas_30d: unificada.filter(d => (d.dias_em_transito || 0) > 30),
    ml_aguardando_postagem: mlR.aguardando_postagem || 0,
    magalu_chegadas_30d: magaluR.chegadas_30d || 0,
    shopee_recebidas_baixadas: recebidasShopee,
    baixadas_manuais: baixadasManuais,
    nunca_bipadas: nuncaBipadas,
    fontes: { magalu: magaluR.quente, ml: mlR.quente, shopee: shopeeR.quente },
    erro: magaluR.erro || shopeeR.erro || null,
  });
}

// v4.51 - a rota: serve o cache instantaneo se recente; senao monta e cacheia.
// b295 (review do Codex) - IDS FISCAIS **DESTA** EMPRESA.
//
// A primeira versao aceitava `?empresa=amb` e roteava pro modulo da AMB aqui
// da raiz. Isso NAO funciona: a AMB autentica com o cookie `sessao_amb`, que
// vive em `Path=/amb` — o navegador simplesmente nao manda esse cookie pra
// uma rota na raiz, e `credentials: 'include'` nao muda restricao de path.
// Quem estivesse logado so na AMB levava 401 sempre. E a AMB **ja tem** a
// propria rota (`/amb/api/ids-fiscais`, b283), com a sessao certa.
//
// Entao: cada empresa responde na PROPRIA area, com a PROPRIA sessao. O
// Bridge escolhe o endereco conforme a empresa da devolucao — continua sendo
// escolha explicita, que era o ponto.
//
// E `empresa` e OBRIGATORIA: sem ela, 400. Assumir "good" por omissao
// transformaria um parametro faltando em **emissao na empresa errada**.
app.get('/api/ids-fiscais', requerLogin, async (req, res) => {
  const alvo = String(req.query.empresa || '').trim().toLowerCase();
  if (!alvo) {
    return res.status(400).json({
      ok: false,
      erro: 'informe a empresa: /api/ids-fiscais?empresa=good',
      aceitas_aqui: ['good'],
      outras_empresas: { ambtotal: '/amb/api/ids-fiscais' },
    });
  }
  if (alvo === 'good') {
    return res.json({ ok: true, empresa: 'good', ...(await blingClient.idsFiscais()) });
  }
  if (alvo === 'amb' || alvo === 'ambtotal') {
    // nao atendemos a AMB daqui: a sessao dela nao chega nesta rota
    return res.status(400).json({
      ok: false,
      erro: 'a AMB responde na propria area, com a sessao dela',
      use: '/amb/api/ids-fiscais',
    });
  }
  return res.status(400).json({ ok: false, erro: 'empresa desconhecida: ' + alvo, aceitas_aqui: ['good'] });
});

// ============================================================
// v4.69 - VENDAS ESTORNADAS SEM RETORNO
// ------------------------------------------------------------
// Lista as vendas que o marketplace reembolsou SEM devolucao fisica —
// o produto nunca volta, mas a NF de venda continua emitida, gerando
// imposto sobre uma receita que nao existiu.
//
// Ideia do dono (29/08):
//
//   "se a venda foi cancelada, a gente pode cancelar a nota fiscal e
//    isentar ao menos o imposto da venda. se não der pra cancelar, a
//    gente gera a nota fiscal de devolução q dá na mesma"
//
// TAMANHO DO PROBLEMA: no TikTok da Girassol, o filtro "Apenas
// reembolso" mostrava 62 casos contra 103 com devolucao. Metade das
// solicitacoes nunca vira pacote.
//
// O PRAZO decide o que fazer (medido na madrugada de 25-28/08):
//   ate 20 dias  -> da pra CANCELAR a NF (cStat 135 ate 24h, 155 depois)
//   passou disso -> so NF de devolucao (501 intempestivo, sem contorno)
//
// O DEPOSITO E O DE DEFEITO, nao o geral — pedido dele: "não integrarão
// o estoque normal, pois nunca recebemos d volta". O objetivo aqui e
// so fiscal.
//
// ⚠️ NAO EMITE NADA. So lista e ordena; quem decide e emite e ele, no
// fluxo de sempre.
// ============================================================
// ============================================================
// v4.81 - REGISTRAR UM CASO DO CARD PRA PODER EMITIR A NF
// ------------------------------------------------------------
// [stated] "se tá ali, pode até criar gerar automático esse registro.
// pq no fim, o q vai interessar mm é a emissão da NF e pra qual
// depósito eu vou direcionar"
//
// POR QUE PRECISA DISTO: quem emite a NF de devolucao e a extensao
// Bridge, e ela grava o resultado usando o id de uma TRIAGEM. Os casos
// do card de estornadas nao tem triagem — ninguem bipou nada, o produto
// nem sempre voltou.
//
// Entao, quando o dono manda emitir, crio o registro na hora. Faz
// sentido: o caso VIRA uma devolucao de verdade no momento em que ele
// decide emitir a nota. E dai em diante e o fluxo de sempre — lote,
// deposito, esteira, concluido.
//
// ⚠️ SOBRE O ESTOQUE, e vale registrar porque eu estava errado:
// pensei que dar entrada num caso `nf_sem_saida` (produto que nunca
// saiu do CD) duplicaria o inventario. Nao duplica. A NF DE VENDA JA
// DEU BAIXA no estoque quando foi emitida — o sistema acha que o
// produto saiu, mas ele esta la. A devolucao com entrada CORRIGE essa
// diferenca. [stated] Correcao dele: "nos casos q o produto nunca foi
// postado, é só gerar devolução normal, e depósito Geral. Simples."
// ============================================================
app.post('/api/admin/sem-retorno/registrar', requerAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ ok: false, erro: 'Supabase nao configurado' });

    const d = req.body || {};
    const pedido = String(d.pedido || '').trim();
    if (!pedido) return res.status(400).json({ ok: false, erro: 'sem pedido, nao da pra registrar' });

    // JA EXISTE? devolvo o id em vez de criar outro. Sem isto, clicar
    // duas vezes criaria dois registros da mesma devolucao — e duas
    // portas pra emitir a mesma nota.
    // v4.81.1 (Codex): a chave e a SOLICITACAO, nao o pedido.
    //
    // O TikTok abre uma solicitacao por ITEM, e o Magalu pode ter varias
    // notas por pedido. Procurando so por `order_id`, a segunda solicitacao
    // do mesmo pedido reaproveitaria o registro da primeira — e se aquela
    // ja tem NF, esta seria BLOQUEADA com "ja emitida", quando na verdade
    // e outro caso, ainda pendente.
    //
    // O marcador `[caso:X]` na descricao identifica a solicitacao. Casos
    // antigos (sem marcador) continuam casando por pedido, que e o que da
    // pra fazer com o dado que existe.
    const chaveCaso = String(d.chave_caso || '').trim();
    const { data: doPedido, error: erroBusca } = await supabase
      .from('devolucoes')
      .select('id, nf_devolucao_id_bling, problema_descricao')
      .eq('order_id', pedido);
    if (erroBusca) return res.status(500).json({ ok: false, erro: erroBusca.message });

    // b194.1: procura o id atual E o legado, pelo mesmo motivo do filtro
    const legados = [d.chave_caso_legado, d.chave_caso_legado2]
      .map((x) => String(x || '').trim()).filter(Boolean);
    const existente = chaveCaso
      ? (doPedido || []).find((r) => {
        const desc = String(r.problema_descricao || '');
        return desc.includes('[caso:' + chaveCaso + ']')
          || legados.some((l) => desc.includes('[caso:' + l + ']'));
      })
      : (doPedido || [])[0];

    if (existente) {
      return res.json({
        ok: true,
        id: existente.id,
        ja_existia: true,
        nf_ja_emitida: !!existente.nf_devolucao_id_bling,
      });
    }

    const { data, error } = await supabase
      .from('devolucoes')
      .insert({
        // b193.1 (Codex): entra na fila normal, MAS marcado.
        //
        // Na fila, o card ganha o botao "rascunho ou emitir" e o checkbox da
        // esteira — e a esteira manda `emitir: true` SEMPRE. Isso contorna a
        // protecao de so-rascunho que este PR criou, e transmitiria pra
        // SEFAZ a devolucao da nota INTEIRA.
        //
        // O marcador `[SO RASCUNHO]` na descricao e lido pela esteira e pelo
        // card (abaixo), que passam a oferecer so o rascunho.
        tipo: 'aprovado',           // entra na fila normal de "aguardando NF"
        status: 'pendente',
        order_id: pedido,
        produto_titulo: d.produto || null,
        produto_sku: d.sku || null,
        produto_qtd: d.qtd || null,
        nf_numero: d.nf_numero || null,
        nf_chave: d.nf_chave || null,
        nf_id_bling: d.nf_id_bling || null,
        funcionario: 'Sistema (card estornadas)',
        // b199.6 (Codex): GRAVAR o que a fila vai precisar depois.
        //
        // O lote manda o caso pra "Aprovadas", e o rascunho e gerado LA —
        // por um card que so tem o que esta no banco. Sem estes campos:
        //   - a trava de NF duplicada nao roda (precisa de cliente e data)
        //   - o deposito cai em GERAL (o marcador de defeito se perde)
        // Consertei o caminho direto e esqueci que o lote passa pela fila.
        // b199.7 (Codex): SO colunas que a tabela de triagens tem.
        //
        // Eu tinha posto `cliente_nome` e `nf_emitida_em`, que so existem em
        // `devolucoes_capturadas` — o PostgREST rejeitaria a LINHA INTEIRA,
        // e o registro falharia todo, nao so em parte.
        //
        // `buyer_nome` existe (o insert da triagem usa). A DATA nao tem
        // coluna aqui, entao vai na descricao, de onde o card pode ler.
        buyer_nome: d.cliente || null,
        // ⚠️ o RASTRO de onde veio: quem olhar este registro depois precisa
        // saber que NAO houve bipagem — o produto pode nem ter voltado.
        // `[DEFEITO]` na descricao: as filas leem `d.status || d.tipo` pra
        // decidir o deposito, e a palavra "defeito" ali faz `ehProblema`
        // casar. E o unico canal que atravessa sem coluna nova.
        problema_descricao: marcadores.montarDescricao({ ...d, chave_caso: chaveCaso }),
      })
      .select('id')
      .single();

    if (error) return res.status(500).json({ ok: false, erro: error.message });

    // b199.4 (Codex): o cliente aqui chama-se `supabase`, nao `sb`.
    // Copiei o bloco da AMB sem trocar o nome — dava ReferenceError, que o
    // catch abaixo ENGOLIA. A limpeza nunca rodava e ninguem saberia.
    //
    // CORRIDA entre duas abas. Nao ha indice unico pro
    // marcador, entao dois cliques simultaneos passam os dois pelo select
    // acima e criam DOIS registros da mesma devolucao — duas portas pra
    // emitir a mesma nota.
    //
    // Releio depois de inserir: se apareceu outro com o mesmo `[caso:X]` e
    // ele e mais antigo, apago o meu e devolvo o dele.
    if (chaveCaso) {
      try {
        const { data: dobrados } = await supabase
          .from('devolucoes')
          .select('id, problema_descricao')
          .eq('order_id', pedido);
        const mesmos = (dobrados || [])
          .filter((r) => String(r.problema_descricao || '').includes('[caso:' + chaveCaso + ']'))
          .sort((a, b) => Number(a.id) - Number(b.id));
        if (mesmos.length > 1 && String(mesmos[0].id) !== String(data.id)) {
          await supabase.from('devolucoes').delete().eq('id', data.id);
          return res.json({ ok: true, id: mesmos[0].id, ja_existia: true, corrida_resolvida: true });
        }
      } catch (e) { /* na duvida fica o que inseri; o front nao duplica sozinho */ }
    }

    return res.json({ ok: true, id: data.id, ja_existia: false });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 200) });
  }
});

app.get('/api/admin/sem-retorno', requerAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ ok: false, erro: 'Supabase nao configurado' });

    // b188 - a janela vai ate 365 dias, e o padrao subiu pra 365 tambem:
    // o dono perguntou "puxa desde o comeco do ano?". Puxa — e faz sentido,
    // porque NF de devolucao nao tem prazo (so o CANCELAMENTO tem 20 dias).
    // Caso antigo continua rendendo imposto de volta.
    const dias = Math.min(730, Math.max(1, parseInt(req.query.dias, 10) || 365));
    // b195.3 (Codex): `?de=` vale pros DOIS marketplaces. So o Magalu
    // respeitava, entao pedir uma fatia trazia TikTok do periodo inteiro.
    // b195.4 (Codex): validar a data ANTES de usar. `?de=ontem` viraria
    // "Invalid Date" e `.toISOString()` LANCA — a rota inteira responderia
    // 500 por causa de um parametro mal digitado.
    //
    // E a janela ancora no `?ate=` quando ele vem: senao, pedir uma fatia
    // antiga sem `?de=` abriria HOJE menos `dias`, e as pontas podiam nem
    // se cruzar. Mesma correcao que ja fiz no Magalu.
    const dePedidoRaw = String(req.query.de || '').trim();
    const atePedidoRaw = String(req.query.ate || '').trim();
    const dataOuNull = (txt) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(txt)) return null;
      const t = new Date(txt + 'T00:00:00Z');
      if (!Number.isFinite(t.getTime())) return null;
      // b195.5 (Codex): `2026-02-31` NAO e invalido pro Date — ele normaliza
      // pra 03/03 em silencio, e a janela vira outra sem ninguem saber.
      // Confiro que a data VOLTA igual ao que foi pedido.
      return t.toISOString().slice(0, 10) === txt ? t : null;
    };
    const deValido = dataOuNull(dePedidoRaw);
    const ateValido = dataOuNull(atePedidoRaw);
    const fimBase = ateValido ? ateValido.getTime() : Date.now();
    const desde = deValido
      ? deValido.toISOString()
      : new Date(fimBase - dias * 864e5).toISOString();

    // b188.3 (Codex): ?ate=AAAA-MM-DD alcanca o que ficou fora do corte.
    //
    // A ordem e do mais recente pro mais antigo, entao o corte come a cauda.
    // Com `ate`, o dono empurra a janela pra tras e ve os anteriores — sem
    // eu precisar paginar, que complicaria a rota por pouco ganho.
    const ateParam = String(req.query.ate || '').trim();
    const ate = /^\d{4}-\d{2}-\d{2}$/.test(ateParam)
      ? new Date(ateParam + 'T23:59:59Z').toISOString()
      : null;

    // b184 (Codex): FILTRAR NO BANCO, nao depois.
    //
    //   1. `empresa` — a tabela e COMPARTILHADA (uma linha por empresa,
    //      foi decisao de desenho). Sem este filtro, o painel da GOOD
    //      mostraria devolucoes da AMB e da Girassol.
    //   2. `tipo_tiktok` e `status` — eu filtrava em JS DEPOIS do limite
    //      de 500. Numa janela com mais de 500 capturadas, os reembolsos
    //      podiam ficar todos de fora e a lista vinha vazia sem motivo.
    //
    // O limite agora se aplica ao que interessa, nao ao bolo inteiro.
    // b184.1 (Codex): a empresa e FIXA, nao vem da querystring.
    //
    // Eu aceitava ?empresa=amb e o admin da GOOD via os dados da AMB so
    // trocando a URL — vazamento entre empresas, e o oposto do isolamento
    // que o resto do projeto mantem (server separado, tabela separada,
    // login separado). Este servidor E o da GOOD; a AMB tem o dela.
    const empresa = 'good';
    const LIMITE = 500;

    let consulta = supabase
      .from('devolucoes_capturadas')
      .select('*')
      .eq('empresa', empresa)
      .eq('tipo_tiktok', 'REFUND')
      // b184.1 (Codex): a JANELA e do REEMBOLSO, nao da captura. `capturado_em`
      // e quando NOS gravamos — a captura roda de hora em hora e regrava tudo,
      // entao ?dias=7 trazia 6 meses de historico. Filtro por criado_no_mkt,
      // que e quando a devolucao nasceu no marketplace.
      .gte('criado_no_mkt', desde)
      // b195.6 (Codex): o `?ate=` tambem CORTA em cima. Sem isto, pedir uma
      // fatia antiga trazia o TikTok ate hoje — a janela do Magalu terminava
      // na data pedida e a do TikTok nao, e as duas listas nao batiam.
      .lt('criado_no_mkt', ateValido
        ? new Date(ateValido.getTime() + 864e5).toISOString()
        : new Date(Date.now() + 864e5).toISOString())
      // b184.1: e o STATUS tambem no banco. Filtrar "concluida" em JS depois
      // do limite tinha o mesmo defeito de antes: numa janela cheia de
      // pendentes, as concluidas ficavam de fora.
      .in('status', ['RETURN_OR_REFUND_REQUEST_COMPLETE', 'REFUND_SUCCESS', 'COMPLETE', 'SUCCESS'])
      .order('criado_no_mkt', { ascending: false })
      .limit(LIMITE);

    if (ate) consulta = consulta.lte('criado_no_mkt', ate);

    const { data, error } = await consulta;

    if (error) return res.status(500).json({ ok: false, erro: error.message });

    // b188.2 (Codex): AVISAR quando a janela encheu.
    //
    // Com 365 dias o volume cresce, e um corte silencioso em 500 esconderia
    // os casos mais antigos — justamente os que ja passaram do prazo de
    // cancelamento e so tem a NF de devolucao como saida. Paginar de
    // verdade complicaria a rota; dizer que cortou resolve: o dono estreita
    // a janela com ?dias= e ve o resto.
    const cortou = (data || []).length >= LIMITE;

    // rede de seguranca: o `in` acima ja filtrou, mas se o marketplace
    // criar um status novo com CANCEL no nome, ele nao passa aqui.
    // Solicitacao PENDENTE pode virar devolucao com retorno ou ser recusada
    // — emitir NF nela seria devolver o que talvez nem tenha sido reembolsado.
    const semRetorno = (data || []).filter((d) => {
      const st = String(d.status || '').toUpperCase();
      return st.indexOf('CANCEL') === -1;
    });

    // ja tem NF de devolucao? entao ja foi resolvida
    const pedidos = [...new Set(semRetorno.map((d) => d.pedido).filter(Boolean))];
    // b184 (Codex): esta consulta NAO pode falhar em silencio, nem ficar
    // pela metade. Se ela falhar e eu seguir, o painel mostra casos JA
    // RESOLVIDOS e o dono emite NF em duplicidade — pior que nao mostrar
    // nada. E o teto de 300 deixava de fora os pedidos seguintes, que
    // apareceriam como pendentes sem ser.
    // b184.5: so o conjunto FINO sobrevive — o descarte por pedido saiu,
    // porque escondia caso novo por causa de NF de solicitacao antiga.
    const resolvidosFinos = new Set();
    for (let i = 0; i < pedidos.length; i += 200) {
      const fatia = pedidos.slice(i, i + 200);
      const { data: tri, error: erroTri } = await supabase
        .from('devolucoes')
        // b187: a tabela da GOOD nao tem `tracking` — quem tem e a
        // `devolucoes_amb`. Eu adicionei o campo pensando na AMB e derrubei
        // a consulta aqui: "column devolucoes.tracking does not exist".
        //
        // O aviso do painel funcionou como devia (disse o motivo em vez de
        // mostrar lista errada), mas o certo e nao quebrar.
        .select('order_id, shipment_id, nf_devolucao_id_bling')
        .in('order_id', fatia)
        .not('nf_devolucao_id_bling', 'is', null);
      if (erroTri) {
        return res.status(500).json({
          ok: false,
          erro: 'nao consegui conferir quais ja tem NF de devolucao: ' + erroTri.message
            + ' — listar sem essa checagem mostraria casos ja resolvidos',
        });
      }
      // b184.1 (Codex): guardo os identificadores mais finos, porque
      // um PEDIDO pode ter varias solicitacoes (o TikTok abre uma por item).
      // Resolver a do item A nao resolve a do item B — descartar pelo pedido
      // esconderia a segunda, que continua devendo NF.
      // b184.5: a chave da captura pode ser o id da solicitacao OU o
      // rastreio. Aqui so tenho `shipment_id` — na GOOD e onde o rastreio
      // acaba caindo, porque a coluna `tracking` so existe na tabela da AMB.
      for (const t of (tri || [])) {
        if (t.shipment_id) resolvidosFinos.add(String(t.shipment_id));
      }
    }

    const AGORA = Date.now();
    // b184.5 (Codex): o descarte e SEMPRE pela solicitacao, nunca pelo pedido.
    //
    // Eu contava as irmas DEPOIS dos filtros (data, tipo, status, limite de
    // 500). Se uma solicitacao antiga do mesmo pedido ja foi resolvida e a
    // nova nao, sobra UMA na contagem — e a heuristica "pedido com uma so"
    // a descartava por causa da NF da outra. O caso fiscal novo sumia.
    //
    // A contagem sempre seria enganosa, porque so enxerga o que passou pelo
    // filtro. Entao abandonei a heuristica: comparo a chave DAQUELA
    // solicitacao com as ja resolvidas, e pronto.
    // b189 - o MAGALU entra DEPOIS do descarte por solicitacao resolvida.
    //
    // Aquele descarte compara com as triagens da tabela `devolucoes`, que e
    // do fluxo de bipe — os cancelados do Magalu nao passam por ali, entao
    // filtrar por aquele conjunto so os removeria por engano.
    // b189.1 - O MAGALU TAMBEM PRECISA DO DESCARTE, so que por PEDIDO.
    //
    // Caso real que o dono trouxe: o pedido 1554870118013124 (Antonio, NF
    // 076466) voltou fisicamente, o Lucas triou esta semana, e ele ja
    // aparece em "Aprovadas aguardando NF" com o botao de gerar. Se
    // aparecesse aqui tambem, seriam DUAS portas pra mesma nota — e duas
    // devolucoes emitidas sem ninguem perceber.
    //
    // O descarte fino acima compara chaves do TikTok (id da solicitacao ou
    // rastreio) e nao serve pro Magalu. Mas o PEDIDO serve: se ha triagem
    // daquele pedido, ele ja esta no fluxo normal.

    // b195 - A BUSCA DO MAGALU TINHA SUMIDO.
    //
    // O painel da GOOD respondia "magaluItens is not defined": em alguma
    // edicao anterior o bloco que POPULA a lista foi perdido e sobraram so
    // os comentarios. A rota inteira quebrava, e o dono via o card vermelho.
    //
    // Falha aqui nao pode derrubar a lista: o TikTok continua aparecendo,
    // com o aviso do que faltou.
    let magaluItens = [];
    let magaluErro = null;
    try {
      // b195.1 (Codex): respeitar ?de= e ?ate= quando vierem. O TikTok ja
      // respeitava; o Magalu ignorava e sempre terminava hoje — entao pedir
      // uma fatia antiga trazia o Magalu do periodo errado.
      // b195.4: reaproveita as datas ja VALIDADAS acima
      const atePedido = ateValido ? atePedidoRaw : '';
      const dePedido = deValido ? dePedidoRaw : '';
      // b195.2 (Codex): com `?ate=` antigo e sem `?de=`, a janela abria HOJE
      // menos `dias` e fechava numa data passada — podia nem se cruzar.
      // Ancoro o inicio no PROPRIO corte pedido.
      const fimJanela = atePedido || new Date().toISOString().slice(0, 10);
      const inicioJanela = dePedido
        || new Date(new Date(fimJanela + 'T12:00:00Z').getTime() - dias * 864e5)
          .toISOString().slice(0, 10);
      const rm = await magaluCancelados.buscar(empresa, { de: inicioJanela, ate: fimJanela });
      if (rm.ok) magaluItens = rm.itens;
      else magaluErro = rm.erro;
    } catch (e) {
      magaluErro = String(e.message || e).slice(0, 150);
    }

    const pedidosMagalu = magaluItens.map((m) => m.pedido).filter(Boolean);
    const triadosSemMarcador = new Set();   // triagem de BIPE: derruba o pedido
    const casosRegistrados = new Set();     // registro do CARD: derruba so o caso
    if (pedidosMagalu.length) {
      for (let i = 0; i < pedidosMagalu.length; i += 200) {
        const { data: tri, error: erroTri } = await supabase
          .from('devolucoes')
          // b193.1 (Codex): `problema_descricao` E LIDO logo abaixo pra achar
          // o marcador `[caso:X]`. Sem ele no select, o campo vinha undefined
          // e TODO registro parecia triagem de bipe — o conserto dos irmaos
          // nao funcionava, e voltavam a sumir todos.
          .select('order_id, problema_descricao')
          .in('order_id', pedidosMagalu.slice(i, i + 200));
        if (erroTri) {
          // mesma regra do descarte do TikTok: falhar e melhor que listar
          // caso ja resolvido, que faria emitir NF duplicada
          return res.status(500).json({
            ok: false,
            erro: 'nao consegui conferir quais pedidos do Magalu ja foram triados: '
              + erroTri.message + ' — listar sem essa checagem mostraria casos ja no fluxo normal',
          });
        }
        // b190.2 (Codex): VOLTEI PRO DESCARTE POR PEDIDO — e o SKU nao serve.
        //
        // Eu tinha passado a casar PEDIDO+SKU pra nao derrubar o outro item
        // de uma nota com varios produtos. A revisao mostrou que o dado nao
        // suporta isso: `public/js/triagem.js` grava SEMPRE `nf.itens[0].sku`
        // e a quantidade SOMADA de todos os itens.
        //
        // Ou seja, na nota do Antonio (076466, dois SKUs) a triagem gravou
        // KJDDE-693-8 com qtd 4, independentemente do que o Lucas triou. Meu
        // casamento por SKU compararia com um valor que nao descreve o item
        // devolvido — e deixaria na lista um item JA resolvido, ou tiraria o
        // errado.
        //
        // Com dado errado, o descarte mais LARGO e o mais seguro: se ha
        // qualquer triagem daquele pedido, ele ja esta no fluxo normal e o
        // dono resolve tudo por la. Perde-se granularidade; nao se perde a
        // garantia de nao emitir NF duplicada, que e o que importa aqui.
        //
        // ⏳ DIVIDA REGISTRADA: a triagem deveria gravar o item que
        // realmente voltou. Enquanto nao gravar, nenhum consumidor desse
        // dado pode confiar no SKU de nota multi-item.
        // b193: separo o que veio do CARD (tem `[caso:X]`) do que veio do
      // BIPE. O primeiro derruba so aquele caso; o segundo, o pedido todo.
      for (const t of (tri || [])) {
        const desc = String(t.problema_descricao || '');
        const m = desc.match(/\[caso:([^\]]+)\]/);
        if (m) casosRegistrados.add(m[1]);
        else triadosSemMarcador.add(String(t.order_id));
      }
      }
    }

    // b193 (Codex): registrar UM caso do Magalu nao pode sumir com os IRMAOS.
    //
    // O descarte era por pedido. Assim que o dono clicasse em gerar num
    // pedido com varias notas, TODAS sumiam da lista — inclusive as que
    // ainda nao tem NF de devolucao. Ele nao teria como voltar nelas.
    //
    // Agora o registro criado pelo card carrega `[caso:X]`, entao dou
    // preferencia a essa chave. Triagem SEM marcador (a de bipe normal)
    // continua derrubando o pedido todo: ali o produto voltou de verdade e
    // o caso ja esta no fluxo.
    const itens = semRetorno
      .filter((d) => {
        const chaveDela = String(d.chave_marketplace || d.id || '');
        // b199.7 (Codex): o registro do CARD tambem tira o caso da lista.
        //
        // `resolvidosFinos` so pega quem JA tem NF de devolucao emitida —
        // um caso do TikTok registrado pelo lote continuava aparecendo, e o
        // dono registraria de novo achando que nao funcionou.
        if (casosRegistrados.has(chaveDela)) return false;
        if (casosRegistrados.has(String(d.pedido || ''))) return false;
        return !resolvidosFinos.has(chaveDela);
      })
      .concat(magaluItens.filter((m) => {
        // b194.1 (Codex): reconhecer TAMBEM o id antigo. Registros feitos
        // antes de o numero ser corrigido tem o id velho em `[caso:X]`; sem
        // isto eles ficariam orfaos e o caso voltaria como pendente, com
        // risco de o dono emitir uma segunda NF.
        if (casosRegistrados.has(String(m.id))) return false;
        if (m.id_legado && casosRegistrados.has(String(m.id_legado))) return false;
        // b194.2 (Codex): havia DOIS formatos antigos de id, e cobrir so um
        // deixaria o outro orfao — que e o problema que este campo veio
        // resolver.
        if (m.id_legado2 && casosRegistrados.has(String(m.id_legado2))) return false;
        return !triadosSemMarcador.has(String(m.pedido));       // triagem de bipe
      }))
      .map((d) => {
        // b184 (Codex): O RELOGIO CONTA DA EMISSAO DA NOTA, nao da devolucao.
        //
        // A devolucao nasce dias (as vezes semanas) depois da venda. Contar
        // dali dava MAIS prazo do que existe: um caso com nota de 25 dias
        // atras e devolucao de 3 apareceria como "cancelavel", e o
        // cancelamento seria recusado com 501 na cara do dono.
        //
        // A CHAVE DA NF-e carrega a competencia nas posicoes 2-5 (AAMM), e
        // a captura ja guarda a chave. Uso o mes da chave como base, com a
        // devolucao de reserva quando nao ha chave.
        //
        // Ainda e aproximacao — a chave da o MES, nao o dia. Assumo o dia 1,
        // que e a leitura mais CONSERVADORA: mostra menos prazo do que pode
        // haver, nunca mais.
        let base = null;
        let baseOrigem = null;

        // b189 - o MAGALU traz a DATA EXATA de emissao (`nf_emitida_em`), e
        // ela e melhor que a chave: a chave so da o mes, e eu assumo dia 1
        // pra errar pro lado seguro. Com a data real, o prazo e o real.
        if (d.nf_emitida_em) {
          const t = new Date(d.nf_emitida_em).getTime();
          if (Number.isFinite(t)) { base = t; baseOrigem = 'data_emissao'; }
        }

        const chave = String(d.nf_chave || '').replace(/\D/g, '');
        if (base == null && chave.length === 44) {
          const aa = parseInt(chave.slice(2, 4), 10);
          const mm = parseInt(chave.slice(4, 6), 10);
          if (aa >= 0 && mm >= 1 && mm <= 12) {
            // b184.1 (Codex): a chave da o MES, nao o dia. Uma nota emitida
            // dia 28 apareceria com 27 dias a mais de idade do que tem.
            //
            // Buscar a data exata no Bling seria uma chamada por item — o
            // painel ficaria lento pra ganhar precisao num campo que ele
            // confere antes de agir de qualquer forma.
            //
            // Entao: uso o dia 1 (a nota tem NO MAXIMO essa idade), mas so
            // ofereco CANCELAR quando ate o ULTIMO dia do mes ainda estaria
            // no prazo. Assim nunca sugiro cancelar algo ja intempestivo;
            // no maximo deixo de sugerir num caso que ainda daria — e ai o
            // dono decide olhando o Bling.
            base = Date.UTC(2000 + aa, mm - 1, 1);
            baseOrigem = 'chave_nfe';
          }
        }
        // b195.5 (Codex): o Magalu traz `cancelado_em`, que e MUITO mais
        // perto da emissao que a data da captura. Sem isto, um caso do
        // Magalu sem chave caia em `criado_no_mkt` — que pode ser de hoje,
        // dando prazo de cancelamento que nao existe.
        if (base == null && d.cancelado_em) {
          const t = new Date(d.cancelado_em).getTime();
          if (Number.isFinite(t)) { base = t; baseOrigem = 'evento_magalu'; }
        }
        if (base == null && d.criado_no_mkt) {
          base = new Date(d.criado_no_mkt).getTime();
          baseOrigem = 'devolucao';   // aproximacao: da MAIS prazo que o real
        }

        const diasDesde = base ? Math.floor((AGORA - base) / 864e5) : null;

        // b184.1: quando a base e o mes da chave, o dia real pode ser ate 30
        // dias depois. Pra NUNCA sugerir cancelamento intempestivo, exijo que
        // o pior caso (dia 1) ainda esteja no prazo.
        //
        // b190.3 (Codex): E QUEM JA VOLTOU NAO CANCELA.
        //
        // Se o produto retornou (classe `estornado_apos_envio` do Magalu, ou
        // devolucao registrada), cancelar a nota de venda seria errado: houve
        // circulacao de mercadoria, ida e volta. O caminho ali e a NF de
        // DEVOLUCAO, que documenta a entrada. Cancelar apagaria uma operacao
        // que existiu de verdade.
        const jaVoltou = !!d.tem_devolucao_registrada;

        // b190.6 (Codex): CANCELAMENTO EXIGE PROVA DE QUE NAO SAIU.
        //
        // Eu escrevi no proprio modulo que "sem returns[] nao prova que o
        // produto nao saiu" — e depois sugeri cancelar mesmo assim. Se a
        // mercadoria circulou e o cliente ficou com ela, cancelar a nota de
        // venda e erro fiscal: apaga uma saida que existiu.
        //
        // Do lado do Magalu eu NAO tenho essa prova: a API de pedidos nao
        // diz se despachamos. Quem diz e a etiqueta do checkout, que mora no
        // outro servidor (a conversa do Checkout esta ligando essa ponta).
        //
        // Entao, ate ter a prova, o Magalu nunca ganha "cancelar NF" — vai
        // como NF de devolucao, que e valida nos dois casos. Errar pra
        // devolucao custa um passo a mais; errar pra cancelamento custa uma
        // nota cancelada indevidamente.
        //
        // O TikTok continua podendo: ali o reembolso PURO (tipo REFUND) e a
        // propria prova de que nao houve retorno fisico.
        // b195.3 (Codex): o `nf_sem_saida` E a prova de que nao saiu.
        //
        // Eu bloqueava TODO Magalu de cancelar por falta de prova de envio.
        // Mas essa classe existe justamente porque a Magalu diz que o pedido
        // NUNCA foi despachado (sem `shipped_at`) — e a propria lib a marca
        // como `pode_cancelar`. Bloquear ali contradiz a classificacao e faz
        // o dono perder o prazo de 20 dias num caso onde cancelar e o certo.
        //
        // As outras classes do Magalu continuam sem cancelar: nelas o
        // produto saiu, houve circulacao, e a nota nao pode ser apagada.
        const semProvaDeEnvio = d.marketplace === 'magalu'
          && d.classe !== 'nf_sem_saida';
        // b195.6 (Codex): CANCELAR exige data CONFIAVEL da nota.
        //
        // `cancelado_em` e `criado_no_mkt` sao datas do EVENTO, nao da
        // emissao. Uma venda de maio cancelada ontem daria "3 dias" e eu
        // ofereceria cancelar uma nota vencida ha meses — o dono tentaria e
        // levaria 501 intempestivo.
        //
        // So a data de emissao (Magalu) e o mes da chave (NF-e) dizem quando
        // a nota saiu. Sem uma das duas, o caminho e a devolucao, que vale
        // em qualquer prazo.
        const dataConfiavel = baseOrigem === 'data_emissao' || baseOrigem === 'chave_nfe';
        const podeCancelar = dataConfiavel && !jaVoltou && !semProvaDeEnvio
          && diasDesde != null && diasDesde <= 20;

        return {
          id: d.id,
          marketplace: d.marketplace,
          // b188 - o card precisa disto pra abrir o modal de gerar NF, o
          // mesmo do bloco "Aprovadas". Sem o id do Bling o modal nao sabe
          // de qual nota gerar a devolucao.
          nf_id_bling: d.nf_id_bling || null,
          pedido: d.pedido,
          nf_numero: d.nf_numero,
          nf_chave: d.nf_chave,
          cliente: d.cliente_nome,
          produto: d.produto_titulo,
          sku: d.produto_sku,
          qtd: d.produto_qtd,
          // b195.1 (Codex): o TikTok manda `valor_refund`, o Magalu manda
          // `valor`. Lendo so o primeiro, TODO card do Magalu vinha com
          // valor nulo — foi o que o dono viu no JSON da AMB ("valor: null"
          // nos 10) e o `valor_total` ficava zero, inutil pra priorizar.
          valor: d.valor_refund != null ? d.valor_refund : d.valor,
          motivo: d.motivo_texto || d.motivo,
          criado_em: d.criado_no_mkt,
          dias_desde: diasDesde,
          // o que fazer: cancelar (se no prazo) ou NF de devolucao
          acao: podeCancelar ? 'cancelar_nf' : 'nf_devolucao',
          prazo_cancelamento: podeCancelar ? Math.max(0, 20 - diasDesde) : 0,
          // de onde veio a data usada no relogio — a tela avisa quando e
          // aproximacao, pra ele conferir antes de tentar cancelar
          prazo_base: baseOrigem,
          // b199.5 (Codex): as datas de ORIGEM vao no item — o payload do
          // card as leva pro modal, e sem elas a trava de NF duplicada nao
          // consegue procurar a nota.
          nf_emitida_em: d.nf_emitida_em || undefined,
          criado_no_mkt: d.criado_no_mkt || undefined,
          // b189 - o Magalu tem uma classe (`estornado_apos_envio`) em que a
          // devolucao EXISTE: o produto voltou. Nao e "sem retorno", e o
          // card precisa dizer isso — senao ele emitiria NF de devolucao
          // pra mercadoria que ja voltou pelo fluxo normal.
          classe: d.classe || undefined,
          tem_devolucao_registrada: d.tem_devolucao_registrada || undefined,
          // b193.2 (Codex): `entrada_estoque` e `prejuizo_integral` sao LIDOS
          // no card (a dica de deposito e a tarja vermelha) mas eu nunca os
          // repassava — chegavam undefined, entao o aviso de "escolha
          // DEFEITO" nunca aparecia justamente onde importa: a mercadoria
          // que ficou com o cliente.
          entrada_estoque: d.entrada_estoque,
          id_legado: d.id_legado || undefined,     // b194.1 - casar registro antigo
          id_legado2: d.id_legado2 || undefined,   // b194.2 - o outro formato antigo
          prejuizo_integral: d.prejuizo_integral || undefined,
          // b190.5 (Codex): o marcador de rateio tem que CHEGAR na tela.
          // Eu calculava em magalu-cancelados.js e nao repassava — o dono
          // veria R$ 250 achando que e o valor daquela nota, quando e o do
          // pedido dividido pelas notas.
          valor_rateado: d.valor_rateado || undefined,
          valor_pedido: d.valor_pedido || undefined,
        };
      });

    // b188 - COMPLETAR O ID DA NF NO BLING.
    //
    // A captura guarda o numero e a chave, mas o modal de gerar devolucao
    // precisa do id interno do Bling. Sem ele, o botao abriria sem saber de
    // qual nota gerar — e o dono teria que caçar a nota a mao, que e
    // exatamente o trabalho que este painel veio evitar.
    //
    // Busco so pros que tem numero, em serie e com teto: sao poucos itens
    // (a GOOD tinha 1) e uma falha aqui nao pode derrubar a lista — o card
    // aparece sem o botao, com o numero da NF pra ele achar no Bling.
    // b188.1 (Codex): CASAR PELA CHAVE quando ela existe.
    //
    // O numero da NF se repete entre SERIES (a serie 1 e a serie 2 podem ter
    // uma nota 002070 cada). Casar so pelo numero pode trazer a nota errada
    // — e mandar o dono pra nota de outra venda.
    //
    // Tambem limitei a 15 e adicionei teto de tempo: com a janela de 365
    // dias a fila pode crescer, e 30 buscas em serie no Bling seguram a
    // resposta do painel. Quem ficar sem o id aparece com o numero da NF.
    const INICIO_BUSCA = Date.now();
    // b192 - teto de 25: com o Magalu junto a fila cresceu (10 casos so
    // dele na GOOD). O teto de TEMPO abaixo continua sendo a trava real —
    // ele para quando o painel comeca a demorar, seja qual for a contagem.
    // b192.2 (Codex): RESERVAR VAGA PRO MAGALU.
    //
    // A lista vem ordenada por acao e valor, e o TikTok tende a ficar na
    // frente. Cortando os 25 primeiros, numa fila cheia de TikTok o Magalu
    // nao entraria — e sao os casos de maior valor (R$ 12.704 contra R$ 1
    // caso do TikTok na GOOD). Divido a cota entre os dois.
    // b202: a busca por CHAVE roda DEPOIS da direta, e so pra quem sobrou.
    // Ela pagina, entao e o plano B — nao a porta de entrada.
    // b204.2 (Codex): o cache roda antes de TODAS as filas.
    //
    // Eu tinha movido pra antes de `comNumero`, mas `semVinculo`, `doMagalu`
    // e `dosOutros` sao montadas ANTES disso — entao os casos ja resolvidos
    // seguiam nelas, consumiam as vagas e eram re-buscados a cada refresh.
    //
    // Conferi a ordem inteira desta vez, nao so a fila que o apontamento
    // citou: as tres filas nascem aqui, entao o cache vem antes delas.
    vinculoCache.aplicar(itens, empresa);

    const semVinculo = itens.filter((x) => x.nf_numero && !x.nf_id_bling);
    const doMagalu = semVinculo.filter((x) => x.marketplace === 'magalu').slice(0, 15);
    const dosOutros = semVinculo.filter((x) => x.marketplace !== 'magalu').slice(0, 10);
    // b196 - BUSCAR PELO PEDIDO quando nao ha numero nem chave.
    //
    // Caso real que o dono trouxe: o pedido 583529996785714778 (TikTok,
    // R$ 189,10) aparecia como "sem NF vinculada", mas a nota EXISTE no
    // Bling — ele abriu e mostrou. A captura veio sem numero e sem chave
    // porque a API do TikTok nao mandou (`return_line_items` vazio, sem
    // buyer, sem sku — devolucao de abril, o TikTok ja nao guarda detalhe).
    //
    // Mas o PEDIDO eu tenho, e `buscarNFnoBlingPorOrderId` acha por ele.
    // Sem isto, o card mostra um caso acionavel que ninguem consegue
    // acionar.
    // b202 - O FILTRO DIRETO PRIMEIRO, pra QUEM TIVER PEDIDO.
    //
    // O dono mandou o JSON: 25 casos do Magalu, todos com chave e todos com
    // `nf_id_bling: null`. A conta explica — eles caiam na busca por CHAVE,
    // que PAGINA no Bling, e o teto de 8s nao dava pros 15 da cota.
    //
    // Mas o filtro direto por `numeroLoja` resolve em UMA chamada, e esses
    // casos tem pedido. Eu so nao usava porque a fila exigia "sem numero E
    // sem chave" — uma condicao que fazia sentido antes de o filtro direto
    // existir, e que ficou pra tras quando ele chegou.
    //
    // Agora TODO caso sem vinculo tenta o direto primeiro. A busca por
    // chave (lenta) fica pra quem o direto nao achar.
    // b203 - PELA NOTA primeiro; o pedido e reserva.
    //
    // [stated] "pq vc fica indo atrás de pedido. pode ser q algum pedido
    // esteja com erro, não tenha, por ter sido importado XML do full. vc
    // tinha q tá pegando nota fiscal. nf sim sempre terá."
    //
    // Ele esta certo, e isso explica por que o TikTok funcionou e o Magalu
    // nao: o TikTok veio SEM numero (fui pelo pedido, e havia pedido), e os
    // 25 do Magalu tem numero e chave — a ponta firme, que eu ignorava.
    //
    // Ordem agora:
    //   1. filtro direto por NUMERO (uma chamada; a nota sempre existe)
    //   2. filtro direto por PEDIDO (pros que vieram sem numero, tipo o TikTok)
    //   3. busca por chave, paginando (plano B)


    const comNumero = vinculoCache.fila(itens, empresa, 25, (x) => x.nf_numero);
    const semNota = vinculoCache.fila(itens, empresa, 25, (x) => !x.nf_numero && x.pedido);



    let buscadas = 0;
    for (const item of comNumero) {
      // b204.1: a identidade de ANTES do enriquecimento — o refresh
      // seguinte le a linha crua e procura por ela.
      const idCache = vinculoCache.chaveDe(item, empresa);
      // b204 - a fase do NUMERO para aos 6s, nao aos 10.
      //
      // Com 24 itens, so as pausas somavam 8s e a fase da CHAVE — que e a
      // EXATA — nunca chegava a rodar. Reservo os ultimos segundos pra ela:
      // e ela quem resolve quando o numero devolve nota de outra serie.
      //
      // O que nao couber vincula no proximo refresh, pelo cache.
      if (Date.now() - INICIO_BUSCA > 6000) break;
      // b203.1 (Codex): RITMO. O Bling limita a 3 req/s, e sao ate 25 itens
      // seguidos aqui. Sem pausa, os primeiros levam 429 e o retry de 1,5s
      // de cada um come o orcamento inteiro — os ultimos nem sao tentados.
      if (buscadas > 0) await new Promise((ok) => setTimeout(ok, 350));
      buscadas++;
      try {
        const r = await Promise.race([
          buscarNFnoBlingPorNumero(item.nf_numero, item.nf_emitida_em || item.criado_em || null,
            { maxPaginas: 2 }),   // o filtro direto resolve; paginar e so a reserva
          new Promise((ok) => setTimeout(() => ok(null), 4000)),
        ]);
        const achada = (r && r.match) || null;
        // b203.1 (Codex): CONFERIR A CHAVE quando eu tenho as duas.
        //
        // Numero de NF se repete entre SERIES. A busca devolve a mais
        // recente, e sem comparar a chave eu aceitaria a nota de outra serie
        // — e o dono geraria a devolucao contra a venda errada.
        //
        // So aceito de olhos fechados quando nao ha chave pra comparar.
        // b203.2 (Codex): chave AUSENTE nao e chave que bate.
        //
        // A listagem do /nfe pode voltar SEM `chaveAcesso` — esta
        // documentado no proprio repo (b166.4, public/js/busca.js). Minha
        // condicao tratava isso como "conferiu", e eu aceitava a nota mais
        // recente com aquele numero, que pode ser de OUTRA SERIE.
        //
        // Agora: se eu TENHO a chave do item, ela precisa BATER de verdade.
        // Sem chave na resposta, o vinculo nao e confirmado — o caso fica
        // pra fase da chave, que e exata.
        const chaveItem = String(item.nf_chave || '').replace(/\D/g, '');
        const chaveAchada = String(achada && achada.chaveAcesso || '').replace(/\D/g, '');
        const chaveBate = chaveItem
          ? (chaveAchada === chaveItem)          // tenho chave: tem que bater
          : true;                                 // sem chave: o numero e o que ha
        if (achada && achada.id && chaveBate) {
          item.nf_id_bling = String(achada.id);
          if (!item.nf_chave && achada.chaveAcesso) item.nf_chave = achada.chaveAcesso;
          item.nf_achada_por = (r && r.via === 'filtro_direto_numero') ? 'numero' : 'numero_varredura';
          vinculoCache.guardar(item, item.nf_id_bling, 'numero', { chave: item.nf_chave, numero: item.nf_numero }, empresa, idCache);
        }
        if (!item.nf_id_bling) vinculoCache.marcarFalha(item, empresa);
      } catch (e) { /* cai nos caminhos abaixo */ }
    }

    const PARA_BUSCAR = doMagalu.concat(dosOutros);
    // b202 - O RAPIDO PRIMEIRO.
    //
    // O dono mandou o JSON: 25 casos do Magalu, todos com chave e todos com
    // `nf_id_bling: null`. A ordem explicava — o laco LENTO (que pagina o
    // Bling procurando pela chave) rodava antes e gastava os 8s do
    // orcamento, entao o filtro direto nem chegava a ser tentado.
    //
    // Invertido: o filtro direto por `numeroLoja` resolve em UMA chamada e
    // roda primeiro, pra TODOS que tem pedido. O que ele nao achar cai na
    // busca por chave, que agora e o plano B de verdade.
for (const item of semNota) {
      // b204.1: a identidade de ANTES do enriquecimento — o refresh
      // seguinte le a linha crua e procura por ela.
      const idCache = vinculoCache.chaveDe(item, empresa);
      if (Date.now() - INICIO_BUSCA > 12000) break;   // teto proprio, mais folgado
      try {
        const r = await Promise.race([
          // b197.2: a data da EMISSAO, quando existe, e melhor que a do
          // evento — a janela fica centrada na nota, nao na devolucao.
          buscarNFnoBlingPorOrderId(
            item.pedido,
            item.nf_emitida_em || item.criado_em || null,
            { maxPaginas: 12, paginasPorFatia: 2, delayMs: 450 }),
          // b197.4: o alcance tem que caber no PRAZO.
          //   12 paginas x 450ms + latencia = ~9,8s, dentro dos 14s
          //   2 paginas por fatia = 6 fatias de 20 dias = 120 dias
          // Com os 6 anteriores chegava a 40 dias — nao alcancava a venda
          // antiga. Fatia de 20 dias tem ~880 notas na densidade da GOOD, e
          // 2 paginas leem 200: pego as mais recentes de cada fatia, que e
          // onde a nota costuma estar.
          // b197.1 (Codex): 6 paginas cabem no prazo. Com 700ms entre
          // paginas, 12 nao caberiam em 6s — as ultimas nunca chegariam a
          // responder, e eu esperaria a toa.
          // b197.6 (Codex): o prazo e o que SOBRA do orcamento da rota, nao 14s
          // fixos. Se as buscas por chave/numero ja gastaram quase tudo, um
          // item lento aqui estouraria o teto e a resposta demoraria.
          new Promise((ok) => setTimeout(() => ok(null),
            Math.max(2000, Math.min(14000, 26000 - (Date.now() - INICIO_BUSCA))))),
        ]);
        const achada = (r && r.match) || (r && r.ok && r.nf) || null;
        if (achada && achada.id) {
          item.nf_id_bling = String(achada.id);
          if (!item.nf_numero && achada.numero) item.nf_numero = String(achada.numero);
          if (!item.nf_chave && achada.chaveAcesso) item.nf_chave = achada.chaveAcesso;
          // b204.3 (Codex): guardar tambem nesta fase
          vinculoCache.guardar(item, item.nf_id_bling, 'pedido',
            { chave: item.nf_chave, numero: item.nf_numero }, empresa, idCache);
          item.nf_achada_por = 'pedido';
          vinculoCache.guardar(item, item.nf_id_bling, 'pedido', { chave: item.nf_chave, numero: item.nf_numero }, empresa, idCache);   // pra tela dizer de onde veio
        }
      } catch (e) { /* segue sem a nota; o card continua so informativo */ }
    }

    // a busca por CHAVE, pro que o filtro direto nao resolveu
    for (const item of PARA_BUSCAR) {
      // b204.4 (Codex): PULAR quem ja foi resolvido. A lista foi montada
      // ANTES da fase do numero, entao pode conter itens que ela ja
      // vinculou — e `resolverIdNFPorChave` PAGINA, gastando o orcamento
      // dos que realmente precisam.
      if (item.nf_id_bling) continue;
      // b204.1: a identidade de ANTES do enriquecimento — o refresh
      // seguinte le a linha crua e procura por ela.
      const idCache = vinculoCache.chaveDe(item, empresa);
      if (Date.now() - INICIO_BUSCA > 8000) break;   // o painel nao pode travar
      try {
        // b192 - PELA CHAVE primeiro, quando ela existe.
        //
        // `resolverIdNFPorChave` usa a competencia e a serie que moram na
        // propria chave — mais preciso que o numero, que se repete entre
        // series. E e o que o Magalu me da: ele entrega a CHAVE, nem sempre
        // o numero (por isso todos os cards dele apareciam "sem NF").
        if (item.nf_chave) {
          try {
            // b192.1 (Codex): a busca por chave PAGINA no Bling e pode
            // passar dos 8s sozinha — o teto do laco so e conferido ENTRE
            // itens, entao uma unica busca lenta travaria o painel.
            // Corrida com um prazo proprio: perder o vinculo de um card e
            // melhor que segurar a tela toda.
            // b192.2 (Codex): o prazo e o QUE SOBRA do orcamento total, nao
            // 5s fixos. Com 5s fixos, a busca por chave podia consumir quase
            // tudo e a busca por numero logo abaixo comecaria ja no
            // estouro — duas buscas somando 10s num teto de 8.
            const sobra = Math.max(500, 8000 - (Date.now() - INICIO_BUSCA));
            const idPorChave = await Promise.race([
              resolverIdNFPorChave(item.nf_numero, item.nf_chave),
              new Promise((ok) => setTimeout(() => ok(null), Math.min(5000, sobra))),
            ]);
            if (idPorChave) {
              item.nf_id_bling = String(idPorChave);
              item.nf_achada_por = 'chave';
              vinculoCache.guardar(item, item.nf_id_bling, 'chave', { chave: item.nf_chave, numero: item.nf_numero }, empresa, idCache);
              continue;
            }
          } catch (e) { /* cai na busca por numero abaixo */ }
        }

        // b188.3 (Codex): a funcao devolve { ok, match }, NAO a nota direto.
        //
        // Eu lia `nf.id` de um objeto que nunca tem `id` — o link do card
        // nunca apareceria. Conferido em lib/bling.js: os tres retornos sao
        // { ok, match, ... }.
        //
        // E o teto de tempo vai DENTRO da chamada: ela pagina ate 50 paginas
        // com 400ms entre elas, entao UMA busca pode passar dos 8s sozinha —
        // conferir o relogio so no comeco do laco nao segura nada.
        const nf = await Promise.race([
          buscarNFnoBlingPorNumero(item.nf_numero, null, { maxPaginas: 8 }),
          new Promise((ok) => setTimeout(() => ok({ ok: false, timeout: true }), 6000)),
        ]);
        const achada = (nf && nf.ok && nf.match) ? nf.match : null;
        if (!achada || !achada.id) continue;

        // se eu tenho a chave, ela MANDA: numero repete entre series, chave nao
        const chaveEsperada = String(item.nf_chave || '').replace(/\D/g, '');
        const chaveAchada = String(achada.chaveAcesso || '').replace(/\D/g, '');
        if (chaveEsperada && chaveAchada && chaveEsperada !== chaveAchada) continue;

item.nf_id_bling = String(achada.id);
        if (!item.nf_chave && achada.chaveAcesso) item.nf_chave = achada.chaveAcesso;
        // b204.3 (Codex): a varredura de RESERVA e a mais cara de todas (8
        // paginas) e era refeita a cada refresh. Agora guarda.
        vinculoCache.guardar(item, item.nf_id_bling, 'numero_varredura',
          { chave: item.nf_chave, numero: item.nf_numero }, empresa, idCache);
      } catch (e) { /* segue sem o link; o numero da NF esta no card */ }
    }

    // b188.1 (Codex): RECALCULAR a acao depois de enriquecer.
    //
    // O prazo e calculado da chave da NF-e. Se a chave so apareceu agora
    // (veio do Bling na busca acima), o item foi classificado com a data da
    // devolucao — que da MAIS prazo do que existe. Sem recalcular, um caso
    // ja intempestivo ficaria marcado como "CANCELAR NF".
    for (const item of itens) {
      const chave = String(item.nf_chave || '').replace(/\D/g, '');
      // data exata manda sobre a chave (que so da o mes)
      if (chave.length !== 44 || item.prazo_base === 'chave_nfe'
          || item.prazo_base === 'data_emissao') continue;
      const aa = parseInt(chave.slice(2, 4), 10);
      const mm = parseInt(chave.slice(4, 6), 10);
      if (!(aa >= 0 && mm >= 1 && mm <= 12)) continue;
      const dias = Math.floor((AGORA - Date.UTC(2000 + aa, mm - 1, 1)) / 864e5);
      item.dias_desde = dias;
      item.prazo_base = 'chave_nfe';
      // b190.3: o recalculo respeita a mesma regra — quem voltou nao cancela
      const podeAqui = !item.tem_devolucao_registrada
        // b195.3: Magalu so cancela em `nf_sem_saida`, onde ha prova de
        // que o pedido nunca foi despachado
        && (item.marketplace !== 'magalu' || item.classe === 'nf_sem_saida')
        && dias <= 20;
      item.acao = podeAqui ? 'cancelar_nf' : 'nf_devolucao';
      item.prazo_cancelamento = podeAqui ? Math.max(0, 20 - dias) : 0;
    }

    // quem ainda da pra cancelar vem primeiro, e dentro disso o mais
    // urgente — e a unica parte com prazo correndo
    itens.sort((a, b) => {
      if (a.acao !== b.acao) return a.acao === 'cancelar_nf' ? -1 : 1;
      if (a.acao === 'cancelar_nf') return a.prazo_cancelamento - b.prazo_cancelamento;
      return (b.valor || 0) - (a.valor || 0);   // nos outros, o maior valor primeiro
    });

    return res.json({
      ok: true,
      empresa,
      total: itens.length,
      valor_total: Number(itens.reduce((t, x) => t + (Number(x.valor) || 0), 0).toFixed(2)),
      podem_cancelar: itens.filter((x) => x.acao === 'cancelar_nf').length,
      // b189 - se o Magalu nao veio, o dono TEM que saber: a lista parece
      // completa e nao esta. Silencio aqui esconde R$ 12 mil em casos.
      magalu_erro: magaluErro || undefined,
      // b195.3 (Codex): quando o Magalu falha, a lista que sobra e PARCIAL
      // e nao ha como saber disso olhando os itens. O aviso e o unico sinal.
      parcial: magaluErro ? true : undefined,
      por_marketplace: itens.reduce((acc, x) => {
        const m = x.marketplace || 'outro';
        acc[m] = (acc[m] || 0) + 1;
        return acc;
      }, {}),
      itens,
      // b188.2: a lista pode estar cortada — dizer, em vez de calar
      cortou_em: cortou ? LIMITE : undefined,
      aviso_corte: cortou
        ? 'A janela de ' + dias + ' dias trouxe o maximo de ' + LIMITE + ' registros: pode haver '
          + 'casos mais antigos fora desta lista. Use ?ate=AAAA-MM-DD pra ver os anteriores '
          + '(ou ?dias= menor pra estreitar).'
        : undefined,
      // b184 (Codex): quem CANCELA a nota nao gera NF de devolucao, entao a
      // checagem por nf_devolucao_id_bling nunca o tira da lista — ele
      // reapareceria pra sempre. Falta um jeito de marcar "resolvido por
      // cancelamento"; ate la, o aviso deixa isso explicito na resposta em
      // vez de o dono descobrir sozinho vendo o caso voltar.
      aviso_cancelados: 'Casos resolvidos por CANCELAMENTO da NF de venda ainda '
        + 'reaparecem aqui: a lista so sabe descartar quem ganhou NF de devolucao. '
        + 'Vale conferir no Bling antes de agir num item marcado como cancelavel.',
      leia: 'Vendas reembolsadas SEM devolucao fisica: o produto nao volta, mas a NF de venda '
        + 'continua gerando imposto. Ate 20 dias da pra CANCELAR a nota; depois, NF de devolucao. '
        + 'O deposito e o de DEFEITO — nao entra no estoque vendavel, porque a mercadoria nunca chegou.',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 200) });
  }
});

app.get('/api/admin/espreita', requerAdmin, async (req, res) => {
  const agora = Date.now();
  const forcar = req.query.fresh === '1';
  // cache quente e recente -> responde na hora, e atualiza em background
  if (!forcar && ESP_CACHE && (agora - ESP_CACHE_TS) < ESP_CACHE_TTL) {
    // dispara atualizacao em background (sem travar a resposta)
    if (!ESP_MONTANDO) {
      ESP_MONTANDO = montarEspreita()
        .then(r => { guardarCacheEspreita(r); })
        .catch(() => {})
        .finally(() => { ESP_MONTANDO = null; });
    }
    return res.json({ ...ESP_CACHE, _cache: true, _idade_seg: Math.round((agora - ESP_CACHE_TS) / 1000) });
  }
  // sem cache ou expirado -> monta agora (reaproveita a montagem em voo se houver)
  try {
    if (!ESP_MONTANDO) {
      ESP_MONTANDO = montarEspreita()
        .then(r => { guardarCacheEspreita(r); return r; })
        .finally(() => { ESP_MONTANDO = null; });
    }
    const r = await ESP_MONTANDO;
    return res.json({ ...(r || ESP_CACHE || { ok: false, erro: 'sem dados' }), _cache: false });
  } catch (e) {
    if (ESP_CACHE) return res.json({ ...ESP_CACHE, _cache: true, _stale: true });
    return res.status(500).json({ ok: false, erro: e.message });
  }
});
;// b298 - as rotas de DIAGNOSTICO deste trecho sairam pra lib/rotas-debug.js.
// Primeira fatia da quebra do server.js (5.369 linhas): comecei pelas de
// debug porque nao participam de nenhuma operacao — se eu errar aqui, nada
// que o galpao usa para de funcionar. As outras rotas de debug estao
// espalhadas pelo arquivo e vao em fatias seguintes, uma por vez.
const registrarRotasDebug = require('./lib/rotas-debug');
registrarRotasDebug(app, {
  requerAdmin, espreita, shopee, magalu, mlReturns,
  chamarBling, chamarML, sleep,
  // b299 (fatia 2)
  adminOk, buscarNFnoML, buscarPedidoBlingPorNumeroLoja,
  buscarPedidoBlingPorId, buscarNFePorId,
  buscarNFnoBlingPorOrderId, buscarNFnoBlingPorNumero,   // b300
  buscarNFsPorNumero,   // b300 - faltava desde a fatia 1
  supabase,   // b301 (fatia 3)
  construirIndiceProdutos, enriquecerEansEmBackground, normProd,   // b302 (fatia 4)
  requerEstoquista,   // b302 - middleware
  mlClient, nfNomes,   // b302
  ESP_ENTREGA, IDX_PROD, EAN_POR_SKU, EAN_PROGRESSO,   // b302 - estado compartilhado
  devCapturadas,                                       // v4.63 - captura
  capturaEstado: () => CAPTURA_ESTADO,                 //   e o estado do ultimo ciclo
  tiktokRevelia,                                       // v4.68 - janela de revelia
  // v4.70 - a rota de diagnostico precisa MONTAR o espreita antes de
  // capturar: o cache do painel nao serve, porque a captura recebe o
  // resultado da montagem, nao a lista que a tela mostra.
  forcarCaptura: async (limiteTikTok) => {
    // b185 (Codex): dizer NA CARA quando nao rodou, e por que.
    //
    // A funcao sai calada em tres casos (sem Supabase, ja rodando,
    // intervalo) — devolver undefined faria a rota responder "ok" sem ter
    // capturado nada, que e o oposto do motivo dela existir.
    if (!supabase) return { rodou: false, motivo: 'Supabase nao configurado' };
    if (CAPTURA_RODANDO) return { rodou: false, motivo: 'ja ha uma captura em andamento' };

    // b185.2 (Codex, 2a rodada no mesmo ponto): DESISTI de reaproveitar a
    // montagem em voo.
    //
    // A ideia era economizar uma varredura dos marketplaces. Mas quem
    // iniciou aquela montagem tambem chama a captura com o resultado, entao
    // eu precisava esperar o ciclo DELE terminar pra saber o que gravou — e
    // toda tentativa de sincronizar isso (esperar a trava, com teto) tinha
    // um furo: a trava pode nem ter sido pega ainda quando eu olho, ou o
    // teto estoura e eu respondo com estado de outro ciclo.
    //
    // Duas rodadas de revisao no mesmo ponto sao sinal claro: a otimizacao
    // nao vale a complexidade. Uma varredura a mais custa alguns segundos
    // numa rota de diagnostico que o dono chama de vez em quando; responder
    // resultado errado custa ele nao saber se funcionou, que e justamente o
    // problema que esta rota veio resolver.
    //
    // Se as duas correrem juntas, a minha cai na trava e volta com o motivo
    // — que e uma resposta honesta, nao um numero inventado.
    const r = await montarEspreita();

    // b185.3 (Codex): reconferir a trava DEPOIS da montagem.
    //
    // Montar leva segundos. Se o ciclo automatico (ou outro forcar) pegou a
    // trava nesse meio-tempo, capturarDevolucoes sai calada e eu devolveria
    // `gravacao: null` como se tivesse rodado. Melhor dizer que nao rodou,
    // com o motivo — o dono chama de novo em seguida.
    if (CAPTURA_RODANDO) {
      return { rodou: false, motivo: 'outra captura comecou enquanto eu montava o espreita' };
    }

    const gravou = await capturarDevolucoes(r, true, limiteTikTok);
    if (!gravou) {
      return { rodou: false, motivo: 'a captura nao chegou a gravar (trava ou intervalo)' };
    }
    return { rodou: true, gravacao: gravou };
  },
  get ESP_ENTREGA_RODANDO() { return ESP_ENTREGA_RODANDO; },   // b302 - flag viva, por getter
  get EAN_RODANDO() { return EAN_RODANDO; },
});

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

// v4.50 - CICLO DO ESTOQUE DE DEFEITOS (ficha, comentarios, pecas,
// pedidos do galpao, lancamento de estoque no Bling). Mesmo conjunto que
// roda na AMBTotal, adaptado pra forma da GOOD: recebe o app e o supabase
// cru, e a checagem de admin usa req.tipoUsuario ou a chave ?k=.
const registrarCicloDefeitos = require('./lib/defeitos-ciclo');
registrarCicloDefeitos(app, {
  supabase, requerLogin, chamarBling, adminOk,
  DEPOSITO_GERAL: process.env.GOOD_DEPOSITO_GERAL || '4956031259',   // v4.57 - Geral da GOOD
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
// v3.56 - MAGALU: indice pre-aquecido (o pacote chega e o sistema JA sabe).
// 20s apos o boot e a cada 25 min. Silencioso e a prova de falha.
setTimeout(() => magalu.preAquecer(), 20 * 1000);
setTimeout(() => mlReturns.preAquecer(), 30 * 1000);
setTimeout(() => nfNomes.preAquecer(), 40 * 1000);
// v4.04 - catalogo de produtos pre-aquecido (a busca do estoquista nunca espera)
setTimeout(() => { construirIndiceProdutos().catch(() => {}); }, 70 * 1000);
// v4.20 - a busca da data REAL de entrega roda sozinha, em ciclo proprio.
// Antes so era disparada quando alguem abria o painel - e como o indice do ML
// zera a cada deploy e leva ~2 min pra montar, o cache nunca enchia e o alerta
// seguia contando pela data errada (8 dias no lugar de 11).
function cicloDatasEntrega() {
  try {
    const r = mlReturns.resumoEspreita();
    if (!r || !r.quente) return;
    const pendentes = (r.entregues || []).filter(d => d.shipment_devolucao && !ESP_ENTREGA.has(String(d.shipment_devolucao)));
    if (pendentes.length) {
      console.log(`[ALERTA] buscando data de entrega de ${pendentes.length} devolucao(oes)...`);
      dispararDatasEntrega(pendentes);
    }
  } catch (e) { /* tenta de novo no proximo ciclo */ }
}
setTimeout(cicloDatasEntrega, 3 * 60 * 1000);
setInterval(cicloDatasEntrega, 5 * 60 * 1000);
setTimeout(() => { if (magalu.cfg.autorizado) espreita.preAquecer(); }, 50 * 1000);
setInterval(() => magalu.preAquecer(), 25 * 60 * 1000);
setInterval(() => mlReturns.preAquecer(), 25 * 60 * 1000);
setInterval(() => nfNomes.preAquecer(), 25 * 60 * 1000);
setInterval(() => { if (magalu.cfg.autorizado) espreita.preAquecer(); }, 25 * 60 * 1000);

// v4.51 - pre-aquece o RESULTADO FINAL do a espreita (o painel montado), pra
// abrir instantaneo. 90s apos o boot (depois dos componentes) e a cada 3 min.
function preAquecerEspreita() {
  if (ESP_MONTANDO) return;
  ESP_MONTANDO = montarEspreita()
    .then(r => {
      guardarCacheEspreita(r);
      capturarDevolucoes(r);   // v4.63 - de quebra, GUARDA (ver abaixo)
    })
    .catch(() => {})
    .finally(() => { ESP_MONTANDO = null; });
}
setTimeout(preAquecerEspreita, 90 * 1000);
setInterval(preAquecerEspreita, 3 * 60 * 1000);

// ============================================================
// v4.63 - CAPTURA DAS DEVOLUCOES  (ideia do dono, 29/08)
//
//   "tinha q ter um cron a meia noite pra pegar esses dados
//    previamente, ate pq a devolucao sempre demora mais q 1 dia
//    pra chegar ate nos"
//
// Nao criei cron novo: o "a espreita" JA varre ML, Shopee e Magalu a
// cada 3 minutos. O que faltava nao era buscar, era GUARDAR — ele
// remontava tudo do zero e vivia so em memoria, entao reiniciou,
// perdeu. Aqui a gente pega a lista que ele acabou de montar e grava.
//
// Gravar de 3 em 3 minutos seria desperdicio (o upsert repetiria as
// mesmas linhas), entao a captura tem seu proprio ritmo: uma vez a cada
// CAPTURA_INTERVALO_MS, e uma logo no primeiro ciclo depois do boot —
// assim uma reinicializacao no meio da madrugada nao pula o dia.
// ============================================================
const CAPTURA_INTERVALO_MS = 60 * 60 * 1000;   // de hora em hora
let CAPTURA_ULTIMA = 0;
let CAPTURA_RODANDO = false;
let CAPTURA_ESTADO = { ultima: null, gravadas: 0, erro: null };

// b186 - quantas devolucoes do TikTok puxar por ciclo. 200 cobre o
// corrente com folga; o forcar pode pedir mais pra carga historica.
const LIMITE_TIKTOK_PADRAO = 200;

function capturarDevolucoes(resultadoEspreita, forcar, limiteTikTok) {
  const LIMITE_TIKTOK = Math.min(1000, Math.max(1, parseInt(limiteTikTok, 10) || LIMITE_TIKTOK_PADRAO));
  // v4.70 - `forcar` pula o intervalo de 1h, pra rota de diagnostico e pra
  // primeira carga. A trava de concorrencia NAO e pulada: duas capturas
  // juntas duplicariam o trabalho e brigariam pelo mesmo upsert.
  if (!supabase) { CAPTURA_ESTADO = { ...CAPTURA_ESTADO, erro: 'Supabase nao configurado' }; return; }
  if (CAPTURA_RODANDO) return;
  if (!forcar && Date.now() - CAPTURA_ULTIMA < CAPTURA_INTERVALO_MS) return;

  // b184.2 (Codex): o campo e `em_transito`, nao `itens`.
  //
  // montarEspreita() devolve { em_transito, atrasadas_30d, nunca_bipadas, ... }
  // e eu lia `.itens`, que nao existe — entao a captura gravava ZERO desde
  // que subiu, calada. E o painel de estornadas consultaria uma tabela vazia.
  const lista = (resultadoEspreita && (resultadoEspreita.em_transito || resultadoEspreita.itens)) || [];

  // b184.3 (Codex): NAO sair quando os outros 3 vierem vazios.
  //
  // O TikTok nao passa pelo espreita — vem pela ponte. Se Magalu, ML e
  // Shopee nao tiverem nada em transito (um dia calmo, ou uma falha la),
  // eu saia aqui e o TikTok nunca era capturado. E justamente o TikTok que
  // alimenta o painel de estornadas sem retorno.

  CAPTURA_RODANDO = true;
  CAPTURA_ULTIMA = Date.now();

  const linhas = lista
    .map((d) => devCapturadas.traduzir(d, 'good'))
    .filter(Boolean);

  // b184.2 (Codex): o espreita cobre Magalu, ML e Shopee — o TikTok NAO
  // passa por ele (vem pela ponte com o Mover-Pedidos). Sem isto, a tabela
  // nunca teria devolucao do TikTok, e o painel de estornadas sem retorno
  // — que existe justamente pros reembolsos puros do TikTok — ficaria
  // eternamente vazio.
  // b184.3 (Codex): falha da ponte NAO pode virar "zero devolucoes do
  // TikTok" em silencio — e o mesmo erro que custou uma noite com a
  // Shopee. Ela nao derruba a captura dos outros 3, mas fica registrada
  // no estado, que a rota de acompanhamento mostra.
  let erroTikTok = null;
  // b186: 200 por ciclo cobre o corrente com folga (a Girassol tem 99 em 6
  // meses). Pra carga historica, o `limite` sobe pela rota de forcar — mas
  // sem paginacao de verdade: a rota do outro servico devolve o que tem
  // guardado, entao um limite alto ja traz tudo numa chamada.
  const comTikTok = tiktokPonte.sondaDevolucoes('good', { limite: LIMITE_TIKTOK })
    .then((r) => {
      if (!r || !r.ok) {
        erroTikTok = (r && r.erro) || 'ponte indisponivel';
        return [];
      }
      if (!r.cru || !Array.isArray(r.cru.devolucoes)) {
        erroTikTok = 'a ponte respondeu sem a lista de devolucoes';
        return [];
      }
      return r.cru.devolucoes
        .map((d) => devCapturadas.traduzir(tiktokDev.normalizar(d, 'good'), 'good'))
        .filter(Boolean);
    })
    .catch((e) => { erroTikTok = e.message || String(e); return []; });

  // b185 (Codex): a cadeia inteira e devolvida, pra quem forcou poder
  // ESPERAR o fim e ver o que foi gravado. Antes eu devolvia a promessa mas
  // ela resolvia depois do .finally, entao a rota respondia com null.
  return comTikTok.then((extras) => devCapturadas.guardar(supabase, linhas.concat(extras)))
    .then((r) => {
      CAPTURA_ESTADO = {
        ultima: new Date().toISOString(),
        gravadas: r.gravadas || 0,
        // sem chave nao ha upsert possivel; conto pra saber se estou
        // perdendo devolucao por falta de identificador
        sem_chave: lista.length - linhas.length,
        tiktok_erro: erroTikTok || undefined,
        erro: r.ok ? null : (r.erros || ['falha desconhecida']).join(' | '),
      };
      if (r.ok) console.log(`[CAPTURA] ${r.gravadas} devolucoes guardadas`);
      else console.warn('[CAPTURA] falhou:', CAPTURA_ESTADO.erro);
      return CAPTURA_ESTADO;   // b185 - quem forcou espera este resultado
    })
    .catch((e) => {
      CAPTURA_ESTADO = { ultima: new Date().toISOString(), gravadas: 0, erro: e.message || String(e) };
      console.warn('[CAPTURA] erro:', CAPTURA_ESTADO.erro);
      return CAPTURA_ESTADO;
    })
    .finally(() => { CAPTURA_RODANDO = false; });
}

// ============================================================
// ev1 - EVENTOS DO CHECKOUT (o Mover-Pedidos avisa; fica pesquisavel).
// O checkout offline registra aqui etiquetas anexadas (e depois NFs),
// pra busca posterior. Tabela: eventos_checkout (SQL a parte).
// Ingestao autenticada pela ADMIN_KEY no corpo (quem chama e o servico).
app.post('/api/interno/evento-checkout', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const b = req.body || {};
    if (!ADMIN_KEY || String(b.k || '') !== ADMIN_KEY) return res.status(403).json({ ok: false });
    const reg = {
      empresa: String(b.empresa || '').slice(0, 20),
      tipo: String(b.tipo || '').slice(0, 40),
      codigo: String(b.codigo || '').trim().slice(0, 80),
      quem: String((b.extra && b.extra.quem) || '').slice(0, 60),
      extra: (b.extra && typeof b.extra === 'object') ? b.extra : {},
    };
    // ev1 - a entrada valida ANTES do banco (licao repetida da casa)
    if (!reg.codigo || !reg.tipo) return res.status(400).json({ ok: false, erro: 'codigo e tipo obrigatorios' });
    if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
    const { error } = await supabase.from('eventos_checkout').insert([reg]);
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message || 'erro' });
  }
});

// ev1 - consulta pro Diego: /api/admin/eventos-checkout?k=ADMIN_KEY&q=CODIGO
// (sem q = os 40 mais recentes; q casa por pedaco do codigo/pedido)
app.get('/api/admin/eventos-checkout', async (req, res) => {
  try {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
    const q = String(req.query.q || '').trim();
    let cons = supabase.from('eventos_checkout').select('*').order('criado_em', { ascending: false }).limit(40);
    if (q) cons = cons.ilike('codigo', '%' + q + '%');
    const { data, error } = await cons;
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    res.json({ ok: true, total: (data || []).length, eventos: data || [] });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message || 'erro' });
  }
});

app.listen(PORT, () => {
  console.log('============================================');
  console.log('GOOD Devolucoes v3.56 - MAGALU integrada');
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
