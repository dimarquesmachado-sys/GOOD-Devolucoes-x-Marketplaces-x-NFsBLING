'use strict';
/* b537 - UNIFICACAO DO PAINEL: monta o PAINEL UNICO (amb-devolucoes/public-AMB/painel-AMB.html) para a GOOD —
   nome no titulo, paleta roxa da GOOD e os arquivos de empresa servidos pela raiz da GOOD. */
const TEMA_GOOD_PAINEL = `<style id="tema-empresa">
  :root { --roxo:#561A9E; --roxo-claro:#7B3FC4; --marca:#561A9E; --marca-claro:#7B3FC4; --sobre-marca:#ffffff;
          --marca-texto:#561A9E; --marca-texto-2:#6a1b9a; --escuro:#4a148c; --fundo:#f5f2fb; --borda:#e4dcf1;
          --texto:#241a35; --apagado:#71659a; }
</style>`;
function montarPainelUnicoGood(h0) {
  const nome = 'GOOD Import (GIMPO)';
  const tema = TEMA_GOOD_PAINEL;
  return h0.replace('<title>AMBTotal - Painel de Devoluções</title>', `<title>${nome} - Painel de Devoluções</title>`)
    .replace(/<h1>([^<]*)Painel de Devoluções — AMBTotal<\/h1>/, (m0, ic) => `<h1>${ic}Painel de Devoluções — ${nome}</h1>`)
    .replace(/<style>/, tema + '\n  <style>')
    .replace(/src="js-AMB\/base-amb\.js\?v=[^"]*"/, 'src="/js-AMB/base-amb.js?v=good537"')
    .replace(/src="js-AMB\/defeitos-ficha\.js\?v=[^"]*"/, 'src="/js-AMB/defeitos-ficha.js?v=good537"');
}

module.exports = { montarPainelUnicoGood, TEMA_GOOD_PAINEL };
