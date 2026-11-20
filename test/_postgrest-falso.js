'use strict';
// b748 — T-01 (auditoria do Codex, 15/11): UM POSTGREST FALSO NA PORTA, PRO server.js DE VERDADE FALAR COM ELE.
//
// Os testes de rota ate aqui montavam o app com um Supabase de mentira injetado no mesmo processo. Isso nao cobre o
// que o Codex pediu: subir o servidor como na producao (filho, env, 3 empresas) e bater nas rotas por HTTP, com papeis,
// empresa e estados DE VERDADE. Pra isso o filho precisa de um banco em algum endereco — este modulo e esse endereco.
//
// Fala o dialeto do supabase-js (PostgREST): GET/POST/PATCH/DELETE em /rest/v1/<tabela>, filtros na query
// (eq, neq, gt, gte, lt, lte, like, ilike, is, in, not.<op>, or=(...), and=(...)), select, order, limit, offset,
// Range, Prefer: return=representation / count=exact, Accept de objeto unico. Tabela desconhecida e vazia (nao erra):
// o boot toca dezenas de tabelas e aqui so interessa o que o teste semeia.
//
// Registra TODA requisicao (`pedidos`) com a tabela — e assim que um teste prova que a AMB nao tocou a tabela da
// Girassol, nem a GOOD a da AMB.
//
// Uso:
//   const { subirPostgrest } = require('./_postgrest-falso');
//   const pg = await subirPostgrest({ tabelas: { defeito_pedidos: [{ id: 1, status: 'pendente', ... }] } });
//   process.env.SUPABASE_URL = pg.url;  ...  pg.tabela('defeito_pedidos')  pg.pedidos  pg.parar()
const http = require('http');

function parseValor(v) {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}
function listaIn(s) {
  // in.(a,b,"c d")
  const dentro = s.replace(/^\(/, '').replace(/\)$/, '');
  if (!dentro) return [];
  return dentro.split(',').map((x) => x.trim().replace(/^"(.*)"$/, '$1'));
}
function comparar(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;   // nulls last
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
function likeRegex(p, flags) {
  return new RegExp('^' + p.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', flags);
}
// um filtro "col.op.valor" (com `not.` opcional) vira funcao(linha)
function filtro(col, expr) {
  let neg = false;
  let e = expr;
  if (e.startsWith('not.')) { neg = true; e = e.slice(4); }
  const ponto = e.indexOf('.');
  const op = ponto >= 0 ? e.slice(0, ponto) : e;
  const val = ponto >= 0 ? e.slice(ponto + 1) : '';
  let f;
  switch (op) {
    case 'eq': f = (l) => String(l[col]) === val && l[col] != null; break;
    case 'neq': f = (l) => l[col] == null || String(l[col]) !== val; break;
    case 'gt': f = (l) => l[col] != null && comparar(l[col], tipar(l[col], val)) > 0; break;
    case 'gte': f = (l) => l[col] != null && comparar(l[col], tipar(l[col], val)) >= 0; break;
    case 'lt': f = (l) => l[col] != null && comparar(l[col], tipar(l[col], val)) < 0; break;
    case 'lte': f = (l) => l[col] != null && comparar(l[col], tipar(l[col], val)) <= 0; break;
    case 'like': f = (l) => l[col] != null && likeRegex(val, '').test(String(l[col])); break;
    case 'ilike': f = (l) => l[col] != null && likeRegex(val, 'i').test(String(l[col])); break;
    case 'is': f = (l) => (val === 'null' ? l[col] == null : l[col] === parseValor(val)); break;
    case 'in': { const lista = listaIn(val); f = (l) => l[col] != null && lista.includes(String(l[col])); break; }
    case 'cs': {   // contains: cs.{a,b} (array) ou cs.["a"] (jsonb)
      let itens;
      try { itens = val.startsWith('[') ? JSON.parse(val) : listaIn(val.replace(/^\{/, '(').replace(/\}$/, ')')); } catch (e) { itens = listaIn(val); }
      f = (l) => Array.isArray(l[col]) && itens.every((x) => l[col].map(String).includes(String(x)));
      break;
    }
    default: throw new Error('postgrest falso: operador nao suportado: ' + op);
  }
  // NOT em SQL sobre NULL da NULL (falso) — menos `not.is.null`, que e o teste de presenca
  if (!neg) return f;
  if (op === 'is') return (l) => !f(l);
  return (l) => l[col] != null && !f(l);
}
function tipar(ref, val) { return typeof ref === 'number' && val !== '' && !isNaN(Number(val)) ? Number(val) : val; }
// or=(a.eq.1,b.is.null,and(c.eq.2,d.eq.3))
function grupo(expr, modo) {
  const partes = dividirTopo(expr.replace(/^\(/, '').replace(/\)$/, ''));
  const fs = partes.map((p) => {
    const m = /^(and|or)\((.*)\)$/.exec(p);
    if (m) return grupo('(' + m[2] + ')', m[1]);
    const i = p.indexOf('.');
    return filtro(p.slice(0, i), p.slice(i + 1));
  });
  return modo === 'and' ? (l) => fs.every((f) => f(l)) : (l) => fs.some((f) => f(l));
}
function dividirTopo(s) {
  const fora = []; let nivel = 0; let atual = '';
  for (const ch of s) {
    if (ch === '(') nivel++;
    if (ch === ')') nivel--;
    if (ch === ',' && nivel === 0) { fora.push(atual); atual = ''; continue; }
    atual += ch;
  }
  if (atual) fora.push(atual);
  return fora;
}
function projetar(linha, select) {
  if (!select || select === '*') return Object.assign({}, linha);
  const fora = {};
  for (const c of dividirTopo(select)) {
    const nome = c.trim().split(':').pop().split('(')[0];
    if (nome === '*') return Object.assign({}, linha);
    if (nome in linha) fora[nome] = linha[nome];
  }
  return fora;
}

// `objetos`: { 'bucket/caminho.jpg': Buffer } — um Storage minusculo, servido em /storage/v1/object/<bucket>/<caminho>
// (download autenticado do supabase-js) e /storage/v1/object/public/<bucket>/<caminho> (URL publica). b748 (Codex #610):
// e o que permite exigir 200 + bytes da foto da propria empresa, em vez de aceitar "qualquer coisa que nao seja 404".
// `fks`: { tabela: { coluna: tabelaPai } } — POST/PATCH com valor sem pai responde 409 23503 (foreign key), como o
// Postgres. Opcional; b764 (Codex #622) usa pra provar que o restore grava os pais antes dos filhos.
// b774 (V-04, ensaio real de 20/11): `colunas` — tabela SEM a coluna `id` (espreita_notas da GOOD, sku_depara,
// devolucao_tags). Declarada, o falso responde como o PostgREST: order por coluna inexistente = 400 42703
// "column <tabela>.<col> does not exist"; upsert casa pelas colunas de `on_conflict` (nao so por id); POST nao
// inventa `id` numa tabela que nao o tem.
async function subirPostgrest({ tabelas = {}, objetos = {}, fks = {}, colunas = {} } = {}) {
  const dados = {};
  let proximoId = 1000;
  for (const [t, linhas] of Object.entries(tabelas)) dados[t] = linhas.map((l) => Object.assign({}, l));
  const pedidos = [];
  const ganchos = { interceptar: null };
  const lerCorpo = (req) => new Promise((r) => { let c = ''; req.on('data', (x) => { c += x; }); req.on('end', () => r(c)); });

  const servidor = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const m = /^\/rest\/v1\/([A-Za-z0-9_]+)$/.exec(u.pathname);
    const responder = (status, corpo, extra = {}) => {
      res.writeHead(status, Object.assign({ 'content-type': 'application/json' }, extra));
      res.end(corpo == null ? '' : JSON.stringify(corpo));
    };
    const st = /^\/storage\/v1\/object\/(?:public\/)?(.+)$/.exec(u.pathname);
    if (st) {
      const chave = decodeURIComponent(st[1]);
      pedidos.push({ metodo: req.method, tabela: 'storage:' + chave, query: u.search });
      const obj = objetos[chave];
      if (!obj) return responder(404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      res.writeHead(200, { 'content-type': obj.tipo || 'application/octet-stream', 'content-length': obj.bytes.length });
      return res.end(obj.bytes);
    }
    if (!m) return responder(404, { message: 'rota desconhecida no postgrest falso: ' + u.pathname });
    const tabela = m[1];
    pedidos.push({ metodo: req.method, tabela, query: u.search });
    // b751 (T-03): `interceptar(pedido)` pode responder no lugar do banco — { status, corpo } (ex.: 500 numa escrita
    // especifica) ou { atrasoMs } antes de seguir. E assim que se simula o banco falhando ENTRE o ERP e a gravacao.
    if (typeof ganchos.interceptar === 'function') {
      const decisao = await ganchos.interceptar({ metodo: req.method, tabela, query: u.search, params: u.searchParams });
      if (decisao && decisao.status) return responder(decisao.status, decisao.corpo || { message: 'falha simulada', code: String(decisao.status) });
      if (decisao && decisao.atrasoMs) await new Promise((r) => setTimeout(r, decisao.atrasoMs));
    }
    if (!dados[tabela]) dados[tabela] = [];
    const linhas = dados[tabela];
    const prefer = String(req.headers.prefer || '');
    const unico = /vnd\.pgrst\.object/.test(String(req.headers.accept || ''));

    // filtros
    const fs = []; let select = '*'; let order = []; let limit = null; let offset = 0;
    for (const [k, v] of u.searchParams.entries()) {
      if (k === 'select') select = v;
      else if (k === 'order') order = v.split(',').map((o) => { const p = o.split('.'); return { col: p[0], desc: p[1] === 'desc', nullsfirst: p.includes('nullsfirst') }; });
      else if (k === 'limit') limit = Number(v);
      else if (k === 'offset') offset = Number(v);
      else if (k === 'or') fs.push(grupo(v, 'or'));
      else if (k === 'and') fs.push(grupo(v, 'and'));
      else if (k === 'on_conflict' || k === 'columns') { /* ignorado */ }
      else fs.push(filtro(k, v));
    }
    if (colunas[tabela]) {
      const falta = order.find((o) => !colunas[tabela].includes(o.col));
      if (falta) return responder(400, { code: '42703', message: `column ${tabela}.${falta.col} does not exist`, details: null, hint: null });
    }
    const range = /^(\d+)-(\d+)$/.exec(String(req.headers.range || ''));
    if (range) { offset = Number(range[1]); limit = Number(range[2]) - Number(range[1]) + 1; }
    const casa = (l) => fs.every((f) => f(l));

    let corpoReq = null;
    if (req.method === 'POST' || req.method === 'PATCH') {
      const bruto = await lerCorpo(req);
      try { corpoReq = bruto ? JSON.parse(bruto) : null; } catch (e) { return responder(400, { message: 'JSON invalido' }); }
    }

    // chaves estrangeiras (opcional)
    if ((req.method === 'POST' || req.method === 'PATCH') && fks[tabela] && corpoReq) {
      for (const l of (Array.isArray(corpoReq) ? corpoReq : [corpoReq])) {
        for (const [col, pai] of Object.entries(fks[tabela])) {
          if (l[col] == null) continue;
          if (!(dados[pai] || []).some((p) => String(p.id) === String(l[col]))) {
            return responder(409, { code: '23503', message: `insert or update on table "${tabela}" violates foreign key constraint`, details: `Key (${col})=(${l[col]}) is not present in table "${pai}".` });
          }
        }
      }
    }
    let resultado;
    if (req.method === 'GET' || req.method === 'HEAD') {
      resultado = linhas.filter(casa);
    } else if (req.method === 'POST') {
      // upsert (Prefer: resolution=merge-duplicates, on_conflict=id): linha com o mesmo id e SUBSTITUIDA — b764 (V-04)
      const upsert = /resolution=merge-duplicates/.test(prefer);
      const temId = !colunas[tabela] || colunas[tabela].includes('id');
      const conflito = String(u.searchParams.get('on_conflict') || 'id').split(',').map((c) => c.trim()).filter(Boolean);
      const novos = (Array.isArray(corpoReq) ? corpoReq : [corpoReq]).map((l) => {
        const n = Object.assign({}, l);
        if (temId && n.id == null) n.id = proximoId++;
        return n;
      });
      for (const n of novos) {
        const i = upsert ? linhas.findIndex((l) => conflito.every((c) => String(l[c]) === String(n[c]))) : -1;
        if (i >= 0) linhas[i] = Object.assign({}, linhas[i], n); else linhas.push(n);
      }
      resultado = novos;
    } else if (req.method === 'PATCH') {
      resultado = [];
      for (const l of linhas) if (casa(l)) { Object.assign(l, corpoReq); resultado.push(l); }
    } else if (req.method === 'DELETE') {
      resultado = linhas.filter(casa);
      dados[tabela] = linhas.filter((l) => !casa(l));
    } else return responder(405, { message: 'metodo' });

    const total = resultado.length;
    if (req.method === 'GET' || req.method === 'HEAD') {
      for (const o of order.slice().reverse()) {
        resultado.sort((a, b) => {
          const c = comparar(a[o.col], b[o.col]);
          if (a[o.col] == null || b[o.col] == null) return o.nullsfirst ? -c : c;
          return o.desc ? -c : c;
        });
      }
      resultado = resultado.slice(offset, limit != null ? offset + limit : undefined);
    } else if (limit != null) resultado = resultado.slice(0, limit);
    const saida = resultado.map((l) => projetar(l, select));
    const extra = {};
    const fim = saida.length ? offset + saida.length - 1 : offset;
    extra['content-range'] = `${offset}-${fim}/${/count=/.test(prefer) ? total : '*'}`;
    if (req.method === 'HEAD') { res.writeHead(200, extra); return res.end(); }
    if (unico) {
      if (saida.length !== 1) return responder(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `Results contain ${saida.length} rows` }, extra);
      return responder(200, saida[0], extra);
    }
    if ((req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') && !/return=representation/.test(prefer)) {
      return responder(req.method === 'POST' ? 201 : 204, null, extra);
    }
    return responder(req.method === 'POST' ? 201 : 200, saida, extra);
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const porta = servidor.address().port;
  return {
    url: 'http://127.0.0.1:' + porta,
    porta,
    pedidos,
    ganchos,   // ganchos.interceptar = async ({ metodo, tabela, query, params }) => null | { status, corpo } | { atrasoMs }
    tabela: (t) => { if (!dados[t]) dados[t] = []; return dados[t]; },   // cria ao tocar: da pra semear depois de subir
    parar: () => new Promise((r) => servidor.close(() => r())),
  };
}

module.exports = { subirPostgrest };
