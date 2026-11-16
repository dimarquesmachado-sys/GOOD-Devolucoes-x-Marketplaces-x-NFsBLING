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
  const falhasUpdate = []; const colunasAusentes = [];
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
        in(coluna, valores) { assert(valores.length <= 150, 'URL grande demais: id.in com ' + valores.length + ' ids'); q.expressoes.push(coluna + '.in.(' + valores.join(',') + ')'); q.condicoes.push(x => valores.map(String).includes(String(x[coluna]))); return chain; },
        or(expr) { assert(expr.length <= 4000, 'URL grande demais: expressao or com ' + expr.length + ' chars'); q.expressoes.push(expr); q.condicoes.push(x => separar(expr).some(e => filtro(e, x))); return chain; },
        not(coluna, op, valor) { q.expressoes.push(coluna + '.not.' + op + '.' + valor); q.condicoes.push(x => filtro(coluna + '.not.' + op + '.' + valor, x)); return chain; },
        is(coluna, valor) { q.condicoes.push(x => valor == null ? x[coluna] == null : x[coluna] === valor); return chain; },
        order(coluna, opcoes = {}) { (q.ordens = q.ordens || []).push({ coluna, asc: opcoes.ascending !== false }); q.ordem = q.ordens[0]; return chain; },
        limit(n) { q.limites = n; return chain; },
        range(de, ate) { q.faixa = [de, ate]; return chain; },   // b725 (P2-03): paginacao por range, como o PostgREST
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
          for (const c of colunasAusentes) {
            if (c.tabela !== tabela) continue;
            const nomeada = q.colunas !== '*' && q.colunas.split(',').map(x => x.trim()).includes(c.coluna);
            const escrita = (q.operacao === 'update' || q.operacao === 'insert') && (Array.isArray(q.campos) ? q.campos : [q.campos]).some(x => x && c.coluna in x);
            if (nomeada || escrita) return { data: null, error: { message: 'column ' + tabela + '.' + c.coluna + ' does not exist' } };
          }
          if (q.operacao === 'update') {
            const f = falhasUpdate.find(x => x.tabela === tabela && x.vezes > 0 && x.quando(q.campos));
            if (f) { f.vezes--; return { data: null, error: { message: f.msg } }; }
          }
          let linhas = tabelas[tabela].filter(x => q.condicoes.every(f => f(x)));
          if (q.operacao === 'insert') {
            linhas = q.campos.map(x => ({ id: Math.max(0, ...tabelas[tabela].map(y => Number(y.id) || 0)) + 1, ...x }));
            tabelas[tabela].push(...linhas);
          }
          if (q.operacao === 'update') linhas.forEach(x => Object.assign(x, q.campos));
          if (q.operacao === 'delete') tabelas[tabela] = tabelas[tabela].filter(x => !linhas.includes(x));
          const count = linhas.length;
          if (q.ordens) linhas = [...linhas].sort((a, b) => {
            for (const o of q.ordens) { const c = String(a[o.coluna] || '').localeCompare(String(b[o.coluna] || ''), undefined, { numeric: true }) * (o.asc ? 1 : -1); if (c) return c; }
            return 0;
          });
          if (q.limites != null) linhas = linhas.slice(0, q.limites);
          if (q.faixa) linhas = linhas.slice(q.faixa[0], q.faixa[1] + 1);
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
    recusarTipoTerminal(tabela) { recusaTipoTerminal.add(tabela); },
    // b713: simula coluna ausente / update recusado — `quando(campos)` decide, `vezes` limita (padrao: sempre)
    falharUpdate(tabela, quando, msg, vezes = Infinity) { falhasUpdate.push({ tabela, quando, msg, vezes }); },
    // b713 (Codex #584 P2): coluna ausente tambem derruba SELECT que a NOMEIA (select('*') passa)
    semColuna(tabela, coluna) { colunasAusentes.push({ tabela, coluna }); } };
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
    // b725 — P2-03 (auditoria do Codex 15/11): ACIMA DE 150 IDS A LISTA NAO PODE VOLTAR AO "AMPLO". Peca resolvida POR
    // PEDIDO cuja linha nao casa com ATIVOS/TERMINAIS/EXCLUIDOS (formato legado: problema/delivered) sumia da aba
    // Recuperados a partir do 151o id — e seguia na contagem. 149/150/151/400 tem que dar a MESMA resposta.
    for (const total of [149, 150, 151, 400]) {
      await caso(chave + ': ' + total + ' recuperadas por pedido: as de formato legado (problema/delivered) aparecem na aba e batem com a contagem', async () => {
        const e = criarEmpresa(chave);
        for (let id = 1; id <= total; id++) {
          const data = new Date(Date.UTC(2026, 0, 1) + id * 60000).toISOString();   // id maior = mais novo
          e.item(id, Object.assign({ [DADOS[chave].colunaData]: data }, id % 7 === 0 ? { tipo: 'problema', status: 'delivered' } : {}));
          e.banco.tabelas[e.n.ped].push({ id, defeito_id: id, tipo: 'recuperado', status: 'autorizado' });
        }
        const legados = Array.from({ length: total }, (_, i) => i + 1).filter(id => id % 7 === 0);
        const r = await e.pedir('GET', '/api/defeitos/lista', { query: { estado: 'recuperado' } });
        assert.equal(r.statusCode, 200);
        const ids = r.body.itens.map(x => x.id);
        assert.equal(r.body.contagem.recuperado, total, 'contagem');
        assert.equal(ids.length, Math.min(total, 300), 'linhas na tela: ' + ids.length);
        const legadosNaTela = legados.filter(id => ids.includes(id));
        const esperados = legados.filter(id => id > total - 300);   // os 300 mais novos (id crescente = data crescente)
        assert.equal(legadosNaTela.length, esperados.length, 'problema/delivered resolvidos por pedido aparecem (' + legadosNaTela.length + ' de ' + esperados.length + ')');
        assert(r.body.itens.every(x => x.situacao === 'recuperado'), 'todos classificados recuperado');
      });
    }
    await caso(chave + ': Com Defeito com 1.200 resolvidas por pedido mais novas: as 300 ativas antigas aparecem (paginado, nao limite 1000)', async () => {
      const e = criarEmpresa(chave);
      for (let id = 1; id <= 1200; id++) {
        e.item(id, { [DADOS[chave].colunaData]: '2026-0' + (1 + (id % 9)) + '-01T00:00:00Z' });
        e.banco.tabelas[e.n.ped].push({ id, defeito_id: id, tipo: 'recuperado', status: 'autorizado' });
      }
      for (let id = 1201; id <= 1500; id++) e.item(id, { [DADOS[chave].colunaData]: '2020-01-01T00:00:00Z' });
      const r = await e.pedir('GET', '/api/defeitos/lista');
      assert.equal(r.statusCode, 200);
      assert.equal(r.body.itens.length, 300, 'as 300 ativas antigas: ' + r.body.itens.length);
      assert(r.body.itens.every(x => x.id >= 1201), 'nenhuma resolvida por pedido na aba Com Defeito');
      assert.equal(r.body.contagem.defeito, 300);
    });
    // Codex #593: o termo de busca entra DENTRO das paginas/lotes; a contagem com termo conserva o orcamento maior;
    // a paginacao desempata por id
    await caso(chave + ': 151 resolvidas + 400 ativas: buscar o SKU que so a 350a ativa tem ACHA a peca (termo dentro da paginacao)', async () => {
      const e = criarEmpresa(chave);
      for (let id = 1; id <= 151; id++) {
        e.item(id, { [DADOS[chave].colunaData]: '2026-11-01T00:00:00Z' });
        e.banco.tabelas[e.n.ped].push({ id, defeito_id: id, tipo: 'recuperado', status: 'autorizado' });
      }
      for (let i = 1; i <= 400; i++) {
        const id = 151 + i;   // i = 1 e a mais nova
        e.item(id, { [DADOS[chave].colunaData]: new Date(Date.UTC(2026, 9, 1) - i * 60000).toISOString(), produto_sku: i === 350 ? 'SKU-RARO' : chave + '-SKU' });
      }
      const r = await e.pedir('GET', '/api/defeitos/lista', { query: { q: 'sku-raro' } });
      assert.equal(r.statusCode, 200);
      assert.deepEqual(r.body.itens.map(x => x.id), [501], 'a 350a ativa aparece na busca: ' + JSON.stringify(r.body.itens.map(x => x.id)));
      assert.equal(r.body.contagem.defeito, 1);
      const paginas = e.banco.chamadas.filter(c => c.tabela === e.n.dev && c.faixa);
      assert(paginas.every(c => c.ordens && c.ordens.length === 2 && c.ordens[1].coluna === 'id'), 'paginacao ordena por data E por id (desempate)');
    });
    await caso(chave + ': contagem com termo na aba Recuperados nao e cortada em 300 (151 por pedido + 249 por tipo, mesmo SKU = 400)', async () => {
      const e = criarEmpresa(chave);
      for (let id = 1; id <= 151; id++) {
        e.item(id, { produto_sku: 'SKU-MESMO' });
        e.banco.tabelas[e.n.ped].push({ id, defeito_id: id, tipo: 'recuperado', status: 'autorizado' });
      }
      for (let id = 152; id <= 400; id++) e.item(id, { produto_sku: 'SKU-MESMO', tipo: 'recuperado' });
      const r = await e.pedir('GET', '/api/defeitos/lista', { query: { estado: 'recuperado', q: 'sku-mesmo' } });
      assert.equal(r.statusCode, 200);
      assert.equal(r.body.itens.length, 300, 'a tela mostra 300');
      assert.equal(r.body.contagem.recuperado, 400, 'a contagem com termo diz 400: ' + r.body.contagem.recuperado);
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

  // b712 — P1-04 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex): A MAQUINA DE ESTADOS MORA NO SERVIDOR.
  // pendente → autorizado → concluido, ou pendente → recusado. Fora disso: 409, e NADA e escrito (nem Bling, nem a
  // peca, nem comentario). Vale pras 3 empresas pelo mesmo codigo.
  for (const chave of CHAVES) {
    await caso(chave + ': estoquista NAO conclui pedido pendente (409, sem escrita)', async () => {
      const e = criarEmpresa(chave); e.item(1);
      e.banco.tabelas[e.n.ped].push({ id: 1, defeito_id: 1, tipo: 'descarte', status: 'pendente' });
      const antes = e.banco.chamadas.length;
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id: '1' }, body: { acao: 'concluir' } });
      assert.equal(r.statusCode, 409); assert.equal(r.body.ok, false);
      assert.equal(r.body.de, 'pendente'); assert.equal(r.body.para, 'concluido');
      assert.equal(e.banco.tabelas[e.n.ped][0].status, 'pendente');
      assert.equal(e.banco.tabelas[e.n.com].length, 0);
      const escritas = e.banco.chamadas.slice(antes).filter(c => c.operacao !== 'select');
      assert.equal(escritas.filter(c => c.tabela !== e.n.ped).length, 0, 'nenhuma escrita fora do update condicional');
    });
    await caso(chave + ': concluir so a partir de autorizado; recusar so a partir de pendente; inexistente 404', async () => {
      const e = criarEmpresa(chave); e.item(1);
      e.banco.tabelas[e.n.ped].push({ id: 1, defeito_id: 1, tipo: 'descarte', status: 'autorizado' });
      let r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id: '1' }, papel: 'admin', body: { acao: 'recusar' } });
      assert.equal(r.statusCode, 409); assert.equal(e.banco.tabelas[e.n.ped][0].status, 'autorizado');
      r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id: '1' }, body: { acao: 'concluir' } });
      assert.equal(r.statusCode, 200); assert.equal(e.banco.tabelas[e.n.ped][0].status, 'concluido');
      r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id: '1' }, body: { acao: 'concluir' } });
      assert.equal(r.statusCode, 409, 'concluir de novo nao e idempotente silencioso: diz que ja esta concluido');
      r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id: '999' }, papel: 'admin', body: { acao: 'autorizar' } });
      assert.equal(r.statusCode, 404);
    });
    await caso(chave + ': autorizar a MESMA recuperacao duas vezes lanca no Bling UMA vez (1a metade do P1-03)', async () => {
      const chamadas = [];
      const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: async (url, opcoes) => {
        chamadas.push({ url, opcoes });
        if (url.includes('/produtos?codigo=')) return { ok: true, data: { data: [{ id: 707, codigo: 'SKU-BOA' }] } };
        if (url.endsWith('/produtos/707')) return { ok: true, data: { data: { estoque: { precoCusto: 10 } } } };
        if (url.endsWith('/estoques')) return { ok: true, data: { data: { id: 11 } } };
        throw new Error('rota Bling inesperada: ' + url);
      } });
      e.item(1);
      const p = await e.pedir('POST', '/api/defeitos/pedido', { body: { tipo: 'recuperado', defeito_id: 1, sku: 'SKU-BOA', quantidade: 1, so_conserto: true } });
      const opts = { params: { id: String(p.body.pedido.id) }, papel: 'admin', body: { acao: 'autorizar' } };
      const r1 = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', opts);
      assert.equal(r1.statusCode, 200);
      const r2 = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', opts);
      assert.equal(r2.statusCode, 409, 'a 2a autorizacao e recusada');
      const posts = chamadas.filter(c => c.opcoes && c.opcoes.method === 'POST');
      assert.equal(posts.length, 1, 'UMA entrada no Bling, nao duas');
      const comentarios = e.banco.tabelas[e.n.com].length;
      const r3 = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', opts);
      assert.equal(r3.statusCode, 409); assert.equal(e.banco.tabelas[e.n.com].length, comentarios, 'repetir nao deixa rastro novo');
    });
  }

  // b713 — P1-03 (auditoria do Codex): MOVIMENTACAO REPETIVEL COM SEGURANCA. Reserva duravel (estoque_operacao) ANTES
  // do Bling, fechada conforme a resposta: confirmou / nao aplicou / incerto. Repeticao, concorrencia, resposta perdida
  // e falha de persistencia NAO geram entrada em dobro; sem a coluna, a rota se recusa (503 com o SQL).
  function blingDeEstoque(chamadas, respostaPost) {
    return async (url, opcoes) => {
      chamadas.push({ url, opcoes });
      if (url.includes('/produtos?codigo=')) return { ok: true, data: { data: [{ id: 707, codigo: 'SKU-BOA' }] } };
      if (url.endsWith('/produtos/707')) return { ok: true, data: { data: { estoque: { precoCusto: 10 } } } };
      if (url.endsWith('/estoques')) return typeof respostaPost === 'function' ? respostaPost() : (respostaPost || { ok: true, data: { data: { id: 11 } } });
      throw new Error('rota Bling inesperada: ' + url);
    };
  }
  const posts = (chamadas) => chamadas.filter(c => c.opcoes && c.opcoes.method === 'POST').length;
  async function pedidoRecuperado(e) {
    e.item(1);
    const p = await e.pedir('POST', '/api/defeitos/pedido', { body: { tipo: 'recuperado', defeito_id: 1, sku: 'SKU-BOA', quantidade: 1, so_conserto: true } });
    assert.equal(p.statusCode, 200);
    return String(p.body.pedido.id);
  }
  for (const chave of CHAVES) {
    await caso(chave + ': autorizar recuperada confirma com LANCADO; relancar depois nao lanca de novo', async () => {
      const ch = []; const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: blingDeEstoque(ch) });
      const id = await pedidoRecuperado(e);
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id }, papel: 'admin', body: { acao: 'autorizar' } });
      assert.equal(r.statusCode, 200); assert.equal(r.body.pedido.estoque_bling.ok, true);
      const ped = e.banco.tabelas[e.n.ped][0];
      assert.equal(ped.status, 'concluido'); assert.equal(ped.estoque_produto_id, 707); assert(/^LANCADO /.test(ped.estoque_operacao));
      const rl = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin' });
      assert.equal(rl.statusCode, 200); assert.equal(rl.body.ja_lancado, true); assert.equal(posts(ch), 1);
    });
    // Codex #583 - a autorizacao virou `autorizado` mas a entrada foi RECUSADA DE VEZ (SKU errado / EAN ambiguo): a
    // maquina de estados nao deixa autorizar de novo, entao o relancamento e o unico lugar pra CORRIGIR o SKU
    await caso(chave + ': entrada recusada por SKU errado: relancar com `sku` corrigido lanca e grava o SKU que entrou', async () => {
      const ch = []; const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: async (url, opcoes) => {
        ch.push({ url, opcoes });
        if (url.includes('/produtos?codigo=')) {
          const cod = decodeURIComponent(url.split('codigo=')[1].split('&')[0]);
          return { ok: true, data: { data: cod === 'SKU-CERTA' ? [{ id: 909, codigo: 'SKU-CERTA' }] : [] } };
        }
        if (url.endsWith('/produtos/909')) return { ok: true, data: { data: { estoque: { precoCusto: 10 } } } };
        if (url.endsWith('/estoques')) return { ok: true, data: { data: { id: 12 } } };
        throw new Error('rota Bling inesperada: ' + url);
      } });
      e.item(1);
      const p = await e.pedir('POST', '/api/defeitos/pedido', { body: { tipo: 'recuperado', defeito_id: 1, sku: 'SKU-ERRADA', quantidade: 2, so_conserto: true } });
      const id = String(p.body.pedido.id);
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id }, papel: 'admin', body: { acao: 'autorizar' } });
      assert.equal(r.statusCode, 200); assert.equal(r.body.pedido.estoque_bling.ok, false); assert.notEqual(r.body.pedido.estoque_bling.incerto, true, 'recusa definitiva, nao incerto');
      const ped = e.banco.tabelas[e.n.ped][0];
      assert.equal(ped.status, 'autorizado'); assert.equal(ped.estoque_operacao, null, 'nada em andamento'); assert.equal(posts(ch), 0);
      // autorizar de novo com o SKU certo nao e caminho: a maquina de estados barra
      const r2 = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id }, papel: 'admin', body: { acao: 'autorizar', sku: 'SKU-CERTA' } });
      assert.equal(r2.statusCode, 409);
      // relancar SEM correcao: recusa de novo e diz que da pra corrigir
      const rl = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin' });
      assert.equal(rl.statusCode, 200); assert.equal(rl.body.ok, false); assert.equal(rl.body.corrigivel, true); assert.equal(rl.body.sku_tentado, 'SKU-ERRADA'); assert.equal(posts(ch), 0);
      // sku corrigido invalido = 400 sem tocar o Bling
      const rInv = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin', body: { sku: { x: 1 } } });
      assert.equal(rInv.statusCode, 400); assert.equal(posts(ch), 0);
      // relancar COM o SKU certo: lanca, grava o que entrou, conclui
      const rc = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin', body: { sku: 'SKU-CERTA', quantidade: 2 } });
      assert.equal(rc.statusCode, 200); assert.equal(rc.body.ok, true); assert.equal(posts(ch), 1);
      assert.equal(ped.estoque_sku, 'SKU-CERTA'); assert.equal(ped.estoque_qtd, 2); assert.equal(ped.estoque_produto_id, 909); assert.equal(ped.status, 'concluido');
      // ja lancado: correcao e ignorada, nada entra de novo
      const rDepois = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin', body: { sku: 'OUTRA' } });
      assert.equal(rDepois.body.ja_lancado, true); assert.equal(posts(ch), 1); assert.equal(ped.estoque_sku, 'SKU-CERTA');
    });
    await caso(chave + ': correcao de SKU/qtd que fica INCERTA e preservada: o forcar repete a tentativa corrigida, nao a original', async () => {
      const ch = []; let resposta = { ok: false, status: 0, error: { error: { message: 'timeout' } } };
      const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: async (url, opcoes) => {
        ch.push({ url, opcoes });
        if (url.includes('/produtos?codigo=')) {
          const cod = decodeURIComponent(url.split('codigo=')[1].split('&')[0]);
          return { ok: true, data: { data: cod === 'SKU-CERTA' ? [{ id: 909, codigo: 'SKU-CERTA' }] : [] } };
        }
        if (url.endsWith('/produtos/909')) return { ok: true, data: { data: { estoque: { precoCusto: 10 } } } };
        if (url.endsWith('/estoques')) return resposta;
        throw new Error('rota Bling inesperada: ' + url);
      } });
      e.item(1);
      const p = await e.pedir('POST', '/api/defeitos/pedido', { body: { tipo: 'recuperado', defeito_id: 1, sku: 'SKU-ERRADA', quantidade: 1, so_conserto: true } });
      const id = String(p.body.pedido.id);
      await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id }, papel: 'admin', body: { acao: 'autorizar' } });   // recusa definitiva (SKU-ERRADA nao existe)
      const ped = e.banco.tabelas[e.n.ped][0];
      assert.equal(ped.estoque_operacao, null);
      // corrigido pra SKU-CERTA x2, e o Bling nao responde: INCERTO, reserva fica
      const rc = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin', body: { sku: 'SKU-CERTA', quantidade: 2 } });
      assert.equal(rc.statusCode, 502); assert.equal(rc.body.incerto, true); assert(/^LANCANDO /.test(ped.estoque_operacao));
      assert.equal(ped.estoque_sku, 'SKU-CERTA'); assert.equal(ped.estoque_qtd, 2);
      // o admin confere no Bling que nao entrou e forca (a ficha so manda `forcar`): tem que repetir SKU-CERTA x2
      resposta = { ok: true, data: { data: { id: 13 } } };
      const rf = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin', body: { forcar: ped.estoque_operacao } });
      assert.equal(rf.statusCode, 200); assert.equal(rf.body.ok, true);
      const post = ch.filter(c => c.opcoes && c.opcoes.method === 'POST').pop();
      const corpo = post.opcoes.data || {};
      assert.equal(String(corpo.produto && corpo.produto.id), '909', 'o POST forcado e do produto CORRIGIDO: ' + JSON.stringify(corpo));
      assert.equal(Number(corpo.quantidade), 2, 'com a quantidade corrigida');
      assert.equal(ped.estoque_produto_id, 909); assert.equal(ped.estoque_sku, 'SKU-CERTA'); assert.equal(ped.estoque_qtd, 2);
    });
    await caso(chave + ': operacao INCERTA nao aceita correcao de SKU sem a marca conferida', async () => {
      const ch = []; let resposta = { ok: false, status: 0, error: { error: { message: 'timeout' } } };
      const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: blingDeEstoque(ch, () => resposta) });
      const id = await pedidoRecuperado(e);
      await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id }, papel: 'admin', body: { acao: 'autorizar' } });
      const rl = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin', body: { sku: 'SKU-BOA' } });
      assert.equal(rl.statusCode, 409); assert.equal(rl.body.incerto, true); assert.equal(posts(ch), 1, 'o SKU corrigido NAO reabre operacao incerta');
    });
    await caso(chave + ': Bling SEM RESPOSTA = incerto: marca fica, relancar recusa (409) ate forcar', async () => {
      const ch = []; let resposta = { ok: false, status: 0, error: { error: { message: 'timeout' } } };
      const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: blingDeEstoque(ch, () => resposta) });
      const id = await pedidoRecuperado(e);
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id }, papel: 'admin', body: { acao: 'autorizar' } });
      assert.equal(r.statusCode, 200); assert.equal(r.body.pedido.estoque_bling.ok, false); assert.equal(r.body.pedido.estoque_bling.incerto, true);
      const ped = e.banco.tabelas[e.n.ped][0];
      assert.equal(ped.status, 'autorizado'); assert(/^LANCANDO /.test(ped.estoque_operacao), 'a reserva FICA: ' + ped.estoque_operacao);
      assert(e.banco.tabelas[e.n.com].some(c => /INCERTO/.test(c.texto)), 'o rastro diz INCERTO');
      const rl = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin' });
      assert.equal(rl.statusCode, 409); assert.equal(rl.body.incerto, true); assert.equal(posts(ch), 1, 'relancar sem forcar NAO chamou o Bling');
      resposta = { ok: true, data: { data: { id: 11 } } };
      // Codex #584 (P1): `forcar: true` nao basta — tem que ser a MARCA conferida
      const rTrue = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin', body: { forcar: true } });
      assert.equal(rTrue.statusCode, 409); assert.equal(posts(ch), 1);
      const rOutra = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin', body: { forcar: 'LANCANDO outra' } });
      assert.equal(rOutra.statusCode, 409); assert(/marca mudou/.test(rOutra.body.erro)); assert.equal(posts(ch), 1);
      const rf = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin', body: { forcar: rl.body.estoque_operacao } });
      assert.equal(rf.statusCode, 200); assert.equal(rf.body.ok, true); assert.equal(posts(ch), 2);
      assert.equal(ped.status, 'concluido'); assert(/^LANCADO /.test(ped.estoque_operacao));
    });
    await caso(chave + ': dois admins conferem o MESMO incerto e forcam em paralelo (1o POST pendurado): um lanca, outro 409, UM POST', async () => {
      const ch = []; let soltar = null; let n = 0;
      const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: blingDeEstoque(ch, () => {
        n++;
        if (n === 1) return new Promise((r) => { soltar = () => r({ ok: true, data: { data: { id: 11 } } }); });
        return { ok: true, data: { data: { id: 11 } } };
      }) });
      const id = await pedidoRecuperado(e);
      const ped = e.banco.tabelas[e.n.ped][0];
      ped.status = 'autorizado'; ped.estoque_operacao = 'LANCANDO incerto1';   // a chamada anterior ficou sem resposta
      const p1 = e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin', body: { forcar: 'LANCANDO incerto1' } });
      await new Promise((r) => setTimeout(r, 30));   // o 1o ja reservou (marca nova) e esta esperando o Bling
      const r2 = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin', body: { forcar: 'LANCANDO incerto1' } });
      assert.equal(r2.statusCode, 409, 'o 2o admin confirmou a marca ANTIGA; ela mudou → 409');
      soltar(); const r1 = await p1;
      assert.equal(r1.statusCode, 200); assert.equal(posts(ch), 1, '⚠️ Codex #584: UM POST, nao dois');
    });
    await caso(chave + ': Bling RECUSOU (4xx) = nao aplicou: marca volta a null e relancar funciona', async () => {
      const ch = []; let resposta = { ok: false, status: 400, error: { error: { message: 'deposito invalido' } } };
      const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: blingDeEstoque(ch, () => resposta) });
      const id = await pedidoRecuperado(e);
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id }, papel: 'admin', body: { acao: 'autorizar' } });
      assert.equal(r.statusCode, 200); assert.equal(r.body.pedido.estoque_bling.naoAplicou, true);
      const ped = e.banco.tabelas[e.n.ped][0];
      assert.equal(ped.status, 'autorizado'); assert.equal(ped.estoque_operacao, null, 'a reserva foi devolvida');
      resposta = { ok: true, data: { data: { id: 11 } } };
      const rl = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin' });
      assert.equal(rl.statusCode, 200); assert.equal(posts(ch), 2); assert.equal(ped.estoque_produto_id, 707);
    });
    await caso(chave + ': Bling confirmou mas o banco RECUSOU a confirmacao: pedido fica LANCANDO e relancar nao dobra', async () => {
      const ch = []; const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: blingDeEstoque(ch) });
      const id = await pedidoRecuperado(e);
      e.banco.falharUpdate(e.n.ped, campos => campos.estoque_produto_id === 707, 'connection reset', 1);
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id }, papel: 'admin', body: { acao: 'autorizar' } });
      assert.equal(r.statusCode, 200); assert(r.body.pedido.estoque_bling.aviso && /em andamento/.test(r.body.pedido.estoque_bling.aviso), 'a resposta AVISA que a confirmacao nao gravou');
      const ped = e.banco.tabelas[e.n.ped][0];
      assert(/^LANCANDO /.test(ped.estoque_operacao)); assert.equal(ped.estoque_produto_id, undefined);
      const rl = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin' });
      assert.equal(rl.statusCode, 409); assert.equal(posts(ch), 1, '⚠️ o cenario do Codex: a repeticao NAO movimenta de novo');
    });
    await caso(chave + ': dois relancamentos ao MESMO tempo: um lanca, o outro 409, UM POST', async () => {
      const ch = []; const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: blingDeEstoque(ch) });
      const id = await pedidoRecuperado(e);
      e.banco.tabelas[e.n.ped][0].status = 'autorizado';   // autorizada sem lancamento (pedido antigo)
      const [a, b] = await Promise.all([
        e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin' }),
        e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id }, papel: 'admin' }),
      ]);
      assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]); assert.equal(posts(ch), 1);
    });
    await caso(chave + ': sem a coluna estoque_operacao a recuperada NAO e autorizada (503 com o SQL); descarte segue', async () => {
      const ch = []; const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: blingDeEstoque(ch) });
      const id = await pedidoRecuperado(e);
      e.banco.semColuna(e.n.ped, 'estoque_operacao');   // Codex #584 (P2): derruba select que NOMEIA a coluna e qualquer escrita nela
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id }, papel: 'admin', body: { acao: 'autorizar' } });
      assert.equal(r.statusCode, 503); assert.equal(r.body.falta_coluna, true); assert(/add column if not exists estoque_operacao/.test(r.body.sql));
      assert.equal(e.banco.tabelas[e.n.ped][0].status, 'pendente'); assert.equal(posts(ch), 0, 'sem marcador, nao mexe no Bling');
      e.item(2); e.banco.tabelas[e.n.ped].push({ id: 50, defeito_id: 2, tipo: 'descarte', status: 'pendente' });
      const rd = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id: '50' }, papel: 'admin', body: { acao: 'autorizar' } });
      assert.equal(rd.statusCode, 200, 'descarte nao precisa da coluna');
    });
  }

  await caso('a ficha (tela unica das 3) distingue INCERTO de recusa: nao manda lancar a mao quando o Bling pode ter lancado', async () => {
    const fs = require('fs'); const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'js-AMB', 'defeitos-ficha.js'), 'utf8');
    const i = src.indexOf('window.decidirPedido = async function'); const f = src.indexOf('abrirFilaPedidos();', i);
    assert(i >= 0 && f > i, 'marcadores do decidirPedido existem');
    const bloco = src.slice(i, f);
    assert(/else if \(est\.incerto\)/.test(bloco), 'ha um ramo proprio pro incerto');
    const ramoIncerto = bloco.slice(bloco.indexOf('else if (est.incerto)'), bloco.indexOf('} else {', bloco.indexOf('else if (est.incerto)')));
    assert(/N[ÃA]O lance [àa] m[ãa]o/i.test(ramoIncerto) && /Confira o estoque/.test(ramoIncerto), 'o incerto manda CONFERIR, nao lancar a mao');
    assert(/est\.aviso/.test(bloco), 'o aviso de "lancou mas nao gravou" aparece pro operador');
  });

  // b714 — P1-05 (auditoria do Codex): EAN AMBIGUO INTERROMPE; de-para e alternativa controlada. Nunca "o primeiro".
  for (const chave of CHAVES) {
    await caso(chave + ': EAN que aponta pra DOIS produtos no Bling NAO lanca — interrompe e lista os candidatos', async () => {
      const ch = [];
      const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: async (url, opcoes) => {
        ch.push({ url, opcoes });
        if (url.includes('/produtos?codigo=')) return { ok: true, data: { data: [] } };   // SKU digitado nao existe
        if (url.includes('/produtos?gtin=')) return { ok: true, data: { data: [{ id: 501, codigo: 'COMPONENTE-A', nome: 'cupula' }, { id: 502, codigo: 'KIT-COMPLETO', nome: 'luminaria' }] } };
        throw new Error('rota Bling inesperada: ' + url);
      } });
      e.item(1);
      const p = await e.pedir('POST', '/api/defeitos/pedido', { body: { tipo: 'recuperado', defeito_id: 1, sku: '7891234567890', quantidade: 1, so_conserto: true } });
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id: String(p.body.pedido.id) }, papel: 'admin', body: { acao: 'autorizar' } });
      assert.equal(r.statusCode, 200);
      const est = r.body.pedido.estoque_bling;
      assert.equal(est.ok, false); assert.equal(est.ambiguo, true); assert.equal(est.naoAplicou, true);
      assert.deepEqual(est.candidatos.map(c => c.codigo), ['COMPONENTE-A', 'KIT-COMPLETO']);
      assert(/nao escolho sozinho/.test(est.erro));
      assert.equal(ch.filter(c => c.opcoes && c.opcoes.method === 'POST').length, 0, '⚠️ NENHUMA entrada no Bling');
      assert.equal(e.banco.tabelas[e.n.ped][0].estoque_operacao, null, 'a reserva foi devolvida (pode relancar com o SKU certo)');
    });
    await caso(chave + ': EAN com UM produto confirma pelo codigo exato; SKU renomeado resolve pelo de-para antes do EAN', async () => {
      const ch = []; const deparas = [];
      const e = criarEmpresa(chave, criarBanco(), { deposito: '8100',
        resolverSku: async (sku) => { deparas.push(sku); return sku === 'SKU-ANTIGO' ? { trocado: true, sku: 'SKU-NOVO' } : { trocado: false }; },
        chamarBling: async (url, opcoes) => {
          ch.push({ url, opcoes });
          if (url.includes('/produtos?codigo=SKU-NOVO')) return { ok: true, data: { data: [{ id: 601, codigo: 'SKU-NOVO' }] } };
          if (url.includes('/produtos?codigo=UNICO')) return { ok: true, data: { data: [{ id: 701, codigo: 'UNICO' }] } };
          if (url.includes('/produtos?codigo=')) return { ok: true, data: { data: [] } };
          if (url.includes('/produtos?gtin=')) return { ok: true, data: { data: [{ id: 701, codigo: 'UNICO' }, { id: 701, codigo: 'UNICO' }] } };   // o MESMO produto 2x = um candidato
          if (/\/produtos\/\d+$/.test(url)) return { ok: true, data: { data: { estoque: { precoCusto: 5 } } } };
          if (url.endsWith('/estoques')) return { ok: true, data: { data: { id: 11 } } };
          throw new Error('rota Bling inesperada: ' + url);
        } });
      e.item(1); e.item(2);
      // de-para
      let p = await e.pedir('POST', '/api/defeitos/pedido', { body: { tipo: 'recuperado', defeito_id: 1, sku: 'SKU-ANTIGO', quantidade: 1, so_conserto: true } });
      let r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id: String(p.body.pedido.id) }, papel: 'admin', body: { acao: 'autorizar' } });
      assert.equal(r.statusCode, 200); assert.equal(r.body.pedido.estoque_bling.ok, true); assert.equal(r.body.pedido.estoque_bling.produto_id, 601);
      assert(deparas.includes('SKU-ANTIGO'), 'consultou o de-para da empresa');
      // EAN unico
      p = await e.pedir('POST', '/api/defeitos/pedido', { body: { tipo: 'recuperado', defeito_id: 2, sku: '7890000000001', quantidade: 1, so_conserto: true } });
      r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id: String(p.body.pedido.id) }, papel: 'admin', body: { acao: 'autorizar' } });
      assert.equal(r.statusCode, 200); assert.equal(r.body.pedido.estoque_bling.ok, true); assert.equal(r.body.pedido.estoque_bling.produto_id, 701);
      assert.equal(ch.filter(c => c.opcoes && c.opcoes.method === 'POST').length, 2);
    });
  }

  await caso('a GOOD injeta o de-para no ciclo (a fabrica ja injetava) — sem isso o SKU renomeado so resolvia na AMB/Girassol', async () => {
    const fs = require('fs'); const path = require('path');
    const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const i = srv.indexOf('registrarCicloDefeitos(app, {'); const f = srv.indexOf('});', i);
    assert(i >= 0 && f > i); assert(/resolverSku: \(sku\) => skuDeparaGOOD\.resolverSku\(sku\),/.test(srv.slice(i, f)));
  });

  // b715 — P2-02 (auditoria do Codex): QUANTIDADE INVALIDA E 400, NAO "1". Zero, negativo, NaN, Infinity, fracao e
  // acima de 1000 param ANTES de qualquer escrita, na criacao do pedido e na autorizacao; ausente continua 1.
  for (const chave of CHAVES) {
    await caso(chave + ': quantidade invalida ao CRIAR o pedido e 400 sem gravar; ausente vira 1', async () => {
      const e = criarEmpresa(chave); e.item(1);
      // Codex #586: objeto sem toString, lista e booleano tambem sao 400 (antes String(v) estourava fora do try)
      for (const q of [0, -3, 'abc', 'Infinity', 1.5, 1001, '0', '2,5', { toString: null }, [2], true]) {
        const r = await e.pedir('POST', '/api/defeitos/pedido', { body: { tipo: 'descarte', defeito_id: 1, quantidade: q } });
        assert.equal(r.statusCode, 400, 'quantidade ' + JSON.stringify(q) + ' → 400 (veio ' + r.statusCode + ')');
        assert(/quantidade invalida/.test(r.body.erro));
      }
      assert.equal(e.banco.tabelas[e.n.ped].length, 0, 'nada gravado');
      const ok1 = await e.pedir('POST', '/api/defeitos/pedido', { body: { tipo: 'descarte', defeito_id: 1 } });
      assert.equal(ok1.statusCode, 200); assert.equal(ok1.body.pedido.quantidade, 1);
      const ok2 = await e.pedir('POST', '/api/defeitos/pedido', { body: { tipo: 'descarte', defeito_id: 1, quantidade: '12' } });
      assert.equal(ok2.statusCode, 200); assert.equal(ok2.body.pedido.quantidade, 12);
    });
    await caso(chave + ': quantidade invalida ao AUTORIZAR e 400 antes de qualquer escrita (Infinity nao chega no Bling)', async () => {
      const ch = []; const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: blingDeEstoque(ch) });
      const id = await pedidoRecuperado(e);
      for (const q of ['Infinity', 0, -1, 'NaN', 2.5, 5000]) {
        const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id }, papel: 'admin', body: { acao: 'autorizar', sku: 'SKU-BOA', quantidade: q } });
        assert.equal(r.statusCode, 400, 'quantidade ' + JSON.stringify(q) + ' → 400 (veio ' + r.statusCode + ')');
      }
      assert.equal(e.banco.tabelas[e.n.ped][0].status, 'pendente', 'o pedido continua pendente');
      assert.equal(posts(ch), 0, 'nada foi pro Bling');
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/decidir', { params: { id }, papel: 'admin', body: { acao: 'autorizar', sku: 'SKU-BOA', quantidade: '3' } });
      assert.equal(r.statusCode, 200); assert.equal(posts(ch), 1);
      assert.equal(ch.filter(c => c.opcoes && c.opcoes.method === 'POST')[0].opcoes.data.quantidade, 3);
    });
    await caso(chave + ': pedido antigo com quantidade torta no banco nao movimenta (a guarda vale dentro de entradaNoEstoque)', async () => {
      const ch = []; const e = criarEmpresa(chave, criarBanco(), { deposito: '8100', chamarBling: blingDeEstoque(ch) });
      e.item(1);
      e.banco.tabelas[e.n.ped].push({ id: 1, defeito_id: 1, tipo: 'recuperado', status: 'autorizado', sku: 'SKU-BOA', quantidade: 0 });
      const r = await e.pedir('POST', '/api/defeitos/pedido/:id/lancar-estoque', { params: { id: '1' }, papel: 'admin' });
      assert.equal(r.statusCode, 200); assert.equal(r.body.ok, false); assert(/quantidade invalida/.test(r.body.erro));
      assert.equal(posts(ch), 0);
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
