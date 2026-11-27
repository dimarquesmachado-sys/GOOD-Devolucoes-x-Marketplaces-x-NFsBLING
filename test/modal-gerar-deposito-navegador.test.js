'use strict';
// A FRASE DO DEPOSITO NO MODAL "GERAR NF DEVOLUCAO" DIZ O QUE A CAIXINHA MARCOU (b811, V-26).
// Painel de verdade no Chromium, com o server.js, nas 3 empresas (o painel da fabrica e um so; a GOOD recebe ele
// montado pelo lib/painel-unico). Este teste nao le o fonte do painel: abre a pagina que o servidor entrega.
//
// Dono, 27/11 (AMB): abriu o "Gerar NF" num card de "Aprovadas - aguardando NF" e o modal dizia
// "padrao: DEFEITOS — troque se o produto estiver bom". Em Aprovadas a caixinha abre no GERAL (b287, 19/08: o padrao
// segue a fila). A frase era fixa: nasceu na b260, quando o modal abria SEMPRE no DEFEITOS, e ficou pra tras quando o
// padrao passou a seguir a fila. Quem le a frase e nao olha a caixinha acha que o estoque vai pro DEFEITOS e ele entra
// no GERAL.
//
// Aqui, com a lista de cards e a de depositos simuladas no formato que o servidor manda:
//   1. card aprovado (matriz e Full da Shopee): caixinha no GERAL e a frase diz GERAL — nada de "DEFEITOS";
//   2. problema, divergente e aprovado com o deposito sugerido "defeito": caixinha no DEFEITOS e a frase diz DEFEITOS;
//   3. em TODO caso, o nome do deposito na frase e o da opcao marcada (inclusive com o nome da GOOD, "DEFEITOS API");
//   4. empresa sem deposito de DEFEITOS: o problema cai no GERAL — a frase diz GERAL, nao promete DEFEITOS;
//   5. enquanto a lista carrega, e quando ela nao vem, a frase nao afirma padrao nenhum;
//   6. a lista de um modal que ja fechou, chegando atrasada, nao escreve a frase dele no modal que esta aberto.
// Roda com: node test/modal-gerar-deposito-navegador.test.js     (CAPTURA_MODAL=<pasta> salva as capturas de tela)
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('FALHA Playwright nao instalado: ' + e.message); process.exit(1); }

const EMPRESAS = [
  { nome: 'GOOD', rota: '', painel: '/painel-devolucoes.html', defeitos: 'DEFEITOS API' },
  { nome: 'AMB', rota: '/amb', painel: '/amb/painel', prefixo: 'AMB_', defeitos: 'DEFEITOS' },
  { nome: 'Girassol', rota: '/girassol', painel: '/girassol/painel', prefixo: 'GIRASSOL_', defeitos: 'Defeito' },
];
const CAPTURA = process.env.CAPTURA_MODAL || '';
// chave de acesso de mentira: so a serie (posicoes 23 a 25) importa aqui
const chave = (serie, n) => '3526082754845600014755' + String(serie).padStart(3, '0') + String(n).padStart(9, '0') + '1158076413';
const card = (id, extra) => Object.assign({
  id, tipo: 'aprovado', status: 'aprovado', criado_em: '2026-11-26T13:41:00Z', usuario: 'Fulana', bipagem_ok: true,
  produto_titulo: 'Luminaria de teste ' + id, produto_sku: 'LUM1', produto_qtd: 1, produto_valor_unit: 99.9,
  marketplace: 'ml', order_id: '20000111111' + id, nf_numero: '000' + id, nf_id_bling: '9' + id, nf_serie: '1', nf_chave: chave(1, id),
  buyer_nome: 'Carla Souza Prado', shipment_id: 'BR' + id, fotos: [],
}, extra);
const LISTA = {
  ok: true,
  aprovadas: [
    card(601),                                                                                                  // aprovado, matriz
    card(602, { marketplace: 'shopee', order_id: '260805TESTE0602', nf_serie: '5', nf_chave: chave(5, 602) }),   // aprovado, Full da Shopee (o card do dono)
    card(603, { dep_sugerido: 'defeito' }),                                                                     // aprovado com o deposito sugerido pelo marcador
  ],
  problemas: [card(604, { tipo: 'problema', status: 'problema', problema_descricao: 'veio amassado' })],
  divergentes: [card(605, { tipo: 'divergente', status: 'divergente', problema_descricao: 'veio outro produto' })],
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
      // os depositos com o nome que cada empresa usa; o de Full fica na lista pra provar que o modal nao o oferece
      const COMPLETA = [{ id: 'G1', descricao: 'Geral', padrao: true }, { id: 'D1', descricao: e.defeitos }, { id: 'F1', descricao: 'Shopee Full' }];
      const SEM_DEFEITOS = [{ id: 'G1', descricao: 'Geral', padrao: true }, { id: 'F1', descricao: 'Shopee Full' }];
      const dep = { status: 200, corpo: { ok: true, depositos: COMPLETA }, trava: null };
      const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: CAPTURA ? 2 : 1 });
      const page = await ctx.newPage();
      const errosJs = []; page.on('pageerror', (err) => errosJs.push(String((err && err.message) || err)));
      await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
      const json = (route, status, corpo) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
      await page.route('**/api/admin/devolucoes', (route) => json(route, 200, LISTA));
      await page.route('**/api/depositos*', async (route) => { if (dep.trava) await dep.trava; return json(route, dep.status, dep.corpo); });
      const urlPainel = 'http://127.0.0.1:' + s.porta + e.painel;
      const abrirPainel = async () => { await page.goto(urlPainel, { waitUntil: 'networkidle' }); await page.waitForSelector('#card-601', { timeout: 10000 }); };

      // entra como admin (o painel e so do admin) e abre o painel da empresa
      await page.goto('http://127.0.0.1:' + s.porta + e.rota + '/', { waitUntil: 'load' });
      await page.fill('#loginUser', 'dono'); await page.fill('#loginPass', 's2');
      await Promise.all([page.waitForResponse((r) => /\/api\/auth\/login/.test(r.url())), page.click('#btnLogin')]);
      await page.waitForSelector('#codigo', { timeout: 8000 });
      await abrirPainel();

      // o que o modal mostra: a opcao marcada na caixinha e a frase ao lado dela (o bloco do deposito sem as opcoes)
      const lerModal = () => page.evaluate(() => {
        const sel = document.getElementById('depModal');
        const marcada = sel.options[sel.selectedIndex];
        const bloco = sel.parentElement.cloneNode(true);
        bloco.querySelector('select').remove();
        const botao = (id) => { const b = document.getElementById(id); return b ? !b.disabled : null; };
        return {
          marcado: marcada ? marcada.textContent.replace('📦', '').trim() : '', valor: sel.value,
          opcoes: Array.from(sel.options).map((o) => o.textContent.replace('📦', '').trim()),
          frase: bloco.textContent.replace(/\s+/g, ' ').trim(), rascunhoLiberado: botao('btnGerarRascunho'),
        };
      });
      const clicarGerar = async (id) => {
        await page.click('#card-' + id + ' button[onclick^="abrirModalGerarDevolucao("]');
        await page.waitForFunction((nf) => { const m = document.getElementById('modalGerarConteudo'); return !!m && m.innerText.includes('NF original: ' + nf); }, '000' + id, { timeout: 8000 });
      };
      const abrirModal = async (id) => {
        await clicarGerar(id);
        await page.waitForFunction(() => { const x = document.getElementById('depModal'); return !!x && x.options.length > 0 && !/carregando/.test(x.options[0].textContent); }, null, { timeout: 8000 });
        return lerModal();
      };
      const fechar = () => page.evaluate(() => fecharModalGerarDevolucao());

      // 1) aprovado: caixinha no GERAL e a frase diz GERAL
      for (const [id, qual] of [[601, 'aprovado da matriz'], [602, 'aprovado do Full da Shopee (o card do dono)']]) {
        const m = await abrirModal(id);
        ok(m.marcado === 'Geral' && m.valor === 'G1', '  ' + qual + ': a caixinha abre no GERAL (' + m.marcado + ')');
        ok(/padrão: Geral\b/.test(m.frase) && !/defeito/i.test(m.frase), '⚠️ V-26 ' + qual + ': a frase diz o deposito marcado, GERAL (dizia "padrão: DEFEITOS"): "' + m.frase + '"');
        ok(/troque se o produto estiver com problema/.test(m.frase), '  ' + qual + ': e orienta a trocar se o produto estiver com problema');
        ok(m.opcoes.length === 2 && !m.opcoes.some((o) => /full/i.test(o)), '  ' + qual + ': o deposito de Full segue fora da lista (' + m.opcoes.join(', ') + ')');
        if (CAPTURA && id === 602) await page.screenshot({ path: require('path').join(CAPTURA, 'v26-' + e.nome.toLowerCase() + '-aprovada.png') });
        await fechar();
      }

      // 2) problema, divergente e aprovado com deposito sugerido "defeito": caixinha no DEFEITOS e a frase diz DEFEITOS
      for (const [id, qual] of [[604, 'problema'], [605, 'divergente'], [603, 'aprovado com deposito sugerido "defeito"']]) {
        const m = await abrirModal(id);
        ok(m.marcado === e.defeitos && m.valor === 'D1', '  ' + qual + ': a caixinha abre no ' + e.defeitos + ' (' + m.marcado + ')');
        ok(m.frase.includes('padrão: ' + e.defeitos + ' — troque se o produto estiver bom') && !/Geral/.test(m.frase), '⚠️ V-26 ' + qual + ': a frase diz o deposito marcado, com o nome que a empresa usa: "' + m.frase + '"');
        ok(m.rascunhoLiberado === true, '  ' + qual + ': com a lista carregada, o "Criar rascunho" libera');
        if (CAPTURA && id === 604) await page.screenshot({ path: require('path').join(CAPTURA, 'v26-' + e.nome.toLowerCase() + '-problema.png') });
        await fechar();
      }

      // 4) empresa SEM deposito de DEFEITOS: o problema cai no GERAL — a frase nao pode prometer DEFEITOS
      dep.corpo = { ok: true, depositos: SEM_DEFEITOS };
      const semDef = await abrirModal(604);
      ok(semDef.marcado === 'Geral' && /padrão: Geral\b/.test(semDef.frase) && !/defeito/i.test(semDef.frase), '⚠️ V-26 problema numa empresa sem deposito DEFEITOS: a caixinha cai no GERAL e a frase diz GERAL, nao "DEFEITOS": "' + semDef.frase + '"');
      ok(/troque se o produto estiver com problema/.test(semDef.frase) && !/estiver bom/.test(semDef.frase), '⚠️ V-26 e a orientacao acompanha a CAIXINHA, nao a fila: com o GERAL marcado, manda trocar se o produto estiver com problema');
      await fechar();

      // 5a) enquanto a lista carrega: a frase nao afirma padrao nenhum
      dep.corpo = { ok: true, depositos: COMPLETA };
      let soltar; dep.trava = new Promise((r) => { soltar = r; });
      await clicarGerar(601);
      const carregando = await lerModal();
      ok(/carregando/.test(carregando.marcado) && !/padrão:/.test(carregando.frase), '⚠️ V-26 lista ainda carregando: a frase nao afirma padrao nenhum (dizia "padrão: DEFEITOS" antes de saber): "' + carregando.frase + '"');
      soltar(); dep.trava = null;
      await page.waitForFunction(() => !/carregando/.test(document.getElementById('depModal').options[0].textContent), null, { timeout: 8000 });
      const depois = await lerModal();
      ok(/padrão: Geral\b/.test(depois.frase), '  a lista chegou: a frase passa a dizer o deposito marcado: "' + depois.frase + '"');
      await fechar();

      // 5b) a lista nao veio: a caixinha avisa e a frase nao afirma padrao nenhum
      dep.status = 500; dep.corpo = { ok: false, erro: 'bling fora do ar' };
      const semLista = await abrirModal(604);
      ok(/indisponíveis/.test(semLista.marcado) && semLista.valor === '' && !/padrão:/.test(semLista.frase), '⚠️ V-26 lista de depositos nao veio: a caixinha avisa e a frase nao afirma padrao nenhum: "' + semLista.frase + '"');
      ok(semLista.rascunhoLiberado === false, '  e o card de problema segue com o "Criar rascunho" travado (sem deposito escolhido nao gera)');
      await fechar();
      dep.status = 200; dep.corpo = { ok: true, depositos: COMPLETA };

      // 6) a lista de um modal que JA FECHOU chega depois de outro abrir: nao escreve a frase dele no modal novo
      let soltarVelha; dep.trava = new Promise((r) => { soltarVelha = r; });
      await clicarGerar(604);                         // problema: o pedido da lista dele fica preso
      await fechar();
      dep.trava = null;
      const novo = await abrirModal(601);             // aprovado: a lista dele chega na hora
      const chegouVelha = page.waitForResponse((r) => /\/api\/depositos/.test(r.url()));
      soltarVelha();
      await chegouVelha;
      await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
      const depoisDaVelha = await lerModal();
      ok(/padrão: Geral\b/.test(novo.frase) && depoisDaVelha.frase === novo.frase && depoisDaVelha.marcado === 'Geral', '⚠️ V-26 a lista do modal anterior (problema) chegou atrasada: a frase do modal aberto (aprovado) segue a dele: "' + depoisDaVelha.frase + '"');
      await fechar();

      ok(errosJs.length === 0, '  nenhum erro de JS na pagina' + (errosJs.length ? ': ' + errosJs.join(' | ') : ''));
      await ctx.close();
    }
  } catch (err) {
    ok(false, 'o teste estourou: ' + ((err && err.stack) || err));
  } finally {
    if (navegador) await navegador.close().catch(() => {});
    await s.matar();
  }
  console.log(falhas === 0 ? '\n✅ a frase do deposito no modal diz o que a caixinha marcou' : '\n❌ ' + falhas + ' falha(s)');
  process.exit(falhas === 0 ? 0 : 1);
})();
