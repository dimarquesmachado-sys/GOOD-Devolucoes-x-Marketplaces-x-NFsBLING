'use strict';

/**
 * seg2.1 - normaliza o caminho ANTES de decidir se a pagina e protegida.
 *
 * Apontamento do Codex no PR #85, e ele esta certo: `req.path` NAO vem
 * decodificado, mas o `express.static` decodifica antes de procurar o
 * arquivo. Entao comparar `req.path === '/painel-devolucoes.html'` deixava
 * passar `/%70ainel-devolucoes.html` — o freio nao casava e o static
 * entregava a tela do mesmo jeito. Furo pelo qual o PR inteiro nao valeria.
 *
 * Aqui a gente decodifica ANTES de comparar, repetindo ate estabilizar
 * (cobre `%2570` e afins) com teto pequeno pra nao virar laco.
 *
 * Regras de borda, todas para o lado seguro:
 *  - `%` malformado (decodeURIComponent lanca) -> devolve null, e quem
 *    chama trata como PROTEGIDO. Requisicao torta nao ganha o beneficio
 *    da duvida.
 *  - barra invertida vira barra: `\admin\x` nao dribla o `startsWith`.
 *  - comparacao em minusculas: barra de leve a mais do que o static serve
 *    (o disco no Linux e sensivel a maiusculas), e errar pro lado de
 *    barrar demais aqui nao quebra nada — a pagina certa continua servida
 *    pra quem tem sessao.
 */
function normalizarCaminhoPedido(caminhoBruto) {
  let atual = String(caminhoBruto || '');
  for (let volta = 0; volta < 3; volta++) {
    if (atual.indexOf('%') === -1) break;
    let decodificado;
    try {
      decodificado = decodeURIComponent(atual);
    } catch (e) {
      return null;   // malformado: quem chama barra
    }
    if (decodificado === atual) break;
    atual = decodificado;
  }
  // barra invertida vira barra E barras repetidas colapsam: sem isso,
  // `\\admin\\x` virava `//admin//x` e escapava do startsWith('/admin/').
  return atual.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();
}

/**
 * Devolve true quando o caminho pedido bate com alguma das paginas
 * protegidas — por igualdade exata ou por prefixo de pasta.
 * Caminho malformado tambem devolve true (barra).
 */
function ehCaminhoProtegido(caminhoBruto, { exatos = [], prefixos = [] } = {}) {
  const caminho = normalizarCaminhoPedido(caminhoBruto);
  if (caminho === null) return true;
  if (exatos.some((p) => caminho === String(p).toLowerCase())) return true;
  if (prefixos.some((p) => caminho.startsWith(String(p).toLowerCase()))) return true;
  return false;
}

module.exports = { normalizarCaminhoPedido, ehCaminhoProtegido };
