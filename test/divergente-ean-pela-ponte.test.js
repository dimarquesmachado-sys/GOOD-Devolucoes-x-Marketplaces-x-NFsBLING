'use strict';
// b671 — CODIGO DE BARRAS -> PRODUTO NAS INSTANCIAS, PELA PONTE AO MOVER-PEDIDOS.
//
// ⚠️ O QUE ESTE TESTE PROTEGE: no divergente a GOOD resolve o codigo de barras pelo
// indice dela (b666); a Girassol/AMB nao tem indice (e nao devem montar um — foi o
// que estourou a cota do Bling em outubro). A peca lib/produto-por-ean-ponte.js
// pergunta ao Mover-Pedidos (`/<pasta-do-checkout>/buscar-produto?q=<ean>&k=`),
// que mantem o indice EAN->produto POR EMPRESA em disco. Aqui o Mover-Pedidos e
// simulado pelo adapter do axios (o que a rede faria) e a peca de PRODUCAO e
// exercitada em toda a matriz de saidas.
//
// Roda com: node test/divergente-ean-pela-ponte.test.js

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

process.env.MOVER_PEDIDOS_URL = 'https://mover-pedidos-de-teste.local';
process.env.MOVER_PEDIDOS_KEY = 'chave-de-teste';
const axios = require('axios');
const adapterOrig = axios.defaults.adapter;
const chamadas = [];
let modo = 'acha';
axios.defaults.adapter = async (config) => {
  const u = new URL(String(config.url));
  chamadas.push(u.pathname + '?' + u.searchParams.toString());
  const resp = (data, status = 200) => ({ data, status, statusText: 'OK', headers: {}, config });
  if (modo === 'fora') { const e = new Error('ECONNREFUSED'); throw e; }
  if (modo === 'guard') return resp({ error: 'not found' }, 404);
  if (modo === 'nada') return resp({ ok: false, erro: 'nada encontrado p/ "7898680302865"' });
  if (modo === 'sem_produto') return resp({ ok: true });
  return resp({ ok: true, produto: { id: 123, sku: 'SKUMF801S', nome: 'Luminaria Chao Piso 801s', ean: '7898680302865', estoque: 3 } });
};
const { produtoPorEanNoMoverPedidos, pastaDoCheckout } = require('../lib/produto-por-ean-ponte');

(async () => {
  // ── a pasta certa de cada empresa (o prefixo do painel no Mover-Pedidos) ──
  ok(pastaDoCheckout('girassol') === 'girassol-backup-offline' && pastaDoCheckout('ambtotal') === 'amb-checkout-offline' && pastaDoCheckout('good') === 'good-checkout-offline',
     '⚠️ a pasta do checkout vem da ficha (girassol-backup-offline / amb-checkout-offline / good-checkout-offline)');

  // ── matriz de saidas ──
  const r1 = await produtoPorEanNoMoverPedidos('girassol', '7898680302865');
  ok(r1.ok === true && r1.via === 'mover-pedidos' && r1.produto.codigo === 'SKUMF801S' && r1.produto.gtin === '7898680302865' && r1.produto.id === 123,
     '⚠️ EAN conhecido la: produto { id, nome, codigo, gtin } via mover-pedidos');
  ok(/^\/girassol-backup-offline\/buscar-produto\?q=7898680302865&k=chave-de-teste$/.test(chamadas[chamadas.length - 1]),
     '  chamou /<pasta>/buscar-produto?q=<ean>&k=<MOVER_PEDIDOS_KEY> (' + chamadas[chamadas.length - 1] + ')');
  modo = 'nada';
  const r2 = await produtoPorEanNoMoverPedidos('ambtotal', '7898680302865');
  ok(r2.ok === false && /nada encontrado/.test(r2.motivo) && !r2.ponte_fora, '  nada la: ok:false com o motivo do Mover-Pedidos (nao e "ponte fora")');
  modo = 'guard';
  const r3 = await produtoPorEanNoMoverPedidos('ambtotal', '7898680302865');
  ok(r3.ok === false && r3.ponte_fora === true && /404/.test(r3.motivo), '  404 do guard (chave errada/rota ausente): ponte_fora, motivo diz');
  modo = 'fora';
  const r4 = await produtoPorEanNoMoverPedidos('girassol', '7898680302865');
  ok(r4.ok === false && r4.ponte_fora === true && /nao respondeu/.test(r4.motivo), '  Mover-Pedidos fora: ponte_fora, nunca lanca');
  modo = 'sem_produto';
  const r5 = await produtoPorEanNoMoverPedidos('girassol', '7898680302865');
  ok(r5.ok === false && /sem produto/.test(r5.motivo), '  resposta ok sem produto: ok:false (nao inventa)');
  modo = 'acha';
  const r6 = await produtoPorEanNoMoverPedidos('girassol', 'ABC123');
  ok(r6.ok === false && /invalido/.test(r6.motivo) && chamadas.filter((c) => /ABC123/.test(c)).length === 0, '  codigo que nao e EAN: recusa SEM chamar a ponte');
  const r7 = await produtoPorEanNoMoverPedidos('aurora', '7898680302865');
  ok(r7.ok === false && /fora do registro/.test(r7.motivo), '  empresa fora do registro: recusa');
  const guardaUrl = process.env.MOVER_PEDIDOS_URL; delete process.env.MOVER_PEDIDOS_URL;
  const r8 = await produtoPorEanNoMoverPedidos('girassol', '7898680302865');
  ok(r8.ok === false && r8.ponte_fora === true && /nao configurada/.test(r8.motivo), '  ponte nao configurada: ponte_fora com motivo (nao derruba a rota)');
  process.env.MOVER_PEDIDOS_URL = guardaUrl;
  axios.defaults.adapter = adapterOrig;

  // ── as rotas usam a peca ──
  const compat = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(/const modoEan = String\(req\.query\.ean \|\| ''\) === '1';/.test(compat) && /produtoPorEanNoMoverPedidos\(cfgEmpresa\.CHAVE_REGISTRO, soDigitos\)/.test(compat),
     '⚠️ instancias: com ?ean=1 a rota pergunta a ponte com a EMPRESA da propria instancia');
  ok(/motivoPonte/.test(compat) && /e o Bling nao tem produto com o codigo exato/.test(compat), '  ponte fora/nada la: segue pro SKU exato e o motivo vai junto');
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(/produtoPorEanNoMoverPedidos\('good', soDigitos\)/.test(srv) && /e o Mover-Pedidos: \$\{rp\.motivo\}/.test(srv),
     '  GOOD: indice sem condicao de responder -> pergunta a ponte antes de dizer "nao sei"');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
