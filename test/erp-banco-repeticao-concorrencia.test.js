'use strict';
// b751 — T-03 (auditoria do Codex, 15/11): REPETICAO, CONCORRENCIA E FALHA ENTRE ERP E BANCO — PELO PROTOCOLO REAL.
//
// O P1-03 (reserva duravel `estoque_operacao`) ja e provado em test/defeitos-servidor-unico.test.js contra um banco de
// objeto, cujo `update().in()` e escrito a mao. Aqui o mesmo ciclo roda com o supabase-js DE VERDADE falando PostgREST
// por HTTP com test/_postgrest-falso.js, as rotas montadas num express real e pedidas por HTTP — e o banco pode FALHAR
// numa escrita especifica (gancho `interceptar`). O Bling e um fake que conta POSTs (cada POST = uma entrada de
// estoque; e isso que nao pode dobrar). Nas 3 fichas (good, ambtotal, girassol):
//   1. dois `autorizar` AO MESMO TEMPO da mesma recuperada: um 200, um 409, UM POST no Bling;
//   2. autorizar de novo depois (sequencial): 409, nenhum POST;
//   3. Bling CONFIRMA e o banco RECUSA fechar a reserva (500 no PATCH do `estoque_operacao`): a resposta avisa, o pedido
//      fica LANCANDO (incerto), relancar e 409 e NAO ha segundo POST;
//   4. Bling sem resposta (excecao de rede): incerto, marca fica, relancar 409, nenhum POST novo;
//   5. Bling NAO APLICOU (4xx): a reserva e liberada (null) e o relancamento passa com UM POST;
//   6. banco falha ao gravar a PROPRIA reserva (500 no update condicional): 500 na resposta e ZERO POST — nada
//      chega ao ERP sem a reserva gravada;
//   7. conciliacao humana: relancar com `forcar` e compare-and-swap com a marca (errada 409, certa relanca UMA vez).
// Roda com: node test/erp-banco-repeticao-concorrencia.test.js
const http = require('http');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { subirPostgrest } = require('./_postgrest-falso');
const { obterEmpresa } = require('../lib/empresas');
const registrar = require('../lib/defeitos-ciclo');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const CHAVES = ['good', 'ambtotal', 'girassol'];

function pedir(porta, caminho, { metodo = 'POST', papel = 'admin', corpo = null } = {}) {
  return new Promise((resolve, reject) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: Object.assign({ 'x-papel': papel }, dados ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) } : {}) }, (res) => {
      let c = ''; res.on('data', (x) => { c += x; }); res.on('end', () => { let j = null; try { j = JSON.parse(c); } catch (e) { j = null; } resolve({ status: res.statusCode, json: j, corpo: c }); });
    });
    req.on('error', reject); if (dados) req.write(dados); req.end();
  });
}

// Bling falso: GET produtos acha o SKU; POST estoques = entrada. `modo` muda a cada cenario.
function blingFalso() {
  const estado = { posts: 0, modo: 'confirma' };
  const chamar = async (url, opcoes = {}) => {
    if ((opcoes.method || 'GET') === 'GET') return { ok: true, data: { data: [{ id: 777, codigo: 'SKU-T03', nome: 'peca', preco: 10 }] } };
    estado.posts++;
    if (estado.modo === 'confirma') return { ok: true, status: 201, data: { data: { id: 9001 } } };
    if (estado.modo === 'rede') { const e = new Error('socket hang up'); e.code = 'ECONNRESET'; throw e; }
    if (estado.modo === '4xx') return { ok: false, status: 422, data: { error: { message: 'deposito invalido' } } };
    throw new Error('modo desconhecido');
  };
  return { estado, chamar };
}

async function montar(chave, pg) {
  const ficha = obterEmpresa(chave);
  const app = express(); app.use(express.json());
  const requerLogin = (req, res, next) => { req.usuario = 'teste-' + chave; req.tipoUsuario = req.headers['x-papel'] || 'estoquista'; next(); };
  const bling = blingFalso();
  registrar(app, {
    supabase: createClient(pg.url, 'chave-de-teste', { auth: { persistSession: false } }),
    requerLogin, adminOk: () => false, chamarBling: bling.chamar,
    DEPOSITO_GERAL: '8100', modelo: { ...ficha.defeitos, tabelas: ficha.tabelas }, rotulo: ficha.nome,
  });
  const srv = http.createServer(app); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const T_PED = 'defeito_pedidos' + ficha.tabelas.devolucoes.slice('devolucoes'.length);
  return { porta: srv.address().port, bling, T_PED, T_DEV: ficha.tabelas.devolucoes, fechar: () => new Promise((r) => srv.close(() => r())) };
}

(async () => {
  for (const chave of CHAVES) {
    const pg = await subirPostgrest();
    const e = await montar(chave, pg);
    console.log('\n── ' + chave + ' (' + e.T_PED + ')');
    let proximo = 1;
    const novoPedido = () => {
      const id = proximo++;
      pg.tabela(e.T_DEV).push({ id: 100 + id, tipo: 'problema', status: 'problema', produto_sku: 'SKU-T03', estado_atual: null });
      pg.tabela(e.T_PED).push({ id, defeito_id: 100 + id, tipo: 'recuperado', status: 'pendente', sku: 'SKU-T03', quantidade: 1, estoque_operacao: null });
      return id;
    };
    const decidir = (id, acao = 'autorizar') => pedir(e.porta, `/api/defeitos/pedido/${id}/decidir`, { corpo: { acao } });
    const relancar = (id, corpo) => pedir(e.porta, `/api/defeitos/pedido/${id}/lancar-estoque`, { corpo });
    const linha = (id) => pg.tabela(e.T_PED).find((p) => p.id === id);
    const postsAntes = () => e.bling.estado.posts;
    try {
      // 1. concorrencia
      {
        const id = novoPedido(); const antes = postsAntes();
        const [a, b] = await Promise.all([decidir(id), decidir(id)]);
        ok([a.status, b.status].sort().join(',') === '200,409', '⚠️ dois autorizar simultaneos: um 200 e um 409 (' + a.status + ',' + b.status + ')');
        ok(postsAntes() - antes === 1, '⚠️ exatamente UM POST no Bling (' + (postsAntes() - antes) + ')');
        ok(linha(id).status === 'concluido' && /^LANCADO /.test(linha(id).estoque_operacao) && linha(id).estoque_produto_id === 777, '  o banco: concluido, LANCADO, produto 777');
        // 2. repeticao sequencial
        const c = await decidir(id);
        ok(c.status === 409 && postsAntes() - antes === 1, '  autorizar de novo: 409 e nenhum POST');
        const r = await relancar(id);
        ok(r.status === 200 && r.json.ja_lancado === true && postsAntes() - antes === 1, '  relancar o ja lancado: ja_lancado, nenhum POST');
      }
      // 3. Bling confirma, banco recusa fechar a reserva
      {
        const id = novoPedido(); const antes = postsAntes();
        pg.ganchos.interceptar = ({ metodo, tabela, params }) => (metodo === 'PATCH' && tabela === e.T_PED && /^eq\.LANCANDO /.test(params.get('estoque_operacao') || '') ? { status: 500, corpo: { message: 'canceling statement due to statement timeout', code: '57014' } } : null);
        const r = await decidir(id);
        pg.ganchos.interceptar = null;
        const est = (r.json && r.json.pedido && r.json.pedido.estoque_bling) || {};
        ok(r.status === 200 && postsAntes() - antes === 1 && /nao consegui gravar/.test(String(est.aviso)), '⚠️ Bling confirmou e o banco recusou fechar: 200 com AVISO (' + r.status + ': ' + String(est.aviso).slice(0, 50) + '…)');
        ok(/^LANCANDO /.test(linha(id).estoque_operacao) && !linha(id).estoque_produto_id, '  o pedido FICA marcado LANCANDO (incerto), sem produto gravado');
        const rl = await relancar(id);
        ok(rl.status === 409 && postsAntes() - antes === 1, '⚠️ relancar depois: 409 e NENHUM segundo POST (' + rl.status + ', posts ' + (postsAntes() - antes) + ')');
      }
      // 4. Bling sem resposta
      {
        const id = novoPedido(); const antes = postsAntes(); e.bling.estado.modo = 'rede';
        const r = await decidir(id); e.bling.estado.modo = 'confirma';
        const est = (r.json && r.json.pedido && r.json.pedido.estoque_bling) || {};
        ok(r.status === 200 && est.incerto === true && postsAntes() - antes === 1, '⚠️ Bling caiu no meio: INCERTO (' + r.status + ', incerto=' + est.incerto + ')');
        ok(/^LANCANDO /.test(linha(id).estoque_operacao), '  a marca fica: ninguem relanca sem conferir');
        const rl = await relancar(id);
        ok(rl.status === 409 && postsAntes() - antes === 1, '  relancar: 409, nenhum POST novo');
      }
      // 5. Bling nao aplicou → reserva liberada → relancar passa
      {
        const id = novoPedido(); const antes = postsAntes(); e.bling.estado.modo = '4xx';
        const r = await decidir(id); e.bling.estado.modo = 'confirma';
        const est = (r.json && r.json.pedido && r.json.pedido.estoque_bling) || {};
        ok(r.status === 200 && est.naoAplicou === true && linha(id).estoque_operacao == null, '⚠️ Bling recusou (4xx): nao aplicou e a reserva foi LIBERADA (' + JSON.stringify(linha(id).estoque_operacao) + ')');
        const rl = await relancar(id);
        ok(rl.status === 200 && postsAntes() - antes === 2 && /^LANCADO /.test(linha(id).estoque_operacao), '  relancar depois de "nao aplicou": 200, UM POST a mais, LANCADO');
      }
      // 7. conciliacao humana: `forcar` e compare-and-swap com a marca — marca errada 409, marca certa relanca UMA vez
      {
        const id = novoPedido(); const antes = postsAntes(); e.bling.estado.modo = 'rede';
        await decidir(id); e.bling.estado.modo = 'confirma';
        const marca = linha(id).estoque_operacao;
        const errada = await relancar(id, { forcar: 'LANCANDO outra' });
        ok(errada.status === 409 && postsAntes() - antes === 1, '  forcar com marca ERRADA: 409, nenhum POST (' + errada.status + ')');
        const certa = await relancar(id, { forcar: marca });
        ok(certa.status === 200 && postsAntes() - antes === 2 && /^LANCADO /.test(linha(id).estoque_operacao) && linha(id).estoque_produto_id === 777, '⚠️ forcar com a marca certa (conferiu no Bling): relanca UMA vez e fica LANCADO (' + certa.status + ', posts ' + (postsAntes() - antes) + ')');
        const denovo = await relancar(id, { forcar: marca });
        ok(denovo.status === 200 && denovo.json.ja_lancado === true && postsAntes() - antes === 2, '  forcar de novo com a marca velha: ja_lancado, nenhum POST');
      }
      // 6. banco falha ao gravar a propria reserva: nada chega ao ERP
      {
        const id = novoPedido(); const antes = postsAntes();
        pg.ganchos.interceptar = ({ metodo, tabela, params }) => (metodo === 'PATCH' && tabela === e.T_PED && params.get('id') === 'eq.' + id ? { status: 500, corpo: { message: 'could not serialize access', code: '40001' } } : null);
        const r = await decidir(id);
        pg.ganchos.interceptar = null;
        ok(r.status === 500 && postsAntes() - antes === 0, '⚠️ reserva nao gravou: 500 e ZERO POST no Bling (' + r.status + ', posts ' + (postsAntes() - antes) + ')');
        ok(linha(id).status === 'pendente' && linha(id).estoque_operacao == null, '  o pedido segue pendente e livre');
      }
    } finally {
      await e.fechar(); await pg.parar();
    }
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
