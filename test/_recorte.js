'use strict';
// ⚠️ Helper de recorte para testes que precisam inspecionar fonte.
//
// Existe por causa de dois erros medidos em 13/09:
//
//   1. JANELA FIXA (`slice(i, i + 4000)`) derrubou DOZE testes num dia: o
//      código cresceu e o alvo saiu da janela. O vermelho era o teste, não o
//      bug — e vermelho falso ensina a ignorar o vermelho.
//
//   2. CONTAR CHAVES, que eu propus como alternativa, é igualmente frágil —
//      apontamento do Codex, e provado: `const s = "tem { aqui"` desbalanceia
//      a contagem e o recorte sai vazio. Strings, templates, regex e
//      comentários contêm chaves.
//
// 📌 A ordem de preferência continua sendo: TESTE COMPORTAMENTAL (executar a
// função) > marcadores estáveis > qualquer recorte por posição.
//
// Use este helper só quando o código legado impedir execução direta.

/**
 * Recorta o trecho entre dois marcadores estáveis e exclusivos.
 * Lança se algum não existir — o teste falha dizendo QUAL faltou, em vez de
 * devolver vazio e reprovar por outro motivo.
 */
function entreMarcadores(fonte, inicio, fim) {
  const i = fonte.indexOf(inicio);
  if (i < 0) throw new Error(`marcador inicial nao encontrado: ${inicio}`);
  const j = fonte.indexOf(fim, i + inicio.length);
  if (j < 0) throw new Error(`marcador final nao encontrado depois do inicial: ${fim}`);
  return fonte.slice(i, j);
}

/**
 * Recorta do marcador até o fim do arquivo. Para o último bloco, onde não há
 * marcador seguinte estável.
 */
function doMarcadorAteOFim(fonte, inicio) {
  const i = fonte.indexOf(inicio);
  if (i < 0) throw new Error(`marcador nao encontrado: ${inicio}`);
  return fonte.slice(i);
}

module.exports = { entreMarcadores, doMarcadorAteOFim };
