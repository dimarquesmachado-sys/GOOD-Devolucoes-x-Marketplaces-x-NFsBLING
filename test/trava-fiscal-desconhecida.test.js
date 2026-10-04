'use strict';
// b524 — auditoria (Codex, b520): parcial conhecida SEM as listas nao libera o emitir direto (3 telas);
// o aviso de pendencia nao e trocado pelo sucesso.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
function fonte(html, nome) { const i = html.search(new RegExp('function ' + nome + '\\s*\\(')); let j = html.indexOf('{', i), prof = 0, k = j; for (; k < html.length; k++) { if (html[k] === '{') prof++; else if (html[k] === '}') { prof--; if (prof === 0) break; } } return html.slice(i, k + 1); }
for (const arq of ['amb-devolucoes/public-AMB/painel-AMB.html', 'public/painel-devolucoes.html']) {
  const ctx = {}; vm.createContext(ctx); vm.runInContext(fonte(fs.readFileSync(path.join(__dirname, '..', arq), 'utf8'), 'faltasDevolucaoParcial'), ctx);
  const parcialSemLista = ctx.faltasDevolucaoParcial({ problema_descricao: '[DEVOLUCAO PARCIAL por Ygor] Recebido: 1 de 3 unidades.', nf_itens: null, itens_devolvidos: null });
  ok(parcialSemLista.length === 1 && /voltou 1 de 3/.test(parcialSemLista[0].sku), '⚠️ ' + arq + ': parcial SEM as listas trava o emitir direto (' + (parcialSemLista[0] && parcialSemLista[0].sku) + ')');
  ok(ctx.faltasDevolucaoParcial({ produto_qtd: 1, produto_qtd_original: 3 }).length === 1, '  ' + arq + ': quantidade menor que a original tambem trava');
  ok(ctx.faltasDevolucaoParcial({ problema_descricao: 'Aprovado por Ygor' }).length === 0, '  ' + arq + ': devolucao normal sem listas segue liberada (como antes)');
}
const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'triagem.js'), 'utf8');
ok(/if \(!d\.aviso\) toast\('Aprovacao registrada!', 'ok'\);/.test(t), '⚠️ com pendencia, o sucesso NAO troca o aviso (caminho normal)');
ok(/nem tudo gravou/.test(t), '⚠️ a tela da parcial nao diz "fotos salvas" quando nem tudo gravou');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
