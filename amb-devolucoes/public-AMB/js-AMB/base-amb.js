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
  // ⚠️ A BASE VEM DA FICHA QUE MONTOU ESTE ROUTER, nao de uma lista no front.
  //
  // Era `'/amb'` fixo. Com a Girassol em `/girassol`, toda chamada de API
  // desta tela iria pro servidor da AMB — e como a sessao e por empresa, o
  // usuario da Girassol levaria 401 em tudo, sem entender por que.
  //
  // Uma lista ['/amb', '/girassol', '/good'] obrigava alterar este arquivo
  // para cada CNPJ novo. Pior: esquecer fazia a tela cair na raiz da GOOD.
  // O servidor substitui estes marcadores com JSON.stringify antes de servir.
  var BASE = "%%APP_BASE%%";

  // ⚠️ b369: as telas precisam da base pra montar link e navegacao. Sem isto
  // elas continuariam escrevendo `/amb/` na mao — que e o que estamos tirando.
  window.APP_BASE = BASE;

  // ⚠️ b397 (Codex, P1) - A CHAVE CURTA DA EMPRESA, pros links externos.
  //
  // O backend ja monta `link_marketplace` pela ficha (b395), mas o PAINEL
  // RECALCULA a URL no `linkVenda()` — com `/amb-checkout-offline` e
  // `/magalu/ir/amb` cravados. Entao a seta ↗ da Girassol continuava abrindo
  // o pedido no checkout DA AMBTOTAL: o conserto do backend nunca chegava na
  // tela.
  //
  // Nao derive da rota: chave de dados e slug HTTP sao identificadores
  // diferentes (a AMB, por exemplo, tem registro `ambtotal` e dado `amb`).
  window.APP_EMPRESA = "%%APP_EMPRESA%%";

  // ⚠️ b405 - A PASTA DO CHECKOUT NO MOVER-PEDIDOS.
  //
  // O front montava `<empresa>-checkout-offline`. Vale pra AMB e GOOD — mas
  // a Girassol la e `girassol-BACKUP-offline`, nome historico. O link dela
  // apontaria pra uma pasta que nao existe.
  //
  // ⚠️ b406 (Codex, PR #345, P2) - ERA UM 2o MAPA DE EXCECAO, cravado aqui
  // so pra Girassol. `app-AMB.js` (PASTA_CHECKOUT) ja resolve isso pela
  // FICHA — uma 4a empresa com pasta fora do padrao entraria la e NAO aqui,
  // e o link desta tela divergiria do que o backend monta, sem avisar.
  //
  // 📌 Agora o valor vem pronto do servidor: esta rota (js-AMB/base-amb.js
  // em app-AMB.js) troca o marcador abaixo pelo PASTA_CHECKOUT da ficha
  // antes de servir o arquivo. So ha UMA fonte da verdade.
  window.APP_PASTA_CHECKOUT = "%%PASTA_CHECKOUT%%";

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
