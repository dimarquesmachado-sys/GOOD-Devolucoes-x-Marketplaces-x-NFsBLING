'use strict';
// 14/10 (dono: 'o logo da girassol... ta pegando o logo da AMBTotal', na triagem e no icone da aba) — a MARCA da empresa
// (logo e icone) vem da FICHA, como o tema. Sem `marca` na ficha, ficam os arquivos de sempre (logo-AMB.png /
// icone-AMB.png). Caminhos relativos a public-AMB, servidos sob o prefixo da empresa (/girassol/marcas/...).
function criarMarca(ficha) {
  const m = (ficha && ficha.marca) || {};
  const logo = m.logo || 'logo-AMB.png';
  const icone = m.icone || 'icone-AMB.png';
  const iconeToque = m.iconeToque || icone;
  // troca nas telas os arquivos da AMB pelos da empresa (a triagem tem 2 logos e os 2 icones no <head>)
  function aplicar(html) {
    return String(html)
      .split('src="logo-AMB.png"').join(`src="${logo}"`)
      .split('<link rel="icon" type="image/png" href="icone-AMB.png">').join(`<link rel="icon" type="image/png" href="${icone}">`)
      .split('<link rel="apple-touch-icon" href="icone-AMB.png">').join(`<link rel="apple-touch-icon" href="${iconeToque}">`);
  }
  // o atalho instalado (manifesto) usa o icone da empresa. Sem `marca` na ficha, o manifesto fica como sempre foi.
  // Com `marca`, so declara o tamanho que o arquivo TEM (192x192): nao existe icone 512 da empresa, e um 512x512
  // apontando pra um PNG de 192 e mentira no manifesto (Codex, PR #490). Um 512 real entra por `marca.icone512`.
  function iconesDoManifesto(icons) {
    const lista = Array.isArray(icons) ? icons : [];
    if (!ficha || !ficha.marca) return lista.map((i) => Object.assign({}, i, { src: icone }));
    const base = lista.find((i) => i && i.sizes === '192x192') || lista[0] || { type: 'image/png', purpose: 'any' };
    const out = [Object.assign({}, base, { src: icone, sizes: '192x192' })];
    if (m.icone512) out.push(Object.assign({}, base, { src: m.icone512, sizes: '512x512' }));
    return out;
  }
  return { logo, icone, iconeToque, aplicar, iconesDoManifesto };
}
module.exports = { criarMarca };
