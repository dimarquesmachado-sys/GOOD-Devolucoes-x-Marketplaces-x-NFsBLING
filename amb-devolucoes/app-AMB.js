// ============================================================
// amb-devolucoes/app-AMB.js                    (AMB Devol. b11)
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
const db = require('./lib-AMB/supabase-AMB');
const mkt = require('./lib-AMB/marketplace-AMB');
const shopee = require('./lib-AMB/shopee-AMB');
const magalu = require('./lib-AMB/magalu-AMB');
const mlMotivo = require('./lib-AMB/ml-motivo-AMB');
const impressao = require('./lib-AMB/impressao-AMB');
const emailAMB = require('./lib-AMB/email-AMB');
const nfEntrada = require('./lib-AMB/nf-entrada-AMB');

const VERSAO = 'AMB Devolucoes b19';
const SUBIU_EM = new Date().toISOString();

const router = express.Router();

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

router.use(express.static(path.join(__dirname, 'public-AMB'), {
  // b19 - HTML sempre revalida (mesma licao da v3.64 da GOOD: o
  // navegador segurava a tela velha e o Diego via "tela b17" com
  // "servidor b18"). Imagens continuam com cache normal.
  setHeaders: (res, caminho) => {
    if (String(caminho).endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
  setHeaders: (res, caminho) => {
    // HTML sempre revalida: o celular do estoquista segurava
    // versao velha em cache e ficava sem as correcoes.
    if (caminho.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ── LOGIN DO GALPAO ──────────────────────────────────────────
// Estas rotas usam COOKIE, nao a ADMIN_KEY: quem usa e o
// estoquista no celular, que nao tem (nem deve ter) a chave.

router.post('/api/auth/login', (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) {
    return res.status(400).json({ ok: false, erro: 'informe usuario e senha' });
  }
  const conta = auth.autenticar(String(usuario), String(senha));
  if (!conta) {
    // Mensagem generica de proposito: nao dizer se o usuario
    // existe evita descobrir nomes validos por tentativa.
    return res.status(401).json({ ok: false, erro: 'usuario ou senha invalidos' });
  }
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
  const [dup, rec] = await Promise.all([
    db.jaTriado(chaves),
    db.recadoDe(chaves.orderId || chaves.tracking),
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
  if (!r.ok) return res.json(r);
  // junta o link da NF DA VENDA no Bling (id vem do indice de nomes)
  const registros = (r.registros || []).map(x => {
    const venda = nfNomes.acharPorPedido(x.order_id);
    return {
      ...x,
      nf_id_bling: (venda && venda.id) || null,
      link_nf_bling: venda && venda.id
        ? `https://www.bling.com.br/notas.fiscais.php#edit/${venda.id}` : null,
    };
  });
  res.json({ ok: true, status, total: registros.length, registros });
});

/** NF de devolucao gerada no Bling -> registra o numero no card. */
router.put('/api/triagem/:id/nf-devolucao', auth.requerLogin, async (req, res) => {
  const { numero, id_bling } = req.body || {};
  if (!numero) return res.status(400).json({ ok: false, erro: 'informe o numero da NF de devolucao' });
  res.json(await db.atualizarTriagem(req.params.id, {
    nf_devolucao_numero: String(numero),
    nf_devolucao_id_bling: id_bling ? String(id_bling) : null,
  }));
});

/** Concluida: some das filas. */
router.post('/api/triagem/:id/concluir', auth.requerLogin, async (req, res) => {
  res.json(await db.atualizarTriagem(req.params.id, { status: 'finalizado' }));
});

// ── A ESPREITA (o que esta vindo pro galpao) ─────────────────
router.get('/api/espreita', auth.requerLogin, async (req, res) => {
  const baseML = mlReturns.resumoEspreita();
  const baseShopee = await shopee.resumoEspreita();
  const baseMagalu = magalu.resumoEspreita();
  const notas = await db.notasEspreita();
  const mapa = notas.ok ? notas.notas : {};

  // Junta a anotacao manual, o "NF de devolucao ja emitida ✓" e
  // esconde o que ja foi baixado.
  const enriquecer = (lista) => (lista || []).map(x => {
    const n = mapa[x.tracking] || mapa[x.pedido] || null;
    const nf = nfEntrada.jaEmitida({ pedido: x.pedido });
    // b17 - cliente e NF DA VENDA vem do indice de nomes (numeroLoja
    // do Bling = numero do pedido no marketplace, pros 3 canais)
    const venda = nfNomes.acharPorPedido(x.pedido);
    // b18 - link direto pro marketplace, pedido do Diego no painel
    let link = null;
    if (x.marketplace === 'ml' && x.pedido) {
      link = `https://www.mercadolivre.com.br/vendas/${x.pedido}/detalhe`;
    } else if (x.marketplace === 'shopee') {
      link = 'https://seller.shopee.com.br/portal/sale/return';
    } else if (x.marketplace === 'magalu') {
      link = 'https://seller.magaluentregas.com.br/';
    }
    return {
      ...x,
      link_marketplace: link,
      cliente: (venda && venda.nome) || null,
      nf_venda: (venda && venda.numero) || null,
      comentario: n && n.comentario, ticket: n && n.ticket,
      baixado: !!(n && n.baixado),
      nf_devolucao_emitida: nf.emitida === true ? (nf.nf && nf.nf.numero) || true : false,
    };
  }).filter(x => !x.baixado);

  const emTransito = [
    ...enriquecer(baseML.em_transito),
    ...enriquecer(baseShopee.em_transito),
    ...enriquecer(baseMagalu.em_transito),
  ].sort((a, b) => (b.dias_em_transito || 0) - (a.dias_em_transito || 0));

  // b19 - pedidos ML que ainda estao sem itens/apelido: dispara o
  // enriquecimento agora, em background; a proxima atualizacao da
  // tela (4 min) ja vem preenchida.
  const pendentes = emTransito
    .concat(enriquecer(baseML.entregues))
    .filter(x => x.marketplace === 'ml' && !x.itens && x.pedido)
    .map(x => String(x.pedido)).slice(0, 60);
  if (pendentes.length) mlReturns.enriquecerLista(pendentes).catch(() => {});

  res.json({
    ok: true,
    versao: VERSAO,
    fontes: {
      ml: { quente: baseML.quente },
      shopee: { quente: baseShopee.quente, desligada: !!baseShopee.desligada, erro: baseShopee.erro || null },
      magalu: { quente: baseMagalu.quente, desligada: !!baseMagalu.desligada, falta: baseMagalu.falta || null },
      nf_entrada: nfEntrada.statusIndice(),
    },
    em_transito: emTransito,
    atrasadas_30d: emTransito.filter(x => (x.dias_em_transito || 0) > 30).length,
    aguardando_postagem: baseML.aguardando_postagem,
    entregues: enriquecer(baseML.entregues),
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
  // Valida o SKU no Bling antes de gravar: evita defeito fantasma
  // por causa de um codigo digitado errado.
  const prod = await bling.buscarProdutoPorSku(String(sku));
  const exato = prod.ok ? prod.exato : null;

  const r = await db.registrarTriagem({
    tipo: 'defeito_estoque',
    status: 'concluido',
    produto_sku: exato ? exato.codigo : sku,
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

// Etiqueta de defeito (QZ Tray + fila remota) — registrada ANTES
// do 404: o Express casa rotas na ordem em que foram declaradas,
// e o pega-tudo engoliria qualquer coisa registrada depois dele.
impressao.registrarRotas(router, auth.requerLogin);

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
      '/amb/identificar', '/amb/nf/nome', '/amb/nf/itens', '/amb/nf/indice', '/amb/nf/indice/construir',
      '/amb/api/auth/login', '/amb/api/auth/me', '/amb/api/triagem/identificar', '/amb/api/triagem/registrar',
      '/amb/auth/diag', '/amb/db/teste', '/amb/api/nf/itens', '/amb/api/triagem/recentes',
      '/amb/painel', '/amb/api/espreita', '/amb/api/recados', '/amb/api/defeitos',
      '/amb/shopee/teste', '/amb/magalu/status', '/amb/nf/entrada/sonda', '/amb/api/etiqueta/fila',
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
