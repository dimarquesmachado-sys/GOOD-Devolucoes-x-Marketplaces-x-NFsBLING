'use strict';
// b752 — T-04 (auditoria do Codex, 15/11): NAVEGADOR REAL (Playwright/Chromium) NA TELA DO ESTOQUISTA DAS 3 EMPRESAS.
//
// Sobe o server.js de verdade (test/_boot-real.js) e abre a tela no Chromium headless. As rotas de DADOS do bipe sao
// interceptadas no navegador (page.route) com respostas controladas e atrasos — o que esta em prova e o FRONT que o
// servidor serve de verdade (HTML + js que a pagina referencia), nao o marketplace. Em cada empresa:
//   - login pela tela (form real) entra e mostra o app;
//   - P2-01 (busca em ordem): bipa A (resposta lenta) e logo B (rapida): a tela fica com B; quando A chega NAO
//     sobrescreve, o loading some e o botao volta;
//   - P1-07 (fotos por pacote): abre a camera (dispositivo falso do Chromium), tira uma foto cujo upload demora, troca de
//     pacote (abre o fluxo de problema do proximo, que zera a lista) — quando o upload responde, a lista corrente segue
//     VAZIA (a foto nao contamina o proximo);
//   - P1-01 (dados hostis): titulo/erro com <img onerror> vindos da API nao executam script na tela.
// Precisa do Chromium do Playwright: `npx playwright install chromium` uma vez. Sem ele, o teste FALHA dizendo isso.
// Roda com: node test/navegador-real.test.js
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.log('FALHA Playwright nao instalado (npm ci instala a lib; depois `npx playwright install chromium`): ' + e.message);
  process.exit(1);
}

const EMPRESAS = [
  { nome: 'GOOD', rota: '', prefixo: '' },
  { nome: 'AMB', rota: '/amb', prefixo: 'AMB_' },
  { nome: 'Girassol', rota: '/girassol', prefixo: 'GIRASSOL_' },
];
// forma que a tela le (renderizar): order.order_items (ML) + nf.itens (Bling) + shipment; o titulo da NF e o que aparece
const payload = (codigo, titulo) => ({
  ok: true, encontrado: true, codigo,
  order: { id: codigo, date_created: '2026-11-10T10:00:00Z', buyer: { nickname: 'CLIENTE' + codigo }, payments: [{ transaction_amount: 10 }],
    order_items: [{ item: { id: 'MLB' + codigo, title: titulo, seller_sku: 'SKU-' + codigo }, quantity: 1, unit_price: 10 }] },
  shipment: { id: 'SHIP' + codigo, shipping_items: [{ id: 'MLB' + codigo, description: titulo, quantity: 1 }] },
  nf: { numero: '1' + codigo.charCodeAt(0), itens: [{ titulo, sku: 'SKU-' + codigo, ean: '-', quantidade: 1 }] },
  claim: null, avisos: [], tentativas: [],
});

(async () => {
  const env = {
    USERS: 'esto:s1:Esto,dono:s2:Dono', ADMIN_USER: 'dono', GOOD_USERS: 'esto:s1:Esto,dono:s2:Dono', GOOD_ADMIN_USER: 'dono',
    SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789', ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!',
  };
  for (const e of EMPRESAS.slice(1)) {
    env[e.prefixo + 'USERS'] = 'esto:s1,dono:s2'; env[e.prefixo + 'ADMIN_USER'] = 'dono';
    env[e.prefixo + 'SESSION_SECRET'] = 'segredo-da-' + e.nome.toLowerCase() + '-so-pra-teste-0123456789';
  }
  const s = await subir({ env, tetoMs: 45000 });
  let navegador = null;
  try {
    ok(s.subiu && !s.morreuCedo, '⚠️ o server.js subiu com as 3 empresas' + (!s.subiu ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
    if (!s.subiu) throw new Error('o servidor nao subiu');
    navegador = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    for (const e of EMPRESAS) {
      console.log('\n── ' + e.nome + ' (' + (e.rota || '/') + ')');
      const ctx = await navegador.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, permissions: ['camera'] });
      const page = await ctx.newPage();
      const errosJs = []; let dialogo = null;
      page.on('pageerror', (err) => errosJs.push(String(err && err.message || err)));
      page.on('dialog', async (d) => { dialogo = d.message(); await d.dismiss(); });
      const base = 'http://127.0.0.1:' + s.porta + e.rota;

      // ── rotas de dados controladas ──
      const atrasos = { A: 1200, B: 0, HOSTIL: 0 };
      await page.route('**/api/devolucao/identificar/**', async (route) => {
        const url = new URL(route.request().url());
        const codigo = decodeURIComponent(url.pathname.split('/api/devolucao/identificar/')[1] || '');
        await new Promise((r) => setTimeout(r, atrasos[codigo] || 0));
        const titulo = codigo === 'HOSTIL' ? 'Luminaria <img src=x onerror="window.__xss=1"> "x"' : 'Produto ' + codigo;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(codigo, titulo)) });
      });
      let liberarUpload = null; const uploads = [];
      await page.route('**/api/triagem/upload-foto', async (route) => {
        uploads.push(1);
        await new Promise((r) => { liberarUpload = r; });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'https://x/foto-que-chegou-tarde.jpg' }) });
      });

      // ── login pela tela ──
      await page.goto(base + '/', { waitUntil: 'load' });
      await page.fill('#loginUser', 'esto'); await page.fill('#loginPass', 's1');
      await Promise.all([page.waitForResponse((r) => /\/api\/auth\/login/.test(r.url())), page.click('#btnLogin')]);
      await page.waitForFunction(() => !document.getElementById('loginScreen') || getComputedStyle(document.getElementById('loginScreen')).display === 'none' || !document.getElementById('loginScreen').classList.contains('show') && document.getElementById('loginScreen').offsetParent === null, null, { timeout: 8000 }).catch(() => {});
      const logado = await page.evaluate(() => { const l = document.getElementById('loginScreen'); return !l || l.offsetParent === null; });
      ok(logado, '  login pela tela: a tela de login sumiu');

      // ── P2-01: A lenta, B rapida ──
      // o bipe e Enter no campo (app.js) — o campo NAO e desabilitado enquanto a busca anterior corre, e e assim que
      // o estoquista bipa o pacote seguinte antes de a resposta do anterior chegar (o botao, sim, fica desabilitado)
      await page.fill('#codigo', 'A'); await page.press('#codigo', 'Enter');
      await page.waitForTimeout(150);
      const emVoo = await page.evaluate(() => document.getElementById('btnBuscar').disabled && document.getElementById('loading').classList.contains('show'));
      ok(emVoo, '  A esta em voo (loading, botao desabilitado) quando B e bipado');
      await page.fill('#codigo', 'B'); await page.press('#codigo', 'Enter');
      await page.waitForFunction(() => /Produto B/.test(document.getElementById('resultado').textContent), null, { timeout: 8000 });
      const antesDeA = await page.evaluate(() => ({ r: document.getElementById('resultado').textContent, loading: document.getElementById('loading').classList.contains('show'), btn: document.getElementById('btnBuscar').disabled }));
      ok(/Produto B/.test(antesDeA.r) && !antesDeA.loading && !antesDeA.btn, '⚠️ P2-01: B (rapida) renderizou, loading sumiu, botao liberado');
      await page.waitForTimeout(1500);   // A chega agora
      const depoisDeA = await page.evaluate(() => ({ r: document.getElementById('resultado').textContent, loading: document.getElementById('loading').classList.contains('show'), btn: document.getElementById('btnBuscar').disabled }));
      ok(/Produto B/.test(depoisDeA.r) && !/Produto A/.test(depoisDeA.r), '⚠️ P2-01: A (lenta) chegou depois e NAO sobrescreveu B');
      ok(!depoisDeA.loading && !depoisDeA.btn, '  o loading e o botao continuam liberados');

      // ── P1-01: dado hostil nao executa ──
      await page.fill('#codigo', 'HOSTIL'); await page.press('#codigo', 'Enter');
      await page.waitForFunction(() => /Luminaria/.test(document.getElementById('resultado').textContent), null, { timeout: 8000 });
      await page.waitForTimeout(300);
      const xss = await page.evaluate(() => window.__xss === 1);
      ok(!xss && !dialogo, '⚠️ P1-01: titulo com <img onerror> vindo da API NAO executou script (xss=' + xss + ', dialogo=' + dialogo + ')');

      // ── P1-07: foto de um fluxo nao entra no proximo ──
      const abriu = await page.evaluate(async () => { try { await abrirCamera(); return true; } catch (err) { return String(err); } });
      ok(abriu === true, '  camera (dispositivo falso) abriu: ' + abriu);
      await page.waitForFunction(() => { const v = document.getElementById('cameraVideo'); return v && v.videoWidth >= 100; }, null, { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => capturarFoto());
      const t0 = Date.now(); while (!uploads.length && Date.now() - t0 < 8000) await page.waitForTimeout(50);
      ok(uploads.length === 1, '  a foto foi capturada e o upload comecou (pendente)');
      const pendentes = await page.evaluate(() => (window.fotosUploadadas || []).length);
      ok(pendentes === 1, '  a lista corrente tem 1 foto pendente');
      // troca de pacote como na operacao: fecha a camera e abre o fluxo de problema do PROXIMO pacote (que zera a lista)
      await page.evaluate(() => { fecharCamera(true); abrirModalProblema(); });
      const vaziaAntes = await page.evaluate(() => (window.fotosUploadadas || []).length);
      ok(vaziaAntes === 0, '  abriu o fluxo do proximo pacote: lista corrente vazia');
      if (liberarUpload) liberarUpload();            // o upload do fluxo ANTIGO responde agora
      await page.waitForTimeout(400);
      const depois = await page.evaluate(() => JSON.stringify(window.fotosUploadadas || []));
      ok(depois === '[]', '⚠️ P1-07: a resposta tardia do upload NAO entrou na lista do fluxo novo (' + depois + ')');

      ok(errosJs.length === 0, '  nenhum erro de JS na pagina' + (errosJs.length ? ' — ' + errosJs.slice(0, 3).join(' | ') : ''));
      await ctx.close();
    }
  } finally {
    if (navegador) await navegador.close();
    s.matar();
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
