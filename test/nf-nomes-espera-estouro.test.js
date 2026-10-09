'use strict';
// b586 — o PASSE CURTO do boot (maxPaginas) nao e montagem completa: nao carimba ultima_completa nem grava o retrato.
// Caso real: a GOOD ficou com 999 NFs de 10 paginas marcada como completa e salva (o resto dos 120 dias so de madrugada).
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const nf = (id, dias) => ({ id, numero: String(1000 + id), serie: '1', dataEmissao: new Date(Date.now() - dias * 864e5).toISOString().replace('T', ' ').slice(0, 19), chaveAcesso: '3526090000000000000055001' + String(id).padStart(19, '0'), contato: { nome: 'Cliente Numero ' + id + ' Silva' } });
// b602 — 'nfe pagina 1 HTTP 0' (estouro na fila do porteiro) NAO derruba a montagem: espera e tenta a mesma pagina.
(async () => {
  const pagina = (pg) => Array.from({ length: 100 }, (_, i) => nf(pg * 1000 + i, pg));
  const esperas = [];
  const dren = require(path.join(__dirname, '..', 'lib', 'drenagem.js'));
  dren.pausar = async (ms) => { esperas.push(ms); };   // sem esperar de verdade no teste
  const fab = require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'));
  let falhasPg1 = 2;
  const bling = { chamarBling: async (u) => { const pg = Number((/pagina=(\d+)/.exec(u) || [])[1]); if (pg === 1 && falhasPg1 > 0) { falhasPg1--; return { ok: false, status: 0 }; } return { ok: true, status: 200, data: { data: pg <= 3 ? pagina(pg) : [] } }; } };
  const emp = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling, armazemNfNomes: { salvar: async () => ({ ok: true, bytes: 1 }), carregar: async () => null }, semVendas: true });
  await emp.construirIndice({ fundo: true });
  const st = emp.statusIndice();
  ok(st.total_nfs === 300 && !st.erro && st.parou_por !== 'erro', '⚠️ pagina 1 deu HTTP 0 duas vezes (estouro): esperou, tentou de novo e montou as 300 NFs (' + st.total_nfs + ', ' + st.erro + ')');
  ok(esperas.slice(0, 2).join(',') === '15000,30000', '  esperas que atravessam a pausa de fundo do porteiro (15 s, 30 s): ' + esperas.slice(0, 3).join(','));
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
