'use strict';
// b711 — P1-10 + P2-14 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): O UPLOAD DE FOTO NAO DERRUBA O SERVICO.
//
// O lock resolvia Multer 1.4.5-lts.2 (CVE-2025-47944: multipart malformado derruba o processo; CVE-2026-2359: upload
// interrompido esgota recurso). Agora: Multer 2.x; UMA peca (lib/upload-foto.js) pras duas pontas com limite unico,
// tratador de erro em JSON (413/400 em vez do 500 HTML do Express) e conferencia do CONTEUDO pelos primeiros bytes.
// E o manifesto diz Node >= 22, que e o que o lock exige (Supabase) e o CI usa.
//
// Aqui um Express de verdade com o Multer de verdade recebe multipart de verdade: valido, grande demais, nao-imagem,
// malformado e INTERROMPIDO no meio — e depois de cada um o servidor continua respondendo.
// Roda com: node test/upload-foto-robusto.test.js

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const express = require('express');
const multer = require('multer');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const peca = require(path.join(RAIZ, 'lib', 'upload-foto.js'));

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.alloc(300, 1), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);

// ── a peca, direto ──
ok(peca.tipoDaImagem(JPEG) === 'image/jpeg' && peca.tipoDaImagem(PNG) === 'image/png', 'tipoDaImagem: JPEG e PNG pelos bytes');
ok(peca.tipoDaImagem(Buffer.concat([Buffer.from('RIFF....WEBPVP8 '), Buffer.alloc(8)])) === 'image/webp' && peca.tipoDaImagem(Buffer.from('GIF89a' + '\0'.repeat(10))) === 'image/gif', '  WebP e GIF tambem');
ok(peca.tipoDaImagem(Buffer.from('<html><script>alert(1)</script></html>')) === null && peca.tipoDaImagem(Buffer.from('%PDF-1.4 ......')) === null && peca.tipoDaImagem(Buffer.alloc(3)) === null && peca.tipoDaImagem(null) === null,
   '  HTML, PDF, 3 bytes e nulo: NAO sao imagem (o mimetype declarado nao conta)');
ok(require(path.join(RAIZ, 'node_modules', 'multer', 'package.json')).version.split('.')[0] >= 2, '⚠️ Multer instalado e 2.x (' + require(path.join(RAIZ, 'node_modules', 'multer', 'package.json')).version + ') — o 1.4.5-lts.2 com CVE saiu');
const PKG = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
const LOCK = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package-lock.json'), 'utf8'));
ok(/^\^2\./.test(PKG.dependencies.multer) && /^2\./.test(LOCK.packages['node_modules/multer'].version), '  package.json pede ^2 e o lock resolve 2.x');
ok(PKG.engines.node === '>=22.0.0' && LOCK.packages[''].engines.node === '>=22.0.0', '⚠️ P2-14: manifesto e lock dizem Node >=22 (o que o Supabase do lock exige e o CI usa)');
ok(/node-version: '22'/.test(fs.readFileSync(path.join(RAIZ, '.github', 'workflows', 'ai-pr-checks.yml'), 'utf8')), '  CI em Node 22');

// ── o servidor ──
function multipart(partes, boundary = 'XxBOUNDARYxX') {
  const pecas = [];
  for (const p of partes) {
    pecas.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ''}\r\n${p.type ? `Content-Type: ${p.type}\r\n` : ''}\r\n`));
    pecas.push(Buffer.isBuffer(p.body) ? p.body : Buffer.from(String(p.body)));
    pecas.push(Buffer.from('\r\n'));
  }
  pecas.push(Buffer.from(`--${boundary}--\r\n`));
  return { corpo: Buffer.concat(pecas), tipo: `multipart/form-data; boundary=${boundary}` };
}
function pedir(porta, { corpo, tipo, tamanhoDeclarado }) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: '/api/triagem/upload-foto', method: 'POST', headers: { 'content-type': tipo, 'content-length': tamanhoDeclarado != null ? tamanhoDeclarado : corpo.length } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) { /* nao e json */ } resolve({ status: res.statusCode, corpo: b, json: j }); });
    });
    req.on('error', (e) => resolve({ status: 0, erro: e.code }));
    req.end(corpo);
  });
}

(async () => {
  const app = express();
  const upload = peca.criarUploadDeFoto(multer, { maxBytes: 2000 });   // limite pequeno so pra testar o 413
  const recebidos = [];
  app.post('/api/triagem/upload-foto', upload.single('foto'), peca.tratarErroDeUpload, (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, erro: 'Foto nao enviada' });
    const tipoReal = peca.tipoDaImagem(req.file.buffer);
    if (!tipoReal) return res.status(400).json({ ok: false, erro: 'o arquivo nao e uma imagem (JPEG, PNG, WebP ou GIF)' });
    recebidos.push({ tipoReal, declarado: req.file.mimetype, ext: peca.EXTENSAO[tipoReal], bytes: req.file.size });
    res.json({ ok: true, tipoReal });
  });
  app.get('/vivo', (req, res) => res.json({ ok: true }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const porta = srv.address().port;
  const vivo = async () => { const r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: porta, path: '/vivo' }, (res) => resolve(res.statusCode)).on('error', () => resolve(0))); return r === 200; };

  // valido: JPEG com mimetype MENTIROSO — o conteudo manda
  let r = await pedir(porta, multipart([{ name: 'foto', filename: 'x.html', type: 'text/html', body: JPEG }]));
  ok(r.status === 200 && r.json && r.json.tipoReal === 'image/jpeg' && recebidos[0].ext === 'jpg', 'JPEG declarado como text/html e .html: aceito como image/jpeg, extensao jpg (o conteudo manda) ' + r.status);
  // nao-imagem declarada como jpeg
  r = await pedir(porta, multipart([{ name: 'foto', filename: 'x.jpg', type: 'image/jpeg', body: Buffer.from('<html><script>alert(1)</script></html>') }]));
  ok(r.status === 400 && r.json && /nao e uma imagem/.test(r.json.erro), '⚠️ HTML declarado como image/jpeg e .jpg: 400 "nao e uma imagem" ' + r.status);
  // grande demais
  r = await pedir(porta, multipart([{ name: 'foto', filename: 'g.jpg', type: 'image/jpeg', body: Buffer.concat([JPEG, Buffer.alloc(5000, 7)]) }]));
  ok(r.status === 413 && r.json && r.json.codigo === 'LIMIT_FILE_SIZE', '⚠️ foto acima do limite: 413 em JSON (antes: 500 em HTML do Express) ' + r.status);
  // campo errado
  r = await pedir(porta, multipart([{ name: 'arquivo', filename: 'g.jpg', type: 'image/jpeg', body: JPEG }]));
  ok(r.status === 400 && r.json && r.json.codigo === 'LIMIT_UNEXPECTED_FILE', '  campo que nao e "foto": 400 LIMIT_UNEXPECTED_FILE ' + r.status);
  // malformado: boundary que nunca fecha
  r = await pedir(porta, { corpo: Buffer.from('--XxBOUNDARYxX\r\nContent-Disposition: form-data; name="foto"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n' + 'lixo sem fim'), tipo: 'multipart/form-data; boundary=XxBOUNDARYxX' });
  ok(r.status === 400 && r.json && r.json.ok === false, '⚠️ multipart MALFORMADO (sem fechar): 400 em JSON, processo de pe ' + r.status);
  ok(await vivo(), '  servidor continua respondendo');
  // interrompido: declara 1 MB, manda 10 KB e derruba o socket
  {
    const { corpo, tipo } = multipart([{ name: 'foto', filename: 'a.jpg', type: 'image/jpeg', body: Buffer.concat([JPEG, Buffer.alloc(10_000, 3)]) }]);
    await new Promise((resolve) => {
      const sock = net.connect(porta, '127.0.0.1', () => {
        sock.write(`POST /api/triagem/upload-foto HTTP/1.1\r\nHost: x\r\nContent-Type: ${tipo}\r\nContent-Length: ${1024 * 1024}\r\n\r\n`);
        sock.write(corpo.subarray(0, 8000), () => setTimeout(() => { sock.destroy(); resolve(); }, 150));
      });
      sock.on('error', () => resolve());
    });
    await new Promise((r2) => setTimeout(r2, 200));
    ok(await vivo(), '⚠️ upload INTERROMPIDO no meio (socket derrubado): servidor continua respondendo');
    r = await pedir(porta, multipart([{ name: 'foto', filename: 'b.png', type: 'image/png', body: PNG }]));
    ok(r.status === 200 && r.json && r.json.tipoReal === 'image/png', '  e o proximo upload valido (PNG) entra normal ' + r.status);
  }
  srv.close();

  // ── as duas pontas usam a peca, com o tratador na rota e o tipo conferido ──
  const SRV = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const COMPAT = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js'), 'utf8');
  ok(/const upload = uploadFoto\.criarUploadDeFoto\(multer\);/.test(SRV) && /app\.post\('\/api\/triagem\/upload-foto', requerEstoquista, upload\.single\('foto'\), uploadFoto\.tratarErroDeUpload, /.test(SRV),
     'GOOD: Multer pela peca + tratador de erro na rota');
  ok(/const upload = uploadFoto\.criarUploadDeFoto\(multer\);/.test(COMPAT) && /router\.post\('\/api\/triagem\/upload-foto', auth\.requerLogin, upload\.single\('foto'\), uploadFoto\.tratarErroDeUpload, /.test(COMPAT),
     'fabrica (AMB/Girassol): idem');
  for (const [nome, src] of [['GOOD', SRV], ['fabrica', COMPAT]]) {
    const i = src.indexOf("'/api/triagem/upload-foto'"); const f = src.indexOf('getPublicUrl', i);
    const bloco = src.slice(i, f);
    ok(/const tipoReal = uploadFoto\.tipoDaImagem\(req\.file\.buffer\);/.test(bloco) && /contentType: tipoReal,/.test(bloco) && !/req\.file\.mimetype \|\| 'image\/jpeg'/.test(bloco) && !/originalname/.test(bloco),
       `  ${nome}: tipo e extensao vem do CONTEUDO; mimetype e nome declarados nao sao mais usados`);
  }
  ok(!/fileSize: 6 \* 1024 \* 1024/.test(SRV) && !/fileSize: 12 \* 1024 \* 1024/.test(COMPAT), '  os dois limites divergentes (6 MB × 12 MB) sumiram — e um so, na peca (' + peca.TAMANHO_MAXIMO / 1024 / 1024 + ' MB)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
