'use strict';
// b708 — V-05 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): CSP COMPATIVEL, EM DUAS CAMADAS.
//
// A peca `lib/cabecalhos-seguranca.js` roda aqui num Express de verdade, com requisicoes HTTP de verdade:
//   - toda resposta sai com nosniff, referrer, SAMEORIGIN e a CSP EM VIGOR (so o que nenhuma tela usa);
//   - a CSP completa vai em Report-Only, com report-uri na rota de relato;
//   - a rota de relato aceita os 2 formatos do navegador, conta por diretiva+host, NUNCA guarda a URL inteira
//     (um ?k= numa URL bloqueada nao pode parar no /health), e tem teto de chaves;
//   - e o server.js liga a peca antes das rotas e mostra o diagnostico no /health.
//
// Roda com: node test/cabecalhos-seguranca.test.js

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const peca = require(path.join(RAIZ, 'lib', 'cabecalhos-seguranca.js'));

function pedir(porta, metodo, caminho, corpo, tipo) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port: porta, method: metodo, path: caminho, headers: corpo ? { 'content-type': tipo, 'content-length': Buffer.byteLength(corpo) } : {} }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

(async () => {
  const seg = peca.criar();
  const app = express();
  app.use(seg.middleware);
  app.post(seg.ROTA_RELATO, express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '20kb' }), seg.rotaRelato);
  app.get('/painel', (req, res) => res.send('<html>painel</html>'));
  app.get('/amb/api/x', (req, res) => res.json({ ok: true }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const porta = srv.address().port;

  // ── camada 1: em toda resposta, HTML ou JSON, raiz ou empresa ──
  for (const caminho of ['/painel', '/amb/api/x']) {
    const r = await pedir(porta, 'GET', caminho);
    const h = r.headers;
    ok(h['x-content-type-options'] === 'nosniff' && h['referrer-policy'] === 'strict-origin-when-cross-origin' && h['x-frame-options'] === 'SAMEORIGIN',
       `${caminho}: nosniff + referrer + SAMEORIGIN`);
    ok(h['content-security-policy'] === "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
       `  ${caminho}: CSP EM VIGOR so com o que nenhuma tela usa (object, base, form externo, moldura de terceiro)`);
    ok(!/script-src|img-src|connect-src/.test(h['content-security-policy']), '  ⚠️ a CSP em vigor NAO mexe em script/img/connect (as telas tem handlers inline, Tesseract, QZ Tray)');
    const ro = h['content-security-policy-report-only'] || '';
    ok(/script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https:\/\/cdn\.jsdelivr\.net blob:/.test(ro) && /worker-src 'self' blob:/.test(ro) && /connect-src [^;]*wss:\/\/localhost:\*/.test(ro),
       `  ${caminho}: a CSP completa vai em Report-Only (jsdelivr, worker blob, wasm, websocket do QZ)`);
    ok(ro.endsWith('report-uri ' + seg.ROTA_RELATO), '  e aponta pra rota de relato');
  }

  // ── a rota de relato: 2 formatos, contagem por diretiva+host, sem URL inteira ──
  const legado = JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'https://http2.mlstatic.com/D_1.jpg?k=SEGREDO123', 'document-uri': 'https://x/painel?k=SEGREDO123' } });
  let r = await pedir(porta, 'POST', seg.ROTA_RELATO, legado, 'application/csp-report');
  ok(r.status === 204, 'relato legado (application/csp-report): 204');
  const novo = JSON.stringify([{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://http2.mlstatic.com/D_2.jpg?k=SEGREDO123' } }, { type: 'csp-violation', body: { effectiveDirective: 'script-src', blockedURL: 'inline' } }]);
  r = await pedir(porta, 'POST', seg.ROTA_RELATO, novo, 'application/reports+json');
  ok(r.status === 204, 'relato novo (application/reports+json, lista): 204');
  const d = seg.diagnostico();
  ok(d.total === 3 && d.por_diretiva_e_host['img-src | http2.mlstatic.com'] === 2 && d.por_diretiva_e_host['script-src | inline'] === 1,
     '⚠️ conta por diretiva + host: img-src|mlstatic=2, script-src|inline=1 (' + JSON.stringify(d.por_diretiva_e_host) + ')');
  ok(!/SEGREDO123|D_1\.jpg|\?k=/.test(JSON.stringify(d)), '⚠️ o diagnostico NAO guarda a URL inteira (nada de ?k=, caminho ou segredo)');
  ok(d.modo === 'relato (nao bloqueia)' && typeof d.ultimo === 'string', '  e diz que esta em modo relato, com a hora do ultimo');
  // lixo nao derruba
  r = await pedir(porta, 'POST', seg.ROTA_RELATO, '{"nada":1}', 'application/json');
  ok(r.status === 204 && seg.diagnostico().total === 3, '  corpo sem relato: 204 e nao conta');
  // teto de chaves
  for (let i = 0; i < 260; i++) seg.registrar({ 'csp-report': { 'effective-directive': 'connect-src', 'blocked-uri': 'https://h' + i + '.exemplo' } });
  const d2 = seg.diagnostico();
  ok(d2.chaves <= 200 && d2.descartados >= 60 && d2.total === 263, '  teto de 200 chaves: o excesso e so contado em `descartados` (' + d2.chaves + ' chaves, ' + d2.descartados + ' descartados)');

  srv.close();

  // ── o server.js liga a peca antes das rotas e expoe no /health ──
  const SRV = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const iJson = SRV.indexOf("app.use(express.json({ limit: '12mb' }));");
  const iSeg = SRV.indexOf("const seguranca = require('./lib/cabecalhos-seguranca').criar();");
  const iUse = SRV.indexOf('app.use(seguranca.middleware);');
  const iRota = SRV.indexOf('app.post(seguranca.ROTA_RELATO, express.json({ type: [');
  const iStatic = SRV.indexOf("app.use(express.static(path.join(__dirname, 'public')");
  ok(iJson >= 0 && iSeg > iJson && iUse > iSeg && iRota > iUse && iStatic > iUse, 'server.js: a peca entra logo depois do express.json e ANTES do static (vale pra HTML, JS e API das 3 empresas)');
  ok(/csp: seguranca\.diagnostico\(\),/.test(SRV), '  /health mostra `csp` (o que a politica completa bloquearia hoje)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
