// Roda com: node test/drenagem-varredura.test.js
//
// As 4 correções do Codex no #203. Todas eram a mesma classe: eu tratei
// "parar a varredura" como uma linha, e é um contrato.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

const MODULOS = [
  ['lib/nf-nomes.js', 'GOOD nf-nomes'],
  ['lib/ml-returns.js', 'GOOD ml-returns'],
  ['amb-devolucoes/lib-AMB/nf-nomes-AMB.js', 'AMB nf-nomes'],
  ['amb-devolucoes/lib-AMB/ml-returns-AMB.js', 'AMB ml-returns'],
];

// ── ⚠️ P1: os QUATRO módulos, não só os da GOOD ─────────────────────
//
// Eu escrevi "conferi a AMB antes de subir" no commit e conferi só o
// nf-nomes-AMB — o ml-returns-AMB ficou de fora, com até 60 páginas e 900
// chamadas por claim.
{
  for (const [arq, nome] of MODULOS) {
    ok(/drenagem\.estaDrenando\(\)/.test(ler(arq)),
       nome + ': para na drenagem');
  }
}

// ── ⚠️ P1: a fase 2 do ML também para ───────────────────────────────
//
// O break da paginação saía só do laço INTERNO. Depois dele, a função
// chamava /returns para cada claim já coletado — uma página coletada virava
// ~30 chamadas DEPOIS da drenagem começar.
{
  for (const [arq, nome] of MODULOS.filter(([a]) => a.includes('ml-returns'))) {
    const src = ler(arq);
    const iFase2 = src.indexOf('for (let i = 0; i < claims.length; i += 3) {');
    ok(iFase2 > 0, nome + ': achei a fase de returns');
    const bloco = src.slice(iFase2, iFase2 + 700);
    ok(/estaDrenando/.test(bloco),
       '  ⚠️ e ela TAMBEM para (o break da paginacao nao alcanca aqui)');
  }
}

// ── ⚠️ P2: só reconstrução DE FUNDO é cancelada ─────────────────────
//
// ⚠️ b264 — MUDEI A ABORDAGEM DEPOIS DE 10 APONTAMENTOS. Eu checava
// `estaDrenando()` a mao em 13 pontos: antes do laco, depois de cada
// espera, antes de cada fase, antes de publicar. A cada rodada do Codex eu
// consertava 4 e esquecia 6 — porque cancelamento cooperativo nao e uma
// linha, e um CONTRATO.
//
// Agora a ESPERA sabe cancelar (`drenagem.pausar`), e ela LANCA. As pausas
// que ja existiam (ritmo do Bling, backoff do 429) viraram os pontos de
// cancelamento. Quem escrever um laco novo herda sem lembrar de nada.
{
  for (const [arq, nome] of MODULOS.filter(([a]) => a.includes('nf-nomes'))) {
    const src = ler(arq);
    ok(/drenagem\.pausar\(/.test(src),
       nome + ': as esperas usam `drenagem.pausar` (que cancela sozinha)');
    ok(/drenagem\.pausar\(\s*\d+[^,]*,\s*deFundo/.test(src),
       '  ⚠️ passando `deFundo`: requisicao EM VOO nao e cancelada');
  }
}

// ── ⚠️ e o cancelamento e tratado num LUGAR SO ──────────────────────
//
// O `return` no catch e o que impede a publicacao do indice parcial — sai
// antes do `IDX.ts = Date.now()`, entao o indice velho continua valendo e o
// processo NOVO monta um completo.
{
  for (const [arq, nome] of MODULOS.filter(([a]) => a.includes('nf-nomes'))) {
    const src = ler(arq);
    ok(/ehCancelamento\(e\)/.test(src),
       nome + ': trata o cancelamento no chamador, num lugar so');
    ok(/construirIndiceInterno/.test(src),
       '  com a varredura isolada numa funcao interna');
  }
}

// ── ⚠️ e `pausar` cancela DEPOIS da espera, não só antes ────────────
//
// Era o P1 que o Codex apontou duas vezes: a checagem do topo já passou
// quando o sinal chega DURANTE a espera de 400ms ou de 2/4/6s.
{
  const d = ler('lib/drenagem.js');
  // ⚠️ recorto ate a proxima funcao, nao 600 chars: o
  // `pontoDeCancelamento` tem a mesma linha e entrava na conta. E a 5a vez
  // hoje que janela fixa em teste me da numero errado.
  const iPausar = d.indexOf('async function pausar');
  const iProx = d.indexOf('function pontoDeCancelamento', iPausar);
  const corpo = d.slice(iPausar, iProx > 0 ? iProx : iPausar + 600);
  const checagens = (corpo.match(/if \(cancelavel && drenando\) throw/g) || []).length;
  ok(checagens === 2,
     '⚠️ `pausar` checa ANTES e DEPOIS da espera (achei ' + checagens + ')');
  ok(/throw new Cancelado/.test(corpo),
     '  e LANCA em vez de devolver false (return pode ser ignorado por engano)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
