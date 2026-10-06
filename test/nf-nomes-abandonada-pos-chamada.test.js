'use strict';
// b559 — Codex #455: (P1) o teto vale para construcao disparada DIRETO por construirIndice() (pre-aquecimento, rota
// manual, autocura); (P2) montagem abandonada com chamada ao Bling PENDENTE nao tenta de novo (429/401) nem publica
// parcial quando a chamada volta. Executa o modulo com Bling mockado.
const path = require('path');
process.env.NF_NOMES_TETO_CONSTRUCAO_MS = '200';
const fab = require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'));
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const warn = console.warn; console.warn = () => {};
const vazio = (u) => Promise.resolve(u.startsWith('/nfe') ? { ok: true, status: 200, data: { data: [] } } : { ok: false, status: 400 });
(async () => {
  // P1: build direto travado e abandonado; a proxima construirIndice() monta de verdade
  {
    let travar = true;
    const bling = { chamarBling: (u) => (travar && u.startsWith('/nfe') ? new Promise(() => {}) : vazio(u)) };
    const nf = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling });
    nf.construirIndice();
    await espera(100);
    ok(nf.statusIndice().construindo === true, 'P1: build direto travado segue construindo antes do teto');
    await espera(300);
    ok(nf.statusIndice().construindo === false, 'P1: passado o teto, build DIRETO tem a guarda liberada');
    travar = false;
    const r = await nf.construirIndice();
    ok(!r || !r.jaEmAndamento, 'P1: a proxima construcao nao recebe jaEmAndamento');
  }
  // P2: chamada pendente na abandonada volta 429 -> nao faz retentativas
  {
    let chamadas = 0, solta;
    const bling = { chamarBling: () => { chamadas++; return chamadas === 1 ? new Promise((r) => { solta = r; }) : Promise.resolve({ ok: false, status: 400 }); } };
    const nf = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling });
    const p = nf.construirIndice();
    await espera(350);   // abandonada
    const antes = chamadas;
    solta({ ok: false, status: 429 });
    await p;
    await espera(50);
    ok(chamadas === antes, 'P2: abandonada com 429 pendente NAO chama o Bling de novo (' + antes + ' -> ' + chamadas + ')');
  }
  // P2: chamada pendente na abandonada volta com sucesso (pagina 3) -> nao publica parcial
  {
    process.env.NF_NOMES_TETO_CONSTRUCAO_MS = '3000';   // as paginas 1-2 levam ~1s de ritmo ate chegar na 3
    let chamadas = 0, solta;
    const agora = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const pagina = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, numero: String(i + 1), serie: '1', dataEmissao: agora, contato: { nome: 'Cliente Numero ' + i } }));
    const bling = { chamarBling: (u) => { chamadas++; return chamadas === 3 ? new Promise((r) => { solta = r; }) : Promise.resolve({ ok: true, status: 200, data: { data: u.startsWith('/nfe') ? pagina : [] } }); } };
    const nf = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling });
    const p = nf.construirIndice();
    while (!solta) await espera(10);
    await espera(3200);   // abandonada com a pagina 3 pendente
    solta({ ok: true, status: 200, data: { data: pagina } });
    await p;
    ok(!nf.statusIndice().parcial_ate_pagina, 'P2: abandonada nao publica o parcial da pagina 3');
  }
  console.warn = warn;
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
