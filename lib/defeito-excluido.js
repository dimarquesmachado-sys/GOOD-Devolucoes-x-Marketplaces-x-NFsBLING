// ============================================================
// lib/defeito-excluido.js
// ------------------------------------------------------------
// b312 (revisao Codex #269, rodada 2) - fonte UNICA pra saber se uma linha
// de `devolucoes` foi excluida do ciclo de defeitos, nos TRES formatos que
// o soft delete pode ter gravado (lib/defeitos-ciclo.js, b310/b311):
//   - tipo === 'defeito_excluido'          (formato original)
//   - tipo === 'problema' && status === 'cancelled'  (1o fallback, b305)
//   - `estado_atual` contem a marca, TEXTO LIVRE        (2o fallback, b310)
//
// Antes cada lugar (situacaoDe, ficha, /excluir, /estado, server.js,
// relatorios) reimplementava o proprio teste, alguns com regex
// case-sensitive e outros com ILIKE (case-insensitive) do lado do banco -
// uma marca com case diferente do usual passava num lado e nao no outro
// (apontamento do Codex #269, P2). Uma unica funcao, um unico regex.
// ============================================================

const MARCA_EXCLUIDO = /REGISTRO EXCLUIDO/i;

function marcadoExcluido(item) {
  if (!item) return false;
  if (item.tipo === 'defeito_excluido') return true;
  if (item.tipo === 'problema' && item.status === 'cancelled') return true;
  return MARCA_EXCLUIDO.test(String(item.estado_atual || ''));
}

module.exports = { marcadoExcluido, MARCA_EXCLUIDO };
