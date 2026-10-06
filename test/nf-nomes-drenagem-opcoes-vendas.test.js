'use strict';
// b564 — Codex #458 (P2 x3), executando o codigo de producao com um Bling falso:
//  1) busca FRIA (estoquista esperando) NAO para na drenagem; trabalho de FUNDO para e NAO publica o indice truncado;
//  2) as opcoes do preaquecimento ficam por agendamento (a retentativa nao herda as de outro);
//  3) `semVendas` pula o passe de /pedidos/vendas (so a GOOD liga).
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const drenagem = require('../lib/drenagem');
let drenandoFalso = false;
drenagem.estaDrenando = () => drenandoFalso;
const fab = require('../amb-devolucoes/lib-AMB/nf-nomes-AMB.js');
const pagina = (n) => Array.from({ length: 100 }, (_, i) => ({ id: n * 100 + i + 1, numero: String(n * 100 + i + 1), serie: '1', dataEmissao: '2026-10-01 10:00:00', chaveAcesso: '3526090000000000000055001' + String(i).padStart(19, '0'), contato: { nome: 'Cliente Numero ' + (n * 100 + i) } }));
function bling() {
  const c = { urls: [] };
  c.chamarBling = async (u) => {
    c.urls.push(u);
    if (u.startsWith('/nfe')) { if (/pagina=1\b/.test(u)) drenandoFalso = c.drenarNaPagina1 || drenandoFalso; return { ok: true, status: 200, data: { data: pagina(Number(/pagina=(\d+)/.exec(u)[1])) } }; }
    return { ok: true, status: 200, data: { data: [] } };
  };
  return c;
}
(async () => {
  // 1a) busca fria + drenando: segue ate o fim, publica COMPLETO
  let b = bling(); b.drenarNaPagina1 = true;
  let emp = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: b });
  const idx = await emp.construirIndice({ fundo: false, maxPaginas: 3 });
  ok(idx && idx.ts > 0 && idx.totalNFs === 300, '⚠️ construcao de busca (nao fundo) NAO para na drenagem: ' + (idx && idx.totalNFs) + ' NFs');
  ok(b.urls.filter((u) => u.startsWith('/nfe')).length === 3, 'leu as 3 paginas mesmo drenando');
  // 1b) fundo + drenando: para, nao publica
  drenandoFalso = false;
  b = bling(); b.drenarNaPagina1 = true;
  emp = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: b });
  const r = await emp.construirIndice({ fundo: true, maxPaginas: 3 });
  ok(r === undefined || !(r.ts > 0), '⚠️ fundo interrompido pela drenagem NAO carimba o indice como completo');
  ok(emp.statusIndice().quente === false, 'indice segue frio (nao publicou truncado)');
  drenandoFalso = false;
  // 3) semVendas
  b = bling();
  emp = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: b, semVendas: true });
  await emp.construirIndice({ fundo: true, maxPaginas: 2 });
  ok(!b.urls.some((u) => u.startsWith('/pedidos/vendas')), '⚠️ semVendas: nenhuma chamada a /pedidos/vendas');
  b = bling();
  emp = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: b });
  await emp.construirIndice({ fundo: true, maxPaginas: 2 });
  ok(b.urls.some((u) => u.startsWith('/pedidos/vendas')), 'sem a opcao (AMB/Girassol) o passe de vendas continua');
  // 2) opcoes por agendamento: o 1o falha e retenta; um 2o preAquecer sem opcoes nao pode mudar o que a retentativa usa
  const chamadas = []; let nTotal = 0;
  const fabrica = fab.criar({ PREFIXO_ENV: 'T_', semVendas: true, bling: { pausaMs: 0 }, clienteBling: { chamarBling: async (u) => { chamadas.push(u); if (++nTotal === 1) return { ok: false, status: 500, data: {} }; return { ok: true, status: 200, data: { data: pagina(chamadas.length) } }; } } });
  const daquiAOrig = drenagem.daquiA; let retry = null;
  drenagem.daquiA = (fn) => { retry = fn; return { unref() {} }; };
  const origErr = console.error; console.error = () => {};
  fabrica.preAquecer({ maxPaginas: 2 });
  await new Promise((r2) => setTimeout(r2, 100));
  fabrica.preAquecer(60000);   // agendamento posterior, SEM opcoes
  await new Promise((r2) => setTimeout(r2, 100));
  console.error = origErr; drenagem.daquiA = daquiAOrig;
  ok(typeof retry === 'function', 'a falha agendou retentativa');
  chamadas.length = 0;
  const origErr2 = console.error; console.error = () => {};
  drenagem.daquiA = () => ({ unref() {} });
  if (retry) retry();
  await new Promise((r2) => setTimeout(r2, 1500));
  console.error = origErr2; drenagem.daquiA = daquiAOrig;
  ok(chamadas.filter((u) => u.startsWith('/nfe')).length === 2, '⚠️ a retentativa manteve maxPaginas do SEU agendamento (' + chamadas.length + ' chamadas)');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
