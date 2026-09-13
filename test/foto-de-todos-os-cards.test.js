'use strict';
// ⚠️ [stated 13/09] "ainda sem imagens" — ~70% dos cards no placeholder,
// depois de HORAS investigando índice, rota e Bling.
//
// A CAUSA era o laço da própria tela: `i < 12`. A lista tem 46 peças, então
// **34 cards nunca chamavam a rota** — ficavam no placeholder para sempre.
//
// 📌 E foi o que me enganou o dia todo: os primeiros cards tinham foto (já
// estavam no cache do servidor), então parecia que a busca funcionava e o
// problema era o índice ou o Bling. Eu media o índice, media a rota — os dois
// certos — e não olhava o laço da tela.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const front = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'defeitos-ficha.js'), 'utf8');

// ── o teto cobre a lista real ───────────────────────────────────────
{
  const m = /var TETO_FOTOS = (\d+);/.exec(front);
  ok(!!m, 'o teto de fotos e uma constante nomeada (nao numero solto)');
  if (m) {
    const teto = Number(m[1]);
    ok(teto >= 46,
       `⚠️ o teto (${teto}) cobre a lista real do galpao (46 pecas hoje)`);
  }
  ok(!/i < itens\.length && i < 12/.test(front),
     '  e o teto de 12 saiu');
}

// ── ⚠️ e a pausa não faz a tela parecer travada ─────────────────────
//
// A pausa existia porque cada foto ia ao BLING. Agora a rota resolve pelo
// índice local, que não gasta cota.
{
  const m = /setTimeout\(r, (\d+)\); \}\);/.exec(front);
  ok(!!m, 'ha pausa entre os pedidos de foto');
  if (m) {
    const pausa = Number(m[1]);
    const teto = Number((/var TETO_FOTOS = (\d+);/.exec(front) || [])[1] || 60);
    const segundos = (teto * pausa) / 1000;
    ok(segundos <= 4,
       `  ⚠️ e pintar o teto inteiro leva ${segundos.toFixed(1)}s (tem que ser <= 4s)`);
  }
}

// ── e o card e a busca usam o MESMO índice ──────────────────────────
//
// ⚠️ Se divergirem, a foto vai pro card errado — e isso não aparece como
// erro, aparece como foto trocada.
{
  ok(/id="fotodef-' \+ i \+ '"/.test(front),
     'o card monta o id com o indice do map');
  ok(/getElementById\('fotodef-' \+ i\)/.test(front),
     '  e a busca procura pelo mesmo indice');
}

// ── ⚠️ e o orçamento de Bling não cresce com o teto ─────────────────
//
// Apontamento do Codex (P1): com o índice quente, os 60 pedidos são 60
// respostas locais e ZERO chamada ao Bling. Mas com o índice FRIO, cada um
// vira até 4 chamadas — e 60 de uma vez é a avalanche que já derrubou o
// serviço.
//
// 📌 A solução do robô é melhor que a minha (que era PARAR): os primeiros
// 12 mantêm o orçamento de Bling que sempre tiveram, e do 13º em diante o
// pedido vai com `semBling=1` — pede a foto, mas aceita ficar sem se o
// índice não tiver. Assim as 46 são pedidas E a cota fica protegida.
{
  ok(/semBling/.test(front),
     '⚠️ os cards alem do orcamento pedem com `semBling`');

  const rota = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'rotas-admin-nf.js'), 'utf8');
  ok(/req\.query\.semBling/.test(rota),
     '  e a ROTA respeita o parametro (os 2 lados, nao so o front)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
