// ============================================================
// amb-devolucoes/lib-AMB/auth-AMB.js           (AMB Devol. b7)
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
// As sessoes ficam em MEMORIA. Restart do servico desloga todo
// mundo — e aceitavel (o servico reinicia em segundos e o login
// e uma tela so), mas e bom saber para nao estranhar.
// ============================================================

'use strict';

const crypto = require('crypto');

const COOKIE = 'sessao_amb';
const CAMINHO_COOKIE = '/amb';
const VALIDADE_MS = 12 * 60 * 60 * 1000;   // 12 horas

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

const USERS = parseUsers(process.env.AMB_USERS || '');
const ADMINS = parseAdmins(process.env.AMB_ADMIN_USER || '');

const sessoes = new Map();   // token -> { usuario, tipo, criado }

function novaSessao(usuario, tipo) {
  const token = crypto.randomBytes(24).toString('hex');
  sessoes.set(token, { usuario, tipo, criado: Date.now() });
  // limpeza das vencidas, pra Map nao crescer sem fim
  for (const [t, s] of sessoes) {
    if (Date.now() - s.criado > VALIDADE_MS) sessoes.delete(t);
  }
  return token;
}

function validarSessao(token, tipoEsperado) {
  if (!token) return null;
  const s = sessoes.get(token);
  if (!s) return null;
  if (Date.now() - s.criado > VALIDADE_MS) {
    sessoes.delete(token);
    return null;
  }
  if (tipoEsperado && s.tipo !== tipoEsperado) return null;
  return s;
}

/**
 * Confere usuario e senha.
 * Devolve { nome, tipo } com o nome na grafia cadastrada, ou null.
 */
function autenticar(usuario, senha) {
  const chave = String(usuario || '').trim().toLowerCase();
  const reg = USERS[chave];
  if (!reg || reg.senha !== String(senha)) return null;
  return {
    nome: reg.nome,
    tipo: ADMINS.includes(chave) ? 'admin' : 'estoquista',
  };
}

function opcoesCookie() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: CAMINHO_COOKIE,
    // No Render (HTTPS) o cookie so trafega criptografado.
    secure: process.env.NODE_ENV === 'production' || !!process.env.RENDER,
    maxAge: VALIDADE_MS,
  };
}

function tokenDaRequisicao(req) {
  return (req.cookies && req.cookies[COOKIE]) || null;
}

/** Middleware: exige qualquer usuario logado. */
function requerLogin(req, res, next) {
  const s = validarSessao(tokenDaRequisicao(req));
  if (!s) return res.status(401).json({ ok: false, erro: 'sessao invalida ou expirada' });
  req.usuario = s.usuario;
  req.tipoUsuario = s.tipo;
  next();
}

/** Middleware: exige admin. */
function requerAdmin(req, res, next) {
  const s = validarSessao(tokenDaRequisicao(req), 'admin');
  if (!s) return res.status(401).json({ ok: false, erro: 'acesso restrito ao admin' });
  req.usuario = s.usuario;
  req.tipoUsuario = s.tipo;
  next();
}

function diagnostico() {
  const nomes = Object.values(USERS).map(u => u.nome);
  const adminsOk = ADMINS.filter(a => USERS[a]).map(a => USERS[a].nome);
  const adminsFora = ADMINS.filter(a => !USERS[a]);
  return {
    usuarios_configurados: nomes.length,
    nomes,                                   // nomes apenas, nunca senha
    admins: adminsOk,
    admins_nao_cadastrados: adminsFora,      // se vier cheio, ha erro de digitacao
    tudo_certo: nomes.length > 0 && adminsOk.length > 0 && adminsFora.length === 0,
    estoquistas: nomes.filter(n => !adminsOk.includes(n)),
    sessoes_ativas: sessoes.size,
    cookie: COOKIE,
  };
}

module.exports = {
  COOKIE, CAMINHO_COOKIE,
  autenticar, novaSessao, validarSessao,
  opcoesCookie, tokenDaRequisicao,
  requerLogin, requerAdmin,
  diagnostico,
  temUsuarios: () => Object.keys(USERS).length > 0,
  sair: (token) => sessoes.delete(token),
};
