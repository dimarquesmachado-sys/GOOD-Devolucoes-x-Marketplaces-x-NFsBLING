// ============================================================
// amb-devolucoes/app-AMB.js                    (AMB Devol. b1)
// ------------------------------------------------------------
// Router Express do Devolucoes da AMBTotal.
//
// COMO ENTRA NO AR: o server.js da GOOD monta este router com
// UMA linha:
//     app.use('/amb', require('./amb-devolucoes/app-AMB'));
//
// Nada da GOOD e tocado. Se este modulo der problema, basta
// comentar essa linha e a GOOD volta ao normal.
//
// ETAPA 1 (esta): esqueleto + conexao com o Bling da AMB.
// Proximas: ML (indice claims->returns), Shopee, Magalu, bipe,
// a espreita, Supabase.
//
// Toda rota administrativa exige ?k=ADMIN_KEY e responde 404
// (nao 403) quando a chave falta — mesma convencao dos outros
// servicos: quem nao tem a chave nao descobre que a rota existe.
// ============================================================

'use strict';

const express = require('express');
const cfg = require('./config-AMB');
const bling = require('./lib-AMB/bling-AMB');
const tokens = require('./lib-AMB/render-tokens-AMB');

const VERSAO = 'AMB Devolucoes b1';
const SUBIU_EM = new Date().toISOString();

const router = express.Router();

// ── Trava de admin ───────────────────────────────────────────
function admin(req, res, next) {
  const chave = process.env.ADMIN_KEY;
  if (!chave || req.query.k !== chave) {
    return res.status(404).json({ error: 'not found' });
  }
  next();
}

// ── /amb/status ──────────────────────────────────────────────
// Publica de proposito (sem segredo nenhum no corpo): serve pra
// saber se o modulo carregou depois de um deploy.
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    modulo: 'amb-devolucoes',
    empresa: cfg.NOME_EMPRESA,
    versao: VERSAO,
    subiu_em: SUBIU_EM,
    uptime_s: Math.round(process.uptime()),
    memoria_mb: Math.round(process.memoryUsage().rss / 1048576),
  });
});

// ── /amb/config ──────────────────────────────────────────────
// O que ja esta configurado e o que falta. Booleans apenas —
// nenhum valor de credencial sai daqui.
router.get('/config', admin, (req, res) => {
  res.json({
    ok: true,
    versao: VERSAO,
    empresa: cfg.NOME_EMPRESA,
    prefixo: cfg.PREFIXO,
    url_base: cfg.urlBase(),
    redirect_uri: cfg.redirectUri(),
    configurado: cfg.statusConfig(),
    persistencia_token: tokens.diagnostico(),
    tabelas_supabase: cfg.supabase.tabelas,
  });
});

// ── /amb/bling/conectar ──────────────────────────────────────
// Mostra a URL de autorizacao pra colar no navegador.
router.get('/bling/conectar', admin, (req, res) => {
  if (!bling.temCredenciais()) {
    return res.status(200).json({
      ok: false,
      erro: 'faltam credenciais',
      falta: [
        !cfg.bling.clientId     ? 'AMB_BLING_CLIENT_ID'     : null,
        !cfg.bling.clientSecret ? 'AMB_BLING_CLIENT_SECRET' : null,
      ].filter(Boolean),
      onde: 'Render > servico GOOD-Devolucoes-x-Marketplaces-x-NFsBLING > aba Environment',
    });
  }
  res.json({
    ok: true,
    passo_1: 'Abra a URL abaixo no navegador, JA LOGADO na conta Bling da AMBTotal',
    url: bling.urlAutorizacao(),
    passo_2: 'Autorize. O navegador vai para a URL de callback com ?code=XXXX na barra de endereco',
    passo_3: 'Copie o code e abra em ATE 1 MINUTO: ' + cfg.urlBase() + '/amb/bling/setup?code=SEU_CODE&k=ADMIN_KEY',
    aviso: 'O code do Bling expira em ~1 minuto. Se demorar, refaca o passo 1.',
  });
});

// ── /amb/bling/setup?code=XXXX ───────────────────────────────
router.get('/bling/setup', admin, async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).json({ ok: false, erro: 'falta o code', uso: '/amb/bling/setup?code=SEU_CODE&k=ADMIN_KEY' });
  }
  try {
    const r = await bling.trocarCodePorToken(String(code));
    res.json({
      ok: true,
      conectado: true,
      escopos: (r.dados && r.dados.scope) || null,
      expira_em_s: (r.dados && r.dados.expires_in) || null,
      token_persistido_no_render: r.persistiu,
      aviso: r.persistiu ? null : 'Token obtido mas NAO persistido - confira RENDER_API_KEY e RENDER_SERVICE_ID',
      proximo: cfg.urlBase() + '/amb/bling/teste?k=ADMIN_KEY',
    });
  } catch (erro) {
    res.status(200).json({
      ok: false,
      erro: (erro.response && erro.response.data) || erro.message,
      dica: 'O code expira em ~1 minuto. Refaca o /amb/bling/conectar e cole rapido.',
    });
  }
});

// ── /amb/bling/teste ─────────────────────────────────────────
router.get('/bling/teste', admin, async (req, res) => {
  const r = await bling.testeDeVida();
  res.json({ ok: r.ok, versao: VERSAO, empresa: cfg.NOME_EMPRESA, resultado: r });
});

// ── /amb/bling/produto?sku=XXX ───────────────────────────────
router.get('/bling/produto', admin, async (req, res) => {
  const sku = req.query.sku;
  if (!sku) return res.status(400).json({ ok: false, erro: 'falta o sku', uso: '/amb/bling/produto?sku=ABC123&k=ADMIN_KEY' });
  const r = await bling.buscarProdutoPorSku(String(sku));
  res.json(r);
});

// ── 404 do modulo (sempre JSON, nunca HTML) ──────────────────
// Sem isto, uma rota errada dentro de /amb cairia no 404 em HTML
// da GOOD e voce receberia pagina em vez de JSON no curl.
router.use((req, res) => {
  res.status(404).json({
    ok: false,
    erro: 'rota nao existe neste modulo',
    modulo: 'amb-devolucoes',
    versao: VERSAO,
    rotas: ['/amb/status', '/amb/config', '/amb/bling/conectar', '/amb/bling/setup', '/amb/bling/teste', '/amb/bling/produto'],
  });
});

console.log(`[amb-devolucoes] ${VERSAO} carregado - prefixo ${cfg.PREFIXO}`);

module.exports = router;
