'use strict';
// b737 — P2-15: o helper de boot (test/_boot-real.js) NAO aceita processo quebrado. Prova com um "servidor" que morre
// de SyntaxError e outro que sobe mas nunca responde: os dois tem que sair como falha, com motivo.
// Roda com: node test/boot-real-detecta-morte.test.js
const fs = require('fs');
const path = require('path');
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

(async () => {
  const quebrado = '_boot-real-quebrado.tmp.js';
  fs.writeFileSync(path.join(RAIZ, quebrado), "console.log('subindo'); this is not javascript ((\n");
  const a = await subir({ arquivo: quebrado, tetoMs: 10000 });
  ok(a.morreuCedo && !a.subiu && /MORREU antes de responder/.test(a.motivo), '⚠️ SyntaxError no boot = morte antecipada detectada em segundos, nao "passou" (motivo: ' + a.motivo + ')');
  ok(/SyntaxError/.test(a.log()), '  o fim do log traz o SyntaxError');
  fs.unlinkSync(path.join(RAIZ, quebrado));

  const mudo = '_boot-real-mudo.tmp.js';
  fs.writeFileSync(path.join(RAIZ, mudo), "setInterval(() => {}, 1000);\n");   // vivo, mas sem porta
  const t0 = Date.now();
  const b = await subir({ arquivo: mudo, tetoMs: 1500 });
  b.matar();
  ok(!b.subiu && !b.morreuCedo && /nao respondeu 200/.test(b.motivo) && Date.now() - t0 < 6000, '  processo vivo que nunca responde: falha pelo teto, com motivo (' + b.motivo + ')');
  fs.unlinkSync(path.join(RAIZ, mudo));

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
