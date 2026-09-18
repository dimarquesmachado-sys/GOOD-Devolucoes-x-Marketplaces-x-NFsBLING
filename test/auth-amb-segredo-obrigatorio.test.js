// Roda com: node test/auth-amb-segredo-obrigatorio.test.js
//
// ⚠️ P1 (Codex, PR #323, 2 rodadas) - o `auth-AMB.js` caia silenciosamente
// pro `ADMIN_KEY` (ja vazada em logs, avisado pelo proprio server.js) ou, se
// nem essa existisse, pro literal PUBLICO `'amb-sem-segredo-configurado'` —
// uma string que esta no historico do git e que qualquer um pode ler e usar
// pra forjar um cookie de admin de qualquer empresa sem
// `<PREFIXO>SESSION_SECRET` proprio configurado. A 1a correcao (b374) tirou
// so o literal e manteve o `ADMIN_KEY` — mas o proprio apontamento do Codex
// citava os dois como fracos, e nenhuma checagem de boot cobria essa env.
//
// Este teste PROVA em processo isolado (o segredo tem estado por prefixo,
// no modulo) que: (1) em producao, sem o segredo proprio, o boot desta
// empresa FALHA — nao ha ADMIN_KEY nem literal como saida; (2) com o
// segredo configurado, o boot passa normalmente.

const { execFileSync } = require('child_process');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const AUTH_AMB = path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'auth-AMB.js');

function rodar(env) {
  try {
    // ⚠️ o modulo cria a instancia PADRAO (prefixo AMB_) so de ser
    // `require`ido (b344) — como a AMB ja roda em producao hoje, o dela
    // precisa estar valido pra isolar o que este teste quer medir: o
    // boot da EMPRESA NOVA (prefixo ZZTEST_), nao o da AMB.
    const base = { AMB_SESSION_SECRET: 'segredo-fixo-da-amb-com-mais-de-16-chars' };
    execFileSync(process.execPath, ['-e', `
      const auth = require(${JSON.stringify(AUTH_AMB)});
      auth.criar({
        cookie: 'sessao_zztest',
        caminhoCookie: '/zztest',
        envUsers: 'ZZTEST_USERS',
        envAdmins: 'ZZTEST_ADMIN_USER',
      });
      console.log('BOOT_OK');
    `], { env: Object.assign({}, process.env, base, env), stdio: 'pipe' });
    return { ok: true };
  } catch (e) {
    return { ok: false, stderr: String(e.stderr || ''), stdout: String(e.stdout || '') };
  }
}

// ── em producao, sem segredo proprio, o boot desta empresa FALHA ───────
{
  const r = rodar({ NODE_ENV: 'production', ZZTEST_SESSION_SECRET: '', ADMIN_KEY: 'chave-admin-do-servico' });
  ok(!r.ok, '⚠️ producao sem ZZTEST_SESSION_SECRET: criar() lanca, o boot nao sobe');
  ok(/ZZTEST_SESSION_SECRET/.test(r.stderr),
     '  a mensagem aponta a env que falta, com o prefixo certo');
  ok(!/amb-sem-segredo-configurado/.test(r.stderr),
     '  ⚠️ e NAO cai no literal publico do codigo');
}

// ── ⚠️ nem o ADMIN_KEY (do servico) resolve mais em producao ────────────
{
  const r = rodar({ NODE_ENV: 'production', ZZTEST_SESSION_SECRET: '', ADMIN_KEY: 'chave-admin-do-servico-com-mais-de-16-chars' });
  ok(!r.ok, '⚠️ ADMIN_KEY presente e forte NAO basta — cada empresa exige o SEU segredo');
}

// ── com segredo curto (menos de 16 chars), tambem falha ────────────────
{
  const r = rodar({ NODE_ENV: 'production', ZZTEST_SESSION_SECRET: 'curto' });
  ok(!r.ok, 'segredo curto (< 16 chars) tambem nao passa em producao');
}

// ── com o segredo proprio e forte, o boot passa normalmente ────────────
{
  const r = rodar({
    NODE_ENV: 'production',
    ZZTEST_SESSION_SECRET: 'segredo-forte-de-40-caracteres-aqui!!!!',
  });
  ok(r.ok, 'com ZZTEST_SESSION_SECRET configurado (>=16 chars), o boot passa');
}

// ── fora de producao, sem segredo, nao trava o dev/teste ────────────────
{
  const r = rodar({ NODE_ENV: '', ZZTEST_SESSION_SECRET: '' });
  ok(r.ok, 'fora de producao, sem segredo proprio, so avisa — nao derruba o boot');
}

// ── ⚠️ (Codex, PR #323, P2, b377) - so o `require`, sem tocar na instancia
//    PADRAO (a da AMB), NAO PODE exigir AMB_SESSION_SECRET.
//
// Antes, `const PADRAO_INST = criar();` rodava na hora do `require` — uma
// producao so com a Girassol ativa (sem AMB) derrubaria o boot pedindo o
// segredo de uma empresa que ninguem monta. Agora a instancia padrao e
// preguicosa: so e criada se alguem acessar um dos campos reexportados
// (`auth.autenticar`, etc). `criar(cfg)` para OUTRA empresa nunca toca nela.
{
  try {
    execFileSync(process.execPath, ['-e', `
      const auth = require(${JSON.stringify(AUTH_AMB)});
      auth.criar({
        cookie: 'sessao_zztest',
        caminhoCookie: '/zztest',
        envUsers: 'ZZTEST_USERS',
        envAdmins: 'ZZTEST_ADMIN_USER',
      });
      console.log('BOOT_OK');
    `], {
      env: Object.assign({}, process.env, {
        NODE_ENV: 'production',
        AMB_SESSION_SECRET: '',
        ZZTEST_SESSION_SECRET: 'segredo-forte-de-40-caracteres-aqui!!!!',
      }),
      stdio: 'pipe',
    });
    ok(true, '⚠️ producao SEM AMB_SESSION_SECRET sobe outra empresa, se o require nao tocar na instancia da AMB');
  } catch (e) {
    ok(false, '⚠️ producao SEM AMB_SESSION_SECRET sobe outra empresa, se o require nao tocar na instancia da AMB');
    console.log('  ' + String((e && e.stderr) || e));
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
