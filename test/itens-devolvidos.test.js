'use strict';
// b497 — devolucao com varios produtos na mesma NF (caso Cabo Lateral, 02/10): a AMB/Girassol grava a lista
// do que voltou e os 3 paineis mostram item por item.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const compat = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js'), 'utf8');
ok(/const EXTRAS = \[[^\]]*'itens_devolvidos'/.test(compat), '⚠️ AMB/Girassol grava itens_devolvidos (campo a campo, no completarRegistro)');
// Codex #411 (P1): consertado passa por completarRegistro; divergente nao grava a lista dos itens ESPERADOS
const { entreMarcadores } = require('./_recorte');
const rotaCons = entreMarcadores(compat, "router.post('/api/triagem/consertado'", "router.get('/api/defeitos/por-sku'");
ok(/completarRegistro\(r, d\)/.test(rotaCons), '⚠️ AMB/Girassol: /consertado grava itens_devolvidos (passa por completarRegistro)');
const rotaDiv = entreMarcadores(compat, "router.post('/api/triagem/divergente'", "router.post('/api/triagem/consertado'");
ok(/delete d\.itens_devolvidos/.test(rotaDiv), '⚠️ AMB/Girassol: /divergente NAO grava a lista dos itens esperados');
function fonte(html, nome) { const i = html.search(new RegExp('function ' + nome + '\\s*\\(')); if (i < 0) return ''; let j = html.indexOf('{', i), prof = 0, k = j; for (; k < html.length; k++) { if (html[k] === '{') prof++; else if (html[k] === '}') { prof--; if (prof === 0) break; } } return html.slice(i, k + 1); }
for (const arq of ['amb-devolucoes/public-AMB/painel-AMB.html', 'amb-devolucoes/public-AMB/painel2-AMB.html', 'public/painel-devolucoes.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fonte(html, 'escapeHtml') + '\n' + fonte(html, 'linhaItensDevolvidos'), ctx);
  const h = ctx.linhaItensDevolvidos({ itens_devolvidos: [{ sku: 'CABOLATERAL', qtd: 1 }, { sku: '7150-220v', qtd: 1 }, { sku: 'KP4', qtd: 1 }] });
  ok(/Voltaram 3 produtos diferentes/.test(h) && /CABOLATERAL/.test(h) && /7150-220v/.test(h) && /KP4/.test(h), '⚠️ ' + arq + ': o card mostra os 3 produtos que voltaram');
  ok(ctx.linhaItensDevolvidos({ itens_devolvidos: [{ sku: 'X', qtd: 3 }] }) === '', '  ' + arq + ': um produto so: sem linha extra');
  for (const f of ['itemHtmlAprovado', 'itemHtmlProblema', 'itemHtmlDivergente']) ok(/linhaItensDevolvidos\(d\)/.test(fonte(html, f)), '  ' + arq + ': ' + f + ' usa a lista');
  // Codex #411 (P2): a lista aparece tambem nos concluidos; a busca acha SKU de item secundario
  for (const f of ['itemHtmlAprovado', 'itemHtmlProblema', 'itemHtmlDivergente']) {
    const fn = fonte(html, f);
    const pos = fn.indexOf('linhaItensDevolvidos(d)');
    ok(pos >= 0 && pos < fn.indexOf("concluido ? '' : `"), '⚠️ ' + arq + ': ' + f + ' mostra a lista tambem em card concluido');
  }
  ok(/d\.itens_devolvidos\.flatMap\(i => \[i && i\.sku/.test(entreMarcadores(html, 'function passa(d)', 'const aprovadas')), '⚠️ ' + arq + ': a busca acha SKU de item secundario');
}
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
