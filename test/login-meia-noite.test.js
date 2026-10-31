'use strict';
// 31/10 — o login do Devolucoes acaba na MEIA-NOITE de Sao Paulo (ou nas 12 h, o que vier primeiro): de manha cada
// funcionario entra com o PROPRIO login. Roda a peca de PRODUCAO (lib/sessao-meia-noite) e a sessao da fabrica
// (auth-AMB, Girassol/AMB); a GOOD (server.js) e conferida no codigo.
const fs = require('fs'); const path = require('path');
process.env.AMB_SESSION_SECRET = 'segredo-de-teste-nao-usar-em-producao';
const sm = require('../lib/sessao-meia-noite');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const SP = (dia, h, m = 0) => Date.UTC(2026, 9, dia, h + 3, m, 0);   // 31/10/2026 hh:mm em Sao Paulo (UTC-3)
const H12 = 12 * 3600e3;
ok(sm.expiraEm(SP(30, 8), H12) === SP(30, 20), '  login as 8h: vale ate as 20h (as 12 h, antes da meia-noite)');
ok(sm.expiraEm(SP(30, 20), H12) === SP(31, 0), '⚠️ login as 20h: acaba na MEIA-NOITE (antes: ate as 8h do dia seguinte)');
ok(sm.expiraEm(SP(30, 23, 59), H12) === SP(31, 0), '  login as 23h59: acaba na meia-noite');
ok(!sm.venceu(SP(30, 20), H12, SP(30, 23, 59)) && sm.venceu(SP(30, 20), H12, SP(31, 0)) && sm.venceu(SP(30, 20), H12, SP(31, 7, 30)),
  '⚠️ sessao das 20h vale ate 23h59 e acabou na meia-noite (de manha precisa logar de novo)');
ok(sm.maxAgeCookie(H12, SP(30, 23, 59, 50)) >= 60e3 && sm.maxAgeCookie(H12, SP(30, 8)) === H12, '  o cookie acaba junto (minimo de 1 min)');
// fabrica (Girassol/AMB): sessao de verdade, com o relogio controlado
const authAMB = require('../amb-devolucoes/lib-AMB/auth-AMB.js');
const real = Date.now;
try {
  Date.now = () => SP(30, 20);
  const inst = authAMB.criar();
  const tok = inst.novaSessao('ygor', 'estoquista');
  Date.now = () => SP(30, 23, 50);
  ok(inst.validarSessao(tok) !== null, '  fabrica: logado as 20h, vale as 23h50');
  Date.now = () => SP(31, 7, 30);
  ok(inst.validarSessao(tok) === null, '⚠️ fabrica: na manha seguinte (7h30) a sessao das 20h NAO vale mais');
  // o token novo leva a hora do login (c) — e o de antes deste deploy (sem c) tem a hora deduzida de e - 12 h no codigo
  Date.now = () => SP(30, 20);
  const instB = authAMB.criar();
  const tokNovo = instB.novaSessao('x', 'estoquista');
  ok(typeof tokNovo === 'string' && tokNovo.includes('.'), '  token novo continua assinado');
  const payloadNovo = JSON.parse(Buffer.from(tokNovo.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  ok(payloadNovo.c === SP(30, 20) && payloadNovo.e === SP(31, 0), '  o token novo leva a hora do login (c) e acaba na meia-noite (e)');
} finally { Date.now = real; }
// GOOD (server.js): mesma peca na criacao, na conferencia e no cookie
const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
ok(/e: sessaoMeiaNoite\.expiraEm\(criado, validadeMs \|\| 12 \* 60 \* 60 \* 1000\), c: criado/.test(srv)
  && /if \(criadoTok && sessaoMeiaNoite\.venceu\(criadoTok, 12 \* 60 \* 60 \* 1000\)\) return null;/.test(srv)
  && /maxAge: sessaoMeiaNoite\.maxAgeCookie\(12 \* 60 \* 60 \* 1000\)/.test(srv)
  && /if \(sessaoMeiaNoite\.venceu\(s\.criado, 12 \* 60 \* 60 \* 1000\)\) \{/.test(srv),
  '⚠️ GOOD: a mesma regra na criacao, na conferencia (inclusive token antigo), na sessao em memoria e no cookie');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
