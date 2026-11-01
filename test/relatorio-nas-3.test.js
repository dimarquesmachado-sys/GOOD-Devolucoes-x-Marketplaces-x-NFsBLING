'use strict';
// Roda com: node test/relatorio-nas-3.test.js
//
// b651 — fatia 2 do porte do relatorio: AMB e Girassol registram a peca
// (b650) no ROUTER da instancia. Este teste trava as premissas que a
// fatia 2 inteira assume, cada uma com a peca/arquivo DE PRODUCAO:
//
//   1. registrar no router montado sob um prefixo poe as rotas SOB o
//      prefixo (e NAO vaza pra raiz) — Express de verdade, porta efemera;
//   2. o requerAdmin INJETADO e o aplicado (sem admin: 401; a pagina
//      /admin/relatorios.html idem);
//   3. a lista da instancia le a tabela DA EMPRESA (devolucoes_amb);
//   4. as fichas das 3 empresas tem tags/devolucaoTags com os nomes certos
//      (typo aqui = relatorio de outra empresa, o fail-fast da peca pega);
//   5. o front compartilhado nao tem MAIS nenhum fetch('/api absoluto
//      (classe: pagina servida sob /amb chamando a API da GOOD) e o html
//      bumpou o ?v= do js mexido;
//   6. o provisionador de empresa nova ganhou os 2 moldes de tags e as FKs
//      (sem FK o PostgREST nao monta o embed do relatorio).

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const registrarRotasRelatorios = require('../lib/rotas-relatorios');
const { obterEmpresa } = require('../lib/empresas');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

function fakeSupabase(dados) {
  const froms = [];
  const q = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res) => res({ data: (dados || []).map((x) => ({ ...x })), error: null });
      if (prop === 'single') return () => Promise.resolve({ data: null, error: null });
      return () => q;
    },
  });
  return { sb: { from: (nome) => { froms.push(nome); return q; } }, froms };
}

function pega(porta, caminho, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: porta, path: caminho, headers: headers || {} }, (res) => {
      let corpo = '';
      res.on('data', (c) => { corpo += c; });
      res.on('end', () => resolve({ status: res.statusCode, corpo }));
    }).on('error', reject);
  });
}

(async () => {
  // ── 1-3: Express real, peca registrada no router sob /amb ───────────
  const { sb, froms } = fakeSupabase([
    { id: 'd1', order_id: '2000018825130500', marketplace: 'ml', tipo: 'aprovado', produto_sku: 'X', devolucao_tags: [] },
  ]);
  const app = express();
  const router = express.Router();
  const requerAdmin = (req, res, next) => {
    if (req.headers['x-teste-admin'] === '1') return next();
    return res.status(401).json({ ok: false, erro: 'acesso restrito ao admin' });
  };
  registrarRotasRelatorios(router, {
    supabase: sb,
    requerAdmin,
    tabelas: { devolucoes: 'devolucoes_amb', tags: 'tags_amb', devolucaoTags: 'devolucao_tags_amb' },
    buscarProdutos: null,
  });
  // a pagina, como a fatia 2 serve na instancia (mesmo arquivo da GOOD)
  router.get('/admin/relatorios.html', requerAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'relatorios.html'));
  });
  app.use('/amb', router);

  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const porta = srv.address().port;

  const semAuth = await pega(porta, '/amb/api/admin/relatorios/devolucoes');
  ok(semAuth.status === 401, 'sem sessao de admin a rota da instancia recusa (401) — o requerAdmin INJETADO e o aplicado');

  const comAuth = await pega(porta, '/amb/api/admin/relatorios/devolucoes', { 'x-teste-admin': '1' });
  const corpo = JSON.parse(comAuth.corpo || '{}');
  ok(comAuth.status === 200 && corpo.ok === true && Array.isArray(corpo.porMarketplace),
    'registrada no ROUTER, a rota responde SOB o prefixo: /amb/api/admin/relatorios/devolucoes');
  ok(froms.length > 0 && froms.every((f) => f === 'devolucoes_amb'),
    '⚠️ a lista da instancia le a tabela DA EMPRESA — ' + JSON.stringify([...new Set(froms)]));

  const raiz = await pega(porta, '/api/admin/relatorios/devolucoes', { 'x-teste-admin': '1' });
  ok(raiz.status === 404, 'e NADA vaza pra raiz: /api/... sem o prefixo nao existe neste app (404)');

  const paginaSem = await pega(porta, '/amb/admin/relatorios.html');
  ok(paginaSem.status === 401, 'a PAGINA tambem exige admin (espelho da GOOD, que serve com requerAdmin)');
  const paginaCom = await pega(porta, '/amb/admin/relatorios.html', { 'x-teste-admin': '1' });
  ok(paginaCom.status === 200 && /relatorios\.js\?v=/.test(paginaCom.corpo),
    'com admin a pagina vem, e carrega o js com ?v= (cache-busting do js mexido)');
  srv.close();

  // ── 4: fichas das 3 empresas com os nomes certos ────────────────────
  const esperado = {
    good: { tags: 'tags', devolucaoTags: 'devolucao_tags' },
    ambtotal: { tags: 'tags_amb', devolucaoTags: 'devolucao_tags_amb' },
    girassol: { tags: 'tags_girassol', devolucaoTags: 'devolucao_tags_girassol' },
  };
  for (const [chave, t] of Object.entries(esperado)) {
    const ficha = obterEmpresa(chave);
    ok(ficha && ficha.tabelas && ficha.tabelas.tags === t.tags && ficha.tabelas.devolucaoTags === t.devolucaoTags,
      `ficha ${chave}: tags=${t.tags} e devolucaoTags=${t.devolucaoTags} (o registro da fabrica le daqui)`);
  }

  // ── 5: o front compartilhado nao chama a API por caminho absoluto ───
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'relatorios.js'), 'utf8');
  ok(js.includes('const BASE_API = location.pathname.replace('),
    'relatorios.js deriva BASE_API do caminho da propria pagina');
  ok(!/fetch\('\/api\//.test(js) && (js.match(/fetch\(BASE_API \+ '\/api\/admin\//g) || []).length === 5,
    "⚠️ NENHUM fetch('/api absoluto sobrou no front compartilhado — os 5 usam BASE_API (sob /amb, absoluto chamaria a GOOD)");

  // ── 6: o provisionador da empresa nova ganhou tags e as FKs ─────────
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'provisionar-empresa.sql'), 'utf8');
  ok(sql.includes("['tags',           'tags_amb']") && sql.includes("['devolucao_tags', 'devolucao_tags_amb']"),
    'provisionar-empresa.sql: os 2 moldes de tags entraram na lista (empresa nova nasce com relatorio)');
  ok(sql.includes("_tag_id_fkey") && sql.includes("_devolucao_id_fkey") && sql.includes('on delete cascade'),
    '  e cria as 2 FKs do embed (LIKE nao copia foreign key; sem FK o PostgREST nao monta o embed)');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao): ' + e.message); process.exit(1); });
