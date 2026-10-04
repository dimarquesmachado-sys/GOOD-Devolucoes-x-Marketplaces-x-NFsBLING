'use strict';
// b514 — "JA TRIADA" na busca por nome tambem na AMB/Girassol (porte da GOOD, b282). Servidor + tela.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const idf = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8');
ok(/supabase\.from\(tabDev\)\.select\('nf_numero, nf_serie, criado_em, funcionario, status'\)\.in\('nf_numero', nums\)/.test(idf), '⚠️ o servidor da AMB/Girassol consulta a triagem na tabela DESTA empresa (db.tabelas)');
ok(/if \(!e\) return \{ \.\.\.base, \.\.\.marcaTriada \};/.test(idf) && /\.\.\.base,\n\s+\.\.\.marcaTriada,/.test(idf), '  a marca vai nos dois caminhos (com e sem espreita)');
ok(/catch \(e\) \{ \/\* sem a marca \*\/ \}/.test(idf), '  falha na consulta = lista sem a marca (nunca trava a busca)');
const b = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'busca.js'), 'utf8');
const i = b.indexOf('function renderizarCandidatosNome('); const f = b.slice(i, b.indexOf('\nfunction ', i + 10));
ok(/const avisoTriada = jaTri/.test(f) && /\+ avisoTriada/.test(f), '⚠️ a tela mostra o aviso JA TRIADA no candidato');
ok(/escapeHtml\(String\(c\.triada_por\)\)/.test(f), '  quem triou passa pelo escape (sem HTML injetado)');
ok(/jaTriadas\.set\(chaveNF\(r\.nf_numero, r\.nf_serie\), r\)/.test(idf) && /jaTriadas\.get\(chaveNF\(c\.numero, c\.serie\)\)/.test(idf), '⚠️ a marca casa por numero+SERIE (NF de outra serie com o mesmo numero nao e "ja triada")');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
