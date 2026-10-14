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
  // o atalho instalado (manifesto) usa o icone da empresa
  function iconesDoManifesto(icons) {
    return (Array.isArray(icons) ? icons : []).map((i) => Object.assign({}, i, { src: icone }));
  }
  return { logo, icone, iconeToque, aplicar, iconesDoManifesto };
}
module.exports = { criarMarca };
