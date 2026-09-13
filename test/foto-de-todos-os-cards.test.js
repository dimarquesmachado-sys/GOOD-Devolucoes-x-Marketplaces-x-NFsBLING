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

// ── ⚠️ e as rodadas PARAM se a tela fechar ──────────────────────────
//
// Apontamento do Codex (P2): são 12 rodadas × até 60 cards. Se o dono
// fechar o modal ou fizer outra busca no meio, isto continuaria pedindo
// foto de uma lista que não está mais na tela — e pior, podendo pintar foto
// em card de OUTRA busca.
{
  ok(/var _fotoToken = 0;/.test(front), '⚠️ cada varredura de fotos tem um numero');
  const quantos = (front.match(/if \(meuToken !== _fotoToken\) return;/g) || []).length;
  ok(quantos >= 2,
     '  ⚠️ e desiste NA RODADA e DENTRO dela (achei ' + quantos + ')');
  ok(/cxCaixa\.style\.display === 'none'\) return;/.test(front),
     '  ⚠️ ou se a caixa foi fechada');
}

// ── ⚠️ e não insiste em quem nunca vai ter foto ─────────────────────
//
// Apontamento do Codex (P2): a variação cujo `produtoPai` não está no
// índice não ganha foto por nenhum caminho do `semBling` — o worker busca o
// detalhe DELA, e a variação não tem imagem própria.
//
// Sem isto, ela gastava as 12 rodadas e atrasava as outras.
{
  const rota = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'rotas-admin-nf.js'), 'utf8');
  ok(/definitivo: !!\(typeof deps\.indiceTemProduto/.test(rota),
     '⚠️ a rota marca quando nao adianta insistir');
  ok(/if \(d && d\.definitivo && cx && cx\.dataset\) cx\.dataset\.sku = '-';/.test(front),
     '  e a tela pula esse card nas proximas rodadas');

  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok(/if \(!it \|\| !it\.eansCarregados \|\| it\.imagem\) return false;/.test(srv),
     '  ⚠️ e so e definitivo se o detalhe JA foi buscado (senao a foto pode chegar)');

  // ⚠️ e a MESMA precedencia do `fotoDoIndice`: SKU primeiro, id depois.
  // Num `find` unico, um id que coincide com o SKU de outro produto pode
  // casar antes — e as duas funcoes olhariam produtos DIFERENTES.
  const iTem = srv.indexOf('indiceTemProduto: (chave) => {');
  const blocoTem = srv.slice(iTem, srv.indexOf('fotoDoIndice:', iTem));
  ok(/=== alvo\)\s*\n?\s*\|\| IDX_PROD\.itens\.find/.test(blocoTem),
     '⚠️ e usa a MESMA precedencia do fotoDoIndice (SKU, depois id)');

  // ⚠️ revisao Codex #279 (3a rodada, P2): "pai fora do indice" (variacao
  // orfa, permanente) NAO pode ser tratado igual a "pai ainda nao
  // enriquecido" (temporario) — so o 2o caso deve esperar. O `pai &&` na
  // frente do `!pai.eansCarregados` e o que faz essa distincao; sem ele
  // (`!pai || !pai.eansCarregados`), a variacao orfa nunca fica definitiva
  // e volta a gastar as 12 rodadas.
  ok(/if \(pai && !pai\.eansCarregados\) return false;/.test(blocoTem),
     '⚠️ so espera o pai se ele EXISTE no indice e falta enriquecer'
     + ' (pai ausente e permanente, nao espera)');
  ok(!/if \(!pai \|\| !pai\.eansCarregados\) return false;/.test(blocoTem),
     '  e nao trata "pai ausente" igual a "pai pendente" (isso reintroduz a orfa gastando as 12 rodadas)');

  // ── revisao Codex #279 (3a rodada, P2): "pai fora do indice" e
  // PERMANENTE (IDX_PROD.itens e uma lista fechada, montada uma vez por
  // deploy), mas "pai ainda nao enriquecido" e TEMPORARIO (o worker ainda
  // vai chegar nele). Tratar os dois igual — como uma versao anterior deste
  // mesmo PR fez — faz a variacao orfa (ORFAO-VAR) voltar a gastar as 12
  // rodadas, o bug que este campo foi criado pra resolver.
  //
  // Comportamento de verdade: a mesma logica, isolada (padrao do
  // test/foto-vem-do-indice.test.js).
  {
    const IDX = { ts: Date.now(), itens: [
      { id: '555', sku: '288-VAR', imagem: null, pai: '556', eansCarregados: true },
      { id: '556', sku: '288', imagem: null, eansCarregados: false },   // pai NO indice, so falta o worker
      { id: '777', sku: 'ORFAO-VAR', imagem: null, pai: '999', eansCarregados: true },   // pai NUNCA vai aparecer
      { id: '888', sku: 'PAI-SEM-FOTO-VAR', imagem: null, pai: '890', eansCarregados: true },
      { id: '890', sku: 'PAI-SEM-FOTO', imagem: null, eansCarregados: true },   // pai ja buscado, sem foto
      { id: '9001', sku: 'SKU-DO-OUTRO', imagem: null, eansCarregados: true },
      { id: '9002', sku: '9001', imagem: null, eansCarregados: false },
    ] };
    const indiceTemProduto = (chave) => {
      if (!IDX.ts || !Array.isArray(IDX.itens)) return false;
      const bruto = String(chave || '').trim();
      if (!bruto) return false;
      const alvo = bruto.toUpperCase();
      const it = IDX.itens.find((x) => String(x.sku || '').toUpperCase() === alvo)
        || IDX.itens.find((x) => String(x.id || '') === bruto);
      if (!it || !it.eansCarregados || it.imagem) return false;
      if (it.pai) {
        const pai = IDX.itens.find((x) => String(x.id || '') === String(it.pai));
        if (pai && !pai.eansCarregados) return false;
        if (pai && pai.imagem) return false;
      }
      return true;
    };
    ok(indiceTemProduto('288-VAR') === false,
       '⚠️ pai NO indice mas ainda nao enriquecido: espera (a foto pode chegar)');
    ok(indiceTemProduto('ORFAO-VAR') === true,
       '⚠️ pai FORA do indice (permanente): continua definitivo, nao gasta as 12 rodadas');
    ok(indiceTemProduto('PAI-SEM-FOTO-VAR') === true,
       '  pai ja buscado e sem foto: definitivo tambem');
    ok(indiceTemProduto('9001') === false,
       '⚠️ SKU tem prioridade sobre ID: "9001" e SKU (ainda sem detalhe) de um produto'
       + ' e ID de outro (ja definitivo) que vem ANTES no catalogo - acha pelo SKU');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
