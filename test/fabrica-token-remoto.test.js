'use strict';
// b690 — A FABRICA PRONTA PRO `remoto`: o retry de um token vencido vem do DONO.
//
// ⚠️ O CASO: desde a b424 os clientes da fabrica (lib-AMB/ml-AMB.js, lib-AMB/bling-AMB.js) honram a
// politica do eixo — em `remoto` a renovacao local e RECUSADA, porque quem renova e o dono (Mover-Pedidos).
// Mas o retry depois de um 401 so acontecia SE a renovacao local devolvesse true. Entao, em `remoto`, a
// chamada que descobria o token vencido morria com "token invalido e refresh falhou - reautorize pelo
// /conectar" — com o dono ja tendo o token novo, e mandando reautorizar onde nao adianta.
// A GOOD recebeu esse conserto em setembro (b258, Codex P1). A fabrica — que e o codigo que SOBRA depois
// da fusao GOOD->Girassol — nao. Ninguem viu porque todo eixo esta em `sombra`; apareceria no dia do corte.
//
// ⚠️ ESTE TESTE RODA AS FUNCOES DE PRODUCAO (`criar(cfg).chamarML` / `.chamarBling`) com a rede simulada:
// o dono, o marketplace e o /oauth/token. O teste antigo (leitor-token-amb) so lia o fonte por regex.
//
// Roda com: node test/fabrica-token-remoto.test.js

const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const abs = (p) => require.resolve(path.join(RAIZ, p));

// ── a rede de mentira ──
const rede = { dono: [], api: [], oauth: [], fila: [], tokenDoDono: 1, donoCaiNaLeitura: 0, respostas: [] };
function erroHttp(status) { const e = new Error('HTTP ' + status); e.response = { status, data: { message: 'erro ' + status }, headers: {} }; return e; }
async function responderApi(cfgReq) {
  const auth = (cfgReq.headers && cfgReq.headers.Authorization) || '';
  rede.api.push({ url: cfgReq.url, token: auth.replace('Bearer ', '') });
  const prox = rede.respostas.length ? rede.respostas.shift() : 200;
  if (prox !== 200) throw erroHttp(prox);
  return { status: 200, data: { ok: true } };
}
const axiosFalso = (cfgReq) => responderApi(cfgReq);
axiosFalso.get = async (url) => {
  if (/\/interno\/token\//.test(url)) {
    rede.dono.push(url);
    // o dono cai A PARTIR da leitura N (deterministico: a cadeia inteira roda em microtarefas, sem relogio)
    if (rede.donoCaiNaLeitura && rede.dono.length >= rede.donoCaiNaLeitura) return { status: 502, data: {} };
    return { status: 200, data: { access: 'TOK-DONO-' + (rede.tokenDoDono++), versao: rede.tokenDoDono } };
  }
  return responderApi({ url, headers: {} });
};
axiosFalso.post = async (url) => {
  if (/\/oauth\/token/.test(url)) { rede.oauth.push(url); return { status: 200, data: { access_token: 'TOK-LOCAL-NOVO', refresh_token: 'REF-NOVO', expires_in: 21600, user_id: 99 } }; }
  return { status: 200, data: {} };
};
axiosFalso.isAxiosError = () => false;
axiosFalso.create = () => axiosFalso;

function instalar(politica) {
  // envs ANTES de carregar: o leitor le a chave e a URL do dono no require
  process.env.ADMIN_TOKEN_LEITURA_KEY = 'chave-de-teste';
  process.env.MOVER_PEDIDOS_URL = 'https://dono.teste';
  for (const k of Object.keys(process.env)) if (/^TOKEN_POLITICA_/.test(k)) delete process.env[k];
  process.env.TOKEN_POLITICA_GIRASSOL_ML = politica;
  process.env.TOKEN_POLITICA_GIRASSOL_BLING = politica;
  for (const m of ['lib/token-leitor.js', 'amb-devolucoes/lib-AMB/ml-AMB.js', 'amb-devolucoes/lib-AMB/bling-AMB.js', 'lib/render-tokens.js', 'lib/ritmo-por-empresa.js']) delete require.cache[abs(m)];
  const idAxios = require.resolve('axios');
  require.cache[idAxios] = { id: idAxios, filename: idAxios, loaded: true, exports: axiosFalso };
  require.cache[abs('lib/render-tokens.js')] = { id: abs('lib/render-tokens.js'), filename: abs('lib/render-tokens.js'), loaded: true, exports: { atualizarTokensNoRender: async () => true } };
  require.cache[abs('lib/ritmo-por-empresa.js')] = { id: abs('lib/ritmo-por-empresa.js'), filename: abs('lib/ritmo-por-empresa.js'), loaded: true,
    exports: { criarRitmo: () => ({ aguardarVez: async () => { rede.fila.push('vez'); return 'ficha-' + rede.fila.length; }, avisarOk() {}, avisar429() {}, estado: () => ({}), estadoPorteiro: () => ({}) }) } };
  Object.assign(rede, { dono: [], api: [], oauth: [], fila: [], tokenDoDono: 1, donoCaiNaLeitura: 0, respostas: [] });
  const CFG = {
    CHAVE_REGISTRO: 'girassol', PREFIXO_ENV: 'GIRASSOL_', PREFIXO_ROTA: '/girassol',
    ml: { accessToken: 'TOK-LOCAL', refreshToken: 'REF', userId: '1', clientId: 'c', clientSecret: 's', apiBase: 'https://api.ml.teste', chaveAccess: 'A', chaveRefresh: 'R', chaveUserId: 'U' },
    bling: { accessToken: 'TOK-LOCAL', refreshToken: 'REF', clientId: 'c', clientSecret: 's', apiBase: 'https://api.bling.teste', chaveAccess: 'A', chaveRefresh: 'R' },
  };
  const silencio = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  const ml = require(abs('amb-devolucoes/lib-AMB/ml-AMB.js')).criar(CFG);
  const bling = require(abs('amb-devolucoes/lib-AMB/bling-AMB.js')).criar(CFG);
  const leitor = require(abs('lib/token-leitor.js'));
  return { ml, bling, leitor, falar: () => Object.assign(console, silencio) };
}
const metrica = (leitor, eixo) => leitor.diagnostico().telemetria.por_eixo[eixo] || { retry_apos_invalidar: { por_401: {}, por_403: {} }, invalidacoes: {} };

(async () => {
  // ══ ML ══
  { // remoto + 401: o retry vem do dono, SEM renovacao local
    const t = instalar('remoto');
    rede.respostas = [401, 200];
    const r = await t.ml.chamarML('/orders/123456789');
    const m = metrica(t.leitor, 'girassol/ml'); t.falar();
    ok(r.ok === true && r.status === 200, '⚠️ ML `remoto` + 401: a chamada e REPETIDA e da certo (antes: "token invalido e refresh falhou - reautorize")');
    ok(rede.oauth.length === 0, '  sem renovacao local (o refresh de uso unico nao e gasto)');
    ok(rede.dono.length === 2 && rede.api.map((a) => a.token).join(',') === 'TOK-DONO-1,TOK-DONO-2', '  o retry usa o token RELIDO do dono (' + rede.api.map((a) => a.token).join(' -> ') + ')');
    ok(m.retry_apos_invalidar.por_401.ok === 1 && m.invalidacoes.por_401 === 1, '  e o resultado do retry fica anotado (a evidencia do corte)');
    const v = t.leitor.vereditoDeCorte()['girassol/ml'];
    ok(v && v.cortado === true && v.pronto === true, '  e o veredito do eixo da FABRICA existe e diz "cortado e funcionando" — ' + JSON.stringify(v));
  }
  { // remoto + 401 + dono fora: falha EXPLICITA, sem cair no local
    const t = instalar('remoto');
    rede.respostas = [401]; rede.donoCaiNaLeitura = 2;   // a 1a leitura entrega o token; a releitura (depois do 401) falha
    const r = await t.ml.chamarML('/orders/123456789');
    const m = metrica(t.leitor, 'girassol/ml'); t.falar();
    ok(r.ok === false && r.semToken === true && /REMOTO/.test(String(r.error)), '⚠️ ML `remoto` + 401 + dono fora: falha explicita com `semToken` — ' + String(r.error).slice(0, 70));
    ok(rede.oauth.length === 0 && rede.api.length === 1, '  nenhuma chamada com token local, nenhuma renovacao local');
    ok(m.retry_apos_invalidar.por_401.falhou === 1, '  o retry que falhou tambem e anotado');
    const v = t.leitor.vereditoDeCorte()['girassol/ml'];
    ok(v && v.cortado === true && v.pronto === false && /falhando/.test(v.por_que), '  e o veredito acusa: "JA CORTADO mas falhando" — ' + (v && v.por_que));
  }
  { // sombra + 401: nada muda — renova local e repete
    const t = instalar('sombra');
    rede.respostas = [401, 200];
    const r = await t.ml.chamarML('/orders/123456789');
    const m = metrica(t.leitor, 'girassol/ml'); t.falar();
    ok(r.ok === true && rede.oauth.length === 1, '⚠️ ML `sombra` + 401: comportamento de sempre — renova LOCAL (1x) e repete');
    ok(m.retry_apos_invalidar.por_401.ok === 1, '  agora com o resultado do retry anotado');
  }
  { // local + 401: nem consulta o dono
    const t = instalar('local');
    rede.respostas = [401, 200];
    const r = await t.ml.chamarML('/orders/123456789'); t.falar();
    ok(r.ok === true && rede.dono.length === 0 && rede.oauth.length === 1 && rede.api[0].token === 'TOK-LOCAL', '  ML `local` + 401: nem consulta o dono; renova local e repete');
  }
  { // remoto + 403 de permissao: tenta 1x com o token relido; a rota entra na janela
    const t = instalar('remoto');
    rede.respostas = [403, 403, 403, 403];
    const r1 = await t.ml.chamarML('/post-purchase/v2/claims/5123456789/returns');
    const apos1 = { api: rede.api.length, dono: rede.dono.length };
    const r2 = await t.ml.chamarML('/post-purchase/v2/claims/5987654321/returns');
    const r3 = await t.ml.chamarML('/post-purchase/v2/claims/5111111111/returns');
    const m = metrica(t.leitor, 'girassol/ml'); t.falar();
    ok(r1.ok === false && r1.status === 403 && apos1.api === 2 && apos1.dono === 2, '⚠️ ML `remoto` + 403: UMA tentativa com o token relido do dono (2 chamadas, 2 leituras)');
    ok(r2.rota_ja_renovou === true && r3.rota_ja_renovou === true && rede.api.length === 4 && rede.dono.length === 2,
       '⚠️ e a ROTA entra na janela: os 403 seguintes dela nao invalidam o cache nem repetem (4 chamadas, 2 leituras do dono — a regra da GOOD daria 6 e 6)');
    ok(m.invalidacoes.por_403 === 1 && m.retry_apos_invalidar.por_403.falhou === 1 && rede.oauth.length === 0, '  1 invalidacao, 1 retry anotado, zero refresh local');
  }
  { // remoto + 403 que ERA token vencido: o retry resolve e a rota NAO fica marcada
    const t = instalar('remoto');
    rede.respostas = [403, 200, 403, 200];
    const r1 = await t.ml.chamarML('/shipments/41234567890');
    const r2 = await t.ml.chamarML('/shipments/49999999999');
    const m = metrica(t.leitor, 'girassol/ml'); t.falar();
    ok(r1.ok === true && r2.ok === true && m.retry_apos_invalidar.por_403.ok === 2, '  ML `remoto` + 403 que era token vencido: o retry resolve, e a rota NAO fica presa na janela');
  }
  { // remoto + 403, e a releitura do dono FALHA: nao e conclusivo — a rota nao fica marcada
    const t = instalar('remoto');
    rede.respostas = [403, 403, 403]; rede.donoCaiNaLeitura = 2;
    const r1 = await t.ml.chamarML('/post-purchase/v2/claims/5123456789/returns');
    rede.donoCaiNaLeitura = 0;                                   // o dono voltou
    const r2 = await t.ml.chamarML('/post-purchase/v2/claims/5987654321/returns'); t.falar();
    ok(r1.ok === false && r1.semToken === true && !r2.rota_ja_renovou && rede.api.length === 3,
       '⚠️ ML `remoto` + 403 com o dono fora na releitura: "nao sei" NAO marca a rota — o 403 seguinte tenta de novo (e so entao, com 403 repetido, marca)');
  }
  { // sombra + 403: como era (renova 1x por rota)
    const t = instalar('sombra');
    rede.respostas = [403, 403, 403];
    await t.ml.chamarML('/post-purchase/v2/claims/5123456789/returns');
    const r2 = await t.ml.chamarML('/post-purchase/v2/claims/5987654321/returns'); t.falar();
    ok(rede.oauth.length === 1 && r2.rota_ja_renovou === true && rede.api.length === 3, '  ML `sombra` + 403: como sempre — 1 refresh local por rota na janela, o 2o 403 nao repete');
  }

  // ══ BLING ══
  { // remoto + 401
    const t = instalar('remoto');
    rede.respostas = [401, 200];
    const r = await t.bling.chamarBling('/nfe/1');
    const m = metrica(t.leitor, 'girassol/bling'); t.falar();
    ok(r.ok === true && rede.oauth.length === 0 && rede.api.map((a) => a.token).join(',') === 'TOK-DONO-1,TOK-DONO-2',
       '⚠️ Bling `remoto` + 401: repete com o token relido do dono, sem renovar local (' + rede.api.map((a) => a.token).join(' -> ') + ')');
    ok(rede.fila.length === 2, '  e o retry pede a VEZ de novo na fila do Bling (e outra requisicao fisica)');
    ok(m.retry_apos_invalidar.por_401.ok === 1, '  resultado do retry anotado');
  }
  { // remoto + 401 + dono fora
    const t = instalar('remoto');
    rede.respostas = [401]; rede.donoCaiNaLeitura = 2;
    const r = await t.bling.chamarBling('/nfe/1');
    const m = metrica(t.leitor, 'girassol/bling'); t.falar();
    ok(r.ok === false && r.semToken === true && rede.oauth.length === 0, '⚠️ Bling `remoto` + 401 + dono fora: falha explicita (`semToken`), nada de renovar escondido');
    ok(!/reautorize/.test(String(r.error)) && m.retry_apos_invalidar.por_401.falhou === 1, '  a mensagem NAO manda reautorizar pelo /conectar (em remoto isso nao conserta) — ' + String(r.error).slice(0, 60));
  }
  { // sombra + 401
    const t = instalar('sombra');
    rede.respostas = [401, 200];
    const r = await t.bling.chamarBling('/nfe/1');
    const m = metrica(t.leitor, 'girassol/bling'); t.falar();
    ok(r.ok === true && rede.oauth.length === 1 && m.retry_apos_invalidar.por_401.ok === 1, '⚠️ Bling `sombra` + 401: comportamento de sempre (renova local, repete) — agora com o retry anotado');
  }
  { // semRetentativa: sai no 1o erro — mas o 401 invalida o cache (porte da GOOD)
    const t = instalar('sombra');
    rede.respostas = [401, 200];
    const r = await t.bling.chamarBling('/produtos/1', { semRetentativa: true });
    const r2 = await t.bling.chamarBling('/produtos/2', { semRetentativa: true });
    const m = metrica(t.leitor, 'girassol/bling'); t.falar();
    ok(r.ok === false && r.status === 401 && rede.oauth.length === 0, '  Bling `semRetentativa`: continua saindo no 1o erro, sem repetir nem renovar');
    ok(r2.ok === true && rede.api.map((a) => a.token).join(',') === 'TOK-DONO-1,TOK-DONO-2' && m.invalidacoes.por_401 === 1,
       '⚠️ mas o 401 dela INVALIDA o cache do leitor: a chamada seguinte ja vai com o token relido do dono (antes: o token vencido ficava ate 5 min) — ' + rede.api.map((a) => a.token).join(' -> '));
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA erro no teste: ' + (e && e.stack || e)); process.exit(1); });
