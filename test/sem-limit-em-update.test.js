'use strict';
// b782 — T-02 (parte 2) achou, com o PostgREST DE VERDADE: UPDATE com `.limit()` e sem `.order()` e RECUSADO pelo
// PostgREST 12 — PGRST109 "A 'limit' was applied without an explicit 'order'" (ciente/edicao de recado e fotos da
// triagem na fabrica, defeitos-ciclo nas 3). b784: o projeto roda a 14.5, que ACEITA (medido) — em producao nao quebrava.
// A trava fica por PORTABILIDADE: todos filtram por id (unico), o `.limit(1)` nao faz nada, e uma versao/projeto que
// recuse derrubaria o ciente do recado (o estoquista travaria na triagem).
//
// O teste de comportamento cobre os caminhos que ele executa (triagem, recados); esta trava cobre a CLASSE no codigo
// todo do servidor: nenhuma chamada `.update(` / `.delete(` do supabase-js com `.limit(` na mesma instrucao.
// (Le ate o `;` que fecha a instrucao — um `;` dentro de texto so encurta a leitura: pode deixar passar, nunca acusa a
// toa. A prova de que pega e a mutacao descrita no PR.)
// Roda com: node test/sem-limit-em-update.test.js
const fs = require('fs');
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const arquivos = [];
(function andar(d) {
  for (const n of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'test', 'public', 'public-AMB'].includes(n.name)) continue;
    const p = path.join(d, n.name);
    if (n.isDirectory()) andar(p); else if (/\.js$/.test(n.name)) arquivos.push(p);
  }
})(RAIZ);
ok(arquivos.length > 30 && arquivos.some((a) => /server\.js$/.test(a)) && arquivos.some((a) => /supabase-AMB\.js$/.test(a)) && arquivos.some((a) => /defeitos-ciclo\.js$/.test(a)),
  '  varreu o codigo do servidor (' + arquivos.length + ' arquivos, inclui server.js, supabase-AMB.js e defeitos-ciclo.js)');
const achados = [];
let updates = 0;
for (const a of arquivos) {
  const s = fs.readFileSync(a, 'utf8');
  const re = /\.(update|delete)\(/g; let m;
  while ((m = re.exec(s))) {
    const fim = s.indexOf(';', m.index);
    const instr = s.slice(m.index, fim < 0 ? s.length : fim);
    if (!/\.(eq|in|match|or|filter|neq|is)\(/.test(instr)) continue;   // so as do supabase-js (com filtro)
    updates++;
    if (/\.limit\(/.test(instr)) achados.push(path.relative(RAIZ, a) + ':' + s.slice(0, m.index).split('\n').length + '  ' + instr.replace(/\s+/g, ' ').slice(0, 100));
  }
}
ok(updates >= 20, '  achou as chamadas update/delete com filtro (' + updates + ')');
ok(achados.length === 0, '⚠️ nenhum UPDATE/DELETE com .limit() — o PostgREST 12 recusa sem order (PGRST109)' + (achados.length ? ':\n     ' + achados.join('\n     ') : ''));
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
