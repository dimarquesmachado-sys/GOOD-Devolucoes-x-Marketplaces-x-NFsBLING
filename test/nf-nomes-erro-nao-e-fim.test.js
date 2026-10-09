'use strict';
// b586 — o PASSE CURTO do boot (maxPaginas) nao e montagem completa: nao carimba ultima_completa nem grava o retrato.
// Caso real: a GOOD ficou com 999 NFs de 10 paginas marcada como completa e salva (o resto dos 120 dias so de madrugada).
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const nf = (id, dias) => ({ id, numero: String(1000 + id), serie: '1', dataEmissao: new Date(Date.now() - dias * 864e5).toISOString().replace('T', ' ').slice(0, 19), chaveAcesso: '3526090000000000000055001' + String(id).padStart(19, '0'), contato: { nome: 'Cliente Numero ' + id + ' Silva' } });
// b601 — caso real (09/10): 'nfe pagina 2 HTTP 0' virava FIM da lista — indice de 100 NFs, 'completo' e gravado.
(async () => {
  const pagina = (pg) => Array.from({ length: 100 }, (_, i) => nf(pg * 1000 + i, pg));
  require(path.join(__dirname, '..', 'lib', 'drenagem.js')).pausar = async () => {};   // b602: as tentativas esperam ate 90 s — no teste, sem esperar
  const fab = require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'));
  let falharPg2 = false;
  const bling = { chamarBling: async (u) => { const pg = Number((/pagina=(\d+)/.exec(u) || [])[1]); if (falharPg2 && pg === 2) return { ok: false, status: 0 }; return { ok: true, status: 200, data: { data: pg <= 5 ? pagina(pg) : [] } }; } };
  const gravados = [];
  const emp = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling, armazemNfNomes: { salvar: async (n, o) => { gravados.push(o); return { ok: true, bytes: 1 }; }, carregar: async () => null }, semVendas: true });
  await emp.construirIndice({ fundo: true });
  await new Promise((r) => setTimeout(r, 30));   // a gravacao sai logo depois de publicar
  ok(emp.statusIndice().total_nfs === 500 && gravados.length === 1, '  montagem boa: 500 NFs, completa e gravada');
  falharPg2 = true; await new Promise((r) => setTimeout(r, 5));
  await emp.construirIndice({ fundo: true });
  await new Promise((r) => setTimeout(r, 30));
  const st = emp.statusIndice();
  ok(st.total_nfs === 500 && /pagina 2 HTTP 0/.test(st.erro || '') && gravados.length === 1, '⚠️ pagina 2 falhou (HTTP 0): o indice de 500 FICA (nao vira 100), o erro aparece e nada e gravado (' + st.total_nfs + ')');
  const gravados2 = [];
  const emp2 = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling, armazemNfNomes: { salvar: async (n, o) => { gravados2.push(o); return { ok: true, bytes: 1 }; }, carregar: async () => null }, semVendas: true });
  await emp2.construirIndice({ fundo: true });
  await new Promise((r) => setTimeout(r, 30));
  const st2 = emp2.statusIndice();
  ok(st2.total_nfs === 100 && st2.parou_por === 'erro' && !st2.ultima_completa && gravados2.length === 0, '⚠️ sem indice anterior: publica as 100 como PARCIAL (parou_por erro), sem marcar completa e sem gravar');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
