'use strict';

// PR1: executa o servidor compartilhado com as fichas REAIS das tres
// empresas. Banco e Bling sao dublês locais; nenhum servico e acessado.
// O banco aplica os filtros antes do limite e devolve somente as colunas
// selecionadas, para nao esconder regressões de data/filtro/multiempresa.
const assert = require('assert').strict;
const registrar = require('../lib/defeitos-ciclo');
const { obterEmpresa } = require('../lib/empresas');

const CHAVES = ['good', 'girassol', 'ambtotal'];
const DADOS = {
  good: { colunaData: 'created_at', exclusao: 'marca', tipoRestauradoPadrao: 'problema', statusDecisaoFallback: 'delivered' },
  girassol: { colunaData: 'criado_em', exclusao: 'tipo', tipoRestauradoPadrao: 'defeito_estoque', statusDecisaoFallback: null },
  ambtotal: { colunaData: 'criado_em', exclusao: 'tipo', tipoRestauradoPadrao: 'defeito_estoque', statusDecisaoFallback: null },
};
const ROTAS = [
  'POST /api/defeitos/:id/restaurar',
  'POST /api/defeitos/:id/excluir',
  'GET /api/defeitos/lista',
  'GET /api/defeitos/ficha/:id',
  'POST /api/defeitos/:id/comentario',
  'PUT /api/defeitos/:id/laudo',
  'PUT /api/defeitos/comentario/:cid',
  'DELETE /api/defeitos/comentario/:cid',
  'POST /api/defeitos/:id/peca-retirada',
  'PUT /api/defeitos/:id/estado',
  'POST /api/defeitos/pedido',
  'GET /api/defeitos/pedidos',
  'GET /api/defeitos/produto-raiox/:id',
  'POST /api/defeitos/pedido/:id/arquivar',
  'POST /api/defeitos/pedido/:id/lancar-estoque',
  'POST /api/defeitos/pedido/:id/decidir',
].sort();

let falhas = 0;
let casos = 0;
async function caso(nome, executar) {
  casos++;
  try { await executar(); console.log('ok  ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n  ' + e.message); }
}
const copiar = x => JSON.parse(JSON.stringify(x));

function separar(expr) {
  const itens = []; let profundidade = 0; let inicio = 0;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '(') profundidade++;
    if (expr[i] === ')') profundidade--;
    if (expr[i] === ',' && profundidade === 0) { itens.push(expr.slice(inicio, i)); inicio = i + 1; }
  }
  itens.push(expr.slice(inicio));
  return itens;
}

function filtro(expr, linha) {
  if (expr.startsWith('and(')) return separar(expr.slice(4, -1)).every(e => filtro(e, linha));
  if (expr.startsWith('or(')) return separar(expr.slice(3, -1)).some(e => filtro(e, linha));
  const m = /^([a-z_]+)\.(not\.)?(eq|neq|in|is|ilike)\.(.*)$/.exec(expr);
  assert(m, 'operador PostgREST nao implementado no duble: ' + expr);
  const [, coluna, negar, op, valor] = m;
  const atual = linha[coluna];
  let bate;
  if (op === 'is') bate = valor === 'null' && atual == null;
  if (op === 'eq') bate = atual != null && String(atual) === valor;
  if (op === 'neq') {
    if (atual == null) return false;
    bate = String(atual) !== valor;
  }
  if (op === 'in') bate = atual != null && valor.slice(1, -1).split(',').includes(String(atual));
  if (op === 'ilike') {
    // SQL: NULL ILIKE ... e NOT(NULL ILIKE ...) nao sao verdadeiros.
    if (atual == null) return false;
    const padrao = valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    bate = new RegExp('^' + padrao + '$', 'i').test(String(atual));
  }
  return negar ? !bate : bate;
}

function nomes(ficha) {
  const sufixo = ficha.tabelas.devolucoes.replace(/^devolucoes_?/, '');
  return {
    dev: ficha.tabelas.devolucoes,
    pec: ficha.tabelas.pecasRetiradas,
    com: 'defeito_comentarios' + (sufixo ? '_' + sufixo : ''),
    ped: 'defeito_pedidos' + (sufixo ? '_' + sufixo : ''),
  };
}

function criarBanco() {
  const tabelas = {}; const datas = {}; const chamadas = [];
  const recusaTipoTerminal = new Set(['devolucoes']);
  for (const chave of CHAVES) {
    const ficha = obterEmpresa(chave); const n = nomes(ficha);
    Object.values(n).forEach(t => { tabelas[t] = []; });
    datas[n.dev] = DADOS[chave].colunaData;
  }
  let erroCount = null;
  const client = {
    from(tabela) {
      assert(tabelas[tabela], 'acesso a tabela nao configurada: ' + tabela);
      const q = { tabela, operacao: 'select', condicoes: [], limites: null, ordem: null,
        colunas: '*', opcoes: {}, campos: null, expressoes: [] };
      chamadas.push(q);
      let resultado;
      const chain = {
        select(colunas = '*', opcoes = {}) { q.colunas = colunas; q.opcoes = opcoes; return chain; },
        insert(campos) { q.operacao = 'insert'; q.campos = copiar(Array.isArray(campos) ? campos : [campos]); return chain; },
        update(campos) { q.operacao = 'update'; q.campos = copiar(campos); return chain; },
        delete() { q.operacao = 'delete'; return chain; },
        eq(coluna, valor) { q.condicoes.push(x => x[coluna] != null && String(x[coluna]) === String(valor)); return chain; },
        in(coluna, valores) { q.expressoes.push(coluna + '.in.(' + valores.join(',') + ')'); q.condicoes.push(x => valores.map(String).includes(String(x[coluna]))); return chain; },
        or(expr) { q.expressoes.push(expr); q.condicoes.push(x => separar(expr).some(e => filtro(e, x))); return chain; },
        not(coluna, op, valor) { q.expressoes.push(coluna + '.not.' + op + '.' + valor); q.condicoes.push(x => filtro(coluna + '.not.' + op + '.' + valor, x)); return chain; },
        is(coluna, valor) { q.condicoes.push(x => valor == null ? x[coluna] == null : x[coluna] === valor); return chain; },
        order(coluna, opcoes = {}) { q.ordem = { coluna, asc: opcoes.ascending !== false }; return chain; },
        limit(n) { q.limites = n; return chain; },
        then(a, b) { return executar().then(a, b); },
        catch(b) { return executar().catch(b); },
      };
      function executar() {
        if (resultado) return resultado;
        resultado = Promise.resolve().then(() => {
          if (q.opcoes.count && erroCount) return { data: null, count: null, error: { message: erroCount } };
          const dataCorreta = datas[tabela];
          const dataErrada = dataCorreta === 'created_at' ? 'criado_em' : 'created_at';
          if (dataCorreta && ((q.colunas !== '*' && q.colunas.split(',').map(x => x.trim()).includes(dataErrada))
              || q.ordem && q.ordem.coluna === dataErrada)) {
            return { data: null, error: { message: 'column ' + tabela + '.' + dataErrada + ' does not exist' } };
          }
          // A GOOD real recusa defeito_excluido no check: o modelo marca
          // estado_atual diretamente, sem depender desta lista fechada.
          if (recusaTipoTerminal.has(tabela) && q.operacao === 'update'
              && ['defeito_excluido', 'recuperado', 'descartado'].includes(q.campos.tipo)) {
            return { data: null, error: { message: 'new row violates check constraint devolucoes_tipo_check' } };
          }
          let linhas = tabelas[tabela].filter(x => q.condicoes.every(f => f(x)));
          if (q.operacao === 'insert') {
            linhas = q.campos.map(x => ({ id: Math.max(0, ...tabelas[tabela].map(y => Number(y.id) || 0)) + 1, ...x }));
            tabelas[tabela].push(...linhas);
          }
          if (q.operacao === 'update') linhas.forEach(x => Object.assign(x, q.campos));
          if (q.operacao === 'delete') tabelas[tabela] = tabelas[tabela].filter(x => !linhas.includes(x));
          const count = linhas.length;
          if (q.ordem) linhas = [...linhas].sort((a, b) => String(a[q.ordem.coluna] || '').localeCompare(String(b[q.ordem.coluna] || '')) * (q.ordem.asc ? 1 : -1));
          if (q.limites != null) linhas = linhas.slice(0, q.limites);
          const data = q.opcoes.head ? null : linhas.map(x => q.colunas === '*' ? copiar(x)
            : Object.fromEntries(q.colunas.split(',').map(c => c.trim()).filter(c => c in x).map(c => [c, copiar(x[c])])));
          return { data, count: q.opcoes.count ? count : null, error: null };
        });
        return resultado;
      }
      return chain;
    },
  };
  return { client, tabelas, chamadas, falharCount(msg) { erroCount = msg; },
    recusarTipoTerminal(tabela) { recusaTipoTerminal.add(tabela); } };
}

function criarEmpresa(chave, banco = criarBanco(), opcoes = {}) {
  const ficha = obterEmpresa(chave); const n = nomes(ficha); const rotas = new Map();
  const app = {};
  for (const verbo of ['get', 'post', 'put', 'delete']) app[verbo] = (rota, ...handlers) => {
    const key = verbo.toUpperCase() + ' ' + rota;
    assert(!rotas.has(key), 'rota duplicada: ' + key); rotas.set(key, handlers);
  };
  const requerLogin = (req, res, next) => {
    req.usuario = 'estoquista-' + chave; req.tipoUsuario = req.papel || 'estoquista'; return next();
  };
  registrar(app, {
    supabase: opcoes.getter ? () => banco.client : banco.client,
    requerLogin,
    adminOk: req => req.chaveAdmin === true,
    chamarBling: opcoes.chamarBling,
    resolverSku: opcoes.resolverSku,
    DEPOSITO_GERAL: Object.hasOwn(opcoes, 'deposito') ? opcoes.deposito : ficha.fiscal.depositoGeral(),
    modelo: { ...ficha.defeitos, tabelas: ficha.tabelas },
  });
  async function pedir(verbo, rota, opts = {}) {
    const handlers = rotas.get(verbo + ' ' + rota);
    assert(handlers, 'rota ausente: ' + verbo + ' ' + rota);
    const req = { params: {}, query: {}, body: {}, ...opts };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    let indice = 0;
    const next = () => { const fn = handlers[indice++]; return fn && fn(req, res, next); };
    await next(); assert(res.body, 'a rota nao respondeu JSON');
    return res;
  }
  function item(id, campos = {}) {
    const status = chave === 'good' ? 'concluido' : 'problema';
    const linha = { id, tipo: 'problema', status, estado_atual: null, produto_sku: chave + '-SKU',
      produto_titulo: 'Peca da ' + chave, defeito_qtd: 2, problema_fotos: '["foto1","foto2"]',
      [DADOS[chave].colunaData]: '2026-10-14T12:00:00Z', ...campos };
    banco.tabelas[n.dev].push(linha); return linha;
  }
  return { banco, ficha, n, rotas, pedir, item };
}

async function main() {
  await caso('modelo ausente/incompleto é recusado antes de registrar rotas de outra empresa', async () => {
    let registros = 0;
    const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map(v => [v, () => { registros++; }]));
    const ficha = obterEmpresa('girassol');
    const deps = { requerLogin() {}, modelo: { ...ficha.defeitos, tabelas: ficha.tabelas } };
    assert.throws(() => registrar(app, { requerLogin() {} }), /modelo/);
    assert.throws(() => registrar(app, { ...deps, modelo: { ...deps.modelo, tabelas: { devolucoes: 'devolucoes_girassol' } } }), /pecasRetiradas/);
    assert.throws(() => registrar(app, { ...deps, modelo: { ...deps.modelo, colunaData: 'data_inventada' } }), /modelo/);
    assert.equal(registros, 0);
  });
  for (const chave of CHAVES) {
    await caso(chave + ': ficha explicita schema verdadeiro, não default da GOOD', async () => {
      const ficha = obterEmpresa(chave);
      for (const [campo, esperado] of Object.entries(DADOS[chave])) assert.equal(ficha.defeitos[campo], esperado);
      assert.equal(ficha.defeitos.ativos, chave === 'good'
        ? 'and(tipo.eq.problema,status.eq.concluido),tipo.eq.defeito_estoque'
        : 'tipo.eq.defeito_estoque,status.eq.problema');
    });
    await caso(chave + ': 16 rotas preservadas com autenticação', async () => {
      const e = criarEmpresa(chave);
      assert.deepEqual([...e.rotas.keys()].sort(), ROTAS);
      assert([...e.rotas.values()].every(h => h.length === 2));
    });
    await caso(chave + ': lista usa data/modelo real e classifica pedidos sem misturar abas', async () => {
      const e = criarEmpresa(chave, criarBanco(), { getter: true });
      e.item(1); e.item(2, { status: 'pendente' });
      e.item(3, { tipo: 'defeito_estoque', status: 'qualquer' });
      e.item(4, { tipo: 'recuperado' }); e.item(5, { tipo: 'descartado' });
      e.item(6, { estado_atual: 'registro excluido por teste' });
      e.item(7); e.item(8, { tipo: 'defeito_excluido', estado_atual: null });
      e.item(9, { tipo: null }); // status problema legitimamente pode nao ter tipo na AMB
      e.banco.tabelas[e.n.ped].push({ id: 10, defeito_id: 7, tipo: 'recuperado', status: 'autorizado' });
      const r = await e.pedir('GET', '/api/defeitos/lista');
      assert.equal(r.statusCode, 200); assert.equal(r.body.ok, true);
      const ativos = chave === 'good' ? [1, 3] : [1, 3, 9];
      assert.deepEqual(r.body.itens.map(x => x.id).sort(), ativos);
      assert(r.body.itens.every(x => x.criado_em === '2026-10-14T12:00:00Z'));
      assert.deepEqual(r.body.contagem, { defeito: ativos.length, recuperado: 2, descartado: 1, excluido: 2 });
      const rRec = await e.pedir('GET', '/api/defeitos/lista', { query: { estado: 'recuperado' } });
      assert.deepEqual(rRec.body.itens.map(x => x.id).sort(), [4, 7]);
      const exc = await e.pedir('GET', '/api/defeitos/lista', { query: { estado: 'excluido' } });
      assert.deepEqual(exc.body.itens.map(x => x.id).sort(), [6, 8]);
      assert(exc.body.itens.every(x => x.situacao === 'excluido'));
      assert(e.banco.chamadas.filter(c => c.ordem && c.tabela === e.n.dev).every(c => c.ordem.coluna === e.ficha.defeitos.colunaData));
    });
    await caso(chave + ': contagem exata no banco supera 300, sem esconder ativo antigo', async () => {
      const e = criarEmpresa(chave); e.item(1, { [e.ficha.defeitos.colunaData]: '2020-01-01T00:00:00Z' });
      for (let id = 10; id < 365; id++) e.item(id, { tipo: 'recuperado' });
      for (let id = 400; id < 755; id++) e.item(id, { tipo: 'defeito_excluido' });
      const r = await e.pedir('GET', '/api/defeitos/lista');
      assert.equal(r.statusCode, 200);
      assert.deepEqual(r.body.itens.map(x => x.id), [1]);
      assert.deepEqual(r.body.contagem, { defeito: 1, recuperado: 355, descartado: 0, excluido: 355 });
      const counts = e.banco.chamadas.filter(c => c.opcoes.head && c.opcoes.count === 'exact');
      assert.equal(counts.length, 4); assert(counts.every(c => c.limites == null));
    });
    await caso(chave + ': 400 recuperadas por pedido não truncam contagem nem escondem 200 ativas antigas', async () => {
      const e = criarEmpresa(chave);
      for (let id = 1; id <= 400; id++) {
        e.item(id);
        e.banco.tabelas[e.n.ped].push({ id, defeito_id: id, tipo: 'recuperado', status: 'autorizado' });
      }
      for (let id = 401; id <= 600; id++) e.item(id, { [DADOS[chave].colunaData]: '2020-01-01T00:00:00Z' });
      const r = await e.pedir('GET', '/api/defeitos/lista');
      assert.equal(r.statusCode, 200); assert.equal(r.body.itens.length, 200);
      assert(r.body.itens.every(x => x.id >= 401 && x.id <= 600));
      assert.deepEqual(r.body.contagem, { defeito: 200, recuperado: 400, descartado: 0, excluido: 0 });
      const recuperadas = await e.pedir('GET', '/api/defeitos/lista', { query: { estado: 'recuperado' } });
      assert.equal(recuperadas.statusCode, 200); assert.equal(recuperadas.body.itens.length, 300);
      assert.deepEqual(recuperadas.body.contagem, r.body.contagem);
    });
    await caso(chave + ': lotes de pedidos preservam exclusões, prioridade do tipo e NULL sem dupla contagem', async () => {
      const e = criarEmpresa(chave); const registros = [];
      for (let id = 1; id <= 400; id++) {
        registros.push(e.item(id));
        e.banco.tabelas[e.n.ped].push({ id, defeito_id: id, tipo: 'recuperado', status: 'autorizado' });
      }
      for (let id = 401; id <= 600; id++) e.item(id, { [DADOS[chave].colunaData]: '2020-01-01T00:00:00Z' });
      Object.assign(registros[0], { tipo: 'defeito_excluido', estado_atual: null });
      Object.assign(registros[1], { tipo: 'problema', status: 'cancelled', estado_atual: null });
      Object.assign(registros[2], { estado_atual: 'registro excluido por teste' });
      Object.assign(registros[3], { tipo: 'descartado' });
      Object.assign(registros[4], { tipo: 'recuperado' }); // já contado pelo tipo: pedido não soma outra vez
      Object.assign(registros[5], { tipo: 'recuperado' });
      e.banco.tabelas[e.n.ped][5].tipo = 'descarte'; // tipo explícito vence o pedido divergente
      Object.assign(registros[6], { tipo: null }); // NULL não pode sumir por NOT(...) em SQL
      const r = await e.pedir('GET', '/api/defeitos/lista');
      assert.equal(r.statusCode, 200); assert.equal(r.body.itens.length, 200);
      assert.deepEqual(r.body.contagem, { defeito: 200, recuperado: 396, descartado: 1, excluido: 3 });
      const descartadas = await e.pedir('GET', '/api/defeitos/lista', { query: { estado: 'descartado' } });
      assert.deepEqual(descartadas.body.itens.map(x => x.id), [4]);
      assert.deepEqual(descartadas.body.contagem, r.body.contagem);
      const excluidas = await e.pedir('GET', '/api/defeitos/lista', { query: { estado: 'excluido' } });
      assert.deepEqual(excluidas.body.itens.map(x => x.id).sort(), [1, 2, 3]);
      assert.deepEqual(excluidas.body.contagem, r.body.contagem);
      const counts = e.banco.chamadas.filter(c => c.opcoes.head && c.opcoes.count === 'exact');
      assert(counts.length > 4, 'histórico grande precisa ser contado por lotes sem materializar linhas limitadas');
      assert(counts.every(c => c.limites == null), 'head-count nunca recebe limite da lista');
      for (const c of counts) for (const expr of c.expressoes) {
        for (const m of expr.matchAll(/\bid\.(?:not\.)?in\.\(([^)]*)\)/g)) {
          assert(m[1].split(',').length <= 150, 'lote de IDs excede limite de URL');
        }
      }
    });
    await caso(chave + ': exclusões históricas prevalecem sobre pedidos autorizados na lista e contagem', async () => {
      const e = criarEmpresa(chave);
      e.item(1, { tipo: 'defeito_excluido', estado_atual: null });
      e.item(2, { tipo: 'problema', status: 'cancelled', estado_atual: null });
      e.item(3, { estado_atual: 'REGISTRO EXCLUIDO por teste' });
      for (const id of [1, 2, 3]) e.banco.tabelas[e.n.ped].push({ id, defeito_id: id, tipo: 'recuperado', status: 'autorizado' });
      const r = await e.pedir('GET', '/api/defeitos/lista', { query: { estado: 'recuperado' } });
      assert.equal(r.statusCode, 200); assert.deepEqual(r.body.itens, []);
      assert.deepEqual(r.body.contagem, { defeito: 0, recuperado: 0, descartado: 0, excluido: 3 });
      const exc = await e.pedir('GET', '/api/defeitos/lista', { query: { estado: 'excluido' } });
      assert.deepEqual(exc.body.itens.map(x => x.id).sort(), [1, 2, 3]);
      assert(exc.body.itens.every(x => x.situacao === 'excluido'));
    });
    await caso(chave + ': de-para encontra SKU novo e recalcula as quatro abas pelo mesmo termo', async () => {
      const resolvidos = [];
      const e = criarEmpresa(chave, criarBanco(), { resolverSku: async sku => {
        resolvidos.push(sku); return { trocado: true, sku: 'NOVO-SKU', sku_original: sku };
      } });
      e.item(1, { produto_sku: 'NOVO-SKU' });
      e.item(2, { produto_sku: 'NOVO-SKU', tipo: 'recuperado' });
      e.item(3, { produto_sku: 'NOVO-SKU', tipo: 'descartado' });
      e.item(4, { produto_sku: 'NOVO-SKU', tipo: 'defeito_excluido' });
      e.item(5, { produto_sku: 'OUTRO-SKU' });
      const r = await e.pedir('GET', '/api/defeitos/lista', { query: { q: 'ANTIGO-SKU' } });
      assert.equal(r.statusCode, 200); assert.deepEqual(r.body.itens.map(x => x.id), [1]);
      assert.deepEqual(r.body.contagem, { defeito: 1, recuperado: 1, descartado: 1, excluido: 1 });
      const rec = await e.pedir('GET', '/api/defeitos/lista', { query: { q: 'ANTIGO-SKU', estado: 'recuperado' } });
      assert.deepEqual(rec.body.itens.map(x => x.id), [2]);
      assert.deepEqual(rec.body.contagem, r.body.contagem); assert.deepEqual(resolvidos, ['ANTIGO-SKU', 'ANTIGO-SKU']);
    });
    await caso(chave + ': ficha normaliza data/fotos e reconhece exclusão por marca', async () => {
      const e = criarEmpresa(chave); e.item(1, { estado_atual: 'registro excluido por teste' });
      const r = await e.pedir('GET', '/api/defeitos/ficha/:id', { params: { id: '1' } });
      assert.equal(r.statusCode, 200); assert.equal(r.body.item.situacao, 'excluido');
      assert.equal(r.body.item.criado_em, '2026-10-14T12:00:00Z');
      assert.deepEqual(r.body.fotos, ['foto1', 'foto2']);
      assert.equal(r.body.item.quantidade, 2);
      assert(e.banco.chamadas.filter(c => c.ordem && c.tabela !== e.n.dev).every(c => c.ordem.coluna === 'criado_em'));
    });
    await caso(chave + ': exclusão respeita modelo e retry preserva motivo/histórico', async () => {
      const e = criarEmpresa(chave); const original = e.item(1);
      const opts = { params: { id: '1' }, papel: 'admin', body: { motivo: 'cadastro duplicado' } };
      const r = await e.pedir('POST', '/api/defeitos/:id/excluir', opts);
      assert.equal(r.statusCode, 200); assert.equal(r.body.ok, true);
      assert(/REGISTRO EXCLUIDO/.test(original.estado_atual));
      assert.equal(original.tipo, chave === 'good' ? 'problema' : 'defeito_excluido');
      if (chave === 'good') {
        assert.equal(original.status, 'concluido');
        assert(e.banco.chamadas.filter(c => c.operacao === 'update' && c.tabela === e.n.dev).every(c => !('tipo' in c.campos) && !('status' in c.campos)));
      } else assert.equal(original.tipo_anterior, 'problema');
      const marca = original.estado_atual; const nComentarios = e.banco.tabelas[e.n.com].length;
      const retry = await e.pedir('POST', '/api/defeitos/:id/excluir', { ...opts, body: { motivo: 'outro motivo novo' } });
      assert.equal(retry.body.ja_excluido, true); assert.equal(original.estado_atual, marca);
      assert.equal(e.banco.tabelas[e.n.com].length, nComentarios);
      const volta = await e.pedir('POST', '/api/defeitos/:id/restaurar', { params: { id: '1' }, papel: 'admin' });
      assert.equal(volta.statusCode, 200); assert.equal(original.tipo, 'problema');
      assert.equal(original.estado_atual, null);
    });
    await caso(chave + ': restauração histórica mantém tipo original e fallback próprio', async () => {
      const e = criarEmpresa(chave);
      const antiga = e.item(1, { tipo: 'defeito_excluido', tipo_anterior: 'problema', status: 'concluido' });
      const semTipoAnterior = e.item(2, { tipo: 'defeito_excluido', status: 'concluido' });
      const soMarca = e.item(3, { tipo: 'defeito_estoque', estado_atual: 'REGISTRO EXCLUIDO por teste' });
      for (const id of ['1', '2', '3']) {
        const r = await e.pedir('POST', '/api/defeitos/:id/restaurar', { params: { id }, papel: 'admin' });
        assert.equal(r.statusCode, 200);
      }
      assert.equal(antiga.tipo, 'problema'); assert.equal(antiga.tipo_anterior, null);
      assert.equal(semTipoAnterior.tipo, DADOS[chave].tipoRestauradoPadrao);
      assert.equal(soMarca.tipo, 'defeito_estoque'); assert.equal(soMarca.estado_atual, null);
    });
    await caso(chave + ': usuário comum/pedido pendente não excluem; adminOk permite admin legado', async () => {
      const e = criarEmpresa(chave); e.item(1);
      const opts = { params: { id: '1' }, body: { motivo: 'motivo valido' } };
      assert.equal((await e.pedir('POST', '/api/defeitos/:id/excluir', opts)).statusCode, 403);
      assert.equal((await e.pedir('POST', '/api/defeitos/:id/restaurar', opts)).statusCode, 403);
      assert.equal(e.banco.chamadas.length, 0);
      e.banco.tabelas[e.n.ped].push({ id: 1, defeito_id: 1, tipo: 'recuperado', status: 'pendente' });
      assert.equal((await e.pedir('POST', '/api/defeitos/:id/excluir', { ...opts, chaveAdmin: true })).statusCode, 400);
      assert(!e.banco.chamadas.some(c => c.operacao === 'update'));
      e.banco.tabelas[e.n.ped].length = 0;
      assert.equal((await e.pedir('POST', '/api/defeitos/:id/excluir', { ...opts, chaveAdmin: true })).statusCode, 200);
    });
    await caso(chave + ': estado não remove marca; edição normal e laudo vazio funcionam', async () => {
      const e = criarEmpresa(chave); const excluido = e.item(1, { estado_atual: 'REGISTRO EXCLUIDO por teste' });
      const ativo = e.item(2, { problema_descricao: 'laudo antigo' });
      const r = await e.pedir('PUT', '/api/defeitos/:id/estado', { params: { id: '1' }, body: { texto: '' } });
      assert.equal(r.statusCode, 400); assert(/REGISTRO EXCLUIDO/.test(excluido.estado_atual));
      assert.equal(e.banco.tabelas[e.n.com].length, 0);
      assert.equal((await e.pedir('PUT', '/api/defeitos/:id/estado', { params: { id: '2' }, body: { texto: 'sem cupula' } })).statusCode, 200);
      assert.equal(ativo.estado_atual, 'sem cupula');
      assert.equal((await e.pedir('PUT', '/api/defeitos/:id/laudo', { params: { id: '2' }, body: { dados: { texto: '   ' } } })).statusCode, 200);
      assert.equal(ativo.problema_descricao, null);
      const antes = e.banco.tabelas[e.n.com].length;
      assert.equal((await e.pedir('PUT', '/api/defeitos/:id/laudo', { params: { id: '999' }, body: { texto: 'sem registro' } })).statusCode, 404);
      assert.equal(e.banco.tabelas[e.n.com].length, antes);
    });
    await caso(chave + ': falha na contagem retorna erro em vez de números de sucesso', async () => {
      const e = criarEmpresa(chave); e.item(1); e.banco.falharCount('count indisponivel');
      const r = await e.pedir('GET', '/api/defeitos/lista');
      assert.equal(r.statusCode, 500); assert.equal(r.body.ok, false);
      assert(/count indisponivel/.test(r.body.erro));
    });
    await caso(chave + ': autorizar descarte mantém terminal/fallback próprios e não movimenta Bling', async () => {
      let bling = 0;
      const e = criarEmpresa(chave, criarBanco(), { chamarBling: async () => { bling++; throw new Error('descarte nao gera entrada'); } });
      const original = e.item(1);
      const p = await e.pedir('POST', '/api/defeitos/pedido', { body: { tipo: 'descarte', defeito_id: 1 } });
      assert.equal(p.statusCode, 200); assert.equal(p.body.pedido.status, 'pendente');
      const opts = { params: { id: String(p.body.pedido.id) }, body: { acao: 'autorizar' } };
      assert.equal((await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', opts)).statusCode, 403);
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { ...opts, papel: 'admin' });
      assert.equal(r.statusCode, 200); assert.equal(r.body.ok, true); assert.equal(bling, 0);
      assert.equal(original.tipo, chave === 'good' ? 'problema' : 'descartado');
      assert.equal(original.status, chave === 'good' ? 'delivered' : 'problema');
      assert(/DESCARTE AUTORIZADO/.test(original.estado_atual));
      const lista = await e.pedir('GET', '/api/defeitos/lista');
      assert.deepEqual(lista.body.itens, []); assert.equal(lista.body.contagem.descartado, 1);
      assert.equal(lista.body.contagem.defeito, 0);
      if (chave !== 'good') assert(!e.banco.chamadas.some(c => c.operacao === 'update' && c.campos.status === 'delivered'));
    });
    await caso(chave + ': recusa do tipo terminal usa status fallback somente quando modelo permite', async () => {
      const e = criarEmpresa(chave); const original = e.item(1);
      e.banco.recusarTipoTerminal(e.n.dev);
      e.banco.tabelas[e.n.ped].push({ id: 1, defeito_id: 1, tipo: 'descarte', status: 'pendente' });
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', {
        params: { id: '1' }, papel: 'admin', body: { acao: 'autorizar' },
      });
      assert.equal(r.statusCode, 200); assert.equal(original.tipo, 'problema');
      assert.equal(original.status, chave === 'good' ? 'delivered' : 'problema');
      const tentativasStatus = e.banco.chamadas.filter(c => c.tabela === e.n.dev && c.operacao === 'update' && 'status' in c.campos);
      assert.equal(tentativasStatus.length, chave === 'good' ? 1 : 0);
      if (chave === 'good') assert.equal(tentativasStatus[0].campos.status, 'delivered');
    });
  }

  await caso('as três instâncias compartilham código/banco sem compartilhar linhas', async () => {
    const banco = criarBanco(); const empresas = CHAVES.map(k => criarEmpresa(k, banco));
    empresas.forEach(e => { e.item(1); e.item(2); });
    for (const e of empresas) {
      const inicio = banco.chamadas.length;
      const r = await e.pedir('GET', '/api/defeitos/lista');
      assert(r.body.itens.every(x => x.sku === e.ficha.chave + '-SKU'));
      assert.equal((await e.pedir('POST', '/api/defeitos/:id/comentario', { params: { id: '1' }, body: { texto: 'somente ' + e.ficha.chave } })).statusCode, 200);
      assert.equal((await e.pedir('POST', '/api/defeitos/:id/peca-retirada', { params: { id: '1' }, body: { peca: 'cupula', destino_defeito_id: 2 } })).statusCode, 200);
      assert(banco.chamadas.slice(inicio).every(c => Object.values(e.n).includes(c.tabela)));
      assert.equal(banco.tabelas[e.n.pec].length, 1);
      assert.equal(banco.tabelas[e.n.pec][0].destino_defeito_id, 2);
      assert(banco.tabelas[e.n.com].some(c => c.defeito_id == 2));
    }
    empresas.forEach(e => assert(banco.tabelas[e.n.com].every(x => x.quem === 'estoquista-' + e.ficha.chave)));
  });

  await caso('Bling recebe depósito próprio, corpo data e custo; relançamento é idempotente', async () => {
    const banco = criarBanco();
    for (let i = 0; i < CHAVES.length; i++) {
      const chamadas = []; const deposito = String(9001 + i);
      const e = criarEmpresa(CHAVES[i], banco, { deposito, chamarBling: async (url, opcoes) => {
        chamadas.push({ url, opcoes });
        if (url.includes('/produtos?codigo=')) return { ok: true, data: { data: [{ id: 101, codigo: 'SKU-RECUPERADO' }] } };
        if (url.endsWith('/produtos/101')) return { ok: true, data: { data: { precoCusto: 12.5 } } };
        if (url.endsWith('/estoques')) return { ok: true, data: { data: { id: 9 } } };
        throw new Error('rota Bling inesperada: ' + url);
      } });
      e.banco.tabelas[e.n.ped].push({ id: 1, defeito_id: 1, tipo: 'recuperado', status: 'autorizado', sku: 'SKU-RECUPERADO', quantidade: 3 });
      const opts = { params: { id: '1' }, papel: 'admin' };
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', opts);
      assert.equal(r.statusCode, 200); assert.equal(r.body.ok, true);
      const post = chamadas.find(c => c.opcoes && c.opcoes.method === 'POST');
      assert(post); assert.equal(post.opcoes.data.deposito.id, Number(deposito));
      assert.equal(post.opcoes.data.produto.id, 101); assert.equal(post.opcoes.data.quantidade, 3);
      assert.equal(post.opcoes.data.precoUnitario, 12.5); assert(!post.opcoes.body);
      const nCalls = chamadas.length;
      assert.equal((await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', opts)).body.ja_lancado, true);
      assert.equal(chamadas.length, nCalls);
    }
  });

  await caso('depósito ausente não cai no Geral GOOD nem consulta o Bling', async () => {
    for (const chave of CHAVES) {
      let chamadas = 0;
      const e = criarEmpresa(chave, criarBanco(), { deposito: '', chamarBling: async () => { chamadas++; throw new Error('nao deveria acessar Bling'); } });
      e.banco.tabelas[e.n.ped].push({ id: 1, defeito_id: 1, tipo: 'recuperado', status: 'autorizado', sku: 'SKU', quantidade: 1 });
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id: '1' }, papel: 'admin' });
      assert.equal(r.body.ok, false); assert(/deposito Geral nao configurado/.test(r.body.erro));
      assert.equal(chamadas, 0); assert(!e.banco.tabelas[e.n.ped][0].estoque_produto_id);
    }
  });

  for (const chave of CHAVES) {
    for (const simples of [false, true]) {
      await caso(chave + ': recuperação ' + (simples ? 'por conserto simples' : 'com doador') + ' autoriza estoque com depósito/custo próprios', async () => {
        const chamadas = []; const deposito = String(8100 + CHAVES.indexOf(chave));
        const e = criarEmpresa(chave, criarBanco(), { deposito, chamarBling: async (url, opcoes) => {
          chamadas.push({ url, opcoes });
          if (url.includes('/produtos?codigo=')) return { ok: true, data: { data: [{ id: 707, codigo: 'SKU-BOA' }] } };
          if (url.endsWith('/produtos/707')) return { ok: true, data: { data: { estoque: { precoCusto: 37.25 } } } };
          if (url.endsWith('/estoques')) return { ok: true, data: { data: { id: 11 } } };
          throw new Error('rota Bling inesperada: ' + url);
        } });
        const alvo = e.item(1); const doador = e.item(2);
        const dados = { tipo: 'recuperado', defeito_id: 1, sku: 'SKU-BOA', quantidade: 2,
          ...(simples ? { so_conserto: true } : { doadores: [{ defeito_id: 2, peca: 'cupula' }] }) };
        if (!simples) {
          const invalido = await e.pedir('POST', '/api/defeitos/pedido', { body: { ...dados, doadores: [] } });
          assert.equal(invalido.statusCode, 400); assert.equal(e.banco.tabelas[e.n.ped].length, 0);
        }
        const p = await e.pedir('POST', '/api/defeitos/pedido', { body: dados });
        assert.equal(p.statusCode, 200); assert.equal(p.body.pedido.status, 'pendente');
        assert.equal(e.banco.tabelas[e.n.pec].length, simples ? 0 : 1);
        if (simples) assert(/conserto simples/.test(p.body.pedido.observacao));
        else {
          assert.equal(e.banco.tabelas[e.n.pec][0].defeito_id, 2);
          assert.equal(e.banco.tabelas[e.n.pec][0].peca, 'cupula');
        }
        const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', {
          params: { id: String(p.body.pedido.id) }, papel: 'admin', body: { acao: 'autorizar' },
        });
        assert.equal(r.statusCode, 200); assert.equal(r.body.pedido.estoque_bling.ok, true);
        const post = chamadas.filter(c => c.opcoes && c.opcoes.method === 'POST');
        assert.equal(post.length, 1); assert.equal(post[0].opcoes.data.deposito.id, Number(deposito));
        assert.equal(post[0].opcoes.data.quantidade, 2); assert.equal(post[0].opcoes.data.precoUnitario, 37.25);
        assert.equal(post[0].opcoes.data.custo, 37.25); assert.equal(post[0].opcoes.data.preco, 37.25);
        assert.equal(e.banco.tabelas[e.n.ped][0].status, 'concluido');
        assert.equal(e.banco.tabelas[e.n.ped][0].estoque_produto_id, 707);
        assert.equal(alvo.tipo, chave === 'good' ? 'problema' : 'recuperado');
        assert.equal(alvo.status, chave === 'good' ? 'delivered' : 'problema');
        assert.equal(doador.tipo, 'problema'); assert.equal(doador.status, chave === 'good' ? 'concluido' : 'problema');
        const lista = await e.pedir('GET', '/api/defeitos/lista');
        assert.deepEqual(lista.body.itens.map(x => x.id), [2]);
        assert.equal(lista.body.contagem.recuperado, 1); assert.equal(lista.body.contagem.defeito, 1);
      });
    }
  }

  console.log('\n=== ' + casos + ' CASOS: ' + (falhas ? falhas + ' FALHA(S)' : 'TODOS PASSARAM'));
  process.exitCode = falhas ? 1 : 0;
}

module.exports = { criarBanco, criarEmpresa };
if (require.main === module) main().catch(e => { console.error('FALHA fatal: ' + e.stack); process.exitCode = 1; });
