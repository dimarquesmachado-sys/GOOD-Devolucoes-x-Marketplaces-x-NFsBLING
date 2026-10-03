'use strict';
// b494 — caso real (02/10, Girassol, "Cabo Lateral", NF 127261): o estoquista escreveu o problema e o
// card veio SEM a mensagem. A tela manda `descricao`; o registrarTriagem da AMB/Girassol so grava
// `problema_descricao`. As rotas de problema e divergente da AMB/Girassol agora fazem a troca.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const src = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js'), 'utf8');
const m = /const comDescricao = \(d\) => \{[\s\S]*?\n  \};/.exec(src);
ok(!!m, '  a funcao comDescricao existe');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(m[0].replace('const comDescricao', 'this.comDescricao') , ctx);
const r1 = ctx.comDescricao({ descricao: '  cabo quebrado na rosca  ', produto_sku: 'X' });
ok(r1.problema_descricao === 'cabo quebrado na rosca' && r1.produto_sku === 'X', '⚠️ o texto da tela (descricao) vira problema_descricao — o que o banco grava e o card/e-mail mostram');
const r2 = ctx.comDescricao({ problema_descricao: 'ja veio certo', descricao: 'outro' });
ok(r2.problema_descricao === 'ja veio certo', '  quem ja manda problema_descricao nao e sobrescrito');
const r3 = ctx.comDescricao({ produto_sku: 'Y' });
ok(!('problema_descricao' in r3), '  sem texto nenhum: nao inventa campo');
const rotaProb = src.slice(src.indexOf("router.post('/api/triagem/problema'"), src.indexOf("router.post('/api/triagem/divergente'"));
const rotaDiv = src.slice(src.indexOf("router.post('/api/triagem/divergente'"), src.indexOf("router.post('/api/triagem/divergente'") + 400);
ok(/const d = comDescricao\(corpo\(req\)\);/.test(rotaProb) && /emailAMB\.avisarProblema\(\{ \.\.\.d/.test(rotaProb), '⚠️ rota de PROBLEMA grava a descricao e o e-mail sai com ela');
ok(/const d = comDescricao\(corpo\(req\)\);/.test(rotaDiv), '  rota de DIVERGENTE tambem');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
