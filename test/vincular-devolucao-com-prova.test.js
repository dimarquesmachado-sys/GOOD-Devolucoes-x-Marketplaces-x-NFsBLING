'use strict';
// 15/10 — dono: 'rodei 6 NFs na lista da Girassol, so subiram 4 no Bling, 2 sumiram'. Log: os cards 132, 117 e 129
// foram VINCULADOS a devolucoes escolhidas por nome/valor (o 132 entre 7 candidatas). Agora: so liga a devolucao cujo
// XML REFERENCIA a NF de venda do card; e a rota de resgate desfaz o vinculo errado e reabre o card.
// Roda as rotas de PRODUCAO (rotas-admin-AMB) com Bling, XML e banco de mentira.
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const CH_VENDA = '35260927548456000147550010001274061820750644';
const CH_OUTRA = '35260927548456000147550010001299991820750600';
const NAT = '15103';
const XML = (ref) => '<nfeProc><NFe><infNFe Id="NFe1"><ide><NFref><refNFe>' + ref + '</refNFe></NFref></ide></infNFe></NFe></nfeProc>';
function montar({ reg, paginas, detalhes, xmls, falharXml, depsExtra, falharPagina }) {
  const handlers = {};
  const app = { get: (p, ...f) => { handlers['GET ' + p] = f[f.length - 1]; }, post: (p, ...f) => { handlers['POST ' + p] = f[f.length - 1]; }, put() {}, delete() {}, patch() {}, use() {} };
  const gravado = {};
  const sb = { from: () => {
    const q = { select() { return q; }, eq() { return q; }, is() { return q; },
      single: async () => ({ data: reg, error: null }),
      update(o) { Object.assign(gravado, o); return { eq: async () => ({ error: null }) }; } };
    return q; }, storage: { from: () => ({}) } };
  const chamarBling = async (url) => { const m = /pagina=(\d+)/.exec(url); const pg = m ? Number(m[1]) : 1; if (falharPagina === pg) return { ok: false, status: 429 }; return { ok: true, data: { data: paginas[pg - 1] || [] } }; };
  const buscarNFePorId = async (id) => (detalhes[id] ? { ok: true, data: { data: detalhes[id] } } : { ok: false, status: 404 });
  const deps = { supabase: sb, requerAdmin: (q, r, n) => n && n(), adminOk: () => true, sleep: async () => {}, chamarBling, chamarML: async () => ({ ok: false }),
    buscarNFnoML: async () => null, buscarNFePorId, buscarNFBlindada: async () => null, resolverIdNFPorChave: async () => null, mapItensNF: () => [],
    tabelaDevolucoes: 'devolucoes_girassol', naturezaDevolucaoDaEmpresa: NAT, listarDepositos: async () => ({ ok: true, depositos: [] }), ...(depsExtra || {}) };
  const arq = path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js');
  delete require.cache[require.resolve(arq)];
  require(arq)(app, deps);
  const fetchOrig = global.fetch;
  global.fetch = async (u) => { if (falharXml) throw new Error('timeout'); return { ok: true, text: async () => xmls[u] || '' }; };
  const chamar = (rota, req) => new Promise((resolve) => {
    const res = { _s: 200, status(s) { this._s = s; return this; }, json(o) { resolve({ status: this._s, corpo: o, gravado }); } };
    handlers[rota](req, res);
  });
  return { chamar, restaurar: () => { global.fetch = fetchOrig; }, gravado };
}
const nfDev = (id, numero, cliente, valor, dia) => ({ id, numero, naturezaOperacao: { id: NAT }, contato: { nome: cliente }, valorNota: valor, dataEmissao: '2026-10-15 09:' + dia });
const reg = { id: 132, nf_chave: CH_VENDA, nf_numero: '127406', buyer_nome: 'Jonatas Ramos De Souza', produto_valor_unit: 29.9, produto_qtd: 1, created_at: '2026-10-08T10:00:00Z', status: 'aprovado' };

(async () => {
  // 1) caso real: 7 candidatas de MESMO VALOR (lixa R$ 29,90) de outros clientes + a certa, mais antiga
  { const outras = [1, 2, 3, 4, 5, 6].map((i) => nfDev('O' + i, '12940' + i, 'Cliente ' + i + ' Santos', 29.9, '1' + i));
    const certa = nfDev('CERTA', '129100', 'Jonatas Ramos De Souza', 29.9, '01');
    const detalhes = {}; const xmls = {};
    for (const n of outras) { detalhes[n.id] = Object.assign({}, n, { xml: 'x://' + n.id }); xmls['x://' + n.id] = XML(CH_OUTRA); }
    detalhes.CERTA = Object.assign({}, certa, { xml: 'x://CERTA' }); xmls['x://CERTA'] = XML(CH_VENDA);
    const m = montar({ reg: Object.assign({}, reg), paginas: [[...outras, certa]], detalhes, xmls });
    const r = await m.chamar('POST /api/admin/vincular-devolucao-existente/:id', { params: { id: '132' }, body: {} });
    m.restaurar();
    ok(r.corpo.ok && r.gravado.nf_devolucao_numero === '129100', '⚠️ entre 7 de MESMO VALOR de outros clientes, liga a que o XML prova ser desta venda (antes: a mais recente, de outro cliente)'); }
  // 2) nenhuma referencia a venda -> NAO liga (a esteira conta falha e o card fica aberto)
  { const outras = [1, 2].map((i) => nfDev('O' + i, '1295' + i, 'Jonatas Outro', 29.9, '2' + i));
    const detalhes = {}; const xmls = {};
    for (const n of outras) { detalhes[n.id] = Object.assign({}, n, { xml: 'x://' + n.id }); xmls['x://' + n.id] = XML(CH_OUTRA); }
    const m = montar({ reg: Object.assign({}, reg), paginas: [outras], detalhes, xmls });
    const r = await m.chamar('POST /api/admin/vincular-devolucao-existente/:id', { params: { id: '132' }, body: {} });
    m.restaurar();
    ok(!r.corpo.ok && r.status === 404 && !('nf_devolucao_numero' in r.gravado), '⚠️ nenhuma devolucao referencia a venda: NADA vinculado (o card nao some)'); }
  // 3) XML fora do ar -> incerto, nada ligado
  { const n = nfDev('O1', '12951', 'Jonatas Ramos De Souza', 29.9, '31');
    const m = montar({ reg: Object.assign({}, reg), paginas: [[n]], detalhes: { O1: Object.assign({}, n, { xml: 'x://O1' }) }, xmls: {}, falharXml: true });
    const r = await m.chamar('POST /api/admin/vincular-devolucao-existente/:id', { params: { id: '132' }, body: {} });
    m.restaurar();
    ok(!r.corpo.ok && r.status === 503 && !('nf_devolucao_numero' in r.gravado), '  XML indisponivel: nao deu pra conferir -> nada vinculado (tente de novo)'); }
  // 4) card sem a chave da NF de venda -> nao da pra provar
  { const m = montar({ reg: Object.assign({}, reg, { nf_chave: null }), paginas: [[]], detalhes: {}, xmls: {} });
    const r = await m.chamar('POST /api/admin/vincular-devolucao-existente/:id', { params: { id: '132' }, body: {} });
    m.restaurar();
    ok(!r.corpo.ok && r.status === 409, '  card sem a chave da NF de venda: recusa (nao adivinha)'); }
  // 5) RESGATE: card concluido com a devolucao de OUTRA venda -> mostra; com confirmar=1, desfaz e reabre
  { const regErrado = Object.assign({}, reg, { status: 'concluido', nf_devolucao_id_bling: 'O1', nf_devolucao_numero: '129356', data_concluido: '2026-10-15T09:20:00Z' });
    const det = { O1: Object.assign(nfDev('O1', '129356', 'Outro Cliente Silva', 29.9, '40'), { xml: 'x://O1' }) };
    const xmls = { 'x://O1': XML(CH_OUTRA) };
    let m = montar({ reg: Object.assign({}, regErrado), paginas: [[]], detalhes: det, xmls });
    let r = await m.chamar('GET /api/admin/reconferir-vinculo', { query: { ids: '132' } });
    m.restaurar();
    ok(r.corpo.ok && !r.corpo.aplicado && /VINCULO ERRADO/.test(r.corpo.resultados[0].resultado) && !('status' in r.gravado), '⚠️ resgate sem confirmar: so MOSTRA que o vinculo e errado (nada muda)');
    m = montar({ reg: Object.assign({}, regErrado), paginas: [[]], detalhes: det, xmls });
    r = await m.chamar('GET /api/admin/reconferir-vinculo', { query: { ids: '132', confirmar: '1' } });
    m.restaurar();
    ok(r.corpo.aplicado && /DESFEITO/.test(r.corpo.resultados[0].resultado) && r.gravado.status === 'aprovado'
       && r.gravado.nf_devolucao_id_bling === null && r.gravado.data_concluido === null, '⚠️ resgate com confirmar=1: desfaz o vinculo e REABRE o card em Aprovadas'); }
  // 6) RESGATE de vinculo CERTO: nada muda
  { const regCerto = Object.assign({}, reg, { status: 'concluido', nf_devolucao_id_bling: 'C1', nf_devolucao_numero: '129100' });
    const m = montar({ reg: regCerto, paginas: [[]], detalhes: { C1: Object.assign(nfDev('C1', '129100', 'Jonatas', 29.9, '01'), { xml: 'x://C1' }) }, xmls: { 'x://C1': XML(CH_VENDA) } });
    const r = await m.chamar('GET /api/admin/reconferir-vinculo', { query: { ids: '132', confirmar: '1' } });
    m.restaurar();
    ok(/VINCULO CERTO/.test(r.corpo.resultados[0].resultado) && !('status' in r.gravado), '  resgate de vinculo certo: confirma e nao mexe'); }
  // Codex #499 — XML invalido (pagina de erro, vazio) NUNCA desfaz vinculo
  { const regErrado = Object.assign({}, reg, { status: 'concluido', nf_devolucao_id_bling: 'O1', nf_devolucao_numero: '129356' });
    const m = montar({ reg: regErrado, paginas: [[]], detalhes: { O1: Object.assign(nfDev('O1', '129356', 'X', 29.9, '40'), { xml: 'x://O1' }) }, xmls: { 'x://O1': '<html>erro 502</html>' } });
    const r = await m.chamar('GET /api/admin/reconferir-vinculo', { query: { ids: '132', confirmar: '1' } });
    m.restaurar();
    ok(/nao deu pra conferir/.test(r.corpo.resultados[0].resultado) && !('status' in r.gravado), '⚠️ XML que nao e NF-e (pagina de erro): inconclusivo — o vinculo NAO e desfeito (Codex #499)'); }
  // Codex #499 — GOOD: a fila fica em `tipo` e o card aberto e status 'pendente'
  { const regGood = Object.assign({}, reg, { status: 'concluido', tipo: 'problema', nf_devolucao_id_bling: 'O1', nf_devolucao_numero: '129356' });
    const m = montar({ reg: regGood, paginas: [[]], detalhes: { O1: Object.assign(nfDev('O1', '129356', 'X', 29.9, '40'), { xml: 'x://O1' }) }, xmls: { 'x://O1': XML(CH_OUTRA) }, depsExtra: { triagemNoTipo: true } });
    const r = await m.chamar('GET /api/admin/reconferir-vinculo', { query: { ids: '132', confirmar: '1' } });
    m.restaurar();
    ok(r.gravado.tipo === 'problema' && r.gravado.status === 'pendente' && r.gravado.nf_devolucao_id_bling === null, '⚠️ GOOD: reabre na fila de origem (tipo problema) com status pendente — nao grava status=aprovado (Codex #499)'); }
  // Codex #499 — a certa depois da 15a (janela cheia de devolucoes do mesmo preco)
  { const outras = Array.from({ length: 22 }, (_, i) => nfDev('O' + i, String(129400 + i), 'Cliente ' + i + ' Ramos', 29.9, String(10 + (i % 40)).padStart(2, '0')));
    const certa = nfDev('CERTA', '129100', 'Jonatas Ramos De Souza', 29.9, '00');
    const detalhes = {}; const xmls = {};
    for (const n of outras) { detalhes[n.id] = Object.assign({}, n, { xml: 'x://' + n.id }); xmls['x://' + n.id] = XML(CH_OUTRA); }
    detalhes.CERTA = Object.assign({}, certa, { xml: 'x://CERTA' }); xmls['x://CERTA'] = XML(CH_VENDA);
    const m = montar({ reg: Object.assign({}, reg, { id: 501 }), paginas: [[...outras, certa]], detalhes, xmls });
    const r = await m.chamar('POST /api/admin/vincular-devolucao-existente/:id', { params: { id: '501' }, body: {} });
    m.restaurar();
    ok(r.corpo.ok && r.gravado.nf_devolucao_numero === '129100', '⚠️ a devolucao certa la depois da 15a candidata tambem e achada (Codex #499)'); }
  // Codex #499 — pagina do Bling falhou: busca INCOMPLETA (503), nunca 'nao existe' (404)
  { const m = montar({ reg: Object.assign({}, reg, { id: 502 }), paginas: [[]], detalhes: {}, xmls: {}, falharPagina: 1 });
    const r = await m.chamar('POST /api/admin/vincular-devolucao-existente/:id', { params: { id: '502' }, body: {} });
    m.restaurar();
    ok(!r.corpo.ok && r.status === 503 && /INCOMPLETA/.test(r.corpo.erro), '⚠️ lista do Bling falhou: 503 incompleta, tente de novo (nunca "nenhuma devolucao") (Codex #499)'); }
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'), 'utf8');
  ok(/const PRAZO_VINCULAR_MS = 25000;/.test(src) && /AbortSignal\.timeout\(Math\.min\(8000, restante\(\)\)\)/.test(src), '  a busca inteira tem prazo (25 s) e cada XML respeita o que sobra (Codex #499)');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
