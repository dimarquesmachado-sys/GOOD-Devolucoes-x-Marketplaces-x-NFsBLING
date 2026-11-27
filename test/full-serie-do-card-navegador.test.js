'use strict';
// b809 (V-24) — O CARD DO FULL FALA A SERIE E O CANAL DELE. Painel de verdade no Chromium, com o server.js (3 empresas;
// o painel da fabrica, em amb-devolucoes/public-AMB, e um so, e a GOOD recebe ele montado pelo lib/painel-unico).
// Este teste nao le o fonte do painel: abre a pagina que o servidor entrega.
//
// O caso (dono, 27/11, AMB): venda do Full da SHOPEE (NF serie 5) em "Aprovadas - aguardando NF". O aviso do card dizia
// certo — "FULL · SERIE 5 — a NF de devolucao e do SHOPEE" — mas, no mesmo card:
//   - o botao 🏬 FULL abria o EMISSOR DO MERCADO LIVRE com o numero do pedido da Shopee (nao leva a nada);
//   - o "Achar devolucao no Bling" se apresentava como "serie 2 que o ML emitiu";
//   - e a resposta dele vinha "Nenhuma NF de entrada serie 2 ..." (essa parte e do servidor: test/full-achar-devolucao).
// "Olha o problema: serie 2, serie 5..." — a busca procurava a serie certa; os TEXTOS e que nasceram quando so existia
// o Full do Mercado Livre e ficaram cravados nele.
//
// Aqui, nas 3 empresas, com a lista de cards simulada no formato que o servidor manda:
//   1. Full da Shopee (serie 5), nas 3 secoes do painel: SEM link pro emissor do ML; o "Achar" diz serie 5 / Shopee;
//   2. Full do ML (serie 2): o link do emissor continua la, com o pedido certo, e o "Achar" diz serie 2 / Mercado Livre;
//   3. canal desconhecido: sem link e sem afirmar emissor; venda do ML reconhecida so pelo numero do pedido: com link;
//   4. achou a NF: o aviso de sucesso nao diz "ML";
//   5. lote ("Emitir selecionadas") e "Lancar por NF": o texto fala do Full de qualquer canal, nao "ML"/"serie 2".
// Roda com: node test/full-serie-do-card-navegador.test.js     (CAPTURA_FULL=<pasta> salva as capturas de tela)
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('FALHA Playwright nao instalado: ' + e.message); process.exit(1); }

const EMPRESAS = [
  { nome: 'GOOD', rota: '', painel: '/painel-devolucoes.html' },
  { nome: 'AMB', rota: '/amb', painel: '/amb/painel', prefixo: 'AMB_' },
  { nome: 'Girassol', rota: '/girassol', painel: '/girassol/painel', prefixo: 'GIRASSOL_' },
];
const CAPTURA = process.env.CAPTURA_FULL || '';
// chave de acesso de mentira: so a serie (posicoes 23 a 25) importa aqui
const chave = (serie, n) => '3526082754845600014755' + String(serie).padStart(3, '0') + String(n).padStart(9, '0') + '1158076413';
const card = (id, extra) => Object.assign({
  id, tipo: 'aprovado', status: 'aprovado', criado_em: '2026-11-26T13:41:00Z', usuario: 'Fulana', bipagem_ok: true,
  produto_titulo: 'Luminaria de teste ' + id, produto_sku: 'LUM1', produto_qtd: 1, produto_valor_unit: 99.9,
  nf_numero: '000' + id, nf_id_bling: '9' + id, buyer_nome: 'Carla Souza Prado', shipment_id: 'BR' + id, fotos: [],
}, extra);
const PEDIDO_ML = '2000012345678901';
const LISTA = {
  ok: true,
  aprovadas: [
    card(501, { marketplace: 'shopee', order_id: '260805TESTE0501', nf_serie: '5', nf_chave: chave(5, 501) }),
    card(502, { marketplace: 'ml', order_id: PEDIDO_ML, nf_serie: '2', nf_chave: chave(2, 502) }),
    card(505, { marketplace: '', order_id: 'ABC-505', nf_serie: '7', nf_chave: chave(7, 505) }),
    card(506, { marketplace: '', order_id: '2000099999999906', nf_serie: '2', nf_chave: chave(2, 506) }),
    card(507, { marketplace: 'ml', order_id: '2000011111111907', nf_serie: '1', nf_chave: chave(1, 507) }),   // serie 1: nao e Full
  ],
  problemas: [card(503, { tipo: 'problema', status: 'problema', marketplace: 'shopee', order_id: '260805TESTE0503', nf_serie: '', nf_chave: chave(5, 503), problema_descricao: 'veio amassado' })],   // serie so pela chave
  divergentes: [card(504, { tipo: 'divergente', status: 'divergente', marketplace: 'magalu', order_id: 'LU-504', nf_serie: '3', nf_chave: chave(3, 504), problema_descricao: 'produto trocado' })],
};

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
      const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: CAPTURA ? 2 : 1 });
      const page = await ctx.newPage();
      const errosJs = []; page.on('pageerror', (err) => errosJs.push(String((err && err.message) || err)));
      await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
      const json = (route, status, corpo) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
      await page.route('**/api/admin/devolucoes', (route) => json(route, 200, LISTA));
      const achar = { pedidos: [], resposta: { status: 404, corpo: { ok: false, erro: 'nao achei' } } };
      await page.route('**/api/admin/full-vincular/**', (route) => { achar.pedidos.push(new URL(route.request().url()).pathname); return json(route, achar.resposta.status, achar.resposta.corpo); });

      // entra como admin (o painel e so do admin) e abre o painel da empresa
      await page.goto('http://127.0.0.1:' + s.porta + e.rota + '/', { waitUntil: 'load' });
      await page.fill('#loginUser', 'dono'); await page.fill('#loginPass', 's2');
      await Promise.all([page.waitForResponse((r) => /\/api\/auth\/login/.test(r.url())), page.click('#btnLogin')]);
      await page.waitForSelector('#codigo', { timeout: 8000 });
      await page.goto('http://127.0.0.1:' + s.porta + e.painel, { waitUntil: 'load' });
      await page.waitForSelector('#card-501', { timeout: 10000 });

      const doCard = (id) => page.$eval('#card-' + id, (el) => {
        const a = el.querySelector('a[href*="mercadolivre.com.br/emissor"]');
        const b = el.querySelector('button[onclick*="fullVincular"]');
        return { emissor: a ? a.getAttribute('href') : null, tituloEmissor: a ? a.getAttribute('title') : null, achar: b ? b.getAttribute('title') : null, gerar: /Gerar NF/.test(el.innerText), texto: el.innerText.replace(/\s+/g, ' ') };
      });

      // 1) Full da Shopee (serie 5) nas 3 secoes; Magalu (serie 3) no divergente
      for (const [id, secao, serie, canal] of [[501, 'aprovadas', '5', 'Shopee'], [503, 'problemas (serie so na chave)', '5', 'Shopee'], [504, 'divergentes', '3', 'Magalu']]) {
        const c = await doCard(id);
        ok(c.emissor === null, '⚠️ ' + secao + ': Full da ' + canal + ' NAO tem link pro emissor do Mercado Livre (' + (c.emissor || 'sem link') + ')');
        ok(!!c.achar && c.achar.includes('série ' + serie) && c.achar.includes(canal) && !/série 2|\bML\b|Mercado Livre/.test(c.achar), '⚠️ ' + secao + ': o "Achar" diz serie ' + serie + ' / ' + canal + ' (dizia "serie 2 que o ML emitiu"): ' + c.achar);
        ok(!c.gerar && /FULL · SÉRIE /.test(c.texto), '  ' + secao + ': continua sem "Gerar NF" e com o aviso do Full no card');
      }
      // 2) Full do Mercado Livre: o link do emissor continua, com o pedido dele
      const ml = await doCard(502);
      ok(ml.emissor === 'https://www.mercadolivre.com.br/emissor/vendas/' + PEDIDO_ML + '/faturas' && /série 2/.test(ml.tituloEmissor) && /Mercado Livre/.test(ml.tituloEmissor), '⚠️ Full do ML: o 🏬 FULL segue abrindo o emissor do ML com o pedido certo (' + ml.emissor + ')');
      ok(!!ml.achar && ml.achar.includes('série 2') && ml.achar.includes('Mercado Livre'), '  Full do ML: o "Achar" diz serie 2 / Mercado Livre: ' + ml.achar);
      // 3) canal desconhecido nao afirma emissor; venda do ML reconhecida pelo numero do pedido tem o link
      const desc = await doCard(505);
      ok(desc.emissor === null && !!desc.achar && desc.achar.includes('série 7') && desc.achar.includes('o próprio marketplace') && !/Mercado Livre|\bML\b/.test(desc.achar), '  canal desconhecido (serie 7): sem link do ML e sem afirmar emissor: ' + desc.achar);
      const mlPeloNumero = await doCard(506);
      ok(/\/emissor\/vendas\/2000099999999906\/faturas$/.test(mlPeloNumero.emissor || ''), '  venda do ML reconhecida so pelo numero do pedido: com o link do emissor');
      const matriz = await doCard(507);
      ok(matriz.emissor === null && matriz.achar === null && matriz.gerar, '  serie 1 (matriz): nada de Full — segue com o "Gerar NF"');
      if (CAPTURA) { await page.locator('#card-501').scrollIntoViewIfNeeded(); await page.screenshot({ path: require('path').join(CAPTURA, 'v24-' + e.nome.toLowerCase() + '-aprovadas.png') }); }

      // 4) achou: o aviso de sucesso nao diz "ML"
      achar.resposta = { status: 200, corpo: { ok: true, nf_devolucao_numero: '777', nf_devolucao_id_bling: 'SH1' } };
      await page.click('#card-501 button[onclick*="fullVincular"]');
      await page.waitForFunction(() => /vinculada ao card/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
      const aviso = await page.$eval('#toast', (el) => el.textContent);
      ok(/nº 777 vinculada ao card/.test(aviso) && !/\bML\b/.test(aviso) && achar.pedidos.some((p) => p.endsWith(e.rota + '/api/admin/full-vincular/501')), '⚠️ achou a NF num card da Shopee: "' + aviso + '" (dizia "Devolução ML nº ...")');
      await page.waitForSelector('#card-501', { timeout: 10000 });   // a lista recarrega depois do sucesso

      // 5a) lote so com Full: o motivo nao e "ML"
      await page.check('#card-501 .chk-esteira');
      await page.click('#btnEsteiraAprovadas');
      await page.waitForFunction(() => /card FULL selecionado/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
      const soFull = await page.$eval('#toast', (el) => el.textContent);
      ok(/emitida pelo próprio marketplace/.test(soFull) && !/\bML\b/.test(soFull), '⚠️ lote so com Full da Shopee: "' + soFull + '"');
      // 5b) lote com um Full e um da matriz: a linha dos pulados, na janela de confirmacao
      await page.evaluate(() => { window.verificarBridgeInstalada = async () => true; });   // a extensao do Bling nao existe no teste
      await page.check('#card-507 .chk-esteira');
      await page.click('#btnEsteiraAprovadas');
      await page.waitForSelector('#janelaPainelTexto', { timeout: 8000 });
      const confirma = await page.$eval('#janelaPainelTexto', (el) => el.textContent);
      ok(/1 card\(s\) FULL serão pulados \(NF de devolução é emitida pelo próprio marketplace\)/.test(confirma) && !/\bML\b/.test(confirma.split('\n').find((l) => /FULL/.test(l)) || ''), '⚠️ lote misto: "' + (confirma.split('\n').find((l) => /FULL/.test(l)) || '(sem a linha do Full)') + '"');
      await page.evaluate(() => { const j = document.getElementById('janelaPainel'); if (j && j._resolver) j._resolver(false); if (j) j.remove(); });   // desiste: nada e emitido

      // 5c) "Lancar por NF": a guarda e de QUALQUER serie de Full
      let pergunta = null;
      page.once('dialog', (d) => { pergunta = d.message(); d.dismiss().catch(() => {}); });
      await page.click('#btnLancarNF');
      await page.waitForFunction(() => true, null, { timeout: 2000 });
      for (let i = 0; i < 20 && pergunta === null; i++) await page.waitForTimeout(100);
      ok(!!pergunta && /NF do FULL \(série diferente de 1\) é recusada/.test(pergunta) && !/série 2/.test(pergunta), '  "Lançar por NF": a guarda fala do Full de qualquer serie: ' + String(pergunta || '').split('\n').pop());

      ok(errosJs.length === 0, '  nenhum erro de JavaScript na tela' + (errosJs.length ? ': ' + errosJs.join(' | ').slice(0, 300) : ''));
      await ctx.close();
    }
  } catch (err) {
    ok(false, 'excecao no teste: ' + ((err && err.stack) || err).toString().slice(0, 600));
  } finally {
    if (navegador) await navegador.close().catch(() => {});
    s.matar();
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
