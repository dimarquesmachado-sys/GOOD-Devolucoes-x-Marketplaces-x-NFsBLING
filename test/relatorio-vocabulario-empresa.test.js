'use strict';
// Roda com: node test/relatorio-vocabulario-empresa.test.js
// b652 (Codex #522): AMB/Girassol usam `criado_em` e guardam o desfecho em
// `status` (tipo sempre 'devolucao'). O relatorio compartilhado precisa
// selecionar/ordenar/filtrar pela coluna da empresa e normalizar o tipo.
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const registrar = require('../lib/rotas-relatorios');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

function fake(dados) {
  const chamadas = [];
  const q = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res) => res({ data: dados.map((x) => ({ ...x })), error: null });
      return (...a) => { chamadas.push([prop, ...a]); return q; };
    },
  });
  return { sb: { from: () => q }, chamadas };
}
const pega = (porta, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: porta, path: p }, (r) => {
    let c = ''; r.on('data', (d) => { c += d; }); r.on('end', () => resolve(JSON.parse(c)));
  }).on('error', reject);
});

async function sobe(extra, dados) {
  const { sb, chamadas } = fake(dados);
  const app = express();
  registrar(app, {
    supabase: sb,
    requerAdmin: (q, s, n) => n(),
    tabelas: { devolucoes: 'd', tags: 't', devolucaoTags: 'dt' },
    buscarProdutos: null,
    ...extra,
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  return { srv, chamadas, porta: srv.address().port };
}

(async () => {
  const dadosAmb = [
    { id: 1, tipo: 'devolucao', status: 'aprovado', produto_sku: 'A', devolucao_tags: [] },
    { id: 2, tipo: 'devolucao', status: 'problema', produto_sku: 'A', produto_qtd: 2, devolucao_tags: [] },
  ];
  const amb = await sobe({ colunaData: 'criado_em', tipoNoStatus: true }, dadosAmb);
  const r = await pega(amb.porta, '/api/admin/relatorios/devolucoes?data_inicio=2026-10-01&data_fim=2026-10-31&tipo=problema');
  const sel = amb.chamadas.find((c) => c[0] === 'select')[1];
  ok(/created_at:criado_em/.test(sel), 'AMB: seleciona criado_em com alias created_at');
  ok(amb.chamadas.some((c) => c[0] === 'order' && c[1] === 'criado_em'), 'AMB: ordena por criado_em');
  ok(amb.chamadas.some((c) => c[0] === 'gte' && c[1] === 'criado_em'), 'AMB: data_inicio em criado_em');
  ok(amb.chamadas.some((c) => c[0] === 'lt' && c[1] === 'criado_em'), 'AMB: data_fim em criado_em');
  ok(!amb.chamadas.some((c) => ['order', 'gte', 'lt'].includes(c[0]) && c[1] === 'created_at'), 'AMB: nada ordenado/filtrado em created_at');
  ok(amb.chamadas.some((c) => c[0] === 'or' && /status\.eq\.problema/.test(c[1])), 'AMB: filtro de desfecho olha o status');
  ok(r.cards.totalAprovado === 1 && r.cards.totalProblema === 1, 'AMB: cards contam aprovado/problema pelo status');
  ok(r.rankingProblemas.length === 1 && r.rankingProblemas[0].qtde_problema === 2, 'AMB: ranking de problemas enxerga o status');
  amb.srv.close();

  const good = await sobe({}, [{ id: 1, tipo: 'aprovado', status: 'x', devolucao_tags: [] }]);
  await pega(good.porta, '/api/admin/relatorios/devolucoes?data_inicio=2026-10-01&tipo=aprovado');
  ok(good.chamadas.some((c) => c[0] === 'order' && c[1] === 'created_at'), 'GOOD: continua em created_at');
  ok(good.chamadas.some((c) => c[0] === 'eq' && c[1] === 'tipo' && c[2] === 'aprovado'), 'GOOD: filtro de tipo continua eq(tipo)');
  ok(!good.chamadas.some((c) => c[0] === 'or' && /status/.test(c[1])), 'GOOD: sem or de status');
  // b654 (Codex #522): shipment_id NULL permanece; so DEF-% sai
  ok(good.chamadas.some((c) => c[0] === 'or' && c[1] === 'shipment_id.is.null,shipment_id.not.like.DEF-%'), 'GOOD: exclusao de DEF- preserva shipment_id NULL');
  ok(!good.chamadas.some((c) => c[0] === 'not' && c[1] === 'shipment_id'), 'GOOD: sem .not simples em shipment_id');
  good.srv.close();

  let erro = null;
  try {
    registrar(express(), {
      supabase: {}, requerAdmin() {},
      tabelas: { devolucoes: 'd', tags: 't', devolucaoTags: 'dt' },
      buscarProdutos: null, colunaData: 'x;drop',
    });
  } catch (e) { erro = e; }
  ok(!!erro, 'colunaData invalida derruba o registro');

  // link de volta: a AMB/Girassol reescrevem o href do html compartilhado
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'relatorios.html'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  const alvo = 'href="../admin.html"';
  ok(html.includes(alvo) && src.includes(".replace('" + alvo + "', 'href=\"../painel\"')"), 'AMB reescreve o Voltar ao Admin para ../painel');
  process.exit(falhas ? 1 : 0);
})();
