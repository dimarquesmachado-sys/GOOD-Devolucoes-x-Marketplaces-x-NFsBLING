'use strict';
// b729 — P2-05 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): O INDICE DE TICKETS DO MAGALU SO E
// PUBLICADO COMPLETO; falha em qualquer pagina preserva o ultimo indice valido e nao limpa o erro.
// Ate o b728: falha na 1a pagina publicava um mapa VAZIO por cima do bom; falha na 2a publicava o parcial e zerava o erro.
// Roda com: node test/magalu-indice-so-completo.test.js
process.env.AMB_MAGALU_ACCESS_TOKEN = 'x';
const axios = require('axios');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// rede falsa: `cenario` decide o que cada pagina de /tickets responde
let cenario = {};
let chamadas = 0;
const agoraReal = Date.now; let salto = 0; Date.now = () => agoraReal() + salto;   // relogio controlado
axios.get = async (url) => {
  if (/\/tickets\/[^/?]+\/returns/.test(url)) return { status: 200, data: { results: [] } };
  if (/\/tickets\?/.test(url)) {
    chamadas++;
    const offset = Number((url.match(/_offset=(\d+)/) || [0, 0])[1]);
    const pg = offset / 100;
    const resp = await cenario[pg];   // pode ser uma promise (resposta segurada)
    if (resp === 'cai') return { status: 503, data: {} };   // chamarMagalu usa validateStatus: () => true
    return { status: 200, data: { results: resp || [] } };
  }
  throw new Error('url inesperada ' + url);
};
// protocolo NUMERICO de 16 digitos (o bipe procura so os digitos): prefixo A=1, B=2, C=3, D=4
const pagina = (prefixo, n) => Array.from({ length: n }, (_, i) => ({ id: prefixo + i, protocol: '20261100000' + { A: 1, B: 2, C: 3, D: 4, E: 5 }[prefixo] + String(i).padStart(4, '0'), order: { code: 'PED-' + prefixo + i } }));
const proto = (prefixo, i) => '20261100000' + { A: 1, B: 2, C: 3, D: 4, E: 5 }[prefixo] + String(i).padStart(4, '0');

const { criar } = require('../amb-devolucoes/lib-AMB/magalu-AMB.js');
const magalu = criar({ PREFIXO_ENV: 'AMB_' });

(async () => {
  // 1) indice bom: 2 paginas (100 + 5)
  cenario = { 0: pagina('A', 100), 1: pagina('B', 5) };
  let idx = await magalu.construirIndiceDevolucoes();
  ok(idx.total === 105 && idx.erro === null && (await magalu.acharDevolucao(proto('B', 4))) !== null, 'indice completo: 105 tickets, sem erro, B-4 acha');
  const tsBom = idx.ts;

  // 2) 1a pagina cai: o indice anterior FICA, erro preenchido, nada publicado
  await new Promise((r) => setTimeout(r, 5));
  cenario = { 0: 'cai' };
  idx = await magalu.construirIndiceDevolucoes();
  ok(idx.total === 105 && idx.ts === tsBom, '⚠️ 1a pagina com 503: o indice anterior (105) continua publicado (antes: mapa vazio por cima)');
  ok(/pagina 1/.test(idx.erro || ''), '  erro diz qual pagina caiu: ' + idx.erro);
  ok((await magalu.acharDevolucao(proto('B', 4))) !== null, '  o bipe continua achando pelo indice anterior');

  // 3) 2a pagina cai: o parcial (100) NAO e publicado, erro NAO e limpo
  cenario = { 0: pagina('C', 100), 1: 'cai' };
  idx = await magalu.construirIndiceDevolucoes();
  ok(idx.total === 105 && idx.ts === tsBom && /pagina 2/.test(idx.erro || ''), '⚠️ 2a pagina com 503: parcial de 100 NAO publicado, erro "pagina 2" (antes: publicava parcial e zerava o erro)');
  ok((await magalu.acharDevolucao(proto('C', 1))) === null && (await magalu.acharDevolucao(proto('A', 1))) !== null, '  C (parcial) nao esta no ar; A (anterior) esta');

  // 4) volta a funcionar: publica e limpa o erro
  cenario = { 0: pagina('D', 3) };
  idx = await magalu.construirIndiceDevolucoes();
  ok(idx.total === 3 && idx.erro === null && idx.ts > tsBom, '  construcao completa seguinte publica (3) e limpa o erro');
  ok((await magalu.acharDevolucao(proto('A', 1))) === null && (await magalu.acharDevolucao(proto('D', 2))) !== null, '  o indice novo substitui o antigo por inteiro');

  // 5) status reflete: quente, com erro quando a ultima tentativa caiu
  cenario = { 0: 'cai' };
  await magalu.construirIndiceDevolucoes();
  const st = magalu.statusTickets ? magalu.statusTickets() : null;
  ok(!st || (st.quente === true && /pagina 1/.test(st.erro || '')), '  status: quente (indice anterior) e com o erro da ultima tentativa');

  // 6) Magalu fora do ar e indice velho: o bipe NAO dispara uma reconstrucao a cada chamada (5 min entre tentativas)
  {
    chamadas = 0;
    salto = 31 * 60000;   // o relogio anda 31 min: indice "frio" e a ultima tentativa ja faz mais de 5 min
    cenario = { 0: 'cai' };
    await magalu.acharDevolucao(proto('D', 2));
    const depoisDaPrimeira = chamadas;
    await magalu.acharDevolucao(proto('D', 2));
    await magalu.acharDevolucao(proto('D', 2));
    ok(depoisDaPrimeira === 1 && chamadas === 1, '⚠️ indice frio + Magalu caido: 1 tentativa de reconstrucao, nao uma por bipe. Chamadas: ' + chamadas);
    ok((await magalu.acharDevolucao(proto('D', 2))) !== null, '  e o bipe segue achando pelo indice anterior');
  }
  // 7) Codex #596: dois bipes chegam com a fase 1 em voo (Magalu demorando): o 2o espera a MESMA construcao,
  //    nao le o indice velho nem dispara outra
  {
    salto += 31 * 60000;   // frio de novo, e a ultima tentativa ja passou dos 5 min
    chamadas = 0;
    let liberar; const segurada = new Promise((r) => { liberar = r; });
    cenario = { 0: segurada.then(() => pagina('E', 2)) };
    const p1 = magalu.acharDevolucao(proto('E', 1));
    await new Promise((r) => setTimeout(r, 10));
    const p2 = magalu.acharDevolucao(proto('E', 1));
    await new Promise((r) => setTimeout(r, 10));
    ok(chamadas === 1, '  so UMA construcao em voo para os dois bipes. Chamadas: ' + chamadas);
    liberar();
    const [a, b] = await Promise.all([p1, p2]);
    ok(a && a.ticket_id === 'E1' && b && b.ticket_id === 'E1', '⚠️ (Codex #596) o 2o bipe esperou a fase 1 e achou E1 (antes: null pelo indice velho). Veio: ' + JSON.stringify([a && a.ticket_id, b && b.ticket_id]));
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
