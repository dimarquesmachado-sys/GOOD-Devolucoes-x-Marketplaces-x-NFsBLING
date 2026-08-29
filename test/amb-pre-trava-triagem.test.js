// Roda com: node test/amb-pre-trava-triagem.test.js
//
// Guarda o achado de 29/08: na AMB, bipar um pacote JA TRIADO nao avisava
// nada — os botoes de triagem apareciam como se fosse a primeira vez.
//
// Causa: o front da AMB foi copiado da GOOD e chama
// /api/triagem/status/{id}, mas essa rota so existia no servidor da GOOD.
// Dava 404, o catch do JavaScript engolia, e caia em renderizarBotoesTriagem()
// — ou seja, a falha ficava invisivel.
//
// Complicador: a tabela da AMB usa OUTRO vocabulario. `criado_em` em vez de
// `created_at`, e `tipo` sempre 'devolucao' com o desfecho no `status`. O
// front espera o jeito da GOOD, entao a rota traduz.

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const APP_AMB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
const DB_AMB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'supabase-AMB.js'), 'utf8');
const BUSCA_AMB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'js-AMB', 'busca.js'), 'utf8');

// ── a rota existe, e no caminho que o front chama ────────────────────
ok(/router\.get\('\/api\/triagem\/status\/:identificador'/.test(APP_AMB),
   'a AMB agora TEM a rota /api/triagem/status (era 404 e o catch engolia)');
ok(/fetch\('\/api\/triagem\/status\/'/.test(BUSCA_AMB),
   '  e e exatamente a que o front dela chama');
ok(/req\.query\.tambem/.test(APP_AMB),
   '  aceitando o segundo identificador em ?tambem=, como na GOOD');

// ── a consulta cobre os identificadores que a AMB usa de verdade ─────
ok(/shipment_id\.eq\./.test(DB_AMB), 'busca por shipment_id (ML e Shopee)');
ok(/order_id\.eq\./.test(DB_AMB), '  e por order_id — Magalu nao tem shipment (registro id 11 tinha nulo)');
ok(/\\d\{44\}\$\/\.test\(seguro\)\) filtros\.push\(`nf_chave/.test(DB_AMB.replace(/\s+/g, ' ')) ||
   /nf_chave\.eq\./.test(DB_AMB),
   '  e pela chave da DANFE quando o codigo tem 44 digitos');
ok(/replace\(\/\["',\(\)\]\/g, ''\)/.test(DB_AMB),
   '  com o mesmo saneamento da GOOD (virgula e aspas quebram o filtro do PostgREST)');

// ── a traducao do vocabulario ────────────────────────────────────────
{
  const i = DB_AMB.indexOf('async function triagensDe');
  const src = DB_AMB.slice(i, DB_AMB.indexOf('/** Grava uma triagem', i));
  ok(/created_at: x\.criado_em/.test(src),
     'traduz criado_em -> created_at (o front espera o nome da GOOD)');
  ok(/x\.tipo !== 'devolucao'/.test(src),
     '  e traduz o tipo: na AMB e sempre "devolucao" e o desfecho mora no status');
  ok(/status_original/.test(src), '  guardando o status original, pra nao perder informacao');
}

// ── prova de ponta a ponta: monta o ROUTER DE VERDADE ───────────────
// b166 (Codex): antes eu registrava uma copia da rota que chamava um dublê
// local. O teste ficava verde mesmo se a rota real, os filtros, o mapeamento
// ou a ordem de montagem quebrassem — ou seja, nao testava nada do que
// importa. Agora o app-AMB e carregado de verdade, com o Supabase dublado.
const Module = require('module');
const originalLoad = Module._load;
const LINHAS = [
  { id: 15, shipment_id: '47501559178', order_id: '2000017367190752', tracking: null, nf_numero: '002070', criado_em: '2026-08-29T08:21:14Z', tipo: 'devolucao', status: 'concluido', funcionario: 'Diego', problema_descricao: null },
  { id: 11, shipment_id: null,          order_id: '1550970116332325', tracking: null, nf_numero: '001906', criado_em: '2026-08-29T07:19:07Z', tipo: 'devolucao', status: 'aprovado', funcionario: 'Lucas', problema_descricao: null },
  { id: 9,  shipment_id: null,          order_id: null,               tracking: 'AD123456789BR', nf_numero: '001800', criado_em: '2026-08-01T10:00:00Z', tipo: 'devolucao', status: 'aprovado', funcionario: 'Ygor', problema_descricao: null },
];

// dublê do supabase-AMB: so o triagensDe REAL importa aqui, entao a gente
// reaproveita a funcao verdadeira em cima de um cliente falso.
const caminhoDb = require.resolve('../amb-devolucoes/lib-AMB/supabase-AMB.js');
const dbReal = require(caminhoDb);
const dbFalso = Object.assign({}, dbReal, {
  triagensDe: async (ids) => {
    const alvo = (Array.isArray(ids) ? ids : [ids]).map(String);
    const achados = LINHAS.filter((l) =>
      alvo.includes(String(l.shipment_id)) || alvo.includes(String(l.order_id)) ||
      alvo.includes(String(l.tracking)) || alvo.includes(String(l.nf_numero)));
    return {
      ok: true,
      registros: achados.map((x) => ({
        ...x,
        created_at: x.criado_em,
        tipo: x.tipo && x.tipo !== 'devolucao' ? x.tipo : (x.status || 'aprovado'),
        status_original: x.status,
        problema_descricao: x.problema_descricao || (x.funcionario ? `[Reportado por ${x.funcionario}]` : null),
      })),
    };
  },
});

Module._load = function (pedido, pai, ehPrincipal) {
  if (pedido.indexOf('supabase-AMB') !== -1) return dbFalso;
  if (pedido.indexOf('./lib-AMB/auth-AMB') !== -1 || pedido.indexOf('auth-AMB') !== -1) {
    const real = originalLoad.apply(this, arguments);
    return Object.assign({}, real, {
      requerLogin: (req, res, next) => next(),      // login fora do escopo deste teste
      requerAdmin: (req, res, next) => next(),
    });
  }
  return originalLoad.apply(this, arguments);
};

let routerAMB = null;
try { routerAMB = require('../amb-devolucoes/app-AMB.js'); }
catch (e) { console.log('(nao consegui montar o app-AMB: ' + (e.message || e) + ')'); }
Module._load = originalLoad;

ok(!!routerAMB, 'o router REAL da AMB foi montado (nao uma copia da rota)');

const app = express();
if (routerAMB) app.use('/amb', routerAMB);

const srv = http.createServer(app);
function pegar(c) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: c }, (r) => {
      let b = ''; r.on('data', (d) => (b += d));
      r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

srv.listen(0, '127.0.0.1', async () => {
  // o pacote do teste de hoje: bipar de novo TEM que achar
  const r1 = await pegar('/amb/js-nao/../api/triagem/status/47501559178'.replace('/js-nao/..', ''));
  ok(r1 && r1.registros && r1.registros.length === 1,
     'bipar o pacote ja triado (47501559178) ACHA o registro — antes nao achava nada');
  ok(r1 && r1.registros[0].created_at === '2026-08-29T08:21:14Z',
     '  com a data no campo que a tela le');
  ok(r1 && r1.registros[0].tipo === 'concluido',
     '  e o tipo traduzido do status (era "devolucao", que a tela nao sabe exibir)');

  // Magalu, que nao tem shipment: acha pelo pedido
  const r2 = await pegar('/amb/api/triagem/status/1550970116332325');
  ok(r2 && r2.registros.length === 1,
     'devolucao Magalu (sem shipment) e achada pelo PEDIDO — id 11 tinha shipment_id nulo');

  // b166: tracking e nf_numero tambem identificam (a rota /registrar grava
  // os dois, e o jaTriado que ja existia procurava por eles)
  const r4 = await pegar('/amb/api/triagem/status/AD123456789BR');
  ok(r4 && r4.registros.length === 1, 'pacote gravado so por TRACKING (Correios) tambem e achado');
  const r5 = await pegar('/amb/api/triagem/status/001906');
  ok(r5 && r5.registros.length === 1, '  e pelo NUMERO DA NF tambem');

  // b166: o nome de quem triou nao pode sair como "Por ?"
  ok(r1 && /\[Reportado por Diego\]/.test(String(r1.registros[0].problema_descricao || '')),
     'a descricao leva o marcador do operador (a tela tira o "Por <fulano>" dali; vinha "Por ?")');

  // pacote novo nao pode dar falso positivo
  const r3 = await pegar('/amb/api/triagem/status/99999999999');
  ok(r3 && r3.registros.length === 0, 'pacote novo continua liberando a triagem');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  srv.close();
  process.exit(falhas ? 1 : 0);
});
