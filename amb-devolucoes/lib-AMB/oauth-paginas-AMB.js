'use strict';   // o bloco rodava DENTRO de criarAppEmpresa, que e modo estrito — aqui tambem
// amb-devolucoes/lib-AMB/oauth-paginas-AMB.js — peca da FABRICA (docs/MODULARIZACAO.md, fatia F3).
//
// MOVIDO de app-AMB.js em b688, SEM EDICAO: a pagina GET /conectar (os botoes de conectar Bling/ML/Magalu da empresa) e GET /oauth/iniciar
//   (monta a URL de autorizacao de cada servico e redireciona).
// O bloco vivia dentro de criarAppEmpresa e usava 16 nomes da closure, TODOS `const` (ou funcao
// declarada) e nenhum reatribuido aqui (analise de escopo com acorn + eslint-scope): chegam por `deps`
// com o MESMO nome, entao o texto do bloco nao muda uma letra. Nada do que o bloco declara e usado fora.
// A fabrica chama este registrador NO MESMO PONTO em que o bloco estava (a ordem das rotas nao muda).
//
// ⚠️ QUEM EDITAR AQUI: este arquivo NAO enxerga mais a closure da fabrica. Nome novo que venha de la tem
// que entrar em DEPS e na chamada em app-AMB.js — test/fabrica-fonte-unica acusa; e a falta de um nome
// estoura no BOOT (a empresa aparece como `falhou` no /health), nao na requisicao.

const DEPS = ['cfg', 'BASE', 'bling', 'ml', 'mlReturns', 'nfNomes', 'shopee', 'magalu', 'NOME_EMPRESA', 'PREFIXO_ENV_EMPRESA', 'envAmb', 'VERSAO', 'admin', 'novoState', 'redirectOAuth', 'pagina'];

module.exports = function registrarOauthPaginas(router, deps) {
  for (const nome of DEPS) {
    if (!deps || deps[nome] === undefined) throw new Error('oauth-paginas-AMB: a fabrica nao passou a dependencia `' + nome + '`');
  }
  const { cfg, BASE, bling, ml, mlReturns, nfNomes, shopee, magalu, NOME_EMPRESA, PREFIXO_ENV_EMPRESA, envAmb, VERSAO, admin, novoState, redirectOAuth, pagina } = deps;

// @secao oauth-paginas
// ── /amb/conectar ────────────────────────────────────────────
router.get('/conectar', admin, (req, res) => {
  const k = encodeURIComponent(req.query.k);
  // Estado AO VIVO, perguntado aos modulos (nao a foto do config).
  const idx = mlReturns.statusIndice();

  const linha = (nome, pronto, detalhe) =>
    `<tr><td>${nome}</td><td>${pronto ? '<span class="ok">conectado</span>' : '<span class="erro">falta autorizar</span>'}${detalhe ? ' &middot; ' + detalhe : ''}</td></tr>`;

  const corpo = `
    <h1>${NOME_EMPRESA} &middot; Devolucoes</h1>
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
          : !magalu.temTenant() ? `<span class="ok">autorizado</span> &middot; <b>falta ${PREFIXO_ENV_EMPRESA}MAGALU_TENANT_ID</b>`
          : `<span class="ok">conectado</span> &middot; tenant ${envAmb('MAGALU_TENANT_ID')}`}</td></tr>
        <tr><td>Shopee</td><td>${shopee.cfg.ativo
          ? `<span class="ok">ligada</span> &middot; loja ${shopee.cfg.loja}`
          : '<span class="erro">desligada</span>'}</td></tr>
      </table>
    </div>

    <div class="card">
      <a class="btn" href="${BASE}/oauth/iniciar?servico=bling&k=${k}">Conectar o Bling da ${NOME_EMPRESA}</a>
      <a class="btn" href="${BASE}/oauth/iniciar?servico=ml&k=${k}">Conectar o Mercado Livre da ${NOME_EMPRESA}</a>
      <a class="btn" href="${BASE}/oauth/iniciar?servico=magalu&k=${k}">Conectar o Magalu da ${NOME_EMPRESA}</a>
      <a class="btn cinza" href="${BASE}/ml/indice?k=${k}">Ver o indice de devolucoes</a>
      <a class="btn cinza" href="${BASE}/nf/indice?k=${k}">Ver o indice de nomes</a>
      <a class="btn cinza" href="${BASE}/config?k=${k}">Ver diagnostico completo</a>
    </div>

    <div class="aviso">
      Clique, autorize na tela do marketplace e pronto — o resto acontece sozinho.
      Confira antes que o navegador esteja logado na conta da <b>${NOME_EMPRESA}</b>.<br>
      &#9888;&#65039; No <b>Magalu</b> vale dobrado: e a conta LOGADA na hora do consentimento
      que fica autorizada — saia da conta da GOOD (ou use janela anonima) antes de clicar.<br><br>
      Endereco de retorno cadastrado nos apps:<br><code>${redirectOAuth()}</code>
    </div>`;
  res.set('Content-Type', 'text/html; charset=utf-8').send(pagina(`Conectar ${NOME_EMPRESA}`, corpo));
});

// ── OAuth ────────────────────────────────────────────────────
router.get('/oauth/iniciar', admin, (req, res) => {
  const servico = String(req.query.servico || '').toLowerCase();

  if (servico === 'bling') {
    if (!bling.temCredenciais()) {
      return res.status(200).send(pagina('Falta credencial',
        `<h1>Faltam credenciais do Bling</h1><div class="card">Configure
         <code>${PREFIXO_ENV_EMPRESA}BLING_CLIENT_ID</code> e <code>${PREFIXO_ENV_EMPRESA}BLING_CLIENT_SECRET</code> no Render.</div>`));
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
         <code>${PREFIXO_ENV_EMPRESA}ML_CLIENT_ID</code> e <code>${PREFIXO_ENV_EMPRESA}ML_CLIENT_SECRET</code> no Render.</div>`));
    }
    const state = novoState('ml');
    return res.redirect(ml.urlAutorizacao(state, redirectOAuth()));
  }

  if (servico === 'magalu') {
    if (!magalu.temCredenciais()) {
      return res.status(200).send(pagina('Falta credencial',
        `<h1>Faltam credenciais do Magalu</h1><div class="card">Este servico precisa das vars
         <code>${PREFIXO_ENV_EMPRESA}MAGALU_CLIENT_ID</code> e <code>${PREFIXO_ENV_EMPRESA}MAGALU_CLIENT_SECRET</code>
         (client PROPRIO desta empresa — nao use as da GOOD, sem prefixo).</div>`));
    }
    const state = novoState('magalu');
    return res.redirect(magalu.urlAutorizacao(state, redirectOAuth()));
  }

  res.status(400).json({ ok: false, erro: 'servico invalido', use: 'bling, ml ou magalu' });
});
// @fim-secao
};
module.exports.DEPS = DEPS;
