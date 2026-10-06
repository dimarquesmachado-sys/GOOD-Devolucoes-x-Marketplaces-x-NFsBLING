'use strict';
// b569 — a GOOD usa a copia UNICA do Magalu (fabrica da AMB/Girassol) com PREFIXO '' = as variaveis MAGALU_* DELA.
// O risco que este teste trava: prefixo vazio caia em 'AMB_' e a GOOD leria/gravaria os tokens do Magalu da AMB.
const path = require('path'); const fs = require('fs');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
Object.assign(process.env, {
  MAGALU_CLIENT_ID: 'good-client-123', MAGALU_CLIENT_SECRET: 'good-secret', MAGALU_ACCESS_TOKEN: 'good-access', MAGALU_REFRESH_TOKEN: 'good-refresh', MAGALU_REDIRECT_URI: 'https://exemplo/good/callback',
  AMB_MAGALU_CLIENT_ID: 'amb-client-999', AMB_MAGALU_CLIENT_SECRET: 'amb-secret', AMB_MAGALU_ACCESS_TOKEN: 'amb-access', AMB_MAGALU_REFRESH_TOKEN: 'amb-refresh',
});
const gravado = [];
const rt = require(path.join(R, 'lib', 'render-tokens.js'));
rt.atualizarTokensNoRender = async (lista) => { gravado.push(...lista.map((x) => x.key)); return true; };
const fab = require(path.join(R, 'amb-devolucoes', 'lib-AMB', 'magalu-AMB.js'));
const good = fab.criar({ PREFIXO_ENV: '', CHAVE_REGISTRO: 'good' });
const amb = fab.criar({ PREFIXO_ENV: 'AMB_' });
ok(good.cfg.clientId === 'good-client-123', '⚠️ GOOD (prefixo vazio) le o client da GOOD — nunca o da AMB (' + good.cfg.clientId + ')');
ok(amb.cfg.clientId === 'amb-client-999', '  a AMB continua lendo o dela');
const url = good.urlConsentimento('good');
ok(/client_id=good-client-123/.test(url) && /redirect_uri=https%3A%2F%2Fexemplo%2Fgood%2Fcallback/.test(url), '⚠️ a URL de conectar da GOOD usa o client e o endereco de retorno DELA');
ok(good.cfg.redirectUri === 'https://exemplo/good/callback' && typeof good.cfg.scopes === 'string', '  cfg com redirectUri e scopes (a GOOD le)');
(async () => {
  let erro = null;
  try { await good.trocarCodePorTokens(''); } catch (e) { erro = e; }
  ok(erro instanceof Error, '  trocarCodePorTokens LANCA no erro (a rota da GOOD mostra o erro no catch)');
  ok(!gravado.some((k) => /^AMB_/.test(k)), '⚠️ nada gravado com prefixo AMB_ em nome da GOOD (' + (gravado.join(',') || 'nada gravado') + ')');
  // os relogios de 30 min sao criados UMA vez: 3 chamadas de preAquecer nao empilham relogios
  const origSI = global.setInterval; const origST = global.setTimeout; let relogios = 0;
  global.setInterval = (...a) => { relogios++; return { unref() {} }; };
  global.setTimeout = (...a) => ({ unref() {} });
  good.preAquecer(1); good.preAquecer(1); good.preAquecer(1);
  global.setInterval = origSI; global.setTimeout = origST;
  ok(relogios <= 2, '⚠️ 3 pre-aquecimentos criam no maximo os 2 relogios (tickets + espreita), nao 6 (' + relogios + ')');
  const s = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
  ok(/require\('\.\/amb-devolucoes\/lib-AMB\/magalu-AMB'\)\.criar\(\{ PREFIXO_ENV: '', CHAVE_REGISTRO: 'good' \}\)/.test(s) && !/require\('\.\/lib\/magalu'\)/.test(s), '⚠️ server.js da GOOD usa a fabrica unica com prefixo vazio e registro "good"');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
