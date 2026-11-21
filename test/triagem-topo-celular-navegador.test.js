'use strict';
// b792 — O TOPO DA TRIAGEM NO CELULAR, no Chromium de verdade (index-AMB.html: a tela da fabrica — AMB, Girassol e proximas).
//
// Dono, 21/11, print do celular na AMB: "melhora esse layout pra celular, olha como fica desajustado no topo". Os 4 links
// vinham encostados a direita com um sozinho na linha de baixo, a faixa do usuario no meio e o botao ⋮ largado embaixo.
// Causa: a regra do celular que escondia links e cracha (b93) vem ANTES das regras-base no arquivo — e por isso nunca
// valeu; e a regra de 14/10 (links a direita, pensada pro computador) valia tambem no celular.
//
// Este teste mede a GEOMETRIA na tela (nao o texto do CSS): no celular os 4 links formam uma grade 2 x 2 alinhada, da
// largura da faixa; o usuario fica centrado embaixo; o ⋮ nao aparece; nada vaza pra fora da tela. E no computador o
// topo continua numa linha so, como era. Roda nas duas empresas da fabrica (e confere que a GOOD, que tem a tela dela,
// nao vazou).
// Roda com: node test/triagem-topo-celular-navegador.test.js     (CAPTURA_TOPO=<pasta> salva as capturas)
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('FALHA Playwright nao instalado: ' + e.message); process.exit(1); }

const FABRICA = [{ nome: 'AMB', rota: '/amb', prefixo: 'AMB_' }, { nome: 'Girassol', rota: '/girassol', prefixo: 'GIRASSOL_' }];
const CAPTURA = process.env.CAPTURA_TOPO || '';
const perto = (a, b, folga = 1.5) => Math.abs(a - b) <= folga;

// roda DENTRO da pagina: as medidas do topo
function medir() {
  const cx = (r) => r.left + r.width / 2;
  const caixa = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, cx: cx(r) }; };
  const visivel = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const header = [...document.querySelectorAll('header')].find((h) => h.getBoundingClientRect().height > 0);
  const faixa = header.querySelector('.topo-faixa');
  const links = [...header.querySelectorAll('.links-defeitos a')];
  const cracha = header.querySelector('.user-badge');
  const estilo = getComputedStyle(faixa);
  return {
    header: caixa(header), faixa: caixa(faixa),
    dentro: { left: faixa.getBoundingClientRect().left + parseFloat(estilo.paddingLeft || 0), right: faixa.getBoundingClientRect().right - parseFloat(estilo.paddingRight || 0) },
    titulo: caixa(header.querySelector('.topo-txt')), logo: caixa(header.querySelector('.topo-logo')),
    links: links.map((a) => { const r = document.createRange(); r.selectNodeContents(a); return Object.assign(caixa(a), { texto: a.innerText.replace(/\s+/g, ' ').trim(), cor: getComputedStyle(a).color, conteudo: caixa({ getBoundingClientRect: () => r.getBoundingClientRect() }) }); }),
    corDoTitulo: getComputedStyle(header.querySelector('h1')).color,
    cracha: Object.assign(caixa(cracha), { visivel: visivel(cracha), texto: cracha.innerText.replace(/\s+/g, ' ').trim() }),
    botaoMenu: visivel(document.getElementById('btnMenuTopo')), menu: visivel(document.getElementById('menuTopo')),
    avisoDentroDoDefeitos: !!document.querySelector('#linkDefeitos #avisoDefeitos'),
    vazaNaHorizontal: document.documentElement.scrollWidth > window.innerWidth + 1,
    larguraDaTela: window.innerWidth,
  };
}

(async () => {
  const env = {
    USERS: 'esto:s1:Esto,dono:s2:Diego', ADMIN_USER: 'dono', GOOD_USERS: 'esto:s1:Esto,dono:s2:Diego', GOOD_ADMIN_USER: 'dono',
    SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789', ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!',
  };
  for (const e of FABRICA) { env[e.prefixo + 'USERS'] = 'esto:s1,dono:s2'; env[e.prefixo + 'ADMIN_USER'] = 'dono'; env[e.prefixo + 'SESSION_SECRET'] = 'segredo-da-' + e.nome.toLowerCase() + '-so-pra-teste-0123456789'; }
  const s = await subir({ env, tetoMs: 45000 });
  let navegador = null;
  try {
    ok(s.subiu, '⚠️ o server.js subiu' + (!s.subiu ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
    if (!s.subiu) throw new Error('nao subiu');
    navegador = await chromium.launch();
    const abrir = async (rota, opcoes, usuario) => {
      const ctx = await navegador.newContext(opcoes);
      const page = await ctx.newPage();
      const errosJs = []; page.on('pageerror', (err) => errosJs.push(String(err && err.message || err)));
      await page.goto('http://127.0.0.1:' + s.porta + rota + '/', { waitUntil: 'load' });
      await page.fill('#loginUser', usuario); await page.fill('#loginPass', usuario === 'dono' ? 's2' : 's1');
      await Promise.all([page.waitForResponse((r) => /\/api\/auth\/login/.test(r.url())), page.click('#btnLogin')]);
      await page.waitForSelector('#codigo', { state: 'visible', timeout: 8000 });
      await page.waitForTimeout(250);
      return { ctx, page, errosJs };
    };

    for (const e of FABRICA) {
      console.log('\n── ' + e.nome);
      // ══ celular: as larguras comuns e a mais estreita (320), como ADMIN (o cracha mais largo: nome + Painel + sair) e como estoquista ══
      for (const [larg, alt, usuario] of [[412, 915, 'dono'], [360, 740, 'dono'], [320, 640, 'dono'], [412, 915, 'esto']]) {
        const { ctx, page, errosJs } = await abrir(e.rota, { viewport: { width: larg, height: alt }, isMobile: true, hasTouch: true, deviceScaleFactor: CAPTURA ? 2 : 1 }, usuario);
        const m = await page.evaluate(medir);
        const L = m.links; const rot = '  ' + larg + 'px (' + usuario + '): ';
        ok(L.length === 4 && L.map((x) => x.texto.replace(/[^A-Za-zçãõé ]/g, '').trim()).join('|') === 'Defeitos|Lançar Defeito|Solicitações|O que bipar', rot + 'os 4 links continuam a vista (' + L.map((x) => x.texto).join(' · ') + ')');
        ok(L.length === 4 && perto(L[0].top, L[1].top) && perto(L[2].top, L[3].top) && L[2].top > L[0].bottom - 1 && perto(L[0].left, L[2].left) && perto(L[1].left, L[3].left) && L[1].left > L[0].right - 1,
          '⚠️' + rot + 'os links formam uma GRADE 2 x 2 alinhada (era: 3 numa linha encostados a direita e 1 sozinho embaixo)');
        ok(L.length === 4 && L.every((x) => perto(x.width, L[0].width) && perto(x.height, L[0].height)) && L[0].height >= 36, '⚠️' + rot + 'os 4 do mesmo tamanho, e altos o bastante pro dedo (' + L.map((x) => Math.round(x.width) + 'x' + Math.round(x.height)).join(', ') + ')');
        ok(L.length === 4 && L.every((x) => perto(x.conteudo.cx, x.cx, 3) && x.conteudo.left >= x.left && x.conteudo.right <= x.right), rot + 'o texto de cada um centrado e inteiro dentro do proprio botao');
        ok(L.length === 4 && perto(L[0].left, m.dentro.left, 2) && perto(L[1].right, m.dentro.right, 2), '⚠️' + rot + 'a grade ocupa a largura da faixa, de ponta a ponta (nao fica encostada num lado)');
        ok(L.length === 4 && L[0].top >= Math.max(m.titulo.bottom, m.logo.bottom) - 1, rot + 'embaixo do logo e do titulo');
        ok(m.cracha.visivel && perto(m.cracha.cx, m.header.cx, 2) && m.cracha.top >= L[3].bottom - 1 && new RegExp(usuario === 'dono' ? 'dono.*Painel.*sair' : 'esto.*sair').test(m.cracha.texto),
          '⚠️' + rot + 'o usuario fica CENTRADO, embaixo dos links (' + m.cracha.texto + ')');
        ok(m.botaoMenu === false && m.menu === false, '⚠️' + rot + 'o botao ⋮ nao aparece mais largado no topo (ele so repetia o que ja esta na tela)');
        ok(m.avisoDentroDoDefeitos, rot + 'o aviso de pendencia continua dentro do link Defeitos, a vista');
        ok(!m.vazaNaHorizontal && L.every((x) => x.left >= 0 && x.right <= m.larguraDaTela + 0.5), '⚠️' + rot + 'nada vaza pra fora da tela');
        ok(L.every((x) => x.cor === m.corDoTitulo), rot + 'o texto dos links tem a cor do titulo (a cor do cabecalho da empresa: ' + m.corDoTitulo + ')');
        if (larg >= 360) ok(m.header.height < 215, rot + 'o topo ficou mais baixo que antes (' + Math.round(m.header.height) + 'px; eram 232)');
        ok(errosJs.length === 0, rot + 'sem erro de JS' + (errosJs.length ? ': ' + errosJs.slice(0, 2).join(' | ') : ''));
        if (CAPTURA && usuario === 'dono') await page.screenshot({ path: CAPTURA + '/topo-' + e.nome + '-' + larg + '.png', clip: { x: 0, y: 0, width: larg, height: Math.min(alt, Math.round(m.header.bottom) + 160) } });
        // os links continuam funcionando: "O que bipar" abre a colinha
        await page.click('.links-defeitos a:nth-child(4)');
        ok(await page.evaluate(() => document.getElementById('modalColaBipe').classList.contains('show')), rot + 'tocar em "O que bipar" abre a colinha');
        await ctx.close();
      }

      // ══ computador: tudo numa linha so, como era ══
      {
        const { ctx, page } = await abrir(e.rota, { viewport: { width: 1280, height: 800 } }, 'dono');
        const m = await page.evaluate(medir);
        const L = m.links;
        ok(L.length === 4 && L.every((x) => perto(x.top, L[0].top, 3)) && L[0].left > m.titulo.left + 100 && m.cracha.left >= L[3].right - 1 && perto(m.cracha.top + m.cracha.height / 2, L[0].top + L[0].height / 2, 6),
          '⚠️  1280px: no computador o topo continua numa linha so — titulo, os 4 links e o usuario a direita');
        ok(m.botaoMenu === false && m.header.height < 100 && !m.vazaNaHorizontal, '  1280px: sem ⋮, topo baixo (' + Math.round(m.header.height) + 'px) e sem vazar');
        ok(L.every((x) => x.cor === m.corDoTitulo), '  1280px: e o texto dos links tambem tem a cor do titulo (' + m.corDoTitulo + ')');
        await ctx.close();
      }
      // ══ largura do meio (tablet / celular deitado): continua como era — os links descem inteiros, sem vazar ══
      {
        const { ctx, page } = await abrir(e.rota, { viewport: { width: 700, height: 900 } }, 'dono');
        const m = await page.evaluate(medir);
        ok(!m.vazaNaHorizontal && m.links.every((x) => perto(x.top, m.links[0].top, 3)) && m.botaoMenu === false, '  700px: os 4 links numa linha, sem vazar e sem ⋮ (acima de 600px nada mudou)');
        await ctx.close();
      }
    }

    // a GOOD tem a tela dela (public/index.html), que ja quebrava certo: so confere que segue sem vazar
    {
      console.log('\n── GOOD (tela propria — nao foi mexida)');
      const { ctx, page } = await abrir('', { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }, 'dono');
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '  412px: a triagem da GOOD nao vaza na horizontal');
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
