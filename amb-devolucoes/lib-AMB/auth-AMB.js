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
// ⚠️ b373: recebe o PREFIXO da empresa. A funcao e global (fora da fabrica),
// entao `c` nao existe aqui — minha 1a versao usava e teria quebrado em
// runtime, com `node --check` passando.
function segredo(prefixo) {
  // ⚠️ b373 - O SEGREDO VEM DO PREFIXO DA EMPRESA.
  //
  // Era `AMB_SESSION_SECRET` cravado. Duas empresas com o MESMO segredo
  // assinariam cookies que valem uma na outra — e o escopo por empresa que
  // fechamos hoje dependia justamente disso nao acontecer.
  //
  // 📌 `c.envUsers` e tipo 'AMB_USERS'; tiro o prefixo dele, que ja vem da
  // ficha. Sem prefixo, cai no ADMIN_KEY como antes.
  const _pref = String(prefixo || 'AMB_');
  // ⚠️ o fallback pra `AMB_SESSION_SECRET` SAIU: ele mantinha o vazamento.
  // Com ele, a Girassol sem segredo proprio usaria o da AMB — e os cookies
  // das duas passariam a valer um no outro, que e exatamente o que este
  // trabalho fecha.
  //
  // 📌 O `ADMIN_KEY` continua como ultimo recurso: e do SERVICO, nao de uma
  // empresa, entao nao cruza dados entre elas.
  return String(process.env[_pref + 'SESSION_SECRET']
    || process.env.ADMIN_KEY || '')
    || 'amb-sem-segredo-configurado';
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ⚠️ b346 - A ASSINATURA TEM QUE INCLUIR A EMPRESA.
//
// O conserto do #297 devolveu a sessao assinada (que sobrevive ao restart —
// certo, e importante: sem isso o galpao cai a cada deploy). Mas assinar so
// com o segredo do SERVIDOR faz o token da AMB valer na Girassol: o segredo
// e o mesmo, e nada no token diz de quem ele e.
//
// ⚠️ Eu PROVEI o vazamento antes de mexer: `gira.validarSessao(tokenDaAmb)`
// devolvia a sessao. O #295 tinha fechado isso e o #297 reabriu — cada um
// resolvendo metade.
//
// 📌 Agora o `escopo` (o nome do cookie, unico por empresa) entra na chave
// do HMAC. Token de uma empresa NAO valida na outra, e continua
// sobrevivendo ao restart.
function assinarCom(escopo, payloadB64) {
  // ⚠️ b373: o prefixo sai do proprio escopo (o nome do cookie: sessao_amb,
  // sessao_girassol), entao cada empresa assina com o SEU segredo.
  const pref = String(escopo || '').replace(/^sessao_/, '').toUpperCase() + '_';
  return crypto.createHmac('sha256', segredo(pref) + '|' + String(escopo || ''))
    .update(payloadB64).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

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
  // ⚠️ P1 (Codex, #295) - cfg no formato do config-da-empresa padrao
  // (PREFIXO_ENV/PREFIXO, sem cookie/caminhoCookie/envUsers/envAdmins)
  // cairia direto nos 4 padroes da AMB, em silencio: outra empresa
  // autenticaria contra AMB_USERS e receberia o cookie 'sessao_amb' em
  // '/amb'. Falha explicita aqui, na hora de integrar (passo 3), em vez
  // de um bug de producao descoberto pelo galpao errado.
  if (cfg && !('cookie' in cfg) && !('caminhoCookie' in cfg)
      && !('envUsers' in cfg) && !('envAdmins' in cfg)) {
    throw new Error(
      "auth-AMB.criar: cfg nao tem cookie/caminhoCookie/envUsers/envAdmins "
      + '— este cfg nao e o formato esperado (talvez seja o config-da-empresa '
      + 'padrao, que nao tem campos de auth). Passe os 4 campos ou omita cfg '
      + 'para usar os padroes da AMB.'
    );
  }
  const c = Object.assign({}, PADRAO, cfg || {});
  const users = parseUsers(process.env[c.envUsers] || '');
  const admins = parseAdmins(process.env[c.envAdmins] || '');
  const minhasSessoes = new Map();   // ⚠️ o mapa e DESTA empresa

  // b130, restaurado (Codex P1, #295) - a fabrica tinha perdido a
  // assinatura HMAC e ficado so com o Map: um restart do processo (deploy
  // no Render) deslogava todo mundo de novo. Mesmo esquema de antes,
  // agora por instancia.
  const meuValidar = (token, tipoExigido) => {
    if (!token) return null;

    // 1) token assinado (o formato novo) - nao depende de memoria nenhuma
    if (token.includes('.')) {
      const [p, assinatura] = token.split('.');
      if (p && assinatura) {
        let esperada;
        // ⚠️ b346: valida com a chave DESTA empresa
        try { esperada = assinarCom(c.cookie, p); } catch (e) { esperada = null; }
        // comparacao de tempo constante, pra nao vazar o segredo pelo relogio
        const iguais = esperada && esperada.length === assinatura.length
          && crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(assinatura));
        if (iguais) {
          try {
            const dados = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
            if (!dados || !dados.u) return null;
            if (dados.e && Date.now() > dados.e) return null;          // venceu
            if (tipoExigido && dados.t !== tipoExigido) return null;
            return { usuario: dados.u, tipo: dados.t, criado: (dados.e || 0) - c.validadeMs };
          } catch (e) { return null; }
        }
      }
    }

    // 2) token antigo, ainda na memoria deste processo
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
      const payload = JSON.stringify({ u: usuario, t: tipo, e: Date.now() + c.validadeMs });
      const p = b64url(payload);
      const token = p + '.' + assinarCom(c.cookie, p);   // b346
      // o Map continua alimentado: serve de ponte pros tokens antigos e
      // nao atrapalha em nada
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
