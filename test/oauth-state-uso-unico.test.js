'use strict';
require('./_fonte-fabrica');   // le a fabrica com os modulos lib-AMB embutidos
// b709 — P1-11 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): O OAUTH MAGALU DA GOOD EXIGE STATE DE USO UNICO.
//
// Ate o b708 a GOOD mandava `state='good'` fixo e o callback nem olhava: qualquer code valido do app que chegasse em
// /magalu/callback era trocado e GRAVADO no Render (troca de conta sem passar pela tela de autorizar). A fabrica ja
// fazia certo (state aleatorio, 10 min, uso unico, por empresa). Agora e UMA peca (lib/oauth-state.js) pras duas.
//
// Tres provas:
//   1. a peca, com relogio simulado: aleatorio, uso unico, vence em 10 min, uma gaveta nao ve a outra (= outra empresa)
//   2. o SERVIDOR DE VERDADE (boot do server.js): /magalu/callback sem state, com o state antigo fixo ('good') ou com
//      um inventado responde 400 "link invalido" — e NAO tenta trocar o code (sem a conferencia, tentava e dava 500)
//   3. a fabrica continua com a MESMA gaveta por empresa (test/oauth-callback-escape ja exercita o consumo)
//
// Roda com: node test/oauth-state-uso-unico.test.js

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

// ── 1. a peca ──
{
  const { criar, VALIDADE_PADRAO_MS } = require(path.join(RAIZ, 'lib', 'oauth-state.js'));
  let relogio = 1_000_000;
  const gaveta = new Map();
  const st = criar({ pendentes: gaveta, agora: () => relogio });
  const a = st.novoState('magalu', { empresa: 'good' });
  const b = st.novoState('magalu', { empresa: 'good' });
  ok(/^[0-9a-f]{48}$/.test(a) && a !== b, 'state e aleatorio (48 hex) e nunca repete');
  const reg = st.consumirState(a);
  ok(reg && reg.servico === 'magalu' && reg.empresa === 'good', '  consumir devolve servico e empresa');
  ok(st.consumirState(a) === null, '⚠️ USO UNICO: o mesmo state nao vale duas vezes');
  ok(st.consumirState('good') === null && st.consumirState('') === null && st.consumirState(undefined) === null, '  state fixo "good", vazio ou ausente: null');
  relogio += VALIDADE_PADRAO_MS + 1;
  ok(st.consumirState(b) === null, '⚠️ VENCE: depois de 10 min o state nao vale (e some da gaveta: ' + gaveta.size + ' sobrando)');
  const outra = criar({ pendentes: new Map(), agora: () => relogio });
  const c = st.novoState('ml');
  ok(outra.consumirState(c) === null && st.consumirState(c) !== null, '⚠️ OUTRA EMPRESA: a gaveta de uma nao ve o state da outra');
  // poda ao gerar
  const d = st.novoState('bling'); relogio += VALIDADE_PADRAO_MS + 1; st.novoState('bling');
  ok(!gaveta.has(d), '  gerar um novo poda os vencidos');
}

// ── 2. o servidor de verdade ──
function portaLivre() { return new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); }); }
function pedir(porta, caminho) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: 'GET', headers: { accept: 'text/html' } }, (res) => {
      let corpo = ''; res.on('data', (c) => { corpo += c; }); res.on('end', () => resolve({ status: res.statusCode, corpo }));
    });
    req.on('error', () => resolve({ status: 0, corpo: '' }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, corpo: '' }); });
    req.end();
  });
}
async function boot() {
  const porta = await portaLivre();
  // Magalu "configurado" com valores falsos: se o callback tentar trocar o code, o axios sai pra rede e falha (500) —
  // e exatamente o que NAO pode acontecer sem state
  const env = Object.assign({}, process.env, { ADMIN_KEY: 'x', PORT: String(porta), MAGALU_CLIENT_ID: 'cid', MAGALU_CLIENT_SECRET: 'sec', MAGALU_REDIRECT_URI: 'https://x/magalu/callback' });
  const filho = spawn(process.execPath, ['-e', "require('./server.js');"], { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = ''; filho.stdout.on('data', (c) => { saida += c; }); filho.stderr.on('data', (c) => { saida += c; });
  let subiu = false;
  for (let i = 0; i < 60 && !subiu; i++) { await new Promise((r) => setTimeout(r, 250)); const h = await pedir(porta, '/health'); if (h.status === 200) subiu = true; }
  return { porta, subiu, log: () => saida, matar: () => { try { filho.kill('SIGKILL'); } catch (e) { /* ja morreu */ } } };
}

(async () => {
  const s = await boot();
  ok(s.subiu, 'server.js subiu (GOOD hospedeira)');
  if (s.subiu) {
    const semState = await pedir(s.porta, '/magalu/callback?code=um-code-qualquer');
    ok(semState.status === 400 && /Link invalido ou expirado/.test(semState.corpo), '⚠️ GOOD /magalu/callback com code e SEM state: 400 link invalido (' + semState.status + ')');
    const fixo = await pedir(s.porta, '/magalu/callback?code=um-code-qualquer&state=good');
    ok(fixo.status === 400 && /Link invalido ou expirado/.test(fixo.corpo), '⚠️ com o state FIXO antigo ("good"): 400 — o atalho morreu (' + fixo.status + ')');
    const inventado = await pedir(s.porta, '/magalu/callback?code=um-code-qualquer&state=' + 'ab'.repeat(24));
    ok(inventado.status === 400, '  com state inventado de 48 hex: 400 (' + inventado.status + ')');
    ok(!/Falha ao trocar o code|Autorizacao concluida/.test(semState.corpo + fixo.corpo + inventado.corpo), '  ⚠️ em nenhum dos tres o servidor TENTOU trocar o code (nem erro de troca, nem sucesso)');
    ok(!/oauth\/token|ECONNREFUSED|ENOTFOUND/.test(s.log()), '  e o log nao tem chamada ao /oauth/token da Magalu');
  }
  s.matar();

  // ── 3. as duas pontas usam a MESMA peca; a GOOD gera o state no autorizar e confere antes do code ──
  const SRV = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const FAB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/const oauthGood = require\('\.\/lib\/oauth-state'\)\.criar\(\);/.test(SRV), 'GOOD: gaveta propria pela peca unica');
  ok(/magalu\.urlConsentimento\(oauthGood\.novoState\('magalu', \{ empresa: 'good' \}\)\)/.test(SRV) && !/urlConsentimento\('good'\)/.test(SRV), '  GOOD /magalu/autorizar: state gerado na hora (o fixo sumiu)');
  {
    const i = SRV.indexOf("app.get('/magalu/callback'"); const f = SRV.indexOf('const code = String(req.query.code', i);
    ok(i >= 0 && f > i && /oauthGood\.consumirState\(String\(req\.query\.state \|\| ''\)\)/.test(SRV.slice(i, f)) && /reg\.servico !== 'magalu' \|\| reg\.empresa !== 'good'/.test(SRV.slice(i, f)),
       '  GOOD /magalu/callback: consome o state ANTES de ler o code, e exige servico magalu + empresa good');
  }
  ok(/const \{ novoState, consumirState \} = require\('\.\.\/lib\/oauth-state'\)\.criar\(\{ pendentes: TRIAGEM\.pendentes \}\);/.test(FAB) && !/function novoState\(/.test(FAB) && !/function consumirState\(/.test(FAB),
     'fabrica: usa a peca com a gaveta da empresa (as funcoes locais sumiram — sem segunda implementacao)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
