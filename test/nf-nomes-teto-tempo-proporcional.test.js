'use strict';
// b583/b585 — o teto de TEMPO da montagem acompanha o teto de PAGINAS e as DUAS passadas (/nfe + /pedidos/vendas);
// retrato salvo que parou no teto antigo e descartado (Codex #470).
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const fab = require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'));
const nova = (extra, armazem) => fab.criar(Object.assign({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: { chamarBling: async () => ({ ok: true, status: 200, data: { data: [] } }) }, armazemNfNomes: armazem }, extra));
(async () => {
  delete process.env.NF_NOMES_TETO_CONSTRUCAO_MS;
  const amb = nova({});
  ok(amb.tetoConstrucaoMs({ maxPaginas: 80 }) === 480000, '  80 paginas, 2 passadas: 8 min');
  ok(amb.tetoConstrucaoMs({ maxPaginas: 10 }) === 240000, '  minimo de 4 min');
  ok(amb.tetoConstrucaoMs() === 1800000, '⚠️ Codex #470: padrao 300 paginas com /nfe + /pedidos/vendas = 30 min (' + amb.tetoConstrucaoMs() / 60000 + ' min)');
  ok(nova({ semVendas: true }).tetoConstrucaoMs() === 900000, '  GOOD (semVendas): so a passada de NFs = 15 min');
  process.env.NF_NOMES_TETO_CONSTRUCAO_MS = '600000';
  ok(amb.tetoConstrucaoMs() === 600000, '  a variavel NF_NOMES_TETO_CONSTRUCAO_MS continua mandando, se definida');
  delete process.env.NF_NOMES_TETO_CONSTRUCAO_MS;

  // retrato salvo cortado pelo teto antigo (80) nao e aceito com o padrao de 300; o cortado em 300 ou o completo, sim
  const retrato = (extra) => Object.assign({ v: 1, salvo_em: new Date().toISOString(), ultimaCompleta: new Date().toISOString(),
    nfs: [[1, '1001', '1', 'Ana Maria Pereira', '2026-10-01 10:00:00', 10, 'P1']], vendas: [] }, extra);
  const carrega = async (extra) => { const m = nova({}, { salvar: async () => ({ ok: true }), carregar: async () => retrato(extra) }); await m.atualizarIndice(); return m.statusIndice().carregado_do_armazem; };
  ok(!(await carrega({ parouPor: 'teto', parcialAte: 80 })), '⚠️ Codex #470: retrato que parou no teto antigo (80) NAO e carregado — remonta pelo Bling');
  ok(!!(await carrega({ parouPor: 'teto', parcialAte: 300 })), '  retrato que parou no teto atual (300) continua valendo');
  ok(!!(await carrega({ parouPor: 'data', parcialAte: null })), '  retrato completo (parou na data) continua valendo');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
