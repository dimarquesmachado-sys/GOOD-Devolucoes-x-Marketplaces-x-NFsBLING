'use strict';
// b666 — O PRODUTO DO DIVERGENTE NUNCA E "O PRIMEIRO DA LISTA".
//
// ⚠️ CASO REAL (GOOD, 07/11): no divergente da NF 080043 o estoquista bipou o
// codigo de barras da luminaria 801s e o card nasceu como "Arandela
// KJBD-148-GOLD, 2 un". Causa: `buscarProdutoBlingPorSku` consultava
// `/produtos?codigo=<codigo>` — uma BUSCA do Bling, que com um EAN no lugar do
// SKU devolve parecidos de qualquer produto — e, sem match exato, pegava
// `lista[0]`. A copia da fabrica (bling-AMB.buscarProdutoPorSku) ja devolvia so
// o `exato`. A GOOD nivela por cima: sem exato, nao ha produto (ambiguidade nao
// escolhe — regra do dono, 18/08). E a rota do divergente resolve EAN pelo
// INDICE de produtos antes de ir ao Bling: um produto = ele; varios = recusa e
// lista; nenhum = segue pelo SKU exato.
//
// Roda com: node test/divergente-nao-escolhe-primeiro.test.js

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

// ── 1. a funcao de PRODUCAO, com um Bling falso que devolve "parecidos" ──
process.env.BLING_ACCESS_TOKEN = process.env.BLING_ACCESS_TOKEN || 'token-de-teste';
const LISTA = [
  { id: 1, codigo: 'KJBD-148-GOLD', nome: 'Luminaria Arandela 30,5cm Barra LED Dourada' },
  { id: 2, codigo: 'SKUMF801S', nome: 'Luminaria Chao Piso Arco Base Marmore 801s' },
];
// chamarBling usa `axios({...})`: simulo o Bling pelo ADAPTER do axios (o que a rede faria)
const axios = require('axios');
const adapterOrig = axios.defaults.adapter;
axios.defaults.adapter = async (config) => {
  const u = String(config.url || '');
  const resp = (data, status = 200) => ({ data, status, statusText: 'OK', headers: {}, config });
  if (/\/produtos\?codigo=/.test(u)) return resp({ data: LISTA });
  const m = u.match(/\/produtos\/(\d+)$/);
  if (m) return resp({ data: Object.assign({ gtin: '7891234567890' }, LISTA.find((x) => String(x.id) === m[1])) });
  const e = new Error('404'); e.response = resp({}, 404); throw e;
};
const bling = require('../lib/bling');

(async () => {
  const rEan = await bling.buscarProdutoBlingPorSku('7899999999999');   // EAN bipado: o Bling lista "parecidos", nenhum com esse codigo
  ok(rEan && rEan.ok && rEan.produto === null && rEan.candidatos === 2,
     '⚠️ codigo sem match exato (EAN bipado): NENHUM produto — antes virava o 1o da lista (a Arandela)');
  const rExato = await bling.buscarProdutoBlingPorSku('skumf801s');
  ok(rExato && rExato.ok && rExato.produto && rExato.produto.id === 2,
     '  SKU exato (mesmo em caixa diferente) continua achando o produto certo (801s)');
  const rNada = await bling.buscarProdutoBlingPorSku('   ');
  ok(rNada && rNada.ok && rNada.produto === null, '  codigo vazio: nada');
  axios.defaults.adapter = adapterOrig;

  // ── 2. a rota do divergente: EAN pelo INDICE, ambiguidade recusa, Bling so exato ──
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const rota = srv.slice(srv.indexOf("app.get('/api/produto/ean-por-sku/:sku'"), srv.indexOf("app.get('/callback'"));
  ok(rota.length > 200 && /pareceEan/.test(rota) && /IDX_PROD\.itens\.filter/.test(rota) && /it\.eans\)\s*&&\s*it\.eans\.includes\(soDigitos\)/.test(rota),
     '⚠️ EAN de 8-14 digitos e procurado no INDICE pelos EANs dos produtos antes do Bling');
  ok(/porEan\.length === 1/.test(rota) && /via: 'indice_ean'/.test(rota), '  UM produto com o EAN: e ele');
  ok(/porEan\.length > 1/.test(rota) && /ambiguo: true/.test(rota) && /encontrado: false/.test(rota) && /candidatos:/.test(rota),
     '  VARIOS com o mesmo EAN: recusa (encontrado:false, ambiguo) e lista os candidatos');
  ok(/motivo:/.test(rota), '  e quando nao acha diz o MOTIVO');
  const lib = fs.readFileSync(path.join(RAIZ, 'lib', 'bling.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(!/match = lista\[0\]/.test(lib), '⚠️ lib/bling: o fallback "pega o primeiro" saiu');

  // ── 3. o front mostra o motivo no modal do divergente ──
  const front = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'triagem.js'), 'utf8');
  ok(/d && d\.motivo/.test(front), '  triagem.js mostra o motivo quando o codigo nao resolve');
  for (const h of ['public/index.html', 'amb-devolucoes/public-AMB/index-AMB.html']) {
    const x = fs.readFileSync(path.join(RAIZ, h), 'utf8');
    ok(!/triagem\.js\?v=b527/.test(x), `  ${h}: ?v= do triagem.js bumpado (nao serve o front velho do cache)`);
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
