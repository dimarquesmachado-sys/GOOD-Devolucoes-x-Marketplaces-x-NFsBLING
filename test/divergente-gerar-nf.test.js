'use strict';
// b490 — pedido do dono (02/10, card divergente da Girassol): o card de DIVERGENTE (envio errado)
// tambem gera a NF de devolucao, com o deposito ja no DEFEITOS — nos 3 paineis (multiempresa).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
function fonte(html, nome) {
  const i = html.search(new RegExp('function ' + nome + '\\s*\\(')); if (i < 0) return '';
  let j = html.indexOf('{', i), prof = 0, k = j;
  for (; k < html.length; k++) { if (html[k] === '{') prof++; else if (html[k] === '}') { prof--; if (prof === 0) break; } }
  return html.slice(i, k + 1);
}
for (const arq of ['amb-devolucoes/public-AMB/painel-AMB.html', 'amb-devolucoes/public-AMB/painel2-AMB.html', 'public/painel-devolucoes.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
  const div = fonte(html, 'itemHtmlDivergente');
  ok(/abrirModalGerarDevolucao\(/.test(div) && /Gerar NF/.test(div), '⚠️ ' + arq + ': o card DIVERGENTE tem o botao "Gerar NF"');
  ok(/fullVincular\(/.test(div) && /botaoFullEstoque\(d, true\)/.test(div), '  ' + arq + ': divergente do FULL segue o fluxo do Full (achar a NF do marketplace + estoque no DEFEITOS)');
  if (/AMB/.test(arq)) {
    ok(/'divergente'(, '\$\{serieDoRegistro\(d\)\}')?\)" title=/.test(div), '  ' + arq + ': o modal recebe "divergente" como status');
    const modal = fonte(html, 'abrirModalGerarDevolucao');
    ok(/ehProblema = \/problema\|defeito\|avariad\|quebrad\|ruim\|divergen\/i/.test(modal), '⚠️ ' + arq + ': divergente abre no DEFEITOS');
  } else {
    ok(/, 'defeito'\)" title=/.test(div), '⚠️ ' + arq + ': divergente pede DEFEITOS ao modal da GOOD (dep_sugerido "defeito")');
  }
}
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
