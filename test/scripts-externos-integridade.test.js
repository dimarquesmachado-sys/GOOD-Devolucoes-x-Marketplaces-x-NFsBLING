'use strict';
// b779 — V-08 (auditoria do Codex, 15/11), a ultima parte: `integrity` nas bibliotecas que vem de CDN.
//
// Sem `integrity`, se o CDN (ou alguem no meio) entregar outro arquivo, o navegador roda o que vier — dentro da
// tela de triagem e do painel admin, com a sessao do usuario. Com `integrity="sha384-..."` + `crossorigin`, o
// navegador confere o hash e RECUSA o arquivo se um byte mudar. Por isso a versao tambem tem que ser EXATA: o
// `tesseract.js@5` resolvia sozinho pra versao nova a cada lancamento — com hash, isso derrubaria o OCR no dia.
//
// O que este teste prova:
//   1. todo <script src="https://..."> dos HTML (public/ e amb-devolucoes/public-AMB/) tem integrity sha384,
//      crossorigin="anonymous" e versao exata na URL — a unica excecao e o nav.js do Mover-Pedidos (servidor
//      NOSSO, muda a cada deploy: hash travaria a navegacao no deploy seguinte);
//   2. a mesma URL tem o mesmo hash em todos os HTML (GOOD e fabrica);
//   3. o hash BATE com o arquivo de verdade:
//        - no CDN, quando alcanca (no CI sempre alcanca) — e o CDN responde com CORS, sem o qual o navegador
//          recusa script com integrity;
//        - sem CDN (este sandbox), as do jsDelivr sao conferidas no pacote publicado no npm (o jsDelivr serve o
//          arquivo do pacote byte a byte; o pacote e conferido contra o sha512 que o registro publica);
//   4. no CI (com internet): um Chromium de verdade abre uma pagina com as MESMAS tags e as bibliotecas carregam
//      (qz, Tesseract, jsQR, XLSX existem) — e o proprio navegador aplicando o integrity + CORS.
// Sem CDN e fora do CI, o que nao der pra conferir daqui vira AVISO (nao falha); no CI (CI=true) vira FALHA.
// Roda com: node test/scripts-externos-integridade.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const aviso = (o) => console.log('aviso ' + o);
const EM_CI = !!process.env.CI;
const RAIZ = path.join(__dirname, '..');

const PRIMEIRA_PARTE = {
  'https://mover-pedidos-aguardando-x-atendido.onrender.com/comum/nav.js':
    'servidor nosso (Mover-Pedidos): o arquivo muda a cada deploy — hash fixo travaria a navegacao no deploy seguinte',
};
const GLOBAL_DA_LIB = [[/\/qz-tray@/, 'qz'], [/\/tesseract\.js@/, 'Tesseract'], [/\/jsqr@/, 'jsQR'], [/\/xlsx-[\d.]+\//, 'XLSX']];

function htmls(dir, acc = []) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    if (n.name === 'node_modules' || n.name.startsWith('.')) continue;
    const p = path.join(dir, n.name);
    if (n.isDirectory()) htmls(p, acc); else if (/\.html$/.test(n.name)) acc.push(p);
  }
  return acc;
}
const attr = (tag, nome) => { const m = new RegExp('\\b' + nome + '="([^"]*)"').exec(tag); return m ? m[1] : null; };
const sha384 = (buf) => 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
/** versao exata na URL: jsDelivr /npm/<pacote>@x.y.z/<arquivo>; SheetJS /xlsx-x.y.z/ */
function fixada(url) {
  let m = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/@]+\/)?[^/@]+)@(\d+\.\d+\.\d+)\/(.+)$/.exec(url);
  if (m) return { tipo: 'npm', pacote: m[1], versao: m[2], arquivo: m[3] };
  m = /^https:\/\/cdn\.sheetjs\.com\/xlsx-(\d+\.\d+\.\d+)\//.exec(url);
  if (m) return { tipo: 'sheetjs', versao: m[1] };
  return null;
}
async function baixar(url, ms = 20000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: 'follow' });
    if (!r.ok) return { erro: 'HTTP ' + r.status };
    return { buf: Buffer.from(await r.arrayBuffer()), cors: r.headers.get('access-control-allow-origin') };
  } catch (e) { return { erro: String(e && e.cause && e.cause.code || e && e.message || e) }; }
}
/** um arquivo de dentro do .tgz do npm (tar: cabecalhos de 512 bytes) */
function arquivoDoTgz(tgz, nome) {
  const tar = zlib.gunzipSync(tgz);
  for (let i = 0; i + 512 <= tar.length;) {
    const cab = tar.subarray(i, i + 512);
    if (cab.every((b) => b === 0)) break;
    const n = cab.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const pre = cab.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const tam = parseInt(cab.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    const completo = pre ? pre + '/' + n : n;
    if (completo === 'package/' + nome) return tar.subarray(i + 512, i + 512 + tam);
    i += 512 + Math.ceil(tam / 512) * 512;
  }
  return null;
}
async function doPacoteNpm({ pacote, versao, arquivo }) {
  const meta = await baixar('https://registry.npmjs.org/' + pacote.replace('/', '%2f') + '/' + versao);
  if (!meta.buf) return { erro: 'registro do npm: ' + meta.erro };
  const dist = JSON.parse(meta.buf.toString('utf8')).dist || {};
  const tgz = await baixar(dist.tarball, 60000);
  if (!tgz.buf) return { erro: 'pacote do npm: ' + tgz.erro };
  const publicado = 'sha512-' + crypto.createHash('sha512').update(tgz.buf).digest('base64');
  if (dist.integrity && dist.integrity !== publicado) return { erro: 'o .tgz baixado NAO bate com o sha512 publicado no registro' };
  const buf = arquivoDoTgz(tgz.buf, arquivo);
  return buf ? { buf } : { erro: arquivo + ' nao existe no pacote ' + pacote + '@' + versao };
}

(async () => {
  // ── 1/2. as tags ──
  const arquivos = [...htmls(path.join(RAIZ, 'public')), ...htmls(path.join(RAIZ, 'amb-devolucoes', 'public-AMB'))];
  const porUrl = new Map();   // url → { integrity:Set, onde:[], tag }
  let externas = 0;
  for (const arq of arquivos) {
    const html = fs.readFileSync(arq, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
      const tag = m[0]; const src = attr(tag, 'src');
      if (!src || !/^(https?:)?\/\//i.test(src)) continue;
      externas++;
      const rel = path.relative(RAIZ, arq);
      if (PRIMEIRA_PARTE[src]) { console.log('ok    ' + rel + ': ' + src + ' — sem hash de proposito: ' + PRIMEIRA_PARTE[src]); continue; }
      const integ = attr(tag, 'integrity'), co = attr(tag, 'crossorigin');
      ok(/^sha384-[A-Za-z0-9+/]{64}$/.test(integ || ''), '⚠️ ' + rel + ': ' + src + ' tem integrity sha384 (' + (integ || 'SEM') + ')');
      ok(co === 'anonymous', '  ' + rel + ': ... e crossorigin="anonymous" (sem ele o navegador nao confere o hash e recusa)');
      ok(!!fixada(src), '⚠️ ' + rel + ': ' + src + ' com versao EXATA na URL (versao flutuante + hash = biblioteca quebrada no proximo lancamento)');
      const e = porUrl.get(src) || { integ: new Set(), onde: [] };
      if (integ) e.integ.add(integ); e.onde.push(rel); e.tag = tag; porUrl.set(src, e);
    }
  }
  ok(externas >= 8, '  achou as tags externas dos HTML (' + externas + ' — GOOD, fabrica e relatorios)');
  for (const [url, e] of porUrl) ok(e.integ.size === 1, '  ' + url.replace(/^https:\/\//, '') + ': o MESMO hash em ' + e.onde.length + ' HTML');

  // ── 3. o hash bate com o arquivo de verdade ──
  let alcancouCdn = false;
  for (const [url, e] of porUrl) {
    const declarado = [...e.integ][0]; const f = fixada(url); const curto = url.replace(/^https:\/\//, '');
    if (!declarado || !f) continue;
    const cdn = await baixar(url);
    if (cdn.buf) {
      alcancouCdn = true;
      const medido = sha384(cdn.buf);
      ok(medido === declarado, '⚠️ ' + curto + ': o hash bate com o arquivo do CDN' + (medido === declarado ? '' : ' — MEDIDO ' + medido + ' (declarado ' + declarado + ')'));
      ok(cdn.cors === '*' || cdn.cors === 'null', '  ' + curto + ': o CDN responde com CORS (access-control-allow-origin: ' + cdn.cors + ')');
      continue;
    }
    if (f.tipo === 'npm') {
      const npm = await doPacoteNpm(f);
      if (npm.buf) {
        const medido = sha384(npm.buf);
        ok(medido === declarado, '⚠️ ' + curto + ': o hash bate com o arquivo do pacote publicado no npm (CDN fora daqui: ' + cdn.erro + ')' + (medido === declarado ? '' : ' — MEDIDO ' + medido));
        continue;
      }
      if (EM_CI) ok(false, curto + ': nao deu pra conferir nem no CDN (' + cdn.erro + ') nem no npm (' + npm.erro + ')');
      else aviso(curto + ': nao conferido daqui (CDN: ' + cdn.erro + '; npm: ' + npm.erro + ') — o CI confere');
      continue;
    }
    if (EM_CI) ok(false, curto + ': o CI tem que alcancar o CDN pra conferir o hash (' + cdn.erro + ')');
    else aviso(curto + ': so o CDN tem este arquivo e daqui nao alcanca (' + cdn.erro + ') — o CI confere');
  }

  // ── 4. o navegador de verdade aplicando o integrity (so com internet: no CI e obrigatorio) ──
  if (!alcancouCdn) {
    if (EM_CI) ok(false, 'o CI tem que alcancar os CDNs pra provar no navegador');
    else aviso('sem CDN daqui: a prova no navegador (as bibliotecas carregam com integrity) roda no CI');
  } else {
    let chromium; try { ({ chromium } = require('playwright')); } catch (e) { /* sem playwright */ }
    if (!chromium) ok(false, 'Playwright nao instalado');
    else {
      const tags = [...porUrl.values()].map((e) => e.tag + '</script>').join('\n');
      const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('<!doctype html><title>t</title>' + tags); });
      await new Promise((res) => srv.listen(0, '127.0.0.1', res));
      const nav = await chromium.launch();
      try {
        const page = await nav.newPage();
        const erros = []; page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
        await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'load', timeout: 60000 });
        for (const url of porUrl.keys()) {
          const g = (GLOBAL_DA_LIB.find(([re]) => re.test(url)) || [])[1];
          if (!g) { ok(false, url + ': biblioteca sem global conhecido no teste (acrescentar em GLOBAL_DA_LIB)'); continue; }
          const tem = await page.evaluate((n) => typeof window[n] !== 'undefined', g);
          ok(tem, '⚠️ no Chromium, com integrity: ' + url.replace(/^https:\/\//, '') + ' carregou (window.' + g + ')');
        }
        ok(!erros.some((t) => /integrity|Subresource|CORS/i.test(t)), '  sem erro de integrity/CORS no console' + (erros.length ? ': ' + erros.slice(0, 3).join(' | ') : ''));
      } finally { await nav.close().catch(() => {}); srv.close(); }
    }
  }
  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})();
