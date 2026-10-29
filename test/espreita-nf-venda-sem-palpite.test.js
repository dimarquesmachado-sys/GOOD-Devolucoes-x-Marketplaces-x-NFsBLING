'use strict';
// 29/10 — a NF de venda do card da espreita (Girassol/AMB) so vem de fonte FIRME. O palpite pelo nome do cliente
// (acharNfPorNomeIndice) pegava a NF de OUTRA compra de quem comprou mais de uma vez (tosquiadeira 2609069UWS4UFX:
// venda 126747, mostrada como 126807) e a captura guardada gravava isso como a NF da venda.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const app = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
const linha = (campo) => (new RegExp('\\n      ' + campo + ': [^\\n]*(\\n        [^\\n]*)*').exec(app) || [''])[0];
ok(linha('nf_venda') && !/nfNome/.test(linha('nf_venda')), '⚠️ nf_venda: so fonte firme (ML, venda pelo pedido, loja) — sem o palpite pelo nome');
ok(linha('nf_serie') && !/nfNome/.test(linha('nf_serie')), '⚠️ nf_serie: idem');
ok(linha('link_nf_bling') && !/nfNome/.test(linha('link_nf_bling')), '⚠️ link "abrir NF no Bling": nao aponta pra NF do palpite');
ok(/nf_venda_provavel: \(!jaTemNf && nfNome && nfNome\.numero\)/.test(app) && /via: 'nome do cliente'/.test(app), '  o palpite continua disponivel, MARCADO, em nf_venda_provavel');
const cap = fs.readFileSync(path.join(__dirname, '..', 'lib', 'devolucoes-capturadas.js'), 'utf8');
ok(/nf_numero: txt\(d\.nf_numero \|\| d\.nf \|\| d\.nf_venda, 40\)/.test(cap) && !/nf_venda_provavel/.test(cap), '  a captura guardada le so os campos oficiais — o palpite nunca e salvo como NF');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
