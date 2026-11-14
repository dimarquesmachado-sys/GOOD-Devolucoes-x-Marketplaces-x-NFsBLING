'use strict';
// b691 — "RETRY FALHOU" TEM QUE DIZER COM QUE STATUS, e o 403 tem que dizer EM QUE ROTA.
//
// ⚠️ O CASO (o /health que o dono colou em 14/11/2026, 33 min de servico):
//   girassol/ml  -> pode_cortar: "retry falhou 2x"                       (o token foi recusado de novo, ou a
//                                                                         chamada falhou por outro motivo?)
//   good/ml      -> 1.146 invalidacoes por 403, `rotas_com_403_recente: 1`  (QUAL rota? o painel so contava)
// Sem o status do retry e sem o padrao da rota nao da pra diagnosticar — so pra chutar. Este teste trava os
// dois dados, exercitando as funcoes de producao.
//
// Roda com: node test/retry-diz-o-status.test.js

const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const abs = (p) => require.resolve(path.join(RAIZ, p));

// ── 1. o leitor guarda o status do retry que falhou ──
{
  for (const k of Object.keys(process.env)) if (/^TOKEN_POLITICA_/.test(k)) delete process.env[k];
  delete require.cache[abs('lib/token-leitor.js')];
  const tl = require(abs('lib/token-leitor.js'));
  tl.anotarInvalidacao('girassol', 'ml', 401); tl.anotarRetry('girassol', 'ml', false, 401, 401);
  tl.anotarInvalidacao('girassol', 'ml', 401); tl.anotarRetry('girassol', 'ml', false, 401, 404);
  tl.anotarInvalidacao('girassol', 'ml', 401); tl.anotarRetry('girassol', 'ml', false, 401, undefined);
  tl.anotarInvalidacao('girassol', 'ml', 401); tl.anotarRetry('girassol', 'ml', false, 401);            // chamador antigo
  tl.anotarInvalidacao('girassol', 'ml', 401); tl.anotarRetry('girassol', 'ml', true, 401);
  const m = tl.diagnostico().telemetria.por_eixo['girassol/ml'].retry_apos_invalidar.por_401;
  ok(m.ok === 1 && m.falhou === 4, '  a contagem ok/falhou nao muda (1 ok, 4 falhou)');
  ok(JSON.stringify(m.falhou_com) === JSON.stringify({ 401: 1, 404: 1, sem_resposta: 1, nao_informado: 1 }),
     '⚠️ o retry que falhou diz COM QUE STATUS: ' + JSON.stringify(m.falhou_com));
  const v = tl.vereditoDeCorte()['girassol/ml'];
  ok(/retry falhou 4x \(status do retry — 401: 1, 404: 1, sem_resposta: 1, nao_informado: 1\)/.test(v.por_que),
     '⚠️ e o veredito mostra: da pra ver se foi o TOKEN (401/403) ou a CHAMADA (404, sem resposta) — ' + v.por_que);
  const limpo = tl.diagnostico().telemetria.por_eixo;
  tl.anotarInvalidacao('ambtotal', 'bling', 401); tl.anotarRetry('ambtotal', 'bling', true, 401);
  ok(tl.diagnostico().telemetria.por_eixo['ambtotal/bling'].retry_apos_invalidar.por_401.falhou_com === undefined && limpo,
     '  eixo sem retry falho nao ganha campo vazio (o formato de antes fica igual)');
}

// ── 2. os 4 clientes informam o status da SEGUNDA chamada ──
{
  const fs = require('fs');
  for (const arq of ['lib/ml.js', 'lib/bling.js', 'amb-devolucoes/lib-AMB/ml-AMB.js', 'amb-devolucoes/lib-AMB/bling-AMB.js']) {
    const src = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
    const falhos = src.match(/tokenLeitor\.anotarRetry\([^;\n]*, false, [^;\n]*\);/g) || [];
    ok(falhos.length >= 2 && falhos.every((l) => /\.response && \w+\.response\.status\);$/.test(l)),
       `  ${arq}: os ${falhos.length} retries falhos informam o status da 2a chamada`);
  }
}

// ── 3. GOOD: o 403 diz EM QUE ROTA (padrao, sem id) — pela funcao de producao ──
(async () => {
  const chamadas = [];
  const erro = (status) => { const e = new Error('HTTP ' + status); e.response = { status, data: {}, headers: {} }; return e; };
  const axiosFalso = async (cfgReq) => { chamadas.push(cfgReq.url); throw erro(403); };
  axiosFalso.get = async (url) => { chamadas.push(url); throw erro(403); };
  axiosFalso.post = async () => ({ status: 200, data: { access_token: 'NOVO', refresh_token: 'R2', expires_in: 21600 } });
  axiosFalso.isAxiosError = () => false; axiosFalso.create = () => axiosFalso;
  process.env.TOKEN_POLITICA_GOOD_ML = 'local';              // sem dono: o que se mede aqui e a contagem por rota
  process.env.ML_ACCESS_TOKEN = process.env.ML_ACCESS_TOKEN || 'TOK'; process.env.ML_REFRESH_TOKEN = process.env.ML_REFRESH_TOKEN || 'REF';
  process.env.ML_CLIENT_ID = process.env.ML_CLIENT_ID || 'c'; process.env.ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET || 's';
  for (const m of ['lib/token-leitor.js', 'lib/ml.js', 'lib/render-tokens.js']) delete require.cache[abs(m)];
  const idAxios = require.resolve('axios');
  require.cache[idAxios] = { id: idAxios, filename: idAxios, loaded: true, exports: axiosFalso };
  require.cache[abs('lib/render-tokens.js')] = { id: abs('lib/render-tokens.js'), filename: abs('lib/render-tokens.js'), loaded: true, exports: { atualizarTokensNoRender: async () => true } };
  const quieto = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  let ml, d, erroCarga = null;
  try {
    ml = require(abs('lib/ml.js'));
    for (const id of ['41234567890', '49999999999', '47777777777']) await ml.chamarML('https://api.mercadolibre.com/shipments/' + id + '/history');
    await ml.chamarML('https://api.mercadolibre.com/post-purchase/v2/claims/5123456789/returns');
    d = ml.diagnostico403();
  } catch (e) { erroCarga = e; }
  Object.assign(console, quieto);
  ok(!erroCarga, 'GOOD: lib/ml.js carregou e chamarML rodou com a rede simulada' + (erroCarga ? ' — ' + erroCarga.message : ''));
  if (d) {
    ok(Array.isArray(d.por_rota) && d.por_rota[0] && d.por_rota[0].rota === '/shipments/{id}/history' && d.por_rota[0].vezes >= 3,
       '⚠️ o /health diz QUAL rota toma 403 e quantas vezes: ' + JSON.stringify(d.por_rota.map((r) => r.rota + ' x' + r.vezes)));
    ok(d.por_rota.some((r) => r.rota === '/post-purchase/v2/claims/{id}/returns'), '  a 2a rota tambem aparece, cada uma com a sua contagem');
    ok(!/\d{6,}/.test(JSON.stringify(d.por_rota.map((r) => r.rota))), '⚠️ so o PADRAO da rota: nenhum id de envio/pedido/reclamacao vaza pro /health');
    ok(typeof d.rotas_com_403_recente === 'number' && d.por_rota.every((r) => typeof r.ultima_ha_s === 'number'), '  o contador antigo (`rotas_com_403_recente`) segue la; cada rota diz ha quanto tempo foi a ultima');
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA erro no teste: ' + (e && e.stack || e)); process.exit(1); });
