'use strict';
// b672 — A FILA/ESTACAO DE IMPRESSAO FUNCIONA NAS INSTANCIAS, COM O MESMO CONTRATO DA GOOD.
//
// ⚠️ O QUE ESTE TESTE PROTEGE: o front e unico (public/js/etiqueta.js) e fala o contrato
// da GOOD — `POST /api/etiqueta/fila` { zpl, resumo } e `GET /api/etiqueta/fila/proximo`
// (long-poll) devolvendo { job }. A fabrica tinha OUTRO contrato (POST { sku } e
// GET /api/etiqueta/proxima), sem chamador: na Girassol/AMB enfileirar dava 400 e a
// estacao batia num 404 em loop. Agora a fabrica monta a lib da GOOD por instancia.
// Exercita as rotas de PRODUCAO com router e req/res falsos; e prova que a fila de uma
// empresa nao aparece na outra.
//
// Roda com: node test/estacao-impressao-nas-instancias.test.js

const fs = require('fs');
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

function routerFalso() {
  const rotas = {};
  const reg = (m) => (caminho, ...hs) => { rotas[m + ' ' + caminho] = hs[hs.length - 1]; };
  return { rotas, get: reg('GET'), post: reg('POST'), put: reg('PUT'), delete: reg('DELETE') };
}
function resFalso() {
  const out = { status: 200 };
  return { out, status(c) { out.status = c; return this; }, json(o) { out.json = o; return this; }, type() { return this; }, send(b) { out.body = b; return this; } };
}
const passa = (req, res, next) => next();
const impressao = require('../amb-devolucoes/lib-AMB/impressao-AMB');

(async () => {
  const r1 = routerFalso(); impressao.criar({ NOME_EMPRESA: 'Empresa 1', PREFIXO_ENV: 'E1_' }).registrarRotas(r1, passa);
  const r2 = routerFalso(); impressao.criar({ NOME_EMPRESA: 'Empresa 2', PREFIXO_ENV: 'E2_' }).registrarRotas(r2, passa);
  for (const rota of ['GET /api/qz/cert', 'GET /api/qz/sign', 'POST /api/etiqueta/fila', 'GET /api/etiqueta/fila/proximo']) {
    ok(typeof r1.rotas[rota] === 'function', `⚠️ a instancia registra ${rota} (o que o front unico chama)`);
  }
  ok(!r1.rotas['GET /api/etiqueta/proxima'], '  o contrato antigo (/api/etiqueta/proxima) saiu');

  // POST com o contrato do front -> entra na fila da empresa 1
  const resA = resFalso();
  r1.rotas['POST /api/etiqueta/fila']({ body: { zpl: '^XA^FDteste^FS^XZ', resumo: 'SKU-X' }, usuario: 'ana' }, resA);
  ok(resA.out.status === 200 && resA.out.json && resA.out.json.ok === true && resA.out.json.aguardando === 1,
     '⚠️ POST { zpl, resumo } enfileira (ok, aguardando: 1)');
  // o contrato velho { sku } nao e aceito (o front nunca manda isso)
  const resB = resFalso();
  r1.rotas['POST /api/etiqueta/fila']({ body: { sku: 'SKU-X' }, usuario: 'ana' }, resB);
  ok(resB.out.status === 400 && /ZPL invalido/.test(resB.out.json && resB.out.json.erro), '  POST { sku } (contrato velho): 400 ZPL invalido');

  // a estacao da empresa 2 NAO ve o job da empresa 1
  const res2 = resFalso();
  await r2.rotas['GET /api/etiqueta/fila/proximo']({ query: { espera: '0' } }, res2);
  ok(res2.out.json && res2.out.json.ok === true && res2.out.json.vazio === true && !res2.out.json.job,
     '⚠️ a fila da empresa 1 NAO aparece na estacao da empresa 2 (estado por instancia)');
  // a estacao da empresa 1 recebe o job no formato que o front espera
  const res1 = resFalso();
  await r1.rotas['GET /api/etiqueta/fila/proximo']({ query: { espera: '0' } }, res1);
  const job = res1.out.json && res1.out.json.job;
  ok(job && job.zpl === '^XA^FDteste^FS^XZ' && job.resumo === 'SKU-X' && job.por === 'ana' && res1.out.json.restam === 0,
     '  a estacao da empresa 1 recebe { job: { zpl, resumo, por } } e restam 0');
  const res1b = resFalso();
  await r1.rotas['GET /api/etiqueta/fila/proximo']({ query: { espera: '0' } }, res1b);
  ok(res1b.out.json && res1b.out.json.vazio === true, '  fila vazia depois: { vazio: true } (espera=0 responde na hora)');

  // texto: a fabrica monta a lib da GOOD e nao tem mais o contrato cruzado
  const src = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'impressao-AMB.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(/require\('\.\.\/\.\.\/lib\/rotas-impressao'\)\(router/.test(src), '  impressao-AMB monta lib/rotas-impressao no router da instancia');
  ok(!/falta o sku/.test(src) && !/'\/api\/etiqueta\/proxima'/.test(src), '  o contrato cruzado (falta o sku / proxima) nao existe mais');
  const lib = fs.readFileSync(path.join(RAIZ, 'lib', 'rotas-impressao.js'), 'utf8');
  ok(/module\.exports = function registrarRotasImpressao\(app, deps\) \{[\s\S]*const filaEtiquetas = \[\];/.test(lib),
     '  o estado da fila nasce DENTRO da funcao da lib (uma fila por montagem)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
