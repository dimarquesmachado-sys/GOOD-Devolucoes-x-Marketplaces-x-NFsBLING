'use strict';
// b796 (V-13) — A LISTA DAS VENDAS NAO ENTREGUES NO CARTAO "PACOTE MELI", com o Chromium de verdade e o server.js
// (3 empresas; public/js/busca.js e colar-imagem.js sao um so).
//
// O caso (AMB, 21/11): a etiqueta de volta do ML de venda NAO ENTREGUE so acha a venda pelo "Ref. ID" impresso
// (48126024340), que e o numero do envio da venda. O servidor lista as vendas nao entregues com esse numero
// (lib/pacote-meli-nao-entregues.js, test/pacote-meli-nao-entregues.test.js). Aqui, a tela:
//   1. botao "📦 pacote MELI": a lista (das ainda nao triadas) vem ABERTA — Ref. ID, produto, dia da venda e pedido;
//      tocar numa linha busca por aquele Ref. ID;
//   2. digitar o FIM do Ref. ID encurta a lista (a etiqueta imprime o fim em negrito); a ja triada aparece marcada;
//      numero que nao esta na lista: a tela diz, e o Buscar continua valendo;
//   3. o cartao que aparece SOZINHO (o ML disse 404 pro codigo bipado): a lista vem FECHADA — a lista do RETIRO do Full
//      vem logo abaixo e nao pode ser empurrada pra fora da tela; abre no toque ou ao digitar;
//   4. a lista NAO VEIO (ML fora, rede): a tela DIZ — nao mostra "nenhuma venda"; o campo do Ref. ID funciona igual;
//   5. nenhuma esperando / lista cortada / triagens nao conferidas: cada caso com a frase dele;
//   6. o que vem do servidor entra como TEXTO (titulo com HTML nao vira HTML; Ref. ID que nao e numero nao vira linha);
//   7. a lista que chega DEPOIS de o estoquista seguir pra outra busca nao entra na tela dele;
//   8. FOTO: o numero lido e CONFERIDO com a lista — um (e so um) dos numeros lidos e o envio de uma venda nao entregue?
//      busca por ele sem perguntar (numero partido pelo leitor, rotulo nao lido, dois numeros na foto). Nenhum ou mais
//      de um na lista, ou lista que nao veio: tudo como antes (pergunta). E quem seguiu adiante nao e atropelado.
//
// O leitor de QR e o de texto vem de fora (CDN): aqui sao dubles que devolvem o que o teste manda. As rotas de busca e
// da lista sao simuladas no formato que o servidor manda.
// Roda com: node test/pacote-meli-lista-navegador.test.js     (CAPTURA_LISTA=<pasta> salva as capturas de tela)
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('FALHA Playwright nao instalado: ' + e.message); process.exit(1); }

const EMPRESAS = [{ nome: 'GOOD', rota: '' }, { nome: 'AMB', rota: '/amb', prefixo: 'AMB_' }, { nome: 'Girassol', rota: '/girassol', prefixo: 'GIRASSOL_' }];
const BARRAS = '48133297953', REF = '48126024340';
const QR = '{"id":"' + BARRAS + '","t":"lm"}';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CAPTURA = process.env.CAPTURA_LISTA || '';

const linha = (ref, n, extra) => Object.assign({ ref_id: ref, pedidos: ['20000190000000' + String(n).padStart(2, '0')], pack_id: null, data: '2026-10-' + String(n).padStart(2, '0'),
  produtos: [{ titulo: 'Produto ' + n, sku: 'SKU' + n, qtd: 1 }], ja_triado: false }, extra || {});
// a venda do caso real, como a rota devolve
const REAL = { ref_id: REF, pedidos: ['2000018696282248'], pack_id: null, data: '2026-09-29', produtos: [{ titulo: '2 Cavaletes 6t 6000kg 13 Níveis Apoios Suportes Oficina Auto', sku: 'CAV6T', qtd: 1 }], ja_triado: false };
const TRIADA = linha('48349640577', 26, { ja_triado: true });
const LISTA = [linha('48445471734', 6), linha('48414606123', 3), REAL, TRIADA];

const venda = (codigo) => ({
  ok: true, encontrado: true, codigo,
  order: { id: '2000018696282248', date_created: '2026-09-29T08:17:00Z', buyer: { nickname: 'CLIENTE' }, payments: [{ transaction_amount: 10 }],
    order_items: [{ item: { id: 'MLB1', title: 'Venda ' + codigo, seller_sku: 'KC6' }, quantity: 2, unit_price: 10 }] },
  shipment: { id: codigo, shipping_items: [{ id: 'MLB1', description: 'Venda ' + codigo, quantity: 2 }] },
  nf: { numero: '777', itens: [{ titulo: 'Venda ' + codigo, sku: 'KC6', ean: '-', quantidade: 2 }] },
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
      await ctx.addInitScript(() => {
        window.__qr = null; window.__ocr = ''; window.__ocrManual = false; window.__ocrFila = [];
        try { delete window.BarcodeDetector; } catch (err) { /* no Linux nem existe */ }
        window.jsQR = function () { return window.__qr ? { data: window.__qr } : null; };
        window.Tesseract = { createWorker: async function () {
          return {
            setParameters: async function () {},
            recognize: async function () {
              const texto = window.__ocr;
              if (window.__ocrManual) await new Promise((r) => window.__ocrFila.push(r));   // a leitura fica PENDENTE ate o teste soltar
              return { data: { text: texto } };
            },
            terminate: async function () {},
          };
        } };
      });
      const page = await ctx.newPage();
      const errosJs = []; page.on('pageerror', (err) => errosJs.push(String((err && err.message) || err)));
      await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());

      const buscados = []; const acha = new Set([REF, '47416667999']); let retiroItens = [];
      await page.route('**/api/devolucao/identificar/**', async (route) => {
        const codigo = decodeURIComponent(new URL(route.request().url()).pathname.split('/api/devolucao/identificar/')[1] || '');
        buscados.push(codigo);
        const doQr = (codigo.match(/"id"\s*:\s*"(\d+)"/) || [])[1];
        const limpo = doQr || codigo.replace(/\D/g, '');
        if (acha.has(limpo)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(venda(limpo)) });
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({
          ok: false, encontrado: false, codigo_buscado: codigo, codigo_limpo: limpo, avisos: [], erro: 'Codigo nao encontrado em shipments/packs do ML nem nas devolucoes Shopee.',
          tentativas: [{ tipo: 'shipment_id', codigo: limpo, ok: false, status: 404 }],
        }) });
      });
      await page.route('**/api/espreita/retiro**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, itens: retiroItens }) }));
      await page.route('**/api/triagem/status/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, registros: [] }) }));
      await page.route('**/api/produto/imagem/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) }));

      // ── a rota da lista: o teste diz o que ela responde; `idade_s` leva o numero do pedido (pra esperar a resposta certa) ──
      const ne = { status: 200, corpo: null, cai: false, pedidos: 0, presa: false, soltar: [] };
      const comLista = (itens, extra) => { ne.status = 200; ne.cai = false; ne.corpo = Object.assign({ ok: true, itens, total_no_ml: itens.length, cortada: false, triagem_conferida: true }, extra || {}); };
      const comFalha = (status, erro) => { ne.status = status; ne.cai = false; ne.corpo = { ok: false, erro }; };
      await page.route('**/api/pacote-meli/nao-entregues**', async (route) => {
        const n = ++ne.pedidos;
        const r = { status: ne.status, corpo: ne.corpo, cai: ne.cai };   // o que valia quando o pedido CHEGOU
        if (ne.presa) await new Promise((solta) => ne.soltar.push(solta));
        if (r.cai) return route.abort();
        return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.corpo.ok ? Object.assign({}, r.corpo, { idade_s: n }) : r.corpo) });
      });
      comLista(LISTA);

      await page.goto('http://127.0.0.1:' + s.porta + e.rota + '/', { waitUntil: 'load' });
      await page.fill('#loginUser', 'esto'); await page.fill('#loginPass', 's1');
      await Promise.all([page.waitForResponse((r) => /\/api\/auth\/login/.test(r.url())), page.click('#btnLogin')]);
      await page.waitForSelector('#btnPacoteMeli', { timeout: 8000 });

      // espera a resposta do PROXIMO pedido da lista chegar na tela (a lista, ou o aviso de que nao veio)
      const depoisDaLista = async (acao) => {
        const n = ne.pedidos + 1;
        // o aviso de falha de um cartao ANTERIOR (ainda na tela ate a acao trocar o cartao) nao pode passar por resposta deste pedido
        await page.evaluate(() => { const f = document.getElementById('naoEntreguesFalhou'); if (f) f.id = 'naoEntreguesFalhouDeAntes'; });
        await acao();
        await page.waitForFunction((k) => (typeof _naoEntregues !== 'undefined' && _naoEntregues && _naoEntregues.idade_s === k) || !!document.getElementById('naoEntreguesFalhou'), n, { timeout: 8000 });
      };
      const abrirCartao = () => depoisDaLista(() => page.click('#btnPacoteMeli'));
      const bipar = async (codigo) => { await page.fill('#codigo', codigo); await page.press('#codigo', 'Enter'); };
      const linhas = () => page.$$eval('#listaNaoEntregues [data-ref-id]', (els) => els.map((el) => ({ ref: el.getAttribute('data-ref-id'), txt: el.innerText, fundo: el.style.background })));
      const texto = async (sel) => ((await page.$$(sel)).length ? page.$eval(sel, (el) => el.innerText) : '');
      const resultado = () => page.$eval('#resultado', (el) => el.innerText);
      const esperarVenda = (codigo) => page.waitForFunction((t) => document.getElementById('resultado').innerText.includes(t), 'Venda ' + codigo, { timeout: 8000 });
      const digitarNoCartao = async (v) => { await page.fill('#inputRefId', v); };
      const captura = async (nome) => { if (CAPTURA) await page.screenshot({ path: require('path').join(CAPTURA, e.nome + '-' + nome + '.png'), fullPage: true }); };

      // ══ 1. botao "pacote MELI": a lista ABERTA; tocar busca ══
      ne.presa = true; ne.soltar = [];
      await page.click('#btnPacoteMeli');
      for (let i = 0; i < 100 && ne.pedidos === 0; i++) await page.waitForTimeout(20);
      ok(/Carregando as vendas não entregues/.test(await texto('#listaNaoEntregues')) && (await page.$$('#inputRefId')).length === 1, '  a lista ainda nao chegou: o cartao ja esta na tela (da pra digitar) e diz "Carregando as vendas não entregues…"');
      ne.presa = false; ne.soltar.splice(0).forEach((f) => f());
      await page.waitForFunction(() => typeof _naoEntregues !== 'undefined' && !!_naoEntregues, null, { timeout: 8000 });
      let ls = await linhas();
      ok(ls.map((l) => l.ref).join() === '48445471734,48414606123,' + REF, '⚠️ botao "pacote MELI": a lista vem aberta, com as 3 vendas que esperam triagem, na ordem do servidor (a ja triada NAO aparece) — ' + ls.map((l) => l.ref).join());
      ok(/ainda não triadas \(3\)/.test(await texto('#naoEntreguesTitulo')), '  o titulo diz quantas faltam triar — ' + (await texto('#naoEntreguesTitulo')).slice(0, 70));
      const real = ls.find((l) => l.ref === REF) || { txt: '' };
      ok(real.txt.includes(REF) && /2 Cavaletes 6t/.test(real.txt) && /SKU CAV6T/.test(real.txt) && /venda de 29\/09/.test(real.txt) && /Pedido 2000018696282248/.test(real.txt),
        '⚠️ a linha do caso real: Ref. ID, produto, SKU, dia da venda e pedido — ' + real.txt.replace(/\n/g, ' | '));
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '  no celular (412 px) a lista nao estoura a largura da tela');
      await captura('1-lista-aberta');
      let de = buscados.length;
      await page.click('#listaNaoEntregues [data-ref-id="' + REF + '"]');
      await esperarVenda(REF);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([REF]) && (await page.$$('#avisoRefIdLido')).length === 0, '⚠️ tocar na linha busca por aquele Ref. ID e a venda aparece (uma busca; sem o aviso de "lido da foto" — foi tocado)');

      // ══ 2. digitar o fim do Ref. ID encurta a lista ══
      await abrirCartao();
      await digitarNoCartao('4340');
      ls = await linhas();
      ok(ls.length === 1 && ls[0].ref === REF && /“4340”/.test(await texto('#naoEntreguesTitulo')), '⚠️ digitou o FIM do Ref. ID ("4340"): sobra so a venda dele — ' + ls.map((l) => l.ref).join());
      await captura('2-filtrada');
      await digitarNoCartao('0577');
      ls = await linhas();
      ok(ls.length === 1 && ls[0].ref === '48349640577' && /já triada/.test(ls[0].txt) && ls[0].fundo !== (real.fundo || 'x'), '⚠️ o numero digitado e de uma venda JA TRIADA: ela aparece, marcada "já triada" (em vez de "nao achei")');
      await digitarNoCartao('999999');
      ok((await linhas()).length === 0 && /Nenhuma venda não entregue com “999999”/.test(await texto('#naoEntreguesTitulo')) && /Buscar procura do mesmo jeito/.test(await texto('#naoEntreguesTitulo')),
        '⚠️ numero que nao esta na lista: a tela diz, e avisa que o Buscar procura do mesmo jeito');
      await digitarNoCartao('');
      ok((await linhas()).length === 3, '  apagou: voltam as 3 que esperam');
      de = buscados.length;
      await digitarNoCartao(REF); await page.press('#inputRefId', 'Enter');
      await esperarVenda(REF);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([REF]), '  o Ref. ID inteiro + Enter continua buscando, como antes');

      // ══ 3. o cartao que aparece sozinho (404): a lista vem FECHADA, com a do retiro logo abaixo ══
      retiroItens = [{ pedido: '2000018239001602', produtos: [{ titulo: 'Peca do retiro', sku: 'X', qtd: 1 }] }];
      await depoisDaLista(() => bipar(BARRAS));
      await page.waitForSelector('[data-retiro-pedido]', { timeout: 8000 });
      const geo = await page.evaluate(() => {
        const b = document.getElementById('btnVerNaoEntregues'); const c = document.getElementById('cartaoRefId'); const r = document.querySelector('[data-retiro-pedido]');
        return { botao: b ? b.innerText : '', altura: document.getElementById('listaNaoEntregues').getBoundingClientRect().height, fimDoCartao: c.getBoundingClientRect().bottom, retiro: r.getBoundingClientRect().top };
      });
      ok((await linhas()).length === 0 && /Ver as vendas não entregues ainda não triadas \(3\)/.test(geo.botao), '⚠️ bipou e o ML disse 404: o cartao aparece com a lista FECHADA (uma linha: "' + geo.botao.trim() + '")');
      ok(geo.altura < 70 && geo.retiro > geo.fimDoCartao && geo.retiro - geo.fimDoCartao < 120, '⚠️ e a lista do RETIRO do Full fica logo abaixo do cartao — nao e empurrada por 30 vendas (lista fechada: ' + Math.round(geo.altura) + ' px; retiro a ' + Math.round(geo.retiro - geo.fimDoCartao) + ' px do cartao)');
      await captura('3-fechada-com-retiro');
      await page.click('#btnVerNaoEntregues');
      ok((await linhas()).length === 3, '  tocou na linha: abre');
      await depoisDaLista(() => bipar(BARRAS));
      ok((await linhas()).length === 0 && (await page.$$('#btnVerNaoEntregues')).length === 1, '  outro bipe que nao acha: vem fechada de novo (nao herda o "aberta" da tela anterior)');
      await digitarNoCartao('4340');
      ok((await linhas()).map((l) => l.ref).join() === REF, '⚠️ fechada, mas digitou o fim do Ref. ID: a venda aparece');
      comLista([REAL, TRIADA]);
      await depoisDaLista(() => bipar(BARRAS));
      ok(/^📋 Ver a venda não entregue ainda não triada \(1\)$/.test((await texto('#btnVerNaoEntregues')).trim()), '  fechada, com UMA venda sem triar: a linha vem no singular');
      comLista(LISTA);
      retiroItens = [];

      // ══ 4. a lista NAO VEIO: a tela diz (nao e "nenhuma venda") ══
      comFalha(502, 'a busca das vendas não entregues falhou (o Mercado Livre respondeu HTTP 429)');
      await abrirCartao();
      let aviso = await texto('#naoEntreguesFalhou');
      ok(/Não consegui carregar a lista/.test(aviso) && /HTTP 429/.test(aviso) && /funciona do mesmo jeito/.test(aviso) && (await linhas()).length === 0 && (await page.$$('#naoEntreguesTitulo')).length === 0,
        '⚠️ o servidor nao conseguiu a lista (502): a tela DIZ que nao veio, com o motivo — nao mostra "nenhuma venda" nem a lista de antes — ' + aviso.slice(0, 110));
      await captura('4-nao-veio');
      await digitarNoCartao('4340');
      ok((await linhas()).length === 0 && /Não consegui carregar/.test(await texto('#naoEntreguesFalhou')), '  e digitar no campo nao ressuscita a lista de antes');
      de = buscados.length;
      await digitarNoCartao(REF); await page.click('#btnBuscarRefId');
      await esperarVenda(REF);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([REF]), '⚠️ sem a lista, o Ref. ID digitado acha a venda do mesmo jeito');
      comFalha(502, '<b onclick="x">pane</b>');
      await abrirCartao();
      ok((await page.$$('#naoEntreguesFalhou b')).length === 0 && /<b onclick/.test(await texto('#naoEntreguesFalhou')), '  o motivo que vem do servidor entra como TEXTO');
      ne.cai = true;
      await abrirCartao();
      ok(/Não consegui carregar a lista/.test(await texto('#naoEntreguesFalhou')), '  sem resposta nenhuma (a rede caiu): o mesmo aviso');

      // ══ 5. nenhuma esperando / cortada / triagens nao conferidas ══
      comLista([TRIADA, linha('48346581206', 25, { ja_triado: true })]);
      await abrirCartao();
      ok(/^As 2 vendas não entregues que o Mercado Livre lista já foram triadas\.$/.test((await texto('#naoEntreguesTitulo')).trim()) && (await linhas()).length === 0, '⚠️ todas ja triadas: diz isso, com quantas o ML lista');
      comLista([TRIADA]);
      await abrirCartao();
      ok(/^A única venda não entregue que o Mercado Livre lista já foi triada\.$/.test((await texto('#naoEntreguesTitulo')).trim()), '  uma so, ja triada: no singular');
      comLista([]);
      await abrirCartao();
      ok(/^O Mercado Livre não lista nenhuma venda não entregue desta conta\.$/.test((await texto('#naoEntreguesTitulo')).trim()), '  lista vazia de verdade: "O Mercado Livre não lista nenhuma venda não entregue desta conta."');
      const muitas = Array.from({ length: 200 }, (_, i) => linha(String(48200000000 + i), (i % 28) + 1));
      comLista(muitas, { total_no_ml: 500, cortada: true, triagem_conferida: false });
      await abrirCartao();
      const notas = await texto('#naoEntreguesNotas');
      ok((await linhas()).length === 30 && /e mais 170/.test(notas), '⚠️ 200 vendas: 30 na tela e "… e mais 170 — digite o fim do Ref. ID"');
      ok(/tem 500 vendas não entregues; aqui estão as 200 mais recentes/.test(notas) && /continua sendo achada pelo Ref\. ID digitado/.test(notas), '⚠️ lista cortada pelo servidor: a tela diz que o ML tem 500 e ali estao as 200 mais recentes');
      ok(/Não consegui conferir quais já foram triadas/.test(notas), '⚠️ triagens nao conferidas (banco fora): a tela avisa que a lista pode trazer venda ja triada');
      await digitarNoCartao('00000199');
      ok((await linhas()).map((l) => l.ref).join() === '48200000199', '  e a venda que esta alem das 30 aparece ao digitar o fim do numero');

      // ══ 6. o que vem do servidor entra como texto ══
      comLista([Object.assign({}, REAL, { produtos: [{ titulo: '<img src=x onerror="window.__xss=1">', sku: '"><i id=furo>', qtd: '<u>2</u>' }], pedidos: ['<s>1</s>'] }),
        { ref_id: '48126"onclick="window.__xss=2', pedidos: ['1'], produtos: [], ja_triado: false }, null]);
      await abrirCartao();
      await page.waitForTimeout(150);
      ls = await linhas();
      ok(ls.length === 1 && ls[0].ref === REF && ls[0].txt.includes('<img src=x') && await page.evaluate(() => !window.__xss && !document.querySelector('#listaNaoEntregues img, #listaNaoEntregues i#furo, #listaNaoEntregues u, #listaNaoEntregues s')),
        '⚠️ titulo/SKU/quantidade/pedido com HTML aparecem como texto; Ref. ID que nao e numero (e linha nula) nao vira linha');
      comLista(LISTA);

      // ══ 7. a lista que chega DEPOIS de ele seguir adiante ══
      await abrirCartao();   // a tela ja tem a lista (3 vendas) de um cartao anterior
      ne.presa = true; ne.soltar = [];
      const antes = ne.pedidos;
      await page.click('#btnPacoteMeli');
      for (let i = 0; i < 100 && ne.pedidos === antes; i++) await page.waitForTimeout(20);
      ok((await linhas()).length === 3 && ne.soltar.length === 1, '⚠️ cartao aberto de novo: a lista de antes aparece NA HORA, enquanto a nova ainda nao chegou (sem piscar "carregando" a cada cartao)');
      await bipar('47416667999'); await esperarVenda('47416667999');
      ne.presa = false; ne.soltar.splice(0).forEach((f) => f());
      await page.waitForTimeout(300);
      ok(ne.pedidos === antes + 1 && /Venda 47416667999/.test(await resultado()) && (await page.$$('#listaNaoEntregues')).length === 0, '⚠️ a lista chegou depois de ele bipar outra caixa: a venda da caixa nova fica na tela, sem lista por cima');
      // pedido ANTIGO respondendo depois do novo nao troca o que o novo trouxe
      ne.presa = true; ne.soltar = [];
      comLista([linha('48111111111', 1)]);
      const antesDoA = ne.pedidos;
      await page.click('#btnPacoteMeli');                       // pedido A (preso): responderia 1 venda
      for (let i = 0; i < 100 && ne.pedidos === antesDoA; i++) await page.waitForTimeout(20);   // o A chegou na rota
      ne.presa = false; comLista(LISTA);
      await depoisDaLista(() => page.click('#btnPacoteMeli'));   // pedido B: 3 vendas, responde ja
      ne.soltar.splice(0).forEach((f) => f());                   // agora o A responde
      await page.waitForTimeout(300);
      ok((await linhas()).length === 3, '⚠️ a resposta de um pedido ANTIGO da lista, chegando depois, nao troca a lista do pedido mais novo');

      // ══ 8. FOTO: o numero lido e conferido com a lista ══
      const fotoPeloCartao = async (ocr) => {
        await page.evaluate((t) => { window.__ocr = t; window.__ocrManual = true; window.__ocrFila = []; }, ocr);
        const [escolha] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), page.click('#btnFotoRefId')]);   // o botao de foto do cartao
        await escolha.setFiles({ name: 'etiqueta.png', mimeType: 'image/png', buffer: PNG });
        await page.waitForFunction(() => window.__ocrFila.length === 1, null, { timeout: 8000 });
      };
      const terminarLeitura = async () => { await page.evaluate(() => window.__ocrFila[0]()); await page.waitForTimeout(350); };
      const opcoes = () => page.$$eval('#zonaColarOpcoes button', (els) => els.map((el) => el.innerText.trim()));

      // 8a. numero PARTIDO pelo leitor: so uma das leituras e uma venda nao entregue
      await abrirCartao();
      de = buscados.length;
      await fotoPeloCartao('G MELI AO\nREF. ID: 4812602434 0\nXSP16');
      await terminarLeitura();
      await esperarVenda(REF);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([REF]) && (await texto('#avisoRefIdLido')).includes(REF),
        '⚠️ numero lido em pedacos ("4812602434 0" — duas leituras possiveis): a de 11 digitos e o envio de uma venda nao entregue → busca por ELA sem perguntar; a venda vem com o aviso do numero lido');
      // 8b. o mesmo texto, mas nenhuma das leituras esta na lista: pergunta (como antes)
      comLista([linha('48445471734', 6)]);
      await abrirCartao();
      de = buscados.length;
      await fotoPeloCartao('G MELI AO\nREF. ID: 4812602434 0\nXSP16');
      await terminarLeitura();
      ok(buscados.length === de && (await opcoes()).length === 2 && /talvez não inteiro|mais de um número/.test(await texto('#statusRefId')), '⚠️ nenhuma das leituras esta na lista: PERGUNTA, como antes (' + (await opcoes()).length + ' opcoes; nada buscado)');
      // 8c. dois numeros na foto, sem rotulo: um deles e uma venda nao entregue
      comLista(LISTA);
      await abrirCartao();
      de = buscados.length;
      await fotoPeloCartao('G MELI AO\n48126024340\n48133297958\nXSP16');
      await terminarLeitura();
      await esperarVenda(REF);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([REF]), '⚠️ dois numeros na foto e nenhum rotulo: o que e envio de uma venda nao entregue e buscado sem perguntar (antes: perguntava)');
      // 8d. dois numeros e os DOIS estao na lista: pergunta
      await abrirCartao();
      de = buscados.length;
      await fotoPeloCartao('G MELI AO\n48126024340\n48445471734\nXSP16');
      await terminarLeitura();
      ok(buscados.length === de && (await opcoes()).length === 2, '⚠️ dois numeros e os DOIS sao vendas nao entregues: a lista nao decide — pergunta');
      // 8e. a venda ja triada tambem confere (o numero e de um envio de verdade; a busca avisa que ja foi triado)
      acha.add('48349640577');
      await abrirCartao();
      de = buscados.length;
      await fotoPeloCartao('G MELI AO\n48349640577\n48133297958\nXSP16');
      await terminarLeitura();
      await esperarVenda('48349640577');
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify(['48349640577']), '  o numero de uma venda JA TRIADA tambem confere (a busca e quem avisa que ja foi triada)');
      // 8f. a lista NAO veio: tudo como antes
      comFalha(502, 'fora');
      await abrirCartao();
      de = buscados.length;
      await fotoPeloCartao('G MELI AO\n48126024340\n48133297958\nXSP16');
      await terminarLeitura();
      ok(buscados.length === de && (await opcoes()).length === 2, '⚠️ a lista nao veio: dois numeros sem rotulo viram PERGUNTA, como antes (a conferencia so soma, nunca tira)');
      comLista(LISTA);
      // 8g. tentativa AUTOMATICA (QR que nao acha): numero sem rotulo — antes perguntava; conferido com a lista, busca
      await page.evaluate((q) => { window.__qr = q; window.__ocr = 'G MELI AO\n48126024340\nXSP16'; window.__ocrManual = true; window.__ocrFila = []; }, QR);
      de = buscados.length;
      await depoisDaLista(() => page.evaluate((b64) => {
        const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const dt = new DataTransfer(); dt.items.add(new File([u8], 'etiqueta.png', { type: 'image/png' }));
        document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, PNG.toString('base64')));
      await page.waitForFunction(() => window.__ocrFila.length === 1, null, { timeout: 8000 });
      await terminarLeitura();
      await esperarVenda(REF);
      ok(JSON.stringify(buscados.slice(de)) === JSON.stringify([QR, REF]), '⚠️ foto comum (o QR nao acha) e o Ref. ID lido SEM rotulo: como e o envio de uma venda nao entregue, busca sozinho (antes: "nao li o rotulo", pergunta) — ' + JSON.stringify(buscados.slice(de)));
      await page.evaluate(() => { window.__qr = null; });
      // 8h. quem seguiu adiante nao e atropelado, mesmo quando o numero confere
      await abrirCartao();
      de = buscados.length;
      await fotoPeloCartao('G MELI AO\nREF. ID: 4812602434 0\nXSP16');
      await page.fill('#inputRefId', '48');   // comecou a digitar enquanto a foto era lida
      await terminarLeitura();
      ok(buscados.length === de && (await page.$eval('#inputRefId', (el) => el.value)) === '48' && (await page.$$('#cartaoRefId')).length === 1,
        '⚠️ ele comecou a digitar enquanto a foto era lida: a leitura, mesmo conferindo com a lista, NAO busca por cima (regra da b790/b791)');
      await page.evaluate(() => { window.__ocrManual = false; window.__ocrFila = []; });

      ok(errosJs.length === 0, '  nenhum erro de JavaScript na pagina' + (errosJs.length ? ' — ' + errosJs.slice(0, 3).join(' | ') : ''));
      await ctx.close();
    }
  } catch (e) {
    ok(false, 'excecao: ' + ((e && e.stack) || e));
  } finally {
    if (navegador) await navegador.close().catch(() => {});
    s.matar();
  }
  console.log(falhas === 0 ? '\n=== todos passaram' : '\n=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
