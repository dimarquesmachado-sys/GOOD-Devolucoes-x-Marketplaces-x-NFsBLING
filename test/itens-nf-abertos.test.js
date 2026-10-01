'use strict';
// ⚠️ ITENS DA NF ABERTOS SEM CLICAR — e GRAVADOS no card quando buscados.
//
// Pedido do dono (01/10): "altera pra sempre os produtos aparecerem
// explodidos". O card ja vinha inline quando tinha `nf_itens` gravado; quando
// so tinha o id da NF (o enriquecimento pos-triagem falhou por 429) ficava o
// link "itens da NF" esperando clique. O painel-AMB (antigo) carregava sozinho
// desde o b67 — o painel2 (o que ele usa) e a GOOD, nao. Divergencia entre
// paineis, de novo.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const semCom = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── os 2 backends: fundo quando auto, e GRAVAM nf_itens no card ──
for (const [p, nome, tabela] of [['amb-devolucoes/lib-AMB/rotas-admin-AMB.js', 'AMB/Girassol', 'tabelaDevolucoes'], ['lib/rotas-admin-nf.js', 'GOOD', "'devolucoes'"]]) {
  const s = semCom(p);
  const i = s.indexOf("app.get('/api/admin/nf-itens/:idBling'");
  const rota = s.slice(i, i + 2500);
  ok(/const auto = String\(req\.query\.auto \|\| ''\) === '1';/.test(rota) && /buscarNFePorId\(idBling, \{ fundo: auto \}\)/.test(rota),
     `⚠️ ${nome}: vindo do auto-carregar (?auto=1) e FUNDO na fila do Bling (nao compete com o bipe)`);
  ok(new RegExp("\\.from\\(" + tabela.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\)\\.update\\(\\{ nf_itens: itens \\}\\)").test(rota),
     `⚠️ ${nome}: GRAVA nf_itens no card (proxima abertura vem inline, sem Bling)`);
  ok(/\.eq\('nf_id_bling', String\(idBling\)\)\.is\('nf_itens', null\)/.test(rota),
     `  ${nome}: so nos cards dessa NF que ainda NAO tem nf_itens (nao sobrescreve o enriquecimento)`);
  ok(/r\.status === 429 \? 503/.test(rota), `  ${nome}: 429 do Bling vira 503 "tente de novo", nao 404 "nao encontrada" (nao sei != nao existe)`);
  ok(/\.catch\(\(e\) => console\.warn/.test(rota) && !/await supabase\.from/.test(rota.slice(rota.indexOf('update({ nf_itens'))),
     `  ${nome}: a gravacao nao bloqueia a resposta e nao derruba a rota se falhar`);
}

// ── os 3 paineis: verItensNF(auto) + auto-carregar em serie depois do render ──
for (const p of ['amb-devolucoes/public-AMB/painel2-AMB.html', 'amb-devolucoes/public-AMB/painel-AMB.html', 'public/painel-devolucoes.html']) {
  const s = fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const nome = p.split('/').pop();
  ok(/async function verItensNF\(idBling, el, auto\)/.test(s), `⚠️ ${nome}: verItensNF aceita o modo auto`);
  ok(/\/api\/admin\/nf-itens\/\$\{idBling\}\$\{auto \? '\?auto=1' : ''\}/.test(s), `  ${nome}: manda ?auto=1 no modo auto`);
  ok(/async function autoCarregarItensNF\(\)/.test(s) && /await verItensNF\(m\[1\], el, true\);/.test(s) && /await new Promise\(\(ok\) => setTimeout\(ok, 400\)\)/.test(s),
     `  ${nome}: auto-carrega EM SERIE (um por vez, com respiro) — nao dispara 30 chamadas juntas`);
  ok(/if \(AUTO_ITENS_RODANDO\) return;/.test(s), `  ${nome}: nao roda 2 em paralelo (re-render no meio)`);
  // pendurado no FIM do renderizar(), fora de qualquer if interno
  const r0 = s.indexOf('    function renderizar() {');
  const r1 = s.indexOf('\n    }\n', r0);
  const corpo = s.slice(r0, r1);
  ok(/setTimeout\(autoCarregarItensNF, 300\);/.test(corpo) && corpo.lastIndexOf('setTimeout(autoCarregarItensNF') > corpo.lastIndexOf("getElementById('listaDivergentes')"),
     `  ${nome}: dispara no fim do renderizar (depois dos divergentes)`);
  ok(/if \(auto\) console\.warn\('\[itens NF\] auto: '/.test(s), `  ${nome}: no auto, erro vai pro console — nao enche a tela de toast`);
}
// o painel-AMB mantem o auto-carregar das caixas (b67) — os dois convivem
ok(/autoCarregarItens\(\);\s*\/\/ b67/.test(fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes/public-AMB/painel-AMB.html'), 'utf8')),
   '  painel-AMB: o auto das caixas (b67, aprovados) continua; o novo cobre os links (problemas/divergentes)');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
