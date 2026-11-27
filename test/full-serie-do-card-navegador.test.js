'use strict';
// O CARD DO FULL NO PAINEL: fala a serie e o canal DELE (b809, V-24) e, no Full da SHOPEE, deixa GERAR a NF de
// devolucao (b810, V-25). Painel de verdade no Chromium, com o server.js (3 empresas;
// o painel da fabrica, em amb-devolucoes/public-AMB, e um so, e a GOOD recebe ele montado pelo lib/painel-unico).
// Este teste nao le o fonte do painel: abre a pagina que o servidor entrega.
//
// V-24 (dono, 27/11, AMB): venda do Full da SHOPEE (NF serie 5) em "Aprovadas - aguardando NF". O aviso do card dizia
// "FULL · SERIE 5 — a NF de devolucao e do SHOPEE", mas o botao 🏬 FULL abria o EMISSOR DO MERCADO LIVRE com o numero
// do pedido da Shopee e o "Achar devolucao no Bling" se apresentava como "serie 2 que o ML emitiu". Os textos tinham
// nascido quando so existia o Full do Mercado Livre e ficaram cravados nele.
//
// V-25 (mesmo dia): "so sei que nao consegui gerar a NF. Ou achar a que ja foi gerada." Medido no servico da Shopee
// (sonda dos tipos do Full, ambtotal-shopee-nf-sync-x-bling): de 01/08 a 27/11 a Shopee nao tem NENHUMA nota de
// devolucao nem de entrada do Full da AMB — e o controle (venda do Full de junho, antes de a AMB entrar no Full)
// responde igual. No Full da Shopee a nota de devolucao nao e do marketplace: quem gera e a empresa. O "nao gere NF"
// (regra do Full do ML, onde o ML emite) escondia o Gerar NF e mandava "importar o XML" de uma nota que nao existe.
//
// Aqui, nas 3 empresas, com a lista de cards simulada no formato que o servidor manda:
//   1. Full da Shopee, nas 3 secoes: TEM o Gerar NF (abre o modal da venda certa), nao tem Achar nem link do ML,
//      o aviso diz que a Shopee nao emite, e o lote nao pula o card;
//   2. Full da Shopee com a NF ja ligada: mostra a nota e NAO oferece "Lancar no estoque" (o estoque entrou pela nota);
//   3. Full do ML: tudo como era — sem Gerar NF, com Achar e o link do emissor, lote pula, estoque depois da NF;
//   4. outros canais (Magalu, desconhecido): como eram — sem Gerar NF, o Achar diz a serie e o canal do card;
//   5. achou a NF: o aviso de sucesso nao diz "ML"; lote e "Lancar por NF" falam do Full de qualquer canal.
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
const shopee = (id, extra) => card(id, Object.assign({ marketplace: 'shopee', order_id: '260805TESTE0' + id, nf_serie: '5', nf_chave: chave(5, id) }, extra));
const magalu = (id, serie, extra) => card(id, Object.assign({ marketplace: 'magalu', order_id: 'LU-' + id, nf_serie: String(serie), nf_chave: chave(serie, id) }, extra));
const LISTA = {
  ok: true,
  aprovadas: [
    shopee(501),
    card(502, { marketplace: 'ml', order_id: PEDIDO_ML, nf_serie: '2', nf_chave: chave(2, 502) }),
    card(505, { marketplace: '', order_id: 'ABC-505', nf_serie: '7', nf_chave: chave(7, 505) }),
    card(506, { marketplace: '', order_id: '2000099999999906', nf_serie: '2', nf_chave: chave(2, 506) }),
    card(507, { marketplace: 'ml', order_id: '2000011111111907', nf_serie: '1', nf_chave: chave(1, 507) }),   // serie 1: nao e Full
    magalu(508, 3),
    shopee(509, { nf_devolucao_id_bling: '777509', nf_devolucao_numero: '888' }),                            // Shopee, NF ja ligada
    card(510, { marketplace: 'ml', order_id: '2000022222222910', nf_serie: '2', nf_chave: chave(2, 510), nf_devolucao_id_bling: '777510', nf_devolucao_numero: '999' }),   // ML, NF ja ligada
  ],
  problemas: [
    shopee(503, { tipo: 'problema', status: 'problema', nf_serie: '', problema_descricao: 'veio amassado' }),   // serie so pela chave
    magalu(511, 4, { tipo: 'problema', status: 'problema', problema_descricao: 'veio riscado' }),
    shopee(513, { tipo: 'problema', status: 'problema', problema_descricao: 'veio quebrado', nf_devolucao_id_bling: '777513', nf_devolucao_numero: '813' }),   // Shopee, NF ja ligada
  ],
  divergentes: [
    magalu(504, 3, { tipo: 'divergente', status: 'divergente', problema_descricao: 'produto trocado' }),
    shopee(512, { tipo: 'divergente', status: 'divergente', problema_descricao: 'veio outro produto' }),
    shopee(514, { tipo: 'divergente', status: 'divergente', problema_descricao: 'veio outra cor', nf_devolucao_id_bling: '777514', nf_devolucao_numero: '814' }),   // Shopee, NF ja ligada
  ],
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
      const urlPainel = 'http://127.0.0.1:' + s.porta + e.painel;
      // espera a rede sossegar: o painel redesenha a lista quando as cargas de fundo chegam, e um redesenho no meio
      // desmarcaria a caixinha que o teste acabou de marcar
      const abrirPainel = async () => { await page.goto(urlPainel, { waitUntil: 'networkidle' }); await page.waitForSelector('#card-501', { timeout: 10000 }); };
      const marcar = async (...ids) => { for (const id of ids) await page.check('#card-' + id + ' .chk-esteira'); for (const id of ids) if (!(await page.isChecked('#card-' + id + ' .chk-esteira'))) throw new Error('a caixinha do card ' + id + ' desmarcou sozinha'); };

      // entra como admin (o painel e so do admin) e abre o painel da empresa
      await page.goto('http://127.0.0.1:' + s.porta + e.rota + '/', { waitUntil: 'load' });
      await page.fill('#loginUser', 'dono'); await page.fill('#loginPass', 's2');
      await Promise.all([page.waitForResponse((r) => /\/api\/auth\/login/.test(r.url())), page.click('#btnLogin')]);
      await page.waitForSelector('#codigo', { timeout: 8000 });
      await abrirPainel();

      const doCard = (id) => page.$eval('#card-' + id, (el) => {
        const a = el.querySelector('a[href*="mercadolivre.com.br/emissor"]');
        const b = el.querySelector('button[onclick*="fullVincular"]');
        const g = el.querySelector('button[onclick^="abrirModalGerarDevolucao("]');
        const chk = el.querySelector('.chk-esteira');
        const dev = el.querySelector('a[href*="notas.entrada.php#edit/"]');
        return {
          emissor: a ? a.getAttribute('href') : null, tituloEmissor: a ? a.getAttribute('title') : null, achar: b ? b.getAttribute('title') : null,
          gerar: g ? g.textContent.trim() : null, gerarChamada: g ? g.getAttribute('onclick') : null,
          estoqueDoFull: !!el.querySelector('button[onclick^="abrirModalFullEstoque("]'), devolucao: dev ? dev.textContent.trim() : null,
          loteFull: chk ? chk.dataset.full : null, texto: el.innerText.replace(/\s+/g, ' '),
        };
      });

      // 1) V-25 — Full da SHOPEE nas 3 secoes: gera a NF como qualquer devolucao
      for (const [id, secao, temLote] of [[501, 'aprovadas', true], [503, 'problemas (serie so na chave)', true], [512, 'divergentes', false]]) {
        const c = await doCard(id);
        ok(/Gerar NF/.test(c.gerar || '') && String(c.gerarChamada).startsWith("abrirModalGerarDevolucao('" + id + "', '9" + id + "', '000" + id + "'"), '⚠️ V-25 ' + secao + ': Full da Shopee TEM o "Gerar NF", da venda certa (' + (c.gerar || 'sem botao') + ')');
        ok(c.achar === null && c.emissor === null, '⚠️ V-25 ' + secao + ': sem "Achar devolucao no Bling" (nao ha nota da Shopee pra achar) e sem link do emissor do ML');
        ok(/FULL · SÉRIE 5/.test(c.texto) && /a Shopee não emite/.test(c.texto) && !/não gere NF|importe o XML/.test(c.texto), '⚠️ V-25 ' + secao + ': o aviso diz que a Shopee nao emite e manda gerar (dizia "nao gere NF ... importe o XML")');
        if (temLote) ok(c.loteFull === '0', '⚠️ V-25 ' + secao + ': o lote NAO trata o card como "Full a pular" (data-full=' + c.loteFull + ')');
      }
      // 2) V-25 — Shopee com a NF ja ligada: mostra a nota e nao oferece "Lancar no estoque"
      for (const [id, secao, numero] of [[509, 'aprovadas', '888'], [513, 'problemas', '813'], [514, 'divergentes', '814']]) {
        const shNf = await doCard(id);
        ok((shNf.devolucao || '').includes('Devolução: ' + numero) && shNf.estoqueDoFull === false && shNf.gerar === null && shNf.achar === null && !/lançar no estoque|Não gere NF/i.test(shNf.texto) && /a Shopee não emite/.test(shNf.texto), '⚠️ V-25 ' + secao + ', Shopee com NF ligada: mostra a nota e NAO oferece "Lancar no estoque" (o estoque entrou pela nota): ' + (shNf.devolucao || 'sem link'));
      }
      // 3) Full do Mercado Livre: tudo como era
      const ml = await doCard(502);
      ok(ml.emissor === 'https://www.mercadolivre.com.br/emissor/vendas/' + PEDIDO_ML + '/faturas' && /série 2/.test(ml.tituloEmissor) && /Mercado Livre/.test(ml.tituloEmissor), '⚠️ Full do ML: o 🏬 FULL segue abrindo o emissor do ML com o pedido certo (' + ml.emissor + ')');
      ok(!!ml.achar && ml.achar.includes('série 2') && ml.achar.includes('Mercado Livre'), '  Full do ML: o "Achar" diz serie 2 / Mercado Livre: ' + ml.achar);
      ok(ml.gerar === null && ml.loteFull === '1' && /não gere NF/.test(ml.texto), '⚠️ V-25 Full do ML: continua SEM "Gerar NF", com o "nao gere NF", e o lote pula o card');
      const mlNf = await doCard(510);
      ok(/Devolução: 999/.test(mlNf.devolucao || '') && mlNf.estoqueDoFull === true && /lançar no estoque/i.test(mlNf.texto), '⚠️ V-25 Full do ML com NF ligada: continua oferecendo "Lancar no estoque"');
      // 4) outros canais: como eram — sem Gerar NF; o Achar diz a serie e o canal do card (V-24), nas 3 secoes
      for (const [id, secao, serie] of [[508, 'aprovadas', '3'], [511, 'problemas', '4'], [504, 'divergentes', '3']]) {
        const c = await doCard(id);
        ok(c.emissor === null, '⚠️ ' + secao + ': Full do Magalu NAO tem link pro emissor do Mercado Livre (' + (c.emissor || 'sem link') + ')');
        ok(!!c.achar && c.achar.includes('série ' + serie) && c.achar.includes('Magalu') && !/série 2|\bML\b|Mercado Livre/.test(c.achar), '⚠️ ' + secao + ': o "Achar" diz serie ' + serie + ' / Magalu (dizia "serie 2 que o ML emitiu"): ' + c.achar);
        ok(c.gerar === null && /FULL · SÉRIE /.test(c.texto) && /não gere NF/.test(c.texto), '  ' + secao + ': Magalu continua sem "Gerar NF" e com o aviso do Full (canal nao medido: fica como estava)');
      }
      const desc = await doCard(505);
      ok(desc.emissor === null && !!desc.achar && desc.achar.includes('série 7') && desc.achar.includes('o próprio marketplace') && !/Mercado Livre|\bML\b/.test(desc.achar) && desc.gerar === null, '  canal desconhecido (serie 7): sem link do ML, sem afirmar emissor e sem "Gerar NF": ' + desc.achar);
      const mlPeloNumero = await doCard(506);
      ok(/\/emissor\/vendas\/2000099999999906\/faturas$/.test(mlPeloNumero.emissor || ''), '  venda do ML reconhecida so pelo numero do pedido: com o link do emissor');
      const matriz = await doCard(507);
      ok(matriz.emissor === null && matriz.achar === null && /Gerar NF/.test(matriz.gerar || '') && matriz.loteFull === '0', '  serie 1 (matriz): nada de Full — segue com o "Gerar NF"');
      if (CAPTURA) { await page.locator('#card-501').scrollIntoViewIfNeeded(); await page.screenshot({ path: require('path').join(CAPTURA, 'v25-' + e.nome.toLowerCase() + '-aprovadas.png') }); }

      // 1b) V-25 — o Gerar NF do card da Shopee ABRE o modal, com a NF de venda dele
      await page.click('#card-501 button[onclick^="abrirModalGerarDevolucao("]');
      await page.waitForFunction(() => { const m = document.getElementById('modalGerarConteudo'); return !!m && /NF original/.test(m.innerText); }, null, { timeout: 8000 });
      const modal = await page.$eval('#modalGerarConteudo', (el) => el.innerText.replace(/\s+/g, ' '));
      ok(/Gerar NF Devolução/.test(modal) && /NF original: 000501/.test(modal) && /Depósito do estoque/.test(modal), '⚠️ V-25: o "Gerar NF" do card da Shopee abre o modal da NF 000501, com o deposito do estoque');
      if (CAPTURA) await page.screenshot({ path: require('path').join(CAPTURA, 'v25-' + e.nome.toLowerCase() + '-modal.png') });
      await abrirPainel();

      // 5) achou (num canal que tem nota do marketplace): o aviso de sucesso nao diz "ML"
      achar.resposta = { status: 200, corpo: { ok: true, nf_devolucao_numero: '777', nf_devolucao_id_bling: 'MG1' } };
      await page.click('#card-508 button[onclick*="fullVincular"]');
      await page.waitForFunction(() => /vinculada ao card/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
      const aviso = await page.$eval('#toast', (el) => el.textContent);
      ok(/nº 777 vinculada ao card/.test(aviso) && !/\bML\b/.test(aviso) && achar.pedidos.some((p) => p.endsWith(e.rota + '/api/admin/full-vincular/508')), '⚠️ achou a NF num card do Magalu: "' + aviso + '" (dizia "Devolução ML nº ...")');
      await page.waitForSelector('#card-501', { timeout: 10000 });   // a lista recarrega depois do sucesso
      await abrirPainel();

      // 5a) lote so com Full do ML: o motivo nao e "ML" cravado
      await marcar(502);
      await page.click('#btnEsteiraAprovadas');
      await page.waitForFunction(() => /card FULL selecionado/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
      const soFull = await page.$eval('#toast', (el) => el.textContent);
      ok(/emitida pelo próprio marketplace/.test(soFull) && !/\bML\b/.test(soFull), '⚠️ lote so com Full (do ML): "' + soFull + '"');
      // 5b) lote com um Full do ML e um da matriz: a linha dos pulados, na janela de confirmacao
      await page.evaluate(() => { window.verificarBridgeInstalada = async () => true; });   // a extensao do Bling nao existe no teste
      const fecharJanela = () => page.evaluate(() => { const j = document.getElementById('janelaPainel'); if (j && j._resolver) j._resolver(false); if (j) j.remove(); });   // desiste: nada e emitido
      const linhasDaJanela = async () => { await page.waitForSelector('#janelaPainelTexto', { timeout: 8000 }); return (await page.$eval('#janelaPainelTexto', (el) => el.textContent)).split('\n'); };
      await marcar(502, 507);
      await page.click('#btnEsteiraAprovadas');
      let linhas = await linhasDaJanela();
      const doFull = linhas.find((l) => /FULL/.test(l)) || '';
      ok(/1 card\(s\) FULL serão pulados \(NF de devolução é emitida pelo próprio marketplace\)/.test(doFull) && !/\bML\b/.test(doFull) && /de 1 card\(s\)\?/.test(linhas[0]), '⚠️ lote misto (ML Full + matriz): "' + (doFull || '(sem a linha do Full)') + '" — e 1 card na fila');
      await fecharJanela();
      // 5d) V-25 — lote so com o Full da SHOPEE: entra na fila como qualquer devolucao (antes: "so tem card FULL")
      await page.uncheck('#card-502 .chk-esteira'); await page.uncheck('#card-507 .chk-esteira');
      await marcar(501);
      await page.click('#btnEsteiraAprovadas');
      linhas = await linhasDaJanela();
      ok(/de 1 card\(s\)\?/.test(linhas[0]) && !linhas.some((l) => /FULL serão pulados/.test(l)), '⚠️ V-25 lote so com o Full da Shopee: o card ENTRA na fila (' + String(linhas[0]).slice(0, 80) + ')');
      await fecharJanela();

      // 5c) "Lancar por NF": a guarda e de QUALQUER serie de Full
      let pergunta = null;
      page.once('dialog', (d) => { pergunta = d.message(); d.dismiss().catch(() => {}); });
      await page.click('#btnLancarNF');
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
