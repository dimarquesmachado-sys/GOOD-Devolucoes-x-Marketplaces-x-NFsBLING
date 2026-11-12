// js-AMB/painel-bridge.js — modulo do painel unico (docs/MODULARIZACAO.md, fatia 1).
//
// MOVIDO de painel-AMB.html em b679, SEM EDICAO (o bloco abaixo e identico, linha a linha, ao que
// estava no <script> principal): a comunicacao com a extensao (Toolbox / Devolucoes Bridge) —
// deteccao (PING/PONG + anuncio INSTALADA), chamarBlingViaBridge e a pre-deteccao do carregamento.
// Carregado por <script src> ANTES do script principal do painel; as funcoes sao globais e so sao
// chamadas por clique (depois de tudo carregado). O estado de topo (`bridgeInstaladaCache`) mora aqui.
// Nas instancias o estatico da fabrica serve este arquivo; na GOOD, a rota fechada /js-AMB/painel-*.js.

// @secao bridge
    // ============================================================
    // v3.15.0 - Comunicacao com a Extensao "Devolucoes Bridge"
    // b323 - o nome tinha "GOOD" e confundia nas telas da AMB: e a MESMA
    // extensao pras duas empresas (nasceu na GOOD e nunca foi renomeada).
    // No Firefox ela se instala como "AMBTotal Devolucoes Bridge".
    // ============================================================
    // A extensao instalada no navegador escuta postMessage e faz
    // chamadas ao Bling com privilegios (sem CORS).
    // Sem a extensao instalada, a chamada vai dar timeout.

    // b668 - A CORRIDA DO CARREGAMENTO. A pre-deteccao roda no fim deste script,
    // durante o parse da pagina; o content script da extensao (Toolbox/Bridge)
    // e injetado em `document_idle`, DEPOIS da pagina carregar — num painel
    // pesado (a GOOD, com dezenas de cards) isso leva mais de 1,5 s. O PING
    // saia antes da extensao existir, o timeout gravava `false` no cache e o
    // cache nunca era refeito: todo "Gerar NF" dali em diante dizia "extensao
    // nao detectada" com a Toolbox instalada (caso real, GOOD, 07/11). Agora:
    //   1. resultado NEGATIVO nunca e guardado — a proxima chamada pergunta de novo;
    //   2. um ouvinte PERMANENTE pega o GOOD_BRIDGE_INSTALADA que a extensao
    //      anuncia ao injetar (e qualquer PONG), e marca a Bridge como presente.
    let bridgeInstaladaCache = null;   // so vira true; nunca false
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const t = event.data && event.data.tipo;
      if (t === 'GOOD_BRIDGE_INSTALADA' || t === 'GOOD_BRIDGE_PONG') bridgeInstaladaCache = true;
    });

    // Detecta se a extensao esta instalada (via postMessage PING/PONG)
    function verificarBridgeInstalada() {
      if (bridgeInstaladaCache === true) return Promise.resolve(true);

      return new Promise(resolve => {
        let resolved = false;
        function handler(event) {
          if (event.source !== window) return;
          if (event.data?.tipo === 'GOOD_BRIDGE_PONG' || event.data?.tipo === 'GOOD_BRIDGE_INSTALADA') {
            resolved = true;
            window.removeEventListener('message', handler);
            bridgeInstaladaCache = true;
            resolve(true);
          }
        }
        window.addEventListener('message', handler);
        window.postMessage({ tipo: 'GOOD_BRIDGE_PING' }, '*');

        setTimeout(() => {
          if (!resolved) {
            window.removeEventListener('message', handler);
            resolve(false);   // b668: NAO grava false — a extensao pode injetar logo depois
          }
        }, 1500);
      });
    }

    // Manda pedido pra Bridge criar a devolucao no Bling
    function chamarBlingViaBridge(payload) {
      // b324 - A EMPRESA ENTRA AQUI, no ÚNICO ponto por onde tudo passa.
      //
      // O erro em produção (19/08): a mensagem do Bling veio com
      //   "IDs usados -> empresa: 4956030980 (servidor)" — os ids da GOOD,
      // numa devolução da AMB. Motivo: este painel tem DUAS chamadas ao
      // Bridge (o fluxo do modal e o da esteira) e a b303 marcou só UMA com
      // `empresa: 'ambtotal'`. A outra chegava sem empresa, a extensão
      // assumia 'good' — comportamento histórico dela — e pedia os ids da
      // GOOD ao servidor. O Bling então recusa: a nota não é dessa conta e o
      // CFOP da natureza não existe lá.
      //
      // Marcar cada chamada é frágil: qualquer caminho novo nasce errado e
      // ninguém percebe até sair nota errada. Como toda chamada daqui passa
      // por este ponto único, carimbo aqui em vez de depender de memória.
      //
      // ⚠️ Codex (revisão do PR #370, P1) - este arquivo (public-AMB/) hoje
      // serve TANTO a AMB quanto a Girassol (mesma pasta, prefixo por
      // empresa). `'ambtotal'` cravado fazia a Girassol pedir os ids
      // fiscais da AMB. `window.APP_EMPRESA` (base-amb.js) já resolve pela
      // URL — 'amb', 'girassol' ou 'good' — e a extensão (ENDERECO_IDS)
      // sabe mapear cada um pro endpoint certo.
      payload = Object.assign({}, payload || {}, { empresa: window.APP_EMPRESA || 'ambtotal' });
      return new Promise((resolve, reject) => {
        const requisicaoId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        let timeout;

        function handler(event) {
          if (event.source !== window) return;
          if (event.data?.tipo !== 'GOOD_BRIDGE_RESPOSTA') return;
          if (event.data.requisicaoId !== requisicaoId) return;

          window.removeEventListener('message', handler);
          clearTimeout(timeout);

          if (event.data.ok) {
            resolve(event.data.resultado);
          } else {
            reject(new Error(event.data.erro || 'Erro desconhecido na Bridge'));
          }
        }

        window.addEventListener('message', handler);

        window.postMessage({
          tipo: 'GOOD_BRIDGE_CRIAR_DEVOLUCAO',
          requisicaoId,
          payload,
        }, '*');

        // Timeout de 110s (SEFAZ pode demorar mais de 1 min em dias lentos;
        // a extensao tambem grava sozinha, entao nada se perde)
        timeout = setTimeout(() => {
          window.removeEventListener('message', handler);
          reject(new Error('Timeout - Bling demorou mais de 110s pra responder. IMPORTANTE: a NF pode ter sido criada mesmo assim - clique em Gerar de novo que o sistema confere e vincula.'));
        }, 110000);
      });
    }

    // Pre-detecta a Bridge logo no carregamento (atualiza badge na UI se quiser)
    verificarBridgeInstalada().then(instalada => {
      console.log('[GOOD Devolucoes] Extensao Bridge:', instalada ? 'INSTALADA ✅' : 'NAO instalada ❌');
    });
