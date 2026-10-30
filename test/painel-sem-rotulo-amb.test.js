'use strict';
// 30/10 — o painel e UNICO das 3 empresas (GOOD serve o painel-AMB.html). O cabecalho tinha 'AMB b67' fixo e aparecia
// na GOOD e na Girassol — mesmo caso do #502 ('AMB Devolucoes' na Girassol). Nenhum rotulo de empresa fixo no HTML.
const fs = require('fs'); const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
const ok = !/Painel restrito · AMB\b/.test(html) && /<p>Painel restrito · itens da NF já abertos<\/p>/.test(html);
console.log((ok ? 'ok  ' : 'FALHA ') + '⚠️ cabecalho do painel unico sem "AMB b67" fixo (aparecia na GOOD e na Girassol)');
console.log(ok ? '=== TODOS OS CASOS PASSARAM' : '=== 1 FALHA(S)');
process.exit(ok ? 0 : 1);
