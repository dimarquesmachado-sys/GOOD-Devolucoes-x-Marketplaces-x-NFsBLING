'use strict';
// b701 — O AVISO DA POLITICA DE TOKEN LE O QUE O CONTRATO DECLARA SOBRE OS APPS.
//
// ⚠️ O CASO (15/11): a sonda das 3 empresas, toda verde, trazia na linha "política de token" o aviso "se o
// Mover-Pedidos também renova a mesma conta, os dois brigam pelo refresh de uso único". O contrato v16 (14/11)
// REGISTRA, medido, que cada serviço tem app próprio de Bling e ML nas três — refresh só briga com o MESMO app.
// Alarme falso ensina a ignorar o alarme. O que resta avisar é o que o contrato diz `compartilhado` ou nao diz.
//
// Roda a checagem DE PRODUCAO com o contrato real e com contratos de teste (troco o require do JSON).
//
// Roda com: node test/sonda-politica-apps.test.js
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const CONTRATO = require.resolve('../contrato-empresas.json');
const SONDA = require.resolve('../scripts/sonda-empresa');
const real = require(CONTRATO);

function comContrato(empresas) {
  delete require.cache[CONTRATO];
  require.cache[CONTRATO] = { id: CONTRATO, filename: CONTRATO, loaded: true, children: [], paths: [], exports: { empresas } };
  delete require.cache[SONDA];
  return require(SONDA).CHECAGENS.find((c) => /política/.test(c.nome)).fn;
}
const DOIS = ['devolucoes', 'mover-pedidos'];
const base = (apps) => ({ dono_hoje: { bling: DOIS, ml: DOIS }, apps_por_servico: apps });
const P = { devolucoes: 'proprio (A)', 'mover-pedidos': 'proprio (B)' };
const C = { devolucoes: 'compartilhado (X)', 'mover-pedidos': 'compartilhado (X)' };

(async () => {
  for (const k of Object.keys(process.env)) if (/^TOKEN_POLITICA_/.test(k)) delete process.env[k];

  // contrato REAL: as três declaram app próprio — nenhum aviso
  for (const e of ['good', 'ambtotal', 'girassol']) {
    const r = await comContrato(real.empresas)(e);
    ok(r.ok === true && r.aviso === null && /sem disputa de refresh/.test(r.detalhe), `⚠️ contrato real, ${e}: sem aviso (app próprio nos dois serviços)`);
  }
  {
    const r = await comContrato({ girassol: base({ bling: P, ml: C }) })('girassol');
    ok(r.ok === true && /eixo\(s\) ml com o MESMO app/.test(r.aviso || '') && !/bling/.test(r.aviso || ''), '⚠️ ml compartilhado: AVISA só o ml, e manda pôr em `remoto` ou separar o app');
    ok(/remoto/.test(r.aviso || '') && !/sem disputa/.test(r.detalhe), '   com a saída indicada');
  }
  {
    const r = await comContrato({ girassol: base({ ml: P }) })('girassol');
    ok(r.ok === true && /eixo\(s\) bling sem `apps_por_servico`/.test(r.aviso || '') && /não sei/.test(r.aviso || ''), '⚠️ bling sem declaração: avisa "não sei", só do bling');
  }
  {
    const r = await comContrato({ girassol: base({ bling: C, ml: { devolucoes: 'proprio (A)' } }) })('girassol');
    ok(/MESMO app/.test(r.aviso || '') && /bling/.test(r.aviso || '') && !/ml/.test((r.aviso || '').replace(/MESMO/, '')), '   compartilhado ganha do "sem declaração" no aviso (o mais grave primeiro)');
  }
  {
    const r = await comContrato({ girassol: { dono_hoje: { bling: ['devolucoes'], ml: ['mover-pedidos'] } } })('girassol');
    ok(r.ok === true && r.aviso === null, 'um dono só por eixo: nada a disputar, mesmo sem apps_por_servico');
  }
  {
    const r = await comContrato({})('girassol');
    ok(r.ok === true && r.aviso === null, 'empresa fora do contrato: não inventa disputa (dono_hoje vazio)');
  }
  // `bloqueado` continua reprovando antes de qualquer aviso
  process.env.TOKEN_POLITICA_GIRASSOL_ML = 'bloqueado';
  {
    const r = await comContrato(real.empresas)('girassol');
    ok(r.ok === false && /bloqueado/.test(r.erro || ''), '`bloqueado` segue reprovando (b427) — o aviso dos apps não muda isso');
  }
  delete process.env.TOKEN_POLITICA_GIRASSOL_ML;
  delete require.cache[CONTRATO]; delete require.cache[SONDA];
  console.log(''); console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
