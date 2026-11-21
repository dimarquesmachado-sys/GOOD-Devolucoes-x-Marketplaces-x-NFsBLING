'use strict';
// b782 — T-02 (parte 2): um PostgREST DE VERDADE na frente do PostgreSQL 16 descartavel com o schema de producao.
//
// A parte 1 (b777, test/_postgres-descartavel.js) provou o banco: constraints, FKs, sequencias, RLS. Mas o APP nao
// fala SQL — fala supabase-js → PostgREST. O PostgREST falso (test/_postgrest-falso.js) aceita qualquer coluna, entao
// "gravar um campo que a tabela nao tem" passava no teste e, em producao, o PostgREST recusa a gravacao INTEIRA
// (PGRST204 — CLAUDE.md §5 "Banco de dados"). Aqui o mesmo binario que o Supabase usa responde ao server.js.
//
// O que este modulo faz:
//   - baixa o PostgREST (versao FIXA, binario estatico do release oficial no GitHub), confere o sha256 e guarda em
//     cache (pasta temporaria — no CI baixa uma vez por execucao; aqui reaproveita);
//   - da ao papel `service_role` os GRANTs que o Supabase da (o export do schema traz tabela/constraint/RLS, nao grant);
//   - sobe o PostgREST no socket do Postgres descartavel, com o segredo JWT do teste;
//   - poe um proxy na frente que serve em /rest/v1 (o caminho que o supabase-js usa), como o Supabase.
//   - `chave(papel)` assina o JWT (HS256) que vai em SUPABASE_KEY — o mesmo formato da chave service_role real.
//
// Uso:
//   const pg = await subirPostgres();
//   const rest = await subirPostgrestReal(pg);   // { url, chave(papel), pedidos, parar }
//   env.SUPABASE_URL = rest.url; env.SUPABASE_KEY = rest.chave('service_role');
// A versao e a do PROJETO (medida — ver VERSAO). Como medir de novo: no SQL Editor,
//   select distinct application_name from pg_stat_activity where application_name ilike '%postgrest%';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

// b784: a versao do PROJETO, medida pelo dono em 21/11 (SQL Editor: `pg_stat_activity.application_name` = "PostgREST 14.5").
// Era 12.2.3 no b782 (chute documentado). Ao o Supabase atualizar, medir de novo e trocar as 3 linhas.
const VERSAO = 'v14.5';
const URL_BIN = 'https://github.com/PostgREST/postgrest/releases/download/' + VERSAO + '/postgrest-' + VERSAO + '-linux-static-x86-64.tar.xz';
const SHA256 = 'ab5cc7e974d4940447991804588cfb8b3f7b2c57b691f0905df04d51ede69470';
const CACHE = path.join(os.tmpdir(), 'postgrest-cache-' + VERSAO);

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

/** o binario: do cache, ou baixado + conferido pelo sha256 (hash errado = erro, nunca roda o que veio) */
async function binario() {
  const bin = path.join(CACHE, 'postgrest');
  if (fs.existsSync(bin)) return bin;
  fs.mkdirSync(CACHE, { recursive: true });
  const r = await fetch(URL_BIN, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error('download do PostgREST ' + VERSAO + ' falhou: HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (hash !== SHA256) throw new Error('PostgREST baixado NAO bate com o sha256 fixado (' + hash + ') — nao roda');
  const tarball = path.join(CACHE, 'postgrest.tar.xz');
  fs.writeFileSync(tarball, buf);
  execFileSync('tar', ['-xJf', tarball, '-C', CACHE]);
  fs.rmSync(tarball, { force: true });
  if (!fs.existsSync(bin)) throw new Error('o pacote do PostgREST nao trouxe o binario `postgrest`');
  fs.chmodSync(bin, 0o755);
  return bin;
}

const b64url = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(segredo, papel) {
  const cab = b64url({ alg: 'HS256', typ: 'JWT' });
  const corpo = b64url({ iss: 'supabase', role: papel, iat: Math.floor(Date.now() / 1000) - 60, exp: Math.floor(Date.now() / 1000) + 3600 });
  const ass = crypto.createHmac('sha256', segredo).update(cab + '.' + corpo).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return cab + '.' + corpo + '.' + ass;
}

async function subirPostgrestReal(pg) {
  if (!pg || !pg.sock || !pg.porta) throw new Error('subirPostgrestReal precisa do Postgres descartavel (sock + porta)');
  const bin = await binario();
  // os GRANTs que o Supabase da por padrao (o export traz tabela, nao grant)
  pg.sql(`grant usage on schema public to anon, authenticated, service_role;
          grant all on all tables in schema public to service_role;
          grant all on all sequences in schema public to service_role;
          grant all on all routines in schema public to service_role;`);
  const segredo = crypto.randomBytes(32).toString('hex');
  const portaRest = await portaLivre();
  const log = [];
  const filho = spawn(bin, [], {
    env: Object.assign({}, process.env, {
      PGRST_DB_URI: 'postgresql:///postgres?host=' + encodeURIComponent(pg.sock) + '&port=' + pg.porta + '&user=postgres',
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: segredo,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(portaRest),
      PGRST_LOG_LEVEL: 'error',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  filho.stdout.on('data', (d) => log.push(String(d)));
  filho.stderr.on('data', (d) => log.push(String(d)));
  let morreu = null; filho.on('exit', (c) => { morreu = c; });

  // espera o PostgREST responder com o schema carregado
  const chaveSrv = jwt(segredo, 'service_role');
  const ate = Date.now() + 30000;
  for (;;) {
    if (morreu !== null) throw new Error('PostgREST morreu ao subir (saida ' + morreu + '): ' + log.join('').slice(-1500));
    try {
      const r = await fetch('http://127.0.0.1:' + portaRest + '/devolucoes?limit=1', { headers: { Authorization: 'Bearer ' + chaveSrv }, signal: AbortSignal.timeout(2000) });
      if (r.status === 200) break;
    } catch (e) { /* ainda subindo */ }
    if (Date.now() > ate) { filho.kill('SIGKILL'); throw new Error('PostgREST nao respondeu em 30 s: ' + log.join('').slice(-1500)); }
    await new Promise((ok) => setTimeout(ok, 200));
  }

  // proxy em /rest/v1 (o caminho do supabase-js), registrando cada pedido com o status — o teste mostra o que recusou
  const pedidos = [];
  const proxy = http.createServer((req, res) => {
    if (!req.url.startsWith('/rest/v1/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"message":"so /rest/v1 neste teste"}'); return; }
    const alvo = req.url.slice('/rest/v1'.length);
    const reg = { metodo: req.method, caminho: alvo, status: null, erro: null };
    pedidos.push(reg);
    const fwd = http.request({ host: '127.0.0.1', port: portaRest, method: req.method, path: alvo, headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + portaRest }) }, (r) => {
      reg.status = r.statusCode;
      const partes = [];
      r.on('data', (d) => partes.push(d));
      r.on('end', () => {
        const corpo = Buffer.concat(partes);
        if (r.statusCode >= 400) reg.erro = corpo.toString('utf8').slice(0, 400);
        res.writeHead(r.statusCode, r.headers);
        res.end(corpo);
      });
    });
    fwd.on('error', (e) => { reg.erro = String(e.message); res.writeHead(502); res.end(); });
    req.pipe(fwd);
  });
  await new Promise((ok) => proxy.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + proxy.address().port;
  return {
    url,
    versao: VERSAO,
    chave: (papel) => jwt(segredo, papel || 'service_role'),
    pedidos,
    log: () => log.join(''),
    parar: () => { try { proxy.close(); } catch (e) { /* teste */ } try { filho.kill('SIGKILL'); } catch (e) { /* teste */ } },
  };
}

module.exports = { subirPostgrestReal, VERSAO, SHA256 };
