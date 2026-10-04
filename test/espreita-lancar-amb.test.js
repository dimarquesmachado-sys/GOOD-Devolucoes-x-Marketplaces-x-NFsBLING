'use strict';
// b507 — auditoria multiempresa: "mandar da espreita para Aprovadas" na AMB/Girassol (antes so a GOOD).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const app = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
const i = app.indexOf("router.post('/api/admin/espreita/lancar-nf', admin,");
const rota = app.slice(i, app.indexOf('\n});\n', i) + 4);
ok(i > 0 && i > app.indexOf('const ajudantes = criarAdminHelpers('), '⚠️ a rota existe na AMB/Girassol (admin), depois dos ajudantes');
ok(/db\.jaTriado\(\{ orderId: oid \}\)/.test(rota) && /jaExistiam\.push/.test(rota), '  nao duplica pedido que ja tem triagem');
ok(/if \(!ja \|\| ja\.ok === false\)/.test(rota), '  banco fora do ar = falha avisada (nao grava em duplicidade)');
ok(/ml\.chamarML\('\/orders\/' \+ oid\)/.test(rota) && /invoice_data\?siteId=MLB/.test(rota), '  le a venda e a NF no ML DESTA empresa');
ok(/db\.registrarTriagem\(\{/.test(rota) && /status: 'aprovado'/.test(rota), '⚠️ grava na tabela DESTA empresa como aprovada aguardando NF');
for (const f of ['painel-AMB.html', 'painel2-AMB.html']) {
  const h = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', f), 'utf8');
  ok(!/ESTA FUNCAO NAO EXISTE NA AMB/.test(h) && !/ainda n.o existe na AMBTotal/.test(h), '⚠️ ' + f + ': o aviso "nao existe na AMB" saiu — o botao funciona');
  ok(/\(window\.APP_BASE \|\| ''\) \+ '\/api\/admin\/espreita\/lancar-nf'/.test(h), '  ' + f + ': chama a rota da propria empresa');
}
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
