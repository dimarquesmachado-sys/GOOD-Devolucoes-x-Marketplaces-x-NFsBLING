'use strict';
// b548 — dono, 05/10 (Girassol, NF 127261): em problemas/divergentes os itens da NF so abriam clicando, e a linha
// do card dizia "CABOLATERAL · 3 un" numa NF de 3 produtos diferentes. Roda as funcoes de producao.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const h = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
function fonte(nome) { const i = h.search(new RegExp('function ' + nome + '\\s*\\(')); let j = h.indexOf('{', i), p = 0, k = j; for (; k < h.length; k++) { if (h[k] === '{') p++; else if (h[k] === '}') { p--; if (p === 0) break; } } return h.slice(i, k + 1); }
const ctx = { escapeHtml: (x) => String(x), moeda: (v) => 'R$ ' + v }; vm.createContext(ctx);
vm.runInContext(fonte('textoVariosProdutos') + '\n' + fonte('linhaProduto'), ctx);
const nf127261 = { produto_sku: 'CABOLATERAL', produto_qtd: 3, produto_valor_unit: 16.58, nf_itens: [{ sku: 'CABOLATERAL', quantidade: 1 }, { sku: '7150-220v', quantidade: 1 }, { sku: 'KP4', quantidade: 1 }] };
ok(/KIT<\/strong> · 3 produtos na NF/.test(ctx.linhaProduto(nf127261)) && !/3 un/.test(ctx.linhaProduto(nf127261)), '⚠️ NF com 3 produtos: a linha diz "3 produtos diferentes" (nao "CABOLATERAL · 3 un")');
ok(/CABOLATERAL.*3 un/.test(ctx.linhaProduto({ produto_sku: 'CABOLATERAL', produto_qtd: 3, produto_valor_unit: 16.58, nf_itens: [{ sku: 'CABOLATERAL', quantidade: 3 }] })), '  NF de um produto so: linha de sempre (SKU · qtd · valor)');
for (const f of ['itemHtmlProblema', 'itemHtmlDivergente', 'itemHtmlAprovado']) {
  const c = fonte(f);
  ok(/\$\{renderItensCard\(d\)\}/.test(c) && !/onclick="return verItensNF/.test(c), '⚠️ ' + f + ': itens da NF ja ABERTOS (sem clicar)');
  ok(/<span class="linha-produto">\$\{linhaProduto\(d\)\}<\/span>/.test(c), '  ' + f + ': linha do produto pela regra nova');
}
ok(/if \(linha && nDist > 1\) linha\.innerHTML = textoVariosProdutos\(nDist\);/.test(h), '  lista que chega depois corrige a linha do card');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
