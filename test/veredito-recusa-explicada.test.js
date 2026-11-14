'use strict';
// b694 — O VEREDITO DE CORTE SEPARA RECUSA DA ROTA DE PROBLEMA DE TOKEN.
//
// ⚠️ O CASO (/health de 14/11/2026):
//   girassol/ml -> pronto: false — "retry falhou 4x (status do retry — 401: 3, 429: 1)"
//   good/ml     -> pronto: false — "retry falhou 1x (403: 1); 433 invalidacao(oes) sem retry conhecido"
// Na Girassol sao reclamacoes cujo `/returns` o ML nega ao vendedor POR REGRA (ml-returns-AMB, licao 4): acontece
// a cada montagem do indice. Na GOOD e 403 de politica numa rota so. O veredito reprovava o eixo por QUALQUER
// recusa desde o boot — esses dois nunca ficariam prontos, por um motivo que nao e token. E no outro sentido,
// um eixo ja em `remoto` dizia "cortado e funcionando" mesmo com o marketplace recusando o token do dono.
//
// A regra nova: recusa so bloqueia enquanto esta EM ABERTO. Fica explicada quando uma chamada ENVIADA DEPOIS
// dela e aceita (2xx) com o token do dono — ai ou a recusa era da rota, ou o token foi trocado e o novo
// funciona. Sem aceite depois (token morto do dono: tudo recusado), continua bloqueando.
//
// ⚠️ Roda as funcoes de PRODUCAO: os clientes da fabrica (`criar(cfg).chamarML/.chamarBling`), os da GOOD
// (`lib/ml.js`, `lib/bling.js`) e o veredito do leitor — com a rede simulada.
//
// Roda com: node test/veredito-recusa-explicada.test.js

const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const abs = (p) => require.resolve(path.join(RAIZ, p));

// ── a rede de mentira: `rede.regra(url)` diz o status (ou uma promessa dele, pra segurar uma resposta no ar) ──
const rede = { dono: 0, api: [], oauth: 0, donoCaiNaLeitura: 0, regra: () => 200 };
const erroHttp = (status) => { const e = new Error('HTTP ' + status); e.response = { status, data: { message: 'erro ' + status }, headers: {} }; return e; };
async function api(url, headers) {
  rede.api.push({ url, token: String((headers && headers.Authorization) || '').replace('Bearer ', '') });
  const status = await rede.regra(url);
  if (status !== 200) throw erroHttp(status);
  return { status: 200, data: { ok: true } };
}
const axiosFalso = (cfgReq) => api(cfgReq.url, cfgReq.headers);
axiosFalso.get = async (url, cfgReq) => {
  if (/\/interno\/token\//.test(url)) {
    rede.dono++;
    if (rede.donoCaiNaLeitura && rede.dono >= rede.donoCaiNaLeitura) return { status: 502, data: {} };
    return { status: 200, data: { access: 'TOK-DONO', versao: 1 } };
  }
  return api(url, cfgReq && cfgReq.headers);
};
axiosFalso.post = async (url) => {
  if (/\/oauth\/token/.test(url)) { rede.oauth++; return { status: 200, data: { access_token: 'TOK-LOCAL-NOVO', refresh_token: 'REF-NOVO', expires_in: 21600, user_id: 99 } }; }
  return { status: 200, data: {} };
};
axiosFalso.isAxiosError = () => false; axiosFalso.create = () => axiosFalso;

const stub = (m, exports) => { require.cache[abs(m)] = { id: abs(m), filename: abs(m), loaded: true, exports }; };
function preparar(politicas) {
  process.env.ADMIN_TOKEN_LEITURA_KEY = 'chave-de-teste';
  process.env.MOVER_PEDIDOS_URL = 'https://dono.teste';
  for (const k of Object.keys(process.env)) if (/^TOKEN_POLITICA_/.test(k) || /^GOOD_(ML|BLING)_/.test(k)) delete process.env[k];
  Object.assign(process.env, politicas);
  for (const m of ['lib/token-leitor.js', 'lib/ml.js', 'lib/bling.js', 'amb-devolucoes/lib-AMB/ml-AMB.js', 'amb-devolucoes/lib-AMB/bling-AMB.js',
    'lib/render-tokens.js', 'lib/ritmo-por-empresa.js', 'lib/ritmo-bling.js', 'lib/ritmo-porteiro.js']) delete require.cache[abs(m)];
  const idAxios = require.resolve('axios');
  require.cache[idAxios] = { id: idAxios, filename: idAxios, loaded: true, exports: axiosFalso };
  stub('lib/render-tokens.js', { atualizarTokensNoRender: async () => true });
  Object.assign(rede, { dono: 0, api: [], oauth: 0, donoCaiNaLeitura: 0, regra: () => 200 });
}
function calar() {
  const c = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  return () => Object.assign(console, c);
}
/** os clientes da FABRICA, montados pra Girassol */
function fabrica(politica) {
  preparar({ TOKEN_POLITICA_GIRASSOL_ML: politica, TOKEN_POLITICA_GIRASSOL_BLING: politica });
  stub('lib/ritmo-por-empresa.js', { criarRitmo: () => ({ aguardarVez: async () => 'ficha', avisarOk() {}, avisar429() {}, estado: () => ({}), estadoPorteiro: () => ({}) }) });
  const CFG = {
    CHAVE_REGISTRO: 'girassol', PREFIXO_ENV: 'GIRASSOL_', PREFIXO_ROTA: '/girassol',
    ml: { accessToken: 'TOK-LOCAL', refreshToken: 'REF', userId: '1', clientId: 'c', clientSecret: 's', apiBase: 'https://api.ml.teste', chaveAccess: 'A', chaveRefresh: 'R', chaveUserId: 'U' },
    bling: { accessToken: 'TOK-LOCAL', refreshToken: 'REF', clientId: 'c', clientSecret: 's', apiBase: 'https://api.bling.teste', chaveAccess: 'A', chaveRefresh: 'R' },
  };
  const falar = calar();
  const ml = require(abs('amb-devolucoes/lib-AMB/ml-AMB.js')).criar(CFG);
  const bling = require(abs('amb-devolucoes/lib-AMB/bling-AMB.js')).criar(CFG);
  return { ml, bling, leitor: require(abs('lib/token-leitor.js')), falar };
}
/** os clientes da GOOD */
function good(politica) {
  preparar({ TOKEN_POLITICA_GOOD_ML: politica, TOKEN_POLITICA_GOOD_BLING: politica });
  Object.assign(process.env, { ML_ACCESS_TOKEN: 'TOK-LOCAL', ML_REFRESH_TOKEN: 'REF', ML_CLIENT_ID: 'c', ML_CLIENT_SECRET: 's',
    BLING_ACCESS_TOKEN: 'TOK-LOCAL', BLING_REFRESH_TOKEN: 'REF', BLING_CLIENT_ID: 'c', BLING_CLIENT_SECRET: 's' });
  stub('lib/ritmo-bling.js', { aguardarVez: async () => 'ficha', comRitmo: async (fn) => fn(), estado: () => ({}), LIMITE_POR_SEGUNDO: 3 });
  stub('lib/ritmo-porteiro.js', { avisarOk: async () => {}, avisar429: async () => {}, diagnostico: () => ({}) });
  const falar = calar();
  const ml = require(abs('lib/ml.js'));
  const bling = require(abs('lib/bling.js'));
  return { ml, bling, leitor: require(abs('lib/token-leitor.js')), falar };
}
const veredito = (t, eixo) => t.leitor.vereditoDeCorte()[eixo] || {};
const RETURNS = (id) => `/post-purchase/v2/claims/${id}/returns`;
const negaReturns = (url) => (/\/returns$/.test(url) ? 401 : 200);

(async () => {
  // ══ a fabrica (o caso da Girassol) ══
  { // o caso real: o `/returns` de uma reclamacao e negado por regra; as outras chamadas passam
    const t = fabrica('sombra');
    rede.regra = negaReturns;
    await t.ml.chamarML(RETURNS(1));
    const antes = veredito(t, 'girassol/ml');
    await t.ml.chamarML('/post-purchase/v1/claims/search?status=opened&limit=30');
    const depois = veredito(t, 'girassol/ml'); t.falar();
    ok(antes.pronto === false && /1 recusa\(s\) do marketplace ainda sem aceite depois/.test(antes.por_que) && /retry falhou 1x \(status do retry — 401: 1\)/.test(antes.por_que),
       '⚠️ fabrica/ML: recusa sem aceite depois BLOQUEIA (nao sei se e o token) — ' + antes.por_que);
    ok(depois.pronto === true, '⚠️ fabrica/ML: uma chamada enviada DEPOIS foi aceita com o token do dono -> o eixo fica PRONTO (era o `/returns` negado por regra)');
    ok(/1 recusa\(s\) do marketplace ja explicada\(s\) por aceite posterior/.test(depois.por_que) && /retry falhou 1x \(status do retry — 401: 1\)/.test(depois.por_que),
       '  e a recusa nao some: fica dita no veredito, com os numeros — ' + depois.por_que);
    ok(rede.oauth === 0, '  sem renovar o token local em nenhum momento');
  }
  { // o que o veredito PRECISA continuar pegando: o dono entregando token morto (tudo recusado)
    const t = fabrica('sombra');
    rede.regra = () => 401;
    await t.ml.chamarML('/orders/1'); await t.ml.chamarML('/orders/2'); await t.ml.chamarML(RETURNS(3));
    const v = veredito(t, 'girassol/ml'); t.falar();
    ok(v.pronto === false && /3 recusa\(s\) do marketplace ainda sem aceite depois/.test(v.por_que), '⚠️ fabrica/ML: token MORTO do dono (tudo recusado, nada aceito) continua NAO PRONTO — ' + v.por_que);
  }
  { // ⚠️ "depois" e pela ORDEM DE ENVIO: um 2xx que ja estava no ar quando a recusa chegou nao explica nada
    const t = fabrica('sombra');
    let soltar; const noAr = new Promise((r) => { soltar = r; });
    rede.regra = (url) => (/\/orders\/lenta/.test(url) ? noAr : negaReturns(url));
    const lenta = t.ml.chamarML('/orders/lenta');          // sai ANTES da recusa, responde depois
    await new Promise((r) => setImmediate(r));
    await t.ml.chamarML(RETURNS(1));                         // recusada (e o retry tambem)
    soltar(200); const rLenta = await lenta;
    const aindaNao = veredito(t, 'girassol/ml');
    await t.ml.chamarML('/orders/nova');                     // esta sim: enviada depois da recusa
    const agora = veredito(t, 'girassol/ml'); t.falar();
    ok(rLenta.ok === true && aindaNao.pronto === false && /ainda sem aceite depois/.test(aindaNao.por_que),
       '⚠️ fabrica/ML: resposta 2xx de chamada enviada ANTES da recusa NAO explica a recusa — ' + aindaNao.por_que);
    ok(agora.pronto === true, '  a proxima, enviada depois, explica');
  }
  { // token vencido de verdade: a releitura do dono cura — o proprio retry e o aceite
    const t = fabrica('sombra');
    let n = 0; rede.regra = () => (++n === 1 ? 401 : 200);
    const r = await t.ml.chamarML('/orders/1');
    const v = veredito(t, 'girassol/ml'); t.falar();
    ok(r.ok === true && v.pronto === true && /1 recusa\(s\) do marketplace ja explicada/.test(v.por_que), '  fabrica/ML: 401 curado pela releitura do dono -> pronto (o retry aceito e a explicacao) — ' + v.por_que);
  }
  { // nova recusa depois da explicacao volta a bloquear — nao e "explicou uma vez, vale pra sempre"
    const t = fabrica('sombra');
    rede.regra = negaReturns;
    await t.ml.chamarML(RETURNS(1)); await t.ml.chamarML('/orders/1');
    const meio = veredito(t, 'girassol/ml');
    await t.ml.chamarML(RETURNS(2));
    const fim = veredito(t, 'girassol/ml'); t.falar();
    ok(meio.pronto === true && fim.pronto === false && /1 recusa\(s\) do marketplace ainda sem aceite depois/.test(fim.por_que), '⚠️ fabrica/ML: recusa NOVA depois da explicacao volta a bloquear ate o proximo aceite');
  }
  { // aceite com o token LOCAL (dono fora) nao explica recusa nenhuma
    const t = fabrica('sombra');
    let n = 0; rede.regra = () => (++n === 1 ? 401 : 200);
    rede.donoCaiNaLeitura = 2;                               // a 1a leitura entrega; a releitura do retry ja nao
    const r = await t.ml.chamarML('/orders/1');
    const v = veredito(t, 'girassol/ml'); t.falar();
    ok(r.ok === true && rede.api.map((x) => x.token).join(',') === 'TOK-DONO,TOK-LOCAL' && v.pronto === false
       && /caiu no local/.test(v.por_que) && /ainda sem aceite depois/.test(v.por_que),
       '⚠️ fabrica/ML: aceite com o token LOCAL nao explica a recusa do token do dono — ' + v.por_que);
  }
  { // recusa do token LOCAL (dono fora desde o comeco) nao entra na conta: e assunto da renovacao local
    const t = fabrica('sombra');
    let n = 0; rede.regra = () => (++n === 1 ? 401 : 200);
    rede.donoCaiNaLeitura = 1;
    const r = await t.ml.chamarML('/orders/1');
    const v = veredito(t, 'girassol/ml');
    const m = t.leitor.diagnostico().telemetria.por_eixo['girassol/ml']; t.falar();
    ok(r.ok === true && rede.oauth === 1 && m.invalidacoes.por_401 === 1 && m.recusas.sem_aceite_depois === 0
       && v.pronto === false && /caiu no local/.test(v.por_que) && !/sem aceite depois/.test(v.por_que),
       '  fabrica/ML: recusa do token LOCAL nao vira "recusa em aberto do token do dono" (a invalidacao segue contada) — ' + v.por_que);
  }
  { // os eixos nao se misturam: aceite no Bling nao explica recusa no ML
    const t = fabrica('sombra');
    rede.regra = (url) => (/api\.ml\.teste/.test(url) ? 401 : 200);
    await t.ml.chamarML('/orders/1');
    await t.bling.chamarBling('/nfe/1');
    const vml = veredito(t, 'girassol/ml'); const vbl = veredito(t, 'girassol/bling'); t.falar();
    ok(vml.pronto === false && vbl.pronto === true, '  fabrica: aceite no Bling nao explica recusa no ML (cada eixo com a sua conta)');
  }
  { // Bling da fabrica
    const t = fabrica('sombra');
    rede.regra = (url) => (/\/nfe\/negada/.test(url) ? 401 : 200);
    await t.bling.chamarBling('/nfe/negada');
    const antes = veredito(t, 'girassol/bling');
    await t.bling.chamarBling('/nfe/2');
    const depois = veredito(t, 'girassol/bling'); t.falar();
    ok(antes.pronto === false && /ainda sem aceite depois/.test(antes.por_que) && depois.pronto === true && /ja explicada/.test(depois.por_que),
       '⚠️ fabrica/Bling: mesma regra — bloqueia em aberto, libera com aceite depois');
  }
  { // ⚠️ ja em `remoto`: o veredito dizia "cortado e funcionando" com o marketplace recusando o token do dono
    const t = fabrica('remoto');
    rede.regra = negaReturns;
    await t.ml.chamarML('/orders/1');
    await t.ml.chamarML(RETURNS(1));
    const aberto = veredito(t, 'girassol/ml');
    await t.ml.chamarML('/orders/2');
    const fechado = veredito(t, 'girassol/ml'); t.falar();
    ok(aberto.cortado === true && aberto.pronto === false && /JA CORTADO, com recusa em aberto/.test(aberto.por_que),
       '⚠️ fabrica/ML em `remoto`: recusa em aberto tira o "funcionando" (antes: "cortado e funcionando" sempre que o dono entregava) — ' + aberto.por_que);
    ok(fechado.cortado === true && fechado.pronto === true && /^cortado e funcionando; 1 recusa\(s\) do marketplace ja explicada/.test(fechado.por_que),
       '  e volta sozinho no primeiro aceite depois dela — ' + fechado.por_que);
  }

  // ══ a GOOD ══
  { // o caso real: 403 de politica na busca de reclamacoes; o resto do ML passa
    const t = good('sombra');
    rede.regra = (url) => (/claims\/search/.test(url) ? 403 : 200);
    const BUSCA = 'https://api.mercadolibre.com/post-purchase/v1/claims/search?status=closed&limit=';
    await t.ml.chamarML(BUSCA + '30'); await t.ml.chamarML(BUSCA + '1'); await t.ml.chamarML(BUSCA + '2');
    const antes = veredito(t, 'good/ml');
    await t.ml.chamarML('https://api.mercadolibre.com/orders/2000012345678901');
    const depois = veredito(t, 'good/ml'); t.falar();
    ok(antes.pronto === false && /3 recusa\(s\) do marketplace ainda sem aceite depois/.test(antes.por_que) && /TODAS por 403/.test(antes.por_que),
       '⚠️ GOOD/ML: 403 de politica em serie, nada aceito ainda -> nao pronto — ' + antes.por_que);
    ok(depois.pronto === true && /3 recusa\(s\) do marketplace ja explicada/.test(depois.por_que) && /2 invalidacao\(oes\) sem retry conhecido/.test(depois.por_que),
       '⚠️ GOOD/ML: outra rota aceita com o mesmo token do dono -> PRONTO, e o 403 da rota continua dito — ' + depois.por_que);
  }
  { // Bling da GOOD
    const t = good('sombra');
    rede.regra = (url) => (/\/nfe\/negada/.test(url) ? 401 : 200);
    await t.bling.chamarBling('https://api.bling.com.br/Api/v3/nfe/negada');
    const antes = veredito(t, 'good/bling');
    await t.bling.chamarBling('https://api.bling.com.br/Api/v3/nfe/2');
    const depois = veredito(t, 'good/bling'); t.falar();
    ok(antes.pronto === false && /ainda sem aceite depois/.test(antes.por_que) && depois.pronto === true, '⚠️ GOOD/Bling: mesma regra');
  }

  // ══ o leitor, direto ══
  {
    const t = fabrica('sombra'); t.falar();
    const L = t.leitor;
    await L.resolverToken('girassol', 'ml');
    L.anotarInvalidacao('girassol', 'ml', 401);
    L.anotarAceite('girassol', 'ml');                         // sem o numero do envio: nao prova ordem
    L.anotarAceite('girassol', 'ml', 'x');
    const semNumero = veredito(t, 'girassol/ml');
    L.anotarAceite('girassol', 'ml', L.marcarEnvio());
    const comNumero = veredito(t, 'girassol/ml');
    const m = L.diagnostico().telemetria.por_eixo['girassol/ml'].recusas;
    ok(semNumero.pronto === false && comNumero.pronto === true, '  leitor: aceite sem o numero do envio nao explica nada (sem ordem, sem prova)');
    ok(m.aceites === 3 && m.explicadas === 1 && m.sem_aceite_depois === 0 && !!m.ultima_recusa && !!m.ultima_explicacao,
       '  e o /health mostra a conta: ' + JSON.stringify(m));
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA erro no teste: ' + (e && e.stack || e)); process.exit(1); });
