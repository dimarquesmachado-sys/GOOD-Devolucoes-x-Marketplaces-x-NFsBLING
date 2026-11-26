'use strict';
// b807 (V-22) — DUAS TRIAGENS SEGUIDAS NA MESMA TELA, com o Chromium de verdade e o server.js (3 empresas; a tela de
// triagem — public/js/triagem.js e bipagem.js — e uma so).
//
// O caso (dono, 26/11): "as vezes a gente faz a triagem uma depois da outra, ai a segunda vez fica salvando a inclusao no
// estoque infinito ... ai temos que dar reload, buscar de novo, ai vai."
//
// O que era: o botao de salvar vira "Salvando..." no clique e so voltava ao texto dele quando dava ERRO. Quando dava
// CERTO (ou "ja foi triada"), a janela fechava com o botao ainda escrito "Salvando...". Na triagem seguinte, sem
// recarregar a pagina, a janela abria com esse texto velho: nada estava sendo salvo — a tela esperava o clique e o
// estoquista esperava a tela. Nas janelas de DIVERGENTE e de devolucao PARCIAL era pior: o botao ficava tambem
// DESLIGADO, e a segunda nao tinha como ser registrada sem recarregar.
//
// Aqui, nas 3 empresas, sem recarregar a pagina entre uma e outra:
//   1. incluir no estoque duas vezes seguidas: a 2a janela abre com "Confirmar", libera depois dos bipes e GRAVA;
//   2. depois de um "ja foi triada" (409), a janela seguinte tambem abre com "Confirmar";
//   3. devolucao PARCIAL duas vezes seguidas: o "Sim, Encerrar" da 2a esta ligado e grava;
//   4. produto DIVERGENTE duas vezes seguidas: o "Sim, Registrar" da 2a esta ligado e grava;
//   5. enquanto o servidor ainda nao respondeu, o botao segue "Salvando..." e desligado (um clique = um registro).
//   6. (b808, V-23) a tela se limpa sozinha 2,5 s depois de gravar (2,8 s na parcial e no divergente). Se a busca
//      SEGUINTE chegasse antes disso, a limpeza da triagem anterior apagava o cartao da venda NOVA (medido: busca 0,3 s
//      e 1,5 s depois do sucesso -> cartao sumia). Agora a limpeza so roda se ninguem seguiu adiante: nem outra busca,
//      nem codigo novo sendo digitado. Quem nao seguiu continua com a tela limpa e o cursor no campo, como era.
//
// As rotas de busca e de gravacao sao simuladas no formato que o servidor manda. O passo das FOTOS (camera) fica de
// fora: o teste entra onde a camera entrega (abrirConfirmacaoParcial / abrirConfirmacaoDivergente, chamadas pelo
// finalizarFotos de camera.js).
// Roda com: node test/duas-triagens-seguidas-navegador.test.js     (CAPTURA_BOTAO=<pasta> salva as capturas de tela)
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('FALHA Playwright nao instalado: ' + e.message); process.exit(1); }

const EMPRESAS = [{ nome: 'GOOD', rota: '' }, { nome: 'AMB', rota: '/amb', prefixo: 'AMB_' }, { nome: 'Girassol', rota: '/girassol', prefixo: 'GIRASSOL_' }];
const EAN = '7891234567895';
const CAPTURA = process.env.CAPTURA_BOTAO || '';
const FOTOS = (n) => Array.from({ length: n }, (_, i) => 'https://exemplo.invalid/foto-' + (i + 1) + '.jpg');

// uma venda de 2 unidades, com EAN na NF (o caminho da bipagem)
const venda = (codigo) => ({
  ok: true, encontrado: true, codigo,
  order: { id: '20000' + codigo, date_created: '2026-11-20T08:17:00Z', buyer: { nickname: 'CLIENTE' }, payments: [{ transaction_amount: 20 }],
    order_items: [{ item: { id: 'MLB' + codigo, title: 'Venda ' + codigo, seller_sku: 'KC6' }, quantity: 2, unit_price: 10 }] },
  shipment: { id: codigo, shipping_items: [{ id: 'MLB' + codigo, description: 'Venda ' + codigo, quantity: 2 }] },
  nf: { numero: '9' + codigo.slice(-4), idBling: 123, itens: [{ titulo: 'Venda ' + codigo, sku: 'KC6', ean: EAN, quantidade: 2 }] },
  claim: null, avisos: [], tentativas: [],
});

// Os 5 pontos que limpam a tela por tempo usam a MESMA peca (limparTelaDepoisDeGravar). Tres sao exercitados abaixo; os
// outros dois ("consertei" e problema sem a janela da etiqueta) passam pela camera e nao da pra bipar daqui — entao
// confere-se que nao sobrou limpeza por tempo fora da peca.
{
  const FONTE = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'triagem.js'), 'utf8');
  const chamadas = (FONTE.match(/^\s+limparTelaDepoisDeGravar\(\d+\);/gm) || []).length;
  const escondem = (FONTE.match(/divResultado\.classList\.remove\('show'\)/g) || []).length;
  ok(chamadas === 5 && escondem === 2, '  triagem.js: 5 limpezas por tempo, todas pela mesma peca (' + chamadas + ' chamadas; ' + escondem + ' lugares escondem o cartao: a peca e o fechar da etiqueta)');
}

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
      const page = await ctx.newPage();
      const errosJs = []; page.on('pageerror', (err) => errosJs.push(String((err && err.message) || err)));
      await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());

      const json = (route, status, corpo) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
      await page.route('**/api/devolucao/identificar/**', (route) => {
        const codigo = decodeURIComponent(new URL(route.request().url()).pathname.split('/api/devolucao/identificar/')[1] || '').replace(/\D/g, '');
        return json(route, 200, venda(codigo));
      });
      await page.route('**/api/espreita/retiro**', (route) => json(route, 200, { ok: true, itens: [] }));
      await page.route('**/api/triagem/status/**', (route) => json(route, 200, { ok: true, registros: [] }));
      await page.route('**/api/produto/imagem/**', (route) => json(route, 404, { ok: false }));
      await page.route('**/api/nf/buscar-links-bling/**', (route) => json(route, 200, { ok: false }));
      await page.route('**/api/produto/ean-por-sku/**', (route) => json(route, 200, { encontrado: true, produto: { id: 77, codigo: 'OUTRO-SKU', nome: 'Outro produto', gtin: '7890000000017' } }));

      // ── as rotas que GRAVAM: o teste diz o que respondem e pode segurar a resposta ──
      const grava = { aprovar: [], divergente: [], resposta: null, presa: false, soltar: [] };
      const responder = async (route, lista) => {
        const corpo = JSON.parse(route.request().postData() || '{}');
        lista.push(corpo);
        const r = grava.resposta || { status: 200, corpo: { ok: true, id: lista.length } };   // o que valia quando o pedido CHEGOU
        if (grava.presa) await new Promise((solta) => grava.soltar.push(solta));
        return json(route, r.status, r.corpo);
      };
      await page.route('**/api/triagem/aprovar', (route) => responder(route, grava.aprovar));
      await page.route('**/api/triagem/divergente', (route) => responder(route, grava.divergente));

      await page.goto('http://127.0.0.1:' + s.porta + e.rota + '/', { waitUntil: 'load' });
      await page.fill('#loginUser', 'esto'); await page.fill('#loginPass', 's1');
      await Promise.all([page.waitForResponse((r) => /\/api\/auth\/login/.test(r.url())), page.click('#btnLogin')]);
      await page.waitForSelector('#codigo', { timeout: 8000 });

      const botao = (id) => page.$eval('#' + id, (el) => ({ texto: el.innerText.replace(/\s+/g, ' ').trim(), desligado: el.disabled, gira: !!el.querySelector('.spinner-mini') }));
      const aberta = (id) => page.$eval('#' + id, (el) => el.classList.contains('show'));
      const buscar = async (codigo) => {
        await page.fill('#codigo', codigo); await page.press('#codigo', 'Enter');
        await page.waitForFunction((t) => document.getElementById('resultado').innerText.includes(t), 'Venda ' + codigo, { timeout: 8000 });
        await page.waitForSelector('.triagem-btn-aprovar', { state: 'visible', timeout: 8000 });
      };
      const abrirAprovar = async () => { await page.click('.triagem-btn-aprovar'); await page.waitForFunction(() => document.getElementById('modalAprovar').classList.contains('show'), null, { timeout: 8000 }); };
      const biparProduto = async (vezes) => { for (let i = 0; i < vezes; i++) { await page.fill('#bipagemInput', EAN); await page.press('#bipagemInput', 'Enter'); } };
      // a tela some com o cartao 2,5 s depois do sucesso (2,8 s na parcial e no divergente): a proxima busca vem depois disso
      const telaLimpa = () => page.waitForFunction(() => !document.getElementById('resultado').classList.contains('show'), null, { timeout: 8000 });
      const sucesso = () => page.$eval('#triagemSucesso', (el) => el.innerText).catch(() => '');
      const foto = async (nome) => { if (CAPTURA) await page.screenshot({ path: require('path').join(CAPTURA, nome + '-' + e.nome.toLowerCase() + '.png') }); };

      // ── 1. incluir no estoque, duas vezes seguidas ──
      await buscar('48100000001'); await abrirAprovar();
      let b = await botao('btnConfirmarAprovar');
      ok(/Confirmar/.test(b.texto) && b.desligado && !b.gira, '  1a triagem: a janela abre com "Confirmar", desligado ate bipar (' + JSON.stringify(b) + ')');
      await biparProduto(2);
      b = await botao('btnConfirmarAprovar');
      ok(/Confirmar/.test(b.texto) && !b.desligado, '  bipou as 2 unidades: o botao liga (' + JSON.stringify(b) + ')');
      await page.click('#btnConfirmarAprovar');
      await page.waitForFunction(() => !document.getElementById('modalAprovar').classList.contains('show'), null, { timeout: 8000 });
      ok(grava.aprovar.length === 1 && /Incluido no estoque/.test(await sucesso()), '  gravou 1x e a tela diz "Incluido no estoque" (' + grava.aprovar.length + ')');
      await telaLimpa();

      await buscar('48100000002'); await abrirAprovar();
      b = await botao('btnConfirmarAprovar');
      await foto('2a-triagem-janela-abre');
      ok(/Confirmar/.test(b.texto) && !/Salvando/.test(b.texto) && !b.gira,
        '⚠️ 2a triagem SEGUIDA, sem recarregar: a janela abre com "Confirmar" — nao com o "Salvando..." da anterior (' + JSON.stringify(b) + ')');
      await biparProduto(2);
      b = await botao('btnConfirmarAprovar');
      ok(/Confirmar/.test(b.texto) && !b.gira && !b.desligado, '⚠️ bipou tudo: o botao esta ligado e escrito "Confirmar" (' + JSON.stringify(b) + ')');

      // ── 5. enquanto o servidor nao responde: "Salvando..." e desligado — e so um registro ──
      grava.presa = true;
      await page.click('#btnConfirmarAprovar');
      await page.waitForFunction(() => /Salvando/.test(document.getElementById('btnConfirmarAprovar').innerText), null, { timeout: 8000 });
      b = await botao('btnConfirmarAprovar');
      ok(/Salvando/.test(b.texto) && b.desligado && b.gira && (await aberta('modalAprovar')), '  servidor ainda nao respondeu: "Salvando..." girando e desligado, janela aberta (' + JSON.stringify(b) + ')');
      await page.click('#btnConfirmarAprovar', { force: true }).catch(() => {});   // clique ansioso no botao desligado
      grava.presa = false; grava.soltar.splice(0).forEach((f) => f());
      await page.waitForFunction(() => !document.getElementById('modalAprovar').classList.contains('show'), null, { timeout: 8000 });
      ok(grava.aprovar.length === 2 && grava.aprovar[1].shipment_id === '48100000002',
        '⚠️ a 2a triagem GRAVOU, e uma vez so (' + grava.aprovar.length + ' no total; envio ' + (grava.aprovar[1] || {}).shipment_id + ')');
      await telaLimpa();

      // ── 2. "ja foi triada" (409) tambem fecha a janela: a seguinte abre limpa ──
      grava.resposta = { status: 409, corpo: { ok: false, erro: 'duplicata', mensagem: 'Esta devolucao ja foi triada antes' } };
      await buscar('48100000003'); await abrirAprovar(); await biparProduto(2);
      await page.click('#btnConfirmarAprovar');
      await page.waitForFunction(() => !document.getElementById('modalAprovar').classList.contains('show'), null, { timeout: 8000 });
      grava.resposta = null;
      await buscar('48100000004'); await abrirAprovar();
      b = await botao('btnConfirmarAprovar');
      ok(/Confirmar/.test(b.texto) && !b.gira, '⚠️ depois de um "ja foi triada": a janela seguinte abre com "Confirmar" (' + JSON.stringify(b) + ')');
      await page.evaluate(() => fecharModal('modalAprovar'));

      // ── 3. devolucao PARCIAL, duas vezes seguidas (bipa 1 de 2; entra onde a camera entrega as 6 fotos) ──
      const parcial = async (codigo) => {
        await buscar(codigo); await abrirAprovar(); await biparProduto(1);
        await page.evaluate((fotos) => { fecharModal('modalAprovar'); window._fluxoParcial = true; abrirConfirmacaoParcial(fotos); }, FOTOS(6));
        await page.waitForFunction(() => document.getElementById('modalConfirmacaoParcial').classList.contains('show'), null, { timeout: 8000 });
      };
      const antesParcial = grava.aprovar.length;
      await parcial('48100000005');
      b = await botao('btnEncerrarParcial');
      ok(/Sim, Encerrar/.test(b.texto) && !b.desligado, '  1a parcial: "Sim, Encerrar" ligado (' + JSON.stringify(b) + ')');
      await page.click('#btnEncerrarParcial');
      await page.waitForFunction(() => !document.getElementById('modalConfirmacaoParcial').classList.contains('show'), null, { timeout: 8000 });
      ok(grava.aprovar.length === antesParcial + 1 && grava.aprovar[antesParcial].eh_parcial === true, '  gravou a parcial (' + (grava.aprovar.length - antesParcial) + ')');
      await telaLimpa();
      await parcial('48100000006');
      b = await botao('btnEncerrarParcial');
      await foto('2a-parcial-confirmacao');
      ok(/Sim, Encerrar/.test(b.texto) && !b.desligado && !b.gira, '⚠️ 2a PARCIAL seguida: "Sim, Encerrar" ligado — nao "Enviando..." desligado (' + JSON.stringify(b) + ')');
      await page.click('#btnEncerrarParcial', { timeout: 3000 }).catch(() => {});
      await page.waitForFunction(() => !document.getElementById('modalConfirmacaoParcial').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
      ok(grava.aprovar.length === antesParcial + 2 && (grava.aprovar[antesParcial + 1] || {}).shipment_id === '48100000006', '⚠️ a 2a parcial GRAVOU (' + (grava.aprovar.length - antesParcial) + ' de 2)');
      await page.evaluate(() => fecharModal('modalConfirmacaoParcial'));
      await telaLimpa().catch(() => {});

      // ── 4. produto DIVERGENTE, duas vezes seguidas (entra onde a camera entrega as 3 fotos) ──
      const divergente = async (codigo) => {
        await buscar(codigo);
        await page.click('.triagem-btn-divergente');
        await page.waitForFunction(() => document.getElementById('modalDivergente').classList.contains('show'), null, { timeout: 8000 });
        await page.fill('#divergenteEAN', '7890000000017'); await page.press('#divergenteEAN', 'Enter');
        await page.waitForFunction(() => !document.getElementById('btnContinuarDivergente').disabled, null, { timeout: 8000 });
        await page.evaluate((fotos) => { fecharModal('modalDivergente'); window._fluxoDivergente = true; abrirConfirmacaoDivergente(fotos); }, FOTOS(3));
        await page.waitForFunction(() => document.getElementById('modalConfirmacaoDivergente').classList.contains('show'), null, { timeout: 8000 });
      };
      await divergente('48100000007');
      b = await botao('btnEncerrarDivergente');
      ok(/Sim, Registrar/.test(b.texto) && !b.desligado, '  1o divergente: "Sim, Registrar" ligado (' + JSON.stringify(b) + ')');
      await page.click('#btnEncerrarDivergente');
      await page.waitForFunction(() => !document.getElementById('modalConfirmacaoDivergente').classList.contains('show'), null, { timeout: 8000 });
      ok(grava.divergente.length === 1 && grava.divergente[0].produto_correto_sku === 'OUTRO-SKU', '  gravou o divergente (' + grava.divergente.length + ')');
      await telaLimpa();
      await divergente('48100000008');
      b = await botao('btnEncerrarDivergente');
      await foto('2o-divergente-confirmacao');
      ok(/Sim, Registrar/.test(b.texto) && !b.desligado && !b.gira, '⚠️ 2o DIVERGENTE seguido: "Sim, Registrar" ligado — nao "Salvando..." desligado (' + JSON.stringify(b) + ')');
      await page.click('#btnEncerrarDivergente', { timeout: 3000 }).catch(() => {});
      await page.waitForFunction(() => !document.getElementById('modalConfirmacaoDivergente').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
      ok(grava.divergente.length === 2 && (grava.divergente[1] || {}).shipment_id === '48100000008', '⚠️ o 2o divergente GRAVOU (' + grava.divergente.length + ' de 2)');

      // ── 6. b808 (V-23): a limpeza da tela depois de gravar nao apaga o cartao de quem ja seguiu adiante ──
      await telaLimpa().catch(() => {});
      const tela = (codigo) => page.evaluate((txt) => ({ visivel: document.getElementById('resultado').classList.contains('show'), temVenda: document.getElementById('resultado').innerText.includes(txt),
        campo: document.getElementById('codigo').value, foco: (document.activeElement || {}).id || '' }), 'Venda ' + codigo);
      const gravarAprovar = async (codigo) => {
        await buscar(codigo); await abrirAprovar(); await biparProduto(2);
        await page.click('#btnConfirmarAprovar');
        await page.waitForFunction(() => !document.getElementById('modalAprovar').classList.contains('show'), null, { timeout: 8000 });
      };
      // (a) ninguem seguiu adiante: a tela se limpa e o cursor volta pro campo (como era)
      await gravarAprovar('48100000011');
      await page.waitForTimeout(3300);
      let st = await tela('48100000011');
      ok(!st.visivel && st.campo === '' && st.foco === 'codigo', '  gravou e ficou parado: 3,3 s depois a tela esta limpa, o campo vazio e o cursor nele (' + JSON.stringify(st) + ')');
      // (b) a busca seguinte chega ANTES da limpeza da anterior: o cartao da venda nova fica
      await gravarAprovar('48100000012');
      await buscar('48100000013');
      await page.waitForTimeout(3300);
      st = await tela('48100000013');
      await foto('busca-seguinte-rapida');
      ok(st.visivel && st.temVenda && st.campo === '48100000013', '⚠️ bipou a PROXIMA logo depois de gravar: 3,3 s depois o cartao dela continua na tela (' + JSON.stringify(st) + ')');
      // (c) ... e a triagem dela segue normal (a janela abre, bipa, grava)
      const antes6 = grava.aprovar.length;
      await abrirAprovar(); await biparProduto(2); await page.click('#btnConfirmarAprovar');
      await page.waitForFunction(() => !document.getElementById('modalAprovar').classList.contains('show'), null, { timeout: 8000 });
      ok(grava.aprovar.length === antes6 + 1 && grava.aprovar[antes6].shipment_id === '48100000013', '  e a triagem dela grava (' + (grava.aprovar[antes6] || {}).shipment_id + ')');
      await telaLimpa();
      // (d) comecou a DIGITAR o proximo codigo (sem Enter ainda): a limpeza nao apaga o que ele digitou
      await gravarAprovar('48100000014');
      await page.fill('#codigo', '4810');
      await page.waitForTimeout(3300);
      st = await tela('48100000014');
      ok(st.campo === '4810', '⚠️ digitando o proximo codigo logo depois de gravar: 3,3 s depois o que digitou continua no campo (' + JSON.stringify(st) + ')');
      // (e) bipou o MESMO pacote de novo (o codigo no campo nao muda — so a busca e nova): o cartao fica
      await page.fill('#codigo', '');
      await gravarAprovar('48100000019');
      await buscar('48100000019'); await page.waitForTimeout(3300);
      st = await tela('48100000019');
      ok(st.visivel && st.temVenda && !/Incluido no estoque/.test(await sucesso()), '⚠️ bipou o MESMO codigo de novo logo depois de gravar: o cartao novo fica (' + JSON.stringify(st) + ')');
      // (f) o mesmo vale pra parcial e pro divergente (2,8 s)
      await parcial('48100000015'); await page.click('#btnEncerrarParcial');
      await page.waitForFunction(() => !document.getElementById('modalConfirmacaoParcial').classList.contains('show'), null, { timeout: 8000 });
      await buscar('48100000016'); await page.waitForTimeout(3600);
      st = await tela('48100000016');
      ok(st.visivel && st.temVenda, '⚠️ PARCIAL gravada e a proxima bipada em seguida: o cartao dela fica (' + JSON.stringify(st) + ')');
      await divergente('48100000017'); await page.click('#btnEncerrarDivergente');
      await page.waitForFunction(() => !document.getElementById('modalConfirmacaoDivergente').classList.contains('show'), null, { timeout: 8000 });
      await buscar('48100000018'); await page.waitForTimeout(3600);
      st = await tela('48100000018');
      ok(st.visivel && st.temVenda, '⚠️ DIVERGENTE gravado e a proxima bipada em seguida: o cartao dela fica (' + JSON.stringify(st) + ')');

      ok(errosJs.length === 0, '  nenhum erro de JavaScript na pagina' + (errosJs.length ? ' — ' + errosJs.join(' | ') : ''));
      await ctx.close();
    }
  } catch (err) {
    falhas++; console.log('FALHA ' + (err && err.stack || err));
  } finally {
    if (navegador) await navegador.close().catch(() => {});
    s.matar();
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
