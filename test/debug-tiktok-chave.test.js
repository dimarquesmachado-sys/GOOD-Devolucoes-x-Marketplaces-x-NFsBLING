// Roda com: node test/debug-tiktok-chave.test.js
//
// A sonda do TikTok exigia cookie de admin e SO isso. Na pratica, obrigava
// a estar logado no painel da GOOD — e o dono costuma estar logado no da
// AMB, que e outro login. Dava "Acesso restrito a admin" sem dizer por que.
//
// As outras rotas de diagnostico deste arquivo ja aceitavam ?k=ADMIN_KEY;
// esta ficou de fora.

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const DEBUG = fs.readFileSync(path.join(RAIZ, 'lib', 'rotas-debug.js'), 'utf8');

ok(/if \(adminOk\(req\)\) return next\(\);/.test(DEBUG),
   'a rota do TikTok aceita ?k=ADMIN_KEY');
ok(/return requerAdmin\(req, res, next\);/.test(DEBUG),
   '  e o cookie de admin continua valendo (nao troquei um pelo outro)');

// ── prova: sobe a rota com as duas portas ────────────────────────────
const ADMIN_KEY = 'chave-secreta-de-teste';
const adminOk = (req) => ADMIN_KEY && req.query.k === ADMIN_KEY;
const requerAdmin = (req, res, next) => {
  if (req.headers.cookie === 'sessao=valida') return next();
  return res.status(401).json({ ok: false, erro: 'Acesso restrito a admin' });
};

const app = express();
app.get('/api/debug/tiktok-devolucoes', (req, res, next) => {
  if (adminOk(req)) return next();
  return requerAdmin(req, res, next);
}, (req, res) => res.json({ ok: true, sonda: 'rodou' }));

const srv = http.createServer(app);
function pegar(caminho, cookie) {
  return new Promise((resolve) => {
    const opt = { host: '127.0.0.1', port: srv.address().port, path: caminho, headers: {} };
    if (cookie) opt.headers.cookie = cookie;
    http.get(opt, (r) => {
      let b = ''; r.on('data', (d) => (b += d));
      r.on('end', () => { try { resolve({ status: r.statusCode, corpo: JSON.parse(b) }); } catch (e) { resolve({ status: r.statusCode, corpo: null }); } });
    }).on('error', () => resolve({ status: 0, corpo: null }));
  });
}

srv.listen(0, '127.0.0.1', async () => {
  const comChave = await pegar('/api/debug/tiktok-devolucoes?coletar=1&k=' + ADMIN_KEY);
  ok(comChave.status === 200 && comChave.corpo && comChave.corpo.ok,
     'com ?k=ADMIN_KEY, a sonda roda mesmo sem estar logado na GOOD');

  const comCookie = await pegar('/api/debug/tiktok-devolucoes', 'sessao=valida');
  ok(comCookie.status === 200, 'com o cookie de admin tambem roda, como antes');

  const semNada = await pegar('/api/debug/tiktok-devolucoes');
  ok(semNada.status === 401, 'sem chave e sem cookie continua barrado');

  const chaveErrada = await pegar('/api/debug/tiktok-devolucoes?k=chute');
  ok(chaveErrada.status === 401, '  e chave errada nao passa');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  srv.close();
  process.exit(falhas ? 1 : 0);
});
