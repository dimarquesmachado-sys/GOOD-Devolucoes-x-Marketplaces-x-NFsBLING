'use strict';
/**
 * lib/tema-destaque.js  (b797, V-16)
 *
 * A COR DE DESTAQUE EM CIMA DA COR DA MARCA, pra qualquer empresa.
 *
 * O "+" do "Lançar Defeito", no cabecalho da triagem da fabrica, era ambar FIXO (#FFD54F) — escolhido em cima do roxo
 * da AMB. Na Girassol o cabecalho e amarelo: medido no navegador, 1,1:1 contra o fundo — o "+" sumia. E a mesma classe
 * de erro do b447 (cor cravada em cima da marca), num lugar que tinha ficado de fora.
 *
 * A ficha de cada empresa ja declara `sobreMarca`: a cor do TEXTO em cima da marca, medida pra contraste. Dela sai a
 * regra, sem campo novo na ficha (empresa nova nao precisa lembrar de nada):
 *   - texto CLARO sobre a marca (cabecalho escuro, como a AMB)  → o ambar, como sempre foi (a AMB nao muda um pixel);
 *   - qualquer outro caso (texto escuro, ou cor que nao sei ler) → a propria cor do texto sobre a marca, que e a
 *     unica que a ficha GARANTE legivel ali.
 */
const AMBAR = '#FFD54F';

/** luminancia relativa (a conta do WCAG) de uma cor `#rgb` / `#rrggbb`; qualquer outro formato → null ("nao sei") */
function luminancia(cor) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(cor == null ? '' : cor).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  const canal = (i) => { const x = parseInt(h.slice(i, i + 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}

/** o valor CSS do destaque em cima da marca, a partir do `tema.sobreMarca` da ficha */
function destaqueSobreMarca(sobreMarca) {
  const l = luminancia(sobreMarca);
  return l != null && l > 0.5 ? AMBAR : 'var(--sobre-marca)';
}

module.exports = { destaqueSobreMarca, luminancia, AMBAR };
