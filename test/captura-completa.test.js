'use strict';
// b521 — auditoria (Codex, 04/10): a captura recebe TODAS as devolucoes Shopee; Magalu com falha nao vira "sem devolucoes".
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
const rd = (a) => fs.readFileSync(path.join(R, a), 'utf8');
ok(/em_transito_todas: emTransito,/.test(rd('lib/shopee-proxy.js')) && /em_transito_todas: emTransito,/.test(rd('amb-devolucoes/lib-AMB/shopee-AMB.js')), '⚠️ as duas libs da Shopee entregam a lista COMPLETA (o corte fica so na tela)');
const g = rd('server.js');
ok(/ESP_SHOPEE_EXTRAS = Array\.isArray\(shopeeR\.em_transito_todas\)/.test(g) && /\.concat\(ESP_SHOPEE_EXTRAS \|\| \[\]\)/.test(g), '⚠️ GOOD: a captura recebe as que passaram do corte de 40');
const a = rd('amb-devolucoes/app-AMB.js');
ok(/capturarDevolucoesEmpresa\(emTransito\.concat\(extrasShopee\)\)/.test(a), '⚠️ AMB/Girassol: a captura recebe as que passaram do corte de 60');
const m = rd('amb-devolucoes/lib-AMB/magalu-AMB.js');
ok(/if \(!tudo\.length && IDX\.erro\) \{/.test(m), '⚠️ Magalu: falha em todas as categorias MANTEM a ultima lista valida (nao vira vazia)');
ok(/entregues_indice: entregues, erro: IDX\.erro \|\| null \}/.test(m) && /erro: erroMagalu \|\| null, idade_min/.test(a), '  e o erro + a idade aparecem no resumo da espreita');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
