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

// 3. as rotas de cada lado — REGRA: rota registrada numa lib pertence ao lado que a
//    MONTA (require transitivo a partir de server.js = GOOD; de app-AMB.js = fabrica),
//    seja o objeto `app`, `router` ou `r`. Casa `/:param` e `/*` com o prefixo.
function requiresDe(arquivo) {
  const out = new Set();
  const s = semComentario(rd(arquivo));
  for (const m of s.matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
    let alvo = path.normalize(path.join(path.dirname(arquivo), m[1]));
    if (!alvo.endsWith('.js')) alvo += '.js';
    if (fs.existsSync(path.join(RAIZ, alvo))) out.add(alvo);
  }
  return out;
}
function rotasDe(arquivo) {
  const out = new Set();
  for (const m of semComentario(rd(arquivo)).matchAll(/\b(?:app|router|r)\.(get|post|put|delete)\(\s*'([^']+)'/g)) out.add(m[2]);
  return out;
}
// r2 (Codex #543): o server.js requer app-AMB.js pra MONTAR as instancias sob prefixo
// (/amb, /girassol) — as rotas da fabrica NAO sao rotas da raiz. Ao mapear a GOOD, a
// fabrica fica de fora (senao uma rota da raiz que sumisse seria mascarada pela
// equivalente da fabrica); as libs que o server.js monta direto continuam contando.
const FABRICA = 'amb-devolucoes/app-AMB.js';
function rotasDoLado(raiz, excluir) {
  const vistos = new Set(excluir || []); const fila = [raiz]; const rotas = new Set();
  while (fila.length) {
    const p = fila.pop();
    if (vistos.has(p)) continue;
    vistos.add(p);
    for (const r of rotasDe(p)) rotas.add(r);
    for (const q of requiresDe(p)) if (q.startsWith('lib/') || q.startsWith('amb-devolucoes/')) fila.push(q);
  }
  return rotas;
}
const good = rotasDoLado('server.js', [FABRICA]);
const fab = rotasDoLado(FABRICA);
ok(good.size > 100 && fab.size > 100, `  rotas mapeadas: GOOD (raiz, sem a fabrica) ${good.size}, fabrica ${fab.size}`);
ok(!good.has('/api/triagem/registrar') && fab.has('/api/triagem/registrar'), '  a rota so da fabrica NAO conta como rota da raiz (r2)');

function atende(conjunto, caminho) {
  for (const r of conjunto) {
    if (r === caminho) return true;
    const i = Math.min(...[r.indexOf('/:'), r.indexOf('/*')].filter((x) => x > 0));
    if (Number.isFinite(i)) { const prefixo = r.slice(0, i); if (caminho === prefixo || caminho.startsWith(prefixo + '/')) return true; }
  }
  return false;
}
const faltaGood = [...chamadas].filter((c) => !atende(good, c)).sort();
const faltaFab = [...chamadas].filter((c) => !atende(fab, c)).sort();
ok(faltaGood.length === 0, '⚠️ BIPE: toda rota que o front chama existe na GOOD (raiz)' + (faltaGood.length ? ' — faltam: ' + faltaGood.join(', ') : ''));
ok(faltaFab.length === 0, '⚠️ BIPE: toda rota que o front chama existe na FABRICA (instancias)' + (faltaFab.length ? ' — faltam: ' + faltaFab.join(', ') : ''));

// 4. o PAINEL UNICO (admin) tambem e um so pras 3 (painel-AMB.html; a GOOD serve o mesmo
//    HTML adaptado no boot). Mesma regra: tudo que ele chama existe nos 2 lados.
const painel = semComentario(rd('amb-devolucoes/public-AMB/painel-AMB.html'));
const chamadasPainel = new Set();
for (const m of painel.matchAll(/['`]\/api\/([^'`?$\s]+)/g)) chamadasPainel.add('/api/' + m[1].replace(/\/$/, ''));
for (const m of painel.matchAll(/\}\/api\/([^'`?$\s]+)/g)) chamadasPainel.add('/api/' + m[1].replace(/\/$/, ''));
ok(chamadasPainel.size >= 20, '  o painel unico chama ' + chamadasPainel.size + ' caminhos /api');
const faltaGoodP = [...chamadasPainel].filter((c) => !atende(good, c)).sort();
const faltaFabP = [...chamadasPainel].filter((c) => !atende(fab, c)).sort();
ok(faltaGoodP.length === 0, '⚠️ PAINEL: toda rota que ele chama existe na GOOD' + (faltaGoodP.length ? ' — faltam: ' + faltaGoodP.join(', ') : ''));
ok(faltaFabP.length === 0, '⚠️ PAINEL: toda rota que ele chama existe na FABRICA' + (faltaFabP.length ? ' — faltam: ' + faltaFabP.join(', ') : ''));

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
