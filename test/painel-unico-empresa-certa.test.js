'use strict';
// b540 — revisao do painel unico: nada da AMB escrito a mao onde a empresa decide o resultado.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const h = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
const semComentario = h.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
ok(!/empresa:\s*'ambtotal'\s*,/.test(semComentario), '⚠️ a emissao EM LOTE nao manda mais empresa "ambtotal" fixa (na GOOD/Girassol pedia os dados fiscais da AMB)');
ok(/empresa: window\.APP_EMPRESA \|\| 'ambtotal',\n\s+devolucaoId: String\(devolucaoId\),/.test(h), '  ... manda a empresa DESTA tela, igual ao botao de um card');
ok(!/login de novo na AMBTotal/.test(h), '  o aviso de sessao usa o nome da empresa da tela');
const i = h.indexOf('function nomeDaEmpresaTela()'); const j = h.indexOf('\n', i);
const ctx = { document: { title: 'GOOD Import (GIMPO) - Painel de Devoluções' } }; vm.createContext(ctx); vm.runInContext(h.slice(i, j), ctx);
ok(ctx.nomeDaEmpresaTela() === 'GOOD Import (GIMPO)', '  nome da empresa tirado do titulo que o servidor preenche (' + ctx.nomeDaEmpresaTela() + ')');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
