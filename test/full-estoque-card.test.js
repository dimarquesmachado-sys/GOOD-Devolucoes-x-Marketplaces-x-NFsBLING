'use strict';
// b482 — devolucao do FULL no painel da AMB/Girassol: o card DIZ que a NF de devolucao e do
// Mercado Livre (serie 2, nao se gera outra) e oferece LANCAR NO ESTOQUE com o deposito na mao
// do dono (aprovada abre no GERAL, problema no DEFEITOS); a rota recusa lancar 2x e marca o card.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const PAINEIS = ['painel-AMB.html', 'painel2-AMB.html'];   // Codex #404: o painel2 ainda e servido
for (const nomePainel of PAINEIS) {
const html = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', nomePainel), 'utf8');
console.log('— ' + nomePainel);
function fonteDaFuncao(nome) {
  const i = html.search(new RegExp('(async\\s+)?function ' + nome + '\\s*\\('));
  if (i < 0) return null;
  let j = html.indexOf('{', i), prof = 0, k = j;
  for (; k < html.length; k++) { if (html[k] === '{') prof++; else if (html[k] === '}') { prof--; if (prof === 0) break; } }
  return html.slice(i, k + 1);
}
const ctx = {};
vm.createContext(ctx);
for (const f of ['escapeHtml', 'nomeMarketplaceFull', 'avisoFullHtml', 'botaoFullEstoque']) {
  const src = fonteDaFuncao(f);
  ok(!!src, '  funcao ' + f + ' existe no painel');
  if (src) vm.runInContext(src, ctx);
}
const base = { id: 77, nf_serie: '2', nf_devolucao_numero: '52011', marketplace: 'ml' };
const a1 = ctx.avisoFullHtml(Object.assign({}, base, { nf_devolucao_id_bling: '999' }));
ok(/NF DE DEVOLUÇÃO JÁ EMITIDA PELO MERCADO LIVRE/.test(a1) && /52011/.test(a1) && /Não gere NF/.test(a1) && /lançar no estoque/.test(a1), '⚠️ Full com a NF do ML vinculada: "SÉRIE 2 — NF DE DEVOLUÇÃO JÁ EMITIDA PELO ML (nº) · não gere NF · só lançar no estoque"');
const a2 = ctx.avisoFullHtml(Object.assign({}, base));
ok(/ainda não está no Bling/.test(a2) && /não gere NF/.test(a2) && /Toolbox importa sozinha/.test(a2), '⚠️ Full sem a NF do ML no Bling: diz que e do ML, que ainda nao chegou e que a Toolbox traz sozinha');
const as = ctx.avisoFullHtml(Object.assign({}, base, { marketplace: 'shopee', nf_devolucao_id_bling: '9' }));
ok(/EMITIDA PELO SHOPEE/.test(as) && !/MERCADO LIVRE/.test(as), '⚠️ Codex #404: Full da Shopee diz SHOPEE (o emissor sai do card, nunca "Mercado Livre" fixo)');
const ax = ctx.avisoFullHtml(Object.assign({}, base, { marketplace: '' }));
ok(/do próprio marketplace/.test(ax) && !/Mercado Livre/i.test(ax), '  marketplace desconhecido: "do proprio marketplace" (sem afirmar emissor)');
const a3 = ctx.avisoFullHtml(Object.assign({}, base, { nf_devolucao_id_bling: '999', estoque_lancado_em: '2026-10-02T17:00:00Z', estoque_deposito: 'GERAL' }));
ok(/Estoque já lançado/.test(a3) && /GERAL/.test(a3), '  ja lancado: o aviso diz onde');
const b1 = ctx.botaoFullEstoque(Object.assign({}, base, { nf_devolucao_id_bling: '999' }), false);
ok(/abrirModalFullEstoque\('77', false, '52011', this\)/.test(b1) && /Lançar no estoque/.test(b1), '⚠️ aprovada: botao "📦 Lançar no estoque" abre o modal (padrao GERAL)');
const b2 = ctx.botaoFullEstoque(Object.assign({}, base, { nf_devolucao_id_bling: '999' }), true);
ok(/abrirModalFullEstoque\('77', true,/.test(b2), '⚠️ problema: o mesmo botao, abrindo no DEFEITOS');
const bInj = ctx.botaoFullEstoque(Object.assign({}, base, { id: "7');alert(1);//", nf_devolucao_id_bling: '9' }), false);
ok(!/alert\(1\)/.test(bInj), '  id malicioso no onclick e saneado');
const bAnd = ctx.botaoFullEstoque(Object.assign({}, base, { nf_devolucao_id_bling: '9', estoque_lancado_em: '2026-10-02T17:00:00Z', estoque_deposito: 'LANCANDO abc' }), false);
ok(/onclick/.test(bAnd), '  reserva "em andamento" nao conta como lancado no botao (o servidor e quem barra)');
const b3 = ctx.botaoFullEstoque(Object.assign({}, base, { nf_devolucao_id_bling: '999', estoque_lancado_em: '2026-10-02T17:00:00Z', estoque_deposito: 'DEFEITOS' }), true);
ok(!/onclick/.test(b3) && /Estoque lançado \(DEFEITOS\)/.test(b3), '⚠️ ja lancado: SEM botao (lancar 2x dobraria o estoque)');
// modal: deposito padrao por secao e nunca um FULL
const modal = fonteDaFuncao('abrirModalFullEstoque') || '';
ok(/ehProblema \? \(idDef \|\| ''\) : \(idGer \|\| ''\)/.test(modal) && /— escolha o depósito —/.test(modal), '⚠️ Codex #404: problema SEM deposito DEFEITOS nao cai no GERAL — nada marcado, escolha consciente');
ok(/filter\(function \(d\) \{ return !\/full\/i\.test/.test(modal), '  modal: depositos de FULL do marketplace ficam fora da lista');
ok(/<select id="depFullEstoque"/.test(modal), '  modal: o dono escolhe o deposito (select)');
// o card usa os helpers nas duas secoes
const ih = fonteDaFuncao('itemHtmlAprovado') || '', ip = fonteDaFuncao('itemHtmlProblema') || '';
ok(/botaoFullEstoque\(d, false\)/.test(ih) && /avisoFullHtml\(d\)/.test(ih), '  card aprovado: aviso + botao');
ok(/botaoFullEstoque\(d, true\)/.test(ip) && /avisoFullHtml\(d\)/.test(ip), '⚠️ card de PROBLEMA tambem lanca (antes: "nao faca nada")');
}
// rota: trava de lancamento duplo e registro no card
const rota = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'), 'utf8');
const r0 = rota.indexOf("app.post('/api/admin/full-lancar-estoque/:id'");
const r1 = rota.indexOf('app.post(', r0 + 10);
const corpoRota = rota.slice(r0, r1);
ok(/\.select\('\*'\)/.test(corpoRota), '  rota: select(*) — coluna nova inexistente nao derruba a rota');
ok(/reg\.estoque_lancado_em && !forcar/.test(corpoRota) && /status\(409\)/.test(corpoRota), '  rota: ja lancado = 409 (so com forcar:true)');
ok(/\.is\('estoque_lancado_em', null\)/.test(corpoRota) && /select\('id'\)/.test(corpoRota) && corpoRota.indexOf(".is('estoque_lancado_em', null)") < corpoRota.indexOf('/lancar-estoque/'), '⚠️ Codex #404 (P1): RESERVA atomica no banco ANTES de chamar o Bling (so 1 requisicao passa)');
ok(/falta_coluna: true/.test(corpoRota) && /add column if not exists estoque_lancado_em timestamptz/.test(corpoRota), '⚠️ Codex #404 (P1): sem as colunas de rastro NAO lanca — e devolve o SQL pra criar');
ok(/estoque_lancado_em: null, estoque_deposito: null \}\)\.eq\('id', req\.params\.id\)\.eq\('estoque_deposito', marca\)/.test(corpoRota), '  Bling recusou: a reserva e devolvida (so se ainda for a minha)');
ok(/update\(\{ estoque_lancado_em: new Date\(\)\.toISOString\(\), estoque_deposito: depNome \}\)/.test(corpoRota), '⚠️ rota: depois do Bling aceitar, marca o card (quando e onde)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
