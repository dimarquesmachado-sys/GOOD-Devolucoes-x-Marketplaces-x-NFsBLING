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
// Meu break era incondicional. Se o SIGTERM chegasse enquanto o estoquista
// esperava uma busca fria, eu abortava a varredura DELE — e publicava o
// índice parcial, fazendo a busca voltar vazia.
//
// A drenagem deixa o processo vivo justamente para a requisição em voo
// terminar. Cancelar a que ela pediu é o oposto.
{
  for (const [arq, nome] of MODULOS.filter(([a]) => a.includes('nf-nomes'))) {
    const src = ler(arq);
    ok(/deFundo && drenagem\.estaDrenando\(\)/.test(src),
       nome + ': so cancela reconstrucao DE FUNDO');
  }
}

// ── ⚠️ P2: e índice cancelado NÃO é publicado ───────────────────────
//
// Carimbar `ts` num índice parcial o faria parecer fresco — e a próxima
// busca serviria dele em vez de reconstruir.
{
  const good = ler('lib/nf-nomes.js');
  ok(/if \(cancelado\)[\s\S]{0,200}return;/.test(good),
     'GOOD: indice cancelado nao e publicado');

  const amb = ler('amb-devolucoes/lib-AMB/nf-nomes-AMB.js');
  ok(/\(falhouGeral \|\| cancelado\)/.test(amb),
     'AMB: idem (reaproveitando o `falhouGeral` que ja existia)');
}

// ── ⚠️ P1: re-checa DEPOIS de cada espera ───────────────────────────
//
// A checagem do topo já passou quando o SIGTERM chega durante a pausa de
// 400ms ou as esperas de 2/4/6s do retry. Toda espera é uma janela nova: a
// checagem tem que vir DEPOIS dela e ANTES da chamada.
{
  for (const [arq, nome] of MODULOS.filter(([a]) => a.includes('nf-nomes'))) {
    const src = ler(arq);
    const iPausa = src.indexOf('setTimeout(ok, 400)');
    ok(iPausa > 0, nome + ': achei a pausa entre paginas');
    ok(/estaDrenando/.test(src.slice(iPausa, iPausa + 800)),
       '  ⚠️ e re-checa DEPOIS dela (a janela da espera e nova)');
  }
}

// ── e as variáveis existem em cada arquivo ──────────────────────────
//
// ⚠️ Usei `deFundo` e `cancelado` na AMB sem elas existirem lá. Teria
// quebrado em produção com ReferenceError — `node --check` não pega
// variável inexistente, e o caminho só roda durante drenagem.
{
  for (const [arq, nome] of MODULOS.filter(([a]) => a.includes('nf-nomes'))) {
    const src = ler(arq);
    if (/deFundo/.test(src)) {
      ok(/const deFundo =/.test(src), nome + ': `deFundo` e DECLARADA aqui');
    }
    if (/\bcancelado\b/.test(src)) {
      ok(/let cancelado =/.test(src), '  e `cancelado` tambem');
    }
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
