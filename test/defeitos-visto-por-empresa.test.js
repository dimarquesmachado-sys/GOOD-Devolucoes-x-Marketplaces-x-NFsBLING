'use strict';
// b718 — P2-10 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): A MARCA "JA VI OS DEFEITOS" E POR EMPRESA.
//
// index-AMB.html (tela da fabrica, AMB e Girassol na MESMA origem) guardava a marca em `amb_defeitos_visto_em`, fixa:
// abrir os defeitos da AMB apagava o aviso da Girassol e vice-versa. Aqui o bloco REAL do HTML roda num window
// simulado, uma vez como Girassol e uma como AMB, no mesmo localStorage.
// Roda com: node test/defeitos-visto-por-empresa.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'index-AMB.html'), 'utf8');

// o <script> que tem a marca
const blocos = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const bloco = blocos.find((b) => /defeitos_visto_em/.test(b));
ok(!!bloco && !/'amb_defeitos_visto_em';\s*$/m.test(bloco.split('\n').find((l) => /var CHAVE =/.test(l)) || ''), 'index-AMB.html: a CHAVE nao e mais a fixa da AMB');

const storage = new Map();   // o MESMO localStorage pras duas empresas (mesma origem)
function rodar(empresa, pedidos, eu) {
  const timers = [];
  const el = { avisoDefeitos: { textContent: 'x', style: {} }, linkDefeitos: { style: {} }, userNome: { textContent: eu || '-' }, avisoPainel: { textContent: '', style: {}, title: '' }, btnPainelAdmin: { style: {} } };
  const ctx = {
    window: { APP_EMPRESA: empresa, APP_BASE: '/' + empresa },
    document: { getElementById: (id) => el[id] || null },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, v) },
    fetch: async () => ({ json: async () => ({ ok: true, pedidos }) }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return 1; },
    Date, String, Array, Promise, console,
  };
  vm.createContext(ctx);
  vm.runInContext(bloco, ctx);
  const conferir = timers.find((t) => t.ms === 1500).fn;
  return { ctx, el, conferir: async () => { await conferir(); await new Promise((r) => setTimeout(r, 5)); } };
}
const ONTEM = new Date(Date.now() - 86400000).toISOString();
const PEDIDOS = [{ id: 1, status: 'autorizado', decidido_em: ONTEM, quem_decidiu: 'Diego' }];

(async () => {
  // Girassol marca "ja vi"; a AMB NAO pode herdar essa marca
  const g = rodar('girassol', PEDIDOS, 'Ygor');
  await g.conferir();
  ok(g.el.avisoDefeitos.textContent === ' 1', 'Girassol: 1 peca decidida e nova → aviso 1');
  g.ctx.window.marcarDefeitosVistos();
  ok(storage.has('defeitos_visto_em:girassol') && !storage.has('defeitos_visto_em:ambtotal'), '⚠️ a marca da Girassol fica em defeitos_visto_em:girassol (e so nela)');
  await g.conferir();
  ok(g.el.avisoDefeitos.textContent === '', '  Girassol: depois de "ja vi", aviso apaga');
  const a = rodar('ambtotal', PEDIDOS, 'Ygor');
  await a.conferir();
  ok(a.el.avisoDefeitos.textContent === ' 1', '⚠️ AMB no MESMO navegador: o aviso dela continua 1 (antes: a marca da outra empresa apagava)');

  // a marca ANTIGA da AMB vale como reserva so pra AMB
  storage.clear(); storage.set('amb_defeitos_visto_em', new Date().toISOString());
  const a2 = rodar('ambtotal', PEDIDOS, 'Ygor'); await a2.conferir();
  ok(a2.el.avisoDefeitos.textContent === '', 'AMB le a marca antiga (amb_defeitos_visto_em) como reserva: sem enxurrada de "novos" no 1o acesso');
  const g2 = rodar('girassol', PEDIDOS, 'Ygor'); await g2.conferir();
  ok(g2.el.avisoDefeitos.textContent === ' 1', '  Girassol NAO le a marca antiga da AMB');

  // quem decidiu nao e avisado do que ele mesmo decidiu (regra do b165 preservada)
  storage.clear();
  const d = rodar('girassol', PEDIDOS, 'Diego'); await d.conferir();
  ok(d.el.avisoDefeitos.textContent === '', '  b165 preservado: o proprio decisor nao ve aviso');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
