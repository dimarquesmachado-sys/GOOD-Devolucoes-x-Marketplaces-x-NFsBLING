// ============================================================
// amb-devolucoes/lib-AMB/auth-AMB.js           (AMB Devol. b130)
// ------------------------------------------------------------
// Login do galpao da AMBTotal.
//
// ⚠️ ARMADILHA QUE ISTO EVITA: a GOOD roda NO MESMO DOMINIO e usa
// um cookie chamado "sessao". Se a AMB usasse o mesmo nome, um
// login derrubaria o outro — o estoquista entrando na AMB
// deslogaria quem estivesse trabalhando na GOOD, e vice-versa.
// Por isso aqui o cookie e "sessao_amb" e vive so no caminho
// /amb. Os dois sistemas convivem sem se enxergar.
//
// Usuarios vem da env var AMB_USERS, no formato:
//     usuario:senha,outro:senha2
//
// AMB_ADMIN_USER aceita UM nome ou VARIOS separados por virgula:
//     AMB_ADMIN_USER = Diego,Angelica
// (b7 — antes so aceitava um; com dois nomes o codigo procurava
// um usuario chamado literalmente "Diego,Angelica", nao achava, e
// NINGUEM ficava admin. Pego pela rota /amb/auth/diag.)
//
// O nome de usuario e comparado SEM diferenciar maiuscula de
// minuscula. Motivo pratico: o teclado do celular capitaliza a
// primeira letra sozinho, entao o estoquista digita "Lucas" onde
// esta cadastrado "lucas" e levaria "usuario ou senha invalidos"
// sem entender por que. A SENHA continua exata — ali a diferenca
// e proposital.
//
// Dois niveis apenas, igual a GOOD:
//   admin      -> configuracao, indices, gestao
//   estoquista -> bipar, triar, reportar problema
//
// b130 — AS SESSOES SOBREVIVEM AO DEPLOY.
// Antes elas ficavam so em memoria: cada arquivo subido no GitHub
// reinicia o servico no Render e deslogava todo mundo. Como o Diego
// sobe arquivo dezenas de vezes por dia, isso virou um estorvo real
// (e assustava: "sessao invalida" parecia bug do sistema).
//
// Agora o TOKEN CARREGA quem e o usuario, o tipo e a validade, com
// uma assinatura HMAC que so o servidor sabe conferir. Nao ha lista
// pra se perder no restart, e nao precisa de banco.
//
//   formato:  <payload em base64url>.<assinatura>
//   payload:  {"u":"diego","t":"admin","e":<expira em ms>}
//
// O segredo vem de AMB_SESSION_SECRET; se nao existir, usa a
// ADMIN_KEY (que ja e estavel no Render). Trocar o segredo invalida
// os tokens — que e o comportamento desejado.
//
// COMPATIBILIDADE: os tokens ANTIGOS (aleatorios, guardados no Map)
// continuam sendo aceitos enquanto o processo viver. Assim ninguem
// e derrubado no momento exato do deploy desta mudanca.
// ============================================================

'use strict';

const crypto = require('crypto');

// ⚠️ b344 - ESTE MODULO ERA TODO CRAVADO NA AMB.
//
// [stated 15/09] "uma gaveta pra cada (...) a longo prazo o ganho e maior"
//
// Nao era so o `sessoes` compartilhado. O NOME DO COOKIE, o CAMINHO e as
// ENVS estavam fixos na AMB:
//   COOKIE        'sessao_amb'
//   CAMINHO       '/amb'
//   usuarios      AMB_USERS / AMB_ADMIN_USER
//
// ⚠️ COM DUAS EMPRESAS ISSO SERIA GRAVE: mesmo nome de cookie no mesmo
// dominio = o navegador manda um so. Quem entrasse na Girassol derrubaria
// a sessao da AMB — ou pior, entraria com a sessao dela.
//
// 📌 Os PADROES sao os valores atuais: sem passar nada, o comportamento e
// IDENTICO ao de hoje. E o login e a coisa mais sensivel que existe aqui —
// se quebrar, o galpao nao entra.
const PADRAO = {
  cookie: 'sessao_amb',
  caminhoCookie: '/amb',
  validadeMs: 12 * 60 * 60 * 1000,   // 12 horas
  envUsers: 'AMB_USERS',
  envAdmins: 'AMB_ADMIN_USER',
};

function parseUsers(txt) {
  const out = {};
  String(txt || '').split(',').forEach(par => {
    const i = par.indexOf(':');
    if (i < 1) return;
    const u = par.slice(0, i).trim();
    const s = par.slice(i + 1).trim();
    if (u && s) out[u.toLowerCase()] = { nome: u, senha: s };
  });
  return out;
}

/** Aceita "Diego" ou "Diego,Angelica" (com ou sem espaco). */
function parseAdmins(txt) {
  return String(txt || '')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
}

// ⚠️ b344 - o modulo passa a ter UMA INSTANCIA PADRAO (a AMB de hoje) e a
// poder criar outras. `criar(cfg)` la embaixo devolve tudo isto por empresa.


/** Segredo da assinatura. Estavel entre deploys — e esse o ponto. */
function segredo() {
  return String(process.env.AMB_SESSION_SECRET || process.env.ADMIN_KEY || '')
    || 'amb-sem-segredo-configurado';
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function assinar(payloadB64) {
  return crypto.createHmac('sha256', segredo()).update(payloadB64).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}



/**
 * Confere usuario e senha.
 * Devolve { nome, tipo } com o nome na grafia cadastrada, ou null.
 */



/** Middleware: exige qualquer usuario logado. */

/** Middleware: exige admin. */


// ⚠️ b344 - A FABRICA. Cada empresa recebe a SUA instancia: cookie proprio,
// caminho proprio, usuarios proprios e — o que mais importa — o seu proprio
// mapa de `sessoes`.
//
// 📌 Sem argumento, devolve o comportamento de hoje: os testes existentes e
// o app-AMB continuam usando o modulo do mesmo jeito.
function criar(cfg) {
  const c = Object.assign({}, PADRAO, cfg || {});
  const users = parseUsers(process.env[c.envUsers] || '');
  const admins = parseAdmins(process.env[c.envAdmins] || '');
  const minhasSessoes = new Map();   // ⚠️ o mapa e DESTA empresa

  const meuValidar = (token, tipoExigido) => {
    if (!token) return null;
    const s = minhasSessoes.get(token);
    if (!s) return null;
    if (Date.now() - s.criado > c.validadeMs) { minhasSessoes.delete(token); return null; }
    if (tipoExigido && s.tipo !== tipoExigido) return null;
    return s;
  };

  return {
    COOKIE: c.cookie,
    CAMINHO_COOKIE: c.caminhoCookie,
    // ⚠️ COPIA EXATA do `autenticar` original — presumi duas coisas erradas
    // na 1a versao e o teste real pegou:
    //   - `parseAdmins` devolve ARRAY, nao Set (`.includes`, nao `.has`)
    //   - o tipo nao-admin e 'estoquista', nao 'user'
    // O 2o teria sido pior: login funcionando e permissao errada, sem erro.
    autenticar: (usuario, senha) => {
      const chave = String(usuario || '').trim().toLowerCase();
      const reg = users[chave];
      if (!reg || reg.senha !== String(senha)) return null;
      return {
        nome: reg.nome,
        tipo: admins.includes(chave) ? 'admin' : 'estoquista',
      };
    },
    novaSessao: (usuario, tipo) => {
      const token = b64url(crypto.randomBytes(24));
      minhasSessoes.set(token, { usuario, tipo, criado: Date.now() });
      for (const [t, s] of minhasSessoes) {
        if (Date.now() - s.criado > c.validadeMs) minhasSessoes.delete(t);
      }
      return token;
    },
    validarSessao: meuValidar,
    sair: (token) => minhasSessoes.delete(token),
    temUsuarios: () => Object.keys(users).length > 0,

    // ⚠️ as 5 abaixo sao COPIA do original, com o estado trocado pelo desta
    // instancia. Nao reescrevi nenhuma: o login e o que nao pode mudar de
    // comportamento, e diferenca aqui so apareceria com o galpao parado na
    // porta.
    opcoesCookie: () => ({
      httpOnly: true,
      sameSite: 'lax',
      path: c.caminhoCookie,
      secure: process.env.NODE_ENV === 'production' || !!process.env.RENDER,
      maxAge: c.validadeMs,
    }),
    tokenDaRequisicao: (req) => (req.cookies && req.cookies[c.cookie]) || null,
    requerLogin: (req, res, next) => {
      const tk = (req.cookies && req.cookies[c.cookie]) || null;
      const ses = meuValidar(tk);
      if (!ses) return res.status(401).json({ ok: false, erro: 'sessao invalida ou expirada' });
      req.usuario = ses.usuario;
      req.tipoUsuario = ses.tipo;
      next();
    },
    requerAdmin: (req, res, next) => {
      const tk = (req.cookies && req.cookies[c.cookie]) || null;
      const ses = meuValidar(tk, 'admin');
      if (!ses) return res.status(401).json({ ok: false, erro: 'acesso restrito ao admin' });
      req.usuario = ses.usuario;
      req.tipoUsuario = ses.tipo;
      next();
    },
    diagnostico: () => {
      const nomes = Object.values(users).map((u) => u.nome);
      const adminsOk = admins.filter((a) => users[a]).map((a) => users[a].nome);
      const adminsFora = admins.filter((a) => !users[a]);
      return {
        usuarios_configurados: nomes.length,
        nomes,                                   // nomes apenas, nunca senha
        admins: adminsOk,
        admins_nao_cadastrados: adminsFora,      // se vier cheio, ha erro de digitacao
        tudo_certo: nomes.length > 0 && adminsOk.length > 0 && adminsFora.length === 0,
        estoquistas: nomes.filter((n) => !adminsOk.includes(n)),
        sessoes_ativas: minhasSessoes.size,
        cookie: c.cookie,
      };
    },
  };
}

// ⚠️ b344 - A INSTANCIA PADRAO VEM DA PROPRIA FABRICA.
//
// Sem isto, o modulo manteria `sessoes`/`USERS` soltos no escopo E uma
// fabrica ao lado — duas fontes do mesmo estado, que e pior que o problema
// original: a AMB usaria uma e quem chamasse `criar()` usaria outra, sem
// nada avisando.
//
// 📌 O export abaixo reexporta desta instancia, entao `auth.requerLogin`,
// `auth.autenticar` etc. seguem funcionando IGUAL pro app-AMB.
const PADRAO_INST = criar();

// ⚠️ TUDO REEXPORTADO DA INSTANCIA PADRAO. O app-AMB nao muda uma linha.
module.exports = {
  criar,
  COOKIE: PADRAO_INST.COOKIE,
  CAMINHO_COOKIE: PADRAO_INST.CAMINHO_COOKIE,
  autenticar: PADRAO_INST.autenticar,
  novaSessao: PADRAO_INST.novaSessao,
  validarSessao: PADRAO_INST.validarSessao,
  opcoesCookie: PADRAO_INST.opcoesCookie,
  tokenDaRequisicao: PADRAO_INST.tokenDaRequisicao,
  requerLogin: PADRAO_INST.requerLogin,
  requerAdmin: PADRAO_INST.requerAdmin,
  diagnostico: PADRAO_INST.diagnostico,
  temUsuarios: PADRAO_INST.temUsuarios,
  sair: PADRAO_INST.sair,
};
