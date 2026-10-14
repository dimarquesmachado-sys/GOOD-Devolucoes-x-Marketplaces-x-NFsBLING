'use strict';
// 14/10 — FICHA DE DEFEITOS UNICA na Girassol/AMB (e nas proximas empresas): a juncao das duas copias tem o que cada uma
// tinha a mais. Nivelar por cima — nenhuma loja perde nada.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
const unica = fs.readFileSync(path.join(R, 'amb-devolucoes', 'public-AMB', 'js-AMB', 'defeitos-ficha.js'), 'utf8');
const good = fs.readFileSync(path.join(R, 'public', 'js', 'defeitos-ficha.js'), 'utf8');
// o que a GOOD tinha a mais
for (const n of ['expandirFichaNoCard', 'fecharFichaInline', 'marcarCardAberto', 'abrirModalDefeito', '/api/produtos/buscar']) {
  ok(unica.includes(n), '⚠️ da GOOD: ' + n);
}
// o que a AMB tinha a mais
for (const n of ['abrirZoomProduto', 'verFotoDefeito', 'srcFoto', 'ultimoTermoBusca', 'naRaizBusca', 'APP_BASE', 'var(--marca)']) {
  ok(unica.includes(n), '⚠️ da AMB: ' + n);
}
ok(!/#561A9E/.test(unica), '  sem a cor fixa da GOOD (as cores vem da empresa)');
// nenhuma funcao que existia em uma das duas sumiu
const fns = (s) => new Set([...s.matchAll(/\n\s*(?:async\s+)?function\s+([a-zA-Z_]\w*)\s*\(/g)].map((m) => m[1]));
const fu = fns(unica);
const faltam = [...fns(good)].filter((n) => !fu.has(n));
ok(faltam.length === 0, '⚠️ nenhuma funcao da ficha da GOOD ficou de fora (' + (faltam.join(', ') || 'ok') + ')');
// o painel da Girassol/AMB carrega a ficha unica + o Lancar defeito (com o prefixo da empresa); a GOOD troca o bloco
const painel = fs.readFileSync(path.join(R, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
ok(/<!-- ficha-defeitos:inicio[\s\S]*js-AMB\/defeitos-ficha\.js\?v=b619[\s\S]*js-AMB\/lancar-defeito\.js[\s\S]*LancarDefeito\.instalar\(\{ prefixo: window\.APP_BASE \|\| '' \}\)[\s\S]*<!-- ficha-defeitos:fim -->/.test(painel), '⚠️ painel da Girassol/AMB: ficha unica + Lancar defeito com o prefixo da empresa');
const app = fs.readFileSync(path.join(R, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
ok(/router\.get\('\/js-AMB\/lancar-defeito\.js'/.test(app) && /'public', 'js', 'lancar-defeito\.js'/.test(app), '  o modulo do Lancar defeito e servido da peca da GOOD (sem copia)');
const g = require(path.join(R, 'lib', 'painel-unico.js')).montarPainelUnicoGood(painel);
ok(/\/js\/defeitos-ficha\.js/.test(g) && (g.match(/lancar-defeito\.js/g) || []).length === 1 && !/js-AMB\/defeitos-ficha|js-AMB\/lancar-defeito/.test(g), '⚠️ painel da GOOD: continua com a ficha dela e UM Lancar defeito (nao instala duas vezes)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
