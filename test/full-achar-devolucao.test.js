'use strict';
// b485 — o "Achar devolucao no Bling" do FULL (AMB/Girassol e GOOD) RODANDO com Bling e banco
// falsos. Caso real (02/10, Marcos Vieira Lima / PM1): a NF 49304 (devolucao do ML, serie 2)
// ESTAVA no Bling e o Achar disse "nenhuma serie 2" — pagina que falhava encerrava em silencio e
// so as 6 candidatas mais recentes eram conferidas (nome comum empurrava a certa pra fora).
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const CH_VENDA = '35260727548456000147550020000492861144343275';
const chave = (serie, n) => '3526082754845600014755' + String(serie).padStart(3, '0') + String(n).padStart(9, '0') + '1158076413';
function cenario(arq, { paginas, detalhes, falharPagina, falharDetalhe }) {
  const handlers = {};
  const app = { get: (p, ...f) => { handlers['GET ' + p] = f[f.length - 1]; }, post: (p, ...f) => { handlers['POST ' + p] = f[f.length - 1]; }, put() {}, delete() {}, patch() {}, use() {} };
  const reg = { id: 7, nf_chave: CH_VENDA, nf_serie: '2', nf_data_emissao: '2026-07-27T19:52:40-03:00', buyer_nome: 'Marcos Vieira Lima', produto_valor_unit: 897.9, produto_qtd: 1, produto_sku: 'PM1' };
  const gravado = {};
  const sb = { from: () => {
    const q = { _upd: null,
      select() { return q; }, eq() { return q; }, is() { return q; },
      single: async () => ({ data: reg, error: null }),
      update(o) { q._upd = o; Object.assign(gravado, o); return { eq: async () => ({ error: null }), then: undefined }; } };
    return q; }, storage: { from: () => ({}) } };
  const chamarBling = async (url) => {
    const m = /pagina=(\d+)/.exec(url); const pg = m ? Number(m[1]) : 1;
    if (falharPagina && pg === falharPagina) return { ok: false, status: 429 };
    return { ok: true, data: { data: paginas[pg - 1] || [] } };
  };
  const buscarNFePorId = async (id) => (falharDetalhe ? { ok: false, status: 503 } : (detalhes[id] ? { ok: true, data: { data: detalhes[id] } } : { ok: false, status: 404 }));
  const deps = { supabase: sb, requerAdmin: (q, r, n) => n && n(), adminOk: () => true, sleep: async () => {}, chamarBling, chamarML: async () => ({ ok: false }), buscarNFnoML: async () => null,
    buscarNFePorId, buscarNFBlindada: async () => null, resolverIdNFPorChave: async () => null, mapItensNF: () => [], tabelaDevolucoes: 'devolucoes_girassol',
    listarDepositos: async () => ({ ok: true, depositos: [] }) };
  delete require.cache[require.resolve(arq)];
  require(arq)(app, deps);
  return async () => new Promise((resolve) => {
    const res = { _s: 200, status(s) { this._s = s; return this; }, json(o) { resolve({ status: this._s, corpo: o, gravado }); } };
    handlers['POST /api/admin/full-vincular/:id']({ params: { id: '7' }, body: {} }, res);
  });
}
const lista = (n, o = {}) => Object.assign({ id: 'L' + n, numero: String(n), dataEmissao: '2026-09-' + String(10 + (n % 15)).padStart(2, '0'), contato: { nome: 'Fulano Lima' }, valorNota: 120 }, o);
const certa = { id: 'C49304', numero: '49304', serie: '2', chaveAcesso: chave(2, 49304), dataEmissao: '2026-08-25', contato: { nome: 'Marcos Vieira Lima' }, valorNota: 897.9, itens: [{ codigo: 'PM1' }] };
(async () => {
  for (const arq of [path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'), path.join(__dirname, '..', 'lib', 'rotas-admin-nf.js')]) {
    console.log('— ' + path.basename(arq));
    // 1) a certa e a 10a por data, atras de 9 "Lima" mais recentes de SERIE 1 (a chave da lista revela) — tem que achar
    const mais9 = Array.from({ length: 9 }, (_, i) => lista(i + 1, { chaveAcesso: chave(1, 100 + i) }));
    const detalhes = { C49304: certa };
    mais9.forEach((x) => { detalhes[x.id] = Object.assign({}, x, { serie: '1' }); });
    let r = await cenario(arq, { paginas: [mais9.concat([{ id: 'C49304', numero: '49304', dataEmissao: '2026-08-25', contato: { nome: 'Marcos Vieira Lima' }, valorNota: 897.9, chaveAcesso: chave(2, 49304) }])], detalhes })();
    ok(r.status === 200 && r.corpo.ok && r.corpo.nf_devolucao_numero === '49304', '⚠️ o caso do Marcos: a 49304 e achada mesmo com 9 "Lima" mais recentes na frente (status ' + r.status + ')');
    // 2) sem chave na lista: 8 so-nome mais recentes + a certa com VALOR — a forca do sinal poe a certa na frente
    const so8 = Array.from({ length: 8 }, (_, i) => lista(i + 20));
    const det2 = { C49304: certa }; so8.forEach((x) => { det2[x.id] = Object.assign({}, x, { serie: '1', chaveAcesso: chave(1, 200 + x.numero) }); });
    r = await cenario(arq, { paginas: [so8.concat([{ id: 'C49304', numero: '49304', dataEmissao: '2026-08-25', contato: { nome: 'Marcos Vieira Lima' }, valorNota: 897.9 }])], detalhes: det2 })();
    ok(r.status === 200 && r.corpo.nf_devolucao_numero === '49304', '⚠️ sem a chave na lista: valor + nome completo passam na frente dos "so Lima" e a certa e conferida');
    // 3) pagina 2 falha (429 sempre) e a certa estaria nela — NAO pode dizer "nao existe"
    const cheia = Array.from({ length: 100 }, (_, i) => lista(i + 300, { contato: { nome: 'Outro Nome' }, valorNota: 10, chaveAcesso: chave(1, 300 + i) }));
    r = await cenario(arq, { paginas: [cheia, [certa]], detalhes: { C49304: certa }, falharPagina: 2 })();
    ok(r.status === 503 && r.corpo.incompleto === true && /INCOMPLETA/.test(r.corpo.erro) && /NAO quer dizer que a NF nao existe/.test(r.corpo.erro), '⚠️ pagina que o Bling nao responde: "busca INCOMPLETA — tente de novo", nunca "nenhuma serie 2"');
    // 4) o detalhe das candidatas nao vem: nao verificada = incompleta
    r = await cenario(arq, { paginas: [[{ id: 'C49304', numero: '49304', dataEmissao: '2026-08-25', contato: { nome: 'Marcos Vieira Lima' }, valorNota: 897.9 }]], detalhes: {}, falharDetalhe: true })();
    ok(r.status === 503 && r.corpo.incompleto === true, '  detalhe que nao veio: incompleta (503), nao "nao existe"');
    // 6) Codex #406 (P1): MESMO SKU + pedaco de nome, valor diferente e sem XML = NAO e prova da transacao
    const alheia = { id: 'X1', numero: '50999', serie: '2', chaveAcesso: chave(2, 50999), dataEmissao: '2026-09-02', contato: { nome: 'Maria Lima' }, valorNota: 450, itens: [{ codigo: 'PM1' }] };
    r = await cenario(arq, { paginas: [[{ id: 'X1', numero: '50999', dataEmissao: '2026-09-02', contato: { nome: 'Maria Lima' }, valorNota: 450, chaveAcesso: chave(2, 50999) }]], detalhes: { X1: alheia } })();
    ok(r.status === 404 && !r.gravado.nf_devolucao_id_bling, '⚠️ Codex #406 (P1): mesmo SKU + "Lima", valor diferente e sem XML: NAO vincula nota de outro cliente');
    // 7) Codex #406 (P2): a certa SEM chave na lista nao some atras de 16 com chave da mesma serie
    const comChave = Array.from({ length: 16 }, (_, i) => lista(i + 500, { contato: { nome: 'Joana Lima' }, valorNota: 77, chaveAcesso: chave(2, 900 + i) }));
    const det7 = { C49304: certa }; comChave.forEach((x) => { det7[x.id] = Object.assign({}, x, { serie: '2', itens: [] }); });
    r = await cenario(arq, { paginas: [comChave.concat([{ id: 'C49304', numero: '49304', dataEmissao: '2026-08-25', contato: { nome: 'Marcos Vieira Lima' }, valorNota: 897.9 }])], detalhes: det7 })();
    ok(r.status === 200 && r.corpo.nf_devolucao_numero === '49304', '⚠️ Codex #406 (P2): a certa sem chave na lista e conferida mesmo com 16 da mesma serie na frente');
    // 5) varreu tudo e de fato nao tem serie 2: ai sim 404
    r = await cenario(arq, { paginas: [mais9], detalhes: Object.fromEntries(mais9.map((x) => [x.id, Object.assign({}, x, { serie: '1' })])) })();
    ok(r.status === 404 && /Nenhuma NF de entrada serie 2/.test(r.corpo.erro), '  varredura completa sem serie 2: 404 de verdade');
  }
  const fs = require('fs');
  for (const arq of ['amb-devolucoes/lib-AMB/rotas-admin-AMB.js', 'lib/rotas-admin-nf.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
    const ini = src.indexOf("app.post('/api/admin/full-vincular/:id'"), fim = src.indexOf('app.post(', ini + 20);
    const rota = src.slice(ini, fim);
    ok(/fetch\(nf\.xml, \{ signal: [^}]*AbortSignal\.timeout\(8000\)/.test(rota), '  Codex #406 (P2): o XML da candidata tem PRAZO (' + path.basename(arq) + ')');
    ok(!/for \(let t = 1; !r\.ok && t <= 2; t\+\+\)/.test(rota), '  Codex #406 (P2): sem retentativa na rota por cima da do cliente (' + path.basename(arq) + ')');
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
