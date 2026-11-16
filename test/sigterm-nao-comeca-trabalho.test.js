'use strict';
// b730 — P2-06 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): DEPOIS DO SIGTERM NAO COMECA TRABALHO NOVO.
//
// A renovacao preventiva de tokens (lib/token-preventiva.js) e o retrofit de itens da NF (rotas-admin-AMB.js) tinham
// setTimeout/setInterval SOLTOS, fora da drenagem: o processo que ja recebeu SIGTERM (deploy do Render: instancia
// velha e nova sobrepostas) ainda disparava renovacao — consumindo o refresh de uso unico junto com a instancia nova —
// e seguia uma rodada inteira de retrofit. Agora: timers registrados na drenagem; checagem antes de cada etapa; o que
// esta em voo TERMINA e grava.
// Roda com: node test/sigterm-nao-comeca-trabalho.test.js
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const drenagem = require('../lib/drenagem');
const { registrarPreventiva } = require('../lib/token-preventiva');
const registrarRotasAdminNF = require('../amb-devolucoes/lib-AMB/rotas-admin-AMB.js');
drenagem.ligar();

(async () => {
  // ── preventiva A: agendada pra 300ms (o SIGTERM chega antes) ──
  let renovouA = 0;
  const A = registrarPreventiva({ empresa: 'teste-a', integracao: 'ml', renovar: async () => { renovouA++; return true; }, persistiu: () => true, carimboEnv: 'T_A_EM', diasEnv: 'T_A_DIAS', autoLigar: false });
  A.ligar({ atrasoMs: 300 });

  // ── preventiva B: renovacao EM VOO na hora do SIGTERM (demora 150ms) ──
  let liberarB; const renovacaoB = new Promise((r) => { liberarB = r; });
  let gravouB = false;
  const B = registrarPreventiva({ empresa: 'teste-b', integracao: 'magalu', renovar: async () => { await renovacaoB; gravouB = true; return true; }, persistiu: () => gravouB, carimboEnv: 'T_B_EM', diasEnv: 'T_B_DIAS', autoLigar: false });
  const emVooB = B.preventiva({ forcar: true });

  // ── retrofit: 3 cards pendentes, 40ms por card, agendado pra 10ms ──
  const atualizados = []; const buscados = [];
  const supabase = { from: () => ({
    select() { return this; }, in() { return this; }, gte() { return this; }, order() { return this; },
    limit: async () => ({ data: [1, 2, 3].map((i) => ({ id: i, nf_id_bling: 'NF' + i, nf_itens: [], status: 'aprovado' })) }),
    update(c) { return { eq: async (_k, id) => { atualizados.push(id); return { error: null }; } }; },
  }) };
  const rotas = { get() {}, post() {}, put() {}, delete() {}, patch() {}, use() {} };
  registrarRotasAdminNF(rotas, {
    supabase, requerAdmin: (q, s, n) => n(), adminOk: () => true, sleep: () => Promise.resolve(),
    chamarBling: async () => ({ ok: false }), chamarML: async () => ({ ok: false }), buscarNFnoML: async () => null,
    buscarNFePorId: async (id) => { buscados.push(id); await esperar(40); return { ok: true, data: { data: { id } } }; },
    buscarNFBlindada: async () => null, naturezaDevolucaoDaEmpresa: () => null,
    resolverIdNFPorChave: async () => null, mapItensNF: () => [{ sku: 'X' }],
    tabelaDevolucoes: 'devolucoes_teste', retrofitAtrasoMs: 10,
  });

  await esperar(70);   // retrofit: card 1 gravado (10+40), card 2 em curso
  ok(buscados.length === 2 && atualizados.length === 1, '  antes do SIGTERM o retrofit trabalha (card 1 gravado, card 2 em curso)');

  process.emit('SIGTERM');

  liberarB();                        // a renovacao em voo responde depois do SIGTERM
  const rB = await emVooB;
  ok(rB.ok === true && gravouB === true, '⚠️ renovacao EM VOO no SIGTERM termina e grava (nao e abandonada)');

  const rNova = await B.preventiva({ forcar: true });
  ok(rNova.ok === false && rNova.drenando === true, '⚠️ renovacao NOVA pedida depois do SIGTERM: recusada ("drenando"), refresh preservado pra instancia nova');

  await esperar(120);                // o card 2 termina; o 3 nao comeca
  ok(atualizados.join() === '1,2' && buscados.length === 2, '⚠️ retrofit: o card em curso (2) grava, o card 3 NAO e iniciado. Buscados: ' + buscados.join() + ' / gravados: ' + atualizados.join());

  await esperar(350);                // a preventiva A estava agendada pra 300ms
  ok(renovouA === 0, '⚠️ preventiva agendada ANTES do SIGTERM nao dispara depois dele (timer registrado na drenagem)');
  ok(drenagem.diagnostico().timers_registrados === 0, '  nenhum timer registrado sobrou');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
