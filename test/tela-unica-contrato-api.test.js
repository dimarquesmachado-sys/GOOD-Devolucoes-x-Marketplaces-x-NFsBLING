'use strict';
// b672/r4 — CONTRATO DA TELA UNICA: o front compartilhado so pode chamar rota que
// exista NOS DOIS LADOS, com a MESMA FORMA de caminho.
//
// ⚠️ O QUE ESTE TESTE PROTEGE: a tela de bipe (public/js, servida pela fabrica as
// instancias — JS_COMPARTILHADOS) e o painel admin (painel-AMB.html, que a GOOD serve
// adaptado) sao UM so pras 3 empresas. Cada chamada `/api/...` deles precisa existir na
// GOOD (raiz: server.js + libs que ela monta direto) E na fabrica (instancias: app-AMB.js
// + o que ela monta). Rota que so um lado tem vira "funciona na GOOD, 404 na Girassol"
// (ids fiscais #535; fila de impressao #542).
//
// Como le o front: cada chamada vira uma FORMA — literal completo ('/api/defeitos/por-sku'),
// prefixo + id ('/api/produto/imagem/' + x -> '/api/produto/imagem/:p') e id com sufixo
// ('/api/admin/recado/' + id + '/remover' -> '/api/admin/recado/:p/remover'; template
// `.../${id}/remover` idem). A forma casa a rota registrada com os :params na mesma posicao;
// literal completo so casa rota exata (senao '/api/defeitos/:id' mascararia o por-sku sumido).
//
// Como le o servidor: rota registrada numa lib pertence ao lado que a MONTA (require
// transitivo). A GOOD e mapeada SEM descer em app-AMB.js (a fabrica e montada sob prefixo;
// suas rotas nao sao da raiz).
//
// Roda com: node test/tela-unica-contrato-api.test.js

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const semComentario = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
const FABRICA = 'amb-devolucoes/app-AMB.js';

// ── formas das chamadas do front ────────────────────────────────────
function formasDoTexto(texto) {
  const formas = new Set();
  const add = (f) => { f = f.split('?')[0].replace(/\/+$/, ''); if (f.startsWith('/api/')) formas.add(f); };
  // template literal que COMECA no /api (depois de, no maximo, uma interpolacao de base):
  // `${window.APP_BASE || ''}/api/x/${id}/remover` ou `/api/x/${id}`
  for (const m of texto.matchAll(/`(?:\$\{[^}]*\})?(\/api\/[^`\n]*)`/g)) {
    add(m[1].replace(/\$\{[^}]*\}/g, ':p').replace(/\/:p[^/]*/g, '/:p'));
  }
  // concatenacao: '/api/x/' + id + '/remover' ...
  for (const m of texto.matchAll(/'(\/api\/[^']*)'((?:\s*\+\s*(?:'[^']*'|[^'+;,)\n]+))*)/g)) {
    let forma = m[1].split('?')[0];
    for (const t of (m[2] || '').matchAll(/\s*\+\s*(?:'([^']*)'|([^'+;,)\n]+))/g)) {
      if (t[1] !== undefined) forma += t[1].split('?')[0];
      else if (forma.endsWith('/')) forma += ':p';   // expressao logo apos '/': e um id
      // expressao colada no fim de um segmento (query, sufixo de string): nao muda a forma
    }
    add(forma);
  }
  return formas;
}

// ── rotas de cada lado ──────────────────────────────────────────────
function requiresDe(arquivo) {
  const out = new Set();
  for (const m of semComentario(rd(arquivo)).matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
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
// forma normalizada da rota: /:qualquer -> /:p ; /* -> /:p
const formaDaRota = (r) => r.split('?')[0].replace(/\/:[^/]+/g, '/:p').replace(/\/\*$/, '/:p').replace(/\/+$/, '');
function atende(rotas, forma) {
  for (const r of rotas) {
    const fr = formaDaRota(r);
    if (fr === forma) return true;
    if (r.endsWith('/*') && forma.startsWith(fr.replace(/\/:p$/, '') + '/')) return true;   // curinga engole o resto
  }
  return false;
}

// ── 1. bipe ─────────────────────────────────────────────────────────
const appAmb = rd(FABRICA);
const mLista = appAmb.match(/const JS_COMPARTILHADOS = \[([\s\S]*?)\];/);
const compartilhados = mLista ? [...mLista[1].matchAll(/'([^']+\.js)'/g)].map((m) => m[1]) : [];
ok(compartilhados.length >= 10, '⚠️ JS_COMPARTILHADOS lida do app-AMB (' + compartilhados.length + ' arquivos)');
const formasBipe = new Set();
for (const nome of compartilhados) {
  const abs = path.join(RAIZ, 'public', 'js', nome);
  if (fs.existsSync(abs)) for (const f of formasDoTexto(semComentario(fs.readFileSync(abs, 'utf8')))) formasBipe.add(f);
}
ok(formasBipe.size >= 10, '  o bipe chama ' + formasBipe.size + ' formas de /api');

const good = rotasDoLado('server.js', [FABRICA]);
const fab = rotasDoLado(FABRICA);
ok(good.size > 100 && fab.size > 100, `  rotas mapeadas: GOOD (raiz, sem a fabrica) ${good.size}, fabrica ${fab.size}`);
ok(!good.has('/api/triagem/registrar') && fab.has('/api/triagem/registrar'), '  a rota so da fabrica NAO conta como rota da raiz');

const faltaGood = [...formasBipe].filter((f) => !atende(good, f)).sort();
const faltaFab = [...formasBipe].filter((f) => !atende(fab, f)).sort();
ok(faltaGood.length === 0, '⚠️ BIPE: toda forma que o front chama existe na GOOD (raiz)' + (faltaGood.length ? ' — faltam: ' + faltaGood.join(', ') : ''));
ok(faltaFab.length === 0, '⚠️ BIPE: toda forma que o front chama existe na FABRICA (instancias)' + (faltaFab.length ? ' — faltam: ' + faltaFab.join(', ') : ''));

// ── 2. painel unico ─────────────────────────────────────────────────
const formasPainel = formasDoTexto(semComentario(rd('amb-devolucoes/public-AMB/painel-AMB.html')));
ok(formasPainel.size >= 25, '  o painel unico chama ' + formasPainel.size + ' formas de /api');
ok(formasPainel.has('/api/admin/recado/:p/remover'), '  a forma com sufixo depois do id e capturada (recado/:p/remover)');
const faltaGoodP = [...formasPainel].filter((f) => !atende(good, f)).sort();
const faltaFabP = [...formasPainel].filter((f) => !atende(fab, f)).sort();
ok(faltaGoodP.length === 0, '⚠️ PAINEL: toda forma que ele chama existe na GOOD' + (faltaGoodP.length ? ' — faltam: ' + faltaGoodP.join(', ') : ''));
ok(faltaFabP.length === 0, '⚠️ PAINEL: toda forma que ele chama existe na FABRICA' + (faltaFabP.length ? ' — faltam: ' + faltaFabP.join(', ') : ''));

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
