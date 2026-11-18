'use strict';
// b761 — V-08 (auditoria do Codex, 15/11): BLOBS DE PREVIEW SAO REVOGADOS — provado no navegador real.
//
// Ate o b756, `atualizarCameraUI()` criava um `URL.createObjectURL(f.blob)` NOVO a cada redesenho da tira de
// miniaturas (e ela redesenha a cada foto, a cada upload concluido, a cada remocao) e NUNCA revogava. Num turno de
// centenas de fotos o navegador do celular segurava todos os blobs ate a aba fechar. Agora: um blob: por foto pendente,
// revogado quando ela sobe, falha, e removida ou o fluxo troca. Aqui o Chromium conta as chamadas de verdade
// (createObjectURL/revokeObjectURL instrumentadas antes de a pagina carregar), nas 3 empresas:
//   - 1 foto pendente + 5 redesenhos = 1 createObjectURL (nao 6);
//   - upload concluido → revogado; foto removida → revogado; fluxo trocado + resposta tardia → revogado;
//   - no fim, criados == revogados.
// Precisa do Chromium do Playwright (igual ao test/navegador-real.test.js).
// Roda com: node test/blobs-revogados-navegador.test.js
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('FALHA Playwright nao instalado: ' + e.message); process.exit(1); }

const EMPRESAS = [{ nome: 'GOOD', rota: '' }, { nome: 'AMB', rota: '/amb', prefixo: 'AMB_' }, { nome: 'Girassol', rota: '/girassol', prefixo: 'GIRASSOL_' }];

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
    navegador = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    for (const e of EMPRESAS) {
      console.log('\n── ' + e.nome);
      const ctx = await navegador.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, permissions: ['camera'] });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        window.__blobs = { criados: 0, revogados: 0, vivos: new Set() };
        const c = URL.createObjectURL.bind(URL); const r = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (o) => { const u = c(o); window.__blobs.criados++; window.__blobs.vivos.add(u); return u; };
        URL.revokeObjectURL = (u) => { window.__blobs.revogados++; window.__blobs.vivos.delete(u); return r(u); };
      });
      const liberar = []; await page.route('**/api/triagem/upload-foto', async (route) => { await new Promise((r) => liberar.push(r)); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'https://x/f.jpg' }) }); });
      const contagem = () => page.evaluate(() => ({ criados: window.__blobs.criados, revogados: window.__blobs.revogados, vivos: window.__blobs.vivos.size }));
      await page.goto('http://127.0.0.1:' + s.porta + e.rota + '/', { waitUntil: 'load' });
      await page.fill('#loginUser', 'esto'); await page.fill('#loginPass', 's1');
      await Promise.all([page.waitForResponse((r) => /\/api\/auth\/login/.test(r.url())), page.click('#btnLogin')]);
      await page.evaluate(() => { abrirModalProblema(); return abrirCamera(); });
      await page.waitForFunction(() => { const v = document.getElementById('cameraVideo'); return v && v.videoWidth >= 100; }, null, { timeout: 8000 });
      // 1 foto pendente, 5 redesenhos
      await page.evaluate(() => capturarFoto());
      const t0 = Date.now(); while (!liberar.length && Date.now() - t0 < 8000) await page.waitForTimeout(50);
      await page.evaluate(() => { for (let i = 0; i < 5; i++) atualizarCameraUI(); });
      let c = await contagem();
      ok(c.criados === 1, '⚠️ 1 foto pendente + 5 redesenhos = 1 createObjectURL (' + c.criados + ')');
      // upload conclui → revoga
      liberar.shift()(); await page.waitForTimeout(300);
      c = await contagem();
      ok(c.revogados === 1 && c.vivos === 0, '  upload concluido → blob revogado (' + c.revogados + ' revogado(s), ' + c.vivos + ' vivo(s))');
      // 2a foto pendente removida pelo X → revoga
      await page.waitForTimeout(650);   // debounce do botao de captura
      await page.evaluate(() => capturarFoto());
      const t1 = Date.now(); while (liberar.length < 1 && Date.now() - t1 < 8000) await page.waitForTimeout(50);
      await page.evaluate(() => removerFotoCamera(1));
      c = await contagem();
      ok(c.criados === 2 && c.revogados === 2, '  foto pendente removida pelo X → revogada (' + c.criados + '/' + c.revogados + ')');
      liberar.shift()(); await page.waitForTimeout(300);
      // 3a foto pendente, fluxo trocado, resposta tardia → revoga
      await page.waitForTimeout(650);
      await page.evaluate(() => capturarFoto());
      const t2 = Date.now(); while (liberar.length < 1 && Date.now() - t2 < 8000) await page.waitForTimeout(50);
      await page.evaluate(() => { fecharCamera(true); abrirModalProblema(); });
      liberar.shift()(); await page.waitForTimeout(300);
      c = await contagem();
      ok(c.criados === 3 && c.revogados === 3 && c.vivos === 0, '⚠️ no fim: criados == revogados, nenhum blob vivo (' + c.criados + '/' + c.revogados + ', vivos ' + c.vivos + ')');
      await ctx.close();
    }
  } finally { if (navegador) await navegador.close(); s.matar(); }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
