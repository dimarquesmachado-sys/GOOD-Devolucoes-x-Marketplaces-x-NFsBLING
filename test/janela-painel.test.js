'use strict';
// b492 — pedido do dono (02/10): os avisos do painel eram confirm()/toast (janela pequena, com cara de
// erro e sem copiar). A esteira e o "Achar devolucao" usam a janela do painel, copiavel — nas 3 telas.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
function fonte(html, nome) {
  const i = html.search(new RegExp('(async\\s+)?function ' + nome + '\\s*\\(')); if (i < 0) return '';
  let j = html.indexOf('{', i), prof = 0, k = j;
  for (; k < html.length; k++) { if (html[k] === '{') prof++; else if (html[k] === '}') { prof--; if (prof === 0) break; } }
  return html.slice(i, k + 1);
}
for (const arq of ['amb-devolucoes/public-AMB/painel-AMB.html', 'amb-devolucoes/public-AMB/painel2-AMB.html', 'public/painel-devolucoes.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
  const jan = fonte(html, 'janelaPainel');
  ok(/Copiar texto/.test(jan) && /navigator\.clipboard/.test(jan) && /max-height:86vh/.test(jan), '⚠️ ' + arq + ': janela do painel com "Copiar texto" e espaco pro texto inteiro');
  const est = fonte(html, 'rodarEsteira');
  ok(/await confirmarPainel\(/.test(est) && !/if \(!confirm\(\n\s*`🏭 ESTEIRA/.test(est), '⚠️ ' + arq + ': a esteira confirma na janela do painel (nao mais no confirm() do navegador)');
  const ach = fonte(html, 'fullVincular');
  ok(/avisoPainel\('🔗 Achar devolução no Bling'/.test(ach), '  ' + arq + ': o erro do "Achar" abre na janela copiavel');
  const mk = fonte(html, 'nomeMarketplaceFull');
  ok(/\^20\\d\{14\}\$/.test(mk), '  ' + arq + ': o card do ML sem o campo marketplace e reconhecido pelo id do pedido');
}
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
