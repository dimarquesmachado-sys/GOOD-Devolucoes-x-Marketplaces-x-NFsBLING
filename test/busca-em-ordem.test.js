'use strict';
// b717 — P2-01 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): SO A BUSCA MAIS RECENTE PINTA A TELA.
//
// public/js/busca.js (tela de bipe unica das 3): o scanner/Enter dispara A e depois B; se B responde antes e A chega
// depois, A pintava por cima — campo com B, resultado de A, e o payload que a triagem grava (`_ultimaRespostaBipe`) de A.
// Aqui a funcao `buscar()` de producao roda com DOM e fetch simulados, e as respostas chegam na ordem errada.
// Roda com: node test/busca-em-ordem.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'busca.js'), 'utf8');

function fonte(nome) {
  const i = SRC.search(new RegExp('(?:async )?function ' + nome + '\\s*\\('));
  if (i < 0) return '';
  let j = SRC.indexOf('{', i), p = 0, k = j;
  for (; k < SRC.length; k++) { if (SRC[k] === '{') p++; else if (SRC[k] === '}') { p--; if (p === 0) break; } }
  return SRC.slice(i, k + 1);
}

function montar() {
  const pendentes = {};   // codigo -> resolve
  const log = { render: [], erro: [], toast: [] };
  const classes = () => { const s = new Set(); return { add: (c) => s.add(c), remove: (c) => s.delete(c), has: (c) => s.has(c) }; };
  const ctx = {
    window: { APP_BASE: '/girassol' },
    Date, String, Number, Set, Promise, encodeURIComponent, RegExp, Array, Object,
    inputCodigo: { value: '', select() {} },
    divResultado: { classList: classes(), innerHTML: '' },
    divLoading: { classList: classes() },
    btnBuscar: { disabled: false },
    toast: (m) => log.toast.push(m),
    renderizar: (d, okHttp) => log.render.push({ d, okHttp }),
    renderizarErro: (m) => log.erro.push(m),
    fetch: (url) => new Promise((resolve) => {
      const cod = decodeURIComponent(url.match(/identificar\/([^?]+)/)[1]);
      pendentes[cod] = (corpo, status = 200, tipo = 'application/json') => resolve({
        ok: status < 400, status, headers: { get: () => tipo },
        json: async () => corpo,
      });
    }),
  };
  vm.createContext(ctx);
  vm.runInContext('let ultimaBusca = null;\nlet _buscaSeq = 0;\n' + fonte('buscar') + '\nglobalThis.__ultima = () => ultimaBusca;', ctx);
  return { ctx, pendentes, log, responder: (cod, corpo, status, tipo) => pendentes[cod](corpo, status, tipo) };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  // ── a cena da auditoria: A, depois B; B responde primeiro; A chega por ultimo ──
  {
    const t = montar();
    t.ctx.inputCodigo.value = 'A'; const pa = t.ctx.buscar();
    await tick();
    t.ctx.inputCodigo.value = 'B'; const pb = t.ctx.buscar();
    await tick();
    t.responder('B', { codigo: 'B', achou: true }); await pb; await tick();
    ok(t.log.render.length === 1 && t.log.render[0].d.codigo === 'B', 'B respondeu: tela pintada com B');
    ok(t.ctx.divLoading.classList.has('show') === false && t.ctx.btnBuscar.disabled === false, '  loading fechou e botao liberou (B e a corrente)');
    t.responder('A', { codigo: 'A', achou: true }); await pa; await tick();
    ok(t.log.render.length === 1 && t.log.render[0].d.codigo === 'B', '⚠️ A chegou depois: NAO pintou por cima (so 1 render, de B)');
    ok(t.ctx.__ultima().codigo === 'B' && t.ctx.window._ultimaRespostaBipe.codigo === 'B', '⚠️ o payload que a triagem grava e o de B (antes virava o de A)');
    ok(t.ctx.window._ultimoCodigoBusca === 'B', '  o codigo corrente e B');
  }

  // ── erro atrasado da busca antiga nao apaga o resultado novo ──
  {
    const t = montar();
    t.ctx.inputCodigo.value = 'A'; const pa = t.ctx.buscar(); await tick();
    t.ctx.inputCodigo.value = 'B'; const pb = t.ctx.buscar(); await tick();
    t.responder('B', { codigo: 'B' }); await pb; await tick();
    t.responder('A', '<html>', 503, 'text/html'); await pa; await tick();
    ok(t.log.erro.length === 0 && t.log.render.length === 1, '⚠️ 503/HTML atrasado da busca A nao vira erro na tela de B');
  }

  // ── e a antiga NAO libera o loading da nova enquanto a nova espera ──
  {
    const t = montar();
    t.ctx.inputCodigo.value = 'A'; const pa = t.ctx.buscar(); await tick();
    t.ctx.inputCodigo.value = 'B'; const pb = t.ctx.buscar(); await tick();
    t.responder('A', { codigo: 'A' }); await pa; await tick();
    ok(t.ctx.divLoading.classList.has('show') === true && t.ctx.btnBuscar.disabled === true, '⚠️ A terminou antes de B: o loading de B continua e o botao segue travado');
    ok(t.log.render.length === 0, '  e nada foi pintado com A');
    t.responder('B', { codigo: 'B' }); await pb; await tick();
    ok(t.log.render.length === 1 && t.log.render[0].d.codigo === 'B' && t.ctx.divLoading.classList.has('show') === false, '  B chega: pinta B e libera');
  }

  // ── fluxo normal, uma busca de cada vez, continua igual ──
  {
    const t = montar();
    t.ctx.inputCodigo.value = 'X'; const px = t.ctx.buscar(); await tick();
    t.responder('X', { codigo: 'X' }, 404); await px;
    ok(t.log.render.length === 1 && t.log.render[0].okHttp === false && t.ctx.__ultima().codigo === 'X', 'busca unica: renderiza (inclusive 404 com JSON) como antes');
    t.ctx.inputCodigo.value = ''; await t.ctx.buscar();
    ok(t.log.toast.length === 1 && /Digite ou bipe/.test(t.log.toast[0]), '  codigo vazio: toast, sem busca');
  }

  // os dois HTML pedem o busca.js novo — a GOOD numera o ?v= do busca.js sem o "b" (convencao antiga dela, 4790+)
  const mG = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8').match(/js\/busca\.js\?v=(\d+)/);
  ok(mG && Number(mG[1]) >= 4790, `  public/index.html: js/busca.js?v=${mG ? mG[1] : '?'} (>= 4790)`);
  const mA = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'index-AMB.html'), 'utf8').match(/busca\.js\?v=b(\d+)/);
  ok(mA && Number(mA[1]) >= 717, `  index-AMB.html: js-AMB/busca.js?v=b${mA ? mA[1] : '?'} (>= b717)`);

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
