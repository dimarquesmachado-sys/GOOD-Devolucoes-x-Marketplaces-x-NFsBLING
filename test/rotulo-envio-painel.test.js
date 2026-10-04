'use strict';
// b533 — unificacao do painel: o rotulo do envio (porte da GOOD) no painel da AMB/Girassol. Roda a funcao de producao.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
function fonte(html, nome) { const i = html.search(new RegExp('function ' + nome + '\\s*\\(')); let j = html.indexOf('{', i), prof = 0, k = j; for (; k < html.length; k++) { if (html[k] === '{') prof++; else if (html[k] === '}') { prof--; if (prof === 0) break; } } return html.slice(i, k + 1); }
for (const arq of ['amb-devolucoes/public-AMB/painel-AMB.html', 'public/painel-devolucoes.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
  const ctx = { escapeHtml: (s) => String(s).replace(/</g, '&lt;') }; vm.createContext(ctx);
  vm.runInContext(fonte(html, 'rotuloShipment'), ctx);
  ok(/Chave NF-e/.test(ctx.rotuloShipment('35260712345678000199550010000012341000012345')), '⚠️ ' + arq + ': chave de NF no campo de envio aparece como "Chave NF-e"');
  ok(/Shipment/.test(ctx.rotuloShipment('47847935268')), '  ' + arq + ': envio de verdade continua "Shipment"');
  ok(ctx.rotuloShipment('') === '', '  ' + arq + ': sem envio, nada');
  ok(!/\$\{d\.shipment_id \? ` · <strong>Shipment:/.test(html), '  ' + arq + ': nenhum card com o rotulo antigo, sem escape');
}
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
