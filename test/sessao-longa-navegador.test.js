'use strict';
// b771 — V-08 (auditoria do Codex, 15/11), a parte "sessao longa": a tela de triagem fica aberta o turno inteiro
// no celular do galpao — dezenas de pacotes, cada um com busca, modal, fotos. O que importa nao e um ciclo, e se
// CADA ciclo deixa rastro: nos do DOM que nao saem, listeners que se acumulam, blobs vivos, heap que so sobe.
// Aqui o Chromium de verdade roda a tela servida pelo server.js (PostgREST falso atras), nas 3 empresas:
//   aquecimento de 8 ciclos → medida → mais 40 ciclos → medida. Um ciclo = buscar um codigo novo, abrir o modal de
//   problema, abrir e fechar a camera com 1 foto (upload concluido), fechar o modal, trocar de pacote.
// Criterio (medido pelo CDP Performance.getMetrics + contagem propria de listeners/timers):
//   - nos do DOM e listeners: crescimento por ciclo ~0 (tolerancia pequena, nao proporcional ao numero de ciclos);
//   - timers (setInterval) vivos: nao crescem com os ciclos;
//   - blobs de preview: zero vivos no fim;
//   - heap: depois de 40 ciclos nao passa de 1,5x o aquecido (com GC forcado antes de medir).
// Precisa do Chromium do Playwright (igual ao test/navegador-real.test.js). Roda com: node test/sessao-longa-navegador.test.js
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('FALHA Playwright nao instalado: ' + e.message); process.exit(1); }

const EMPRESAS = [{ nome: 'GOOD', rota: '' }, { nome: 'AMB', rota: '/amb', prefixo: 'AMB_' }, { nome: 'Girassol', rota: '/girassol', prefixo: 'GIRASSOL_' }];
const AQUECER = 8, CICLOS = 40;

const payload = (codigo) => ({
  ok: true, encontrado: true, codigo,
  order: { id: codigo, date_created: '2026-11-10T10:00:00Z', buyer: { nickname: 'CLIENTE' + codigo }, payments: [{ transaction_amount: 10 }],
    order_items: [{ item: { id: 'MLB' + codigo, title: 'Produto ' + codigo, seller_sku: 'SKU-' + codigo }, quantity: 1, unit_price: 10 }] },
  shipment: { id: 'SHIP' + codigo, shipping_items: [{ id: 'MLB' + codigo, description: 'Produto ' + codigo, quantity: 1 }] },
  nf: { numero: '1' + codigo.replace(/\D/g, ''), itens: [{ titulo: 'Produto ' + codigo, sku: 'SKU-' + codigo, ean: '-', quantidade: 1 }] },
  claim: null, avisos: [], tentativas: [],
});

(async () => {
  const env = {
    USERS: 'esto:s1:Esto,dono:s2:Dono', ADMIN_USER: 'dono', GOOD_USERS: 'esto:s1:Esto,dono:s2:Dono', GOOD_ADMIN_USER: 'dono',
    SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789', ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!',
  };
  for (const e of EMPRESAS.slice(1)) { env[e.prefixo + 'USERS'] = 'esto:s1,dono:s2'; env[e.prefixo + 'ADMIN_USER'] = 'dono'; env[e.prefixo + 'SESSION_SECRET'] = 'segredo-da-' + e.nome.toLowerCase() + '-so-pra-teste-0123456789'; }
  const s = await subir({ env, tetoMs: 45000 });
  let navegador = null;
  try {
    ok(s.subiu, '⚠️ o server.js subiu' + (!s.subiu ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
    if (!s.subiu) throw new Error('nao subiu');
    navegador = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--js-flags=--expose-gc'] });
    for (const e of EMPRESAS) {
      console.log('\n── ' + e.nome);
      const ctx = await navegador.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, permissions: ['camera'] });
      const page = await ctx.newPage();
      const errosJs = []; page.on('pageerror', (err) => errosJs.push(String(err && err.message || err)));
      // instrumentacao ANTES da pagina: listeners, timers e blobs contados de verdade
      await page.addInitScript(() => {
        window.__m = { listeners: 0, intervalos: new Set(), blobsVivos: new Set() };
        const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
        EventTarget.prototype.addEventListener = function (t, f, o) { window.__m.listeners++; return add.call(this, t, f, o); };
        EventTarget.prototype.removeEventListener = function (t, f, o) { window.__m.listeners--; return rem.call(this, t, f, o); };
        const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
        window.setInterval = (...a) => { const id = si(...a); window.__m.intervalos.add(id); return id; };
        window.clearInterval = (id) => { window.__m.intervalos.delete(id); return ci(id); };
        const c = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (o) => { const u = c(o); window.__m.blobsVivos.add(u); return u; };
        URL.revokeObjectURL = (u) => { window.__m.blobsVivos.delete(u); return r(u); };
      });
      await page.route('**/api/devolucao/identificar/**', async (route) => {
        const codigo = decodeURIComponent(new URL(route.request().url()).pathname.split('/api/devolucao/identificar/')[1] || '');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(codigo)) });
      });
      await page.route('**/api/triagem/upload-foto', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'https://x/f.jpg' }) }));
      const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
      const medir = async () => {
        await page.evaluate(() => { if (window.gc) window.gc(); });
        await page.waitForTimeout(200);
        const m = (await cdp.send('Performance.getMetrics')).metrics.reduce((o, x) => (o[x.name] = x.value, o), {});
        const p = await page.evaluate(() => ({ listeners: window.__m.listeners, intervalos: window.__m.intervalos.size, blobs: window.__m.blobsVivos.size, resultadoFilhos: document.getElementById('resultado').querySelectorAll('*').length }));
        return { nos: m.Nodes, jsListeners: m.JSEventListeners, heapMB: Math.round(m.JSHeapUsedSize / 1048576 * 10) / 10, ...p };
      };
      const ciclo = async (n) => {
        const codigo = 'PKT' + n;
        await page.fill('#codigo', codigo); await page.press('#codigo', 'Enter');
        await page.waitForFunction((c) => new RegExp('Produto ' + c).test(document.getElementById('resultado').textContent), codigo, { timeout: 8000 });
        await page.evaluate(() => { abrirModalProblema(); return abrirCamera(); });
        await page.waitForFunction(() => { const v = document.getElementById('cameraVideo'); return v && v.videoWidth >= 100; }, null, { timeout: 8000 });
        await page.evaluate(() => capturarFoto());
        await page.waitForFunction(() => Array.from(document.querySelectorAll('#cameraMiniaturas img, .mini img, #fotosPreview img')).length >= 0, null, { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(150);
        await page.evaluate(() => { try { fecharCamera(true); } catch (e) { fecharCamera(); } fecharModal('modalProblema'); });
        await page.waitForTimeout(50);
      };
      await page.goto('http://127.0.0.1:' + s.porta + e.rota + '/', { waitUntil: 'load' });
      await page.fill('#loginUser', 'esto'); await page.fill('#loginPass', 's1');
      await Promise.all([page.waitForResponse((r) => /\/api\/auth\/login/.test(r.url())), page.click('#btnLogin')]);
      for (let i = 0; i < AQUECER; i++) await ciclo(i);
      const a = await medir();
      for (let i = AQUECER; i < AQUECER + CICLOS; i++) await ciclo(i);
      const b = await medir();
      const porCiclo = (k) => (b[k] - a[k]) / CICLOS;
      console.log('  aquecido: ' + JSON.stringify(a) + '\n  +' + CICLOS + ' ciclos: ' + JSON.stringify(b));
      ok(porCiclo('nos') <= 2, '⚠️ nos do DOM nao crescem com os ciclos (' + porCiclo('nos').toFixed(2) + ' no(s)/ciclo)');
      ok(porCiclo('jsListeners') <= 1 && porCiclo('listeners') <= 1, '⚠️ listeners nao se acumulam (' + porCiclo('jsListeners').toFixed(2) + ' CDP, ' + porCiclo('listeners').toFixed(2) + ' contados por ciclo)');
      ok(b.intervalos <= a.intervalos, '⚠️ timers (setInterval) vivos nao crescem (' + a.intervalos + ' → ' + b.intervalos + ')');
      ok(b.blobs === 0, '⚠️ zero blobs de preview vivos no fim (' + b.blobs + ')');
      ok(b.heapMB <= Math.max(a.heapMB * 1.5, a.heapMB + 8), '⚠️ heap depois de ' + CICLOS + ' ciclos nao passa de 1,5x o aquecido (' + a.heapMB + ' → ' + b.heapMB + ' MB)');
      ok(errosJs.length === 0, '  sem erro de JS na pagina' + (errosJs.length ? ': ' + errosJs.slice(0, 3).join(' | ') : ''));
      await ctx.close();
    }
  } catch (err) {
    falhas++; console.log('FALHA ' + (err && err.stack || err));
  } finally {
    if (navegador) await navegador.close().catch(() => {});
    await s.matar();
  }
  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})();
