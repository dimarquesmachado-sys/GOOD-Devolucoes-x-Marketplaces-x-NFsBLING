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

// ── ⚠️ a tela VOLTA nos placeholders que faltam ─────────────────────
//
// [stated 13/09] "algumas ainda sem aparecer" — depois de consertado o
// índice, o teto de 12 e a rota.
//
// ⚠️ Diagnóstico do Codex, e ele achou o que me faltava: a tela pedia a
// foto UMA VEZ. Se o índice ainda não tinha aquele produto, a rota avisava
// o worker — mas a resposta VAZIA ficava no card PARA SEMPRE. A foto
// chegava 2s depois e ninguém voltava para buscar.
{
  ok(/var MAX_RODADAS = 12;/.test(front),
     '⚠️ a tela faz RODADAS (nao uma consulta so por card)');
  ok(/for \(var rodada = 0; rodada < MAX_RODADAS; rodada\+\+\)/.test(front),
     '  voltando nos placeholders que faltam');
  ok(/if \(!faltando \|\| rodada === MAX_RODADAS - 1\) break;/.test(front),
     '  ⚠️ e PARA quando todos tem foto ou as tentativas acabam');
}

// ── e todos os cards usam o caminho seguro ──────────────────────────
{
  ok(/encodeURIComponent\(cx\.dataset\.sku\)\s*\n?\s*\+ '\?semBling=1'/.test(front)
     || /\+ '\?semBling=1'/.test(front),
     'todos os cards pedem com `semBling`');
  ok(!/TETO_BLING/.test(front),
     '  ⚠️ e nao ha mais orcamento especial pros 12 primeiros');
}

// ── ⚠️ e o semBling PRIORIZA o worker antes de responder ────────────
//
// Sem isto a rota respondia vazio e NINGUÉM produzia a foto: a tela voltaria
// em rodadas e receberia vazio para sempre.
//
// 📌 Isto não abre chamada ao Bling — só muda a ORDEM da fila do worker, que
// percorreria o catálogo de qualquer jeito.
{
  const rota = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'rotas-admin-nf.js'), 'utf8');
  const iSem = rota.indexOf('if (req.query.semBling)');
  const iAnota = rota.indexOf('deps.anotarFotoPedida(chave)', iSem);
  const iResp = rota.indexOf("via: 'sem_indice_sem_bling'", iSem);
  ok(iSem >= 0, 'a rota trata o `semBling`');
  ok(iAnota > iSem && iAnota < iResp,
     '⚠️ e PRIORIZA o worker ANTES de responder (senao ninguem produz a foto)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
