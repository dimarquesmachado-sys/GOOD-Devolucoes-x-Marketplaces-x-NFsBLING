'use strict';
// b696 — O DONO FORA DO AR NAO DERRUBA QUEM JA TEM O TOKEN DELE.
//
// ⚠️ O FURO (achado lendo o leitor antes do primeiro corte pra `remoto`): passado o TTL de 5 min, o leitor
// re-pede o token ao Mover-Pedidos. Se ele nao responde (deploy, reinicio, rede, timeout), a resposta era
// `indisponivel` — mesmo com o ultimo token dele ainda na memoria e ainda valido. Em `sombra` isso virava queda
// no token local (e o veredito reprovava o eixo ate o proximo reinicio); em `remoto`, onde nao ha rede local,
// virava CHAMADA FALHADA: cada reinicio do Mover-Pedidos derrubaria o bipe do Devolucoes por instantes.
//
// A regra: o dono NAO RESPONDEU e eu ainda tenho o ultimo token que ele me deu -> sigo com ele.
//   - so pra falha passageira (rede, 502, 5xx, pagina do proxy); resposta DO DONO dizendo que esta errado
//     (config, chave, integracao inexistente) continua valendo;
//   - token recusado pelo marketplace nao volta;
//   - enquanto o dono esta fora, nao bato nele a cada chamada.
//
// ⚠️ Parte A: o leitor de PRODUCAO contra um servidor HTTP de verdade (o axios real — e ele quem decide se o
// corpo e JSON ou texto). Parte B: os clientes de producao da fabrica, do bipe ate o marketplace.
//
// Roda com: node test/token-leitor-dono-fora.test.js

const http = require('http');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const abs = (p) => require.resolve(path.join(RAIZ, p));

// relogio de mentira: o leitor le Date.now() pro TTL e pra janela de "nao perguntar"
const agoraReal = Date.now.bind(Date);
let adiantado = 0;
Date.now = () => agoraReal() + adiantado;
const passar = (seg) => { adiantado += seg * 1000; };
const calar = () => { const c = { log: console.log, warn: console.warn, error: console.error }; console.log = console.warn = console.error = () => {}; return () => Object.assign(console, c); };

(async () => {
  // ════════ PARTE A — o leitor contra um dono de verdade (HTTP) ════════
  const dono = { modo: 'ok', leituras: 0, serie: 0 };
  const servidor = http.createServer((req, res) => {
    dono.leituras++;
    const json = (status, corpo) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(corpo)); };
    const pagina = (status) => { res.writeHead(status, { 'Content-Type': 'text/html' }); res.end('<html><body><h1>' + status + '</h1> servico reiniciando</body></html>'); };
    switch (dono.modo) {
      case 'ok': return json(200, { access: 'TOK-' + (++dono.serie), expira_em: null, versao: dono.serie });
      case 'rede': return req.socket.destroy();                                   // conexao cortada no meio
      case 'proxy503': return pagina(503);                                        // a pagina do proxy, nao o dono
      case 'proxy404': return pagina(404);
      case 'vazio502': res.writeHead(502); return res.end();
      case 'json502': return json(502, { ok: false, erro: 'aquisição do token falhou: prazo estourado' });
      case 'json500': return json(500, { ok: false, erro: 'erro interno' });
      case 'json503': return json(503, { ok: false, erro: 'rota desligada — configure ADMIN_TOKEN_LEITURA_KEY' });
      case 'json401': return json(401, { ok: false, erro: 'chave de leitura inválida' });
      case 'json404': return json(404, { ok: false, erro: 'girassol não tem a integração "ml" (contrato)' });
      default: return json(418, {});
    }
  });
  await new Promise((r) => servidor.listen(0, r));
  const URL_DONO = 'http://127.0.0.1:' + servidor.address().port;

  function leitor(politica) {
    process.env.MOVER_PEDIDOS_URL = URL_DONO;
    process.env.ADMIN_TOKEN_LEITURA_KEY = 'chave-de-teste';
    for (const k of Object.keys(process.env)) if (/^TOKEN_POLITICA_/.test(k)) delete process.env[k];
    process.env.TOKEN_POLITICA_GIRASSOL_ML = politica;
    delete require.cache[abs('lib/token-leitor.js')];
    Object.assign(dono, { modo: 'ok', leituras: 0, serie: 0 });
    return require(abs('lib/token-leitor.js'));
  }
  const ler = (L) => L.resolverToken('girassol', 'ml');
  const eixo = (L) => L.diagnostico().telemetria.por_eixo['girassol/ml'];
  const veredito = (L) => L.vereditoDeCorte()['girassol/ml'] || {};
  /** le uma vez com o dono no ar (TOK-1) e deixa o TTL vencer */
  async function comTokenVencido(politica) { const L = leitor(politica); await ler(L); passar(6 * 60); return L; }

  for (const [modo, nome] of [['rede', 'conexao cortada'], ['proxy503', 'pagina 503 do proxy'], ['vazio502', '502 sem corpo'], ['json502', '502 do dono (aquisicao falhou)'], ['json500', 'erro interno do dono']]) {
    const falar = calar();
    const L = await comTokenVencido('remoto');
    dono.modo = modo;
    const r = await ler(L);
    const m = eixo(L); falar();
    ok(r.usar === 'remoto' && r.access === 'TOK-1' && r.velho === true && m.fonte.velho === 1 && m.fonte.falhou === 0,
       `⚠️ \`remoto\` + dono fora (${nome}): segue com o ultimo token dele em vez de falhar — usar=${r.usar}, fonte=${JSON.stringify(m.fonte)}`);
  }
  { // em sombra: nao cai no local, e o veredito nao reprova — mas a falha do dono fica dita
    const falar = calar();
    const L = await comTokenVencido('sombra');
    const sucessoAntes = eixo(L).ultimo_sucesso;
    dono.modo = 'rede';
    const r = await ler(L);
    const m = eixo(L); const v = veredito(L); falar();
    ok(r.usar === 'remoto' && r.access === 'TOK-1' && m.fonte.local === 0 && m.fonte.velho === 1, '⚠️ `sombra` + dono fora: nao cai no token local (antes: `caiu no local` e o eixo reprovado ate reiniciar)');
    ok(v.pronto === true && /o dono nao respondeu em 1 leitura\(s\) e o ultimo token dele serviu/.test(v.por_que), '  o veredito segue pronto e DIZ que o dono sumiu — ' + v.por_que);
    ok(m.estados.ok_velho === 1 && !!m.ultimo_velho && m.ultima_falha === m.ultimo_velho && !!sucessoAntes && m.ultimo_sucesso === sucessoAntes,
       '  no /health: estado `ok_velho`, `ultima_falha` carimbada e `ultimo_sucesso` INTOCADO (o dono nao respondeu)');
  }
  { // enquanto o dono esta fora: nao bate nele a cada chamada; passada a espera, tenta; voltou, token novo
    const falar = calar();
    const L = await comTokenVencido('remoto');
    dono.modo = 'rede';
    await ler(L);
    const aposFalha = dono.leituras;
    const r2 = await ler(L); const r3 = await ler(L);
    const naJanela = dono.leituras;
    passar(31);
    await ler(L);
    const depoisDaEspera = dono.leituras;
    dono.modo = 'ok'; passar(31);
    const rVolta = await ler(L);
    const rCache = await ler(L); falar();
    ok(naJanela === aposFalha && r2.access === 'TOK-1' && r3.velho === true, `⚠️ dono fora: as chamadas seguintes NAO batem nele de novo (${naJanela - aposFalha} leituras a mais) — o bipe nao espera 8 s de timeout a cada vez`);
    ok(depoisDaEspera === naJanela + 1, '  passados 30 s, tenta o dono de novo (uma vez)');
    ok(rVolta.access === 'TOK-2' && rVolta.velho === false && rCache.do_cache === true && rCache.velho === false, '  o dono voltou: token NOVO, e dai em diante e cache normal');
  }
  { // sem token anterior nao ha o que servir: tudo como antes
    const falar = calar();
    const Ls = leitor('sombra'); dono.modo = 'rede';
    const rs = await ler(Ls);
    const Lr = leitor('remoto'); dono.modo = 'rede';
    const rr = await ler(Lr); falar();
    ok(rs.usar === 'local' && eixo(Ls).fonte.local === 1 && rr.usar === 'falhar' && eixo(Lr).fonte.falhou === 1,
       '  dono fora e NENHUM token dele na memoria (servico recem-subido): como sempre — `sombra` usa o local, `remoto` falha explicito');
  }
  { // ⚠️ token recusado pelo marketplace nao volta, nem com o dono fora
    const falar = calar();
    const L = await comTokenVencido('remoto');
    L.invalidar('girassol', 'ml');                    // o que o cliente faz no 401/403
    dono.modo = 'rede';
    const r = await ler(L); falar();
    ok(r.usar === 'falhar' && r.access === null, '⚠️ token RECUSADO (invalidado) nao e servido de novo so porque o dono sumiu');
  }
  { // ⚠️ e a recusa que chega ENQUANTO eu esperava o dono tambem vale
    const falar = calar();
    const L = await comTokenVencido('remoto');
    dono.modo = 'rede';
    const pendente = ler(L);                           // ja saiu pro dono...
    L.invalidar('girassol', 'ml');                    // ...e outra chamada levou 401 com o mesmo token
    const r = await pendente; falar();
    ok(r.usar === 'falhar', '⚠️ recusa que chega durante a espera pelo dono: o token velho NAO e servido (o cache e relido na hora da falha)');
  }
  // ⚠️ resposta DO DONO dizendo que esta errado nao fica escondida atras do token velho
  for (const [modo, estado, nome] of [['json503', 'config_invalida', 'rota desligada (503 do dono)'], ['json401', 'indisponivel', 'chave de leitura invalida (401)'], ['json404', 'ausente', 'integracao fora do contrato (404 do dono)']]) {
    const falar = calar();
    const L = await comTokenVencido('remoto');
    dono.modo = modo;
    const r = await ler(L);
    const velhoNaHora = eixo(L).fonte.velho;
    // no caso DEFINITIVO (404 do dono: a integracao nao existe) a entrada antiga e substituida — o token de
    // antes nao pode voltar numa falha de rede logo depois
    dono.modo = 'rede'; passar(6 * 60);
    const depois = await ler(L); falar();
    ok(r.usar === 'falhar' && r.estado === estado && velhoNaHora === 0, `⚠️ ${nome}: o erro do dono aparece (${r.estado}), sem token velho por cima`);
    if (modo === 'json404') ok(depois.usar === 'falhar', '  e depois do 404 DO DONO o token antigo nao volta numa falha de rede');
  }
  { // ⚠️ a pagina do proxy NAO e palavra do dono: 404 do proxy nao vira "integracao inexistente por 5 min"
    const falar = calar();
    const L = await comTokenVencido('remoto');
    dono.modo = 'proxy404';
    const r1 = await ler(L);
    dono.modo = 'ok'; passar(31);
    const r2 = await ler(L);
    const Lfrio = leitor('remoto'); dono.modo = 'proxy503';
    const r3 = await ler(Lfrio); falar();
    ok(r1.velho === true && r2.access === 'TOK-2', '⚠️ 404 em PAGINA do proxy: nao vira "integracao inexistente" guardada por 5 min — serve o ultimo token e, voltando o dono, le o novo');
    ok(r3.estado === 'indisponivel' && !eixo(Lfrio).estados.config_invalida, '  503 em pagina do proxy sem token anterior: `indisponivel` (antes saia como `config_invalida`, culpando a configuracao)');
  }
  await new Promise((r) => servidor.close(r));

  // ════════ PARTE B — do cliente da fabrica ate o marketplace ════════
  const rede = { dono: 0, donoFora: false, api: [], oauth: 0, regra: () => 200 };
  const erroHttp = (status) => { const e = new Error('HTTP ' + status); e.response = { status, data: { message: 'erro ' + status }, headers: {} }; return e; };
  async function api(url, headers) {
    rede.api.push(String((headers && headers.Authorization) || '').replace('Bearer ', ''));
    const status = rede.regra(url);
    if (status !== 200) throw erroHttp(status);
    return { status: 200, data: { ok: true } };
  }
  const axiosFalso = (cfgReq) => api(cfgReq.url, cfgReq.headers);
  axiosFalso.get = async (url, cfgReq) => {
    if (/\/interno\/token\//.test(url)) {
      rede.dono++;
      if (rede.donoFora) { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; }
      return { status: 200, data: { access: 'TOK-DONO-' + rede.dono, versao: rede.dono } };
    }
    return api(url, cfgReq && cfgReq.headers);
  };
  axiosFalso.post = async (url) => { if (/\/oauth\/token/.test(url)) rede.oauth++; return { status: 200, data: { access_token: 'TOK-LOCAL-NOVO', refresh_token: 'R2', expires_in: 21600, user_id: 9 } }; };
  axiosFalso.isAxiosError = () => false; axiosFalso.create = () => axiosFalso;
  const stub = (m, exports) => { require.cache[abs(m)] = { id: abs(m), filename: abs(m), loaded: true, exports }; };
  function fabrica(politica) {
    process.env.MOVER_PEDIDOS_URL = 'https://dono.teste';
    process.env.ADMIN_TOKEN_LEITURA_KEY = 'chave-de-teste';
    for (const k of Object.keys(process.env)) if (/^TOKEN_POLITICA_/.test(k)) delete process.env[k];
    process.env.TOKEN_POLITICA_GIRASSOL_ML = politica;
    for (const m of ['lib/token-leitor.js', 'amb-devolucoes/lib-AMB/ml-AMB.js', 'lib/render-tokens.js', 'lib/ritmo-por-empresa.js']) delete require.cache[abs(m)];
    const idAxios = require.resolve('axios');
    require.cache[idAxios] = { id: idAxios, filename: idAxios, loaded: true, exports: axiosFalso };
    stub('lib/render-tokens.js', { atualizarTokensNoRender: async () => true });
    stub('lib/ritmo-por-empresa.js', { criarRitmo: () => ({ aguardarVez: async () => 'ficha', avisarOk() {}, avisar429() {}, estado: () => ({}), estadoPorteiro: () => ({}) }) });
    Object.assign(rede, { dono: 0, donoFora: false, api: [], oauth: 0, regra: () => 200 });
    const ml = require(abs('amb-devolucoes/lib-AMB/ml-AMB.js')).criar({
      CHAVE_REGISTRO: 'girassol', PREFIXO_ENV: 'GIRASSOL_', PREFIXO_ROTA: '/girassol',
      ml: { accessToken: 'TOK-LOCAL', refreshToken: 'REF', userId: '1', clientId: 'c', clientSecret: 's', apiBase: 'https://api.ml.teste', chaveAccess: 'A', chaveRefresh: 'R', chaveUserId: 'U' },
    });
    return { ml, leitor: require(abs('lib/token-leitor.js')) };
  }
  { // o caso que motivou: eixo JA CORTADO, o Mover-Pedidos reinicia no meio do expediente
    const falar = calar();
    const t = fabrica('remoto');
    const r1 = await t.ml.chamarML('/orders/1');
    passar(6 * 60); rede.donoFora = true;
    const r2 = await t.ml.chamarML('/orders/2');
    const r3 = await t.ml.chamarML('/shipments/3');
    const v = t.leitor.vereditoDeCorte()['girassol/ml']; falar();
    ok(r1.ok && r2.ok === true && r3.ok === true && rede.api.join(',') === 'TOK-DONO-1,TOK-DONO-1,TOK-DONO-1' && rede.oauth === 0,
       '⚠️ fabrica/ML em `remoto`, Mover-Pedidos fora: o bipe CONTINUA, com o ultimo token do dono e sem renovar nada local — ' + rede.api.join(' -> '));
    ok(v.cortado === true && v.pronto === true && /o dono nao respondeu em 2 leitura\(s\)/.test(v.por_que), '  e o veredito conta as duas leituras em que o dono nao respondeu — ' + v.por_que);
  }
  { // e se o marketplace recusar o token velho com o dono fora: nao ha o que inventar
    const falar = calar();
    const t = fabrica('remoto');
    await t.ml.chamarML('/orders/1');
    passar(6 * 60); rede.donoFora = true; rede.regra = () => 401;
    const r = await t.ml.chamarML('/orders/2');
    const v = t.leitor.vereditoDeCorte()['girassol/ml']; falar();
    ok(r.ok === false && rede.api.join(',') === 'TOK-DONO-1,TOK-DONO-1' && rede.oauth === 0,
       '⚠️ fabrica/ML em `remoto`, dono fora E o marketplace recusa o token velho: falha explicita — o recusado nao e reenviado e nada e renovado local');
    ok(v.pronto === false && /JA CORTADO/.test(v.por_que), '  e o veredito mostra o eixo cortado em problema — ' + String(v.por_que).slice(0, 150));
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA erro no teste: ' + (e && e.stack || e)); process.exit(1); });
