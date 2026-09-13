// Roda com: node test/excluir-fica-na-tela.test.js
//
// [stated 13/09] "não tá mostrando a contagem certa no botão EXCLUÍDOS. já
// excluí 2, e mostra 0. mas o melhor era só excluir sumir o card e manter na
// tela dos defeitos, e não jogar a gente pro card dos excluídos. se excluí,
// quero tirar da frente. me deixa na mesma tela."

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const ciclo = fs.readFileSync(path.join(RAIZ, 'lib', 'defeitos-ciclo.js'), 'utf8');
const front = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'defeitos-ficha.js'), 'utf8');

// ── ⚠️ a aba de Excluídos é contada ─────────────────────────────────
//
// O objeto tinha 3 abas e o laço varria 3 — `excluido` ficou de fora desde
// sempre, então o botão mostrava 0 mesmo com registros lá.
//
// ⚠️ E isso é pior que cosmético: o dono exclui, vê 0, e conclui que a
// exclusão não funcionou — foi exatamente o que aconteceu.
{
  ok(/const contagem = \{ defeito: 0, recuperado: 0, descartado: 0, excluido: 0 \}/.test(ciclo),
     '⚠️ o objeto da contagem inclui `excluido`');
  ok(/for \(const aba of \['defeito', 'recuperado', 'descartado', 'excluido'\]\)/.test(ciclo),
     '  e o laco varre as 4 abas');

  // o front já esperava o campo
  ok(/id: 'excluido',/.test(front),
     '  (o front ja mostrava a aba — so o servidor nao mandava o numero)');
}

// ── e a exclusão NÃO troca de aba ───────────────────────────────────
{
  ok(!/abaAtual = 'excluido';/.test(front),
     '⚠️ excluir nao joga mais pra aba dos Excluidos');
  ok(/abrirBuscaDefeitos\(\);/.test(front),
     '  so recarrega a lista (o card some pelo filtro)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
