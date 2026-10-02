'use strict';
// b482 — devolucao do FULL no painel da AMB/Girassol: o card DIZ que a NF de devolucao e do
// Mercado Livre (serie 2, nao se gera outra) e oferece LANCAR NO ESTOQUE com o deposito na mao
// do dono (aprovada abre no GERAL, problema no DEFEITOS); a rota recusa lancar 2x e marca o card.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const html = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
function fonteDaFuncao(nome) {
  const i = html.search(new RegExp('(async\\s+)?function ' + nome + '\\s*\\('));
  if (i < 0) return null;
  let j = html.indexOf('{', i), prof = 0, k = j;
  for (; k < html.length; k++) { if (html[k] === '{') prof++; else if (html[k] === '}') { prof--; if (prof === 0) break; } }
  return html.slice(i, k + 1);
}
const ctx = {};
vm.createContext(ctx);
for (const f of ['escapeHtml', 'jsArg', 'avisoFullHtml', 'botaoFullEstoque']) {
  const src = fonteDaFuncao(f);
  ok(!!src, '  funcao ' + f + ' existe no painel');
  if (src) vm.runInContext(src, ctx);
}
const base = { id: 77, nf_serie: '2', nf_devolucao_numero: '52011' };
const a1 = ctx.avisoFullHtml(Object.assign({}, base, { nf_devolucao_id_bling: '999' }));
ok(/NF DE DEVOLUÇÃO JÁ EMITIDA PELO MERCADO LIVRE/.test(a1) && /52011/.test(a1) && /Não gere NF/.test(a1) && /lançar no estoque/.test(a1), '⚠️ Full com a NF do ML vinculada: "SÉRIE 2 — NF DE DEVOLUÇÃO JÁ EMITIDA PELO ML (nº) · não gere NF · só lançar no estoque"');
const a2 = ctx.avisoFullHtml(Object.assign({}, base));
ok(/ainda não está no Bling/.test(a2) && /não gere NF/.test(a2) && /Toolbox importa sozinha/.test(a2), '⚠️ Full sem a NF do ML no Bling: diz que e do ML, que ainda nao chegou e que a Toolbox traz sozinha');
const a3 = ctx.avisoFullHtml(Object.assign({}, base, { nf_devolucao_id_bling: '999', estoque_lancado_em: '2026-10-02T17:00:00Z', estoque_deposito: 'GERAL' }));
ok(/Estoque já lançado/.test(a3) && /GERAL/.test(a3), '  ja lancado: o aviso diz onde');
const b1 = ctx.botaoFullEstoque(Object.assign({}, base, { nf_devolucao_id_bling: '999' }), false);
ok(/abrirModalFullEstoque\('77', false, '52011', this\)/.test(b1) && /Lançar no estoque/.test(b1), '⚠️ aprovada: botao "📦 Lançar no estoque" abre o modal (padrao GERAL)');
const b2 = ctx.botaoFullEstoque(Object.assign({}, base, { nf_devolucao_id_bling: '999' }), true);
ok(/abrirModalFullEstoque\('77', true,/.test(b2), '⚠️ problema: o mesmo botao, abrindo no DEFEITOS');
const b3 = ctx.botaoFullEstoque(Object.assign({}, base, { nf_devolucao_id_bling: '999', estoque_lancado_em: '2026-10-02T17:00:00Z', estoque_deposito: 'DEFEITOS' }), true);
ok(!/onclick/.test(b3) && /Estoque lançado \(DEFEITOS\)/.test(b3), '⚠️ ja lancado: SEM botao (lancar 2x dobraria o estoque)');
// modal: deposito padrao por secao e nunca um FULL
const modal = fonteDaFuncao('abrirModalFullEstoque') || '';
ok(/ehProblema \? \(idDef \|\| idGer\) : \(idGer \|\| idDef\)/.test(modal), '  modal: problema abre no DEFEITOS, aprovada no GERAL');
ok(/filter\(function \(d\) \{ return !\/full\/i\.test/.test(modal), '  modal: depositos de FULL do marketplace ficam fora da lista');
ok(/<select id="depFullEstoque"/.test(modal), '  modal: o dono escolhe o deposito (select)');
// o card usa os helpers nas duas secoes
const ih = fonteDaFuncao('itemHtmlAprovado') || '', ip = fonteDaFuncao('itemHtmlProblema') || '';
ok(/botaoFullEstoque\(d, false\)/.test(ih) && /avisoFullHtml\(d\)/.test(ih), '  card aprovado: aviso + botao');
ok(/botaoFullEstoque\(d, true\)/.test(ip) && /avisoFullHtml\(d\)/.test(ip), '⚠️ card de PROBLEMA tambem lanca (antes: "nao faca nada")');
// rota: trava de lancamento duplo e registro no card
const rota = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'), 'utf8');
const r0 = rota.indexOf("app.post('/api/admin/full-lancar-estoque/:id'");
const r1 = rota.indexOf('app.post(', r0 + 10);
const corpoRota = rota.slice(r0, r1);
ok(/\.select\('\*'\)/.test(corpoRota), '  rota: select(*) — coluna nova inexistente nao derruba a rota');
ok(/reg\.estoque_lancado_em && !\(req\.body && req\.body\.forcar === true\)/.test(corpoRota) && /status\(409\)/.test(corpoRota), '⚠️ rota: ja lancado = 409 (so com forcar:true)');
ok(/update\(\{ estoque_lancado_em: new Date\(\)\.toISOString\(\), estoque_deposito: depNome \}\)/.test(corpoRota), '⚠️ rota: depois do Bling aceitar, marca o card (quando e onde)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
