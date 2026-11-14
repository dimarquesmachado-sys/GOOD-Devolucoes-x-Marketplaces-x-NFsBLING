'use strict';
// b693 — EM `sombra`, TOKEN DO DONO RECUSADO NAO GASTA O REFRESH LOCAL (o lado da GOOD: lib/ml.js e lib/bling.js).
//
// ⚠️ O CASO (GOOD, 14/11/2026, /health): o ML nega as reclamacoes da GOOD por politica (403), e
//   good/ml -> retry_apos_invalidar.por_403: { falhou: 3 } em 33 min  ("retry falhou 3x")
// Cada um desses era UMA RENOVACAO DO TOKEN LOCAL — a cada 10 min — que nao servia de nada: em `sombra` a chamada
// usa o token do DONO (Mover-Pedidos), e o retry rele o token do dono, nao o local que acabou de ser renovado.
// Na GOOD o app do ML e o MESMO nos dois servicos (contrato: `risco_ativo.refresh_ml_uso_unico` afeta GOOD e
// AMB): era o refresh de uso unico sendo gasto do lado errado, de graca.
//
// A regra (as 4 pecas: lib/ml.js, lib/bling.js, lib-AMB/ml-AMB.js, lib-AMB/bling-AMB.js): se o token RECUSADO
// veio do dono, o retry vem do dono. A renovacao local fica pra quando o token recusado era o LOCAL (dono fora
// do ar, ou politica `local`). O lado da fabrica esta em test/fabrica-token-remoto.test.js.
//
// ⚠️ Roda as funcoes de PRODUCAO da GOOD (`chamarML`, `chamarBling`) com a rede simulada.
//
// Roda com: node test/sombra-token-do-dono.test.js

const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const abs = (p) => require.resolve(path.join(RAIZ, p));

const rede = { dono: 0, api: [], oauth: 0, fila: 0, respostas: [], donoFora: false };
const erroHttp = (status) => { const e = new Error('HTTP ' + status); e.response = { status, data: { message: 'erro ' + status }, headers: {} }; return e; };
async function api(url, headers) {
  rede.api.push(String((headers && headers.Authorization) || '').replace('Bearer ', ''));
  const prox = rede.respostas.length ? rede.respostas.shift() : 200;
  if (prox !== 200) throw erroHttp(prox);
  return { status: 200, data: { ok: true } };
}
const axiosFalso = (cfgReq) => api(cfgReq.url, cfgReq.headers);
axiosFalso.get = async (url, cfgReq) => {
  if (/\/interno\/token\//.test(url)) {
    rede.dono++;
    if (rede.donoFora) return { status: 502, data: {} };
    return { status: 200, data: { access: 'TOK-DONO-' + rede.dono, versao: rede.dono } };
  }
  return api(url, cfgReq && cfgReq.headers);
};
axiosFalso.post = async (url) => {
  if (/\/oauth\/token/.test(url)) { rede.oauth++; return { status: 200, data: { access_token: 'TOK-LOCAL-NOVO', refresh_token: 'REF-NOVO', expires_in: 21600 } }; }
  return { status: 200, data: {} };
};
axiosFalso.isAxiosError = () => false; axiosFalso.create = () => axiosFalso;

function instalar(politica) {
  process.env.ADMIN_TOKEN_LEITURA_KEY = 'chave-de-teste';
  process.env.MOVER_PEDIDOS_URL = 'https://dono.teste';
  for (const k of Object.keys(process.env)) if (/^TOKEN_POLITICA_/.test(k) || /^GOOD_(ML|BLING)_/.test(k)) delete process.env[k];
  process.env.TOKEN_POLITICA_GOOD_ML = politica; process.env.TOKEN_POLITICA_GOOD_BLING = politica;
  Object.assign(process.env, { ML_ACCESS_TOKEN: 'TOK-LOCAL', ML_REFRESH_TOKEN: 'REF', ML_CLIENT_ID: 'c', ML_CLIENT_SECRET: 's',
    BLING_ACCESS_TOKEN: 'TOK-LOCAL', BLING_REFRESH_TOKEN: 'REF', BLING_CLIENT_ID: 'c', BLING_CLIENT_SECRET: 's' });
  for (const m of ['lib/token-leitor.js', 'lib/ml.js', 'lib/bling.js', 'lib/render-tokens.js', 'lib/ritmo-bling.js', 'lib/ritmo-porteiro.js']) delete require.cache[abs(m)];
  const stub = (m, exports) => { require.cache[abs(m)] = { id: abs(m), filename: abs(m), loaded: true, exports }; };
  const idAxios = require.resolve('axios');
  require.cache[idAxios] = { id: idAxios, filename: idAxios, loaded: true, exports: axiosFalso };
  stub('lib/render-tokens.js', { atualizarTokensNoRender: async () => true });
  stub('lib/ritmo-bling.js', { aguardarVez: async () => { rede.fila++; return 'ficha-' + rede.fila; }, comRitmo: async (fn) => fn(), estado: () => ({}), LIMITE_POR_SEGUNDO: 3 });
  stub('lib/ritmo-porteiro.js', { avisarOk: async () => {}, avisar429: async () => {}, diagnostico: () => ({}) });
  Object.assign(rede, { dono: 0, api: [], oauth: 0, fila: 0, respostas: [], donoFora: false });
  const c = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  const ml = require(abs('lib/ml.js'));
  const bling = require(abs('lib/bling.js'));
  const leitor = require(abs('lib/token-leitor.js'));
  return { ml, bling, leitor, falar: () => Object.assign(console, c) };
}
const metrica = (leitor, eixo) => leitor.diagnostico().telemetria.por_eixo[eixo];
const BUSCA = 'https://api.mercadolibre.com/post-purchase/v1/claims/search?status=closed&offset=';

(async () => {
  // ══ ML da GOOD ══
  { // o caso real: 403 de politica em serie na MESMA rota, em sombra
    const t = instalar('sombra');
    rede.respostas = [403, 403, 403, 403];
    const r1 = await t.ml.chamarML(BUSCA + '0&limit=30');
    const apos1 = { api: rede.api.length, dono: rede.dono };
    const r2 = await t.ml.chamarML(BUSCA + '0&limit=1');
    const r3 = await t.ml.chamarML(BUSCA + '1&limit=1');
    const m = metrica(t.leitor, 'good/ml'); t.falar();
    ok(rede.oauth === 0, `⚠️ GOOD/ML em sombra, 403 de politica em serie: ZERO renovacao do token local (antes: 1 a cada 10 min por rota) — foram ${rede.oauth}`);
    ok(r1.ok === false && r1.status === 403 && apos1.api === 2 && rede.api.slice(0, 2).join(',') === 'TOK-DONO-1,TOK-DONO-2',
       '  o 1o 403 da rota ganha UMA tentativa com o token relido do dono (' + rede.api.slice(0, 2).join(' -> ') + ')');
    ok(r2.renovacaoAdiada === true && r3.renovacaoAdiada === true && rede.api.length === 4, '  os seguintes, na janela da rota, nao repetem (mesma cadencia de antes: 4 chamadas pras 3 consultas)');
    ok(m.retry_apos_invalidar.por_403.falhou === 1 && JSON.stringify(m.retry_apos_invalidar.por_403.falhou_com) === '{"403":1}' && m.fonte.local === 0,
       '  telemetria: 1 retry falho com 403, nenhuma queda no local');
  }
  { // 401 em sombra com o token do dono: retry do dono, sem refresh local
    const t = instalar('sombra');
    rede.respostas = [401, 200];
    const r = await t.ml.chamarML('https://api.mercadolibre.com/orders/2000012345678901'); t.falar();
    ok(r.ok === true && rede.oauth === 0 && rede.api.join(',') === 'TOK-DONO-1,TOK-DONO-2', '⚠️ GOOD/ML em sombra + 401: repete com o token relido do dono, sem renovar o local — ' + rede.api.join(' -> '));
  }
  { // sombra com o dono FORA: o token e o local -> a renovacao local continua valendo
    const t = instalar('sombra');
    rede.donoFora = true; rede.respostas = [401, 200];
    const r = await t.ml.chamarML('https://api.mercadolibre.com/orders/2000012345678901'); t.falar();
    ok(r.ok === true && rede.oauth === 1 && rede.api.join(',') === 'TOK-LOCAL,TOK-LOCAL-NOVO', '⚠️ GOOD/ML em sombra com o dono FORA + 401: o recusado era o LOCAL -> renova local e repete (rede local intacta) — ' + rede.api.join(' -> '));
  }
  { // politica local: nada muda
    const t = instalar('local');
    rede.respostas = [403, 403, 403];
    await t.ml.chamarML(BUSCA + '0&limit=30');
    const r2 = await t.ml.chamarML(BUSCA + '0&limit=1'); t.falar();
    ok(rede.dono === 0 && rede.oauth === 1 && r2.renovacaoAdiada === true && rede.api.every((x) => /^TOK-LOCAL/.test(x)), '  GOOD/ML em `local` + 403: como sempre — nem consulta o dono; 1 refresh local por rota na janela');
  }
  { // remoto: nada muda (o retry do dono a cada 403 e decisao antiga da GOOD, b267.1)
    const t = instalar('remoto');
    rede.respostas = [403, 403];
    const r = await t.ml.chamarML(BUSCA + '0&limit=30'); t.falar();
    ok(r.ok === false && r.status === 403 && rede.oauth === 0 && rede.api.length === 2, '  GOOD/ML em `remoto` + 403: como antes — retry do dono, zero refresh local');
  }

  // ══ Bling da GOOD ══
  {
    const t = instalar('sombra');
    rede.respostas = [401, 200];
    const r = await t.bling.chamarBling('https://api.bling.com.br/Api/v3/nfe/1');
    const m = metrica(t.leitor, 'good/bling'); t.falar();
    ok(r.ok === true && rede.oauth === 0 && rede.api.join(',') === 'TOK-DONO-1,TOK-DONO-2', '⚠️ GOOD/Bling em sombra + 401: repete com o token relido do dono, sem renovar o local — ' + rede.api.join(' -> '));
    ok(rede.fila === 2 && m.retry_apos_invalidar.por_401.ok === 1, '  o retry pede a vez de novo na fila do Bling e fica anotado');
  }
  {
    const t = instalar('sombra');
    rede.donoFora = true; rede.respostas = [401, 200];
    const r = await t.bling.chamarBling('https://api.bling.com.br/Api/v3/nfe/1'); t.falar();
    ok(r.ok === true && rede.oauth === 1 && rede.api.join(',') === 'TOK-LOCAL,TOK-LOCAL-NOVO', '⚠️ GOOD/Bling em sombra com o dono FORA + 401: renova local e repete (rede local intacta) — ' + rede.api.join(' -> '));
  }
  {
    const t = instalar('local');
    rede.respostas = [401, 200];
    const r = await t.bling.chamarBling('https://api.bling.com.br/Api/v3/nfe/1'); t.falar();
    ok(r.ok === true && rede.dono === 0 && rede.oauth === 1, '  GOOD/Bling em `local` + 401: como sempre — renova local e repete');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA erro no teste: ' + (e && e.stack || e)); process.exit(1); });
