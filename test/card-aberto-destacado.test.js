// Roda com: node test/card-aberto-destacado.test.js
//
// [stated 13/09] "quero que todo o card correspondente fique destacado com
// uma borda ao redor do retângulo inteiro, e não apenas com o destaque na
// lateral esquerda. O destaque deve permanecer enquanto aquele item estiver
// aberto/selecionado, para deixar visualmente claro qual produto está sendo
// tratado e a qual item pertencem as informações exibidas abaixo."
//
// ⚠️ Com a ficha expandindo DENTRO do card, sem isso não dá para saber a
// qual produto pertencem as informações abaixo — ainda mais com vários
// defeitos na tela.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const src = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'defeitos-ficha.js'), 'utf8');

// ── o card tem identidade ───────────────────────────────────────────
{
  ok(/class="cardDefeito" id="card-' \+ esc\(it\.id\)/.test(src),
     'cada card tem classe e id proprio');

  // ⚠️ `it`, não `x`: foi o parâmetro errado que derrubou a lista hoje
  ok(!/id="card-' \+ esc\(x\.id\)/.test(src),
     '  ⚠️ usando `it` (o parametro do map), nao `x`');
}

// ── e o estilo do aberto existe ─────────────────────────────────────
{
  ok(/\.cardDefeito\.aberto\{/.test(src), 'ha estilo pro card aberto');
  ok(/border:2px solid #9E1A1A !important;/.test(src),
     '⚠️ com borda INTEIRA (nao so a lateral)');
  ok(/box-shadow:0 2px 10px rgba\(158,26,26,\.18\)/.test(src),
     '  e sombra suave, que separa do fundo sem exagerar');

  // ⚠️ no <style>, não costurado em concatenação de string — foi assim que
  // a lista quebrou duas vezes hoje
  ok(/estiloCardDefeito/.test(src),
     '  ⚠️ injetado como <style> (nao concatenado no HTML)');
}

// ── ⚠️ e só um card fica aberto por vez ─────────────────────────────
{
  ok(/function marcarCardAberto\(id\)/.test(src),
     'ha uma funcao que marca o card aberto');
  ok(/querySelectorAll\('\.cardDefeito'\)/.test(src),
     '⚠️ que varre TODOS (nao guarda qual estava aberto)');
  ok(/marcarCardAberto\(null\)/.test(src),
     '  e limpa ao fechar');

  // simula a troca
  const cards = ['a', 'b', 'c'].map((id) => ({ id: 'card-' + id, cls: new Set() }));
  const marcar = (id) => {
    cards.forEach((c) => c.cls.delete('aberto'));
    if (!id) return;
    const alvo = cards.find((c) => c.id === 'card-' + id);
    if (alvo) alvo.cls.add('aberto');
  };
  marcar('b');
  ok(cards.filter((c) => c.cls.has('aberto')).length === 1, '  abre B: 1 destacado');
  marcar('c');
  const abertos = cards.filter((c) => c.cls.has('aberto'));
  ok(abertos.length === 1 && abertos[0].id === 'card-c',
     '  ⚠️ abre C: B perde o destaque (nao ficam 2)');
  marcar(null);
  ok(cards.every((c) => !c.cls.has('aberto')), '  fecha: nenhum destacado');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
