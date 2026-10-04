'use strict';
// b500 — devolucao PARCIAL: a NF do Bling copia a NF original inteira; se voltou menos, so o rascunho.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
function fonte(html, nome) { const i = html.search(new RegExp('function ' + nome + '\\s*\\(')); if (i < 0) return ''; let j = html.indexOf('{', i), prof = 0, k = j; for (; k < html.length; k++) { if (html[k] === '{') prof++; else if (html[k] === '}') { prof--; if (prof === 0) break; } } return html.slice(i, k + 1); }
const nf = [{ sku: 'CABOLATERAL', quantidade: 1 }, { sku: '7150-220v', quantidade: 1 }, { sku: 'KP4', quantidade: 1 }];
for (const arq of ['amb-devolucoes/public-AMB/painel-AMB.html', 'public/painel-devolucoes.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(fonte(html, 'faltasDevolucaoParcial'), ctx);
  const total = ctx.faltasDevolucaoParcial({ nf_itens: nf, itens_devolvidos: [{ sku: 'CABOLATERAL', qtd: 1 }, { sku: '7150-220v', qtd: 1 }, { sku: 'KP4', qtd: 1 }] });
  ok(total.length === 0, '⚠️ ' + arq + ': voltou TUDO (o caso Cabo Lateral) = sem trava, emite normal');
  const parcial = ctx.faltasDevolucaoParcial({ nf_itens: nf, itens_devolvidos: [{ sku: 'CABOLATERAL', qtd: 1 }] });
  ok(parcial.length === 2 && parcial.map((f) => f.sku).join() === '7150-220v,KP4', '⚠️ ' + arq + ': voltou 1 de 3 = trava e diz o que tirar (7150-220v, KP4)');
  ok(ctx.faltasDevolucaoParcial({ nf_itens: [{ sku: 'A', quantidade: 3 }], itens_devolvidos: [{ sku: 'A', qtd: 1 }] }).length === 1, '  ' + arq + ': mesma peca, quantidade menor tambem e parcial');
  ok(ctx.faltasDevolucaoParcial({ nf_itens: nf }).length === 0, '  ' + arq + ': sem a lista do que voltou nao afirma nada (sem trava)');
  ok(/var _idParcial = arguments\[0\];/.test(fonte(html, 'abrirModalGerarDevolucao')), '  ' + arq + ': o modal aplica a trava ao abrir');
  // b501 (Codex #412) - linha da NF que nao da pra conferir (sem SKU/qtd) nao pode ser ignorada
  ok(ctx.faltasDevolucaoParcial({ nf_itens: [{ sku: 'A', quantidade: 1 }, { sku: null, quantidade: 1 }], itens_devolvidos: [{ sku: 'A', qtd: 1 }] }).length === 1, '⚠️ ' + arq + ': linha da NF sem SKU = indeterminada, so rascunho');
  // b501 - o lote (esteira) tambem respeita a trava
  const esteira = fonte(html, 'rodarEsteira');
  ok(/faltasDoCard\(c\.dataset\.id\)\.length === 0/.test(esteira), '⚠️ ' + arq + ': o lote "Emitir selecionadas" exclui devolucao parcial');
  // b501 - deposito que carrega depois nao reabre o emitir
  ok(/window\._devParcial = faltasDoCard\(_idParcial\)/.test(fonte(html, 'abrirModalGerarDevolucao')), '  ' + arq + ': a flag de parcial nasce sincrona na abertura');
  if (!arq.endsWith('painel-devolucoes.html')) ok(/_devParcial\)\) b\.disabled = false/.test(html), '⚠️ ' + arq + ': liberar botoes preserva a trava do emitir');
}
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
