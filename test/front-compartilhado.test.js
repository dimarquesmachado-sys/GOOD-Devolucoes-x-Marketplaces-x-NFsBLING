// Roda com: node test/front-compartilhado.test.js
//
// A AMB serve os modulos IDENTICOS direto da pasta da GOOD.
//
// Por que: o base-amb.js sempre disse que os arquivos da AMB sao "os da
// GOOD, SEM UMA LINHA ALTERADA" — ele so poe o prefixo /amb em tempo de
// execucao. A copia era o mecanismo de atualizacao e dependia de alguem
// lembrar de copiar. Em 29/08 ninguem lembrou: o leitor de etiqueta foi
// consertado so na GOOD, e a AMB — onde o problema tinha sido relatado —
// ficou pra tras. Antes disso, o mesmo com o filtro de defeitos e a
// coluna de data.

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const APP_AMB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');

// a lista de compartilhados sai do proprio app-AMB.js
const mLista = APP_AMB.match(/const JS_COMPARTILHADOS = \[([\s\S]*?)\];/);
ok(!!mLista, 'app-AMB.js declara a lista de modulos compartilhados');
const COMPARTILHADOS = (mLista ? mLista[1] : '').match(/'([^']+)'/g).map((x) => x.replace(/'/g, ''));
ok(COMPARTILHADOS.length === 9, '  com os 9 arquivos que eram identicos');

// ── as copias sumiram de verdade ────────────────────────────────────
COMPARTILHADOS.forEach((f) => {
  ok(!fs.existsSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'js-AMB', f)),
     'nao existe mais copia local de ' + f);
  ok(fs.existsSync(path.join(RAIZ, 'public', 'js', f)), '  e o original da GOOD esta la');
});

// ── o que DEVE continuar separado ───────────────────────────────────
['auth.js', 'busca.js', 'defeitos-ficha.js', 'base-amb.js'].forEach((f) => {
  ok(fs.existsSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'js-AMB', f)),
     f + ' continua proprio da AMB (diverge de verdade, ou so existe aqui)');
  ok(COMPARTILHADOS.indexOf(f) === -1, '  e fora da lista de compartilhados');
});

// ── o HTML nao precisou mudar ───────────────────────────────────────
const HTML = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'index-AMB.html'), 'utf8');
COMPARTILHADOS.forEach((f) => {
  if (HTML.indexOf('js-AMB/' + f) === -1) return;   // nem todo modulo entra nesta tela
  ok(true, 'o HTML segue pedindo js-AMB/' + f + ' (nada mudou pro navegador)');
});

// ── e a rota entrega mesmo? sobe um Express e bate nela ─────────────
const app = express();
const router = express.Router();
const JS_COMPARTILHADOS = COMPARTILHADOS;
router.use('/js-AMB', (req, res, next) => {
  const nome = String(req.path || '').replace(/^\//, '');
  if (JS_COMPARTILHADOS.indexOf(nome) === -1) return next();
  res.sendFile(path.join(RAIZ, 'public', 'js', nome), (err) => { if (err) next(); });
});
router.use(express.static(path.join(RAIZ, 'amb-devolucoes', 'public-AMB')));
app.use('/amb', router);

const srv = http.createServer(app);
function pegar(caminho) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: caminho }, (r) => {
      let b = ''; r.on('data', (d) => (b += d));
      r.on('end', () => resolve({ status: r.statusCode, corpo: b }));
    }).on('error', () => resolve({ status: 0, corpo: '' }));
  });
}

srv.listen(0, '127.0.0.1', async () => {
  // o compartilhado vem da GOOD, byte a byte
  const daGood = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'colar-imagem.js'), 'utf8');
  const r1 = await pegar('/amb/js-AMB/colar-imagem.js');
  ok(r1.status === 200, 'GET /amb/js-AMB/colar-imagem.js responde 200');
  ok(r1.corpo === daGood, '  e entrega EXATAMENTE o arquivo da GOOD');
  ok(/lerQrNoCanvas/.test(r1.corpo), '  ou seja: o conserto do QR chega na AMB sem ninguem copiar');

  // o proprio da AMB continua vindo da pasta dela
  const authAmb = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'js-AMB', 'auth.js'), 'utf8');
  const r2 = await pegar('/amb/js-AMB/auth.js');
  ok(r2.status === 200, 'GET /amb/js-AMB/auth.js responde 200');
  ok(r2.corpo === authAmb, '  e entrega a versao DA AMB (que diverge de proposito)');

  // o adaptador, que so existe aqui
  const r3 = await pegar('/amb/js-AMB/base-amb.js');
  ok(r3.status === 200 && /ADAPTADOR DE CAMINHO/.test(r3.corpo),
     'GET /amb/js-AMB/base-amb.js continua servindo o adaptador da AMB');

  // arquivo inexistente nao vira 200 vazio
  const r4 = await pegar('/amb/js-AMB/nao-existe.js');
  ok(r4.status === 404, 'arquivo inexistente responde 404 (nao entrega corpo vazio como se fosse js)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  srv.close();
  process.exit(falhas ? 1 : 0);
});
