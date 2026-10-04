'use strict';
// b509 — de-para de SKU tambem na GOOD (biblioteca unica, empresa como parametro). Roda a lib DE PRODUCAO.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const { criarSkuDepara } = require('../lib/sku-depara');
(async () => {
  const linhas = [{ sku_antigo: 'FL-1011-PRETO', sku_atual: '3933398010054', produto_id: 9 }];
  const usadas = [];
  const q = (tab) => { usadas.push(tab); const o = { _eq: null, select() { return o; }, eq(c, v) { o._eq = v; return o; }, order() { return o; }, in() { return o; },
    limit: async () => ({ data: tab === 'sku_depara' ? linhas.filter((l) => !o._eq || l.sku_antigo === o._eq) : [], error: null }) }; return o; };
  const dp = criarSkuDepara({ obterDb: () => ({ from: q }), tabelaDepara: 'sku_depara', tabelaDevolucoes: 'devolucoes', colunaData: 'created_at' });
  const r = await dp.resolverSku('FL-1011-PRETO');
  ok(r.trocado && r.sku === '3933398010054', '⚠️ SKU antigo vira o atual (' + r.sku + ')');
  ok(usadas[0] === 'sku_depara', '  usa a tabela DESTA empresa (sku_depara)');
  const r2 = await dp.resolverSku('OUTRO');
  ok(!r2.trocado && r2.sku === 'OUTRO', '  SKU sem ligacao segue igual');
  ok((await criarSkuDepara({ obterDb: () => null, tabelaDepara: 'x', tabelaDevolucoes: 'y' }).resolverSku('A')).sku === 'A', '  sem banco: nunca trava (devolve o proprio SKU)');
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const rt of ["app.get('/api/admin/sku-depara', requerAdmin", "app.post('/api/admin/sku-depara', requerAdmin", "app.get('/api/admin/sku-depara/retroativo', requerAdmin", "app.post('/api/admin/sku-depara/retroativo', requerAdmin", "app.delete('/api/admin/sku-depara/:sku', requerAdmin"]) ok(s.includes(rt), '  GOOD: ' + rt.split("'")[1] + ' (' + rt.split('(')[0] + ', admin)');
  const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'painel-devolucoes.html'), 'utf8');
  ok(/id="caixaDepara"/.test(h) && /function alternarDepara\(/.test(h) && /function salvarDepara\(/.test(h) && /function apagarDepara\(/.test(h), '⚠️ painel da GOOD tem a mesma tela do de-para da AMB');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.message); process.exit(1); });
