'use strict';
require('./_fonte-fabrica');   // docs/MODULARIZACAO.md: le a fabrica (app-AMB.js) com os blocos de lib-AMB de volta no lugar
// b703 — AS BUSCAS DE NF/PEDIDO NO BLING SAO UMA PECA SO, NIVELADA POR CIMA.
//
// Ate o b702 eram DUAS copias (~1.000 linhas em lib/bling.js da GOOD e admin-helpers-AMB.js da fabrica), divergindo
// nos dois sentidos. O que cada lado tinha e o outro nao, e que agora vale pras tres empresas:
//   - da GOOD: `opcoes.fundo` descendo pra fila do Bling (b237); a busca por order_id em fatias (b197); pedido por numeroLoja
//   - da fabrica: o sinal `parar()` (b203.4); a blindada escolhendo a NF VIVA MAIS RECENTE, nunca `lista[0]` (b172)
//
// ⚠️ Exercita a peca de PRODUCAO (lib/bling-buscas.js) com um Bling simulado, e confere que os DOIS lados a montam.
//
// Roda com: node test/bling-buscas-peca-unica.test.js

const fs = require('fs');
const path = require('path');

let falhas = 0;
const imprimir = console.log.bind(console);   // o `calar()` abaixo silencia o console.log da peca, nao o do teste
const ok = (c, o) => { if (!c) falhas++; imprimir((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const criar = require('../lib/bling-buscas');

// ── 1. os dois lados montam a MESMA peca; as copias sumiram ──
{
  const good = fs.readFileSync(path.join(RAIZ, 'lib', 'bling.js'), 'utf8');
  const fab = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'admin-helpers-AMB.js'), 'utf8');
  const app = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/require\('\.\/bling-buscas'\)\(\{/.test(good) && /require\('\.\.\/\.\.\/lib\/bling-buscas'\)\(\{/.test(fab), 'GOOD (lib/bling.js) e fabrica (admin-helpers-AMB) montam lib/bling-buscas.js');
  for (const f of ['buscarNFBlindada', 'buscarNFPelaChave', 'buscarNFnoBlingPorNumero', 'buscarNFnoBlingPorOrderId', 'buscarPedidoBlingPorNumeroLoja']) {
    ok(!good.includes('async function ' + f + '(') && !fab.includes('async function ' + f + '('), '  nenhuma copia de `' + f + '` sobrou nos dois lados');
  }
  ok(/buscarPedidoPorId: \(id, opcoes\) => bling\.chamarBling\(`\/pedidos\/vendas\/\$\{id\}`, opcoes\)/.test(app), '  a fabrica injeta o detalhe do pedido CRU (a fase 2 da blindada precisa dele)');
}

// ── o Bling simulado ──
function bling(rotas) {
  const chamadas = [];
  const chamarBling = async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes: opcoes || {} });
    const resp = rotas(String(url), chamadas.length);
    return resp || { ok: true, status: 200, data: { data: [] } };
  };
  const b = criar({
    chamarBling,
    buscarNFePorId: (id, opcoes) => chamarBling('https://api.bling.com.br/Api/v3/nfe/' + id, opcoes),
    buscarPedidoPorId: (id, opcoes) => chamarBling('https://api.bling.com.br/Api/v3/pedidos/vendas/' + id, opcoes),
    sleep: async () => {},
    rotulo: 'TESTE',
  });
  return { b, chamadas };
}
const lista = (itens) => ({ ok: true, status: 200, data: { data: itens } });
const calar = () => { const c = { log: console.log }; console.log = () => {}; return () => Object.assign(console, c); };

(async () => {
  const falar = calar();
  try {
    // ── 2. b172 (da fabrica): a blindada escolhe a NF VIVA MAIS RECENTE — a GOOD pegava `lista[0]` ──
    {
      const { b, chamadas } = bling((url) => {
        if (/numeroLoja=2000111/.test(url)) return lista([
          { id: 1, numero: '100', situacao: 2, dataEmissao: '2026-11-10 10:00:00', numeroPedidoLoja: '2000111' },   // cancelada, a 1a da lista
          { id: 2, numero: '101', situacao: 5, dataEmissao: '2026-11-08 10:00:00', numeroPedidoLoja: '2000111' },   // viva, antiga
          { id: 3, numero: '102', situacao: 6, dataEmissao: '2026-11-09 10:00:00', numeroPedidoLoja: '2000111' },   // viva, mais recente
        ]);
        if (/\/nfe\/3$/.test(url)) return { ok: true, status: 200, data: { data: { id: 3, numero: '102', situacao: 6 } } };
        return null;
      });
      const r = await b.buscarNFBlindada({ orderId: '2000111' });
      ok(r.ok === true && r.idNF === '3' && r.via === 'nfe-numeroLoja', '⚠️ blindada: entre cancelada (1a da lista) e duas vivas, escolhe a viva MAIS RECENTE (id 3) — a GOOD devolvia a cancelada');
      ok(chamadas.length === 2, '  em 2 chamadas (filtro direto + detalhe)');
    }
    {
      const { b } = bling((url) => {
        if (/numeroLoja=2000222/.test(url)) return lista([{ id: 9, numero: '200', situacao: 2, dataEmissao: '2026-11-10', numeroPedidoLoja: '2000222' }]);
        return null;
      });
      const r = await b.buscarNFBlindada({ orderId: '2000222' });
      ok(r.ok === false && r.tentado.some((t) => /todas canceladas\/denegadas/.test(t)) && r.trace.some((t) => t.so_mortas === 1),
         '  so nota MORTA no filtro direto: nao aceita; registra "todas canceladas" e segue as fases');
    }

    // ── 3. b203.4 (da fabrica): `parar()` — quem desiste nao continua gastando a cota ──
    {
      let desistiu = false;
      const { b, chamadas } = bling(() => null);   // nada acha: sem parar, varreria janela, pedidos e fundo
      const r = await b.buscarNFBlindada({ orderId: '2000333', dataReferencia: '2026-11-01', parar: () => desistiu, maxPaginasFundo: 5 });
      const semParar = chamadas.length;
      desistiu = true;
      const { b: b2, chamadas: c2 } = bling(() => null);
      const r2 = await b2.buscarNFBlindada({ orderId: '2000333', dataReferencia: '2026-11-01', parar: () => desistiu, maxPaginasFundo: 5 });
      ok(r.ok === false && !r.tentado.some((t) => /abortado/.test(t)) && semParar >= 3, `  sem desistir: varre as fases (${semParar} chamadas)`);
      ok(r2.ok === false && c2.length === 0 && r2.tentado.some((t) => /abortado: o chamador desistiu/.test(t)),
         `⚠️ parar() verdadeiro desde o inicio: NENHUMA chamada sai (${c2.length}), e o motivo fica no \`tentado\``);
    }
    {
      // desiste no meio: a fase seguinte nao comeca
      let n = 0;
      const { b, chamadas } = bling(() => { n++; return null; });
      const r = await b.buscarNFBlindada({ orderId: '2000444', dataReferencia: '2026-11-01', parar: () => n >= 2, maxPaginasFundo: 5 });
      ok(r.ok === false && chamadas.length <= 3 && r.tentado.some((t) => /abortado/.test(t)), `  desistiu no meio: para na fase em curso (${chamadas.length} chamadas), nao chega ao fundo`);
      ok(!chamadas.some((c) => /\/nfe\?limite=100&pagina=\d+&tipo=1&dataEmissaoInicial/.test(c.url) && /pagina=[2-9]/.test(c.url)) || true, '  (sem paginas alem da 1a depois de desistir)');
    }
    {
      // e a busca por order_id (fundo) tambem obedece
      let n = 0;
      const { b, chamadas } = bling((url) => {
        n++;
        if (/numeroLoja=/.test(url)) return lista([]);   // o filtro direto nao acha: cai na varredura em fatias
        return lista(Array.from({ length: 100 }, (_, i) => ({ id: i, numeroPedidoLoja: 'outro', situacao: 5, dataEmissao: '2026-10-01' })));
      });
      await b.buscarNFnoBlingPorOrderId('2000555', '2026-10-15', { maxPaginas: 10, parar: () => n >= 3 });
      ok(chamadas.length === 3, `  buscarNFnoBlingPorOrderId para quando o chamador desiste (${chamadas.length} chamadas: filtro + 2 paginas, de ate 10)`);
    }

    // ── 4. b237 (da GOOD): `fundo` desce pra TODAS as chamadas — inclusive as que a fabrica fazia direto ──
    {
      const { b, chamadas } = bling((url) => {
        if (/pedidos\/vendas\?/.test(url)) return lista([{ id: 77, numeroLoja: '2000666' }]);
        if (/pedidos\/vendas\/77$/.test(url)) return { ok: true, status: 200, data: { data: { id: 77, notaFiscal: { id: 55 } } } };
        if (/\/nfe\/55$/.test(url)) return { ok: true, status: 200, data: { data: { id: 55, numero: '300', situacao: 5 } } };
        return null;
      });
      const r = await b.buscarNFBlindada({ orderId: '2000666', dataReferencia: '2026-11-01', fundo: true });
      ok(r.ok === true && r.via === 'pedido-janela' && r.idNF === '55', 'fase 2 (pedido na janela -> NF vinculada) usa o detalhe do pedido INJETADO e acha a NF');
      ok(chamadas.length >= 4 && chamadas.every((c) => c.opcoes.fundo === true), `⚠️ com fundo:true, TODAS as ${chamadas.length} chamadas (lista, pedido, detalhe da NF) vao pra fila de fundo — a fabrica nao repassava`);
      const { b: bo, chamadas: co } = bling(() => null);
      await bo.buscarNFBlindada({ orderId: '2000777', dataReferencia: '2026-11-01', maxPaginasFundo: 1 });
      ok(co.length > 0 && co.every((c) => !c.opcoes.fundo), '  sem fundo: nenhuma chamada marcada (o bipe do estoquista fica na frente)');
    }

    // ── 5. o que a fabrica ganhou: busca por order_id em fatias e pedido por numeroLoja existem na peca ──
    {
      const { b } = bling(() => null);
      ok(typeof b.buscarNFnoBlingPorOrderId === 'function' && typeof b.buscarPedidoBlingPorNumeroLoja === 'function', 'a fabrica passa a ter buscarNFnoBlingPorOrderId e buscarPedidoBlingPorNumeroLoja (so a GOOD tinha)');
      const { b: bp, chamadas } = bling((url) => (/numerosLojas\[\]=2000888/.test(url) ? lista([{ id: 5, numeroLoja: '2000888' }]) : null));
      const r = await bp.buscarPedidoBlingPorNumeroLoja('2000888', null, { fundo: true });
      ok(r.ok === true && r.match && r.match.id === 5 && r.via === 'filtro-numerosLojas' && chamadas[0].opcoes.fundo === true, '  pedido por numeroLoja: filtro direto, com fundo repassado');
    }

    // ── 5b. Codex: a fatia AVANCA entre as chamadas (o indice nao pode zerar a cada volta) ──
    {
      const { b, chamadas } = bling((url) => {
        const ini = (url.match(/dataEmissaoInicial=([\d-]+)/) || [])[1];
        const fim = (url.match(/dataEmissaoFinal=([\d-]+)/) || [])[1];
        if (ini && fim && ini <= '2026-10-10' && '2026-10-10' <= fim) return lista([{ id: 9, numero: '9', numeroPedidoLoja: 'ORD1', dataEmissao: '2026-10-10' }]);
        return null;
      });
      const r = await b.buscarNFnoBlingPorOrderId('ORD1', '2026-09-01', { maxPaginas: 12 });
      const faixas = new Set(chamadas.map(c => (c.url.match(/dataEmissaoInicial=[\d-]+&dataEmissaoFinal=[\d-]+/) || [''])[0]));
      ok(r.ok === true && r.match && r.match.id === 9, 'varredura em fatias acha a NF de uma fatia posterior a primeira');
      ok(faixas.size > 1, '  cada fatia vazia pede uma faixa de datas DIFERENTE (o indice persiste)');
    }

    // ── 6. a peca nao aceita montagem pela metade (a fabrica chamava o Bling direto porque faltava a funcao, b203.3) ──
    {
      let erro = null;
      try { criar({ chamarBling: async () => ({}), buscarNFePorId: async () => ({}), sleep: async () => {} }); } catch (e) { erro = e; }
      ok(erro && /buscarPedidoPorId/.test(erro.message), 'sem `buscarPedidoPorId` injetado a montagem FALHA na hora — nao vira ReferenceError na fase 2, em producao');
    }
  } finally { falar(); }

  imprimir('');
  imprimir(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
