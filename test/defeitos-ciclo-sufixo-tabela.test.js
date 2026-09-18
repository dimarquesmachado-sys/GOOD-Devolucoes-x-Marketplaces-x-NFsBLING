// Roda com: node test/defeitos-ciclo-sufixo-tabela.test.js
//
// ⚠️ P2 (Codex, PR #323) - o sufixo das tabelas `defeito_comentarios`/
// `defeito_pedidos` vinha de `cfg.chaveDados`/`cfg.EMPRESA` (ex: 'girassol'),
// nao da tabela REGISTRADA em `cfg.supabase.tabelas.devolucoes` (ex:
// 'devolucoes_gira'). Se um dia esses dois valores divergirem — uma empresa
// cuja `chaveDados` nao bate com o sufixo real das tabelas — o modulo grava
// comentario/pedido de defeito numa tabela que nao existe, enquanto as
// outras 5 tabelas da mesma empresa usam o sufixo certo.
//
// Este teste MONTA o router de verdade (sem Bling/ML/Supabase reais) e prova,
// executando uma requisicao HTTP de verdade, que a tabela usada segue o
// sufixo da FICHA (`devolucoes_gira` -> `_gira`), mesmo com `chaveDados`
// dizendo outra coisa.

const express = require('express');
const http = require('http');
const registrarCicloDefeitos = require('../amb-devolucoes/lib-AMB/defeitos-ciclo-AMB.js');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

function criarDbFake(chamadas) {
  const chain = {
    insert() { return chain; },
    select() { return chain; },
    limit() { return Promise.resolve({ data: [{ id: 1 }], error: null }); },
  };
  return {
    conectar() {
      return { from(nome) { chamadas.push(nome); return chain; } };
    },
  };
}

const chamadas = [];
const cfg = {
  // ⚠️ DE PROPOSITO divergentes: a ficha de uma empresa poderia ter
  // `chaveDados` diferente do sufixo real das tabelas.
  chaveDados: 'girassol',
  EMPRESA: 'girassol',
  supabase: { tabelas: { devolucoes: 'devolucoes_gira' } },
};

const router = express.Router();
registrarCicloDefeitos(router, {
  auth: { requerLogin: (req, res, next) => { req.usuario = 'teste'; next(); } },
  db: criarDbFake(chamadas),
  bling: null,
  cfg,
});

const app = express();
app.use(express.json());
app.use(router);
const srv = http.createServer(app);

srv.listen(0, '127.0.0.1', () => {
  const { port } = srv.address();
  const dados = JSON.stringify({ texto: 'comentario de teste' });
  const req = http.request({
    host: '127.0.0.1', port, method: 'POST',
    path: '/api/defeitos/5/comentario',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) },
  }, (res) => {
    res.on('data', () => {});
    res.on('end', () => {
      ok(res.statusCode === 200, 'a rota responde 200 com o fake de banco');
      ok(chamadas.includes('defeito_comentarios_gira'),
         `⚠️ usa a tabela do SUFIXO REGISTRADO (_gira), nao de chaveDados/EMPRESA (chamadas: ${chamadas.join(', ')})`);
      ok(!chamadas.includes('defeito_comentarios_girassol'),
         '  e NAO usa defeito_comentarios_girassol (o que chaveDados/EMPRESA sozinhos dariam)');

      srv.close(() => {
        console.log('');
        console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
        process.exit(falhas ? 1 : 0);
      });
    });
  });
  req.write(dados);
  req.end();
});
