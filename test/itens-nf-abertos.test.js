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
  // b477 (Codex): `[]` tambem e "sem itens"
  ok(/\.eq\('nf_id_bling', String\(idBling\)\)\.or\('nf_itens\.is\.null,nf_itens\.eq\.\[\]'\)/.test(rota),
     `  ${nome}: so nos cards dessa NF sem itens — null OU [] (nao sobrescreve o enriquecimento)`);
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
  ok(/async function autoCarregarItensNF\(\)/.test(s) && /await verItensNF\(id, els\[0\], true\);/.test(s) && /await new Promise\(\(ok\) => setTimeout\(ok, 400\)\)/.test(s),
     `  ${nome}: auto-carrega EM SERIE (um por vez, com respiro) — nao dispara 30 chamadas juntas`);
  // b478 (Codex): a mesma NF em varios cards = UMA chamada; os irmaos copiam a caixa
  ok(/const grupos = new Map\(\);/.test(s) && /grupos\.get\(m\[1\]\)\.push\(el\)/.test(s) && /b\.innerHTML = caixa\.innerHTML;/.test(s),
     `⚠️ ${nome}: agrupa por id da NF — 1 chamada ao Bling por NF, os outros cards da mesma NF copiam a caixa`);
  // b477 (Codex, P2 x3): re-render no meio nao perde os links novos; 503 repesca; sem link cravado
  ok(/if \(AUTO_ITENS_RODANDO\) \{ AUTO_ITENS_PENDENTE = true; return; \}/.test(s) && /if \(AUTO_ITENS_PENDENTE\) \{ AUTO_ITENS_PENDENTE = false; setTimeout\(autoCarregarItensNF, 300\); \}/.test(s),
     `  ${nome}: renderizar() no meio de um lote marca pendente e roda de novo no fim (nao perde os links novos)`);
  ok(/if \(auto && e\.status === 503\) return 'retry';/.test(s) && /if \(r === 'retry'\) repescar\.push/.test(s) && /setTimeout\(ok, 30000\)/.test(s),
     `  ${nome}: 503 (Bling em 429) entra na repescagem de 30s — nao desiste do card`);
  // ⚠️ P1: problema/divergente usam renderItensCard(d) — com nf_itens gravado vem INLINE e o auto nao busca
  ok(!/\$\{d\.nf_id_bling \? `[^`]*verItensNF\('\$\{d\.nf_id_bling\}', this\)/.test(s),
     `⚠️ ${nome}: nenhum link verItensNF cravado em problema/divergente (ia buscar no Bling mesmo com itens gravados)`);
  ok((s.match(/\$\{renderItensCard\(d\)\}/g) || []).length >= 3,
     `  ${nome}: problema e divergente usam renderItensCard(d), como o aprovado (inline se tem itens)`);
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

// b478 (Codex): o autoCarregarItens do painel antigo tambem busca em FUNDO (?auto=1)
{
  const s = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes/public-AMB/painel-AMB.html'), 'utf8');
  const i = s.indexOf('async function autoCarregarItens()');
  const f = s.indexOf('function tentarItensDeNovo', i);
  ok(i >= 0 && f > i && /nf-itens\/\$\{idBling\}\?auto=1`/.test(s.slice(i, f)),
     '⚠️ painel-AMB: autoCarregarItens (caixas b67) manda ?auto=1 — fundo na fila do Bling, nao compete com o bipe');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
