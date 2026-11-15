'use strict';
// b260/b267 — 403 DO ML: RENOVA NO MAXIMO 1x POR ROTA A CADA 10 MIN (o refresh do ML e de uso unico).
//
// ⚠️ O ACHADO (telemetria de 09/09, 113 min de operacao real): 10 respostas 403 do ML e 10 retries falhados — cem por
// cento. Cada uma disparou uma renovacao, e cada renovacao QUEIMA UM REFRESH DE USO UNICO. 403 de permissao nao melhora
// com token novo. Entao: a chave e a ROTA (nao o id — o ciclo visita 60 ids por rodada), a janela expira sozinha, e o
// relogio so anda SE o refresh foi gasto. O 401 NAO passa pelo limite: token vencido de verdade tem que renovar sempre.
//
// b702: este teste inspecionava o fonte de `lib/ml.js` (a copia da GOOD). A GOOD passou a usar a PECA UNICA
// (amb-devolucoes/lib-AMB/ml-AMB.js), entao agora ele EXERCITA o `chamarML` da GOOD com a rede simulada — e vale, por
// construcao, pras tres empresas. Uma regra mudou de proposito e esta registrada abaixo (b690): o 403 de rota JA
// conhecida na janela volta SEM derrubar o cache do leitor (a GOOD invalidava sempre, b267.1 — e o /health dela
// mostrou 118 invalidacoes em 5 min numa rota restrita ao comprador; invalidar e barato, mas cada uma e uma
// releitura do dono e uma chamada em dobro).
//
// Roda com: node test/ml-403-permanente.test.js

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const abs = (p) => require.resolve(path.join(RAIZ, p));

// ── a rede simulada: o ML responde o que a regra mandar; o OAuth sempre renova ──
const rede = { api: [], oauth: 0, regra: () => 200, dono: 0 };
const erroHttp = (status) => { const e = new Error('HTTP ' + status); e.response = { status, data: { message: 'erro ' + status }, headers: {} }; return e; };
async function api(url) {
  rede.api.push(String(url));
  const st = rede.regra(String(url));
  if (st !== 200) throw erroHttp(st);
  return { status: 200, data: { ok: true } };
}
const axiosFalso = (cfgReq) => api(cfgReq.url);
axiosFalso.get = async (url) => { if (/\/interno\/token\//.test(url)) { rede.dono++; return { status: 200, data: { access: 'TOK-DONO-' + rede.dono, versao: rede.dono } }; } return api(url); };
axiosFalso.post = async (url) => { if (/\/oauth\/token/.test(url)) { rede.oauth++; return { status: 200, data: { access_token: 'TOK-' + rede.oauth, refresh_token: 'REF-' + rede.oauth, expires_in: 21600 } }; } return { status: 200, data: {} }; };
axiosFalso.isAxiosError = () => false; axiosFalso.create = () => axiosFalso;

let relogio = Date.now();
const agoraReal = Date.now;

function instalar(politica) {
  process.env.ADMIN_TOKEN_LEITURA_KEY = 'chave-de-teste';
  process.env.MOVER_PEDIDOS_URL = 'https://dono.teste';
  for (const k of Object.keys(process.env)) if (/^TOKEN_POLITICA_/.test(k) || /^GOOD_ML_/.test(k)) delete process.env[k];
  process.env.TOKEN_POLITICA_GOOD_ML = politica;
  Object.assign(process.env, { ML_ACCESS_TOKEN: 'TOK-0', ML_REFRESH_TOKEN: 'REF-0', ML_CLIENT_ID: 'c', ML_CLIENT_SECRET: 's' });
  for (const m of ['lib/token-leitor.js', 'lib/ml.js', 'lib/render-tokens.js']) delete require.cache[abs(m)];
  const idAxios = require.resolve('axios');
  require.cache[idAxios] = { id: idAxios, filename: idAxios, loaded: true, exports: axiosFalso };
  require.cache[abs('lib/render-tokens.js')] = { id: abs('lib/render-tokens.js'), filename: abs('lib/render-tokens.js'), loaded: true, exports: { atualizarTokensNoRender: async () => true } };
  Object.assign(rede, { api: [], oauth: 0, dono: 0, regra: () => 200 });
  Date.now = () => relogio;
  const c = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  const ml = require(abs('lib/ml.js'));
  const leitor = require(abs('lib/token-leitor.js'));
  return { ml, leitor, falar: () => { Object.assign(console, c); Date.now = agoraReal; } };
}
const SHIP = (id) => 'https://api.mercadolibre.com/shipments/' + id;

(async () => {
  // ── ⚠️ a chave e a ROTA, nao o id ──
  {
    const t = instalar('local');   // em `local` e o refresh LOCAL que esta em jogo — o que o limite protege
    rede.regra = (u) => (/\/shipments\/\d+$/.test(u) ? 403 : 200);
    const r1 = await t.ml.chamarML(SHIP('44881234567'));
    const apos1 = { oauth: rede.oauth, api: rede.api.length };
    const r2 = await t.ml.chamarML(SHIP('44889999999'));
    const apos2 = { oauth: rede.oauth, api: rede.api.length };
    const r3 = await t.ml.chamarML(SHIP('44887777777') + '/history');
    const r4 = await t.ml.chamarML(SHIP('44886666666') + '/history');
    t.falar();
    ok(r1.ok === false && r1.status === 403 && apos1.oauth === 1 && apos1.api === 2, '1o 403 da rota: renova UMA vez e repete (1 refresh gasto, 2 chamadas)');
    ok(r2.ok === false && r2.rota_ja_renovou === true && apos2.oauth === 1 && apos2.api === 3, '⚠️ 2o 403 em OUTRO id da MESMA rota: nao gasta outro refresh nem repete (a chave e a rota)');
    ok(r3.ok === true && r4.ok === true && rede.oauth === 1, '  /shipments/{id}/history e rota DIFERENTE: segue funcionando (nao foi marcada)');
  }

  // ── o 401 NAO passa pelo limite ──
  {
    const t = instalar('local');
    let vez = 0;
    rede.regra = (u) => (/\/orders\//.test(u) ? ((vez++ % 2 === 0) ? 401 : 200) : 200);
    const r1 = await t.ml.chamarML('https://api.mercadolibre.com/orders/2000011111111111');
    const r2 = await t.ml.chamarML('https://api.mercadolibre.com/orders/2000022222222222');
    t.falar();
    ok(r1.ok === true && r2.ok === true && rede.oauth === 2, '⚠️ 401 renova SEMPRE (token vencido de verdade tem que renovar) — 2 renovacoes pra 2 401 na mesma rota');
  }

  // ── o relogio so anda SE o refresh foi gasto ──
  {
    const t = instalar('local');
    axiosFalso.post = async (url) => { if (/\/oauth\/token/.test(url)) { rede.oauth++; throw erroHttp(400); } return { status: 200, data: {} }; };
    rede.regra = (u) => (/\/shipments\//.test(u) ? 403 : 200);
    const r1 = await t.ml.chamarML(SHIP('44881234567'));
    const r2 = await t.ml.chamarML(SHIP('44889999999'));
    t.falar();
    axiosFalso.post = async (url) => { if (/\/oauth\/token/.test(url)) { rede.oauth++; return { status: 200, data: { access_token: 'TOK-' + rede.oauth, refresh_token: 'REF-' + rede.oauth, expires_in: 21600 } }; } return { status: 200, data: {} }; };
    ok(r1.ok === false && r1.rota_ja_renovou !== true && r2.rota_ja_renovou !== true && rede.oauth === 2,
       '⚠️ renovacao FALHOU (nada gasto): a rota NAO entra na janela — o 2o 403 tenta de novo (bloquear 10 min a troco de nada era o bug b260.1)');
  }

  // ── a janela EXPIRA sozinha ──
  {
    const t = instalar('local');
    rede.regra = (u) => (/\/shipments\//.test(u) ? 403 : 200);
    await t.ml.chamarML(SHIP('44881234567'));
    relogio += 9 * 60 * 1000;
    const dentro = await t.ml.chamarML(SHIP('44881234567'));
    const oauthDentro = rede.oauth;
    relogio += 2 * 60 * 1000;
    const fora = await t.ml.chamarML(SHIP('44881234567'));
    t.falar();
    ok(dentro.rota_ja_renovou === true && oauthDentro === 1, 'aos 9 min a rota ainda esta na janela (sem refresh novo)');
    ok(fora.rota_ja_renovou !== true && rede.oauth === 2, '⚠️ aos 11 min a janela EXPIROU: permissao corrigida volta a funcionar sozinha (sem reiniciar o servico)');
  }

  // ── b690: rota ja conhecida na janela nao derruba o cache do leitor (a regra que mudou pra GOOD) ──
  {
    const t = instalar('sombra');
    rede.regra = (u) => (/\/shipments\//.test(u) ? 403 : 200);
    await t.ml.chamarML(SHIP('44881234567'));
    const donoApos1 = rede.dono;
    await t.ml.chamarML(SHIP('44889999999'));
    await t.ml.chamarML(SHIP('44887777777'));
    const m = t.leitor.diagnostico().telemetria.por_eixo['good/ml'];
    t.falar();
    ok(donoApos1 === 2 && rede.dono === 2, '⚠️ em `sombra`, o 1o 403 rele o dono UMA vez; os seguintes na janela NAO releem (' + rede.dono + ' leituras do dono pra 3 chamadas)');
    ok(m.invalidacoes.por_403 === 1 && rede.oauth === 0, '  1 invalidacao do cache (a do 1o), zero refresh local — antes da peca unica eram 3 invalidacoes e 1 refresh');
  }

  // ── ⚠️ e o /health NAO expoe id de pedido/envio ──
  {
    const t = instalar('local');
    rede.regra = (u) => (/\/shipments\//.test(u) ? 403 : 200);
    await t.ml.chamarML(SHIP('44881234567'));
    const d = t.ml.diagnostico403();
    t.falar();
    const cru = JSON.stringify(d);
    ok(!/\d{6,}/.test(cru), 'o diagnostico NAO tem id nenhum (so contagem e o PADRAO da rota)');
    ok(d.rotas_com_403_recente === 1 && d.por_rota[0] && d.por_rota[0].rota === '/shipments/{id}', '  diz QUANTAS rotas estao em janela e QUAL padrao tomou 403');
    const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
    ok(/ml_403:/.test(srv), '  e o /health mostra isso');
    ok(!/recursos_com_403_permanente/.test(srv) && !/ML_403_PERMANENTE/.test(fs.readFileSync(abs('amb-devolucoes/lib-AMB/ml-AMB.js'), 'utf8')),
       '  ⚠️ e NAO expoe lista de recursos nem tem lista permanente (a versao anterior nao expirava nunca)');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { Date.now = agoraReal; console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
