'use strict';
/* b537 - UNIFICACAO DO PAINEL: monta o PAINEL UNICO (amb-devolucoes/public-AMB/painel-AMB.html) para a GOOD —
   nome no titulo, paleta roxa da GOOD e os arquivos de empresa servidos pela raiz da GOOD. */
const TEMA_GOOD_PAINEL = `<style id="tema-empresa">
  :root { --roxo:#561A9E; --roxo-claro:#7B3FC4; --marca:#561A9E; --marca-claro:#7B3FC4; --sobre-marca:#ffffff;
          --marca-texto:#561A9E; --marca-texto-2:#6a1b9a; --escuro:#4a148c; --fundo:#f5f2fb; --borda:#e4dcf1;
          --texto:#241a35; --apagado:#71659a; }
</style>`;
const SCRIPTS_DEFEITOS_GOOD = '<script src="/js/defeitos-ficha.js?v=4922"></script>\n'
  + '  <script src="/js/lancar-defeito.js?v=7"></script>\n'
  + '  <script>if (window.LancarDefeito) window.LancarDefeito.instalar({ prefixo: \'\' });</script>';
const LINK_RELATORIOS_GOOD = '\n        <a href="/admin/relatorios.html" class="destaque" title="Abre a pagina de relatorios das devolucoes">📊 Relatórios</a>';
function montarPainelUnicoGood(h0) {
  const nome = 'GOOD Import (GIMPO)';
  const tema = TEMA_GOOD_PAINEL;
  return h0.replace('<title>AMBTotal - Painel de Devoluções</title>', `<title>${nome} - Painel de Devoluções</title>`)
    .replace(/<h1>([^<]*)Painel de Devoluções — AMBTotal<\/h1>/, (m0, ic) => `<h1>${ic}Painel de Devoluções — ${nome}</h1>`)
    .replace(/<style>/, tema + '\n  <style>')
    .replace(/src="js-AMB\/base-amb\.js\?v=[^"]*"/, 'src="/js-AMB/base-amb.js?v=good537"')
    // b538 (Codex #442): a GOOD usa o defeitos-ficha DELA (oferece "Lancar defeito" quando a busca nao acha) e o
    // modal compartilhado lancar-defeito.js — o fork da AMB so mostra "nada encontrado".
    .replace(/<script src="js-AMB\/defeitos-ficha\.js\?v=[^"]*"><\/script>/, SCRIPTS_DEFEITOS_GOOD)
    // b538 (Codex #442): o atalho dos relatorios existe no painel atual da GOOD e nao no da AMB.
    .replace('<div class="header-acoes">', '<div class="header-acoes">' + LINK_RELATORIOS_GOOD);
}

module.exports = { montarPainelUnicoGood, TEMA_GOOD_PAINEL };
