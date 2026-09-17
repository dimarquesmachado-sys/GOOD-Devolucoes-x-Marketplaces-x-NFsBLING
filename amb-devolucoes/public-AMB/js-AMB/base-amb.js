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
  // ⚠️ b369 - A BASE VEM DA URL, nao cravada.
  //
  // Era `'/amb'` fixo. Com a Girassol em `/girassol`, toda chamada de API
  // desta tela iria pro servidor da AMB — e como a sessao e por empresa, o
  // usuario da Girassol levaria 401 em tudo, sem entender por que.
  //
  // 📌 O 1o segmento da URL E o prefixo da empresa: /amb/..., /girassol/...
  // A GOOD e a raiz (sem prefixo), e por isso a lista de segmentos
  // conhecidos decide — em vez de assumir que sempre ha um.
  //
  // ⚠️ NAO uso "o 1o segmento, seja qual for": se alguem abrir /qualquer/
  // coisa, isso viraria base e as chamadas iriam pra lugar nenhum. So aceito
  // o que o backend serve.
  var PREFIXOS_CONHECIDOS = ['/amb', '/girassol'];
  var BASE = (function () {
    var caminho = String(window.location.pathname || '');
    for (var i = 0; i < PREFIXOS_CONHECIDOS.length; i++) {
      var p = PREFIXOS_CONHECIDOS[i];
      if (caminho === p || caminho.indexOf(p + '/') === 0) return p;
    }
    return '';   // a GOOD e a raiz
  })();

  // ⚠️ b369: as telas precisam da base pra montar link e navegacao. Sem isto
  // elas continuariam escrevendo `/amb/` na mao — que e o que estamos tirando.
  window.APP_BASE = BASE;

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
