'use strict';
// b541 — dono, 05/10: no painel unico, o Gerar NF dos PROBLEMAS abria no deposito GERAL; e no celular tinha botao
// saindo da tela. Roda a regra de producao do modal (ehProblema) com o que o card de problema manda.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const h = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
const i = h.indexOf('function itemHtmlProblema'); const j = h.indexOf('function itemHtmlDivergente', i);
const card = h.slice(i, j);
ok(/'problema', '\$\{serieDoRegistro\(d\)\}', \$\{!!d\.so_rascunho\}\)/.test(card), '⚠️ o card de PROBLEMA manda "problema" pro Gerar NF (a fila decide, nao o texto do status de cada empresa)');
const m = h.match(/var ehProblema = (\/[^\n]+?\/i)\.test\(String\(statusTriagem \|\| ''\)\);/);
const re = m && eval(m[1]);
ok(re && re.test('problema'), '⚠️ com isso o modal marca o deposito de DEFEITOS (regra de producao: ' + (m && m[1]) + ')');
ok(re && !re.test('aprovada'), '  aprovadas seguem abrindo no GERAL');
const media = h.slice(h.indexOf('@media (max-width: 600px) {'), h.indexOf('@media (max-width: 600px) {') + 1500);
ok(/\.btn, \.item-acoes a, \.item-acoes button \{ max-width: 100%; white-space: normal;/.test(media), '⚠️ celular: botao quebra a linha dentro do card em vez de sair da tela');
ok(/code, \.item-detalhes/.test(media) && /overflow-wrap: anywhere/.test(media), '  celular: chave de NF/rastreio longos quebram dentro do card');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
