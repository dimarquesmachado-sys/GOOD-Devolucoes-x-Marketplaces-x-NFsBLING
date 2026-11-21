'use strict';
// b789 — "PACOTE MELI" NA TELA, com o Chromium de verdade e o server.js (3 empresas; busca.js e colar-imagem.js sao um so).
//
// O caso (AMB, 21/11): etiqueta de volta do ML de venda NAO ENTREGUE — remetente "MELI #0", sem cliente e sem NF. O
// codigo de barras e o QR ({"id":"48133297953","t":"lm"}) sao o envio DE VOLTA: o ML responde 404. O numero que acha a
// venda e o "Ref. ID" impresso (48126024340). O dono: "tenta descobrir como solucionar... pra nossa triagem" e "ou ate um
// botao pra clicar e marcar que e pacote MELI".
//
// Prova, na tela:
//   1. bipou o codigo de barras e o ML disse 404 → o cartao explica e traz o campo do Ref. ID; digitou → acha a venda;
//   2. o cartao SO aparece quando o ML respondeu 404 pro envio (403/sem resposta nao; codigo da Shopee nao; nome nao);
//   3. o botao "📦 pacote MELI" abre o cartao sem bipar; numero curto nao busca; a resposta atrasada de um bipe anterior
//      (e a lista do retiro dele) nao entra por cima;
//   4. FOTO: o QR nao acha → o Ref. ID e lido da MESMA foto e a busca refeita sozinha → venda. Uma tentativa so (sem laco);
//      se o estoquista seguiu pra outra caixa, ou mandou outra foto, a leitura velha e descartada;
//   5. a foto pedida pelo cartao vai DIRETO ao Ref. ID (nem tenta o QR); sem Ref. ID legivel, diz e manda digitar; com dois
//      numeros, pergunta;
//   6. etiqueta comum do ML (QR que acha) continua sem leitura de texto nenhuma — o caminho do dia a dia nao ficou mais lento;
//   7. venda achada por um Ref. ID LIDO DA FOTO mostra o numero lido pra conferir com a etiqueta (o leitor pode trocar um
//      digito, e o numero vizinho pode ser outra venda); digitado, ou achado pelo QR, nao mostra.
//   8. (b790, Codex #638) a leitura que TERMINA DEPOIS de o estoquista ter seguido adiante — bipou outra caixa, buscou um
//      Ref. ID na mao, abriu o cartao, comecou a digitar, mandou outra imagem — nao escreve no campo nem busca por cima,
//      nos tres caminhos (foto do cartao, imagem comum, tentativa automatica), e nao deixa "lendo..." pendurado. A mesma
//      busca refeita durante a leitura automatica (mesma caixa) aproveita a mesma leitura, uma vez.
//
// O leitor de QR (jsQR) e o de texto (Tesseract) vem de fora (CDN): aqui sao trocados por dubles que devolvem o que o
// teste manda — o TEXTO e o que o leitor de verdade devolveu pra foto real (ver test/ref-id-pacote-meli.test.js).
// A rota de busca e simulada no formato que o servidor manda (tentativas[].tipo/status, codigo_limpo, qr_ml_sem_shipment).
// Roda com: node test/ref-id-navegador.test.js     (CAPTURA_REF_ID=<pasta> salva as capturas de tela)
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('FALHA Playwright nao instalado: ' + e.message); process.exit(1); }

const EMPRESAS = [{ nome: 'GOOD', rota: '' }, { nome: 'AMB', rota: '/amb', prefixo: 'AMB_' }, { nome: 'Girassol', rota: '/girassol', prefixo: 'GIRASSOL_' }];
const BARRAS = '48133297953', REF = '48126024340';
const QR = '{"id":"' + BARRAS + '","t":"lm"}';
// o texto que o leitor de VERDADE devolveu pra foto da etiqueta da AMB (sem as linhas de endereco)
const OCR_REAL = 'G MELI AO\nR. 1D: 48126024340\nXSP16\n481332 97953\nJE SSP57 -- 7\nXSP16  SSP57 49 7\nSEX 02/10/2026 NF:';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CAPTURA = process.env.CAPTURA_REF_ID || '';

const venda = (codigo) => ({
  ok: true, encontrado: true, codigo,
  order: { id: '2000018696282248', date_created: '2026-09-29T08:17:00Z', buyer: { nickname: 'CLIENTE' }, payments: [{ transaction_amount: 10 }],
    order_items: [{ item: { id: 'MLB1', title: 'Produto ' + codigo, seller_sku: 'KC6' }, quantity: 2, unit_price: 10 }] },
  shipment: { id: codigo, shipping_items: [{ id: 'MLB1', description: 'Produto ' + codigo, quantity: 2 }] },
  nf: { numero: '777', itens: [{ titulo: 'Produto ' + codigo, sku: 'KC6', ean: '-', quantidade: 2 }] },
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
    navegador = await chromium.launch();
    for (const e of EMPRESAS) {
      console.log('\n── ' + e.nome);
      const ctx = await navegador.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: CAPTURA ? 2 : 1 });
      // os dubles dos dois leitores de fora (entram antes de qualquer script da pagina; a CDN e cortada logo abaixo)
      await ctx.addInitScript(() => {
        window.__qr = null; window.__ocr = ''; window.__ocrMs = 0; window.__n = { qr: 0, ocr: 0 };
        window.__ocrManual = false; window.__ocrFila = [];   // modo manual: a leitura fica PENDENTE ate o teste soltar (sem corrida com o relogio)
        try { delete window.BarcodeDetector; } catch (err) { /* no Linux nem existe */ }
        window.jsQR = function () { window.__n.qr++; return window.__qr ? { data: window.__qr } : null; };
        window.Tesseract = { createWorker: async function () {
          return {
            setParameters: async function () {},
            recognize: async function () {
              window.__n.ocr++; const texto = window.__ocr;
              if (window.__ocrManual) await new Promise((r) => window.__ocrFila.push(r));
              else if (window.__ocrMs) await new Promise((r) => setTimeout(r, window.__ocrMs));
              return { data: { text: texto } };
            },
            terminate: async function () {},
          };
        } };
      });
      const page = await ctx.newPage();
      const errosJs = []; page.on('pageerror', (err) => errosJs.push(String(err && err.message || err)));
      await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());

      // ── a rota de busca, no formato que o servidor manda ──
      const buscados = []; const acha = new Set(); const statusDoEnvio = {}; const atraso = {}; let atrasoRetiro = 0; let retiroPedidos = 0;
      const presa = { codigo: null, soltar: [] };   // busca PRESA: a resposta desse codigo so volta quando o teste soltar (sem corrida com o relogio)
      await page.route('**/api/devolucao/identificar/**', async (route) => {
        const codigo = decodeURIComponent(new URL(route.request().url()).pathname.split('/api/devolucao/identificar/')[1] || '');
        buscados.push(codigo);
        const doQr = (codigo.match(/"id"\s*:\s*"(\d+)"/) || [])[1];
        const limpo = doQr || codigo.replace(/\D/g, '');
        if (atraso[limpo]) await new Promise((r) => setTimeout(r, atraso[limpo]));
        if (presa.codigo === limpo) await new Promise((r) => presa.soltar.push(r));
        if (acha.has(limpo)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(venda(limpo)) });
        const tentativas = [];
        if (limpo.length >= 10 && limpo.length <= 13) {   // a rota so tenta o envio do ML com 10 a 13 digitos
          const st = statusDoEnvio[limpo] || 404;
          tentativas.push(Object.assign({ tipo: 'shipment_id', codigo: limpo, ok: false, status: st }, st === 504 ? { degradado: true } : {}));
          if (limpo.length === 11) tentativas.push({ tipo: 'pack_id', codigo: '20000' + limpo, ok: false, status: 404 });
        } else tentativas.push({ tipo: 'nf_por_nome', codigo, ok: false, status: 404, qtd: 0 });
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify(Object.assign({
          ok: false, encontrado: false, codigo_buscado: codigo, codigo_limpo: limpo, avisos: [], tentativas,
          erro: doQr ? 'QR do ML lido (shipment ' + limpo + ') mas a API não achou esse envio. Etiqueta SEM nome de cliente (remetente MELI)? O código de barras dela também não acha: use o Ref. ID impresso no alto da etiqueta.'
            : 'Codigo nao encontrado em shipments/packs do ML nem nas devolucoes Shopee.',
        }, doQr ? { qr_ml_sem_shipment: true } : {})) });
      });
      await page.route('**/api/espreita/retiro**', async (route) => {
        retiroPedidos++;
        if (atrasoRetiro) await new Promise((r) => setTimeout(r, atrasoRetiro));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, itens: atrasoRetiro ? [{ pedido: '2000018239001602', produtos: [{ titulo: 'Peca do retiro', sku: 'X', qtd: 1 }] }] : [] }) });
      });
      await page.route('**/api/triagem/status/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, registros: [] }) }));
      await page.route('**/api/produto/imagem/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) }));

      await page.goto('http://127.0.0.1:' + s.porta + e.rota + '/', { waitUntil: 'load' });
      await page.fill('#loginUser', 'esto'); await page.fill('#loginPass', 's1');
      await Promise.all([page.waitForResponse((r) => /\/api\/auth\/login/.test(r.url())), page.click('#btnLogin')]);
      await page.waitForSelector('#btnPacoteMeli', { timeout: 8000 });

      const bipar = async (codigo) => { await page.fill('#codigo', codigo); await page.press('#codigo', 'Enter'); };
      const resultado = () => page.$eval('#resultado', (el) => el.innerText);
      const esperarVenda = (codigo) => page.waitForFunction((t) => document.getElementById('resultado').innerText.includes(t), 'Produto ' + codigo, { timeout: 8000 });
      const esperarErro = () => page.waitForSelector('#resultado .erro-box', { timeout: 8000 });
      const temCartao = async () => (await page.$$('#cartaoRefId')).length;
      const avisoLido = async () => ((await page.$$('#avisoRefIdLido')).length ? page.$eval('#avisoRefIdLido', (el) => el.innerText) : '');
      const soltarFoto = () => page.evaluate((b64) => {
        const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const dt = new DataTransfer(); dt.items.add(new File([u8], 'etiqueta.png', { type: 'image/png' }));
        document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, PNG.toString('base64'));
      const leitores = (campos) => page.evaluate((c) => { Object.assign(window, c); return Object.assign({}, window.__n); }, campos || {});

      // ══ 1. bipou o codigo de barras: o ML diz 404 → o cartao; digitou o Ref. ID → a venda ══
      acha.add(REF);
      await bipar(BARRAS);
      await page.waitForSelector('#cartaoRefId', { timeout: 8000 });
      const cartao = await page.$eval('#cartaoRefId', (el) => el.innerText);
      ok(/Pacote MELI/.test(cartao) && /SEM nome de cliente/.test(cartao) && /não acham a venda/.test(cartao) && /Ref\. ID/.test(cartao) && /impresso no alto/.test(cartao),
        '⚠️ o ML respondeu 404 pro envio bipado: a tela explica o pacote MELI e aponta o Ref. ID');
      ok(await page.$eval('#resultado', (el) => { const erro = el.querySelector('.erro-box'); const c = el.querySelector('#cartaoRefId'); return !!erro && !!c && !!(erro.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); }),
        '  o cartao vem logo DEPOIS do erro (que continua na tela, com as tentativas)');
      ok(await page.$eval('#inputRefId', (el) => el.getAttribute('inputmode') === 'numeric' && parseFloat(getComputedStyle(el).fontSize) >= 16), '  campo com teclado numerico e letra de 16px (o celular nao da zoom ao tocar)');
      ok(await page.$eval('#cartaoRefId', (el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1; }), '  o cartao cabe na largura do celular');
      if (CAPTURA) await page.screenshot({ path: CAPTURA + '/ref-id-' + e.nome + '-cartao.png', fullPage: true });
      await page.fill('#inputRefId', ' 481260 24340 '); await page.press('#inputRefId', 'Enter');
      await esperarVenda(REF);
      ok(buscados[buscados.length - 1] === REF && (await page.inputValue('#codigo')) === REF, '⚠️ digitou o Ref. ID no cartao (com espacos) + Enter: busca pelo numero limpo e a VENDA aparece');
      ok((await temCartao()) === 0, '  com a venda na tela, o cartao some');
      ok((await avisoLido()) === '', '  Ref. ID DIGITADO: sem o aviso de "lido da foto"');
      if (CAPTURA) await page.screenshot({ path: CAPTURA + '/ref-id-' + e.nome + '-venda.png', fullPage: true });

      // ══ 2. quando o cartao NAO aparece ══
      statusDoEnvio['48133297000'] = 403; statusDoEnvio['48133297001'] = 504;
      await bipar('48133297000'); await esperarErro();
      ok((await temCartao()) === 0, '⚠️ o ML RECUSOU a consulta do envio (403): nao e "nao existe" — sem cartao do Ref. ID');
      await bipar('48133297001'); await esperarErro();
      ok((await temCartao()) === 0 && /sem resposta a tempo/.test(await resultado()), '⚠️ envio sem resposta a tempo (degradado): sem cartao — vale bipar de novo');
      await bipar('BR1234567890123X'); await esperarErro();
      ok((await temCartao()) === 0 && /shipment_id/.test(await resultado()), '⚠️ rastreio da Shopee (13 digitos: o servidor ate tenta o envio do ML e leva 404): sem cartao');
      await bipar('RENATONEVES'); await esperarErro();
      ok((await temCartao()) === 0, '  busca por nome que nao achou: sem cartao');
      await bipar('48133297002'); await page.waitForSelector('#cartaoRefId', { timeout: 8000 });
      await page.fill('#inputRefId', '48133297003'); await page.click('#btnBuscarRefId');
      await page.waitForFunction(() => /48133297003/.test(document.getElementById('resultado').innerText), null, { timeout: 8000 });
      ok((await temCartao()) === 1 && (await page.inputValue('#inputRefId')) === '', '  Ref. ID digitado errado (404 tambem): o cartao volta, vazio, pra tentar de novo');

      // ══ 3. o botao "pacote MELI" ══
      const antesBotao = buscados.length;
      await page.click('#btnPacoteMeli');
      ok((await temCartao()) === 1 && (await page.$$('#resultado .erro-box')).length === 0 && await page.$eval('#resultado', (el) => el.classList.contains('show')) && buscados.length === antesBotao,
        '⚠️ o botao "pacote MELI" abre o cartao sem bipar (e sem erro na tela)');
      ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'inputRefId'), '  com o cursor ja no campo do Ref. ID');
      ok(await page.$eval('#btnPacoteMeli', (el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.left >= 0 && r.right <= window.innerWidth + 1; }), '  o botao cabe na tela do celular');
      await page.fill('#inputRefId', '12345'); await page.click('#btnBuscarRefId');
      await page.waitForTimeout(250);
      ok(buscados.length === antesBotao && /Ref\. ID tem 11/.test(await page.$eval('#toast', (el) => el.textContent)) && (await temCartao()) === 1, '⚠️ numero curto demais: avisa e NAO busca');
      await page.fill('#inputRefId', REF); await page.click('#btnBuscarRefId');
      await esperarVenda(REF);
      ok(buscados.length === antesBotao + 1 && buscados[buscados.length - 1] === REF, '  numero certo: busca e acha');
      if (CAPTURA) { await page.click('#btnPacoteMeli'); await page.screenshot({ path: CAPTURA + '/ref-id-' + e.nome + '-botao.png' }); }
      // P2-01: bipe lento em andamento + botao → a resposta atrasada (e a lista do retiro dela) NAO entra por cima do cartao
      atraso['48133297004'] = 1200;
      await bipar('48133297004'); await page.waitForTimeout(150);
      await page.click('#btnPacoteMeli');
      ok(await page.evaluate(() => !document.getElementById('loading').classList.contains('show') && !document.getElementById('btnBuscar').disabled), '⚠️ botao com um bipe lento em andamento: o "buscando" some e o Buscar volta a funcionar');
      await page.waitForTimeout(1600);
      ok((await temCartao()) === 1 && (await page.$$('#resultado .erro-box')).length === 0, '⚠️ a resposta atrasada do bipe anterior NAO pinta por cima do cartao');
      atrasoRetiro = 1200;
      await bipar('48133297005'); await page.waitForSelector('#cartaoRefId', { timeout: 8000 });
      await page.click('#btnPacoteMeli'); await page.waitForTimeout(1700);
      ok((await page.$$('[data-retiro-pedido]')).length === 0 && (await temCartao()) === 1, '⚠️ nem a lista do retiro do bipe anterior (que chegou depois)');
      atrasoRetiro = 0;

      // ══ 4. FOTO: o QR nao acha → le o Ref. ID da MESMA foto e busca sozinho ══
      let de = buscados.length; let n0 = await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrMs: 0 });
      await soltarFoto();
      await esperarVenda(REF);
      let n1 = await leitores();
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([QR, REF]), '⚠️ foto do pacote MELI: buscou o QR (404) e, SOZINHO, o Ref. ID lido da mesma foto → venda (' + buscados.slice(de).map((x) => x.slice(0, 14)).join(' → ') + ')');
      ok(n1.ocr - n0.ocr === 1, '  uma leitura de texto so');
      const aviso = await avisoLido();
      ok(/lido da foto/.test(aviso) && aviso.includes(REF) && /Confira com o Ref\. ID impresso na etiqueta/.test(aviso), '⚠️ a venda achada pelo Ref. ID LIDO DA FOTO mostra o numero lido pra conferir com a etiqueta (o leitor pode trocar um digito)');
      ok(await page.$eval('#resultado', (el) => el.firstElementChild && el.firstElementChild.id === 'avisoRefIdLido'), '  o aviso vem ANTES da venda (em cima)');
      if (CAPTURA) await page.screenshot({ path: CAPTURA + '/ref-id-' + e.nome + '-foto-venda.png', fullPage: true });
      await bipar(REF); await esperarVenda(REF);
      ok((await avisoLido()) === '', '  o mesmo numero bipado na mao depois: sem o aviso (ele vale pra busca que veio da foto)');
      // sem laco: o Ref. ID tambem nao acha → para ali, com o cartao pra digitar
      acha.delete(REF);
      de = buscados.length; n0 = await leitores();
      await soltarFoto();
      await page.waitForFunction((r) => document.getElementById('codigo').value === r && !!document.getElementById('cartaoRefId'), REF, { timeout: 8000 });
      await page.waitForTimeout(900);
      n1 = await leitores();
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([QR, REF]) && n1.ocr - n0.ocr === 1 && (await temCartao()) === 1, '⚠️ SEM LACO: se o Ref. ID tambem nao achar, para (2 buscas, 1 leitura) e deixa o cartao pra digitar');
      acha.add(REF);
      // rotulo ilegivel e UM numero solto: na tentativa automatica ninguem disse que e pacote MELI — pergunta, nao busca sozinho.
      // (o numero do codigo de barras aparece INTEIRO no texto: como ele e o que acabou de falhar, nao volta como opcao)
      de = buscados.length; await leitores({ __qr: QR, __ocr: 'G MELI AO\n48126024340\nXSP16\n48133297953', __ocrMs: 0 });
      await soltarFoto();
      await page.waitForSelector('#zonaColarOpcoes button', { timeout: 8000 });
      await page.waitForTimeout(500);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([QR]) && (await page.$$('#zonaColarOpcoes button')).length === 1 && /não li o rótulo/.test(await page.$eval('#statusRefId', (el) => el.textContent)),
        '⚠️ tentativa automatica SEM o rotulo "Ref. ID": o numero solto (pode ser telefone/CPF de outra etiqueta) NAO e buscado sozinho — vira pergunta, e so com ELE (o codigo que acabou de falhar nao volta como opcao)');
      await page.click('#zonaColarOpcoes button');
      await esperarVenda(REF);
      ok(buscados[buscados.length - 1] === REF && (await avisoLido()).includes(REF), '  tocou nele: busca e acha (com o aviso do numero lido)');
      await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrMs: 0 });
      // o estoquista seguiu pra outra caixa enquanto a foto era lida: a leitura velha e descartada
      de = buscados.length; await leitores({ __ocrMs: 900 });
      await soltarFoto();
      await page.waitForSelector('#cartaoRefId', { timeout: 8000 });
      await bipar('RENATONEVES'); await esperarErro();
      await page.waitForTimeout(1300);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([QR, 'RENATONEVES']) && (await page.inputValue('#codigo')) === 'RENATONEVES', '⚠️ bipou outra coisa durante a leitura: o Ref. ID da foto antiga NAO e buscado por cima');
      // outra FOTO durante a leitura: vale a nova. As duas leituras ficam PENDENTES e a da foto antiga termina primeiro —
      // nessa hora o campo de busca ainda mostra o codigo dela: so o "veio outra imagem" impede a busca errada.
      de = buscados.length; await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrMs: 0, __ocrManual: true, __ocrFila: [] });
      await soltarFoto();
      await page.waitForFunction(() => window.__ocrFila.length === 1, null, { timeout: 8000 });
      await leitores({ __qr: null, __ocr: 'CORREIOS AD123456789BR' });
      await soltarFoto();
      await page.waitForFunction(() => window.__ocrFila.length === 2, null, { timeout: 8000 });
      await page.evaluate(() => window.__ocrFila[0]());
      await page.waitForTimeout(400);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([QR]), '⚠️ mandou OUTRA foto durante a leitura: o Ref. ID da antiga NAO e buscado (a nova ainda esta sendo lida)');
      ok(await page.evaluate(() => { const z = document.getElementById('zonaColar'); return !!z && z.style.display === 'flex' && /lendo o texto/.test(document.getElementById('zonaColarStatus').textContent); }), '  e a area de leitura continua na tela, com a leitura da foto NOVA (a antiga, ao ser largada, nao some com ela)');
      await page.evaluate(() => window.__ocrFila[1]());
      await page.waitForFunction(() => document.getElementById('codigo').value === 'AD123456789BR', null, { timeout: 8000 });
      await page.waitForTimeout(300);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([QR, 'AD123456789BR']), '  e vale a nova: buscou o que ela trouxe');
      // a leitura demorada nao perde o aviso: o "some em 1,5 s" da busca que falhou nao apaga a leitura do Ref. ID no meio
      de = buscados.length; await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrFila: [] });
      await soltarFoto();
      await page.waitForFunction(() => window.__ocrFila.length === 1, null, { timeout: 8000 });
      await page.waitForTimeout(1900);   // o sumico de 1,5 s da busca que falhou ja teria vencido
      ok(await page.evaluate(() => { const z = document.getElementById('zonaColar'); return !!z && z.style.display === 'flex' && /lendo o texto/.test(document.getElementById('zonaColarStatus').textContent) && /Lendo o Ref\. ID/.test((document.getElementById('statusRefId') || {}).textContent || ''); }),
        '⚠️ leitura demorada: o aviso "lendo..." continua na tela (o sumico da busca anterior nao o apaga) e o cartao diz que esta lendo a foto');
      await page.evaluate(() => window.__ocrFila[0]());
      await esperarVenda(REF);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([QR, REF]), '  e, quando termina, busca o Ref. ID');
      await leitores({ __ocrManual: false, __ocrFila: [] });
      // a foto que ja teve a leitura feita nao e lida de novo num bipe do MESMO codigo
      await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrMs: 0 });
      acha.delete(REF); await soltarFoto();
      await page.waitForFunction((r) => document.getElementById('codigo').value === r, REF, { timeout: 8000 });
      await page.waitForTimeout(400);
      de = buscados.length; n0 = await leitores();
      await bipar(QR); await page.waitForSelector('#cartaoRefId', { timeout: 8000 }); await page.waitForTimeout(500);
      n1 = await leitores();
      ok(n1.ocr === n0.ocr && buscados.length === de + 1, '  o mesmo codigo bipado de novo depois: a foto que ja foi lida uma vez nao e lida outra');
      acha.add(REF);

      // ══ 5. a foto pedida pelo CARTAO vai direto ao Ref. ID ══
      await page.click('#btnPacoteMeli');
      de = buscados.length; n0 = await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrMs: 0 });
      const [escolha] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), page.click('#btnFotoRefId')]);
      await escolha.setFiles({ name: 'etiqueta.png', mimeType: 'image/png', buffer: PNG });
      await esperarVenda(REF);
      n1 = await leitores();
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([REF]) && n1.qr === n0.qr && n1.ocr - n0.ocr === 1, '⚠️ foto pelo cartao: vai DIRETO ao Ref. ID — nem tenta o QR (1 busca, que acha)');
      ok((await avisoLido()).includes(REF), '  e a venda vem com o aviso do numero lido da foto');
      // a foto do cartao sendo lida e o estoquista manda OUTRA imagem (uma etiqueta comum): a leitura velha nao busca por cima
      await page.click('#btnPacoteMeli');
      de = buscados.length; await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrMs: 900 });
      await page.setInputFiles('#arquivoRefId', { name: 'etiqueta.png', mimeType: 'image/png', buffer: PNG });
      await page.waitForTimeout(200);
      acha.add('47416667999');
      await leitores({ __qr: '{"id":"47416667999","t":"l"}', __ocrMs: 0 });
      await soltarFoto();
      await esperarVenda('47416667999');
      await page.waitForTimeout(1100);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify(['{"id":"47416667999","t":"l"}']) && /Produto 47416667999/.test(await resultado()), '⚠️ foto do cartao em leitura + outra imagem: a leitura velha e descartada (a venda da nova fica na tela)');
      await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrMs: 0 });
      // a MESMA foto de novo dispara outra leitura
      await page.click('#btnPacoteMeli');
      de = buscados.length;
      await page.setInputFiles('#arquivoRefId', { name: 'etiqueta.png', mimeType: 'image/png', buffer: PNG });
      await esperarVenda(REF);
      ok(buscados.length === de + 1, '  a mesma foto escolhida de novo e lida de novo');
      // pelo CARTAO (ele ja disse que e pacote MELI): rotulo ilegivel e um numero so → e ele, busca direto
      await page.click('#btnPacoteMeli');
      de = buscados.length; await leitores({ __ocr: 'G MELI AO\n48126024340\nXSP16\n481332 97953' });
      await page.setInputFiles('#arquivoRefId', { name: 'semrotulo.png', mimeType: 'image/png', buffer: PNG });
      await esperarVenda(REF);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([REF]), '  pelo cartao, rotulo ilegivel e UM numero de envio: busca direto (ele ja disse que e pacote MELI)');
      // sem Ref. ID legivel
      await page.click('#btnPacoteMeli');
      de = buscados.length; await leitores({ __ocr: 'G MELI AO\nXSP16\nSEX 02/10/2026 NF:' });
      await page.setInputFiles('#arquivoRefId', { name: 'borrada.png', mimeType: 'image/png', buffer: PNG });
      await page.waitForFunction(() => /Não consegui ler o Ref\. ID/.test((document.getElementById('statusRefId') || {}).textContent || ''), null, { timeout: 8000 });
      ok(buscados.length === de && /não consegui ler o Ref\. ID/.test(await page.$eval('#zonaColarStatus', (el) => el.textContent)) && (await temCartao()) === 1, '⚠️ foto sem Ref. ID legivel: diz que nao leu, NAO busca nada, e o campo continua ali pra digitar');
      // dois numeros e nenhum rotulo: pergunta
      await leitores({ __ocr: 'G MELI AO\n48126024340\n48133297958\nXSP16' });
      await page.setInputFiles('#arquivoRefId', { name: 'duvida.png', mimeType: 'image/png', buffer: PNG });
      await page.waitForSelector('#zonaColarOpcoes button', { timeout: 8000 });
      const opcoes = await page.$$eval('#zonaColarOpcoes button', (els) => els.map((el) => el.innerText));
      ok(opcoes.length === 2 && buscados.length === de && /mais de um número/.test(await page.$eval('#statusRefId', (el) => el.textContent)), '⚠️ dois numeros e nenhum rotulo: PERGUNTA qual e o Ref. ID (' + opcoes.length + ' opcoes), nao chuta');
      await page.waitForTimeout(6500);
      ok((await page.$$('#zonaColarOpcoes button')).length === 2, '  e as opcoes ficam na tela (nao somem sozinhas enquanto ele escolhe)');
      await page.click('#zonaColarOpcoes button');
      await esperarVenda(REF);
      ok(buscados[buscados.length - 1] === REF && (await avisoLido()).includes(REF), '  tocou no numero: busca por ele (e a venda vem com o aviso do numero lido)');

      // ══ 6. o caminho do dia a dia nao mudou ══
      acha.add('47416667668');
      de = buscados.length; n0 = await leitores({ __qr: '{"id":"47416667668","t":"l"}', __ocr: OCR_REAL, __ocrMs: 0 });
      await soltarFoto();
      await esperarVenda('47416667668');
      await page.waitForTimeout(400);
      n1 = await leitores();
      ok(buscados.length === de + 1 && n1.ocr === n0.ocr, '⚠️ etiqueta comum do ML (o QR acha a venda): UMA busca e NENHUMA leitura de texto — nada ficou mais lento');
      ok((await avisoLido()) === '', '  e sem aviso de "lido da foto" (o QR e exato)');
      await leitores({ __qr: null, __ocr: OCR_REAL });
      de = buscados.length;
      await soltarFoto();
      await esperarVenda(REF);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([REF]) && (await avisoLido()).includes(REF), '⚠️ foto do pacote MELI SEM QR legivel (pelo "anexar imagem"): o Ref. ID lido do texto ja e a busca — e a venda vem com o aviso');

      // ══ 8. a leitura que TERMINA DEPOIS de o estoquista ter seguido adiante NAO mexe na tela (Codex #638) ══
      // Ler a imagem demora. Aqui a leitura fica PENDENTE (modo manual), o estoquista faz outra coisa, e so entao ela
      // termina: nao pode escrever no campo, nem buscar por cima do que ele esta vendo, nem deixar "lendo..." pendurado.
      const zonaSumiu = () => page.evaluate(() => { const z = document.getElementById('zonaColar'); return !z || z.style.display === 'none'; });
      const lendoNoCartao = () => page.evaluate(() => ((document.getElementById('statusRefId') || {}).textContent || ''));
      const campo = () => page.inputValue('#codigo');
      const fotoPeloCartao = async () => {
        await page.setInputFiles('#arquivoRefId', { name: 'etiqueta.png', mimeType: 'image/png', buffer: PNG });
        await page.waitForFunction(() => window.__ocrFila.length === 1, null, { timeout: 8000 });
      };
      const leituraAutomaticaPendente = () => page.waitForFunction(() => window.__ocrFila.length === 1 && /Lendo o Ref\. ID/.test((document.getElementById('statusRefId') || {}).textContent || ''), null, { timeout: 8000 });
      const terminarLeitura = async (i) => { await page.evaluate((k) => window.__ocrFila[k](), i || 0); await page.waitForTimeout(450); };
      const esperarBuscaPresa = async () => { for (let i = 0; i < 400 && !presa.soltar.length; i++) await new Promise((r) => setTimeout(r, 20)); if (!presa.soltar.length) throw new Error('a busca que devia ficar presa nao chegou na rota'); };
      const soltarBusca = async () => { await esperarBuscaPresa(); presa.soltar.shift()(); };
      const OUTRA = '47416667111', NA_MAO = '48126029999';
      acha.add(OUTRA); acha.add(NA_MAO);

      // 8.1 — a foto pedida pelo CARTAO (o caso apontado: ela nao olhava a busca da tela, so "veio outra imagem")
      await page.click('#btnPacoteMeli');
      de = buscados.length; await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrMs: 0, __ocrManual: true, __ocrFila: [] });
      await fotoPeloCartao();
      ok(/Lendo o Ref\. ID/.test(await lendoNoCartao()), '  (enquanto le a foto, o cartao diz que esta lendo)');
      await bipar(OUTRA); await esperarVenda(OUTRA);
      await terminarLeitura();
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([OUTRA]) && (await campo()) === OUTRA && /Produto 47416667111/.test(await resultado()) && (await avisoLido()) === '',
        '⚠️ foto do cartao em leitura + bipou OUTRA caixa: a leitura velha NAO busca por cima — fica a venda da caixa nova, com o codigo dela no campo');
      ok(await zonaSumiu(), '  e a area de leitura some (nao fica prometendo um resultado que nao vem)');
      await page.click('#btnPacoteMeli');
      de = buscados.length; await leitores({ __ocrFila: [] });
      await fotoPeloCartao();
      await page.fill('#inputRefId', NA_MAO); await page.click('#btnBuscarRefId');
      await esperarVenda(NA_MAO);
      await terminarLeitura();
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([NA_MAO]) && (await campo()) === NA_MAO && /Produto 48126029999/.test(await resultado()) && (await avisoLido()) === '',
        '⚠️ foto do cartao em leitura + buscou um Ref. ID NA MAO: vale o que ele digitou — a leitura da foto nao busca por cima');
      await page.click('#btnPacoteMeli');
      de = buscados.length; await leitores({ __ocrFila: [] });
      await fotoPeloCartao();
      await page.click('#btnPacoteMeli');   // o campo de busca nem muda: so a tela (o cartao foi aberto de novo)
      await terminarLeitura();
      ok(buscados.length === de && (await temCartao()) === 1 && (await campo()) === NA_MAO && (await lendoNoCartao()) === '' && await zonaSumiu(),
        '⚠️ foto do cartao em leitura + abriu o cartao DE NOVO (o campo de busca nem muda): a leitura velha e largada — nada e buscado e o cartao fica limpo pra digitar');
      de = buscados.length; await leitores({ __ocrFila: [] });
      await fotoPeloCartao();
      await page.fill('#codigo', 'AB12');   // comecou a digitar outro codigo; ainda nao buscou
      await terminarLeitura();
      ok(buscados.length === de && (await campo()) === 'AB12' && (await temCartao()) === 1 && (await lendoNoCartao()) === '' && await zonaSumiu(),
        '⚠️ foto do cartao em leitura + comecou a DIGITAR outro codigo (sem buscar): a leitura nao apaga o que ele digitou nem busca — e o "lendo..." sai do cartao');
      // com o cartao dizendo "lendo...", chega OUTRA imagem (pelo "anexar") que nao traz nada: o "lendo..." da antiga sai
      de = buscados.length; await leitores({ __ocrFila: [] });
      await page.fill('#codigo', '');
      await fotoPeloCartao();
      await leitores({ __qr: null, __ocr: 'SEM NADA' });
      await soltarFoto();
      await page.waitForFunction(() => window.__ocrFila.length === 2, null, { timeout: 8000 });
      ok((await lendoNoCartao()) === '', '⚠️ foto do cartao em leitura + chegou OUTRA imagem: o "lendo o Ref. ID..." do cartao sai na hora (a leitura dele ja nao vale)');
      await terminarLeitura(0);
      ok(!(await zonaSumiu()), '  a leitura do cartao termina primeiro e e largada: a area de leitura continua na tela (e da imagem nova, que ainda esta sendo lida)');
      await terminarLeitura(1);
      ok(buscados.length === de && (await temCartao()) === 1 && (await lendoNoCartao()) === '' && /não achei código/.test(await page.$eval('#zonaColarStatus', (el) => el.textContent)),
        '  e, terminadas as duas, nada foi buscado: a tela diz que a imagem nova nao trouxe codigo (do Ref. ID da antiga, nada)');

      // 8.2 — a imagem comum (colar / arrastar / "anexar imagem etiqueta"): o mesmo, nas duas etapas dela
      await page.fill('#codigo', '');
      de = buscados.length; await leitores({ __qr: null, __ocr: 'CORREIOS AD123456789BR', __ocrFila: [] });
      await soltarFoto();
      await page.waitForFunction(() => window.__ocrFila.length === 1, null, { timeout: 8000 });
      await bipar(OUTRA); await esperarVenda(OUTRA);
      await terminarLeitura();
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([OUTRA]) && (await campo()) === OUTRA && /Produto 47416667111/.test(await resultado()) && await zonaSumiu(),
        '⚠️ imagem pelo "anexar" com o TEXTO em leitura + bipou outra caixa: o que a leitura achou nao vai pro campo nem pra busca');
      // o CODIGO da imagem ainda sendo lido (o leitor nativo do celular — aqui um duble que fica pendente ate o teste soltar)
      await page.evaluate(() => { window.__detFila = []; window.BarcodeDetector = function () { this.detect = function () { return new Promise(function (r) { window.__detFila.push(function () { r([]); }); }); }; }; });
      de = buscados.length; n0 = await leitores({ __qr: '{"id":"47416667668","t":"l"}', __ocrManual: false, __ocrFila: [] });
      await soltarFoto();
      await page.waitForFunction(() => window.__detFila.length === 1, null, { timeout: 8000 });
      await bipar(NA_MAO); await esperarVenda(NA_MAO);
      await page.evaluate(() => window.__detFila[0]());
      await page.waitForTimeout(450);
      n1 = await leitores();
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([NA_MAO]) && (await campo()) === NA_MAO && /Produto 48126029999/.test(await resultado()) && n1.ocr === n0.ocr && await zonaSumiu(),
        '⚠️ imagem pelo "anexar" com o CODIGO ainda em leitura + bipou outra caixa: o QR da imagem antiga nao vai pra busca (nem gasta a leitura de texto)');
      await page.evaluate(() => { delete window.BarcodeDetector; });

      // 8.3 — a leitura AUTOMATICA (o QR da foto nao achou → le o Ref. ID da mesma foto)
      de = buscados.length; await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrManual: true, __ocrFila: [] });
      await soltarFoto();
      await leituraAutomaticaPendente();
      await page.click('#btnPacoteMeli');   // largou a espera e abriu o cartao pra digitar (o campo continua com o codigo da foto)
      await terminarLeitura();
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([QR]) && (await temCartao()) === 1 && (await page.$$('#resultado .erro-box')).length === 0 && (await lendoNoCartao()) === '' && await zonaSumiu(),
        '⚠️ leitura automatica em andamento + abriu o cartao do pacote MELI: a leitura velha nao busca por cima do cartao');
      // a MESMA busca refeita durante a leitura (apertou Buscar de novo): e a mesma caixa — a leitura serve a busca nova,
      // uma vez so. Sem rotulo no texto → vira PERGUNTA, e a pergunta tem que estar a vista (no cartao novo e na area).
      de = buscados.length; n0 = await leitores({ __qr: QR, __ocr: 'G MELI AO\n48126024340\nXSP16\n48133297953', __ocrFila: [] });
      await soltarFoto();
      await leituraAutomaticaPendente();
      await page.click('#btnBuscar');      // (o clique ja limpa a tela: o cartao que aparecer daqui pra frente e o da busca refeita)
      await leituraAutomaticaPendente();   // o cartao NOVO tambem diz que esta lendo
      await terminarLeitura();
      n1 = await leitores();
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([QR, QR]) && n1.ocr - n0.ocr === 1 && (await page.$$('#zonaColarOpcoes button')).length === 1 && !(await zonaSumiu()) && /não li o rótulo/.test(await lendoNoCartao()),
        '⚠️ leitura automatica em andamento + a MESMA busca refeita: e a mesma caixa — a leitura (uma so) serve a busca nova, com a pergunta a vista');
      await page.click('#zonaColarOpcoes button');
      await esperarVenda(REF);
      ok(buscados[buscados.length - 1] === REF && buscados.length === de + 3, '  tocou no numero: busca e acha');
      // idem, mas a leitura termina ENQUANTO a busca refeita ainda nao voltou: nada e buscado no meio; quando ela volta,
      // usa a leitura que ja esta pronta
      presa.codigo = BARRAS;
      de = buscados.length; n0 = await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrFila: [] });
      await soltarFoto();
      await soltarBusca();                 // a busca do QR volta: 404
      await leituraAutomaticaPendente();
      await page.click('#btnBuscar');      // a mesma busca de novo — e esta fica presa
      await esperarBuscaPresa();
      await terminarLeitura();             // a leitura termina com a busca refeita ainda no ar
      const noMeio = JSON.stringify(buscados.slice(de));
      await soltarBusca();                 // a busca refeita volta: 404 de novo
      await esperarVenda(REF);
      n1 = await leitores();
      ok(noMeio === JSON.stringify([QR, QR]) && JSON.stringify(buscados.slice(de)) === JSON.stringify([QR, QR, REF]) && n1.ocr - n0.ocr === 1 && (await avisoLido()).includes(REF),
        '⚠️ idem com a leitura terminando ANTES de a busca refeita voltar: nada e buscado no meio; quando ela volta (404 de novo), o Ref. ID ja lido e buscado — sem ler a foto outra vez');
      // comecou a digitar outro codigo enquanto a busca da foto ainda nao tinha voltado: a leitura automatica nao apaga
      de = buscados.length; await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrFila: [] });
      await soltarFoto();
      await esperarBuscaPresa();
      await page.fill('#codigo', 'AB34');
      await soltarBusca();
      await page.waitForSelector('#cartaoRefId', { timeout: 8000 });
      await page.waitForFunction(() => window.__ocrFila.length > 0, null, { timeout: 2000 }).catch(() => {});
      if (await page.evaluate(() => window.__ocrFila.length > 0)) await terminarLeitura();
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([QR]) && (await campo()) === 'AB34' && (await lendoNoCartao()) === '' && await zonaSumiu(),
        '⚠️ digitou outro codigo enquanto a busca da foto nao voltava: a leitura automatica nao apaga o que ele digitou nem busca');
      // mandou OUTRA imagem enquanto a busca da primeira nao voltava: quando a primeira falha, a leitura automatica dela
      // nem comeca (a imagem da vez e a nova) — e a nova nao e atropelada por ela
      await page.fill('#codigo', '');
      de = buscados.length; n0 = await leitores({ __qr: QR, __ocr: OCR_REAL, __ocrFila: [] });
      await soltarFoto();
      await esperarBuscaPresa();
      await leitores({ __qr: null, __ocr: 'CORREIOS AD987654321BR' });
      await soltarFoto();
      await page.waitForFunction(() => window.__ocrFila.length === 1, null, { timeout: 8000 });
      await soltarBusca();                 // a busca da primeira volta: 404
      await page.waitForSelector('#cartaoRefId', { timeout: 8000 });
      await page.waitForTimeout(400);
      n1 = await leitores();
      ok(n1.ocr - n0.ocr === 1 && (await lendoNoCartao()) === '', '⚠️ outra imagem chegou enquanto a busca da primeira nao voltava: a leitura automatica da PRIMEIRA nem comeca (uma leitura so: a da nova)');
      await terminarLeitura();
      await page.waitForFunction(() => document.getElementById('codigo').value === 'AD987654321BR', null, { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(300);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([QR, 'AD987654321BR']) && (await campo()) === 'AD987654321BR', '  e a imagem nova vale: o que ela trouxe e buscado');
      presa.codigo = null;
      await leitores({ __qr: null, __ocr: OCR_REAL, __ocrMs: 0, __ocrManual: false, __ocrFila: [] });

      ok(errosJs.length === 0, '  sem erro de JS' + (errosJs.length ? ': ' + errosJs.slice(0, 3).join(' | ') : ''));
      ok(retiroPedidos > 0, '  (a lista do retiro continuou sendo consultada nos "nao encontrado": ' + retiroPedidos + ')');
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
