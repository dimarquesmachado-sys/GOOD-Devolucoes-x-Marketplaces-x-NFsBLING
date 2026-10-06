'use strict';
// b558 — Codex #455: a montagem ABANDONADA pelo teto nao pode seguir chamando o Bling nem sobrescrever o indice da
// montagem nova. Roda a montagem de producao com um Bling falso lento e teto curto.
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
process.env.NF_NOMES_TETO_CONSTRUCAO_MS = '150';
const fs = require('fs');
const A = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'), 'utf8');
ok((A.match(/if \(minhaGeracao !== geracaoConstrucao\) \{ cancelado = true; break; \}/g) || []).length >= 2, '⚠️ os DOIS lacos de paginas param quando a montagem foi abandonada');
ok(/if \(minhaGeracao !== geracaoConstrucao\) return IDX;\n\s+const falhouGeral/.test(A), '⚠️ a abandonada nao publica nada no indice (a nova manda nele)');
(async () => {
  let chamadas = 0;
  const pagina = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, numero: String(i + 1), serie: '1', dataEmissao: '2026-09-01 10:00:00', chaveAcesso: '3526090000000000000055001' + String(i).padStart(19, '0'), contato: { nome: 'Cliente Numero ' + i } }));
  const lento = { chamarBling: (u) => { chamadas++; return new Promise((ok2) => setTimeout(() => ok2({ ok: true, status: 200, data: { data: pagina } }), 120)); } };
  const fab = require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'));
  const emp = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: lento });
  emp.buscarPorNome('Cliente Numero Um Teste').catch(() => {});   // sem indice: dispara a montagem com teto de 150 ms
  await new Promise((r) => setTimeout(r, 1200));
  const depois = chamadas;
  await new Promise((r) => setTimeout(r, 800));
  ok(chamadas - depois <= 1, '⚠️ depois do teto, a montagem abandonada PAROU de chamar o Bling (' + depois + ' -> ' + chamadas + ')');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
