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
  ok(/funcionario/.test(DB_AMB.slice(DB_AMB.indexOf('async function triagensDe'), DB_AMB.indexOf('/** Grava uma triagem'))),
     '  e o select traz o funcionario, que a tela le direto');
  ok(/created_at: x\.criado_em/.test(src),
     'traduz criado_em -> created_at (o front espera o nome da GOOD)');
  ok(/x\.tipo !== 'devolucao'/.test(src),
     '  e traduz o tipo: na AMB e sempre "devolucao" e o desfecho mora no status');
  ok(/status_original/.test(src), '  guardando o status original, pra nao perder informacao');
}

// ── prova de ponta a ponta: rota REAL + triagensDe REAL ─────────────
// b166.1 (Codex): antes eu substituia o proprio triagensDe por uma copia
// escrita a mao — entao tirar os filtros de tracking/nf_numero ou o marcador
// do operador do supabase-AMB.js deixaria o teste VERDE. Agora o dublê fica
// EMBAIXO: falsifico o cliente do Supabase e deixo a funcao de producao rodar
// por cima dele, filtros e mapeamento inclusos.
// o modulo de banco desiste antes de criar o cliente se faltarem as envs;
// valores de mentira, ja que quem responde e o dublê logo abaixo
process.env.AMB_SUPABASE_URL = process.env.AMB_SUPABASE_URL || 'https://teste.supabase.co';
process.env.AMB_SUPABASE_KEY = process.env.AMB_SUPABASE_KEY || 'chave-de-teste';

const Module = require('module');
const originalLoad = Module._load;

const LINHAS = [
  { id: 15, shipment_id: '47501559178', order_id: '2000017367190752', tracking: null, nf_numero: '002070', nf_chave: null, criado_em: '2026-08-29T08:21:14Z', tipo: 'devolucao', status: 'concluido', funcionario: 'Diego', problema_descricao: null },
  { id: 11, shipment_id: null, order_id: '1550970116332325', tracking: null, nf_numero: '001906', nf_chave: null, criado_em: '2026-08-29T07:19:07Z', tipo: 'devolucao', status: 'aprovado', funcionario: 'Lucas', problema_descricao: null },
  { id: 9,  shipment_id: null, order_id: null, tracking: 'AD123456789BR', nf_numero: '001800', nf_chave: null, criado_em: '2026-08-01T10:00:00Z', tipo: 'devolucao', status: 'aprovado', funcionario: 'Ygor', problema_descricao: null },
];

// Cliente Supabase de mentira: entende .from().select().or().order() e
// interpreta o filtro OR de verdade (campo.eq.valor,campo.eq.valor...).
function clienteFalso() {
  return {
    from() {
      const est = { filtroOr: null };
      const api = {
        select() { return api; },
        order() { return Promise.resolve(resolver()); },
        limit() { return Promise.resolve(resolver()); },
        or(expr) { est.filtroOr = expr; return api; },
        eq() { return api; },
        insert() { return api; },
        then(res) { return Promise.resolve(resolver()).then(res); },
      };
      function resolver() {
        if (!est.filtroOr) return { data: LINHAS, error: null };
        const cond = est.filtroOr.split(',').map((x) => {
          const m = x.match(/^([a-z_]+)\.eq\.(.*)$/);
          return m ? { campo: m[1], valor: m[2] } : null;
        }).filter(Boolean);
        const data = LINHAS.filter((l) =>
          cond.some((c) => l[c.campo] != null && String(l[c.campo]) === c.valor));
        return { data, error: null };
      }
      return api;
    },
  };
}

Module._load = function (pedido) {
  if (pedido === '@supabase/supabase-js') return { createClient: () => clienteFalso() };
  if (pedido.indexOf('auth-AMB') !== -1) {
    const real = originalLoad.apply(this, arguments);
    return Object.assign({}, real, {
      requerLogin: (req, res, next) => next(),
      requerAdmin: (req, res, next) => next(),
    });
  }
  return originalLoad.apply(this, arguments);
};

let routerAMB = null;
try { routerAMB = require('../amb-devolucoes/app-AMB.js'); }
catch (e) { console.log('(nao consegui montar o app-AMB: ' + (e.message || e) + ')'); }
Module._load = originalLoad;

ok(!!routerAMB, 'o router REAL da AMB foi montado');

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
  const r1 = await pegar('/amb/api/triagem/status/47501559178');
  ok(r1 && r1.registros && r1.registros.length === 1,
     'bipar o pacote ja triado (47501559178) ACHA o registro — antes nao achava nada');
  ok(r1 && r1.registros[0].created_at === '2026-08-29T08:21:14Z',
     '  com a data no campo que a tela le (a tabela guarda criado_em)');
  ok(r1 && r1.registros[0].tipo === 'concluido',
     '  e o tipo traduzido do status (era "devolucao", que a tela nao sabe exibir)');
  ok(r1 && r1.registros[0].funcionario === 'Diego',
     '  e o nome de quem triou vem no CAMPO (a tela usava regex \\w+ na descricao: quebrava com espaco e acento)');

  // Magalu, que nao tem shipment: acha pelo pedido
  const r2 = await pegar('/amb/api/triagem/status/1550970116332325');
  ok(r2 && r2.registros.length === 1,
     'devolucao Magalu (sem shipment) e achada pelo PEDIDO');

  // b166.1: tracking e nf_numero — mas so achavel se o front MANDAR
  const r4 = await pegar('/amb/api/triagem/status/AD123456789BR');
  ok(r4 && r4.registros.length === 1, 'registro gravado so por TRACKING (Correios) e achado');
  const r5 = await pegar('/amb/api/triagem/status/001906');
  ok(r5 && r5.registros.length === 1, '  e so pelo NUMERO DA NF tambem');

  // varios ?tambem= de uma vez (era so um antes)
  const r6 = await pegar('/amb/api/triagem/status/99999999999?tambem=nada&tambem=001800');
  ok(r6 && r6.registros.length === 1,
     'a rota aceita VARIOS ?tambem= — o front agora manda todas as portas');
  ok(r6 && r6.ids_buscados && r6.ids_buscados.length === 3,
     '  e devolve os ids que realmente procurou');

  // pacote novo nao pode dar falso positivo
  const r3 = await pegar('/amb/api/triagem/status/99999999999');
  ok(r3 && r3.registros.length === 0, 'pacote novo continua liberando a triagem');

  // ── b166.2: o PEDIDO so entra quando nao ha shipment ────────────────
{
  // reproduz a montagem do front (busca.js)
  function portas(data) {
    const shipment = data.shipment || {};
    const nf = data.nf || {};
    return [
      data.magalu && data.magalu.protocolo,
      shipment.id,
      nf.chaveAcesso, nf.chave, nf.numero,
      data.pack && data.pack.id,
      data.ml_return && data.ml_return.tracking,
      data.return && data.return.tracking,
      shipment.tracking, data.tracking,
      shipment.id ? null : (data.order && data.order.id),
    ].filter(Boolean);
  }

  const comShipment = portas({ shipment: { id: '47501559178' }, order: { id: '2000017367190752' } });
  ok(comShipment.indexOf('2000017367190752') === -1,
     'havendo shipment, o PEDIDO nao e mandado — o pedido 2000017367190752 tem DOIS envios legitimos');
  ok(comShipment.indexOf('47501559178') !== -1, '  o shipment vai, como sempre');

  const semShipment = portas({ shipment: {}, order: { id: '1550970116332325' } });
  ok(semShipment.indexOf('1550970116332325') !== -1,
     'sem shipment (Magalu), o pedido E a unica porta — e vai');

  const correios = portas({ shipment: {}, ml_return: { tracking: 'AD123456789BR' } });
  ok(correios.indexOf('AD123456789BR') !== -1,
     'etiqueta dos Correios: o rastreio vem de data.ml_return.tracking (nao de shipment.tracking)');

  const BUSCA_GOOD = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'busca.js'), 'utf8');
  ok(/shipment\.id \? null : data\.order\?\.id/.test(BUSCA_AMB), '  e e isso que o front da AMB faz');
  ok(/shipment\.id \? null : data\.order\?\.id/.test(BUSCA_GOOD), '  e o da GOOD tambem');
  ok(/ml_return\?\.tracking/.test(BUSCA_AMB) && /ml_return\?\.tracking/.test(BUSCA_GOOD),
     '  as duas mandam o rastreio da remessa reversa');
}

console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  srv.close();
  process.exit(falhas ? 1 : 0);
});
