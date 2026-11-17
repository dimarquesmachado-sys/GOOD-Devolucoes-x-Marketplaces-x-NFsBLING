'use strict';
// b592: o painel unico da GOOD (/painel-novo.html) MONTA no boot — antes "fs is not defined" e a rota ficava indisponivel.
// b737 (P2-15, auditoria do Codex 15/11): o teste sobe o server.js DE VERDADE e so passa com RESPOSTA HTTP REAL.
// A versao anterior checava apenas a ausencia de uma frase no log depois de 12s: um filho morto por SyntaxError no
// boot (log vazio) passava. Agora (test/_boot-real.js): morte antecipada = falha; /health 200 de verdade;
// /painel-novo.html responde 200 com o HTML do painel.
// Roda com: node test/painel-novo-monta-no-boot.test.js
const fs = require('fs');
const path = require('path');
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

(async () => {
  const s = await subir({ env: { DEVOLUCOES_DESATIVAR_AMBTOTAL: '1', USERS: 'diego:senha123:Diego', ADMIN_USER: 'diego', SESSION_SECRET: 'segredo-de-teste-da-good-nao-usar' } });
  ok(!s.morreuCedo, '⚠️ o server.js NAO morreu no boot' + (s.morreuCedo ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
  ok(s.subiu, '⚠️ o /health respondeu 200 de verdade' + (!s.subiu && !s.morreuCedo ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
  if (s.subiu) {
    ok(!/\[PAINEL-UNICO\] nao montou/.test(s.log()), '  o log nao diz que o painel unico nao montou');
    // a rota e de admin: sem sessao redireciona (302) — entao loga de verdade e pede com o cookie
    const semSessao = await s.pedir('/painel-novo.html');
    ok(semSessao.status === 302, '  sem sessao: 302 pro login (a protecao segue)');
    const login = await s.pedir('/api/auth/login', { metodo: 'POST', corpo: { usuario: 'diego', senha: 'senha123' } });
    const cookie = ((login.headers['set-cookie'] || []).find((x) => x.startsWith('sessao=')) || '').split(';')[0];
    ok(login.status === 200 && cookie, '  login admin ok');
    const r = await s.pedir('/painel-novo.html', { cookie });
    ok(r.status === 200 && /<html/i.test(r.corpo) && /painel/i.test(r.corpo), '⚠️ /painel-novo.html responde 200 com o HTML do painel (status ' + r.status + ', ' + r.corpo.length + ' bytes)');
    ok(/text\/html/.test(String(r.headers['content-type'] || '')), '  content-type text/html');
  }
  s.matar();
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i = src.indexOf('const PAINEL_UNICO_GOOD = (() => {'); const j = src.indexOf("app.get('/painel-novo.html'", i);
  ok(i > 0 && j > i && !/[^.]\bfs\.readFileSync\(/.test(src.slice(i, j)), '  a montagem nao usa `fs` solto (o server.js nao o declara no topo)');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
