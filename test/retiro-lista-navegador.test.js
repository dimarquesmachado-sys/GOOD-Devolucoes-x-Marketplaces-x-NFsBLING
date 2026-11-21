'use strict';
// b780 — a lista "vem pelo RETIRO" na TELA, com o Chromium de verdade e o server.js (3 empresas; o busca.js e um so).
// Pedido do dono (21/11): a lista mostrava so o numero do pedido — "titulo, produto, sku, qtdade, data, nome cliente,
// pack id, order id, tracking — o que tiver coloca la". O bipe da etiqueta e simulado como "nao encontrado" e a rota
// /api/espreita/retiro devolve linhas MONTADAS PELA PECA DE PRODUCAO (lib/retiro-bipe.js) a partir de itens da espreita.
// Prova:
//   - a tela manda o codigo bipado pra rota (?codigo=) — e o servidor que marca a peca cuja retirada tem o numero;
//   - cada linha mostra produto (qtd, titulo, SKU), cliente (apelido), NF, pedido + pack, rastreio, datas e a
//     condicao em portugues; sem data do CD, diz por que;
//   - a peca marcada vem PRIMEIRO, em verde; o resto, mais recente primeiro;
//   - um bipe novo antes da lista chegar: a lista do bipe antigo NAO aparece na tela do novo (P2-01);
//   - o toque busca pelo numero do pedido; titulo hostil nao executa (escapado).
// Roda com: node test/retiro-lista-navegador.test.js
const { subir } = require('./_boot-real');
const { itemDoRetiro } = require('../lib/retiro-bipe');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('FALHA Playwright nao instalado: ' + e.message); process.exit(1); }

const EMPRESAS = [{ nome: 'GOOD', rota: '' }, { nome: 'AMB', rota: '/amb', prefixo: 'AMB_' }, { nome: 'Girassol', rota: '/girassol', prefixo: 'GIRASSOL_' }];
const ETIQUETA = '48133297953';
// itens como a espreita entrega (em_transito, marcados vem_pelo_retiro) — a peca de producao monta a linha
const ESPREITA = [
  { pedido: '2000018094931160', tracking: 'TRKVELHO', vem_pelo_retiro: true, desde: '2026-08-01T10:00:00Z',
    itens: [{ titulo: 'Luminaria Pendente', sku: 'LUM-1', qtd: 1 }], cliente_ml: 'Ana Velha', nickname: 'ANAV',
    retiro: { condicao: 'saleable', reservada_em: null, saiu_cd_em: null, numeros: [], linha_do_tempo: { anuncio_http: 403, motivo: 'anuncio negado pelo ML: falta a permissao "Publicação e sincronização" no app' } } },
  { pedido: '2000018239001602', pack_id: '2000009999000001', tracking: 'TRKA1', vem_pelo_retiro: true, desde: '2026-09-20T10:00:00Z',
    itens: [{ titulo: 'Cavalete Automotivo 3 Toneladas Par <img src=x onerror="window.__xss=1">', sku: 'CAV-3T', qtd: 2 }],
    cliente_ml: 'Joao Silva', nickname: 'JOAOSILVA77', nf_ml_numero: '12345', nf_ml_serie: '1',
    retiro: { condicao: 'unsaleable', motivo: 'damaged', reservada_em: '2026-09-28T10:00:00Z', saiu_cd_em: '2026-10-01T10:00:00Z',
      numeros: [{ campo: 'WITHDRAWAL_DELIVERY.detail.shipment', valor: ETIQUETA }], linha_do_tempo: { anuncio_http: 200, operacoes_http: 200, operacoes: 3 } } },
  // Codex #632: D e do MESMO anuncio de A — a retirada do anuncio traz os mesmos numeros
  { pedido: '2000018338961088', tracking: 'TRKD4', vem_pelo_retiro: true, desde: '2026-09-15T10:00:00Z',
    itens: [{ titulo: 'Cavalete Automotivo 3 Toneladas Par', sku: 'CAV-3T', qtd: 1 }], cliente_ml: 'Pedro Dias', nickname: 'PDIAS',
    retiro: { condicao: 'saleable', reservada_em: '2026-09-28T10:00:00Z', saiu_cd_em: '2026-10-01T10:00:00Z', inventario: 'INVA',
      numeros: [{ campo: 'WITHDRAWAL_DELIVERY.detail.shipment', valor: ETIQUETA }], linha_do_tempo: { anuncio_http: 200, operacoes_http: 200, operacoes: 3, motivo: null } } },
  { pedido: '2000019243159482', tracking: 'TRKNOVO', vem_pelo_retiro: true, desde: '2026-11-01T10:00:00Z',
    itens: [{ titulo: 'Macaco Jacare 2T', sku: 'MAC-2T', qtd: 1 }], cliente_ml: 'Maria Borges', nickname: 'MARIAB',
    retiro: { condicao: 'saleable', reservada_em: '2026-11-10T10:00:00Z', saiu_cd_em: null, numeros: [], linha_do_tempo: { anuncio_http: 200, operacoes_http: 200, operacoes: 1 } } },
];

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
    navegador = await chromium.launch();
    for (const e of EMPRESAS) {
      console.log('\n── ' + e.nome);
      const ctx = await navegador.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const errosJs = []; page.on('pageerror', (err) => errosJs.push(String(err && err.message || err)));
      const codigosPedidos = []; const buscados = [];
      let atrasarRetiro = 0;
      await page.route('**/api/devolucao/identificar/**', async (route) => {
        const codigo = decodeURIComponent(new URL(route.request().url()).pathname.split('/api/devolucao/identificar/')[1] || '');
        buscados.push(codigo);
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, encontrado: false, erro: 'Codigo nao encontrado em shipments/packs do ML nem nas devolucoes Shopee.', tentativas: [{ tipo: 'shipment_id', codigo, status: 404 }] }) });
      });
      await page.route('**/api/espreita/retiro**', async (route) => {
        const codigo = new URL(route.request().url()).searchParams.get('codigo');
        codigosPedidos.push(codigo);
        if (atrasarRetiro) await new Promise((r) => setTimeout(r, atrasarRetiro));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, itens: ESPREITA.map((x) => itemDoRetiro(x, codigo)) }) });
      });
      await page.goto('http://127.0.0.1:' + s.porta + e.rota + '/', { waitUntil: 'load' });
      await page.fill('#loginUser', 'esto'); await page.fill('#loginPass', 's1');
      await Promise.all([page.waitForResponse((r) => /\/api\/auth\/login/.test(r.url())), page.click('#btnLogin')]);

      await page.fill('#codigo', ETIQUETA); await page.press('#codigo', 'Enter');
      await page.waitForSelector('[data-retiro-pedido]', { timeout: 8000 });
      ok(codigosPedidos[codigosPedidos.length - 1] === ETIQUETA, '⚠️ a tela manda o codigo bipado pra rota (?codigo=' + codigosPedidos[codigosPedidos.length - 1] + ')');
      const linhas = await page.$$eval('[data-retiro-pedido]', (els) => els.map((el) => ({ pedido: el.getAttribute('data-retiro-pedido'), texto: el.innerText, verde: /e8f5e9|232, 245, 233/.test(el.getAttribute('style') || '') })));
      ok(linhas.length === 4, '  4 pecas na lista (' + linhas.length + ')');
      const A = linhas.find((l) => l.pedido === '2000018239001602') || { texto: '' };
      const D = linhas.find((l) => l.pedido === '2000018338961088') || { texto: '' };
      ok(linhas.slice(0, 2).every((l) => l.verde) && A.verde && D.verde, '⚠️ as pecas cuja retirada tem o numero da etiqueta vem PRIMEIRO, em verde');
      // Codex #632: o numero da retirada prova o PRODUTO, nao o pedido — com 2 pedidos do mesmo anuncio, a tela NAO afirma "e deste pedido"
      ok(!/é deste pedido/.test(A.texto + D.texto) && /numa retirada do Full deste PRODUTO — 2 pedidos com a mesma retirada: confira cliente e data/.test(A.texto),
        '⚠️ Codex #632: pela retirada, a tela diz "mesmo PRODUTO — 2 pedidos, confira cliente e data", nunca "e deste pedido"');
      ok(/retirada do MESMO PRODUTO destes 2 pedidos/.test(await page.$eval('[data-retiro-pedido]', (el) => el.parentElement.innerText)), '  e o cabecalho avisa que sao 2 pedidos do mesmo produto');
      ok(/2× Cavalete Automotivo 3 Toneladas Par/.test(A.texto) && /SKU CAV-3T/.test(A.texto), '⚠️ produto com quantidade, titulo e SKU');
      ok(/Joao Silva \(JOAOSILVA77\)/.test(A.texto) && /NF 12345-1/.test(A.texto), '⚠️ cliente (apelido) e NF');
      ok(/Pedido 2000018239001602 · Pack 2000009999000001/.test(A.texto) && /Rastreio TRKA1/.test(A.texto), '  pedido + pack e rastreio');
      ok(/saiu do CD 01\/10/.test(A.texto) && /devolução aberta 20\/09/.test(A.texto) && /ML: inservível \(embalagem danificada\)/.test(A.texto), '  datas e condicao do ML em portugues');
      ok(linhas[2] && linhas[2].pedido === '2000019243159482' && /retirada reservada 10\/11/.test(linhas[2].texto) && /ML: vendável/.test(linhas[2].texto) && !linhas[2].verde,
        '  o resto: mais recente primeiro (retirada reservada 10/11), sem verde');
      ok(linhas[3] && /sem data do CD: anuncio negado pelo ML: falta a permissao "Publicação e sincronização" no app/.test(linhas[3].texto),
        '  sem data do CD, a linha diz por que');
      ok(!(await page.evaluate(() => window.__xss === 1)), '  titulo hostil nao executa (escapado)');

      // o numero do PROPRIO pedido (ou pack/rastreio) prova o pedido
      await page.fill('#codigo', '2000019243159482'); await page.press('#codigo', 'Enter');
      await page.waitForSelector('[data-retiro-pedido]', { timeout: 8000 });
      const prim = await page.$eval('[data-retiro-pedido]', (el) => ({ pedido: el.getAttribute('data-retiro-pedido'), texto: el.innerText }));
      ok(prim.pedido === '2000019243159482' && /O número desta etiqueta é deste pedido/.test(prim.texto), '  numero do proprio pedido → "e deste pedido", primeiro');

      // P2-01: bipe novo antes da lista do anterior chegar
      atrasarRetiro = 1500;
      await page.fill('#codigo', '99999999991'); await page.press('#codigo', 'Enter');
      await page.waitForTimeout(150);
      atrasarRetiro = 0;
      await page.fill('#codigo', 'BR1234567890123X'); await page.press('#codigo', 'Enter');   // codigo Shopee: nao sugere retiro
      await page.waitForTimeout(2200);
      ok((await page.$$('[data-retiro-pedido]')).length === 0, '⚠️ a lista do bipe antigo (que chegou atrasada) NAO aparece na tela do bipe novo');

      // o toque busca pelo pedido
      await page.fill('#codigo', ETIQUETA); await page.press('#codigo', 'Enter');
      await page.waitForSelector('[data-retiro-pedido]', { timeout: 8000 });
      const antes = buscados.length;
      await page.click('[data-retiro-pedido="2000018239001602"]');
      await page.waitForFunction((n) => true, antes);
      await page.waitForTimeout(500);
      ok(buscados.slice(antes).includes('2000018239001602'), '⚠️ o toque busca pelo numero do pedido');
      ok(errosJs.length === 0, '  sem erro de JS' + (errosJs.length ? ': ' + errosJs.slice(0, 3).join(' | ') : ''));
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
