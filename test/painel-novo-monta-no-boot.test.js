'use strict';
// b538 — o /painel-novo.html respondia "indisponivel" em producao: o server.js nao tem `fs` no topo e a montagem
// do painel unico caia no catch ('fs is not defined'). O teste de antes rodava so a lib, nao o servidor.
// Agora: SOBE o servidor de verdade e confere que o painel unico e o base-amb da GOOD montaram.
const { spawn } = require('child_process'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: '0', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
filho.stdout.on('data', (d) => { log += d; }); filho.stderr.on('data', (d) => { log += d; });
setTimeout(() => {
  try { filho.kill('SIGKILL'); } catch (e) {}
  ok(!/\[PAINEL-UNICO\] nao montou/.test(log), '⚠️ o painel unico da GOOD MONTA no boot (antes: "fs is not defined" e /painel-novo.html indisponivel)');
  const s = require('fs').readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i = s.indexOf('const PAINEL_UNICO_GOOD = (() => {'); const j = s.indexOf("app.get('/painel-novo.html'", i);
  ok(!/[^.]\bfs\.readFileSync\(/.test(s.slice(i, j)), '  a montagem nao usa `fs` solto (o server.js nao o declara no topo)');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
}, 12000);
