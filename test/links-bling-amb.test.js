'use strict';
// b506 — auditoria multiempresa: o botao "buscar NF no Bling" da AMB/Girassol chamava a rota da GOOD.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const app = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
const i = app.indexOf("router.get('/api/nf/buscar-links-bling/:orderId', auth.requerLogin,");
const rota = app.slice(i, app.indexOf('\n});\n', i) + 4);
ok(i > 0, '⚠️ a AMB/Girassol tem a rota buscar-links-bling (antes so a GOOD tinha)');
ok(i > app.indexOf('const ajudantes = criarAdminHelpers('), '  registrada depois dos ajudantes (sem TDZ)');
ok(/ajudantes\.buscarNFnoBlingPorNumero\(numeroNF/.test(rota) && /bling\.buscarNFePorId\(/.test(rota), '  usa o Bling DESTA empresa (ajudante + cliente do modulo)');
ok(/if \(!numeroNF\) \{\n\s+return res\.json\(\{ ok: false/.test(rota), '  sem numero da NF: resposta clara, sem chutar');
ok(/catch \(e\) \{/.test(rota), '  erro do Bling nao derruba (responde ok:false)');
const front = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'js-AMB', 'busca.js'), 'utf8');
ok(/`\$\{window\.APP_BASE \|\| ''\}\/api\/nf\/buscar-links-bling\//.test(front), '⚠️ a tela chama com o prefixo da empresa (sem ele caia na GOOD)');
ok(!/const url = `\/api\/nf\/buscar-links-bling\//.test(front), '  nao sobrou chamada sem prefixo');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
