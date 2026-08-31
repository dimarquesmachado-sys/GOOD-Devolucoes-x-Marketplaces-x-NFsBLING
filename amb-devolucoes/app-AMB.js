// ============================================================
// amb-devolucoes/app-AMB.js                    (AMB Devol. b22)
// ------------------------------------------------------------
// Router Express do Devolucoes da AMBTotal.
//
// b11 — FORCA MAXIMA (paridade com a GOOD):
//   SHOPEE no bipe e no a espreita (proxy do shopee-nf-sync,
//   loja 'amb'); MAGALU com OAuth proprio da conta AMB + as 3
//   modalidades (agencia, correios, FULFILLMENT); MOTIVO da
//   devolucao em linguagem de galpao (arrependeu x defeito x
//   nunca recebeu); RECLAMACAO em 2 cliques; cruzamento com as
//   NFs de DEVOLUCAO do Bling ("ja emitida ✓"); e-mail quando
//   o galpao reporta problema; etiqueta ZPL de defeito na Zebra
//   via QZ Tray (mesmo certificado da GOOD, fila remota).
//
// b10 trouxe o PAINEL: a espreita (o que esta vindo), triagens,
// defeitos agrupados por local, e recados pro estoquista.
//
// b8 trouxe A TELA de bipe. Ate agora tudo era API: so funcionava por URL
// com a chave de admin. Agora o galpao abre /amb/ no celular,
// loga e bipa. Ver public-AMB/index-AMB.html.
//
// b6 trouxe LOGIN e TRIAGEM: o galpao passa a ter como entrar e o
// que for bipado passa a ser GRAVADO no Supabase (tabelas _amb).
// O cookie de sessao e "sessao_amb", isolado do da GOOD, que
// roda no mesmo dominio — ver lib-AMB/auth-AMB.js.
//
// b5 consertou a busca por nome: PAGINACAO de verdade (total real
// + "tem mais") e uma rota que abre os ITENS de uma NF sob
// demanda, pra desempatar quando o mesmo cliente tem varias
// compras e o nome nao distingue.
//
// b4 trouxe a BUSCA POR NOME DO REMETENTE — o pega-tudo que cobre
// os canais SEM integracao. A AMBTotal vende no TikTok Shop (e a
// Amazon comeca em breve): dessas origens a caixa chega so com o
// nome do cliente na etiqueta, e nenhum indice de marketplace
// resolve. Ver lib-AMB/nf-nomes-AMB.js.
//
// b3 trouxe o INDICE claims->returns do ML — a peca que faz o bipe
// da etiqueta dos Correios reconhecer de que venda e a caixa.
//
// CORRECAO DA b3: a tela /amb/conectar mostrava "falta autorizar"
// mesmo depois de conectar. Causa: ela lia o config, que e uma
// FOTO das env vars tirada quando o servico subiu. Como o token
// e gravado depois, a foto ficava velha ate o proximo restart.
// Agora a tela pergunta aos proprios modulos (bling.temToken(),
// ml.temToken()), que sabem o estado de agora.
//
// Toda rota administrativa exige ?k=ADMIN_KEY e responde 404
// quando a chave falta. A unica publica alem do /status e o
// /oauth/callback, protegido por state de uso unico.
// ============================================================

'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config-AMB');
const bling = require('./lib-AMB/bling-AMB');
const ml = require('./lib-AMB/ml-AMB');
const mlReturns = require('./lib-AMB/ml-returns-AMB');
const nfNomes = require('./lib-AMB/nf-nomes-AMB');
const tokens = require('./lib-AMB/render-tokens-AMB');
const auth = require('./lib-AMB/auth-AMB');
const tiktokPonte = require('../lib/tiktok-ponte');
const vinculoCache = require('../lib/vinculo-nf-cache');   // b204 - vinculo NF ja achado
const marcadores = require('../lib/marcadores-estornada');   // b200 - peca unica dos marcadores
const magaluCancelados = require('../lib/magalu-cancelados');  // b191 - peca UNICA, empresa por parametro // b334 - ponte TikTok via Mover-Pedidos (peca unica, empresa como parametro)
const db = require('./lib-AMB/supabase-AMB');
const mkt = require('./lib-AMB/marketplace-AMB');
const shopee = require('./lib-AMB/shopee-AMB');
const magalu = require('./lib-AMB/magalu-AMB');
const mlMotivo = require('./lib-AMB/ml-motivo-AMB');
const impressao = require('./lib-AMB/impressao-AMB');
const emailAMB = require('./lib-AMB/email-AMB');
const nfEntrada = require('./lib-AMB/nf-entrada-AMB');
const multer = require('multer');
const compat = require('./lib-AMB/compat-AMB');
const criarAdminHelpers = require('./lib-AMB/admin-helpers-AMB');
const criarNfPessoa = require('./lib-AMB/nf-pessoa-AMB');
const registrarRotasAdminNF = require('./lib-AMB/rotas-admin-AMB');
const criarMlBuscas = require('./lib-AMB/ml-buscas-AMB');
const registrarIdentificar = require('./lib-AMB/identificar-AMB');
const registrarCicloDefeitos = require('./lib-AMB/defeitos-ciclo-AMB');

const VERSAO = 'AMB Devolucoes b223';
const SUBIU_EM = new Date().toISOString();

const router = express.Router();

// b55 - LEVA 1a do porte GOOD -> AMB: rotas que a tela de bipe da GOOD usa
// e que a AMB nao tinha (busca de produto, EAN por SKU, foto de evidencia,
// status de triagem). As demais a AMB ja tem com outro nome — sao apontadas
// no proprio front quando os modulos JS forem portados (leva 2).


// ── AUTOSSUFICIENCIA DE PARSERS (b15) ────────────────────────
// BUG REAL pego em producao: no server.js da GOOD o
// cookieParser() esta na linha 148, e o /amb foi montado logo
// apos a 147 — ou seja, ANTES do leitor de cookies. Resultado:
// dentro deste router req.cookies vinha undefined e TODA rota
// com sessao respondia "sessao invalida", mesmo logado (o login
// em si funcionava porque criar cookie nao exige ler cookie).
// Agora o modulo le os proprios cookies e body — os dois
// middlewares abaixo pulam sozinhos quando o server ja fez o
// trabalho, entao nao ha custo em duplicar.
const cookieParser = require('cookie-parser');
router.use(express.json({ limit: '12mb' }));
router.use(cookieParser());

// ── Trava de admin ───────────────────────────────────────────
function admin(req, res, next) {
  const chave = process.env.ADMIN_KEY;
  if (!chave || req.query.k !== chave) {
    return res.status(404).json({ error: 'not found' });
  }
  next();
}

// ── State de uso unico pro OAuth ─────────────────────────────
const PENDENTES = new Map();
const VALIDADE_MS = 10 * 60 * 1000;

function novoState(servico) {
  const s = crypto.randomBytes(24).toString('hex');
  PENDENTES.set(s, { servico, criado_em: Date.now() });
  for (const [k, v] of PENDENTES) {
    if (Date.now() - v.criado_em > VALIDADE_MS) PENDENTES.delete(k);
  }
  return s;
}

function consumirState(s) {
  const reg = PENDENTES.get(s);
  if (!reg) return null;
  PENDENTES.delete(s);
  if (Date.now() - reg.criado_em > VALIDADE_MS) return null;
  return reg;
}

/** Reclamacao em 2 cliques: o link certo por marketplace. */
function linksReclamacao(marketplace, d = {}) {
  if (marketplace === 'ml') {
    const alvo = d.pack_id || d.order_id;
    return alvo ? {
      rotulo: 'Abrir a venda no Mercado Livre',
      url: `https://www.mercadolivre.com.br/vendas/${alvo}/detalhe`,
    } : null;
  }
  if (marketplace === 'shopee') {
    return {
      rotulo: 'Abrir devolucoes na Shopee' + (d.return_sn ? ` (procure ${d.return_sn})` : ''),
      url: 'https://seller.shopee.com.br/portal/sale/return',
      copiar: d.return_sn || d.pedido || null,
    };
  }
  if (marketplace === 'magalu') {
    return { rotulo: 'Abrir devolucoes no Magalu Entregas', url: 'https://seller.magaluentregas.com.br/', copiar: d.pedido || null };
  }
  return null;
}

function redirectOAuth() {
  return cfg.urlBase() + '/amb/oauth/callback';
}

// ── Paginas ──────────────────────────────────────────────────
function pagina(titulo, corpo, cor) {
  return `<!DOCTYPE html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1419;color:#e6edf3;
margin:0;padding:24px;display:flex;justify-content:center}
.caixa{max-width:640px;width:100%}
h1{font-size:20px;margin:0 0 4px}
.sub{color:#8b949e;font-size:14px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:18px;margin-bottom:14px}
.btn{display:block;background:${cor || '#238636'};color:#fff;text-decoration:none;padding:14px 18px;
border-radius:8px;font-weight:600;text-align:center;margin-top:10px;font-size:16px}
.btn.cinza{background:#30363d}
.ok{color:#3fb950;font-weight:600}.erro{color:#f85149;font-weight:600}
code{background:#0d1117;padding:2px 6px;border-radius:4px;font-size:13px;word-break:break-all}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:6px 0;border-bottom:1px solid #21262d}
td:last-child{text-align:right;color:#8b949e}
.aviso{font-size:13px;color:#8b949e;margin-top:16px;line-height:1.5}
</style></head><body><div class="caixa">${corpo}</div></body></html>`;
}

// ── /amb/conectar ────────────────────────────────────────────
router.get('/conectar', admin, (req, res) => {
  const k = encodeURIComponent(req.query.k);
  // Estado AO VIVO, perguntado aos modulos (nao a foto do config).
  const idx = mlReturns.statusIndice();

  const linha = (nome, pronto, detalhe) =>
    `<tr><td>${nome}</td><td>${pronto ? '<span class="ok">conectado</span>' : '<span class="erro">falta autorizar</span>'}${detalhe ? ' &middot; ' + detalhe : ''}</td></tr>`;

  const corpo = `
    <h1>AMBTotal &middot; Devolucoes</h1>
    <div class="sub">${VERSAO} &mdash; conexoes do modulo</div>

    <div class="card">
      <table>
        ${linha('Bling', bling.temToken())}
        ${linha('Mercado Livre', ml.temToken(), ml.userId() ? ('user ' + ml.userId()) : '')}
        <tr><td>Indice de nomes (NFs)</td><td>${(() => { const n = nfNomes.statusIndice();
          return n.quente ? `<span class="ok">${n.total_nfs} NFs</span> &middot; ${n.idade_min} min`
                          : (n.construindo ? 'montando agora...' : '<span class="erro">ainda frio</span>'); })()}</td></tr>
        <tr><td>Indice de devolucoes ML</td><td>${idx.quente
          ? `<span class="ok">${idx.com_tracking} rastreios</span> &middot; ${idx.idade_min} min`
          : (idx.construindo ? 'montando agora...' : '<span class="erro">ainda frio</span>')}</td></tr>
        <tr><td>Magalu</td><td>${
          !magalu.temCredenciais() ? '<span class="erro">sem credenciais do app no servico</span>'
          : !magalu.temToken() ? '<b>falta o consentimento</b> (botao abaixo)'
          : !magalu.temTenant() ? '<span class="ok">autorizado</span> &middot; <b>falta AMB_MAGALU_TENANT_ID</b>'
          : `<span class="ok">conectado</span> &middot; tenant ${process.env.AMB_MAGALU_TENANT_ID}`}</td></tr>
        <tr><td>Shopee</td><td>${shopee.cfg.ativo
          ? `<span class="ok">ligada</span> &middot; loja ${shopee.cfg.loja}`
          : '<span class="erro">desligada</span>'}</td></tr>
      </table>
    </div>

    <div class="card">
      <a class="btn" href="/amb/oauth/iniciar?servico=bling&k=${k}">Conectar o Bling da AMBTotal</a>
      <a class="btn" href="/amb/oauth/iniciar?servico=ml&k=${k}">Conectar o Mercado Livre da AMBTotal</a>
      <a class="btn" href="/amb/oauth/iniciar?servico=magalu&k=${k}">Conectar o Magalu da AMBTotal</a>
      <a class="btn cinza" href="/amb/ml/indice?k=${k}">Ver o indice de devolucoes</a>
      <a class="btn cinza" href="/amb/nf/indice?k=${k}">Ver o indice de nomes</a>
      <a class="btn cinza" href="/amb/config?k=${k}">Ver diagnostico completo</a>
    </div>

    <div class="aviso">
      Clique, autorize na tela do marketplace e pronto — o resto acontece sozinho.
      Confira antes que o navegador esteja logado na conta da <b>AMBTotal</b>.<br>
      &#9888;&#65039; No <b>Magalu</b> vale dobrado: e a conta LOGADA na hora do consentimento
      que fica autorizada — saia da conta da GOOD (ou use janela anonima) antes de clicar.<br><br>
      Endereco de retorno cadastrado nos apps:<br><code>${redirectOAuth()}</code>
    </div>`;
  res.set('Content-Type', 'text/html; charset=utf-8').send(pagina('Conectar AMBTotal', corpo));
});

// ── OAuth ────────────────────────────────────────────────────
router.get('/oauth/iniciar', admin, (req, res) => {
  const servico = String(req.query.servico || '').toLowerCase();

  if (servico === 'bling') {
    if (!bling.temCredenciais()) {
      return res.status(200).send(pagina('Falta credencial',
        `<h1>Faltam credenciais do Bling</h1><div class="card">Configure
         <code>AMB_BLING_CLIENT_ID</code> e <code>AMB_BLING_CLIENT_SECRET</code> no Render.</div>`));
    }
    const state = novoState('bling');
    const p = new URLSearchParams({
      response_type: 'code', client_id: cfg.bling.clientId,
      redirect_uri: redirectOAuth(), state,
    });
    return res.redirect(`${cfg.bling.apiBase}/oauth/authorize?${p.toString()}`);
  }

  if (servico === 'ml') {
    if (!ml.temCredenciais()) {
      return res.status(200).send(pagina('Falta credencial',
        `<h1>Faltam credenciais do Mercado Livre</h1><div class="card">Configure
         <code>AMB_ML_CLIENT_ID</code> e <code>AMB_ML_CLIENT_SECRET</code> no Render.</div>`));
    }
    const state = novoState('ml');
    return res.redirect(ml.urlAutorizacao(state, redirectOAuth()));
  }

  if (servico === 'magalu') {
    if (!magalu.temCredenciais()) {
      return res.status(200).send(pagina('Falta credencial',
        `<h1>Faltam credenciais do Magalu</h1><div class="card">Este servico precisa das vars
         <code>MAGALU_CLIENT_ID</code> e <code>MAGALU_CLIENT_SECRET</code> (as mesmas da GOOD —
         nao tem prefixo AMB porque o app e compartilhado; a CONTA autorizada e decidida no login).</div>`));
    }
    const state = novoState('magalu');
    return res.redirect(magalu.urlAutorizacao(state, redirectOAuth()));
  }

  res.status(400).json({ ok: false, erro: 'servico invalido', use: 'bling, ml ou magalu' });
});

router.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(200).send(pagina('Autorizacao negada',
      `<h1 class="erro">Autorizacao nao concluida</h1>
       <div class="card">${String(error_description || error)}</div>`, '#da3633'));
  }

  const reg = consumirState(String(state || ''));
  if (!reg) {
    return res.status(400).send(pagina('Link invalido',
      `<h1 class="erro">Link invalido ou expirado</h1>
       <div class="card">Este endereco so vale por 10 minutos depois de voce clicar no botao.
       Volte para a tela de conexao e clique de novo.</div>`, '#da3633'));
  }

  if (!code) {
    return res.status(400).send(pagina('Sem code',
      `<h1 class="erro">O marketplace nao devolveu o code</h1>
       <div class="card">Tente novamente pela tela de conexao.</div>`, '#da3633'));
  }

  try {
    if (reg.servico === 'bling') {
      const r = await bling.trocarCodePorToken(String(code));
      const teste = await bling.testeDeVida();
      return res.send(pagina('Bling conectado', `
        <h1 class="ok">Bling da AMBTotal conectado</h1>
        <div class="card"><table>
          <tr><td>Token gravado no Render</td><td>${r.persistiu ? 'sim' : 'NAO'}</td></tr>
          <tr><td>Escopos</td><td>${(r.dados && r.dados.scope) || '-'}</td></tr>
          <tr><td>Teste de leitura</td><td>${teste.ok ? 'respondeu' : 'falhou'}</td></tr>
        </table></div>`));
    }

    if (reg.servico === 'ml') {
      const r = await ml.trocarCodePorToken(String(code), redirectOAuth());
      const teste = await ml.testeDeVida();
      // Com o ML recem-conectado, ja vale montar o indice.
      mlReturns.preAquecer(5000);
      return res.send(pagina('Mercado Livre conectado', `
        <h1 class="ok">Mercado Livre da AMBTotal conectado</h1>
        <div class="card"><table>
          <tr><td>Conta</td><td>${teste.conta || '-'}</td></tr>
          <tr><td>user_id descoberto</td><td>${r.user_id || '-'}</td></tr>
          <tr><td>Token gravado no Render</td><td>${r.persistiu ? 'sim' : 'NAO'}</td></tr>
          <tr><td>Validade do acesso</td><td>${r.expira_em_s ? Math.round(r.expira_em_s / 3600) + 'h (renova sozinho)' : '-'}</td></tr>
        </table></div>
        <div class="aviso">O indice de devolucoes comecou a ser montado agora e leva alguns minutos.
        Acompanhe em <code>/amb/ml/indice?k=SUA_CHAVE</code>.</div>`));
    }

    if (reg.servico === 'magalu') {
      const r = await magalu.trocarCodePorToken(String(code), redirectOAuth());
      magalu.preAquecer();
      return res.send(pagina('Magalu conectado', `
        <h1 class="ok">Magalu da AMBTotal conectado</h1>
        <div class="card"><table>
          <tr><td>Token gravado no Render</td><td>${r.persistiu ? 'sim' : 'NAO'}</td></tr>
          <tr><td>Tenant configurado</td><td>${magalu.temTenant() ? 'sim' : '<b>FALTA AMB_MAGALU_TENANT_ID</b>'}</td></tr>
        </table></div>
        <div class="aviso">⚠️ Confira que o login foi feito na conta Magalu <b>da AMBTotal</b> —
        e a conta logada que fica autorizada, nao o app.
        ${magalu.temTenant() ? '' : '<br><br>Falta o tenant: abra seller.magaluentregas.com.br logado na AMB, F12 → Network → qualquer chamada ao seller-devolution-bff → header <code>x-tenant-id</code>. Grave em <code>AMB_MAGALU_TENANT_ID</code> no Render.'}</div>`));
    }

    res.status(400).json({ ok: false, erro: 'servico desconhecido no state' });
  } catch (erro) {
    const detalhe = (erro.response && JSON.stringify(erro.response.data)) || erro.message;
    res.status(200).send(pagina('Falhou',
      `<h1 class="erro">Nao consegui concluir</h1><div class="card"><code>${detalhe}</code></div>`, '#da3633'));
  }
});

// ── Status e config ──────────────────────────────────────────
router.get('/status', (req, res) => {
  const idx = mlReturns.statusIndice();
  res.json({
    ok: true,
    modulo: 'amb-devolucoes',
    empresa: cfg.NOME_EMPRESA,
    versao: VERSAO,
    subiu_em: SUBIU_EM,
    uptime_s: Math.round(process.uptime()),
    memoria_mb: Math.round(process.memoryUsage().rss / 1048576),
    conectado: { bling: bling.temToken(), ml: ml.temToken(), ml_user: ml.userId() || null },
    indice_ml: { quente: idx.quente, construindo: idx.construindo, rastreios: idx.com_tracking, idade_min: idx.idade_min },
    indice_nomes: { quente: nfNomes.statusIndice().quente, nfs: nfNomes.statusIndice().total_nfs },
    login_configurado: auth.temUsuarios(),
    banco_ligado: db.ligado(),
  });
});

router.get('/config', admin, (req, res) => {
  res.json({
    ok: true,
    versao: VERSAO,
    empresa: cfg.NOME_EMPRESA,
    url_base: cfg.urlBase(),
    redirect_oauth: redirectOAuth(),
    // ao vivo, nao a foto do boot
    conectado_agora: { bling: bling.temToken(), ml: ml.temToken(), ml_user: ml.userId() || null },
    configurado: cfg.statusConfig(),
    persistencia_token: tokens.diagnostico(),
    email: emailAMB.diagnostico(),
    tabelas_supabase: cfg.supabase.tabelas,
    oauth_pendentes: PENDENTES.size,
  });
});

// ── INDICE DE DEVOLUCOES DO ML ───────────────────────────────

/** Estado do indice. */
router.get('/ml/indice', admin, (req, res) => {
  res.json({ ok: true, versao: VERSAO, indice: mlReturns.statusIndice() });
});

/** Forca a reconstrucao. Responde na hora e monta em background. */
router.get('/ml/indice/construir', admin, (req, res) => {
  const st = mlReturns.statusIndice();
  if (st.construindo) {
    return res.json({ ok: true, ja_construindo: true, aviso: 'ja existe uma construcao em andamento' });
  }
  mlReturns.construirIndice().catch(e => console.error('[AMB] construcao falhou:', e.message));
  res.json({
    ok: true,
    iniciado: true,
    aviso: 'montando em background - pode levar alguns minutos',
    acompanhe: cfg.urlBase() + '/amb/ml/indice?k=SUA_CHAVE',
  });
});

/**
 * O CORACAO DO BIPE: recebe o codigo dos Correios e diz de que
 * venda e a caixa. Aceita o codigo sujo (espaco, ponto, minuscula).
 */
router.get('/ml/rastreio', admin, async (req, res) => {
  const codigo = req.query.codigo;
  if (!codigo) {
    return res.status(400).json({ ok: false, erro: 'falta o codigo', uso: '/amb/ml/rastreio?codigo=AD123456789BR&k=SUA_CHAVE' });
  }
  const achado = await mlReturns.acharPorTracking(String(codigo));
  if (!achado) {
    return res.json({
      ok: true, encontrado: false, codigo: String(codigo),
      indice: mlReturns.statusIndice(),
      dica: 'se o indice estiver frio ou a janela de dias for curta, o rastreio pode existir e nao estar no mapa',
    });
  }
  res.json({ ok: true, encontrado: true, devolucao: achado });
});

/** Base do painel "a espreita": o que esta vindo pro galpao. */
router.get('/ml/espreita', admin, (req, res) => {
  res.json({ ok: true, versao: VERSAO, espreita: mlReturns.resumoEspreita() });
});

// ── BUSCA POR NOME (pega-tudo: TikTok, Amazon, qualquer canal) ─

/** Estado do indice de NFs por nome. */
router.get('/nf/indice', admin, (req, res) => {
  res.json({ ok: true, versao: VERSAO, indice: nfNomes.statusIndice() });
});

/** Forca a reconstrucao do indice de nomes. */
router.get('/nf/indice/construir', admin, (req, res) => {
  const st = nfNomes.statusIndice();
  if (st.construindo) {
    return res.json({ ok: true, ja_construindo: true });
  }
  nfNomes.construirIndice().catch(e => console.error('[AMB] indice de nomes falhou:', e.message));
  res.json({
    ok: true, iniciado: true,
    aviso: 'montando em background',
    acompanhe: cfg.urlBase() + '/amb/nf/indice?k=SUA_CHAVE',
  });
});

/**
 * Busca a NF pelo nome do remetente. Aceita o nome colado como sai
 * na etiqueta ("IANDRAMATIASRIBEIRO") ou digitado com espaco.
 * SEMPRE devolve CANDIDATOS — a decisao e do estoquista.
 */
router.get('/shopee/chegada', admin, async (req, res) => {
  const sn = req.query.sn || req.query.order_sn;
  if (!sn) return res.status(400).json({ ok: false, uso: '/amb/shopee/chegada?sn=ORDER_SN&k=SUA_CHAVE' });
  if (!shopee.cfg.ativo) {
    return res.json({ ok: false, erro: 'integracao Shopee desligada — faltam SHOPEE_PROXY_URL / SHOPEE_PROXY_KEY no servico' });
  }
  try {
    const r = await shopee.consultarChegada(String(sn));
    res.json({ ok: true, order_sn: String(sn), resultado: r });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

router.get('/nf/nome', admin, async (req, res) => {
  const q = req.query.q;
  if (!q) {
    return res.status(400).json({ ok: false, erro: 'falta o q', uso: '/amb/nf/nome?q=NOMEDOCLIENTE&pagina=1&k=SUA_CHAVE' });
  }
  const r = await nfNomes.buscarPorNome(String(q), {
    pagina: req.query.pagina,
    porPagina: req.query.por_pagina,
  });
  res.json({
    ok: true,
    procurado: r.alvo,
    via: r.via,
    total_encontrados: r.total,
    mostrando: r.candidatos.length,
    pagina: r.pagina,
    tem_mais: r.tem_mais,
    proxima_pagina: r.tem_mais
      ? `${cfg.urlBase()}/amb/nf/nome?q=${encodeURIComponent(String(q))}&pagina=${r.pagina + 1}&k=SUA_CHAVE`
      : null,
    mesmo_cliente_repetido: r.muitos_iguais || false,
    dica_desempate: r.muitos_iguais
      ? 'todas as NFs sao do mesmo nome - use /amb/nf/itens?id=ID_DA_NF para ver os produtos de cada uma'
      : null,
    candidatos: r.candidatos,
    indice: nfNomes.statusIndice(),
  });
});

/**
 * ITENS DE UMA NF — o desempate.
 * Quando o mesmo cliente comprou varias vezes, o nome nao resolve.
 * Aqui o estoquista abre uma NF especifica e ve o que tem dentro.
 * E SOB DEMANDA de proposito: trazer os itens dos 8 candidatos
 * custaria 8 chamadas ao Bling (~6s) em toda busca, quase sempre
 * a toa. Uma chamada, quando ele clica, custa menos de 1s.
 */
router.get('/nf/itens', admin, async (req, res) => {
  const id = req.query.id;
  if (!id) {
    return res.status(400).json({ ok: false, erro: 'falta o id', uso: '/amb/nf/itens?id=25994228847&k=SUA_CHAVE' });
  }
  const r = await bling.buscarNFePorId(String(id));
  if (!r.ok) return res.json({ ok: false, erro: r.error, status: r.status });

  const nfe = r.nfe || {};
  const itens = (nfe.itens || []).map(i => ({
    sku: i.codigo || null,
    descricao: i.descricao || null,
    quantidade: i.quantidade != null ? i.quantidade : null,
    valor_unit: i.valor != null ? i.valor : null,
  }));

  res.json({
    ok: true,
    nf: {
      id: String(nfe.id || id),
      numero: nfe.numero || null,
      serie: nfe.serie || null,
      chave: nfe.chaveAcesso || nfe.chave || null,
      data_emissao: nfe.dataEmissao || null,
      valor: nfe.valorNota != null ? nfe.valorNota : null,
      cliente: (nfe.contato && nfe.contato.nome) || null,
      numero_pedido_loja: nfe.numeroPedidoLoja || null,
    },
    itens,
    total_itens: itens.length,
  });
});

// ── IDENTIFICAR: a porta unica do bipe ───────────────────────
/**
 * Recebe qualquer coisa que o estoquista bipe ou digite e tenta
 * descobrir de que venda e. Ordem das tentativas:
 *   1. rastreio no indice do ML (Correios/Mercado Envios)
 *   2. nome do remetente
 * Quando nada bate, diz o que ja foi tentado — em vez de so
 * responder "nao achei", que nao ajuda ninguem no galpao.
 */
router.get('/identificar', admin, async (req, res) => {
  const codigo = String(req.query.codigo || '').trim();
  if (!codigo) {
    return res.status(400).json({ ok: false, erro: 'falta o codigo', uso: '/amb/identificar?codigo=XXX&k=SUA_CHAVE' });
  }

  const tentativas = [];

  // 1) rastreio conhecido do ML
  const porTracking = await mlReturns.acharPorTracking(codigo);
  tentativas.push({ via: 'rastreio ML', achou: !!porTracking });
  if (porTracking) {
    return res.json({ ok: true, encontrado: true, via: 'rastreio ML', devolucao: porTracking, tentativas });
  }

  // 2) nome do remetente
  const porNome = await nfNomes.buscarPorNome(codigo, { pagina: req.query.pagina });
  tentativas.push({ via: 'nome do remetente', achou: porNome.total > 0, quantos: porNome.total });
  if (porNome.total > 0) {
    return res.json({
      ok: true, encontrado: true, via: 'nome do remetente',
      match: porNome.via,
      total_encontrados: porNome.total,
      mostrando: porNome.candidatos.length,
      pagina: porNome.pagina,
      tem_mais: porNome.tem_mais,
      mesmo_cliente_repetido: porNome.muitos_iguais || false,
      candidatos: porNome.candidatos,
      aviso: 'confira com a caixa antes de confirmar - sao candidatos, nao certeza',
      tentativas,
    });
  }

  res.json({
    ok: true, encontrado: false, codigo, tentativas,
    indices: { ml: mlReturns.statusIndice(), nomes: nfNomes.statusIndice() },
    dica: 'se for de canal sem integracao (TikTok, Amazon), tente o nome do remetente da etiqueta',
  });
});

// ── A TELA DO GALPAO ─────────────────────────────────────────
// O arquivo se chama index-AMB.html (e nao index.html) porque no
// mesmo repo ja existe o index.html da GOOD, e os dois se
// confundiam na pasta de Downloads. Como o nome nao e index, o
// express.static nao serve sozinho na raiz — por isso a rota
// explicita abaixo.
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public-AMB', 'index-AMB.html'));
});

router.get('/painel', auth.requerLogin, (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');   // b19: tela nunca presa
  res.sendFile(path.join(__dirname, 'public-AMB', 'painel-AMB.html'));
});

// ── seg2 - MESMO FURO NA AMB, POR OUTRO CAMINHO ──────────────────────
// Aqui a rota /amb/painel ja passa por auth.requerLogin (logo acima), mas
// o express.static abaixo serve a pasta public-AMB INTEIRA — entao
// /amb/painel-AMB.html (e /amb/painel2-AMB.html) entregavam a mesma tela
// sem login nenhum, driblando a rota protegida.
//
// index-AMB.html continua publico (e a tela de login) e defeitos-AMB.html
// tambem, pelo mesmo criterio da GOOD: quem protege ali e a API.
// seg2.1 - mesma correcao da GOOD: decodificar antes de comparar (peca unica).
const { ehCaminhoProtegido: ehProtegidoAMB } = require('../lib/caminho-pedido');
function exigirLoginNoPainelHtml(req, res, next) {
  const ehPainel = ehProtegidoAMB(req.path, {
    exatos: ['/painel-AMB.html', '/painel2-AMB.html'],
  });
  if (ehPainel) return auth.requerLogin(req, res, next);
  return next();
}
router.use(exigirLoginNoPainelHtml);

// ═══════════════════════════════════════════════════════════════════
//  MODULOS COMPARTILHADOS COM A GOOD  (unificacao, 29/08)
//  ---------------------------------------------------------------
//  O base-amb.js sempre disse a intencao: "os modulos desta pasta sao
//  os arquivos da GOOD, SEM UMA LINHA ALTERADA" — ele so poe o prefixo
//  /amb em tempo de execucao. A copia era o MECANISMO de atualizacao,
//  e dependia de alguem lembrar de copiar.
//
//  Ninguem lembrou. Em 29/08 o leitor de etiqueta foi consertado so na
//  GOOD e a AMB — onde o problema tinha sido relatado — ficou pra tras.
//  Antes disso, a mesma coisa com o filtro de defeitos e a coluna de
//  data. O padrao se repete porque depende de memoria humana.
//
//  Agora os arquivos IDENTICOS sao servidos da pasta da GOOD. Some a
//  copia, some a chance de divergirem. Os que ainda diferem de verdade
//  (auth, busca, defeitos-ficha) continuam vindo de public-AMB, que e
//  montada logo abaixo e tem prioridade pra qualquer nome repetido.
//
//  Nada muda no HTML: ele continua pedindo js-AMB/<arquivo>.
// ═══════════════════════════════════════════════════════════════════
const JS_COMPARTILHADOS = [
  'app.js', 'bipagem.js', 'camera.js', 'colar-imagem.js',
  'etiqueta.js', 'helpers.js', 'ocr.js', 'scanner.js', 'triagem.js',
];

router.use('/js-AMB', (req, res, next) => {
  const nome = String(req.path || '').replace(/^\//, '');
  if (JS_COMPARTILHADOS.indexOf(nome) === -1) return next();   // vai pro static da AMB
  res.sendFile(path.join(__dirname, '..', 'public', 'js', nome), (err) => {
    if (err) next();   // sumiu da GOOD? cai pra copia local, se houver
  });
});

router.use(express.static(path.join(__dirname, 'public-AMB'), {
  // b19 - HTML sempre revalida (mesma licao da v3.64 da GOOD: o
  // navegador segurava a tela velha e o Diego via "tela b17" com
  // "servidor b18"). Imagens continuam com cache normal.
  //
  // 29/08 - havia DUAS chaves setHeaders neste objeto. Em JavaScript a
  // segunda apaga a primeira sem avisar, entao quem editasse a de cima
  // nao mudava nada. Ficou uma so.
  setHeaders: (res, caminho) => {
    if (String(caminho).endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// ── LOGIN DO GALPAO ──────────────────────────────────────────
// Estas rotas usam COOKIE, nao a ADMIN_KEY: quem usa e o
// estoquista no celular, que nao tem (nem deve ter) a chave.


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
const LOGIN_NOME_MAX = 100;   // seg1.4 - nome absurdo nem chega a ser processado
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

router.post('/api/auth/login', (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) {
    return res.status(400).json({ ok: false, erro: 'informe usuario e senha' });
  }
  if (String(usuario).length > LOGIN_NOME_MAX) {
    return res.status(401).json({ ok: false, erro: 'usuario ou senha invalidos' });
  }
  const chavesFreio = loginChaves(req, usuario);
  const esperar = loginBloqueado(chavesFreio);
  if (esperar) {
    return res.status(429).json({ ok: false, erro: `muitas tentativas — tente de novo em ${Math.ceil(esperar / 60)} min` });
  }
  if (loginSemCapacidade(chavesFreio)) {
    return res.status(429).json({ ok: false, erro: 'sistema recebendo muitas tentativas de login — tente de novo em alguns minutos' });
  }
  const conta = auth.autenticar(String(usuario), String(senha));
  if (!conta) {
    loginErrou(chavesFreio);
    // Mensagem generica de proposito: nao dizer se o usuario
    // existe evita descobrir nomes validos por tentativa.
    return res.status(401).json({ ok: false, erro: 'usuario ou senha invalidos' });
  }
  loginAcertou(chavesFreio);
  // Guarda o nome na grafia CADASTRADA, nao como foi digitado —
  // assim o registro da triagem sai sempre igual no banco.
  const token = auth.novaSessao(conta.nome, conta.tipo);
  res.cookie(auth.COOKIE, token, auth.opcoesCookie());
  console.log(`[AMB/LOGIN] ${conta.nome} (${conta.tipo})`);
  res.json({ ok: true, usuario: conta.nome, tipo: conta.tipo });
});

router.post('/api/auth/logout', (req, res) => {
  const t = auth.tokenDaRequisicao(req);
  if (t) auth.sair(t);
  res.clearCookie(auth.COOKIE, { path: auth.CAMINHO_COOKIE });
  res.json({ ok: true });
});

router.get('/api/auth/me', (req, res) => {
  const s = auth.validarSessao(auth.tokenDaRequisicao(req));
  if (!s) return res.json({ ok: false });
  res.json({ ok: true, usuario: s.usuario, tipo: s.tipo });
});

// Diagnostico do login (admin) - nunca devolve senha
router.get('/auth/diag', admin, (req, res) => {
  res.json({ ok: true, versao: VERSAO, login: auth.diagnostico() });
});

// ── TRIAGEM (o que o estoquista faz) ─────────────────────────

/** Bipa/digita e descobre o que e. Versao logada do /identificar. */
router.get('/api/triagem/identificar', auth.requerLogin, async (req, res) => {
  const codigo = String(req.query.codigo || '').trim();
  if (!codigo) return res.status(400).json({ ok: false, erro: 'falta o codigo' });

  const tentativas = [];
  let achado = null, via = null, candidatos = null, extras = {};

  const porTracking = await mlReturns.acharPorTracking(codigo);
  tentativas.push({ via: 'rastreio ML', achou: !!porTracking });
  if (porTracking) { achado = porTracking; via = 'rastreio ML'; }

  // SHOPEE: tracking SPX (BR...), return_sn ou order_sn
  let devShopee = null;
  if (!achado && shopee.cfg.ativo) {
    try {
      const infoS = await shopee.acharDevolucao(codigo);
      tentativas.push({ via: 'devolucao Shopee', achou: !!infoS.hit, na_lista: infoS.qtd });
      if (infoS.hit) { devShopee = infoS.hit; via = 'devolucao Shopee'; }
    } catch (e) {
      tentativas.push({ via: 'devolucao Shopee', achou: false, erro: e.message });
    }
  }

  if (!achado && !devShopee) {
    const porNome = await nfNomes.buscarPorNome(codigo, { pagina: req.query.pagina });
    tentativas.push({ via: 'nome do remetente', achou: porNome.total > 0, quantos: porNome.total });
    if (porNome.total > 0) {
      via = 'nome do remetente';
      candidatos = porNome.candidatos;
      extras = {
        match: porNome.via,
        total_encontrados: porNome.total,
        pagina: porNome.pagina,
        tem_mais: porNome.tem_mais,
        mesmo_cliente_repetido: porNome.muitos_iguais || false,
        busca_generica: porNome.generica || false,
        aviso_generico: porNome.generica
          ? 'muitos resultados - digite o nome COMPLETO do remetente que esta na etiqueta'
          : null,
      };
    }
  }

  // Duas checagens que evitam erro no galpao:
  //  - ja triaram esta caixa antes?
  //  - existe recado preso a este pedido?
  const chaves = {
    orderId: (achado && achado.order_id) || null,
    tracking: (achado && achado.tracking) || codigo,
  };
  // b212 - TODOS os numeros que essa mesma devolucao atende: o recado pode
  // ter sido preso a qualquer um deles (ele criou pelo numero da venda e
  // bipou pelo pack id — eram chaves diferentes e o aviso nunca chegou).
  const idsDoRecado = [
    codigo,
    achado && achado.order_id,
    achado && achado.pack_id,
    achado && achado.tracking,
    achado && achado.shipment_id,
    achado && achado.nf_numero,
    achado && achado.chave,
    devShopee && devShopee.order_sn,
    devShopee && devShopee.return_sn,
    devShopee && devShopee.tracking_number,
  ];
  const [dup, rec] = await Promise.all([
    db.jaTriado(chaves),
    db.recadoDeQualquer(idsDoRecado),
  ]);

  // Origem da venda descoberta sozinha, sem o estoquista escolher.
  const origem = achado
    ? mkt.detectar(null, { temClaimML: true, tracking: achado.tracking })
    : (devShopee ? { marketplace: 'shopee', confianca: 'alta' }
                 : { marketplace: 'desconhecido', confianca: 'nenhuma' });

  // MOTIVO (so no hit do ML: e de la que temos claim + pedido)
  let motivo = null;
  if (achado && achado.order_id) {
    motivo = await mlMotivo.motivoDaDevolucao({ orderId: achado.order_id, claimId: achado.claim_id });
  }

  // NF de devolucao ja emitida?
  const nfDev = nfEntrada.jaEmitida({
    pedido: (achado && achado.order_id) || (devShopee && devShopee.order_sn) || null,
    nome: null,
  });

  const reclamacao = linksReclamacao(origem.marketplace, {
    order_id: achado && achado.order_id,
    pack_id: motivo && motivo.pack_id,
    return_sn: devShopee && devShopee.return_sn,
    pedido: devShopee && devShopee.order_sn,
  });

  res.json({
    ok: true,
    encontrado: !!(achado || devShopee || candidatos),
    via,
    marketplace: origem.marketplace,
    marketplace_nome: mkt.nomeBonito(origem.marketplace),
    motivo_devolucao: motivo,
    reclamacao,
    nf_devolucao: nfDev,
    devolucao_shopee: devShopee ? {
      pedido: devShopee.order_sn || null,
      return_sn: devShopee.return_sn || null,
      tracking: devShopee.tracking_number || null,
      status: [devShopee.status, devShopee.logistics_status || devShopee.logistic_status].filter(Boolean).join(' / ') || null,
    } : null,
    devolucao: achado,
    candidatos,
    ...extras,
    ja_triado: dup.ok ? dup.triado : null,
    triagem_anterior: dup.ok ? dup.registro : null,
    recado: rec.ok ? rec.recado : null,
    tentativas,
    usuario: req.usuario,
  });
});

/** Grava a triagem. */
router.post('/api/triagem/registrar', auth.requerLogin, async (req, res) => {
  const d = req.body || {};
  if (!d.order_id && !d.tracking && !d.nf_numero) {
    return res.status(400).json({ ok: false, erro: 'informe ao menos order_id, tracking ou nf_numero' });
  }
  const r = await db.registrarTriagem({ ...d, funcionario: req.usuario });
  if (!r.ok) return res.status(200).json({ ok: false, erro: r.erro });

  // PROBLEMA: avisa o Diego por e-mail (fire and forget) e ja
  // responde se ha outras unidades do mesmo SKU em defeito — a
  // tela usa isso pro alerta de canibalizacao.
  let canibalizacao = null;
  if (d.status === 'problema') {
    emailAMB.avisarProblema({ ...d, funcionario: req.usuario });
    if (d.produto_sku) {
      const outras = await db.defeitosDoSku(d.produto_sku);
      if (outras.ok && outras.unidades.length > 1) {
        canibalizacao = {
          outras_unidades: outras.unidades.length - 1,
          locais: [...new Set(outras.unidades.map(u => u.localizacao).filter(Boolean))].slice(0, 4),
        };
      }
    }
  }
  res.json({ ok: true, registro: r.registro, email_enviado: d.status === 'problema' && emailAMB.ligado(), canibalizacao });
});

/** Itens de uma NF, para o estoquista logado desempatar. */
router.get('/api/nf/itens', auth.requerLogin, async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ ok: false, erro: 'falta o id' });
  const r = await bling.buscarNFePorId(String(id));
  if (!r.ok) return res.json({ ok: false, erro: r.error });
  const nfe = r.nfe || {};
  const origem = mkt.detectar(nfe.numeroPedidoLoja, {});
  res.json({
    ok: true,
    nf: {
      id: String(nfe.id || id),
      numero: nfe.numero || null,
      serie: nfe.serie || null,
      chave: nfe.chaveAcesso || nfe.chave || null,
      data_emissao: nfe.dataEmissao || null,
      valor: nfe.valorNota != null ? nfe.valorNota : null,
      cliente: (nfe.contato && nfe.contato.nome) || null,
      numero_pedido_loja: nfe.numeroPedidoLoja || null,
    },
    marketplace: origem.marketplace,
    marketplace_nome: mkt.nomeBonito(origem.marketplace),
    marketplace_confianca: origem.confianca,
    itens: (nfe.itens || []).map(i => ({
      sku: i.codigo || null,
      descricao: i.descricao || null,
      quantidade: i.quantidade != null ? i.quantidade : null,
      valor_unit: i.valor != null ? i.valor : null,
    })),
  });
});

/** Ultimas triagens. */
// b165 - PRE-TRAVA DO BIPE: "este pacote ja foi triado".
//
// O front da AMB ja chamava esta rota (foi copiado da GOOD) — mas ela NAO
// existia aqui. Dava 404, o catch do JavaScript engolia, e a tela mostrava
// os botoes como se o pacote fosse novo. Em 29/08 o mesmo pacote foi triado
// duas vezes na AMB sem aviso nenhum.
//
// Mesmo contrato da GOOD: { ok, registros: [...] }, aceitando um segundo
// identificador em ?tambem= (a mesma devolucao pode ter sido gravada pelo
// shipment num bipe e pela chave da NF noutro).
router.get('/api/triagem/status/:identificador', auth.requerLogin, async (req, res) => {
  const ident = String(req.params.identificador || '').trim();
  if (!ident) return res.status(400).json({ ok: false, erro: 'identificador obrigatorio' });

  // b166.1 - aceita VARIOS ?tambem=, porque o mesmo pacote pode ter sido
  // gravado por portas diferentes (shipment num bipe, numero da NF noutro,
  // rastreio dos Correios num terceiro). Express entrega repetidos como
  // array; um valor so vem como string.
  const brutos = req.query.tambem;
  const lista = Array.isArray(brutos) ? brutos : (brutos ? [brutos] : []);
  const ids = [ident];
  for (const t of lista) {
    const v = String(t || '').trim();
    if (v && !ids.includes(v)) ids.push(v);
  }

  const r = await db.triagensDe(ids);
  if (!r.ok) return res.status(500).json({ ok: false, erro: r.erro });
  return res.json({ ok: true, registros: r.registros, ids_buscados: ids });
});

router.get('/api/triagem/recentes', auth.requerLogin, async (req, res) => {
  res.json(await db.listarRecentes(req.query.limite));
});

/** Saude do banco (admin). */
router.get('/db/teste', admin, async (req, res) => {
  res.json({ ok: true, versao: VERSAO, supabase: await db.testeDeVida(), tabelas: db.tabelas });
});

// ── FILAS DA TRIAGEM (Aprovadas x Problemas, como na GOOD) ───
router.get('/api/triagem/fila', auth.requerLogin, async (req, res) => {
  const status = req.query.status === 'problema' ? 'problema' : 'aprovado';
  const r = await db.listarFila({ status });
  // b200.1 (Codex): o campo e `registros` — `listarFila` devolve
  // { ok, total, registros }. Eu enriquecia `itens` e `data`, que nao
  // existem, entao a decodificacao nao chegava em NADA na AMB.
  //
  // Conferido na fonte antes de escrever desta vez.
  if (r && Array.isArray(r.registros)) r.registros = marcadores.enriquecer(r.registros);
  if (!r.ok) return res.json(r);
  // junta o link da NF DA VENDA no Bling (id vem do indice de nomes)
  const registros = (r.registros || []).map(x => {
    const venda = nfNomes.acharPorPedido(x.order_id) || nfNomes.acharPorNumero(x.nf_numero);
    return {
      ...x,
      nf_id_bling: (venda && venda.id) || null,
      link_nf_bling: venda && venda.id
        ? `https://www.bling.com.br/notas.fiscais.php#edit/${venda.id}` : null,
    };
  });
  res.json({ ok: true, status, total: registros.length, registros });
});

// ── DEPOSITOS (a lista viva do Bling da AMB) ─────────────────
// b283 - os ids fiscais desta empresa, pro painel parar de te-los cravados.
// A natureza vem da API (achada pelo nome); o id da empresa nao tem API na
// v3 do Bling (GET /empresas da 404), entao vem de env por empresa.
router.get('/api/ids-fiscais', auth.requerLogin, async (req, res) => {
  res.json({ ok: true, ...(await bling.idsFiscais()) });
});

router.get('/api/depositos', auth.requerLogin, async (req, res) => {
  res.json({ ok: true, ...(await bling.listarDepositos(req.query.refresh === '1')) });
});

// diagnostico com 1 clique: quais depositos existem no Bling da AMB
router.get('/depositos', admin, async (req, res) => {
  res.json({ ok: true, versao: VERSAO, ...(await bling.listarDepositos(true)) });
});

/**
 * Lanca a ENTRADA de estoque da NF de devolucao no deposito
 * escolhido (mesma chamada da GOOD: POST /nfe/{id}/lancar-estoque/{dep}).
 * Exige o card com a devolucao VINCULADA (nf_devolucao_id_bling) —
 * sem o id, o Bling nao tem em qual nota lancar.
 */
router.post('/api/triagem/:id/lancar-estoque', auth.requerAdmin, async (req, res) => {
  const reg = await db.obterTriagem(req.params.id);
  if (!reg.ok) return res.status(404).json(reg);
  const t = reg.registro;
  if (!t.nf_devolucao_id_bling) {
    return res.status(400).json({ ok: false,
      erro: 'este card ainda nao tem a NF de devolucao VINCULADA - registre pela caixinha colando o LINK do Bling (o link traz o id)' });
  }
  // deposito precisa existir no Bling da AMB (whitelist viva)
  const deps = await bling.listarDepositos(false);
  const idDep = String((req.body || {}).deposito_id || '').trim();
  const dep = deps.ok ? (deps.depositos || []).find(d => d.id === idDep) : null;
  if (!dep) {
    return res.status(400).json({ ok: false, erro: 'deposito invalido ou lista indisponivel',
      depositos_validos: deps.ok ? deps.depositos : null });
  }

  const r = await bling.lancarEstoqueNf(t.nf_devolucao_id_bling, dep.id);
  if (!r.ok) return res.status(502).json(r);

  // marca no card; se as colunas nao existirem no banco, segue ok
  const upd = await db.atualizarTriagem(t.id, {
    estoque_lancado_em: new Date().toISOString(),
    estoque_deposito: dep.descricao,
  });
  res.json({ ok: true, deposito: dep.descricao,
    persistiu: upd.ok, aviso: upd.ok ? null : ('lancou no Bling, mas nao gravou no card: ' + upd.erro) });
});

/** NF de devolucao gerada no Bling -> registra o numero no card. */
router.put('/api/triagem/:id/nf-devolucao', auth.requerAdmin, async (req, res) => {
  let { numero, id_bling, texto } = req.body || {};
  // b20 - aceita o LINK do Bling colado inteiro: extrai o id do #edit/{id}
  if (!id_bling && texto) {
    const m = String(texto).match(/#edit\/(\d{6,})/) || String(texto).match(/\b(\d{9,})\b/);
    if (m) id_bling = m[1];
    if (!numero) { const mn = String(texto).match(/\b(\d{3,8})\b/); if (mn && mn[1] !== id_bling) numero = mn[1]; }
  }
  if (!numero && id_bling) {
    // completa o numero direto do Bling
    const rNf = await bling.chamarBling(`/nfe/${id_bling}`);
    const nf = rNf.ok && rNf.data && rNf.data.data;
    if (nf && nf.numero) numero = String(nf.numero);
  }
  if (!numero && !id_bling) {
    return res.status(400).json({ ok: false, erro: 'cole o numero OU o link da NF de devolucao no Bling' });
  }
  res.json(await db.atualizarTriagem(req.params.id, {
    nf_devolucao_numero: numero ? String(numero) : '(ver Bling)',
    nf_devolucao_id_bling: id_bling ? String(id_bling) : null,
  }));
});

/** Concluida: some das filas. */
router.post('/api/triagem/:id/concluir', auth.requerAdmin, async (req, res) => {
  res.json(await db.atualizarTriagem(req.params.id, { status: 'finalizado' }));
});

/** A Bridge da AMB grava aqui o resultado da NF gerada (mesmo
 *  contrato da GOOD: PUT registrar-devolucao-gerada/:id). */
router.put('/api/admin/registrar-devolucao-gerada/:id', auth.requerAdmin, async (req, res) => {
  const { nf_devolucao_id_bling, nf_devolucao_numero } = req.body || {};
  if (!nf_devolucao_id_bling && !nf_devolucao_numero) {
    return res.status(400).json({ ok: false, erro: 'sem dados da NF gerada' });
  }
  res.json(await db.atualizarTriagem(req.params.id, {
    nf_devolucao_id_bling: nf_devolucao_id_bling ? String(nf_devolucao_id_bling) : null,
    nf_devolucao_numero: nf_devolucao_numero ? String(nf_devolucao_numero) : null,
  }));
});

/** Debug com 1 clique: o que cada card da espreita esta recebendo
 *  de verdade + a saude dos indices e do enriquecimento. */
router.get('/debug/espreita', admin, async (req, res) => {
  const base = mlReturns.resumoEspreita();
  const um = (base.em_transito || [])[0] || (base.entregues || [])[0] || null;
  res.json({ ok: true, versao: VERSAO,
    indice_ml: mlReturns.statusIndice(),
    indice_nomes: nfNomes.statusIndice(),
    primeiro_item_cru: um,
    entregues_amostra: (base.entregues || []).slice(0, 2) });
});

// ── b334 — SONDA TikTok (frente devolucoes TikTok) ───────────
// Igual a da GOOD (lib/rotas-debug.js): puxa via ponte o que o
// Mover-Pedidos guarda das devolucoes TikTok. ?coletar=1&dias=60
// coleta antes; ?limite=N. Publico: /amb/api/debug/tiktok-devolucoes
// A empresa vai carimbada aqui porque este arquivo E o modulo da
// AMB (regra do b324: ponto unico, nunca por chamada).
router.get('/api/debug/tiktok-devolucoes', admin, async (req, res) => {
  try {
    const r = await tiktokPonte.sondaDevolucoes('ambtotal', req.query);
    res.status(r.ok ? 200 : 502).json(r);
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 200) });
  }
});

// ── A ESPREITA (o que esta vindo pro galpao) ─────────────────
router.get('/api/espreita', auth.requerLogin, async (req, res) => {
  // b29 - cada fonte com a propria rede de protecao: uma quebrar
  // NUNCA derruba as outras, e o erro vai ESCRITO pro painel.
  const vazio = { quente: false, em_transito: [], entregues: [], aguardando_postagem: 0 };
  let baseML = vazio, baseShopee = vazio, baseMagalu = vazio;
  let erroML = null, erroShopee = null, erroMagalu = null;
  try { baseML = mlReturns.resumoEspreita(); } catch (e) { erroML = e.message; }
  try { baseShopee = await shopee.resumoEspreita(); } catch (e) { erroShopee = e.message; }
  try { baseMagalu = magalu.resumoEspreita(); } catch (e) { erroMagalu = e.message; }
  const stML = mlReturns.statusIndice();
  const stNomes = nfNomes.statusIndice() || {};
  // b36 - AUTOCURA do índice de NOMES (espelho da b29 pro ML): é ele
  // que dá cliente/NF/valor pra Shopee — frio = tela seca sem aviso.
  if (!stNomes.quente && !stNomes.construindo) {
    try { nfNomes.construirIndice().catch(() => {}); } catch (e) {}
  }
  const notas = await db.notasEspreita();
  const mapa = notas.ok ? notas.notas : {};

  // Junta a anotacao manual, o "NF de devolucao ja emitida ✓" e
  // esconde o que ja foi baixado.
  const idsPraNF = [];   // b35 - vendas cuja NF vamos buscar em background
  const enriquecer = (lista) => (lista || []).map(x => {
    const n = mapa[x.tracking] || mapa[x.pedido] || null;
    const nf = nfEntrada.jaEmitida({ pedido: x.pedido });
    // b17 - cliente e NF DA VENDA vem do indice de nomes (numeroLoja
    // do Bling = numero do pedido no marketplace, pros 3 canais)
    // b27 - venda de CARRINHO: o Bling grava o numero do PACK no
    // numeroLoja, nao o do pedido — cobrimos os dois + o numero da NF
    const venda = nfNomes.acharPorPedido(x.pedido)
      || nfNomes.acharPorPedido(x.pack_id)
      || nfNomes.acharPorNumero(x.nf_ml_numero);
    // b34 - Shopee/TikTok/Amazon: sem NF casada, a VENDA do Bling
    // (numeroLoja garantido) entrega cliente e valor mesmo assim.
    // b38 - vendaLoja tambem pelo PACK (ML de carrinho grava numeroLoja
    // = pack_id, nao order_id) — sem isso a NF-pela-venda nunca
    // disparava pros cards ML de carrinho, e por isso a 🧾 sumia deles.
    const vendaLoja = venda ? null
      : (nfNomes.acharVendaPorLoja(x.pedido) || nfNomes.acharVendaPorLoja(x.pack_id));
    // id da venda pra buscar a NF vinculada — de qualquer fonte que tenha
    const idVendaNF = (venda && venda.id_venda) || (vendaLoja && vendaLoja.id_venda) || null;
    // b39 - a NF-pela-venda agora e lida por numeroLoja (a chave que o
    // card SEMPRE tem: x.pedido ou x.pack_id), nao por id_venda (que
    // dependia do vendaLoja resolver). A busca em background preenche.
    const chaveLoja = x.pedido || x.pack_id || null;
    const nfv = (!x.nf_ml_numero && !(venda && venda.numero))
      ? (nfNomes.nfDaLoja(x.pedido) || nfNomes.nfDaLoja(x.pack_id) ||
         (idVendaNF ? nfNomes.nfDaVenda(idVendaNF) : null)) : null;
    // enfileira {id, loja} pro disparo indexar nos dois mapas
    if (!x.nf_ml_numero && !(venda && venda.numero) && idVendaNF && !nfv) {
      idsPraNF.push({ id: idVendaNF, loja: chaveLoja });
    }
    // b47 - FULL: a NF do Full (Shopee serie 5, ML/Magalu Full serie 2/3/4)
    // entra por XML SEM numeroPedidoLoja, entao nao casa por pedido nem tem
    // venda-mae. Mas o NOME do cliente casa. Se nenhuma via achou a NF ainda,
    // busca por nome no indice em memoria (sincrono). O cliente vem da venda,
    // vendaLoja ou do proprio marketplace.
    const jaTemNf = !!(x.nf_ml_numero || (venda && venda.numero) || (nfv && nfv.numero));
    const nomeCli = (venda && venda.nome) || (vendaLoja && vendaLoja.nome) || x.cliente_ml || x.cliente || null;
    const nfNome = (!jaTemNf && nomeCli) ? nfNomes.acharNfPorNomeIndice(nomeCli) : null;
    // b18 - link direto pro marketplace, pedido do Diego no painel
    let link = null;
    if (x.marketplace === 'ml' && x.pedido) {
      link = `https://www.mercadolivre.com.br/vendas/${x.pedido}/detalhe`;
    } else if (x.marketplace === 'shopee' && x.pedido) {
      // b29 - a rota do Mover-Pedidos faz o de-para order_sn -> id
      // interno e cai DENTRO do pedido (mesma solucao dos checkouts;
      // exige a conta Shopee da AMB logada no navegador de destino)
      link = 'https://mover-pedidos-aguardando-x-atendido.onrender.com/amb-checkout-offline/ir-shopee?sn=' +
        encodeURIComponent(x.pedido);
    } else if (x.marketplace === 'magalu' && x.pedido) {
      // b29 - modulo magalu-oauth (API oficial): resolve o UUID do
      // pacote e abre a tela exata do pedido no portal
      link = 'https://mover-pedidos-aguardando-x-atendido.onrender.com/magalu/ir/amb?n=' +
        encodeURIComponent(x.pedido);
    }
    return {
      ...x,
      link_marketplace: link,
      cliente: (venda && venda.nome) || (vendaLoja && vendaLoja.nome) || x.cliente_ml || null,
      nf_venda: x.nf_ml_numero || (venda && venda.numero) || (nfv && nfv.numero) || (nfNome && nfNome.numero) || null,
      // b38 - serie da NF, da mesma fonte que deu o numero
      nf_serie: x.nf_ml_serie || (venda && venda.serie) || (nfv && nfv.serie) || (nfNome && nfNome.serie) || null,
      nf_valor: (venda && venda.valor != null) ? venda.valor
        : (vendaLoja && vendaLoja.valor != null) ? vendaLoja.valor
        : (x.valor_venda != null ? x.valor_venda : null),
      link_nf_bling: (venda && venda.id) ? ('https://www.bling.com.br/notas.fiscais.php#edit/' + venda.id)
        : (nfNome && nfNome.id) ? ('https://www.bling.com.br/notas.fiscais.php#edit/' + nfNome.id) : null,
      comentario: n && n.comentario, ticket: n && n.ticket,
      baixado: !!(n && n.baixado),
      nf_devolucao_emitida: nf.emitida === true ? (nf.nf && nf.nf.numero) || true : false,
    };
  }).filter(x => !x.baixado);

  const emTransito = [
    ...enriquecer(baseML.em_transito),
    ...enriquecer(baseShopee.em_transito),
    ...enriquecer(baseMagalu.em_transito),
  ].sort((a, b) => (a.dias_em_transito ?? 9999) - (b.dias_em_transito ?? 9999));
  // b31 - pedido do Diego: TUDO junto (ML + Shopee + Magalu misturados)
  // e sempre o MAIS RECENTE em cima, o mais antigo embaixo.

  // b19 - pedidos ML que ainda estao sem itens/apelido: dispara o
  // enriquecimento agora, em background; a proxima atualizacao da
  // tela (4 min) ja vem preenchida.
  const pendentes = emTransito
    .concat(enriquecer(baseML.entregues))
    .filter(x => x.marketplace === 'ml' && !x.itens && x.pedido)
    .map(x => String(x.pedido)).slice(0, 60);
  // b36 - só dispara com o índice QUENTE: a busca de NF não pode
  // concorrer no Bling com a CONSTRUÇÃO (429 abortaria o build).
  if (stNomes.quente) nfNomes.dispararNfPorVenda(idsPraNF);
  if (pendentes.length) mlReturns.enriquecerLista(pendentes).catch(() => {});

  res.json({
    ok: true,
    versao: VERSAO,
    // b293 (teste dele, 19/08: "espreita nao trouxe resultado (...) Mercado
    // Livre: pronta · Shopee: pronta · Magalu: pronta · Índice de nomes:
    // pronta") - ESTE CAMPO NUNCA FOI PORTADO DA GOOD. O painel testa
    // `if (!d.ok || !d.quente)` e cai no aviso "ainda nao da pra montar a
    // lista"; sem `quente` no topo, `undefined` e sempre falso, entao a tela
    // ficava presa no aviso **mesmo com as quatro fontes prontas e a lista
    // pronta logo abaixo, no mesmo JSON**. Na GOOD a linha existe desde
    // sempre (server.js: `quente: magaluR.quente || mlR.quente || shopeeR.quente`).
    // Basta UMA fonte quente pra ter o que mostrar; as outras aparecem
    // quando aquecerem, e o bloco de fontes segue dizendo o estado de cada uma.
    quente: !!(baseML.quente || baseShopee.quente || baseMagalu.quente),
    fontes: {
      ml: { quente: baseML.quente, construindo: !!stML.construindo,
            erro: erroML || stML.erro || null, total_claims: stML.total_claims || 0 },
      shopee: { quente: baseShopee.quente, desligada: !!baseShopee.desligada, erro: erroShopee || baseShopee.erro || null,
                chegadas: baseShopee.chegadas || null },
      magalu: { quente: baseMagalu.quente, desligada: !!baseMagalu.desligada, falta: baseMagalu.falta || null },
      nf_entrada: nfEntrada.statusIndice(),
      nomes: { quente: !!stNomes.quente, construindo: !!stNomes.construindo,
               erro: stNomes.erro || stNomes.erro_busca || stNomes.erro_vendas || null,
               nfs: (stNomes.total_nfs != null ? stNomes.total_nfs : null),
               vendas: (stNomes.vendas_com_loja != null ? stNomes.vendas_com_loja : null) },
    },
    em_transito: emTransito,
    atrasadas_30d: emTransito.filter(x => (x.dias_em_transito || 0) > 30).length,
    aguardando_postagem: baseML.aguardando_postagem,
    entregues: [...enriquecer(baseML.entregues),
      ...enriquecer(baseShopee.entregues || [])]
      .sort((x, y) => (x.dias_desde ?? 9999) - (y.dias_desde ?? 9999)),
  });
});

router.post('/api/espreita/nota', auth.requerLogin, async (req, res) => {
  const { chave, marketplace, comentario, ticket, baixado } = req.body || {};
  if (!chave) return res.status(400).json({ ok: false, erro: 'falta a chave' });
  res.json(await db.notaEspreita({ chave, marketplace, comentario, ticket, baixado }));
});

// ── RECADOS PRO ESTOQUISTA ───────────────────────────────────
router.get('/api/recados', auth.requerLogin, async (req, res) => {
  res.json(await db.listarRecados({ resolvidos: req.query.resolvidos === '1' }));
});

router.post('/api/recados', auth.requerLogin, async (req, res) => {
  const { identificador, texto } = req.body || {};
  if (!identificador || !texto) {
    return res.status(400).json({ ok: false, erro: 'informe identificador e texto' });
  }
  res.json(await db.criarRecado({ identificador, texto, criadoPor: req.usuario }));
});

router.post('/api/recados/:id/ciente', auth.requerLogin, async (req, res) => {
  res.json(await db.marcarCiente(req.params.id, req.usuario));
});

router.post('/api/recados/:id/resolver', auth.requerLogin, async (req, res) => {
  res.json(await db.resolverRecado(req.params.id));
});

// ── DEFEITOS ─────────────────────────────────────────────────
router.get('/api/defeitos', auth.requerLogin, async (req, res) => {
  res.json(await db.listarDefeitos({ busca: req.query.q }));
});

/** Lancar produto que JA esta quebrado no galpao (nao veio de devolucao). */
router.post('/api/defeitos/lancar', auth.requerLogin, async (req, res) => {
  const { sku, descricao, localizacao, quantidade } = req.body || {};
  if (!sku || !localizacao) {
    return res.status(400).json({ ok: false, erro: 'informe ao menos sku e localizacao' });
  }
// b258 (regra dele: "é esse o SKU que vai comandar") - o de-para vale
  // TAMBEM na hora de GRAVAR. Sem isto, a peca entrava no estoque de
  // defeitos com o codigo aposentado do anuncio Full: o alerta de
  // canibalizacao nao casaria com as unidades do codigo atual, e a NF
  // de devolucao sairia com um SKU que nao existe mais no cadastro.
  let skuUsar = String(sku);
  let skuOriginal = null;
  if (db && typeof db.resolverSku === 'function') {
    try {
      const dp = await db.resolverSku(skuUsar);
      if (dp && dp.trocado && dp.sku) { skuOriginal = skuUsar; skuUsar = dp.sku; }
    } catch (e) { /* de-para e ajuda, nunca trava o registro */ }
  }
  // Valida o SKU no Bling antes de gravar: evita defeito fantasma
  // por causa de um codigo digitado errado.
  const prod = await bling.buscarProdutoPorSku(skuUsar);
  const exato = prod.ok ? prod.exato : null;

  const r = await db.registrarTriagem({
    tipo: 'defeito_estoque',
    status: 'concluido',
    produto_sku: exato ? exato.codigo : skuUsar,   // b258 - SKU atual manda
    produto_titulo: exato ? exato.nome : null,
    problema_descricao: descricao || null,
    localizacao,
    defeito_qtd: Number(quantidade || 1),
    funcionario: req.usuario,
  });
  res.json({ ...r, sku_validado_no_bling: !!exato });
});

/** Ha o mesmo SKU guardado em defeito? (canibalizacao) */
router.get('/api/defeitos/sku', auth.requerLogin, async (req, res) => {
  res.json(await db.defeitosDoSku(req.query.sku));
});

router.post('/api/defeitos/peca', auth.requerLogin, async (req, res) => {
  const { defeito_id, peca, usada_em } = req.body || {};
  res.json(await db.registrarPecaRetirada({ defeitoId: defeito_id, peca, usadaEm: usada_em, quem: req.usuario }));
});

// ── SHOPEE / MAGALU / NF-ENTRADA (diagnostico e indices) ─────
router.get('/shopee/teste', admin, async (req, res) => {
  try {
    const lista = await shopee.buscarDevolucoesProxy(req.query.refresh === '1');
    res.json({ ok: true, versao: VERSAO, loja: shopee.cfg.loja, ativo: shopee.cfg.ativo,
      total: Array.isArray(lista) ? lista.length : null,
      amostra: Array.isArray(lista) ? lista.slice(0, 2) : null });
  } catch (e) {
    res.json({ ok: false, loja: shopee.cfg.loja, erro: e.message,
      dica: 'se o erro for loja desconhecida, o shopee-nf-sync nao tem a loja amb cadastrada' });
  }
});

router.get('/magalu/status', admin, (req, res) => {
  res.json({ ok: true, versao: VERSAO, magalu: magalu.statusIndice() });
});

router.get('/magalu/indice/construir', admin, (req, res) => {
  magalu.construirIndice().catch(e => console.error('[AMB/MAGALU]', e.message));
  res.json({ ok: true, iniciado: true });
});

// b152 - sonda do bipe Magalu: testa o acharDevolucao por dentro, sem a
// tela. Ex: /amb/magalu/achar?codigo=2026062600477033&k=ADMIN_KEY
router.get('/magalu/achar', admin, async (req, res) => {
  const codigo = String(req.query.codigo || '').trim();
  if (!codigo) return res.status(400).json({ ok: false, erro: 'passe ?codigo=' });
  try {
    const dev = await magalu.acharDevolucao(codigo);
    res.json({
      ok: true, versao: VERSAO, codigo,
      achou: !!dev, devolucao: dev,
      tickets: magalu.statusIndice().tickets,
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

// b155 - RAIO-X da remessa reversa: devolve o JSON CRU do
// /seller/v0/tickets/{id}/returns, campo a campo, direto da API oficial.
// Motivo: a doc publica esconde o schema, e a fase 2 do indice so varria
// tickets ABERTOS - mas os dados reais da AMB (06/08) mostraram que o
// Magalu FECHA o ticket com o pacote ainda viajando. Esta rota constata
// o que a API expoe pra qualquer ticket, aberto ou fechado.
// Ex: /amb/magalu/ticket/UUID-DO-TICKET/returns?k=ADMIN_KEY
router.get('/magalu/ticket/:id/returns', admin, async (req, res) => {
  try {
    const r = await magalu.remessasReversasDoTicket(String(req.params.id || ''));
    res.json({ ok: true, versao: VERSAO, ticket_id: req.params.id, http: r.status, cru: r.data });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

router.get('/nf/entrada/indice', admin, (req, res) => {
  res.json({ ok: true, versao: VERSAO, indice: nfEntrada.statusIndice() });
});

router.get('/nf/entrada/indice/construir', admin, (req, res) => {
  nfEntrada.construirIndice().catch(e => console.error('[AMB/NF-ENTRADA]', e.message));
  res.json({ ok: true, iniciado: true });
});

/** Um clique e o Diego descobre qual tipo lista as devolucoes. */
router.get('/nf/entrada/sonda', admin, async (req, res) => {
  res.json({ ok: true, versao: VERSAO,
    procure: 'o tipo cuja natureza diga Devolucao de venda',
    depois: 'grave o numero em AMB_NF_ENTRADA_TIPO no Render (padrao atual: ' + (process.env.AMB_NF_ENTRADA_TIPO || '0') + ')',
    tipos: await nfEntrada.sondarTipos() });
});

/** b336 - Calibragem do aviso "ja tem NF de devolucao": QUAIS naturezas
 *  aparecem nas notas de ENTRADA e quais delas o aviso aceita hoje.
 *  Diferente de /api/admin/indice-nf-devolucao (que abre nota por nota e leva
 *  minutos), esta so LISTA — responde em segundos e nao precisa de login.
 *  A descricao da natureza nao vem na listagem do Bling, entao detalhamos UMA
 *  nota por natureza (punhado de chamadas) so pra dar nome ao id. */
/** b336 r5 - o que ja foi descoberto sobre a natureza de uma nota fica aqui,
 *  pra que rodadas seguintes da calibragem SOMEM em vez de recomecar. Teto
 *  simples: passou do limite, esquece as mais antigas (Map guarda a ordem de
 *  insercao).
 *  b336 r6 (Codex #79): eu tinha escrito "natureza de nota emitida nao muda" e
 *  dispensado validade — mas esta rota so descarta cancelada/denegada, entao
 *  RASCUNHO entra, e nele a natureza ainda pode ser preenchida ou trocada no
 *  Bling depois. Duas defesas: valor nao resolvido (null) nao e guardado, e o
 *  que fica guardado vence em 6h, revalidando sozinho. */
const NF_NAT_CACHE_AMB = new Map();   // idDaNota -> { id, descricao, em }
const NF_NAT_CACHE_MAX = 3000;
const NF_NAT_CACHE_TTL = 6 * 60 * 60 * 1000;
function guardarNaturezaAMB(idNota, natId, natDesc) {
  if (!natId) return;   // b336 r6 - nao resolvida: nao vira cache
  NF_NAT_CACHE_AMB.set(String(idNota), { id: natId, descricao: natDesc, em: Date.now() });
  while (NF_NAT_CACHE_AMB.size > NF_NAT_CACHE_MAX) {
    NF_NAT_CACHE_AMB.delete(NF_NAT_CACHE_AMB.keys().next().value);
  }
}
function naturezaDoCacheAMB(idNota) {
  const at = NF_NAT_CACHE_AMB.get(String(idNota));
  if (!at) return null;
  if ((Date.now() - at.em) > NF_NAT_CACHE_TTL) { NF_NAT_CACHE_AMB.delete(String(idNota)); return null; }
  return at;
}

router.get('/nf/entrada/naturezas', admin, async (req, res) => {
  try {
    const tipo = String(req.query.tipo != null ? req.query.tipo : (process.env.AMB_NF_ENTRADA_TIPO || '0'));
    // b336 r3 (Codex #79): o padrao e 6 paginas porque e ASSIM que o painel
    // monta o indice de verdade (painel-AMB.html chama ?paginas=6). Calibrar
    // com 3 podia esconder uma natureza que so aparece nas paginas 4-6 e
    // ainda assim dizer que a leitura foi completa.
    const paginas = Math.min(Math.max(Number(req.query.paginas) || 6, 1), 10);
    const idsDevolucao = String(process.env.AMB_NATUREZAS_DEVOLUCAO_IDS || process.env.AMB_NATUREZA_DEVOLUCAO || '15110882041')
      .split(',').map(s => s.trim()).filter(Boolean);
    const NFE_DESCARTAVEL = new Set([2, 9]);

    const porNatureza = new Map();   // id -> { qtd, exemplo_nf, exemplo_id, exemplo_contato, descricao }
    let lidas = 0, descartadas = 0, falhaLista = false;
    for (let p = 1; p <= paginas; p++) {
      const r = await bling.chamarBling(`/nfe?tipo=${tipo}&pagina=${p}&limite=100`);
      if (!r.ok) { falhaLista = true; break; }
      const lista = r.data?.data || [];
      if (!lista.length) break;
      for (const n of lista) {
        if (NFE_DESCARTAVEL.has(Number(n.situacao))) { descartadas++; continue; }
        lidas++;
        const id = String(n.naturezaOperacao?.id != null ? n.naturezaOperacao.id : 'sem_natureza');
        const at = porNatureza.get(id) || { qtd: 0, exemplo_nf: n.numero, exemplo_id: n.id, exemplo_contato: n.contato?.nome || null, descricao: n.naturezaOperacao?.descricao || null, ids_sem_natureza: [] };
        at.qtd++;
        // b336 r3 (Codex #79): a listagem as vezes vem SEM naturezaOperacao,
        // mas o indice de verdade tira a natureza do DETALHE — ou seja, essas
        // notas podem ser devolucao e entrar no aviso. Guardamos os ids pra
        // abrir uma por uma no passe seguinte, em vez de despachar todas como
        // "sem_natureza" e declarar a leitura completa.
        if (id === 'sem_natureza') at.ids_sem_natureza.push({ id: n.id, numero: n.numero, contato: n.contato?.nome || null });
        porNatureza.set(id, at);
      }
      if (lista.length < 100) break;
    }
    // b336 r3 (Codex #79): resolve as notas que vieram SEM natureza na
    // listagem, abrindo uma a uma (teto pra nao virar a rota lenta que esta
    // veio substituir; o que passar do teto deixa a leitura incompleta).
    const TETO_SEM_NATUREZA = 40;
    // b336 r4/r5 (Codex #79): a listagem as vezes vem sem naturezaOperacao e
    // so o detalhe revela. Duas armadilhas ja pegas aqui:
    //  r4 - sem avanco, toda chamada reabria as MESMAS 40 e a leitura nunca
    //       fechava, com a rota mandando "tente de novo" como se fosse falha
    //       do Bling;
    //  r5 - com cursor (?pular=N) ela avancava mas RECOMECAVA a contagem: a
    //       ultima fatia se declarava completa mostrando so as notas dela, e
    //       uma natureza que aparecesse numa fatia anterior sumia do resultado.
    // Solucao: o que ja foi resolvido fica GUARDADO (NF_NAT_CACHE_AMB). Cada
    // rodada gasta seu orcamento abrindo notas NOVAS e soma as antigas de
    // graca, entao o resultado so cresce e a ultima rodada tem tudo. Basta
    // repetir a MESMA URL ate sem_natureza_nao_lidas chegar a zero.
    let falhaDetalhe = 0, semNaturezaNaoLidas = 0, semNaturezaTotal = 0, resolvidasDoCache = 0;
    const pendentes = porNatureza.get('sem_natureza');
    if (pendentes) {
      const fila = pendentes.ids_sem_natureza || [];
      semNaturezaTotal = fila.length;
      porNatureza.delete('sem_natureza');
      let orcamento = TETO_SEM_NATUREZA;
      for (const nota of fila) {
        let natId = null, natDesc = null, falhou = false;
        const emCache = naturezaDoCacheAMB(nota.id);
        if (emCache) {
          natId = emCache.id; natDesc = emCache.descricao; resolvidasDoCache++;
        } else if (orcamento > 0) {
          orcamento--;
          try {
            const rD = await bling.chamarBling(`/nfe/${nota.id}`);
            if (rD.ok) {
              const nat = rD.data?.data?.naturezaOperacao || null;
              natId = nat && nat.id != null ? String(nat.id) : null;
              natDesc = (nat && nat.descricao) || null;
              guardarNaturezaAMB(nota.id, natId, natDesc);
            } else falhou = true;
          } catch (e) { falhou = true; }
          if (falhou) falhaDetalhe++;
          await new Promise(r => setTimeout(r, 120));
        } else {
          semNaturezaNaoLidas++;   // fica pra proxima rodada
          continue;
        }
        const chave = natId || 'sem_natureza';
        const at = porNatureza.get(chave) || { qtd: 0, exemplo_nf: nota.numero, exemplo_id: nota.id, exemplo_contato: nota.contato, descricao: natDesc, ids_sem_natureza: [] };
        at.qtd++;
        if (!at.descricao && natDesc) at.descricao = natDesc;
        if (chave === 'sem_natureza') at.descricao_indisponivel = true;
        porNatureza.set(chave, at);
      }
    }

    // b337 r3 (Codex #80): a descricao DA NOTA continua sendo buscada no
    // detalhe (uma nota por natureza), porque e ELA que o indice le. Ao trocar
    // a fonte do NOME pelo catalogo eu apaguei este passe — e com isso uma
    // natureza cuja nota diz "devolucao" so no detalhe aparecia como excluida,
    // e a rota mandava por na env um id que ja estava valendo. O catalogo dá o
    // nome de exibicao; o detalhe diz o que o indice enxerga. Os dois convivem.
    for (const [id, at] of porNatureza) {
      if (id === 'sem_natureza' || at.descricao_nota) continue;
      if (at.descricao) { at.descricao_nota = at.descricao; continue; }   // ja veio na listagem
      try {
        const rD = await bling.chamarBling(`/nfe/${at.exemplo_id}`);
        if (rD.ok) at.descricao_nota = rD.data?.data?.naturezaOperacao?.descricao || null;
        else { falhaDetalhe++; at.descricao_indisponivel = true; }
      } catch (e) { falhaDetalhe++; at.descricao_indisponivel = true; }
      await new Promise(r => setTimeout(r, 120));
    }

    // b337 - NOME DA NATUREZA VEM DO CATALOGO, nao da nota.
    // A b336 tirava a descricao do detalhe da NF-e (naturezaOperacao.descricao)
    // e na conta da AMB isso volta SEMPRE null: rodada real de 21/08 leu 456
    // notas e as 4 naturezas sairam sem nome nenhum — a rota nao cumpria o que
    // ela existe pra fazer. O catalogo `/naturezas-operacoes` tem id+descricao
    // (a sonda da b283 ja provou: 22 itens, e la esta "Devolucao de Mercadoria
    // - Entrada"), e a lib ja sabe consultar (bling.listarNaturezas).
    let catalogoOk = false, catalogoErro = null, semNomeNoCatalogo = 0;
    try {
      const rCat = await bling.listarNaturezas(false);
      if (rCat.ok) {
        catalogoOk = true;
        const porId = new Map((rCat.naturezas || []).map(n => [String(n.id), n.descricao]));
        for (const [id, at] of porNatureza) {
          if (id === 'sem_natureza') continue;
          // b337 r2/r3 (Codex #80): a descricao da NOTA ja foi guardada no
          // passe acima — o catalogo so preenche o nome de exibicao.
          // b337 r4 (Codex #80): quando a natureza vem sem descricao, a lib
          // devolve o rotulo sintetico "natureza <id>" — que NAO identifica
          // nada. Aceita-lo como nome valido liberava a calibragem com o
          // operador sem saber o que aquilo e.
          const bruto = porId.get(String(id));
          const nome = (bruto && bruto !== ('natureza ' + id)) ? bruto : null;
          if (nome) { at.descricao = nome; at.descricao_via = 'catalogo'; }
          else if (at.descricao_nota) {
            // b337 r4 (Codex #80): faltou no catalogo mas a NOTA tem nome —
            // isso identifica a natureza, entao serve de exibicao e NAO e
            // motivo pra suspender a calibragem.
            at.descricao = at.descricao_nota; at.descricao_via = 'nota';
          } else { at.descricao_indisponivel = true; semNomeNoCatalogo++; }
        }
      } else catalogoErro = rCat.erro || ('status ' + rCat.status);
    } catch (e) { catalogoErro = String(e.message || e); }
    // catalogo fora do ar = ninguem tem nome; dizer "leitura completa" aqui
    // seria repetir o erro da b336 r2 (conselho de calibragem com cara de
    // resultado bom).
    if (!catalogoOk) {
      for (const [id, at] of porNatureza) {
        if (id === 'sem_natureza') continue;
        // b337 r4 - sem catalogo, o nome da nota ainda identifica a natureza
        if (!at.descricao && at.descricao_nota) { at.descricao = at.descricao_nota; at.descricao_via = 'nota'; }
        if (!at.descricao) at.descricao_indisponivel = true;
      }
    }

    const naturezas = [...porNatureza.entries()].map(([id, at]) => ({
      id,
      descricao: at.descricao,
      descricao_indisponivel: !!at.descricao_indisponivel,
      qtd: at.qtd,
      exemplo_nf: at.exemplo_nf,
      exemplo_contato: at.exemplo_contato,
      descricao_via: at.descricao_via || (at.descricao ? 'nota' : null),
      descricao_da_nota: at.descricao_nota || null,
      // b337 - `entra_no_aviso` continua sendo o que o INDICE faz hoje, e o
      // indice le a descricao da NOTA (que vem vazia nesta conta) — nao a do
      // catalogo. Marcar true so porque o catalogo diz "devolucao" prometeria
      // um aviso que nao acontece. O nome do catalogo serve pra DECIDIR; quem
      // liga de fato e o id na env.
      entra_no_aviso: (id !== 'sem_natureza' && idsDevolucao.indexOf(id) >= 0)
        || /devolu/i.test(String(at.descricao_nota || '')),
      parece_devolucao_pelo_nome: /devolu/i.test(String(at.descricao || '')),
      // b336 r2 (Codex #79): valor pronto POR NATUREZA. Nunca uma env com
      // TODAS as rejeitadas juntas — isso metia compra de fornecedor,
      // transferencia e conserto no aviso de uma vez. Quem decide se aquela
      // natureza e devolucao de cliente e o Diego, uma a uma.
      se_for_devolucao_de_cliente_use: (id === 'sem_natureza' || (idsDevolucao.indexOf(id) >= 0))
        ? null
        : idsDevolucao.concat([id]).join(','),
    })).sort((a, b) => b.qtd - a.qtd);

    // b337 - sem catalogo nao ha nome nenhum: isso e leitura incompleta.
    // b337 r2 (Codex #80): id que nao esta no catalogo tambem suspende — o
    // operador nao consegue identificar aquela natureza, que e exatamente a
    // situacao que esta rota existe pra evitar.
    const incompleto = falhaLista || falhaDetalhe > 0 || semNaturezaNaoLidas > 0 || !catalogoOk || semNomeNoCatalogo > 0;
    res.json({ ok: true, versao: VERSAO, tipo_lido: tipo, paginas_pedidas: paginas,
      leitura_incompleta: incompleto,
      falha_na_listagem: falhaLista, descricoes_que_falharam: falhaDetalhe,
      catalogo_de_naturezas_ok: catalogoOk, catalogo_erro: catalogoErro,
      naturezas_sem_nome_no_catalogo: semNomeNoCatalogo,
      sem_natureza_total: semNaturezaTotal,
      sem_natureza_ja_resolvidas: resolvidasDoCache,
      sem_natureza_nao_lidas: semNaturezaNaoLidas,
      notas_lidas: lidas, canceladas_ou_denegadas: descartadas,
      env_atual: idsDevolucao,
      naturezas,
      o_que_fazer: !catalogoOk
        ? 'SEM O CATALOGO DE NATUREZAS (o Bling nao respondeu /naturezas-operacoes) — as naturezas ficam sem nome e nao da pra decidir; rode de novo daqui a pouco'
        : semNomeNoCatalogo > 0
        ? `${semNomeNoCatalogo} natureza(s) usada(s) nas notas NAO estao no catalogo (descricao_indisponivel=true) — sem nome nao da pra decidir se e devolucao de cliente. Nao calibre; avise que o catalogo precisa ser lido alem da 1a pagina`
        : (falhaLista || falhaDetalhe > 0)
        ? 'LEITURA INCOMPLETA — o Bling falhou em parte das consultas; nao calibre com este resultado, rode de novo daqui a pouco'
        : (semNaturezaNaoLidas > 0
          ? `FALTA LER ${semNaturezaNaoLidas} nota(s) (nao e erro do Bling): abra ESTA MESMA URL de novo — cada rodada avanca e SOMA com as anteriores. Calibre so quando sem_natureza_nao_lidas chegar a 0`
          : 'olhe as naturezas com entra_no_aviso=false: se ALGUMA delas for devolucao de cliente (o exemplo_contato ajuda a reconhecer), cole o campo se_for_devolucao_de_cliente_use dela em AMB_NATUREZAS_DEVOLUCAO_IDS no Render. Uma de cada vez — nao junte todas') });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

// ── Testes ───────────────────────────────────────────────────
router.get('/bling/teste', admin, async (req, res) => {
  res.json({ ok: true, versao: VERSAO, resultado: await bling.testeDeVida() });
});

router.get('/bling/produto', admin, async (req, res) => {
  const sku = req.query.sku;
  if (!sku) return res.status(400).json({ ok: false, erro: 'falta o sku' });
  res.json(await bling.buscarProdutoPorSku(String(sku)));
});

router.get('/ml/teste', admin, async (req, res) => {
  res.json({ ok: true, versao: VERSAO, resultado: await ml.testeDeVida() });
});

// b271 - liga as preventivas das SEIS integracoes (AMB e GOOD), escalonadas
// pra nao disputarem a escrita das env vars nem o aquecimento dos indices.
// Empresa nova entra so registrando na lib — este bloco nao muda.
// b271 - liga as preventivas de TODAS as integracoes registradas, de todas
// as empresas, escalonando o primeiro disparo (pra nao disputarem a escrita
// das env vars nem o aquecimento dos indices). Empresa ou integracao nova
// entra so registrando na lib — este bloco NAO muda.
// b272 - o REGISTRO ja se agenda sozinho (lib/token-preventiva). Aqui so
// carregamos os modulos da GOOD, que se registram ao serem exigidos, e
// deixamos uma varredura de seguranca pra qualquer registro que tenha vindo
// com autoLigar:false.
(function carregarPreventivas() {
  try { require('../lib/ml'); } catch (e) { /* ausente = segue */ }
  try { require('../lib/bling'); } catch (e) { /* ausente = segue */ }
  try {
    const { ligarPendentes, listar } = require('../lib/token-preventiva');
    const n = ligarPendentes({ inicioMinutos: 2, passoMinutos: 6 });
    console.log(`[tokens] ${listar().length} integracao(oes) registrada(s)` + (n ? ` · ${n} agendada(s) pela varredura` : ''));
  } catch (e) { /* renovacao nunca pode impedir o modulo de subir */ }
})();

// b264 - conferir/forcar na hora, sem esperar o timer
router.get('/ml/token/preventiva', admin, async (req, res) => {
  res.json({ ok: true, versao: VERSAO, resultado: await ml.renovacaoPreventiva({ forcar: req.query.forcar === '1' }) });
});

// b271 - relatorio de TODAS as integracoes registradas, de TODAS as empresas
// (a lib e quem sabe quem existe). Empresa nova aparece aqui sozinha, sem
// mexer nesta rota.
router.get('/tokens/preventiva', admin, async (req, res) => {
  const { relatorio, listar } = require('../lib/token-preventiva');
  // b272 (review do Codex) - RENOVAR PRIMEIRO, listar DEPOIS. Em objeto
  // literal o `listar()` era avaliado ANTES do `await`, então com ?forcar=1 a
  // resposta trazia a data ANTIGA em `registradas` ao lado do "renovado
  // agora" em `empresas` — dois carimbos contraditórios no mesmo JSON.
  const empresas = await relatorio({ forcar: req.query.forcar === '1' });
  res.json({ ok: true, versao: VERSAO, registradas: listar(), empresas });
});

router.get('/ml/eu', admin, async (req, res) => {
  res.json(await ml.quemSouEu());
});

// Etiqueta de defeito (QZ Tray + fila remota) — registrada ANTES
// do 404: o Express casa rotas na ordem em que foram declaradas,
// e o pega-tudo engoliria qualquer coisa registrada depois dele.
impressao.registrarRotas(router, auth.requerLogin);

// ── 404 do modulo ────────────────────────────────────────────
// b55 - LEVA 1a do porte GOOD -> AMB: rotas que a tela de bipe da GOOD usa e
// que a AMB nao tinha (busca de produto, EAN por SKU, foto de evidencia,
// status de triagem). Tem que ser montado ANTES do catch-all 404 abaixo.
// b74 - passa a VERSAO pro compat: o /health mostrava um numero fixo
// ('AMB b68') e a tela imprimia ele no topo, desencontrado do servidor.
compat.montar(router, { auth, db, bling, cfg, multer, versao: VERSAO });

// b61 - LEVA 4a do porte GOOD -> AMB: as 13 rotas /api/admin/* que o
// painel usa (fotos, itens da NF, vincular/lancar Full, lancar por NF,
// preparar e registrar a devolucao gerada, concluir...). O modulo e o
// MESMO da GOOD, sem edicao: ele recebe tudo por injecao, e um Router
// do express tem .get/.post/.put igual ao app.
const dorme = (ms) => new Promise(r => setTimeout(r, ms));
// ══════════════════════════════════════════════════════════════════════
// b73 - A DIFERENCA QUE QUEBRAVA A NF EM TODOS OS CANAIS
// O codigo copiado da GOOD faz: rFull.data.data  (o envelope CRU do Bling).
// Mas o buscarNFePorId da AMB devolve {ok, nfe:{...}} — ja desembrulhado e
// com OUTRA CHAVE. Resultado: a busca achava o id da NF e o detalhe vinha
// null, entao numero e serie saiam vazios e a tela dizia "NF nao achada"
// mesmo com a nota existindo (id 26351839464 = NF 2228, caso real).
// Aqui passamos o CRU, no formato que o codigo da GOOD espera.
// ══════════════════════════════════════════════════════════════════════
const nfePorIdCru = (id) => bling.chamarBling(`/nfe/${id}`);
const nfp = criarNfPessoa({ chamarBling: bling.chamarBling, sleep: dorme });
const ajudantes = criarAdminHelpers({
  chamarBling: bling.chamarBling,
  chamarML: ml.chamarML,
  buscarNFePorId: nfePorIdCru,   // b73 - formato cru, como a GOOD espera
  sleep: dorme,
});
// b71 - a rota /api/devolucao/identificar da GOOD, que a tela de bipe
// espera. Os ajudantes: 5 de claim/return do ML vem do ml-buscas (copia
// da GOOD), 2 do admin-helpers, 2 do nf-pessoa, e o resto dos modulos
// que a AMB ja tinha (ml, bling, magalu, shopee, nf-nomes).
const mlBuscas = criarMlBuscas(ml.chamarML);
// b95 - ciclo do estoque de defeitos (ficha, comentarios, pedidos)
registrarCicloDefeitos(router, { auth, db, bling, cfg });

registrarIdentificar(router, {
  // b180 - TikTok na cascata da AMB (paridade com a GOOD). Passar por
  // parametro, nao pelo escopo: usar o escopo ja derrubou o boot 2x neste
  // projeto (b300 e b302 no lado da GOOD).
  tiktokPonte: require('../lib/tiktok-ponte'),
  tiktokDev: require('../lib/tiktok-devolucoes'),
  buscarNFsPorNumero: nfp.buscarNFsPorNumero,   // b237 - faltava (NF nao localizada)
  db,   // b213 - pro recado do estoquista aparecer na triagem
  supabase: db.conectar(),   // ev2 - registro do checkout offline
  requerLogin: auth.requerLogin,
  sleep: dorme,
  chamarML: ml.chamarML,
  chamarBling: bling.chamarBling,
  chamarMagalu: magalu.chamarMagalu,
  buscarNFnoML: ajudantes.buscarNFnoML,
  buscarNFePorId: nfePorIdCru,   // b73 - formato cru, como a GOOD espera
  buscarNFBlindada: ajudantes.buscarNFBlindada,
  buscarNFnoBlingPorNumero: ajudantes.buscarNFnoBlingPorNumero,
  mapItensNF: nfp.mapItensNF,
  resolverIdNFPorChave: nfp.resolverIdNFPorChave,
  buscarClaimsPorShipment: mlBuscas.buscarClaimsPorShipment,
  buscarClaimDetalhada: mlBuscas.buscarClaimDetalhada,
  buscarReturnPorClaim: mlBuscas.buscarReturnPorClaim,
  buscarOrderViaShipmentReturn: mlBuscas.buscarOrderViaShipmentReturn,
  buscarOrdersPorComprador: mlBuscas.buscarOrdersPorComprador,
  classificarMotivoDevolucao: ajudantes.classificarMotivoDevolucao,
  acharDevolucao: shopee.acharDevolucao,
  buscarPorNome: nfNomes.buscarPorNome,
  shopee, nfNomes,         // a rota usa shopee.cfg.ativo e nfNomes.colapsar
  // ═══════════════════════════════════════════════════════════════════
  // b142 - mlReturns FALTAVA AQUI, e era a causa do bipe de etiqueta
  // Correios reverso nunca funcionar na AMB. A rota chama
  // mlReturns.acharPorTracking() dentro de um try/catch; sem a injecao
  // dava ReferenceError, o catch engolia e devolvia null - entao o
  // sintoma aparecia como "rastreio nao encontrado", nunca como erro.
  // ═══════════════════════════════════════════════════════════════════
  mlReturns,
  // b71 - RAMO DO MAGALU DESLIGADO POR ORA: a rota da GOOD espera um
  // cliente com .cfg.ativo/.cfg.autorizado e .acharDevolucao(); o
  // magalu-AMB tem outra interface (temCredenciais/temToken/porPedido).
  // Em vez de adivinhar o de-para, deixo o ramo inerte — devolucao do
  // Magalu cai no "nao encontrado" ate eu portar isso direito. ML,
  // Shopee, NF, chave e nome funcionam normalmente.
  // ═══════════════════════════════════════════════════════════════════
  // b152 - RAMO DO MAGALU RELIGADO: o magalu-AMB agora tem a interface
  // que a rota da GOOD espera (cfg{ativo,autorizado} + acharDevolucao
  // pelos tickets P:protocolo/R:reverse_code/O:pedido, com fallback pela
  // espreita do BFF) e o chamarMagalu aceita caminho relativo. O objeto
  // inerte da b71 sai; devolucao do Magalu passa a identificar no bipe.
  // ═══════════════════════════════════════════════════════════════════
  magalu,
});

registrarRotasAdminNF(router, {
  tabelaDevolucoes: db.tabelas.devolucoes,   // b144 - devolucoes_amb
  supabase: db.conectar(),
  requerAdmin: auth.requerAdmin,
  // usado nas fotos: aceita sessao de admin OU a chave ?k=ADMIN_KEY
  adminOk: (req) => !!auth.validarSessao(auth.tokenDaRequisicao(req), 'admin')
    || !!(process.env.ADMIN_KEY && req.query.k === process.env.ADMIN_KEY),
  sleep: dorme,
  chamarBling: bling.chamarBling,
  chamarML: ml.chamarML,
  buscarNFnoML: ajudantes.buscarNFnoML,
  // b159 - dep que FALTAVA. rotas-admin-AMB (copia do modulo da GOOD) usa
  // buscarNFnoBlingPorNumero em 2 rotas, mas ela nunca foi injetada AQUI:
  // na GOOD ela e global no server.js. Resultado: /api/admin/resolver-id-nf
  // e a busca por numero respondiam 500 "buscarNFnoBlingPorNumero is not
  // defined" toda vez que a NF precisava ser achada pelo NUMERO (card sem
  // o id do Bling). O registrarIdentificar logo acima ja passava certo.
  buscarNFnoBlingPorNumero: ajudantes.buscarNFnoBlingPorNumero,
  buscarNFePorId: nfePorIdCru,   // b73 - formato cru, como a GOOD espera
  buscarNFBlindada: ajudantes.buscarNFBlindada,
  resolverIdNFPorChave: nfp.resolverIdNFPorChave,
  mapItensNF: nfp.mapItensNF,
  buscarNFsPorNumero: nfp.buscarNFsPorNumero,   // b212 - raio-x da busca por numero
  buscarNfDevolucaoBling: nfp.acharNfDevolucaoBling,   // b255
  nomesBatemNf: nfp.nomesBatem,   // b316 - MESMO comparador do casamento
  listarDepositos: bling.listarDepositos,   // b276
});


// ═══════════════════════════════════════════════════════════════════
// b328 - INDICE DE NFs DE DEVOLUCAO **DA AMB**.
//
// Achado ao portar o aviso do card (b326/b327): os dois paineis da AMB ja
// chamavam `/api/admin/indice-nf-devolucao` — que e a rota **DA GOOD**, na
// raiz. Ou seja, o botao de cruzamento na AMB vinha lendo as notas de
// entrada da GOOD e cruzando com pedidos da AMB: nunca casaria nada, e se
// casasse por coincidencia de numero de pedido seria pior ainda.
//
// Mesmo erro de familia que a b324 (a AMB usando dado da GOOD), agora numa
// rota de leitura. Cada empresa consulta o PROPRIO Bling.
// ═══════════════════════════════════════════════════════════════════
const NF_DEV_TTL_AMB = 15 * 60 * 1000;
const NF_DEV_INDICE_AMB = new Map();   // pedido -> { nf, data, contato }
let NF_DEV_SEM_PEDIDO_AMB = [];        // b335 - notas SEM pedido (caso Full): o painel casa por cliente+SKU
let NF_DEV_IGNORADAS_AMB = {};         // b335 r2 - naturezas que ficaram FORA do casamento (id -> contagem)
let NF_DEV_CACHE_OK_AMB = false;       // b335 r2 - build valido, mesmo que os dois lados venham vazios
let NF_DEV_INDICE_TS_AMB = 0;
let NF_DEV_CARREGANDO_AMB = null;

async function montarIndiceNFDevolucaoAMB(maxPaginas) {
  // b335 r2 (Codex #78): o guard usava NF_DEV_INDICE_AMB.size — se as entradas
  // recentes fossem TODAS do Full (sem pedido), o mapa ficava vazio e CADA
  // request reconstruia os ~600 detalhes de novo, com 120ms de pausa cada,
  // ignorando o TTL. A flag diz "o build terminou", independente do formato.
  if ((Date.now() - NF_DEV_INDICE_TS_AMB) < NF_DEV_TTL_AMB && NF_DEV_CACHE_OK_AMB) return;
  if (NF_DEV_CARREGANDO_AMB) return NF_DEV_CARREGANDO_AMB;
  NF_DEV_CARREGANDO_AMB = (async () => {
    const novo = new Map();
    const semPedido = [];
    try {
      const paginas = Math.min(maxPaginas || 5, 15);
      // b335 - o TIPO vem da MESMA env do indice da espreita (AMB_NF_ENTRADA_TIPO,
      // padrao '0'). A sonda /amb/nf/entrada/sonda de 20/08 provou nesta conta:
      // tipo=0 lista as ENTRADAS (devolucoes, inclusive as da MAGALU LOG do Full)
      // e tipo=1 lista as VENDAS — ate a b334 este indice usava tipo=1 cravado,
      // ou seja, indexava VENDA achando que era devolucao (o aviso nunca casava).
      const tipoEntrada = String(process.env.AMB_NF_ENTRADA_TIPO || '0');
      // b335 r2 (Codex #78): tipo=0 traz TODAS as entradas — compra de
      // fornecedor, transferencia, conserto... Pro casamento cliente+SKU so
      // entram notas cuja natureza seja RECONHECIVEL como devolucao: id na
      // lista da env AMB_NATUREZAS_DEVOLUCAO_IDS (padrao: a mesma
      // AMB_NATUREZA_DEVOLUCAO da busca acharNfDevolucaoBling) OU descricao
      // contendo "devolu". O que ficar de fora e contado por natureza em
      // `naturezas_ignoradas` — e por ali que se descobre um id novo (ex.: o
      // das notas da MAGALU LOG do Full, se a descricao nao vier) pra por na env.
      const idsDevolucao = String(process.env.AMB_NATUREZAS_DEVOLUCAO_IDS || process.env.AMB_NATUREZA_DEVOLUCAO || '15110882041')
        .split(',').map(s => s.trim()).filter(Boolean);
      const ignoradas = {};
      // b335 r3 (Codex #78): NF CANCELADA (2) e DENEGADA (9) nao valem como
      // "ja tem nota" — o admin-helpers-AMB ja trata as duas como descartaveis
      // (nfeViva). Se entrassem, o operador leria "nao precisa gerar de novo"
      // e o cliente ficaria sem a nota valida.
      const NFE_DESCARTAVEL = new Set([2, 9]);
      const nfeViva = (n) => !NFE_DESCARTAVEL.has(Number(n && n.situacao));
      let falhaLista = false;
      let falhasDetalhe = 0;
      // 1) lista as notas de entrada (so id + numero, rapido)
      const ids = [];
      for (let p = 1; p <= paginas; p++) {
        const r = await bling.chamarBling(`/nfe?tipo=${tipoEntrada}&pagina=${p}&limite=100`);
        // b335 r3 (Codex #78): o chamarBling NAO joga excecao — devolve
        // {ok:false}. Sem esta checagem uma queda do Bling virava "lista vazia"
        // e o build seguia como se tivesse dado certo.
        if (!r.ok) { falhaLista = true; break; }
        const lista = r.data?.data || [];
        if (!lista.length) break;
        for (const n of lista) {
          if (!nfeViva(n)) continue;   // b335 r3 - cancelada/denegada nem detalha
          ids.push({ id: n.id, numero: n.numero, serie: n.serie != null ? n.serie : null, dataEmissao: n.dataEmissao, contato: n.contato?.nome || null, situacao: n.situacao });
        }
        if (lista.length < 100) break;
      }
      // b335 r3 - queda na listagem: mantem o indice anterior e NAO marca cache
      // valido, pra proxima chamada tentar de novo em vez de servir vazio por 15min.
      if (falhaLista && !ids.length) return;
      // 2) detalha cada nota pra pegar o numeroPedidoLoja (em lotes, com pausa)
      for (const it of ids) {
        try {
          const rD = await bling.chamarBling(`/nfe/${it.id}`);
          // b335 r3 (Codex #78): detalhe que falhou nao pode virar nota "sem
          // pedido" — sem o numeroPedidoLoja ela cairia no casamento por
          // cliente+SKU sem nunca ter sido lida. Pula e conta a falha.
          if (!rD.ok) { falhasDetalhe++; await new Promise(r => setTimeout(r, 120)); continue; }
          const d = rD.data?.data || {};
          if (!nfeViva({ situacao: d.situacao != null ? d.situacao : it.situacao })) { await new Promise(r => setTimeout(r, 120)); continue; }
          const pedido = String(d.numeroPedidoLoja || '').replace(/\s/g, '');
          // b335 - a base carrega TUDO que o aviso precisa: id (link pro Bling),
          // serie, os SKUs de todos os itens e a natureza — de graca, o detalhe
          // ja estava na mao (era jogado fora quando o pedido vinha vazio).
          const nat = d.naturezaOperacao || null;
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
          // b335 r4 (Codex #78): o filtro de natureza vale pros DOIS ramos. Ter
          // numeroPedidoLoja nao prova que a nota e devolucao — tipo=0 traz
          // entrada comum tambem, e uma delas com pedido preenchido disparava o
          // "nao precisa gerar de novo" sem passar por filtro nenhum.
          const natId = String((nat && nat.id) || '');
          const ehDevolucao = (natId && idsDevolucao.indexOf(natId) >= 0) || /devolu/i.test(String((nat && nat.descricao) || ''));
          if (!ehDevolucao) {
            ignoradas[natId || 'sem_natureza'] = (ignoradas[natId || 'sem_natureza'] || 0) + 1;
          } else if (pedido) {
            novo.set(pedido, base);
          } else {
            // b335 - nota SEM pedido (caso Full: o Bling importa a NF-e sem o
            // vinculo — campos de referencia vem nulos desde julho). E daqui
            // que o painel casa por cliente+SKU.
            semPedido.push(base);
          }
        } catch (e) { /* pula essa nota */ }
        await new Promise(r => setTimeout(r, 120));
      }
      NF_DEV_INDICE_AMB.clear();
      for (const [k, v] of novo) NF_DEV_INDICE_AMB.set(k, v);
      NF_DEV_SEM_PEDIDO_AMB = semPedido;   // b335
      NF_DEV_IGNORADAS_AMB = ignoradas;    // b335 r2
      NF_DEV_CACHE_OK_AMB = true;          // b335 r2 - build terminou (vazio de verdade tambem vale)
      // b335 r3 (Codex #78): build INCOMPLETO (Bling caiu no meio) vale, mas
      // com validade curta — 2 min em vez de 15. Nem serve resultado furado
      // por 15 minutos, nem remonta 600 notas a cada request.
      const parcial = falhaLista || falhasDetalhe > 0;
      NF_DEV_INDICE_TS_AMB = parcial ? (Date.now() - NF_DEV_TTL_AMB + 2 * 60 * 1000) : Date.now();
    } catch (e) { /* mantem o indice anterior */ }
    finally { NF_DEV_CARREGANDO_AMB = null; }
  })();
  return NF_DEV_CARREGANDO_AMB;
}

// rota: dispara/consulta o indice. O front chama e depois cruza com o a espreita.

// b328 - rota da AMB, espelhando a da GOOD. O painel da AMB passa a chamar
// ESTA, e nao mais a da raiz (que le o Bling da GOOD).
// ============================================================
// b191 - VENDAS ESTORNADAS SEM RETORNO (porte da GOOD)
// ------------------------------------------------------------
// Mesma frente que subiu na GOOD hoje: vendas que o marketplace
// reembolsou sem devolucao fisica. A NF de venda continua emitida,
// gerando imposto sobre receita que nao existiu.
//
// [stated] Pedido dele: "tinha q ser lib, pra nao precisar portar né.
// pra sempre 1 ajuste pegar todas empresas."
//
// E e o que acontece aqui: TODA a logica vive em ../lib/ e recebe a
// empresa por parametro. Este bloco e so FIACAO — passa 'amb' onde a
// GOOD passa 'good'. Ajuste na lib pega as duas.
//
// A empresa e FIXA de proposito (nao vem da querystring): este servidor
// E o da AMB, e aceitar ?empresa=good deixaria o admin de uma ver os
// dados da outra.
// ============================================================
// b203 - a rota de DIAGNOSTICO da busca de NF, que so existia na GOOD.
//
// O dono tentou usar na AMB e levou "rota nao existe neste modulo". Sem
// ela, pra descobrir por que uma NF nao e achada aqui eu so chutaria — e
// foi exatamente o diagnostico que resolveu o caso do TikTok na GOOD.
//
// GET /amb/api/debug/achar-nf?pedido=1535470109716311&data=2026-05-10&k=ADMIN_KEY
// b199.1 (Codex) - REGISTRAR o caso, que so existia na GOOD.
//
// Os paineis da AMB chamam POST /amb/api/admin/sem-retorno/registrar desde
// que ganharam o botao — e a rota nao existia aqui. Todo clique dava 404.
//
// Mesma logica da GOOD, com a tabela e a empresa da AMB.
router.post('/api/admin/sem-retorno/registrar', auth.requerAdmin, async (req, res) => {
  try {
    const sb = db.cliente();
    if (!sb) return res.status(503).json({ ok: false, erro: 'Supabase nao configurado' });

    const d = req.body || {};
    const pedido = String(d.pedido || '').trim();
    if (!pedido) return res.status(400).json({ ok: false, erro: 'sem pedido, nao da pra registrar' });

    // JA EXISTE? devolve o id em vez de criar outro — clicar duas vezes
    // criaria duas portas pra emitir a mesma nota.
    const chaveCaso = String(d.chave_caso || '').trim();
    const legados = [d.chave_caso_legado, d.chave_caso_legado2]
      .map((x) => String(x || '').trim()).filter(Boolean);

    const { data: doPedido, error: erroBusca } = await sb
      .from(db.tabelas.devolucoes)
      .select('id, nf_devolucao_id_bling, problema_descricao')
      .eq('order_id', pedido);
    if (erroBusca) return res.status(500).json({ ok: false, erro: erroBusca.message });

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

    const { data, error } = await sb
      .from(db.tabelas.devolucoes)
      .insert({
        // b199.2 (Codex): a AMB filtra a fila pela coluna `status`, nao por
        // `tipo` — com 'pendente' o registro nunca apareceria em
        // "Aprovadas", que e justamente o que o botao promete.
        tipo: 'aprovado',
        status: 'aprovado',
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
        // o RASTRO: quem olhar depois precisa saber que NAO houve bipagem
        // `[DEFEITO]` na descricao: as filas leem `d.status || d.tipo` pra
        // decidir o deposito, e a palavra "defeito" ali faz `ehProblema`
        // casar. E o unico canal que atravessa sem coluna nova.
        problema_descricao: marcadores.montarDescricao({ ...d, chave_caso: chaveCaso }),
      })
      .select('id')
      .single();

    if (error) return res.status(500).json({ ok: false, erro: error.message });

    // b199.3 (Codex): CORRIDA entre duas abas. Nao ha indice unico pro
    // marcador, entao dois cliques simultaneos passam os dois pelo select
    // acima e criam DOIS registros da mesma devolucao — duas portas pra
    // emitir a mesma nota.
    //
    // Releio depois de inserir: se apareceu outro com o mesmo `[caso:X]` e
    // ele e mais antigo, apago o meu e devolvo o dele.
    if (chaveCaso) {
      try {
        const { data: dobrados } = await sb
          .from(db.tabelas.devolucoes)
          .select('id, problema_descricao')
          .eq('order_id', pedido);
        const mesmos = (dobrados || [])
          .filter((r) => String(r.problema_descricao || '').includes('[caso:' + chaveCaso + ']'))
          .sort((a, b) => Number(a.id) - Number(b.id));
        if (mesmos.length > 1 && String(mesmos[0].id) !== String(data.id)) {
          await sb.from(db.tabelas.devolucoes).delete().eq('id', data.id);
          return res.json({ ok: true, id: mesmos[0].id, ja_existia: true, corrida_resolvida: true });
        }
      } catch (e) { /* na duvida fica o que inseri; o front nao duplica sozinho */ }
    }

    return res.json({ ok: true, id: data.id, ja_existia: false });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 200) });
  }
});

router.get('/api/debug/achar-nf', (req, res, next) => {
  // b203.1 (Codex): aceitar ?k=ADMIN_KEY, que e o que a doc da rota diz —
  // e exigir ADMIN, nao qualquer login. Com `requerLogin` puro, a chave era
  // ignorada e um estoquista logado veria dado de nota fiscal.
  const chave = String(req.query.k || '').trim();
  if (chave && process.env.ADMIN_KEY && chave === process.env.ADMIN_KEY) return next();
  return auth.requerAdmin ? auth.requerAdmin(req, res, next) : auth.requerLogin(req, res, next);
}, async (req, res) => {
  try {
    const pedido = String(req.query.pedido || '').trim();
    if (!pedido) return res.status(400).json({ ok: false, erro: 'passe ?pedido=' });
    const data = String(req.query.data || '').trim() || null;

    // b203.1 (Codex): `buscarNFnoBlingPorOrderId` NAO EXISTE nos ajudantes
    // da AMB — ha ate um comentario no proprio arquivo avisando ("bug
    // latente morto", b172). Eu chamei mesmo assim, aqui e no #124.
    //
    // A AMB tem a `buscarNFBlindada`, que ja faz o filtro direto por
    // numeroLoja na FASE 0 dela — o mesmo caminho que resolveu o caso do
    // TikTok na GOOD.
    const r = await ajudantes.buscarNFBlindada({
      orderId: pedido,
      dataReferencia: data,
      // b203.2 (Codex): a blindada le `maxPaginasJanela` e `maxPaginasFundo`
      // — `maxPaginas` ela IGNORA. Eu passava o nome errado e o ?paginas=
      // nao tinha efeito nenhum.
      maxPaginasJanela: parseInt(req.query.paginas, 10) || 12,
      maxPaginasFundo: parseInt(req.query.paginas, 10) || 12,
    });

    return res.json({
      ok: true,
      empresa: 'amb',
      pedido,
      data_referencia: data,
      // a blindada devolve { ok, via, nf, idNF, trace } — nao { match }
      achou: !!(r && r.ok && (r.nf || r.idNF)),
      via: (r && r.via) || null,
      // b203.3 (Codex): mostrar o ID mesmo sem o detalhe. Corrigi isso no
      // CARD e esqueci aqui — se a blindada acha o id e falha no detalhe,
      // o diagnostico dizia `nf: null` e parecia que nao tinha achado.
      id_achado: (r && (r.idNF || (r.nf && r.nf.id))) || undefined,
      nf: (r && r.nf) ? {
        id: r.nf.id || r.idNF, numero: r.nf.numero,
        numeroPedidoLoja: r.nf.numeroPedidoLoja,
        numeroLoja: r.nf.numeroLoja,
        data: r.nf.dataEmissao || r.nf.data,
        chave: r.nf.chaveAcesso,
      } : null,
      // o `trace` dela conta o que cada FASE tentou — e o diagnostico
      trace: (r && r.trace) || undefined,
      tentado: (r && r.tentado) || undefined,
      // b203.2 (Codex): os `via` REAIS da blindada sao `nfe-numeroLoja`
      // (fase 0, uma chamada), `nfe-janela-orderId` e `nfe-fundo-orderId`.
      // Eu documentei `filtro_direto`, que e o nome que uso na GOOD — o
      // dono leria a resposta procurando um valor que nunca aparece.
      leia: '`via: nfe-numeroLoja` = achou numa chamada so (o melhor caso). '
        + '`nfe-janela-orderId` ou `nfe-fundo-orderId` = precisou varrer. '
        + 'Se `achou:false`, veja `tentado` e `trace`: eles contam o que cada fase fez. '
        + 'Filtro por numeroLoja sem resultado = o pedido esta em outro campo no Bling.',
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 300) });
  }
});

router.get('/api/admin/sem-retorno', auth.requerLogin, async (req, res) => {
  try {
    const sb = db.cliente();
    if (!sb) return res.status(503).json({ ok: false, erro: 'Supabase nao configurado' });

    const EMPRESA = 'amb';
    const dias = Math.min(730, Math.max(1, parseInt(req.query.dias, 10) || 365));
    const desde = new Date(Date.now() - dias * 864e5).toISOString();
    const AGORA = Date.now();

    // 1) o que a captura guardou (TikTok: reembolso puro concluido)
    const { data: cap, error: erroCap } = await sb
      .from('devolucoes_capturadas')
      .select('*')
      .eq('empresa', EMPRESA)
      .eq('tipo_tiktok', 'REFUND')
      .gte('criado_no_mkt', desde)
      .in('status', ['RETURN_OR_REFUND_REQUEST_COMPLETE', 'REFUND_SUCCESS', 'COMPLETE', 'SUCCESS'])
      .order('criado_no_mkt', { ascending: false })
      .limit(500);
    if (erroCap) return res.status(500).json({ ok: false, erro: erroCap.message });

    const semRetorno = (cap || []).filter((d) =>
      String(d.status || '').toUpperCase().indexOf('CANCEL') === -1);

    // 2) o Magalu, pela ponte com o Mover-Pedidos
    let magaluItens = [];
    let magaluErro = null;
    try {
      const rm = await magaluCancelados.buscar(EMPRESA, {
        de: new Date(AGORA - dias * 864e5).toISOString().slice(0, 10),
        ate: new Date().toISOString().slice(0, 10),
      });
      if (rm.ok) magaluItens = rm.itens;
      else magaluErro = rm.erro;
    } catch (e) {
      magaluErro = String(e.message || e).slice(0, 150);
    }

    // 3) quem JA foi triado sai: senao seriam duas portas pra mesma nota,
    //    e duas devolucoes emitidas sem ninguem perceber
    const pedidos = [...new Set(
      semRetorno.map((d) => d.pedido).concat(magaluItens.map((m) => m.pedido)).filter(Boolean)
    )];
    // b199.2 (Codex): separar o registro do CARD (tem `[caso:X]`) da triagem
    // de BIPE. O primeiro derruba so aquele caso; o segundo, o pedido todo —
    // ali o produto voltou de verdade. Sem isso, registrar UM caso sumia com
    // os irmaos do mesmo pedido, e o dono nao teria como voltar neles.
    const jaTriados = new Set();
    const casosRegistrados = new Set();
    for (let i = 0; i < pedidos.length; i += 200) {
      const { data: tri, error: erroTri } = await sb
        .from(db.tabelas.devolucoes)
        .select('order_id, problema_descricao')
        .in('order_id', pedidos.slice(i, i + 200));
      if (erroTri) {
        return res.status(500).json({
          ok: false,
          erro: 'nao consegui conferir quais ja foram triados: ' + erroTri.message
            + ' — listar sem essa checagem mostraria casos ja resolvidos',
        });
      }
      for (const t of (tri || [])) {
        const m = String(t.problema_descricao || '').match(/\[caso:([^\]]+)\]/);
        if (m) casosRegistrados.add(m[1]);
        else jaTriados.add(String(t.order_id));
      }
    }

    const itens = semRetorno.concat(magaluItens)
      .filter((d) => {
        if (casosRegistrados.has(String(d.id))) return false;
        if (d.id_legado && casosRegistrados.has(String(d.id_legado))) return false;
        if (d.id_legado2 && casosRegistrados.has(String(d.id_legado2))) return false;
        // b199.7 (Codex): o TikTok e identificado pela chave da solicitacao,
        // nao pelo `id` — sem isto um caso registrado pelo lote continuava
        // aparecendo, e o dono registraria de novo achando que falhou.
        if (d.chave_marketplace && casosRegistrados.has(String(d.chave_marketplace))) return false;
        return !jaTriados.has(String(d.pedido));
      })
      .map((d) => {
        // (o vinculo da NF no Bling e feito depois, em bloco)
        // o relogio conta da EMISSAO da nota. Data exata (Magalu) manda
        // sobre o mes da chave (TikTok), que manda sobre a devolucao.
        let base = null;
        let baseOrigem = null;
        if (d.nf_emitida_em) {
          const t = new Date(d.nf_emitida_em).getTime();
          if (Number.isFinite(t)) { base = t; baseOrigem = 'data_emissao'; }
        }
        const chave = String(d.nf_chave || '').replace(/\D/g, '');
        if (base == null && chave.length === 44) {
          const aa = parseInt(chave.slice(2, 4), 10);
          const mm = parseInt(chave.slice(4, 6), 10);
          if (aa >= 0 && mm >= 1 && mm <= 12) {
            base = Date.UTC(2000 + aa, mm - 1, 1);   // dia 1: leitura conservadora
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
          baseOrigem = 'devolucao';   // da MAIS prazo que o real
        }
        if (base == null && d.criado_em) {
          base = new Date(d.criado_em).getTime();
          baseOrigem = 'devolucao';
        }

        const diasDesde = base ? Math.floor((AGORA - base) / 864e5) : null;
        // quem ja voltou nao cancela (houve circulacao), e o Magalu nunca
        // cancela (nao temos prova de que a mercadoria nao saiu)
        const jaVoltou = !!d.tem_devolucao_registrada;
        // b195.4 (Codex): a MESMA regra da GOOD. O `nf_sem_saida` E a prova
        // de que o pedido nunca foi despachado, entao ali cancelar e o
        // certo — bloquear faria o dono perder o prazo de 20 dias.
        //
        // Isto e a divida do front aparecendo: a regra vive nos dois
        // servidores em vez de numa peca so, entao consertar num lado
        // deixa o outro para tras. Foi o que aconteceu aqui.
        const semProva = d.marketplace === 'magalu' && d.classe !== 'nf_sem_saida';
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
        const podeCancelar = dataConfiavel && !jaVoltou && !semProva && diasDesde != null && diasDesde <= 20;

        return {
          id: d.id,
          marketplace: d.marketplace,
          pedido: d.pedido,
          nf_numero: d.nf_numero,
          nf_chave: d.nf_chave,
          nf_id_bling: d.nf_id_bling || null,   // b192 - preenchido logo abaixo
          cliente: d.cliente_nome,
          produto: d.produto_titulo,
          sku: d.produto_sku,
          qtd: d.produto_qtd,
          valor: d.valor_refund != null ? d.valor_refund : d.valor,
          valor_rateado: d.valor_rateado || undefined,
          motivo: d.motivo_texto || d.motivo,
          dias_desde: diasDesde,
          prazo_base: baseOrigem,
          // b203.2 (Codex): as datas de ORIGEM vao no item — a busca por
          // pedido as usa pra montar a janela, e sem elas ia sempre null.
          nf_emitida_em: d.nf_emitida_em || undefined,
          cancelado_em: d.cancelado_em || undefined,
          criado_no_mkt: d.criado_no_mkt || undefined,
          acao: podeCancelar ? 'cancelar_nf' : 'nf_devolucao',
          prazo_cancelamento: podeCancelar ? Math.max(0, 20 - diasDesde) : 0,
          classe: d.classe || undefined,
          tem_devolucao_registrada: d.tem_devolucao_registrada || undefined,
          entrada_estoque: d.entrada_estoque,
          prejuizo_integral: d.prejuizo_integral || undefined,
        };
      });

    // b192 - VINCULAR A NF NO BLING, senao o card fica so com o aviso
    // "sem NF vinculada" — sem link e sem serventia. A chave manda: ela
    // carrega a competencia e a serie, e e o que o Magalu entrega.
    const INICIO_BUSCA = Date.now();
    // b192.1 (Codex): entram os que tem CHAVE **ou** so numero — nota com
    // numero e sem chave existe, e ficaria sem link a toa.
    // b192.2 (Codex): cota por marketplace, senao numa fila cheia de TikTok
    // o Magalu nao entraria — e sao os casos de maior valor.
// b204.1 (Codex): o cache roda ANTES de qualquer fila.
    //
    // Eu aplicava depois da fase da CHAVE, entao os casos ja resolvidos
    // eram re-buscados a cada refresh — gastando os 8s dela — e a fase do
    // NUMERO, que vem depois, ja encontrava o orcamento vencido e saia na
    // hora.
    vinculoCache.aplicar(itens, 'amb');

    const semVinculoAMB = itens.filter((x) => x.nf_chave && !x.nf_id_bling);
    const filaAMB = semVinculoAMB.filter((x) => x.marketplace === 'magalu').slice(0, 15)
      .concat(semVinculoAMB.filter((x) => x.marketplace !== 'magalu').slice(0, 10));

    for (const item of filaAMB) {
      // b204.1: a identidade de ANTES do enriquecimento — o refresh
      // seguinte le a linha crua e procura por ela.
      const idCache = vinculoCache.chaveDe(item, 'amb');
      if (Date.now() - INICIO_BUSCA > 8000) break;   // o painel nao pode travar
      try {
        // a busca PAGINA no Bling e pode passar dos 8s sozinha; o teto do
        // laco so e conferido entre itens. O prazo e o QUE SOBRA do
        // orcamento: perder o vinculo de um card e melhor que travar a tela.
        const sobra = Math.max(500, 8000 - (Date.now() - INICIO_BUSCA));
        const id = await Promise.race([
          nfp.resolverIdNFPorChave(item.nf_numero, item.nf_chave),
          // b203.6 (Codex): SEM flag aqui. Ao remover a declaracao orfa deste
          // laco eu deixei a ATRIBUICAO — ela escreveria numa variavel que
          // nao existe mais, dentro de um setTimeout, onde o try nao pega:
          // o processo podia cair.
          //
          // Este laco chama `resolverIdNFPorChave`, que nao aceita sinal de
          // parada. Sem alguem pra avisar, a flag aqui nao teria uso.
          new Promise((ok) => setTimeout(() => ok(null), Math.min(5000, sobra))),
        ]);
        if (id) item.nf_id_bling = String(id);
      } catch (e) { /* segue sem o link; o numero da NF esta no card */ }
    }

    // b196 - a mesma busca PELO PEDIDO da GOOD. Caso real: pedido do
    // TikTok sem numero e sem chave na captura (a API nao mandou), mas a
    // nota EXISTE no Bling. Sem isto o card fica so informativo.
    // ============================================================
    // BUSCA A NF PELO PEDIDO — pros casos sem numero e sem chave
    // ------------------------------------------------------------
    // Caso real: pedido do TikTok que aparecia "sem NF vinculada", mas a
    // nota EXISTE no Bling (o dono abriu e mostrou). A captura veio sem
    // numero e sem chave porque a API do marketplace nao mandou.
    //
    // Uso a `buscarNFBlindada` da AMB — `buscarNFnoBlingPorOrderId` NAO
    // existe neste modulo, e eu chamei ela por engano do #124 ate o #129,
    // entao esta busca NUNCA funcionou aqui.
    //
    // A blindada le `maxPaginasJanela`/`maxPaginasFundo` (nao `maxPaginas`),
    // devolve { ok, via, nf, idNF, trace } (nao { match }), e aceita
    // `parar()` pra desistir quando o chamador desiste.
    // ============================================================
    // b203 - PELA NOTA primeiro, aqui tambem. [stated] "vc tinha q tá
    // pegando nota fiscal. nf sim sempre terá." O pedido pode nao existir
    // (XML do Full importado nao cria pedido no Bling); a nota existe.


    let buscadas = 0;
    for (const item of itens.filter((x) => !x.nf_id_bling && x.nf_numero).slice(0, 25)) {
      // b204.1: a identidade de ANTES do enriquecimento — o refresh
      // seguinte le a linha crua e procura por ela.
      const idCache = vinculoCache.chaveDe(item, 'amb');
      // b204: reserva os ultimos segundos pra fase da CHAVE, que e exata
      if (Date.now() - INICIO_BUSCA > 6000) break;
      // b203.1 (Codex): RITMO. O Bling limita a 3 req/s, e sao ate 25 itens
      // seguidos aqui. Sem pausa, os primeiros levam 429 e o retry de 1,5s
      // de cada um come o orcamento inteiro — os ultimos nem sao tentados.
      if (buscadas > 0) await new Promise((ok) => setTimeout(ok, 350));
      buscadas++;
      try {
        const r = await Promise.race([
          ajudantes.buscarNFnoBlingPorNumero(item.nf_numero,
            item.nf_emitida_em || item.criado_no_mkt || null, { maxPaginas: 2 }),
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
          item.nf_achada_por = 'numero';
          vinculoCache.guardar(item, item.nf_id_bling, 'numero', { chave: item.nf_chave, numero: item.nf_numero }, 'amb', idCache);
        }
      } catch (e) { /* segue pros caminhos abaixo */ }
    }

    for (const item of itens.filter((x) => !x.nf_numero && !x.nf_chave && !x.nf_id_bling && x.pedido).slice(0, 10)) {
      // b204.1: a identidade de ANTES do enriquecimento — o refresh
      // seguinte le a linha crua e procura por ela.
      const idCache = vinculoCache.chaveDe(item, 'amb');
      if (Date.now() - INICIO_BUSCA > 12000) break;

      // a flag e DESTE laco: declaracao, atribuicao e uso no mesmo bloco.
      // Ja errei isso duas vezes — declarei num laco e usei noutro, depois
      // removi a declaracao e deixei a atribuicao orfa (que em strict mode
      // derruba o processo, porque acontece dentro do setTimeout).
      let desistiu = false;

      try {
        // o prazo e o que SOBRA do orcamento da rota, nao um valor fixo
        const prazo = Math.max(2000, Math.min(14000, 26000 - (Date.now() - INICIO_BUSCA)));
        const r = await Promise.race([
          ajudantes.buscarNFBlindada({
            parar: () => desistiu,
            orderId: item.pedido,
            // as datas vem do map acima; sem elas a blindada pula as fases
            // de janela e so tenta o filtro direto
            dataReferencia: item.nf_emitida_em || item.cancelado_em || item.criado_no_mkt || null,
            maxPaginasJanela: 6,
            maxPaginasFundo: 6,
          }),
          new Promise((ok) => setTimeout(() => { desistiu = true; ok(null); }, prazo)),
        ]);

        // ela pode achar o ID e falhar ao buscar o detalhe: { ok:true,
        // idNF, nf:null }. O id sozinho ja serve pro link e pra emissao.
        const achada = (r && r.ok && r.nf) || null;
        const idAchado = (achada && achada.id) || (r && r.ok && r.idNF) || null;
        if (idAchado) {
          item.nf_id_bling = String(idAchado);
          if (achada) {
            if (!item.nf_numero && achada.numero) item.nf_numero = String(achada.numero);
            if (!item.nf_chave && achada.chaveAcesso) item.nf_chave = achada.chaveAcesso;
          }
          item.nf_achada_por = 'pedido';
          vinculoCache.guardar(item, item.nf_id_bling, 'pedido', { chave: item.nf_chave, numero: item.nf_numero }, 'amb', idCache);
        }
      } catch (e) { /* segue sem a nota; o card continua so informativo */ }
    }

    // b203.7 (Codex): RECALCULAR a acao depois de enriquecer.
    //
    // A GOOD ja fazia isso desde o b188.1; a AMB nao — mais uma vez ela
    // ficou pra tras.
    //
    // O prazo sai da chave da NF-e. Se a chave so apareceu AGORA (veio do
    // Bling na busca acima), o item foi classificado com a data da
    // devolucao, que nao autoriza cancelamento. Sem recalcular, um caso
    // ainda cancelavel apareceria como "NF DE DEVOLUCAO" e o dono perderia
    // o prazo de 20 dias.
    for (const item of itens) {
      const chave = String(item.nf_chave || '').replace(/\D/g, '');
      // data exata manda sobre a chave, que so da o mes
      if (chave.length !== 44 || item.prazo_base === 'chave_nfe'
          || item.prazo_base === 'data_emissao') continue;
      const aa = parseInt(chave.slice(2, 4), 10);
      const mm = parseInt(chave.slice(4, 6), 10);
      if (!(aa >= 0 && mm >= 1 && mm <= 12)) continue;
      const dias = Math.floor((AGORA - Date.UTC(2000 + aa, mm - 1, 1)) / 864e5);
      item.dias_desde = dias;
      item.prazo_base = 'chave_nfe';
      // as mesmas regras da classificacao original: quem voltou nao cancela,
      // e o Magalu so cancela em `nf_sem_saida`
      const podeAqui = !item.tem_devolucao_registrada
        && (item.marketplace !== 'magalu' || item.classe === 'nf_sem_saida')
        && dias <= 20;
      item.acao = podeAqui ? 'cancelar_nf' : 'nf_devolucao';
      item.prazo_cancelamento = podeAqui ? Math.max(0, 20 - dias) : 0;
    }

    itens.sort((a, b) => {
      if (a.acao !== b.acao) return a.acao === 'cancelar_nf' ? -1 : 1;
      if (a.acao === 'cancelar_nf') return a.prazo_cancelamento - b.prazo_cancelamento;
      return (b.valor || 0) - (a.valor || 0);
    });

    return res.json({
      ok: true,
      empresa: EMPRESA,
      total: itens.length,
      valor_total: Number(itens.reduce((t, x) => t + (Number(x.valor) || 0), 0).toFixed(2)),
      podem_cancelar: itens.filter((x) => x.acao === 'cancelar_nf').length,
      magalu_erro: magaluErro || undefined,
      por_marketplace: itens.reduce((acc, x) => {
        const m = x.marketplace || 'outro';
        acc[m] = (acc[m] || 0) + 1;
        return acc;
      }, {}),
      itens,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 200) });
  }
});

router.get('/api/admin/indice-nf-devolucao', auth.requerLogin, async (req, res) => {
  try {
    await montarIndiceNFDevolucaoAMB(Number(req.query.paginas || 5));
    const mapa = {};
    for (const [ped, info] of NF_DEV_INDICE_AMB) mapa[ped] = info;
    return res.json({ ok: true, total: NF_DEV_INDICE_AMB.size, atualizado_em: NF_DEV_INDICE_TS_AMB,
      tipo_usado: String(process.env.AMB_NF_ENTRADA_TIPO || '0'),   // b335
      pedidos: mapa,
      sem_pedido: NF_DEV_SEM_PEDIDO_AMB,   // b335 - notas sem vinculo (Full): o painel casa por cliente+SKU
      naturezas_ignoradas: NF_DEV_IGNORADAS_AMB,   // b335 r2 - entradas fora do casamento, contadas por natureza
      cache_ok: NF_DEV_CACHE_OK_AMB,   // b335 r3 - false = o Bling falhou e nao ha indice confiavel ainda
      // b335 r4 (Codex #78): idade medida no relogio do SERVIDOR. O painel
      // calcula a validade a partir dela (e nao de Date.now() na chegada),
      // senao o TTL curto de um build parcial virava 15 min no navegador.
      idade_ms: Math.max(0, Date.now() - NF_DEV_INDICE_TS_AMB) });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

router.use((req, res) => {
  res.status(404).json({
    ok: false,
    erro: 'rota nao existe neste modulo',
    modulo: 'amb-devolucoes',
    versao: VERSAO,
    rotas: [
      '/amb/conectar', '/amb/status', '/amb/config',
      '/amb/ml/indice', '/amb/ml/indice/construir', '/amb/ml/rastreio', '/amb/ml/espreita',
      '/amb/identificar', '/amb/nf/nome', '/amb/nf/itens', '/amb/nf/indice', '/amb/nf/indice/construir',
      '/amb/api/auth/login', '/amb/api/auth/me', '/amb/api/triagem/identificar', '/amb/api/triagem/registrar',
      '/amb/auth/diag', '/amb/db/teste', '/amb/api/nf/itens', '/amb/api/triagem/recentes',
      '/amb/painel', '/amb/api/espreita', '/amb/api/recados', '/amb/api/defeitos',
      '/amb/shopee/teste', '/amb/magalu/status', '/amb/nf/entrada/sonda', '/amb/nf/entrada/naturezas', '/amb/api/etiqueta/fila',
      '/amb/ml/teste', '/amb/ml/eu', '/amb/bling/teste', '/amb/bling/produto',
    ],
  });
});

// ── Pre-aquecimento atrasado ─────────────────────────────────
// Nao competir com o boot do Devolucoes da GOOD, que monta os
// indices dele nos primeiros segundos. Ninguem bipa caixa nos
// 3 minutos seguintes a um deploy.
if (ml.temToken()) {
  mlReturns.preAquecer(Number(process.env.AMB_ML_PREAQUECER_MS || 180000));
} else {
  console.log('[amb-devolucoes] ML sem token - indice de devolucoes so apos autorizar');
}

// O indice de nomes bate no Bling, nao no ML — sao cotas separadas.
// Ainda assim vai 1 minuto depois do outro pra nao empilhar tudo.
if (bling.temToken()) {
  nfNomes.preAquecer(Number(process.env.AMB_NF_PREAQUECER_MS || 240000));
  nfEntrada.preAquecer();
} else {
  console.log('[amb-devolucoes] Bling sem token - indices de nomes/entrada so apos autorizar');
}

shopee.preAquecer();
magalu.preAquecer();


if (!auth.temUsuarios()) {
  console.log('[amb-devolucoes] AMB_USERS vazio - ninguem consegue logar ainda');
}

console.log(`[amb-devolucoes] ${VERSAO} carregado - prefixo ${cfg.PREFIXO}`);

module.exports = router;
