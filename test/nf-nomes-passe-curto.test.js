'use strict';
// b586 — o PASSE CURTO do boot (maxPaginas) nao e montagem completa: nao carimba ultima_completa nem grava o retrato.
// Caso real: a GOOD ficou com 999 NFs de 10 paginas marcada como completa e salva (o resto dos 120 dias so de madrugada).
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const nf = (id, dias) => ({ id, numero: String(1000 + id), serie: '1', dataEmissao: new Date(Date.now() - dias * 864e5).toISOString().replace('T', ' ').slice(0, 19), chaveAcesso: '3526090000000000000055001' + String(id).padStart(19, '0'), contato: { nome: 'Cliente Numero ' + id + ' Silva' } });
(async () => {
  const pagina = (pg) => Array.from({ length: 100 }, (_, i) => nf(pg * 1000 + i, pg));   // 100 NFs por pagina, 1 dia por pagina
  const bling = { chamarBling: async (u) => { const pg = Number((/pagina=(\d+)/.exec(u) || [])[1]); return { ok: true, status: 200, data: { data: pg <= 15 ? pagina(pg) : [] } }; } };
  const gravados = [];
  const armazem = { salvar: async (n, o) => { gravados.push(o); return { ok: true, bytes: 1 }; }, carregar: async () => null };
  const fab = require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'));
  const emp = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling, armazemNfNomes: armazem, semVendas: true });
  await emp.construirIndice({ fundo: true, maxPaginas: 3 });   // passe curto
  await new Promise((r) => setTimeout(r, 20));
  ok(!emp.statusIndice().ultima_completa, '⚠️ o passe curto NAO carimba montagem completa');
  ok(gravados.length === 0, '⚠️ e NAO grava o retrato (um indice de poucas paginas nao pode virar o salvo)');
  await emp.atualizarIndice();   // a proxima renovacao ve que a completa esta por fazer
  await new Promise((r) => setTimeout(r, 20));
  ok(!!emp.statusIndice().ultima_completa && emp.statusIndice().total_nfs === 1500, '⚠️ depois do passe curto, a renovacao faz a montagem COMPLETA (' + emp.statusIndice().total_nfs + ' NFs)');
  ok(gravados.length === 1, '  e so ela grava o retrato');
  // Codex #471: teto informado MAIOR que as paginas existentes — a listagem acabou antes, entao e completo e salvo
  const gravados2 = [];
  const emp2 = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling, armazemNfNomes: { salvar: async (n, o) => { gravados2.push(o); return { ok: true, bytes: 1 }; }, carregar: async () => null }, semVendas: true });
  await emp2.construirIndice({ fundo: true, maxPaginas: 50 });
  await new Promise((r) => setTimeout(r, 20));
  ok(!!emp2.statusIndice().ultima_completa && gravados2.length === 1, '⚠️ teto informado que NAO foi atingido (listagem acabou antes) conta como completo e e salvo');
  // Codex #471 (2): a janela tem EXATAMENTE maxPaginas x 100 NFs — a pagina seguinte vem vazia, entao e completo
  const gravados3 = [];
  const emp3 = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling, armazemNfNomes: { salvar: async (n, o) => { gravados3.push(o); return { ok: true, bytes: 1 }; }, carregar: async () => null }, semVendas: true });
  await emp3.construirIndice({ fundo: true, maxPaginas: 15 });
  await new Promise((r) => setTimeout(r, 20));
  ok(!!emp3.statusIndice().ultima_completa && gravados3.length === 1, '⚠️ pagina cheia exatamente no teto, com a seguinte vazia, conta como completo e e salvo');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
