// ============================================================
// amb-devolucoes/app-AMB.js                    (AMB Devol. b2)
// ------------------------------------------------------------
// Router Express do Devolucoes da AMBTotal.
//
// NOVIDADE DA b2 — CONEXAO EM UM CLIQUE:
// antes era preciso pegar a URL numa rota, colar no navegador,
// copiar o "code" da barra de endereco e abrir outra rota em
// menos de 1 minuto. Agora existe /amb/conectar: uma tela com
// botoes. Voce clica, autoriza no Bling ou no ML, e o callback
// faz TUDO sozinho — troca o code, grava os tokens, descobre o
// user_id e ja testa a conexao. Sem cronometro, sem copiar nada.
//
// COMO A SEGURANCA FUNCIONA AQUI: a rota de callback precisa ser
// publica (quem chama e o Bling/ML, sem a ADMIN_KEY). Entao ela
// nao aceita qualquer chamada: no momento em que voce clica no
// botao, geramos um "state" aleatorio de uso unico, com validade
// de 10 minutos. O callback so trabalha se o state bater. Sem
// isso, um link malicioso poderia mandar um code plantado.
// ============================================================

'use strict';

const express = require('express');
const crypto = require('crypto');
const cfg = require('./config-AMB');
const bling = require('./lib-AMB/bling-AMB');
const ml = require('./lib-AMB/ml-AMB');
const tokens = require('./lib-AMB/render-tokens-AMB');

const VERSAO = 'AMB Devolucoes b2';
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

// ── State de uso unico pro OAuth ─────────────────────────────
const PENDENTES = new Map();   // state -> { servico, criado_em }
const VALIDADE_MS = 10 * 60 * 1000;

function novoState(servico) {
  const s = crypto.randomBytes(24).toString('hex');
  PENDENTES.set(s, { servico, criado_em: Date.now() });
  // limpeza dos vencidos (a Map nunca cresce sem controle)
  for (const [k, v] of PENDENTES) {
    if (Date.now() - v.criado_em > VALIDADE_MS) PENDENTES.delete(k);
  }
  return s;
}

function consumirState(s) {
  const reg = PENDENTES.get(s);
  if (!reg) return null;
  PENDENTES.delete(s);                                  // uso unico
  if (Date.now() - reg.criado_em > VALIDADE_MS) return null;
  return reg;
}

// O redirect_uri precisa ser IDENTICO ao cadastrado nos apps.
function redirectOAuth() {
  return cfg.urlBase() + '/amb/oauth/callback';
}

// ── Paginas (HTML simples, sem dependencia externa) ──────────
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

// ── /amb/conectar — a tela com os botoes ─────────────────────
router.get('/conectar', admin, (req, res) => {
  const k = encodeURIComponent(req.query.k);
  const cfgAtual = cfg.statusConfig();

  const linha = (nome, pronto, detalhe) =>
    `<tr><td>${nome}</td><td>${pronto ? '<span class="ok">conectado</span>' : '<span class="erro">falta autorizar</span>'}${detalhe ? ' &middot; ' + detalhe : ''}</td></tr>`;

  const corpo = `
    <h1>AMBTotal &middot; Devolucoes</h1>
    <div class="sub">${VERSAO} &mdash; conexoes do modulo</div>

    <div class="card">
      <table>
        ${linha('Bling', cfgAtual.bling.token)}
        ${linha('Mercado Livre', cfgAtual.ml.token, cfgAtual.ml.user_id ? ('user ' + cfgAtual.ml.user_id) : '')}
      </table>
    </div>

    <div class="card">
      <a class="btn" href="/amb/oauth/iniciar?servico=bling&k=${k}">Conectar o Bling da AMBTotal</a>
      <a class="btn" href="/amb/oauth/iniciar?servico=ml&k=${k}">Conectar o Mercado Livre da AMBTotal</a>
      <a class="btn cinza" href="/amb/config?k=${k}">Ver diagnostico completo</a>
    </div>

    <div class="aviso">
      Clique, autorize na tela do marketplace e pronto — o resto acontece sozinho.
      Confira antes que o navegador esteja logado na conta da <b>AMBTotal</b>,
      nao na da GOOD.<br><br>
      O endereco de retorno cadastrado nos dois apps precisa ser exatamente:<br>
      <code>${redirectOAuth()}</code>
    </div>`;
  res.set('Content-Type', 'text/html; charset=utf-8').send(pagina('Conectar AMBTotal', corpo));
});

// ── /amb/oauth/iniciar — gera o state e manda pro marketplace ─
router.get('/oauth/iniciar', admin, (req, res) => {
  const servico = String(req.query.servico || '').toLowerCase();

  if (servico === 'bling') {
    if (!bling.temCredenciais()) {
      return res.status(200).send(pagina('Falta credencial',
        `<h1>Faltam credenciais do Bling</h1>
         <div class="card">Configure <code>AMB_BLING_CLIENT_ID</code> e <code>AMB_BLING_CLIENT_SECRET</code>
         no Render, servico GOOD-Devolucoes-x-Marketplaces-x-NFsBLING, aba Environment.</div>`));
    }
    const state = novoState('bling');
    const p = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.bling.clientId,
      redirect_uri: redirectOAuth(),
      state,
    });
    return res.redirect(`${cfg.bling.apiBase}/oauth/authorize?${p.toString()}`);
  }

  if (servico === 'ml') {
    if (!ml.temCredenciais()) {
      return res.status(200).send(pagina('Falta credencial',
        `<h1>Faltam credenciais do Mercado Livre</h1>
         <div class="card">Configure <code>AMB_ML_CLIENT_ID</code> e <code>AMB_ML_CLIENT_SECRET</code>
         no Render, servico GOOD-Devolucoes-x-Marketplaces-x-NFsBLING, aba Environment.</div>`));
    }
    const state = novoState('ml');
    return res.redirect(ml.urlAutorizacao(state, redirectOAuth()));
  }

  res.status(400).json({ ok: false, erro: 'servico invalido', use: 'bling ou ml' });
});

// ── /amb/oauth/callback — PUBLICA, protegida pelo state ──────
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
       <div class="card">Este endereco so funciona logo depois de voce clicar no botao de conectar,
       e vale por 10 minutos. Volte para a tela de conexao e clique de novo.</div>`, '#da3633'));
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
        </table></div>
        ${r.persistiu ? '' : '<div class="card erro">O token foi obtido mas nao gravado. Confira RENDER_API_KEY e RENDER_SERVICE_ID, senao ele se perde no proximo restart.</div>'}
      `));
    }

    if (reg.servico === 'ml') {
      const r = await ml.trocarCodePorToken(String(code), redirectOAuth());
      const teste = await ml.testeDeVida();
      return res.send(pagina('Mercado Livre conectado', `
        <h1 class="ok">Mercado Livre da AMBTotal conectado</h1>
        <div class="card"><table>
          <tr><td>Conta</td><td>${teste.conta || '-'}</td></tr>
          <tr><td>user_id descoberto</td><td>${r.user_id || '-'}</td></tr>
          <tr><td>Token gravado no Render</td><td>${r.persistiu ? 'sim' : 'NAO'}</td></tr>
          <tr><td>Validade do acesso</td><td>${r.expira_em_s ? Math.round(r.expira_em_s / 3600) + 'h (renova sozinho)' : '-'}</td></tr>
        </table></div>
        ${r.persistiu ? '' : '<div class="card erro">Token obtido mas nao gravado. Confira RENDER_API_KEY e RENDER_SERVICE_ID.</div>'}
        <div class="aviso">Confira se a conta acima e mesmo a da AMBTotal. Se aparecer a conta da GOOD,
        voce autorizou logado na conta errada — troque de conta no Mercado Livre e conecte de novo.</div>
      `));
    }

    res.status(400).json({ ok: false, erro: 'servico desconhecido no state' });
  } catch (erro) {
    const detalhe = (erro.response && JSON.stringify(erro.response.data)) || erro.message;
    res.status(200).send(pagina('Falhou', `
      <h1 class="erro">Nao consegui concluir</h1>
      <div class="card"><code>${detalhe}</code></div>
      <div class="aviso">Volte para a tela de conexao e tente de novo.</div>`, '#da3633'));
  }
});

// ── /amb/status ──────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    modulo: 'amb-devolucoes',
    empresa: cfg.NOME_EMPRESA,
    versao: VERSAO,
    subiu_em: SUBIU_EM,
    uptime_s: Math.round(process.uptime()),
    memoria_mb: Math.round(process.memoryUsage().rss / 1048576),
    conectado: { bling: bling.temToken(), ml: ml.temToken() },
  });
});

// ── /amb/config ──────────────────────────────────────────────
router.get('/config', admin, (req, res) => {
  res.json({
    ok: true,
    versao: VERSAO,
    empresa: cfg.NOME_EMPRESA,
    prefixo: cfg.PREFIXO,
    url_base: cfg.urlBase(),
    redirect_oauth: redirectOAuth(),
    configurado: cfg.statusConfig(),
    persistencia_token: tokens.diagnostico(),
    tabelas_supabase: cfg.supabase.tabelas,
    oauth_pendentes: PENDENTES.size,
  });
});

// ── Rotas de teste ───────────────────────────────────────────
router.get('/bling/teste', admin, async (req, res) => {
  const r = await bling.testeDeVida();
  res.json({ ok: r.ok, versao: VERSAO, resultado: r });
});

router.get('/bling/produto', admin, async (req, res) => {
  const sku = req.query.sku;
  if (!sku) return res.status(400).json({ ok: false, erro: 'falta o sku' });
  res.json(await bling.buscarProdutoPorSku(String(sku)));
});

router.get('/ml/teste', admin, async (req, res) => {
  const r = await ml.testeDeVida();
  res.json({ ok: r.ok, versao: VERSAO, resultado: r });
});

router.get('/ml/eu', admin, async (req, res) => {
  res.json(await ml.quemSouEu());
});

// ── 404 do modulo (sempre JSON) ──────────────────────────────
router.use((req, res) => {
  res.status(404).json({
    ok: false,
    erro: 'rota nao existe neste modulo',
    modulo: 'amb-devolucoes',
    versao: VERSAO,
    rotas: ['/amb/conectar', '/amb/status', '/amb/config', '/amb/ml/teste', '/amb/ml/eu', '/amb/bling/teste', '/amb/bling/produto'],
  });
});

console.log(`[amb-devolucoes] ${VERSAO} carregado - prefixo ${cfg.PREFIXO}`);

module.exports = router;
