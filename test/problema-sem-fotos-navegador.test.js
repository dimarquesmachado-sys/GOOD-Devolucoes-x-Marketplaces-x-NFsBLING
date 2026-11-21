'use strict';
// b778 — o "Sem fotos" do reportar problema, na TELA, com o Chromium de verdade e o server.js (PostgREST falso atras),
// nas 3 empresas (a tela de triagem e o mesmo public/js/triagem.js; o auth.js da fabrica e outro arquivo):
//   - estoquista: a caixa "Sem fotos" NAO aparece; o botao segue "Abrir camera";
//   - admin: a caixa aparece desmarcada; marcando, o botao vira "Enviar sem fotos" e o clique manda o problema
//     direto (sem camera), com sem_fotos:true e 0 fotos → o servidor aceita, o defeito e gravado na tabela da empresa,
//     o modal fecha; desmarcando volta "Abrir camera";
//   - reabrir o modal desmarca a caixa (nao fica "Sem fotos" grudado de um pacote pro outro).
// Precisa do Chromium do Playwright. Roda com: node test/problema-sem-fotos-navegador.test.js
const path = require('path');
const { subir } = require('./_boot-real');
const { subirPostgrest } = require('./_postgrest-falso');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('FALHA Playwright nao instalado: ' + e.message); process.exit(1); }

const EMPRESAS = [
  { nome: 'GOOD', rota: '', sufixo: '' },
  { nome: 'AMB', rota: '/amb', sufixo: '_amb', prefixo: 'AMB_' },
  { nome: 'Girassol', rota: '/girassol', sufixo: '_girassol', prefixo: 'GIRASSOL_' },
];
const payload = (codigo) => ({
  ok: true, encontrado: true, codigo,
  order: { id: codigo, date_created: '2026-11-10T10:00:00Z', buyer: { nickname: 'CLIENTE' + codigo }, payments: [{ transaction_amount: 10 }],
    order_items: [{ item: { id: 'MLB' + codigo, title: 'Produto ' + codigo, seller_sku: 'SKU-' + codigo }, quantity: 1, unit_price: 10 }] },
  shipment: { id: 'SHIP' + codigo, shipping_items: [{ id: 'MLB' + codigo, description: 'Produto ' + codigo, quantity: 1 }] },
  nf: { numero: '1' + codigo.replace(/\D/g, ''), itens: [{ titulo: 'Produto ' + codigo, sku: 'SKU-' + codigo, ean: '-', quantidade: 1 }] },
  claim: null, avisos: [], tentativas: [],
});
const CAPTURA = process.env.CAPTURA_SEM_FOTOS || '';   // pasta pra salvar a captura (opcional, so pra conferencia visual)

(async () => {
  const pg = await subirPostgrest({ tabelas: {} });
  for (const e of EMPRESAS) for (const t of ['devolucoes', 'recados', 'sku_depara', 'defeito_pedidos', 'pecas_retiradas']) pg.tabela(t + e.sufixo);
  const env = {
    SUPABASE_URL: pg.url, SUPABASE_KEY: 'k-good', GOOD_SUPABASE_URL: pg.url, GOOD_SUPABASE_KEY: 'k-good',
    USERS: 'esto:s1:Esto,dono:s2:Dono', ADMIN_USER: 'dono', GOOD_USERS: 'esto:s1:Esto,dono:s2:Dono', GOOD_ADMIN_USER: 'dono',
    SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789', ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!',
  };
  for (const e of EMPRESAS.slice(1)) {
    env[e.prefixo + 'SUPABASE_URL'] = pg.url; env[e.prefixo + 'SUPABASE_KEY'] = 'k-' + e.nome.toLowerCase();
    env[e.prefixo + 'USERS'] = 'esto:s1,dono:s2'; env[e.prefixo + 'ADMIN_USER'] = 'dono';
    env[e.prefixo + 'SESSION_SECRET'] = 'segredo-da-' + e.nome.toLowerCase() + '-so-pra-teste-0123456789';
  }
  const s = await subir({ env, tetoMs: 45000 });
  let navegador = null;
  try {
    ok(s.subiu, '⚠️ o server.js subiu' + (!s.subiu ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
    if (!s.subiu) throw new Error('nao subiu');
    navegador = await chromium.launch();
    for (const e of EMPRESAS) {
      console.log('\n── ' + e.nome);
      const abrir = async (usuario, senha) => {
        const ctx = await navegador.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: CAPTURA ? 2 : 1 });
        const page = await ctx.newPage();
        const errosJs = []; page.on('pageerror', (err) => errosJs.push(String(err && err.message || err)));
        page.on('dialog', (d) => d.dismiss().catch(() => {}));
        await page.route('**/api/devolucao/identificar/**', async (route) => {
          const codigo = decodeURIComponent(new URL(route.request().url()).pathname.split('/api/devolucao/identificar/')[1] || '');
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(codigo)) });
        });
        await page.goto('http://127.0.0.1:' + s.porta + e.rota + '/', { waitUntil: 'load' });
        await page.fill('#loginUser', usuario); await page.fill('#loginPass', senha);
        await Promise.all([page.waitForResponse((r) => /\/api\/auth\/me/.test(r.url())), page.click('#btnLogin')]);
        await page.waitForFunction(() => typeof window.__ehAdmin === 'boolean', null, { timeout: 8000 });
        const bipar = async (codigo) => {
          await page.fill('#codigo', codigo); await page.press('#codigo', 'Enter');
          await page.waitForFunction((c) => new RegExp('Produto ' + c).test(document.getElementById('resultado').textContent), codigo, { timeout: 8000 });
          await page.evaluate(() => abrirModalProblema());
        };
        return { ctx, page, errosJs, bipar };
      };
      const visivel = (page) => page.evaluate(() => { const b = document.getElementById('boxSemFotos'); return !!b && getComputedStyle(b).display !== 'none' && b.offsetHeight > 0; });
      const rotulo = (page) => page.evaluate(() => document.getElementById('btnProblemaAcao').textContent.trim());

      // ── estoquista ──
      const E = await abrir('esto', 's1');
      await E.bipar('EST' + e.nome.length);
      ok(!(await visivel(E.page)), '⚠️ estoquista: a caixa "Sem fotos" NAO aparece');
      ok(/Abrir c[aâ]mera/.test(await rotulo(E.page)), '  estoquista: o botao segue "Abrir camera" (' + await rotulo(E.page) + ')');
      ok(E.errosJs.length === 0, '  sem erro de JS' + (E.errosJs.length ? ': ' + E.errosJs.slice(0, 3).join(' | ') : ''));
      await E.ctx.close();

      // ── admin ──
      const A = await abrir('dono', 's2');
      await A.bipar('ADM' + e.nome.length);
      ok(await visivel(A.page), '⚠️ admin: a caixa "Sem fotos" aparece');
      ok(!(await A.page.isChecked('#chkSemFotos')), '  e vem desmarcada');
      await A.page.fill('#problemaDescricao', 'tampa amassada');
      await A.page.fill('#problemaLocal', 'DEF-A3');
      await A.page.check('#chkSemFotos');
      ok(/Enviar sem fotos/.test(await rotulo(A.page)), '⚠️ marcando, o botao vira "Enviar sem fotos" (' + await rotulo(A.page) + ')');
      if (CAPTURA) {
        await A.page.evaluate(() => document.getElementById('btnProblemaAcao').scrollIntoView({ block: 'end' }));
        await A.page.screenshot({ path: path.join(CAPTURA, 'sem-fotos-' + e.nome + '.png') });
      }
      await A.page.uncheck('#chkSemFotos');
      ok(/Abrir c[aâ]mera/.test(await rotulo(A.page)), '  desmarcando, volta "Abrir camera"');
      await A.page.check('#chkSemFotos');
      const antes = pg.tabela('devolucoes' + e.sufixo).length;
      const [req, resp] = await Promise.all([
        A.page.waitForRequest((r) => /\/api\/triagem\/problema$/.test(r.url()) && r.method() === 'POST', { timeout: 8000 }),
        A.page.waitForResponse((r) => /\/api\/triagem\/problema$/.test(r.url()), { timeout: 8000 }),
        A.page.click('#btnProblemaAcao'),
      ]);
      const enviado = JSON.parse(req.postData() || '{}');
      ok(enviado.sem_fotos === true && Array.isArray(enviado.fotos) && enviado.fotos.length === 0, '⚠️ o clique manda sem_fotos:true com 0 fotos, sem abrir a camera');
      ok(resp.status() === 200, '⚠️ o servidor aceita (' + resp.status() + ')');
      await A.page.waitForFunction(() => !document.getElementById('modalProblema').classList.contains('show'), null, { timeout: 8000 }).catch(() => {});
      ok(!(await A.page.evaluate(() => document.getElementById('modalProblema').classList.contains('show'))), '  o modal fecha');
      ok(!(await A.page.evaluate(() => { const c = document.getElementById('cameraOverlay'); return !!c && c.classList.contains('show'); })), '⚠️ e a camera NAO abriu (o abrirCamera tambem fecha o modal — por isso confere a camera)');
      ok(pg.tabela('devolucoes' + e.sufixo).length === antes + 1, '⚠️ o defeito foi gravado em devolucoes' + e.sufixo);
      // proximo pacote: a caixa volta desmarcada
      await A.bipar('ADX' + e.nome.length);
      ok(await visivel(A.page) && !(await A.page.isChecked('#chkSemFotos')) && /Abrir c[aâ]mera/.test(await rotulo(A.page)), '  reabrindo o modal no proximo pacote: "Sem fotos" desmarcado e botao "Abrir camera"');
      ok(A.errosJs.length === 0, '  sem erro de JS' + (A.errosJs.length ? ': ' + A.errosJs.slice(0, 3).join(' | ') : ''));
      await A.ctx.close();
    }
  } catch (err) {
    falhas++; console.log('FALHA ' + (err && err.stack || err));
  } finally {
    if (navegador) await navegador.close().catch(() => {});
    await s.matar(); await pg.parar();
  }
  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})();
