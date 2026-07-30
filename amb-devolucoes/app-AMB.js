// ============================================================
// amb-devolucoes/app-AMB.js                    (AMB Devol. b3)
// ------------------------------------------------------------
// Router Express do Devolucoes da AMBTotal.
//
// b3 traz o INDICE claims->returns do ML — a peca que faz o bipe
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
const crypto = require('crypto');
const cfg = require('./config-AMB');
const bling = require('./lib-AMB/bling-AMB');
const ml = require('./lib-AMB/ml-AMB');
const mlReturns = require('./lib-AMB/ml-returns-AMB');
const tokens = require('./lib-AMB/render-tokens-AMB');

const VERSAO = 'AMB Devolucoes b3';
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
        <tr><td>Indice de devolucoes ML</td><td>${idx.quente
          ? `<span class="ok">${idx.com_tracking} rastreios</span> &middot; ${idx.idade_min} min`
          : (idx.construindo ? 'montando agora...' : '<span class="erro">ainda frio</span>')}</td></tr>
      </table>
    </div>

    <div class="card">
      <a class="btn" href="/amb/oauth/iniciar?servico=bling&k=${k}">Conectar o Bling da AMBTotal</a>
      <a class="btn" href="/amb/oauth/iniciar?servico=ml&k=${k}">Conectar o Mercado Livre da AMBTotal</a>
      <a class="btn cinza" href="/amb/ml/indice?k=${k}">Ver o indice de devolucoes</a>
      <a class="btn cinza" href="/amb/config?k=${k}">Ver diagnostico completo</a>
    </div>

    <div class="aviso">
      Clique, autorize na tela do marketplace e pronto — o resto acontece sozinho.
      Confira antes que o navegador esteja logado na conta da <b>AMBTotal</b>.<br><br>
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

  res.status(400).json({ ok: false, erro: 'servico invalido', use: 'bling ou ml' });
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

router.get('/ml/eu', admin, async (req, res) => {
  res.json(await ml.quemSouEu());
});

// ── 404 do modulo ────────────────────────────────────────────
router.use((req, res) => {
  res.status(404).json({
    ok: false,
    erro: 'rota nao existe neste modulo',
    modulo: 'amb-devolucoes',
    versao: VERSAO,
    rotas: [
      '/amb/conectar', '/amb/status', '/amb/config',
      '/amb/ml/indice', '/amb/ml/indice/construir', '/amb/ml/rastreio', '/amb/ml/espreita',
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
  console.log('[amb-devolucoes] ML sem token - indice so sera montado apos autorizar');
}

console.log(`[amb-devolucoes] ${VERSAO} carregado - prefixo ${cfg.PREFIXO}`);

module.exports = router;
