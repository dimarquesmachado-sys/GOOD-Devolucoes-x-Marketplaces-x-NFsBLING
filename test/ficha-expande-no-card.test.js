// Roda com: node test/ficha-expande-no-card.test.js
//
// ⚠️ [stated 11/09] "quando eu clico pra abrir um defeito, ele avança o card
// e sai da tela com todos defeitos (...) quando eu clico pra voltar, após
// ter visto o produto com defeito, ele volta pra página geral de defeitos.
// isso atrapalha (...) tem como (...) só abrir embaixo?"
//
// A ficha SUBSTITUÍA a caixa inteira, e o voltar recarregava a lista geral —
// perdendo a busca digitada e a rolagem. Quem está triando 10 peças refaz o
// caminho 10 vezes.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const src = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'defeitos-ficha.js'), 'utf8');

// ── a ficha abre dentro do card ─────────────────────────────────────
{
  ok(/window\.expandirFichaNoCard = async function/.test(src),
     'ha uma funcao que expande a ficha no card');
  ok(/expandirFichaNoCard\(/.test(src),
     '  e o botao do card chama ela');
  ok(/id="ficha-/.test(src),
     '  com um destino por card');
}

// ── ⚠️ e REAPROVEITA a montagem existente ───────────────────────────
//
// Manter dois HTMLs da mesma ficha garante que um fique para trás. O
// `abrir()` ganhou um destino alternativo, e o expandir aponta para ele
// antes de chamar a ficha de sempre.
//
// v4.9x (review do Codex no #257) - a primeira versao guardava o destino
// numa variavel global e a soltava no `finally` do PRIMEIRO carregamento.
// Qualquer recarga POSTERIOR da mesma ficha (retirar peca, corrigir laudo,
// excluir comentario) achava o destino ja nulo e caia no modal de tela
// cheia, desfazendo a expansao. Agora o destino e recalculado A CADA
// chamada a partir de `fichaInlineId` — que so muda quando o card e
// explicitamente aberto ou fechado, nunca num `finally` de carregamento.
{
  ok(/function abrir\(html, destino\)/.test(src),
     '⚠️ o `abrir()` aceita destino alternativo');
  ok(/fichaInlineId = id;/.test(src),
     '  e o expandir marca ESTA ficha como a inline aberta antes de chamar ela');
  ok(/await window\.abrirFichaDefeito\(id\);/.test(src),
     '  ⚠️ chamando a ficha DE SEMPRE (nao um segundo montador)');

  // ⚠️ o destino de uma recarga (nao so do primeiro load) tem que continuar
  // calculado a partir do id da ficha ainda aberta - e nao ficar preso a
  // uma variavel zerada assim que o primeiro `await` termina.
  ok(/fichaInlineId != null && String\(fichaInlineId\) === String\(id\)/.test(src),
     '  ⚠️ e o destino de CADA carregamento (inclusive recargas) reflete a ficha inline aberta');
  ok(!/finally \{ _destinoFicha = null; \}/.test(src),
     '  ⚠️ e nao solta mais o destino no fim do PRIMEIRO load (isso quebrava toda recarga seguinte)');
}

// ── ⚠️ e so UMA ficha inline aberta por vez ─────────────────────────
//
// `fichaAberta` e ids como edLaudo/blocoHist dentro do html da ficha sao
// globais: com duas expandidas ao mesmo tempo, os dois cards teriam
// elementos com o MESMO id e agir num (corrigir laudo, por exemplo)
// podia gravar no card errado.
{
  ok(/function fecharFichaInline\(\)/.test(src),
     'ha uma funcao que fecha a ficha inline aberta');
  ok(/fecharFichaInline\(\);\s*\n\s*alvo\.style\.display = 'block';/.test(src),
     '  ⚠️ e o expandir fecha a anterior ANTES de abrir uma nova');
}

// ── e o caminho antigo continua para quem precisa ───────────────────
//
// Outros pontos chamam `abrirFichaDefeito` (busca por NF, retorno de ação) —
// e lá trocar de tela faz sentido.
{
  ok(/window\.abrirFichaDefeito = async function/.test(src),
     'o `abrirFichaDefeito` continua existindo');
  ok(/return window\.abrirFichaDefeito\(id\);/.test(src),
     '  ⚠️ e e o fallback quando o destino nao existe (botao nao morre)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
