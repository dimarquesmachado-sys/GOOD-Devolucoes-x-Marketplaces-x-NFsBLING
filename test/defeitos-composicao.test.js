'use strict';

// Monta app-AMB.js DE VERDADE, sem recortar a chamada por texto. Somente
// I/O, autenticação e timers são dublados; configDaEmpresa, a fábrica do
// app, o Express e o servidor comum continuam sendo os módulos reais.
// Processo isolado com ambiente limpo: nenhuma credencial de produção,
// servidor HTTP, renovação preventiva ou conexão externa é utilizada.
const assert = require('assert').strict;
const path = require('path');
const { execFileSync } = require('child_process');

async function isolado() {
  const Module = require('module');
  const registrarReal = require('../lib/defeitos-ciclo');
  const { configDaEmpresa } = require('../lib/config-da-empresa');
  const { obterEmpresa } = require('../lib/empresas');
  const carregarReal = Module._load;
  const registrarPath = require.resolve('../lib/defeitos-ciclo');
  const cfgPath = require.resolve('../lib/config-da-empresa');
  const authPath = require.resolve('../amb-devolucoes/lib-AMB/auth-AMB');
  const dbPath = require.resolve('../amb-devolucoes/lib-AMB/supabase-AMB');
  const blingPath = require.resolve('../amb-devolucoes/lib-AMB/bling-AMB');
  const capturas = []; const configs = new Map(); const clientes = new Map();
  const auths = new Map(); const bancos = new Map(); const chamadas = [];

  // Timers não executam callbacks; o preaquecimento aguarda um timer que
  // nunca dispara, e a preventiva nunca renova qualquer credencial.
  const timerInerte = () => ({ unref() {}, ref() {} });
  global.setTimeout = timerInerte; global.setInterval = timerInerte;
  global.clearTimeout = () => {}; global.clearInterval = () => {};
  global.fetch = async () => { throw new Error('rede proibida no teste de composição'); };

  Module._load = function (pedido, pai, main) {
    const arquivo = Module._resolveFilename(pedido, pai, main);
    if (/defeitos-ciclo-AMB\.js$/.test(arquivo)) throw new Error('app voltou a montar a copia AMB');
    if (arquivo === registrarPath) return (router, deps) => {
      const antes = router.stack.length;
      registrarReal(router, deps);
      capturas.push({ router, deps, rotas: router.stack.slice(antes) });
    };
    if (arquivo === cfgPath) return { configDaEmpresa(chave) {
      const cfg = configDaEmpresa(chave); configs.set(chave, cfg); return cfg;
    } };
    if (arquivo === authPath) return { criar(cfg) {
      const auth = {
        COOKIE: cfg.cookie, CAMINHO: cfg.caminhoCookie,
        requerLogin(req, res, next) { req.usuario = cfg.cookie; req.tipoUsuario = 'admin'; return next(); },
        requerAdmin(req, res, next) { return next(); },
        temUsuarios() { return true; },
      };
      auths.set(cfg.cookie, auth); return auth;
    } };
    if (arquivo === dbPath) return { criar(cfg) {
      const cliente = { from(tabela) {
        chamadas.push({ empresa: cfg.CHAVE_REGISTRO, tabela });
        const cadeia = {
          insert(linhas) { this.linhas = linhas; return this; },
          select() { return this; },
          limit() { return Promise.resolve({ data: [{ id: 1, ...this.linhas[0] }], error: null }); },
        };
        return cadeia;
      } };
      const db = { tabelas: cfg.supabase.tabelas, conectar: () => cliente,
        resolverSku: async sku => ({ sku: cfg.CHAVE_REGISTRO + ':' + sku, trocado: true }) };
      bancos.set(cfg.CHAVE_REGISTRO, { db, cliente }); return db;
    } };
    if (arquivo === blingPath) return { criar(cfg) {
      const bling = {
        cfg, temToken: () => false,
        chamarBling: async (...args) => ({ empresa: cfg.CHAVE_REGISTRO, args }),
        aguardarVez: async () => {},
      };
      clientes.set(cfg.CHAVE_REGISTRO, bling); return bling;
    } };
    if (pedido === 'axios') {
      const proibido = () => { throw new Error('axios proibido no teste de composição'); };
      return Object.assign(proibido, { get: proibido, post: proibido, request: proibido, create: () => proibido });
    }
    if (pedido === '@supabase/supabase-js') return { createClient() { throw new Error('conexão Supabase proibida no teste de composição'); } };
    return carregarReal.apply(this, arguments);
  };

  try {
    const app = require('../amb-devolucoes/app-AMB');
    for (const chave of ['girassol', 'ambtotal']) {
      const router = app.criar(chave);
      const c = capturas[capturas.length - 1];
      const ficha = obterEmpresa(chave); const cfg = configs.get(chave);
      assert(c && c.router === router, 'o ciclo comum não recebeu o router desta montagem');
      assert.equal(c.deps.modelo.tabelas, cfg.supabase.tabelas);
      assert.equal(cfg.defeitos, ficha.defeitos);
      for (const [campo, valor] of Object.entries(ficha.defeitos)) assert.equal(c.deps.modelo[campo], valor);
      assert.equal(c.deps.DEPOSITO_GERAL, cfg.fiscal.depositoGeral());
      assert.equal(c.deps.requerLogin, auths.get(cfg.AUTH.cookie).requerLogin);
      assert.equal(c.deps.supabase(), bancos.get(chave).cliente);
      assert.equal((await c.deps.resolverSku('antigo')).sku, chave + ':antigo');
      assert.equal((await c.deps.chamarBling('/produtos', { method: 'GET' })).empresa, chave);
      assert.equal(c.rotas.length, 16);
      assert(c.rotas.every(r => r.route && r.route.path.startsWith('/api/defeitos/')));

      // Executa a rota COMPOSTA (não uma segunda chamada ao registrar),
      // passando pela autenticação injetada no app-AMB e pelo banco dele.
      const comentario = c.rotas.find(r => r.route.path === '/api/defeitos/:id/comentario');
      assert(comentario && comentario.route.methods.post);
      const req = { params: { id: '9' }, body: { texto: 'comentario da ' + chave } };
      const res = { statusCode: 200, status(codigo) { this.statusCode = codigo; return this; }, json(corpo) { this.body = corpo; return this; } };
      let indice = 0;
      const next = () => { const h = comentario.route.stack[indice++]; return h && h.handle(req, res, next); };
      await next();
      assert.equal(res.statusCode, 200); assert.equal(res.body.ok, true);
      assert.equal(res.body.comentario.quem, cfg.AUTH.cookie);
      const sufixo = ficha.tabelas.devolucoes.slice('devolucoes'.length);
      assert.deepEqual(chamadas[chamadas.length - 1], { empresa: chave, tabela: 'defeito_comentarios' + sufixo });
    }
    assert.equal(capturas.length, 2);
    assert.notEqual(capturas[0].deps.supabase(), capturas[1].deps.supabase());
    assert.notEqual(capturas[0].deps.requerLogin, capturas[1].deps.requerLogin);
    console.log(JSON.stringify({ ok: true, empresas: ['girassol', 'ambtotal'], rotasPorEmpresa: 16 }));
  } finally { Module._load = carregarReal; }
}

if (process.argv.includes('--isolado')) {
  isolado().catch(e => { console.error('FALHA ' + e.stack); process.exitCode = 1; });
} else {
  try {
    const saida = execFileSync(process.execPath, [__filename, '--isolado'], {
      cwd: path.join(__dirname, '..'),
      env: { PATH: process.env.PATH || '', NODE_ENV: 'test', ADMIN_KEY: 'chave-hermetica',
        GIRASSOL_SESSION_SECRET: 'segredo-girassol-de-teste-com-40-caracteres',
        AMB_SESSION_SECRET: 'segredo-ambtotal-de-teste-com-40-caracteres' },
      stdio: 'pipe', timeout: 15000,
    }).toString();
    const resultado = JSON.parse(saida.trim().split('\n').pop());
    assert.equal(resultado.ok, true);
    console.log('ok  app-AMB real monta Girassol e AMBTotal com o ciclo comum e a config da própria empresa');
    console.log('ok  as duas rotas de comentário compostas autenticam e escrevem nas tabelas próprias');
  } catch (e) {
    console.error('FALHA composição real: ' + (String(e.stderr || '').trim() || String(e.stdout || '').trim() || e.stack || String(e)));
    process.exitCode = 1;
  }
}
