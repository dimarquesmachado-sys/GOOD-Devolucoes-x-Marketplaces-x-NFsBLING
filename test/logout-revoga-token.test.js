'use strict';
// b734 — P2-09 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): LOGOUT REVOGA O TOKEN ASSINADO.
//
// O token de sessao e assinado e vale ate vencer (foi assim que o deploy parou de deslogar o galpao). Mas `sair()`
// so apagava o Map e o cookie: um token capturado continuava entrando ate a meia-noite. Agora ha lista de revogados
// por empresa (lib/sessoes-revogadas.js): o logout revoga ESTA sessao; sairDeTodos encerra todas as do usuario.
// Aqui: (1) a peca; (2) o auth-AMB real (fabrica); (3) o server.js REAL da GOOD: login → /me ok → logout → o MESMO
// cookie e recusado.
// Roda com: node test/logout-revoga-token.test.js
process.env.AMB_SESSION_SECRET = 'segredo-de-teste-nao-usar-em-producao';
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

// ── 1. a peca ──
{
  const { criar } = require('../lib/sessoes-revogadas');
  let agora = 1000000; const r = criar({ agora: () => agora });
  ok(r.revogado('tok-a', { usuario: 'ana', criado: agora }) === false, 'nada revogado: token passa');
  r.revogarToken('tok-a', agora + 5000);
  ok(r.revogado('tok-a', { usuario: 'ana', criado: agora }) === true && r.revogado('tok-b', { usuario: 'ana', criado: agora }) === false, '⚠️ revogarToken: SO aquele token cai; outro do mesmo usuario segue');
  r.revogarUsuario('Ana', agora + 100);
  ok(r.revogado('tok-b', { usuario: 'ana', criado: agora }) === true, '⚠️ revogarUsuario: token criado ANTES do carimbo cai (usuario sem distincao de caixa)');
  ok(r.revogado('tok-c', { usuario: 'ana', criado: agora + 200 }) === false, '  token criado DEPOIS do carimbo (login novo) passa');
  ok(r.revogado('tok-d', { usuario: 'ana' }) === true, '  token sem `c` (de antes deste deploy) vale como antigo: cai');
  agora += 70000;   // passou a expiracao do tok-a e o intervalo de limpeza
  ok(r.tamanho().tokens === 0 && r.revogado('tok-a', { usuario: 'bia', criado: agora }) === false, '  token revogado que ja venceu sai da lista (nao cresce sem fim)');
  ok(r.revogarToken('', 0) === false && r.revogarUsuario('', 0) === false, '  entradas vazias nao gravam');
}
// ── 2. a fabrica (auth-AMB real) ──
{
  const authAMB = require('../amb-devolucoes/lib-AMB/auth-AMB.js');
  const auth = authAMB.criar();
  const t1 = auth.novaSessao('diego', 'admin');
  const tick = Date.now(); while (Date.now() === tick) { /* 1 ms: dois logins no mesmo ms gerariam o MESMO token */ }
  const t2 = auth.novaSessao('diego', 'admin');
  const t3 = auth.novaSessao('lucas', 'estoquista');
  ok(t1 !== t2, 'dois logins do mesmo usuario (ms diferentes) sao tokens diferentes');
  ok(auth.validarSessao(t1, 'admin') && auth.validarSessao(t2, 'admin'), 'duas sessoes do diego validas');
  auth.sair(t1);
  ok(auth.validarSessao(t1) === null, '⚠️ auth-AMB: depois do sair(), o MESMO token assinado e recusado (antes: entrava ate a meia-noite)');
  ok(auth.validarSessao(t2, 'admin') !== null, '  a outra sessao do diego (outro aparelho) segue valida');
  const t1b = t1.split('.')[0] + '.' + t1.split('.')[1];
  ok(auth.validarSessao(t1b) === null, '  copia do token revogado tambem nao entra');
  auth.sairDeTodos('diego');
  ok(auth.validarSessao(t2) === null && auth.validarSessao(t3, 'estoquista') !== null, '⚠️ sairDeTodos(diego): todas as do diego caem; a do lucas segue');
  const t4 = auth.novaSessao('diego', 'admin');
  ok(auth.validarSessao(t4, 'admin') !== null, '  login novo do diego depois do sairDeTodos vale');
  ok(auth.revogadas().tokens === 1 && auth.revogadas().usuarios === 1, '  diagnostico: 1 token e 1 usuario na lista');
}
// ── 3. a GOOD de verdade (server.js) ──
function portaLivre() { return new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); }); }
function pedir(porta, caminho, { metodo = 'GET', cookie = null, corpo = null } = {}) {
  return new Promise((resolve) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: Object.assign({}, cookie ? { Cookie: cookie } : {}, dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}) }, (res) => {
      let c = ''; res.on('data', (x) => { c += x; }); res.on('end', () => resolve({ status: res.statusCode, corpo: c, setCookie: res.headers['set-cookie'] || [] }));
    });
    req.on('error', () => resolve({ status: 0, corpo: '', setCookie: [] }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, corpo: '', setCookie: [] }); });
    if (dados) req.write(dados);
    req.end();
  });
}
(async () => {
  const porta = await portaLivre();
  const env = Object.assign({}, process.env, { ADMIN_KEY: 'x', PORT: String(porta), USERS: 'diego:senha123:Diego', ADMIN_USER: 'diego', SESSION_SECRET: 'segredo-de-teste-da-good-nao-usar', DEVOLUCOES_DESATIVAR_AMBTOTAL: '1' });
  const filho = spawn(process.execPath, ['-e', "require('./server.js');"], { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = ''; filho.stdout.on('data', (c) => { saida = (saida + c).slice(-4000); }); filho.stderr.on('data', (c) => { saida = (saida + c).slice(-4000); });
  let subiu = false;
  for (let i = 0; i < 80 && !subiu; i++) { await new Promise((r) => setTimeout(r, 250)); if ((await pedir(porta, '/health')).status === 200) subiu = true; }
  ok(subiu, 'server.js subiu (GOOD hospedeira)');
  if (subiu) {
    const login = await pedir(porta, '/api/auth/login', { metodo: 'POST', corpo: { usuario: 'diego', senha: 'senha123' } });
    const cookie = (login.setCookie.find((x) => x.startsWith('sessao=')) || '').split(';')[0];
    ok(login.status === 200 && cookie, '  login ok, cookie de sessao recebido');
    const me1 = await pedir(porta, '/api/auth/me', { cookie });
    ok(/"ok":true/.test(me1.corpo), '  /me com o cookie: ok');
    const out = await pedir(porta, '/api/auth/logout', { metodo: 'POST', cookie });
    ok(out.status === 200, '  logout 200');
    const me2 = await pedir(porta, '/api/auth/me', { cookie });
    ok(/"ok":false/.test(me2.corpo), '⚠️ GOOD: o MESMO cookie depois do logout e recusado pelo /me (antes: continuava ok ate a meia-noite). Veio: ' + me2.corpo);
    const prot = await pedir(porta, '/api/ids-fiscais', { cookie });
    ok(prot.status === 401 || prot.status === 403, '  e uma rota protegida responde ' + prot.status);
  } else {
    console.log('      saida do servidor:\n' + saida.split('\n').slice(-20).join('\n'));
  }
  try { filho.kill('SIGKILL'); } catch (e) { /* ja morreu */ }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
