'use strict';
// ⚠️ P0 DA AUDITORIA: o segredo de sessão tinha padrão PÚBLICO.
//
// O fallback era `'good-sem-segredo'` — string fixa, no arquivo e no
// histórico do git. Quem a lê **forja um cookie de admin**, porque o payload
// assinado carrega o tipo do usuário.
//
// [stated 13/09] "vou fazer uma palavra chamada ADMIN_SESSION_SECRET"

const fs = require('fs');
const path = require('path');
const { entreMarcadores } = require('./_recorte');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// ── ⚠️ nenhum padrão público ────────────────────────────────────────
{
  // ⚠️ sem comentarios: o comentario que EXPLICA o bug cita a string, e o
  // teste acusava o proprio texto que documenta a correcao. Terceira vez
  // hoje que isso acontece — ja esta no CLAUDE.md.
  const semComent = srv.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(!/'good-sem-segredo'/.test(semComent),
     '⚠️ a string fixa saiu do CODIGO (o comentario pode cita-la)');
  ok(!/process\.env\.ADMIN_KEY \|\| 'good/.test(srv),
     '  e nao cai mais na ADMIN_KEY (que ja vazou em logs)');
}

// ── lê o nome que o dono escolheu, e o antigo por compatibilidade ───
{
  const fn = entreMarcadores(srv, 'function _segredoSessao()', 'function _assinar');
  ok(/process\.env\.ADMIN_SESSION_SECRET \|\| process\.env\.SESSION_SECRET/.test(fn),
     'le `ADMIN_SESSION_SECRET` primeiro, `SESSION_SECRET` como compat');

  // ⚠️ aceitar os dois elimina uma classe de engano: se o código lesse um
  // nome e o Render tivesse outro, o erro diria "ausente" sem dizer que o
  // problema é o NOME.
  ok(/doAmbiente\.length >= 16/.test(fn),
     '⚠️ e exige tamanho minimo (segredo curto e quase tao ruim quanto nenhum)');
}

// ── ⚠️ em produção, falha no BOOT ───────────────────────────────────
//
// `_segredoSessao()` só roda quando alguém entra — então o processo subia
// sem segredo e só quebraria no primeiro login, com o galpão já tentando
// trabalhar.
{
  const fn = entreMarcadores(srv, 'function _segredoSessao()', 'function _assinar');
  ok(/process\.env\.NODE_ENV === 'production'/.test(fn)
     && /process\.exit\(1\)/.test(fn),
     '⚠️ em producao, sem segredo o processo NAO SOBE');

  // e a checagem acontece antes de abrir a porta
  const iCheck = srv.indexOf('_segredoSessao();\n');
  const iListen = srv.indexOf('app.listen(');
  ok(iCheck > 0 && iCheck < iListen,
     '  ⚠️ e a checagem roda ANTES do app.listen (falha no deploy, nao no 1o login)');
}

// ── e fora de produção não trava o desenvolvimento ──────────────────
{
  const fn = entreMarcadores(srv, 'function _segredoSessao()', 'function _assinar');
  ok(/crypto\.randomBytes\(32\)/.test(fn),
     'fora de producao, gera segredo ALEATORIO por execucao');
  ok(!/_SEGREDO_MEM = '/.test(srv),
     '  ⚠️ e nao e um valor fixo (aleatorio nao vira chave conhecida)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
