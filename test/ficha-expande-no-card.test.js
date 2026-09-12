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
{
  ok(/var _destinoFicha = null;/.test(src),
     '⚠️ o `abrir()` aceita destino alternativo');
  ok(/_destinoFicha = 'ficha-' \+ id;/.test(src),
     '  e o expandir aponta pra ele');
  ok(/await window\.abrirFichaDefeito\(id, true\)/.test(src),
     '  ⚠️ chamando a ficha DE SEMPRE (nao um segundo montador)');

  // ⚠️ e solta o destino mesmo se der erro: senão a próxima ficha abriria
  // no card errado
  ok(/finally \{ _destinoFicha = null; \}/.test(src),
     '  ⚠️ e solta o destino no `finally` (senao a proxima abre no card errado)');
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
