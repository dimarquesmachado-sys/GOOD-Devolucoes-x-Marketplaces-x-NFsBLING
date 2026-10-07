'use strict';
// b579 — o indice de nomes RENOVA so com as notas novas (para na 1a pagina com nota conhecida), em vez de remontar
// os 120 dias inteiros a cada 30 min / pre-aquecimento. Roda a fabrica de producao com um Bling falso.
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const nf = (id, nome, dias) => ({ id, numero: String(1000 + id), serie: '1', dataEmissao: new Date(Date.now() - dias * 864e5).toISOString().replace('T', ' ').slice(0, 19), chaveAcesso: '3526090000000000000055001' + String(id).padStart(19, '0'), contato: { nome } });
(async () => {
  let base = [nf(3, 'Carla Souza Lima', 1), nf(2, 'Bruno Alves Costa', 2), nf(1, 'Ana Maria Pereira', 3)];
  const chamadas = [];
  const bling = { chamarBling: async (u, o) => { chamadas.push([u, o]); const pg = Number((/pagina=(\d+)/.exec(u) || [])[1]); return { ok: true, status: 200, data: { data: pg === 1 ? base : [] } }; } };
  const fab = require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'));
  const emp = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling });
  await emp.construirIndice({ fundo: true });
  ok(emp.statusIndice().ultima_completa, '  a montagem completa carimba ultima_completa');
  // entra uma nota NOVA no topo da lista
  base = [nf(4, 'Diego Novo Cliente', 0)].concat(base);
  chamadas.length = 0;
  await emp.atualizarIndice();
  const r = await emp.buscarPorNome('Diego Novo Cliente');
  ok(r.candidatos.length === 1, '⚠️ a nota nova entra no indice pela renovacao');
  ok(chamadas.length === 1 && chamadas.every(([, o]) => o && o.fundo === true), '⚠️ a renovacao leu so 1 pagina (parou na 1a nota conhecida), como FUNDO — nao os 120 dias (' + chamadas.length + ')');
  ok((await emp.buscarPorNome('Ana Maria Pereira')).candidatos.length === 1, '  as notas antigas continuam no indice (sem duplicar)');
  await emp.atualizarIndice();
  ok((await emp.buscarPorNome('Diego Novo Cliente')).candidatos.length === 1, '  renovar de novo nao duplica a nota nova');
  ok(emp.statusIndice().ultima_incremental && emp.statusIndice().ultima_incremental.novas === 0, '  o status mostra a ultima renovacao (0 novas na segunda)');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
