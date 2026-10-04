'use strict';
// b520 — auditoria (Codex, 04/10): a parcial da AMB/Girassol preserva a caracterizacao; a aprovacao diz o que ficou pendente.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const s = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js'), 'utf8');
const i = s.indexOf("router.post('/api/triagem/aprovar'"); const rota = s.slice(i, s.indexOf('\n  });\n', i));
ok(/\[DEVOLUCAO PARCIAL por \$\{req\.usuario\}\] Recebido: \$\{d\.produto_qtd\} de \$\{d\.produto_qtd_original \|\| '\?'\} unidades\./.test(rota), '⚠️ a parcial grava o MESMO texto da GOOD (o painel reconhece o selo, as fotos e a trava por ele)');
ok(/if \(ehParcial && fotosParcial\.length < 6\)/.test(rota), '  parcial exige 6 fotos (paridade)');
ok(/observacao_parcial/.test(rota), '  a observacao da parcial vai junto');
const c = s.slice(s.indexOf('async function completarRegistro('), s.indexOf('async function completarRegistro(') + 2200);
ok(/else pendentes\.push\(k\);/.test(c) && /catch \(e\) \{ pendentes\.push\(k\); \}/.test(c) && /aviso: avisoPendentes\(pendentes\)/.test(c), '⚠️ a aprovacao diz exatamente o que NAO gravou (fotos, itens...)');
const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'triagem.js'), 'utf8');
ok((t.match(/if \(d && d\.ok && d\.aviso\) toast\(/g) || []).length === 2, '⚠️ a tela mostra a pendencia nos dois caminhos de aprovar');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
