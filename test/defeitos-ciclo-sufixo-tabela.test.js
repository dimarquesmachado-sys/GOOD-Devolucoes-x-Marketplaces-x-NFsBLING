'use strict';
// Roda com: node test/defeitos-ciclo-sufixo-tabela.test.js
// PR #323: identidade "girassol" não pode substituir o sufixo REAL
// "_gira" das tabelas. O teste monta o servidor comum com config da ficha
// e executa HTTP local para comentário E pedido, sem serviços externos.
const assert = require('assert').strict;
const express = require('express');
const http = require('http');
const registrarCicloDefeitos = require('../lib/defeitos-ciclo');
const { configDaEmpresa } = require('../lib/config-da-empresa');

const chamadas = [];
const permitidas = new Set(['defeito_comentarios_gira', 'defeito_pedidos_gira']);
const supabase = {
  from(nome) {
    chamadas.push(nome);
    assert(permitidas.has(nome), 'tabela não provisionada: ' + nome);
    const chain = {
      insert(linhas) { this.linhas = linhas; return this; },
      select() { return this; },
      limit() { return Promise.resolve({ data: [{ id: 1, ...this.linhas[0] }], error: null }); },
    };
    return chain;
  },
};
const cfg = configDaEmpresa('girassol');
cfg.supabase.tabelas = { ...cfg.supabase.tabelas,
  devolucoes: 'devolucoes_gira', pecasRetiradas: 'pecas_retiradas_gira' };
assert.equal(cfg.EMPRESA, 'girassol'); // identidade propositalmente diferente de "gira"

const router = express.Router();
registrarCicloDefeitos(router, {
  supabase: () => supabase,
  requerLogin(req, res, next) { req.usuario = 'teste'; return next(); },
  DEPOSITO_GERAL: cfg.fiscal.depositoGeral(),
  modelo: { ...cfg.defeitos, tabelas: cfg.supabase.tabelas },
});
const app = express(); app.use(express.json()); app.use(router);
const srv = http.createServer(app);

function pedir(caminho, corpo) {
  return new Promise((resolve, reject) => {
    const dados = JSON.stringify(corpo);
    const req = http.request({ host: '127.0.0.1', port: srv.address().port,
      method: 'POST', path: caminho,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) },
    }, res => {
      let texto = ''; res.on('data', d => { texto += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, corpo: JSON.parse(texto) }); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject); req.end(dados);
  });
}

srv.listen(0, '127.0.0.1', async () => {
  try {
    const comentario = await pedir('/api/defeitos/5/comentario', { texto: 'comentario de teste' });
    assert.equal(comentario.status, 200); assert.equal(comentario.corpo.ok, true);
    assert(chamadas.includes('defeito_comentarios_gira'));
    assert(!chamadas.includes('defeito_comentarios_girassol'));
    console.log('ok  comentário usa o sufixo registrado _gira, independente de EMPRESA/chaveDados');
    const pedido = await pedir('/api/defeitos/pedido', {
      tipo: 'recuperado', defeito_id: 5, sku: 'SKU-TESTE', so_conserto: true,
    });
    assert.equal(pedido.status, 200); assert.equal(pedido.corpo.ok, true);
    assert(chamadas.includes('defeito_pedidos_gira'));
    assert(!chamadas.includes('defeito_pedidos_girassol'));
    console.log('ok  pedido usa o mesmo sufixo registrado _gira');
  } catch (e) { console.error('FALHA ' + e.stack); process.exitCode = 1; }
  finally { srv.close(); }
});
srv.on('error', e => { console.error('FALHA ' + e.stack); process.exitCode = 1; });
