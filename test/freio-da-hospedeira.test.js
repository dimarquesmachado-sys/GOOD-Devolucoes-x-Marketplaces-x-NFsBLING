'use strict';
// b659 — a GOOD obedece ao MESMO freio por env das outras empresas.
//
// ⚠️ O QUE ESTE TESTE PROTEGE
//
// A GOOD nao passa por `montarEmpresas` (e o servidor que hospeda as outras),
// entao DEVOLUCOES_DESATIVAR_GOOD=1 nao fazia nada: as rotinas dela subiam e a
// raiz servia a tela dela mesmo com a empresa encerrada. Agora:
//   1. o middleware `freioDaHospedeira` (funcao de PRODUCAO, lib/montagem-empresas)
//      fecha o espaco dela e deixa passar so empresas montadas + caminhos do servico;
//   2. nenhum agendamento de boot da GOOD escapa do interruptor `agendaGood`
//      (invariante de texto: zero `drenagem.daquiA/intervalo(` solto no server.js);
//   3. BOOT REAL com a env ligada: /health lista good=desativada_por_env, a raiz
//      redireciona pra DEVOLUCOES_RAIZ, a tela e a API da GOOD respondem 503, os
//      caminhos do servico seguem vivos, as instancias montadas seguem vivas, e a
//      GOOD registra MENOS timers do que com a env desligada.
//
// Roda com: node test/freio-da-hospedeira.test.js

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

// ── 1. o middleware, com a funcao de producao ───────────────────────
{
  const { freioDaHospedeira, registrarHospedeira, diagnostico, montarEmpresas } = require('../lib/montagem-empresas');
  const freio = freioDaHospedeira({
    chave: 'good', rotasAtivas: ['/amb', '/girassol'],
    caminhosDoServico: ['/health', '/api/interno', '/politica-de-privacidade'], raiz: '/girassol',
  });
  function chama(p, method = 'GET', accept = 'text/html') {
    const out = {}; let passou = false;
    const res = {
      status(c) { out.status = c; return this; }, type(t) { out.type = t; return this; },
      send(b) { out.body = String(b); }, json(o) { out.json = o; }, redirect(c, u) { out.redirect = [c, u]; },
    };
    freio({ path: p, method, headers: { accept } }, res, () => { passou = true; });
    return passou ? 'NEXT' : out;
  }
  const r1 = chama('/');
  ok(r1 !== 'NEXT' && r1.redirect && r1.redirect[0] === 302 && r1.redirect[1] === '/girassol/',
     '⚠️ a raiz (GET html) redireciona pra DEVOLUCOES_RAIZ com barra final');
  const r2 = chama('/painel-devolucoes.html');
  ok(r2 !== 'NEXT' && r2.status === 503 && r2.type === 'html' && /desativada/.test(r2.body) && /\/girassol\//.test(r2.body),
     '  tela da GOOD: 503 em HTML, com os links das empresas ativas');
  ok(r2 !== 'NEXT' && !/DESATIVAR/.test(r2.body), '  e a pagina NAO revela o nome da env');
  const r3 = chama('/api/triagem/status/x', 'GET', 'application/json');
  ok(r3 !== 'NEXT' && r3.status === 503 && r3.json && r3.json.empresa === 'good' && r3.json.estado === 'desativada_por_env',
     '  API da GOOD: 503 JSON no mesmo formato de rotaIndisponivel');
  ok(chama('/%70ainel-devolucoes.html') !== 'NEXT', '  caminho codificado (%70ainel) tambem fecha');
  const r4 = chama('/%E0%A4%A');
  ok(r4 !== 'NEXT' && r4.status === 503, '  caminho malformado fecha (503), nunca abre');
  ok(chama('/amb/painel') === 'NEXT' && chama('/girassol/api/triagem/fila') === 'NEXT', '  empresa montada passa');
  ok(chama('/ambx') !== 'NEXT', '  mas /ambx nao e /amb');
  ok(chama('/health') === 'NEXT' && chama('/api/interno/evento-checkout', 'POST', '*/*') === 'NEXT'
     && chama('/politica-de-privacidade/') === 'NEXT', '  caminhos do servico passam (health, ponte, paginas publicas)');
  const r5 = chama('/', 'POST', '*/*');
  ok(r5 !== 'NEXT' && r5.status === 503 && r5.json, '  POST na raiz nao redireciona: 503 JSON');
  const semRaiz = freioDaHospedeira({ chave: 'good', rotasAtivas: ['/amb'], caminhosDoServico: [] });
  { const out = {}; semRaiz({ path: '/', method: 'GET', headers: { accept: 'text/html' } },
      { status(c) { out.status = c; return this; }, type() { return this; }, send(b) { out.body = String(b); }, json() {}, redirect() { out.redirect = true; } }, () => {});
    ok(!out.redirect && out.status === 503 && /\/amb\//.test(out.body), '  sem DEVOLUCOES_RAIZ: a raiz mostra a pagina com os links'); }

  montarEmpresas({ app: { use() {} }, empresas: [], criarApp: () => ({}), logger: { log() {}, warn() {}, error() {} } });
  registrarHospedeira({ chave: 'good', rota: '/', estado: 'desativada_por_env' });
  const d = diagnostico().find((x) => x.chave === 'good');
  ok(d && d.estado === 'desativada_por_env' && d.rota === '/', '  registrarHospedeira entra no diagnostico do /health');
}

// ── 2. invariante de texto: nenhum agendamento da GOOD fora do interruptor ──
{
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const soltos = [...srv.matchAll(/\bdrenagem\.(daquiA|intervalo)\(/g)].length;
  ok(soltos === 0, `⚠️ zero agendamento de boot da GOOD fora de agendaGood (achei ${soltos})`);
  ok(/const agendaGood = GOOD_DESLIGADA \? \{ daquiA\(\) \{\}, intervalo\(\) \{\} \} : drenagem;/.test(srv),
     '  agendaGood e um interruptor: desligada = nao agenda nada');
  ok([...srv.matchAll(/\bagendaGood\.(daquiA|intervalo)\(/g)].length >= 16, '  e os 16 agendamentos passam por ele');
  ok(/if \(!GOOD_DESLIGADA\) shopee\.iniciarPreAquecimento\(\);/.test(srv), '  a Shopee da GOOD so pre-aquece com ela ligada');
  ok(/registrarHospedeira\(\{ chave: 'good'/.test(srv) && /app\.use\(freioDaHospedeira\(\{/.test(srv),
     '  o server registra a hospedeira e instala o freio na montagem');
  ok(/const GOOD_DESLIGADA = _freadaEmpresa\('good'\);/.test(srv), '  e o interruptor vem do MESMO freada() das outras empresas');
}

// ── 3. boot real ────────────────────────────────────────────────────
function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
function pedir(porta, caminho, { method = 'GET', accept = 'text/html' } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method, headers: { accept } }, (res) => {
      let corpo = ''; res.on('data', (c) => { corpo += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo }));
    });
    req.on('error', () => resolve({ status: 0, headers: {}, corpo: '' }));
    req.setTimeout(4000, () => { req.destroy(); resolve({ status: 0, headers: {}, corpo: '' }); });
    req.end();
  });
}
async function boot(envExtra) {
  const porta = await portaLivre();
  const env = Object.assign({}, process.env, { ADMIN_KEY: 'x', PORT: String(porta) }, envExtra);
  const filho = spawn(process.execPath, ['-e',
    "require('./server.js'); setTimeout(() => { console.log('TIMERS=' + require('./lib/drenagem').diagnostico().timers_registrados); }, 2500);"],
    { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  filho.stdout.on('data', (c) => { saida += c; });
  filho.stderr.on('data', (c) => { saida += c; });
  let health = null;
  for (let i = 0; i < 40 && !health; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const h = await pedir(porta, '/health', { accept: 'application/json' });
    if (h.status === 200) { try { health = JSON.parse(h.corpo); } catch (e) { health = null; } }
  }
  const timers = async () => {
    for (let i = 0; i < 20; i++) {
      const m = saida.match(/TIMERS=(\d+)/); if (m) return Number(m[1]);
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  };
  return { porta, filho, health, timers, log: () => saida, matar: () => { try { filho.kill('SIGKILL'); } catch (e) { /* ja morreu */ } } };
}

(async () => {
  // ligada (sem a env): a raiz NAO e 503 e o /health diz montada
  const on = await boot({ DEVOLUCOES_DESATIVAR_GOOD: '' });
  ok(!!on.health, 'boot com a GOOD ligada: /health respondeu');
  const dOn = on.health && on.health.coordenacao && on.health.coordenacao.montagem_empresas;
  ok(Array.isArray(dOn) && dOn.some((e) => e.chave === 'good' && e.estado === 'montada'), '  /health: good = montada');
  const raizOn = await pedir(on.porta, '/');
  ok(raizOn.status !== 503, `  raiz NAO e 503 com a GOOD ligada (veio ${raizOn.status})`);
  const timersOn = await on.timers();
  on.matar();

  // desligada: tudo da GOOD fecha, o resto segue
  const off = await boot({ DEVOLUCOES_DESATIVAR_GOOD: '1', DEVOLUCOES_RAIZ: '/girassol' });
  ok(!!off.health, 'boot com DEVOLUCOES_DESATIVAR_GOOD=1: /health respondeu');
  const dOff = off.health && off.health.coordenacao && off.health.coordenacao.montagem_empresas;
  ok(Array.isArray(dOff) && dOff.some((e) => e.chave === 'good' && e.estado === 'desativada_por_env'), '  /health: good = desativada_por_env');
  const raiz = await pedir(off.porta, '/');
  ok(raiz.status === 302 && raiz.headers.location === '/girassol/', `  raiz redireciona pra /girassol/ (veio ${raiz.status} ${raiz.headers.location || ''})`);
  const tela = await pedir(off.porta, '/painel-devolucoes.html');
  ok(tela.status === 503 && /desativada/.test(tela.corpo) && !/DESATIVAR/.test(tela.corpo), `  tela da GOOD: 503 sem nome de env (veio ${tela.status})`);
  const api = await pedir(off.porta, '/api/triagem/status/x', { accept: 'application/json' });
  let j = null; try { j = JSON.parse(api.corpo); } catch (e) { j = null; }
  ok(api.status === 503 && j && j.empresa === 'good' && j.estado === 'desativada_por_env', `  API da GOOD: 503 JSON (veio ${api.status})`);
  const pub = await pedir(off.porta, '/politica-de-privacidade');
  ok(pub.status !== 503 && pub.status !== 0, `  pagina publica do servico segue viva (veio ${pub.status})`);
  const amb = await pedir(off.porta, '/amb/');
  ok(amb.status !== 503 && amb.status !== 0 && !/foi desativada neste servico/.test(amb.corpo), `  a instancia /amb segue viva (veio ${amb.status})`);
  const timersOff = await off.timers();
  off.matar();
  ok(timersOn != null && timersOff != null && timersOff < timersOn,
     `⚠️ com a GOOD desligada o processo agenda MENOS rotinas (${timersOff} contra ${timersOn} ligada)`);
  const log = off.log();
  ok(/good DESATIVADA por DEVOLUCOES_DESATIVAR_GOOD/.test(log), '  e o log do boot diz o motivo (so no log, nunca na resposta)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
