'use strict';
// 31/10 — GOOD: triagem bipada pela CHAVE DA NF ficava com o padrao 'mercadolivre' (Amazon 702-..., Magalu 15...,
// TikTok 58... contados como ML no relatorio, link pro ML no card). O detector da casa nao reconhecia Amazon nem o
// Magalu de 16 digitos. Casos REAIS da lista da GOOD de 31/10. Roda o detector de PRODUCAO.
const fs = require('fs'); const path = require('path');
const mkt = require('../amb-devolucoes/lib-AMB/marketplace-AMB');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const m = (p) => mkt.detectar(p, {}).marketplace;
ok(m('702-9567465-0509861') === 'amazon', '⚠️ Amazon (Renata, 31/10) — antes "desconhecido"');
ok(m('1572870105525626') === 'magalu', '⚠️ Magalu de 16 digitos (Gustavo Melo, 31/10) — antes "desconhecido"');
ok(m('586452009971057828') === 'tiktok', '  TikTok 18 digitos (Vanessa) continua TikTok');
ok(m('2000018825130500') === 'ml', '  ML 2000... continua ML');
ok(m('261014JE047FHN') === 'shopee', '  Shopee alfanumerico continua Shopee');
ok(m('9914488') === 'magalu' && mkt.detectar('9914488', {}).confianca === 'baixa', '  numerico curto continua palpite de baixa confianca (nao vira rotulo na GOOD)');
const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
ok(/const mktTriagem = dados\.marketplace \|\| marketplacePeloPedido\(dados\.order_id\);/.test(s), '⚠️ GOOD: triagem sem marketplace grava o canal pelo numero do pedido');
// b649: as funcoes foram para lib/marketplace-exibido.js — o teste roda a peca de PRODUCAO, nao le texto
const mx = require('../lib/marketplace-exibido');
ok(mx.marketplacePeloPedido('9914488') === null && mx.marketplacePeloPedido('702-9567465-0509861') === 'amazon',
  '  GOOD: so com confianca alta ou media (marketplace errado e pior que vazio)');
ok(/require\('\.\/lib\/marketplace-exibido'\)/.test(s), '  GOOD: o server.js usa a peca unica (lista e relatorio com a mesma regra)');
ok(/aprovadas: marcadores\.enriquecer\(aprovadas\.map\(corrigirMarketplaceExibido\)\)/.test(s) && /problemas: marcadores\.enriquecer\(problemas\.map\(corrigirMarketplaceExibido\)\)/.test(s),
  '⚠️ GOOD: a lista corrige os registros antigos na hora de mostrar (sem mexer no banco)');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
