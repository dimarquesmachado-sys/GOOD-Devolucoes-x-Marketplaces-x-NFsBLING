// ════════════════════════════════════════════════════════════════════
//  amb-devolucoes · js/base-amb  (AMB Devol. b57)
//  ADAPTADOR DE CAMINHO — carregado ANTES dos modulos da GOOD.
//
//  Os modulos desta pasta sao os arquivos da GOOD, SEM UMA LINHA
//  ALTERADA (helpers, auth, scanner, camera, bipagem, busca, etiqueta,
//  triagem, ocr, app). Eles chamam /api/... e /health na raiz; o modulo
//  da AMB vive sob /amb. Em vez de editar 2.900 linhas — e ter que
//  reeditar toda vez que a GOOD melhorar — este arquivo poe o prefixo
//  em tempo de execucao.
//
//  Assim, atualizar a AMB no futuro = copiar os arquivos da GOOD por
//  cima. Nada mais.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var BASE = '/amb';

  // so mexe no que e chamada de API deste servidor — nao toca em CDN,
  // caminho relativo (js-AMB/...), blob:, data: nem URL absoluta
  function precisaPrefixo(u) {
    return typeof u === 'string' && (u.indexOf('/api/') === 0 || u === '/health');
  }

  var fetchOriginal = window.fetch.bind(window);
  window.fetch = function (entrada, init) {
    try {
      if (precisaPrefixo(entrada)) {
        entrada = BASE + entrada;
      } else if (entrada && typeof entrada === 'object' && precisaPrefixo(entrada.url)) {
        // caso alguem monte um Request() em vez de passar a string
        entrada = new Request(BASE + entrada.url, entrada);
      }
    } catch (e) { /* na duvida, deixa passar como veio */ }
    return fetchOriginal(entrada, init);
  };

  // alguns navegadores/bibliotecas ainda usam XHR — cobre tambem
  var abrirOriginal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    if (precisaPrefixo(url)) {
      arguments[1] = BASE + url;
    }
    return abrirOriginal.apply(this, arguments);
  };

  window.AMB_BASE = BASE;
})();
