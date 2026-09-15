// Roda com: node test/auth-amb-sessao-assinada.test.js
//
// Guarda dois achados do Codex no PR #295 (auth-AMB virou fabrica):
//
// 1) P1 - a fabrica perdeu a assinatura HMAC do b130 e ficou so com o Map
//    de sessoes em memoria. Um restart do processo (deploy no Render, que
//    o Diego faz dezenas de vezes por dia) deslogava todo mundo de novo —
//    exatamente o problema que o b130 tinha resolvido.
//
// 2) P1 - `criar(cfg)` aceita silenciosamente um cfg no formato do
//    config-da-empresa padrao (PREFIXO_ENV/PREFIXO), sem os campos de auth
//    (cookie/caminhoCookie/envUsers/envAdmins), e cai nos 4 padroes da AMB
//    sem avisar: outra empresa autenticaria contra AMB_USERS e receberia o
//    cookie da AMB.

process.env.AMB_SESSION_SECRET = 'segredo-de-teste-nao-usar-em-producao';

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const authAMB = require('../amb-devolucoes/lib-AMB/auth-AMB.js');

// ── 1) a sessao sobrevive a um "restart" (nova instancia, Map vazio) ────
{
  const instanciaAntesDoDeploy = authAMB.criar();
  const token = instanciaAntesDoDeploy.novaSessao('diego', 'admin');

  ok(token.includes('.'), 'novaSessao devolve token no formato assinado (payload.assinatura)');
  ok(instanciaAntesDoDeploy.validarSessao(token, 'admin') !== null,
     '  e valida na mesma instancia, como antes');

  // simula o restart do processo: instancia NOVA, minhasSessoes vazio
  const instanciaDepoisDoDeploy = authAMB.criar();
  const sessao = instanciaDepoisDoDeploy.validarSessao(token, 'admin');
  ok(sessao !== null,
     'o token continua valido numa instancia NOVA (Map vazio) — sobrevive ao restart');
  ok(sessao && sessao.usuario === 'diego' && sessao.tipo === 'admin',
     '  com usuario e tipo corretos, extraidos do proprio token');
}

// ── e um token com assinatura adulterada continua sendo rejeitado ───────
{
  const inst = authAMB.criar();
  const token = inst.novaSessao('diego', 'admin');
  const [p] = token.split('.');
  const adulterado = p + '.' + 'assinatura-forjada-qualquer';
  ok(inst.validarSessao(adulterado, 'admin') === null,
     'assinatura errada nao valida (nao da pra forjar sessao de admin)');
}

// ── 2) cfg no formato do config-da-empresa padrao falha explicito ───────
{
  let lancou = false;
  let mensagem = '';
  try {
    // formato real de lib/config-da-empresa.js: PREFIXO_ENV/PREFIXO, sem
    // nenhum dos 4 campos de auth
    authAMB.criar({ PREFIXO_ENV: 'GIRASSOL_', PREFIXO: '/girassol', EMPRESA: 'girassol' });
  } catch (e) {
    lancou = true;
    mensagem = e.message;
  }
  ok(lancou,
     'criar(cfg-do-config-da-empresa) falha explicito, em vez de herdar os 4 padroes da AMB em silencio');
  ok(/cookie|envUsers|envAdmins/.test(mensagem), '  a mensagem aponta os campos que faltam');
}

// ── e continua aceitando cfg sem argumento (comportamento de hoje) ──────
{
  let lancou = false;
  try { authAMB.criar(); } catch (e) { lancou = true; }
  ok(!lancou, 'criar() sem argumento continua funcionando (padrao da AMB)');
}

// ── e aceita um cfg proprio, com os 4 campos de auth ─────────────────────
{
  let lancou = false;
  try {
    authAMB.criar({
      cookie: 'sessao_girassol',
      caminhoCookie: '/girassol',
      envUsers: 'GIRASSOL_USERS',
      envAdmins: 'GIRASSOL_ADMIN_USER',
    });
  } catch (e) { lancou = true; }
  ok(!lancou, 'criar(cfg) com os 4 campos de auth funciona normalmente');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
