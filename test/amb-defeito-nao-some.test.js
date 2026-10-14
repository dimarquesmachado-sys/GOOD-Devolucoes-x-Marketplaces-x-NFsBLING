'use strict';
// Executa a lista do servidor comum com as fichas AMB/Girassol.
// Regressoes b383/b384/b385: peças resolvidas por pedido ocupavam o limite
// antes de desaparecerem em JS; a aba aberta também zerava a contagem
// das demais. Nenhuma função de filtro/limite é clonada neste teste.
const assert = require('assert').strict;
const { criarEmpresa } = require('./defeitos-servidor-unico.test');

let falhas = 0; let casos = 0;
async function caso(nome, testar) {
  casos++;
  try { await testar(); console.log('ok  ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n  ' + e.message); }
}

function historico(chave, recuperadas, descartadas, ativas) {
  const e = criarEmpresa(chave);
  for (let id = 1; id <= recuperadas + descartadas; id++) {
    e.item(id);
    e.banco.tabelas[e.n.ped].push({ id, defeito_id: id,
      tipo: id <= recuperadas ? 'recuperado' : 'descarte', status: 'autorizado' });
  }
  for (let i = 1; i <= ativas; i++) {
    e.item(recuperadas + descartadas + i, { [e.ficha.defeitos.colunaData]: '2020-01-01T00:00:00Z' });
  }
  return e;
}

async function main() {
  for (const chave of ['ambtotal', 'girassol']) {
    await caso(chave + ': 50 resolvidas saem no banco antes do limite de 300', async () => {
      const e = historico(chave, 30, 20, 310);
      const r = await e.pedir('GET', '/api/defeitos/lista');
      assert.equal(r.statusCode, 200); assert.equal(r.body.itens.length, 300);
      assert(r.body.itens.every(x => x.id > 50));
      assert.deepEqual(r.body.contagem, { defeito: 310, recuperado: 30, descartado: 20, excluido: 0 });
      const pagina = e.banco.chamadas.find(c => c.tabela === e.n.dev && c.limites != null);
      assert.equal(pagina.limites, 300);
      assert(pagina.expressoes.some(expr => expr.startsWith('id.not.in.(')), 'resolvidas devem sair na consulta');
    });
    await caso(chave + ': 400 resolvidas alargam a lista e não truncam contagem', async () => {
      const e = historico(chave, 250, 150, 200);
      const r = await e.pedir('GET', '/api/defeitos/lista');
      assert.equal(r.statusCode, 200); assert.equal(r.body.itens.length, 200);
      assert(r.body.itens.every(x => x.id > 400));
      assert.deepEqual(r.body.contagem, { defeito: 200, recuperado: 250, descartado: 150, excluido: 0 });
      const pagina = e.banco.chamadas.find(c => c.tabela === e.n.dev && c.limites != null);
      assert.equal(pagina.limites, 700);
      assert(!pagina.expressoes.some(expr => expr.startsWith('id.not.in.(')), 'não monta URL com 400 IDs');
      assert(e.banco.chamadas.filter(c => c.opcoes.head).every(c => c.limites == null));
    });
    await caso(chave + ': mudar aba não zera nem altera os totais das outras abas', async () => {
      const e = historico(chave, 2, 1, 2);
      const esperado = { defeito: 2, recuperado: 2, descartado: 1, excluido: 0 };
      const ids = { defeito: [4, 5], recuperado: [1, 2], descartado: [3], excluido: [] };
      for (const estado of Object.keys(ids)) {
        const r = await e.pedir('GET', '/api/defeitos/lista', { query: { estado } });
        assert.equal(r.statusCode, 200); assert.deepEqual(r.body.contagem, esperado);
        assert.deepEqual(r.body.itens.map(x => x.id).sort(), ids[estado]);
      }
    });
    await caso(chave + ': o teto de 1000 da consulta não limita a contagem de 900 resolvidas', async () => {
      const e = historico(chave, 900, 0, 100);
      const r = await e.pedir('GET', '/api/defeitos/lista');
      assert.equal(r.statusCode, 200); assert.equal(r.body.itens.length, 100);
      assert(r.body.itens.every(x => x.id > 900));
      assert.deepEqual(r.body.contagem, { defeito: 100, recuperado: 900, descartado: 0, excluido: 0 });
      const pagina = e.banco.chamadas.find(c => c.tabela === e.n.dev && c.limites != null);
      assert.equal(pagina.limites, 1000);
      for (const consulta of e.banco.chamadas.filter(c => c.opcoes.head)) {
        assert.equal(consulta.limites, null);
        for (const expr of consulta.expressoes) for (const m of expr.matchAll(/\bid\.(?:not\.)?in\.\(([^)]*)\)/g)) {
          assert(m[1].split(',').length <= 150);
        }
      }
    });
  }
  console.log('\n=== ' + casos + ' CASOS: ' + (falhas ? falhas + ' FALHA(S)' : 'TODOS PASSARAM'));
  process.exitCode = falhas ? 1 : 0;
}
main().catch(e => { console.error('FALHA fatal: ' + e.stack); process.exitCode = 1; });
