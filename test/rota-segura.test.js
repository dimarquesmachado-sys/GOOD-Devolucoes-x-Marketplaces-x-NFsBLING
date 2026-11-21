'use strict';
// b794 (V-14) — HANDLER `async` QUE ESTOURA NAO DERRUBA O PROCESSO (lib/rota-segura.js), com o Express INSTALADO.
//
// O Express 4 nao olha a promessa que o handler devolve: erro em handler `async`, fora de `try`, vira rejeicao sem dono e
// o Node encerra o processo. Em 21/11 isso foi MEDIDO no server.js de verdade (46 rotas, duas publicas — ver
// test/entrada-hostil-nao-derruba.test.js). A peca fecha a classe num ponto so. Este teste prova, executando:
//   0. a PREMISSA, num processo a parte: sem a peca, uma rejeicao num handler mata o processo; com a peca, ele responde
//      500 e segue de pe. (Se um dia o Express passar a tratar isso sozinho, a premissa cai e este teste avisa.)
//   1. o que a peca faz, rota por rota: rejeicao e throw viram 500 curto em JSON; erro 4xx continua 4xx; Router e app
//      montado sobem pro mesmo tratador; tratador de erro `async` que rejeita tambem; tratador de erro da propria rota
//      continua valendo; quem ja respondeu nao recebe segunda resposta; o fluxo normal (next) nao muda;
//   2. o que vai pro registro: uma linha, sem a query (pode trazer chave) e sem pilha inteira;
//   3. instalar duas vezes nao empilha; Express sem a peca interna esperada ESTOURA na instalacao (nao sobe sem protecao).
// Roda com: node test/rota-segura.test.js
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const rotaSegura = require('../lib/rota-segura');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

function pedir(porta, caminho, { metodo = 'GET', corpo = null, tipo = 'application/json' } = {}) {
  return new Promise((resolve) => {
    const dados = corpo == null ? null : Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, agent: false,
      headers: dados ? { 'content-type': tipo, 'content-length': dados.length } : {} }, (res) => {
      let c = ''; res.on('data', (x) => { c += x; });
      res.on('end', () => { let j = null; try { j = JSON.parse(c); } catch (e) { /* nao e JSON */ } resolve({ status: res.statusCode, corpo: c, json: j, tipo: String(res.headers['content-type'] || '') }); });
      res.on('error', () => resolve({ status: -1, corpo: '', json: null, tipo: '' }));
    });
    req.setTimeout(4000, () => { resolve({ status: 'tempo', corpo: '', json: null, tipo: '' }); try { req.destroy(); } catch (e) { /* ja foi */ } });
    req.on('error', () => resolve({ status: 0, corpo: '', json: null, tipo: '' }));
    if (dados) req.write(dados);
    req.end();
  });
}
const ouvir = (app) => new Promise((r) => { const srv = app.listen(0, '127.0.0.1', () => r(srv)); });
const interno = (r) => r.status === 500 && r.json && r.json.ok === false && /erro interno/.test(r.json.erro) && /json/.test(r.tipo) && !/\bat \/|node_modules|\.js:\d/.test(r.corpo);

(async () => {
  // ══ 0. a premissa, num processo a parte ══
  console.log('── 0. a premissa (processo a parte): o Express instalado, sem e com a peca');
  const filho = (comPeca) => spawnSync(process.execPath, ['-e', `
    const express = require('express'); const http = require('http');
    ${comPeca ? "const rs = require('./lib/rota-segura'); rs.instalar();" : ''}
    const app = express();
    app.get('/x', async (req, res) => { String(req.query.a); res.json({ ok: true }); });
    ${comPeca ? 'app.use(rs.erroFinal({ registrar: () => {} }));' : ''}
    const srv = app.listen(0, '127.0.0.1', () => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: '/x?a[toString]=1', agent: false }, (res) => { res.resume(); res.on('end', () => console.log('STATUS ' + res.statusCode)); }).on('error', () => console.log('SEM RESPOSTA'));
      setTimeout(() => { console.log('VIVO'); process.exit(0); }, 700);
    });`], { cwd: RAIZ, encoding: 'utf8', timeout: 20000, env: Object.assign({}, process.env, { NODE_ENV: 'test' }) });
  const sem = filho(false); const com = filho(true);
  ok(sem.status !== 0 && !/VIVO/.test(sem.stdout) && /Cannot convert object to primitive value/.test(sem.stderr),
    '⚠️ SEM a peca: `?a[toString]=1` num handler async MATA o processo (o Express ' + require('express/package.json').version + ' entrega um objeto, o String() estoura, a rejeicao fica sem dono) — saida ' + sem.status);
  ok(com.status === 0 && /STATUS 500/.test(com.stdout) && /VIVO/.test(com.stdout), '⚠️ COM a peca: o mesmo pedido responde 500 e o processo segue de pe — ' + com.stdout.trim().replace(/\n/g, ' / '));

  // ══ 1. o que a peca faz ══
  console.log('\n── 1. rota por rota');
  ok(rotaSegura.instalar() === true, '  instalar() troca a peca do Express');
  ok(rotaSegura.instalar() === false, '⚠️ instalar() de novo nao empilha (uma vez por processo)');
  const linhas = [];
  const app = express();
  app.use(express.json());
  app.get('/rejeita', async () => { throw new Error('quebrou la dentro'); });
  app.get('/converte', async (req, res) => { res.json({ v: String(req.query.a) }); });
  app.get('/sincrono', () => { throw new Error('quebrou sem async'); });
  app.get('/rejeita-vazio', () => Promise.reject());   // rejeitou sem dizer por que
  app.get('/erro-com-endereco', async () => { throw new Error('Shopee GET https://partner.exemplo/api/v2/order?access_token=TOKEN-SECRETO-1&sign=ASSINATURA-2 -> 500 (Authorization: Bearer CHAVE-3.abc)'); });
  app.get('/cliente', async () => { const e = new Error('faltou o campo'); e.status = 422; throw e; });
  app.get('/ok', async (req, res) => { res.json({ ok: true, a: req.query.a || null }); });
  app.get('/passa', async (req, res, next) => { await new Promise((r) => setTimeout(r, 5)); next(); }, (req, res) => res.json({ ok: true, chegou: 'no segundo' }));
  app.get('/ja-respondeu', async (req, res) => { res.json({ ok: true, primeira: true }); throw new Error('estourou depois de responder'); });
  app.get('/erro-da-rota', async () => { throw new Error('a rota trata o proprio erro'); }, (err, req, res, next) => { res.status(418).json({ ok: false, tratado_pela_rota: true }); });   // eslint-disable-line no-unused-vars
  app.get('/tratador-async', async () => { throw new Error('primeiro erro'); }, async (err, req, res, next) => { throw new Error('o tratador tambem quebrou'); });   // eslint-disable-line no-unused-vars
  const roteador = express.Router();
  roteador.get('/rejeita', async (req) => { String(req.query.a); });
  app.use('/roteador', roteador);
  const montado = express();
  montado.get('/rejeita', async (req) => { String(req.query.a); });
  app.use('/montado', montado);
  // um middleware COMUM depois das rotas (como um "nao achei" da casa): com erro no caminho, o Express tem que PULAR ele
  app.use(function depoisDasRotas(req, res, next) { next(); });
  app.use(rotaSegura.erroFinal({ registrar: (l) => linhas.push(l) }));
  const srv = await ouvir(app); const porta = srv.address().port;
  try {
    let r = await pedir(porta, '/rejeita');
    ok(interno(r), '⚠️ handler async que rejeita: 500 curto em JSON, sem pilha — ' + r.status + ' ' + r.corpo);
    r = await pedir(porta, '/converte?a[toString]=1');
    ok(interno(r), '⚠️ o caso medido (`String(req.query.a)` com `?a[toString]=1`): 500, e nao a morte do processo');
    r = await pedir(porta, '/converte?a=7');
    ok(r.status === 200 && r.json && r.json.v === '7', '  a mesma rota com entrada normal: como sempre');
    r = await pedir(porta, '/sincrono');
    ok(interno(r), '  throw fora de async (o Express ja segurava): agora tambem sai no 500 curto em JSON');
    r = await pedir(porta, '/rejeita-vazio');
    ok(interno(r), '  rejeicao SEM motivo (Promise.reject() puro): ainda assim vira erro, nao "passa pra proxima rota"');
    r = await pedir(porta, '/cliente');
    ok(r.status === 422 && r.json && r.json.ok === false && r.json.erro === 'pedido invalido', '⚠️ erro que traz status 4xx continua 4xx (nao vira 500) — ' + r.status + ' ' + r.corpo);
    r = await pedir(porta, '/ok', { metodo: 'POST', corpo: '{"a":' });
    ok(r.status === 400 && r.json && r.json.erro === 'pedido invalido', '⚠️ corpo JSON quebrado (erro do leitor de corpo): 400 em JSON — ' + r.status + ' ' + r.corpo.slice(0, 60));
    r = await pedir(porta, '/passa');
    ok(r.status === 200 && r.json && r.json.chegou === 'no segundo', '⚠️ o fluxo normal nao muda: middleware async que chama next() segue pra proxima');
    r = await pedir(porta, '/roteador/rejeita?a[toString]=1');
    ok(interno(r), '⚠️ rota dentro de um Router montado: o erro sobe pro mesmo tratador final');
    r = await pedir(porta, '/montado/rejeita?a[toString]=1');
    ok(interno(r), '⚠️ rota dentro de um app montado (como as empresas da fabrica): idem');
    r = await pedir(porta, '/erro-da-rota');
    ok(r.status === 418 && r.json && r.json.tratado_pela_rota === true, '⚠️ tratador de erro da PROPRIA rota continua valendo (a rejeicao chega nele)');
    r = await pedir(porta, '/tratador-async');
    ok(interno(r), '⚠️ tratador de erro `async` que rejeita tambem nao derruba: 500');
    const antes = linhas.length;
    r = await pedir(porta, '/ja-respondeu');
    await new Promise((res) => setTimeout(res, 150));
    ok(r.status === 200 && r.json && r.json.primeira === true, '⚠️ handler que respondeu e DEPOIS estourou: a resposta dele chegou inteira (sem segunda resposta por cima)');
    r = await pedir(porta, '/ok');
    ok(r.status === 200 && r.json && r.json.ok === true, '  e o processo continua atendendo depois de tudo isso');
    ok(linhas.length === antes, '  (erro depois da resposta nao passa pelo registro curto — quem encerra a conexao e o Express)');
    r = await pedir(porta, '/nao-existe');
    ok(r.status === 404, '  rota que nao existe continua 404 (o tratador final so entra com erro)');

    // ══ 2. o registro ══
    console.log('\n── 2. o que vai pro registro');
    linhas.length = 0;
    await pedir(porta, '/roteador/rejeita?a[toString]=1&k=CHAVE-SECRETA-123');
    ok(linhas.length === 1 && /^\[erro-rota\] GET \/roteador\/rejeita — Cannot convert object to primitive value/.test(linhas[0]), '⚠️ UMA linha por erro, com metodo, caminho e mensagem — ' + (linhas[0] || '').slice(0, 110));
    ok(linhas.length === 1 && !/CHAVE-SECRETA|\?|toString\]/.test(linhas[0]), '⚠️ sem a QUERY (ela pode trazer chave) — so o caminho');
    ok(linhas.length === 1 && linhas[0].length < 600 && linhas[0].split('\n').length === 1, '  curta e numa linha so (com as duas primeiras posicoes da pilha, pra achar onde foi)');
    linhas.length = 0;
    await pedir(porta, '/rejeita');
    ok(linhas.length === 1 && /quebrou la dentro/.test(linhas[0]), '⚠️ o erro ORIGINAL chega no registro — os middlewares comuns que vem depois da rota sao pulados, nao chamados com o erro no lugar do pedido — ' + (linhas[0] || '').slice(0, 90));
    linhas.length = 0;
    await pedir(porta, '/erro-com-endereco');
    ok(linhas.length === 1 && /Shopee GET https:\/\/partner\.exemplo\/api\/v2\/order\?…/.test(linhas[0]) && !/TOKEN-SECRETO|ASSINATURA|CHAVE-3/.test(linhas[0]),
      '⚠️ mensagem de erro que traz um endereco com token na query (ou um "Bearer ..."): o registro guarda o endereco SEM a query e sem a credencial — ' + (linhas[0] || '').slice(0, 120));
    linhas.length = 0;
    await pedir(porta, '/cliente');
    ok(linhas.length === 0, '  erro 4xx (do cliente) nao enche o registro');
  } finally { srv.close(); }

  // ══ 3. Express sem a peca esperada ══
  console.log('\n── 3. Express diferente por dentro');
  let estourou = null;
  try { rotaSegura.instalar(function LayerSemNada() {}); } catch (e) { estourou = e; }
  ok(estourou && /rota-segura/.test(estourou.message) && /versao/.test(estourou.message), '⚠️ sem a peca interna que ela troca, instalar() ESTOURA com mensagem clara — o servico nao sobe sem a protecao');
  const Falso = function LayerFalso() {}; Falso.prototype.handle_request = function () {}; Falso.prototype.handle_error = function () {};
  ok(rotaSegura.instalar(Falso) === true && rotaSegura.instalar(Falso) === false, '  (com a peca presente, instala uma vez)');

  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA ' + (e && e.stack || e)); process.exit(1); });
