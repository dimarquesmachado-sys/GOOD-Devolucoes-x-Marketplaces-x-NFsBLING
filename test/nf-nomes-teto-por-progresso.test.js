'use strict';
// b586 — o PASSE CURTO do boot (maxPaginas) nao e montagem completa: nao carimba ultima_completa nem grava o retrato.
// Caso real: a GOOD ficou com 999 NFs de 10 paginas marcada como completa e salva (o resto dos 120 dias so de madrugada).
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const nf = (id, dias) => ({ id, numero: String(1000 + id), serie: '1', dataEmissao: new Date(Date.now() - dias * 864e5).toISOString().replace('T', ' ').slice(0, 19), chaveAcesso: '3526090000000000000055001' + String(id).padStart(19, '0'), contato: { nome: 'Cliente Numero ' + id + ' Silva' } });
// b603 — caso real (09/10, Girassol): leu as 114 paginas (11.317 NFs) e foi abandonada pelo teto de TEMPO total.
// O teto agora e de INATIVIDADE: montagem andando devagar segue; montagem parada e abandonada.
(async () => {
  process.env.NF_NOMES_TETO_CONSTRUCAO_MS = '600';   // montagem leva ~2x o teto (abaixo do teto ABSOLUTO de 3x)
  const pagina = (pg) => Array.from({ length: 100 }, (_, i) => nf(pg * 1000 + i, pg));
  require(path.join(__dirname, '..', 'lib', 'drenagem.js')).pausar = async () => {};
  const fab = require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'));
  const devagar = { chamarBling: async (u) => { const pg = Number((/pagina=(\d+)/.exec(u) || [])[1]); await new Promise((r) => setTimeout(r, 150)); return { ok: true, status: 200, data: { data: pg <= 8 ? pagina(pg) : [] } }; } };
  const emp = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: devagar, armazemNfNomes: { salvar: async () => ({ ok: true, bytes: 1 }), carregar: async () => null }, semVendas: true });
  const t0 = Date.now(); await emp.construirIndice({ fundo: true }); const dt = Date.now() - t0;
  const st = emp.statusIndice();
  ok(dt > 400 && st.total_nfs === 800 && st.quente && st.ultima_completa, '⚠️ montagem andando devagar (' + dt + ' ms, teto 600 ms) NAO e abandonada: 800 NFs, quente e completa');
  const travado = { chamarBling: async (u) => { const pg = Number((/pagina=(\d+)/.exec(u) || [])[1]); if (pg >= 2) await new Promise((r) => setTimeout(r, 4000)); return { ok: true, status: 200, data: { data: pg <= 3 ? pagina(pg) : [] } }; } };
  const avisos = []; const ow = console.warn; console.warn = (m) => avisos.push(String(m));
  const emp2 = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: travado, armazemNfNomes: { salvar: async () => ({ ok: true, bytes: 1 }), carregar: async () => null }, semVendas: true });
  emp2.construirIndice({ fundo: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1400));   // parada > teto de 600 ms
  console.warn = ow;
  ok(avisos.some((a) => /sem pagina nova/.test(a)), '⚠️ montagem PARADA (sem pagina nova alem do teto) e abandonada');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
