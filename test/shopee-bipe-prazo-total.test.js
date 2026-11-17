'use strict';
// b743 — V-07 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): O BIPE DA SHOPEE TEM PRAZO TOTAL.
//
// acharDevolucao (GOOD: lib/shopee-proxy.js; fabrica: shopee-AMB.js) faz ate 4 chamadas ao proxy em sequencia sem
// prazo nenhum: proxy lento = 30-60s de spinner e, no fim, "nao e Shopee". Agora a sequencia corre num relogio
// unico (lib/prazo-total.js) e o estouro vira resultado DEGRADADO { degradado, motivo, etapa } — e a tela diz
// "nao respondeu a tempo", nao "nao achei". Aqui um proxy HTTP local responde rapido ou TRAVA, conforme o cenario.
// Roda com: node test/shopee-bipe-prazo-total.test.js
require('./_fonte-fabrica');
const http = require('http');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// ── a peca ──
{
  const { criarPrazo, PrazoEstourado } = require('../lib/prazo-total');
  let agora = 0; const tick = (ms) => { agora += ms; };
  const chamadas = [];
  const fetchFalso = async (url, opts) => { chamadas.push({ url, signal: !!opts.signal }); return { ok: true }; };
  const p = criarPrazo(1000, { agora: () => agora, fetchImpl: fetchFalso });
  (async () => {
    await p.fetch('a', {}, 'lista'); tick(600);
    ok(p.restante() === 400 && !p.estourou(), 'depois de 600ms de 1000: sobram 400, nao estourou');
    await p.fetch('b', {}, 'refresh'); tick(500);
    let erro = null; try { await p.fetch('c', {}, 'pedido'); } catch (e) { erro = e; }
    ok(erro instanceof PrazoEstourado && erro.etapa === 'pedido' && /estourado em "pedido"/.test(erro.message) && p.estourou(), '⚠️ 3a chamada sem tempo sobrando: PrazoEstourado com a etapa, sem nem chamar o fetch');
    ok(chamadas.length === 2 && chamadas.every((c) => c.signal), '  cada fetch recebeu AbortSignal; a 3a nao saiu');
  })();
}

// proxy local: /interno/devolucoes responde a lista; com ?refresh=1 TRAVA (ou nao), conforme o cenario
let travarRefresh = false; let travarLista = false; let corpoLento = false; let corpoNuncaTermina = false; const pedidos = [];
const proxy = http.createServer((req, res) => {
  pedidos.push(req.url);
  const trava = (travarLista && !/refresh=1|tracking=|pedido=/.test(req.url)) || (travarRefresh && /refresh=1/.test(req.url));
  if (trava) return;   // nunca responde (o cliente so sai pelo prazo)
  res.setHeader('content-type', 'application/json');
  // cabecalhos saem logo, corpo atrasa 1500ms (apontamento Codex: o prazo precisa cobrir a leitura do corpo)
  if (corpoLento && !/tracking=|pedido=/.test(req.url)) { res.flushHeaders(); return setTimeout(() => res.end(JSON.stringify({ ok: true, devolucoes: [] })), 1500); }
  // cabecalho 200 sai, o JSON comeca e NUNCA termina (proxy que goteja): so o prazo tira o cliente dali
  if (corpoNuncaTermina && /refresh=1/.test(req.url)) { res.writeHead(200); res.write('{"ok":true,"devolucoes":['); return; }
  // indice de insucesso positivo (BR de insucesso so e achado por aqui)
  if (/tracking=BRINSUCESSO/.test(req.url)) return res.end(JSON.stringify({ ok: true, encontrado: true, devolucao: { order_sn: '250202INSUCES1' } }));
  if (/tracking=|pedido=/.test(req.url)) return res.end(JSON.stringify({ ok: true, encontrado: false }));
  res.end(JSON.stringify({ ok: true, devolucoes: [{ order_sn: '250101ABCDEFG1', tracking_number: 'BR123456789XY', return_sn: '25010100ABCDEF' }] }));
});

(async () => {
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + proxy.address().port;
  process.env.SHOPEE_PROXY_URL = base; process.env.SHOPEE_PROXY_KEY = 'k'; process.env.SHOPEE_LOJA_KEY = 'good'; process.env.SHOPEE_BIPE_PRAZO_MS = '600';
  const good = require('../lib/shopee-proxy');
  const shopeeAMB = require('../amb-devolucoes/lib-AMB/shopee-AMB.js');
  // a fabrica le SHOPEE_PROXY_URL/KEY do ambiente e a loja de <PREFIXO>SHOPEE_LOJA (ou EMPRESA)
  const amb = shopeeAMB.criar({ PREFIXO_ENV: 'TESTE_SHP_', CHAVE_REGISTRO: 'teste', EMPRESA: 'teste', NOME_EMPRESA: 'Teste', SIGLA_EMPRESA: 'TST' });

  for (const [nome, mod] of [['GOOD', good], ['fabrica', amb]]) {
    if (!mod.cfg.ativo) { ok(false, nome + ': cfg.ativo (o proxy local esta configurado?)'); continue; }
    // rapido: acha na lista
    travarLista = false; travarRefresh = false;
    const r1 = await mod.acharDevolucao('BR123456789XY');
    ok(r1.hit && r1.hit.order_sn === '250101ABCDEFG1' && !r1.degradado, nome + ': proxy rapido, codigo na lista → achou, sem degradar');
    // nao esta na lista e o REFRESH trava: prazo total (600ms) estoura → degradado, nao "nao e Shopee"
    travarRefresh = true;
    const t0 = Date.now();
    const r2 = await mod.acharDevolucao('BR999999999ZZ');
    const ms = Date.now() - t0;
    ok(r2.hit === null && r2.degradado === true && /nao respondeu a tempo/.test(r2.motivo) && ms < 3000, '⚠️ ' + nome + ': refresh travado → resultado DEGRADADO em ' + ms + 'ms (antes: esperava sem fim e dizia "nao e Shopee"). etapa=' + r2.etapa);
    ok(typeof r2.decorridoMs === 'number' && r2.decorridoMs >= 500, '  ' + nome + ': mede o tempo decorrido');
    // lista (1a chamada) travada com cache vazio: tambem degrada
    travarRefresh = false; travarLista = true;
    if (nome === 'GOOD') { /* a GOOD ja tem cache quente; forca cache frio pelo modulo da fabrica abaixo */ }
    travarLista = false;
    // refresh travado + BR de INSUCESSO (so o indice acha): tem que achar ANTES do refresh, nao degradar
    travarRefresh = true; pedidos.length = 0;
    const rI = await mod.acharDevolucao('BRINSUCESSO01');
    ok(rI.hit && rI.hit.order_sn === '250202INSUCES1' && !rI.degradado && !pedidos.some((u) => /refresh=1/.test(u)), '⚠️ ' + nome + ': refresh lento + BR de insucesso → achou pelo indice ANTES do refresh (sem refresh)');
    travarRefresh = false;
    // cabecalhos rapidos, corpo da lista lento (1500ms > prazo 600ms): degrada, nao espera o corpo
    corpoLento = true;
    const frioCorpo = nome === 'GOOD' ? null : shopeeAMB.criar({ PREFIXO_ENV: 'TESTE_SHP3_', CHAVE_REGISTRO: 'teste3', EMPRESA: 'teste3', NOME_EMPRESA: 'T3', SIGLA_EMPRESA: 'T3' });
    const tc = Date.now();
    const rC = await (frioCorpo || mod).acharDevolucao('BR999999999ZZ');
    ok(rC.degradado === true && Date.now() - tc < 1300, '⚠️ ' + nome + ': corpo JSON lento → degradado dentro do prazo (' + (Date.now() - tc) + 'ms), nao espera o corpo');
    corpoLento = false;
    // refresh devolve cabecalho e o corpo NUNCA termina (nao e lento, e infinito): degradado, etapa 'refresh'
    corpoNuncaTermina = true;
    const tn = Date.now();
    const rN = await mod.acharDevolucao('BR888888888QQ');
    ok(rN.degradado === true && rN.etapa === 'refresh' && Date.now() - tn < 1300, '⚠️ ' + nome + ': corpo que nunca termina → degradado em ' + (Date.now() - tn) + 'ms (etapa ' + rN.etapa + ')');
    corpoNuncaTermina = false;
  }
  // cache frio + lista travada (instancia nova da fabrica)
  travarLista = true;
  const frio = shopeeAMB.criar({ PREFIXO_ENV: 'TESTE_SHP2_', CHAVE_REGISTRO: 'teste2', EMPRESA: 'teste2', NOME_EMPRESA: 'T2', SIGLA_EMPRESA: 'T2' });
  const r3 = await frio.acharDevolucao('BR123456789XY');
  ok(r3.degradado === true && r3.etapa === 'lista' && r3.qtd === 0, '  cache frio e a 1a chamada travada: degradado na etapa "lista", qtd 0');
  travarLista = false;
  // sem prazo (pre-aquecimento/espreita): o fetch de sempre, sem AbortSignal — e a tela
  const fs = require('fs'); const path = require('path');
  const busca = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'busca.js'), 'utf8');
  ok(/t\.degradado/.test(busca) && /nao respondeu a tempo/.test(busca), '  busca.js (tela unica) mostra a tentativa degradada como "nao respondeu a tempo"');
  for (const f of ['server.js', 'amb-devolucoes/lib-AMB/identificar-AMB.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    ok((src.match(/infoShopee\.degradado \? 504 : 404/g) || []).length === 1 && /infoSPX && infoSPX\.degradado\) \? 504 : 404/.test(src), '  ' + f + ': as duas tentativas shopee_return viram 504 degradado (nao 404) e empurram aviso');
  }
  proxy.closeAllConnections && proxy.closeAllConnections(); proxy.close();
  setTimeout(() => {
    console.log('');
    console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
    process.exit(falhas ? 1 : 0);
  }, 50);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
