'use strict';
// b529 — auditoria (Codex, b520): o gerador de empresa nova recusa uma chave que ja existe (mesmo com outro sufixo).
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const { gerar } = require(path.join(__dirname, '..', 'scripts', 'nova-empresa.js'));
for (const chave of ['girassol', 'good', 'ambtotal']) {
  const r = gerar(chave, 'Teste da auditoria', 'sufteste');
  ok(r && r.ok === false && /JA EXISTE/.test((r.erros || []).join(' ')), '⚠️ chave existente "' + chave + '" com sufixo novo e RECUSADA');
}
const nova = gerar('lojaquatro', 'Loja Quatro', 'lojaq');
ok(nova && nova.ok === true, '  uma chave realmente nova continua gerando a ficha');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
