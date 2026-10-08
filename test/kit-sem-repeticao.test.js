'use strict';
// b591 — dono, 08/10 (NF 127013): card de kit diz KIT no topo e o bloco "Voltaram N produtos" so aparece na PARCIAL.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const h = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
function f(n) { const i = h.search(new RegExp('function ' + n + '\\s*\\(')); let j = h.indexOf('{', i), p = 0, k = j; for (; k < h.length; k++) { if (h[k] === '{') p++; else if (h[k] === '}') { p--; if (!p) break; } } return h.slice(i, k + 1); }
const ctx = { escapeHtml: (x) => String(x) }; vm.createContext(ctx);
vm.runInContext(f('faltasDevolucaoParcial') + f('linhaItensDevolvidos') + f('textoVariosProdutos'), ctx);
const nf = [{ sku: '7150-110v', quantidade: 1 }, { sku: 'CABOLATERAL', quantidade: 1 }, { sku: 'KP19', quantidade: 1 }];
ok(/KIT/.test(ctx.textoVariosProdutos(3)) && /3 produtos na NF/.test(ctx.textoVariosProdutos(3)), '⚠️ o topo do card diz KIT (3 produtos na NF)');
ok(ctx.linhaItensDevolvidos({ itens_devolvidos: [{ sku: '7150-110v', qtd: 1 }, { sku: 'CABOLATERAL', qtd: 1 }, { sku: 'KP19', qtd: 1 }], nf_itens: nf }) === '', '⚠️ voltou TUDO: nao repete a lista (caso real NF 127013)');
ok(/Voltaram/.test(ctx.linhaItensDevolvidos({ itens_devolvidos: [{ sku: '7150-110v', qtd: 1 }, { sku: 'KP19', qtd: 1 }], nf_itens: nf })), '  devolucao PARCIAL: o bloco continua, dizendo o que voltou');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
