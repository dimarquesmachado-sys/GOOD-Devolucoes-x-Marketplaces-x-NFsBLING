'use strict';
// b672 — CONTRATO DA TELA UNICA: o front compartilhado so pode chamar rota que
// exista NOS DOIS LADOS.
//
// ⚠️ O QUE ESTE TESTE PROTEGE: a tela de bipe e uma so pras 3 empresas (os JS de
// public/js sao servidos pela fabrica as instancias — JS_COMPARTILHADOS em
// app-AMB.js). Cada `/api/...` que esse front chama precisa existir na GOOD (raiz:
// server.js + libs que ela monta com `app.`) E na fabrica (instancias: app-AMB.js
// + lib-AMB + lib, montadas com `router.`). Uma rota que so um lado tem vira
// "funciona na GOOD, 404 na Girassol" — classe de regressao que o painel unico ja
// sofreu (ids fiscais, #535). Rota com `:param` casa com o prefixo que o front
// concatena.
//
// Roda com: node test/tela-unica-contrato-api.test.js

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const semComentario = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

// 1. os JS compartilhados, pela lista da propria fabrica
const appAmb = rd('amb-devolucoes/app-AMB.js');
const mLista = appAmb.match(/const JS_COMPARTILHADOS = \[([\s\S]*?)\];/);
const compartilhados = mLista ? [...mLista[1].matchAll(/'([^']+\.js)'/g)].map((m) => m[1]) : [];
ok(compartilhados.length >= 10, '⚠️ JS_COMPARTILHADOS lida do app-AMB (' + compartilhados.length + ' arquivos)');

// 2. tudo que esse front chama em /api/...
const chamadas = new Set();
for (const nome of compartilhados) {
  const abs = path.join(RAIZ, 'public', 'js', nome);
  if (!fs.existsSync(abs)) continue;
  for (const m of semComentario(fs.readFileSync(abs, 'utf8')).matchAll(/['`]\/api\/([^'`?$\s]+)/g)) {
    chamadas.add('/api/' + m[1].replace(/\/$/, ''));
  }
}
ok(chamadas.size >= 10, '  o front compartilhado chama ' + chamadas.size + ' caminhos /api');

// 3. as rotas de cada lado
function rotasDe(arquivo, objeto) {
  const out = new Set();
  const s = semComentario(rd(arquivo));
  for (const m of s.matchAll(new RegExp('\\b' + objeto + '\\.(get|post|put|delete)\\(\\s*\'([^\']+)\'', 'g'))) out.add(m[2]);
  return out;
}
const libs = fs.readdirSync(path.join(RAIZ, 'lib')).filter((f) => f.endsWith('.js')).map((f) => 'lib/' + f);
const libsAmb = fs.readdirSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB')).filter((f) => f.endsWith('.js')).map((f) => 'amb-devolucoes/lib-AMB/' + f);
const good = new Set([...rotasDe('server.js', 'app')]);
for (const l of libs) for (const r of rotasDe(l, 'app')) good.add(r);                 // libs que a GOOD monta com `app`
const fab = new Set([...rotasDe('amb-devolucoes/app-AMB.js', 'router')]);
for (const l of [...libsAmb, ...libs]) for (const r of rotasDe(l, 'router')) fab.add(r);   // pecas montadas com `router`
// b672: a fabrica monta a lib de impressao da GOOD (que registra em `app.`) no router da instancia
if (/require\('\.\.\/\.\.\/lib\/rotas-impressao'\)\(router/.test(semComentario(rd('amb-devolucoes/lib-AMB/impressao-AMB.js')))) {
  for (const r of rotasDe('lib/rotas-impressao.js', 'app')) fab.add(r);
}

function atende(conjunto, caminho) {
  for (const r of conjunto) {
    if (r === caminho) return true;
    const i = r.indexOf('/:');
    if (i > 0) { const prefixo = r.slice(0, i); if (caminho === prefixo || caminho.startsWith(prefixo + '/')) return true; }
  }
  return false;
}
const faltaGood = [...chamadas].filter((c) => !atende(good, c)).sort();
const faltaFab = [...chamadas].filter((c) => !atende(fab, c)).sort();
ok(faltaGood.length === 0, '⚠️ toda rota que o front chama existe na GOOD (raiz)' + (faltaGood.length ? ' — faltam: ' + faltaGood.join(', ') : ''));
ok(faltaFab.length === 0, '⚠️ toda rota que o front chama existe na FABRICA (instancias)' + (faltaFab.length ? ' — faltam: ' + faltaFab.join(', ') : ''));

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
