// js-AMB/painel-reclamacao.js — modulo do painel unico (docs/MODULARIZACAO.md, fatia 5).
//
// MOVIDO de painel-AMB.html em b684, SEM EDICAO: os protocolos/tickets da Magalu no card
// (magaluProtocolosHtml, link, editar, apagar, salvar), comentarioComLinks e os textos de reclamacao
// prontos pra copiar (magaluTextoReclamacao, mlTextoReclamacao e os botoes de copiar).
// Carregado por <script src> ANTES do script principal; so declara funcoes (nada roda na carga). No
// script principal, a marca `// @painel-modulo js-AMB/painel-reclamacao.js#reclamacao` fica no lugar de
// onde o bloco saiu.

// @secao reclamacao
    // v4.38 - protocolos AUTOMATICOS da Magalu (API oficial de SAC). Cada
    // reclamacao do pedido vira link, com motivo, status e prazo.
    function magaluProtocolosHtml(e) {
      // v4.42 - a API de tickets nao bate com a pagina real (protocolos trocados)
      // e nao da o UUID v4 do link do protocolo. O caminho CONFIAVEL e a pagina
      // oficial de protocolos do pedido, montavel so com o numero do pedido:
      //   seller.magalu.com/tickets/?orderNumber={pedido}
      // Um clique abre a lista real; outro abre o protocolo pra ler a reclamacao.
      if (!e.pedido) return '';
      var url = 'https://seller.magalu.com/tickets/?orderNumber=' + encodeURIComponent(String(e.pedido).replace(/\D/g, ''));
      // v4.46 - pilula compacta, fica na MESMA linha do 🔗 abrir do pedido
      return ' <a href="' + url + '" target="_blank" rel="noopener" style="background:var(--marca);color:var(--sobre-marca);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;text-decoration:none;margin-left:4px;">📋 protocolos</a>';
    }

    // v4.31 - campo TICKET so pra Magalu: salva o numero da reclamacao e monta
    // o link direto pra request no Zendesk. Se ja tem ticket, o botao de abrir
    // NOVA reclamacao some (nao faz sentido abrir outra).
    function magaluLinkTicket(num) {
      return 'https://marketplacemagalu.zendesk.com/hc/pt-br/requests/' + encodeURIComponent(String(num).replace(/\D/g, ''));
    }
    // v4.32 - editar: pede o novo numero (prompt = confirmacao natural)
    async function magaluEditarTicket(chave, atual) {
      var novo = prompt('Alterar o ticket Magalu:', atual || '');
      if (novo === null) return; // cancelou
      novo = String(novo).replace(/\D/g, '').slice(0, 20);
      var d = await espreitaNotaPost({ chave: chave, ticket: novo });
      if (!d.ok) { alert(d.erro || 'erro ao salvar'); return; }
      if (window._espDados) renderEspreita(window._espDados);
    }
    // v4.32 - apagar: confirma antes (a acao remove o vinculo do ticket)
    async function magaluApagarTicket(chave) {
      if (!confirm('Apagar o número do ticket deste item? Você poderá cadastrar outro depois.')) return;
      var d = await espreitaNotaPost({ chave: chave, ticket: '' });
      if (!d.ok) { alert(d.erro || 'erro ao apagar'); return; }
      if (window._espDados) renderEspreita(window._espDados);
    }

    async function magaluSalvarTicket(chave) {
      var inp = document.getElementById('tk_' + chave);
      if (!inp) return;
      var val = String(inp.value || '').replace(/\D/g, '').slice(0, 20);
      var d = await espreitaNotaPost({ chave: chave, ticket: val });
      if (!d.ok) { alert(d.erro || 'erro ao salvar ticket'); return; }
      // atualiza a UI na hora
      if (window._espDados) renderEspreita(window._espDados);
    }

    // v4.30 - o comentario do a espreita e onde o Diego cola o numero do ticket
    // aberto no marketplace. O numero E parte da URL, entao detectamos e viramos
    // link clicavel - assim da pra voltar direto na reclamacao depois.
    function comentarioComLinks(txt, marketplace) {
      var esc = escapeHtml(String(txt || ''));
      // "ticket 147110817", "protocolo: 147110817", "chamado #147110817" ou o numero solto de 6-12 digitos
      esc = esc.replace(/\b(\d{6,12})\b/g, function (num) {
        var url = null;
        if (marketplace === 'magalu') url = 'https://marketplacemagalu.zendesk.com/hc/pt-br/requests/' + num;
        // ML e Shopee: o ticket normalmente e acessado dentro do proprio pedido,
        // entao aqui so realca o numero (o link do pedido ja esta no card).
        if (url) return '<a href="' + url + '" target="_blank" rel="noopener" style="color:#1565c0;font-weight:700;">🎫 ' + num + '</a>';
        return '<b>' + num + '</b>';
      });
      return esc;
    }

    // v4.29 - Magalu nao tem API de pos-venda: a reclamacao e feita num
    // formulario (Zendesk). Geramos o texto pronto e abrimos o formulario.
    // Portal: marketplacemagalu.zendesk.com/hc/pt-br/requests/new
    function magaluTextoReclamacao(pedido, produto, dias, valor) {
      const val = (valor != null && !isNaN(valor)) ? ('R$ ' + Number(valor).toFixed(2).replace('.', ',')) : 'o valor integral do pedido';
      const prod = produto ? (' referente ao produto "' + produto + '"') : '';
      const d = dias ? (' Já se passaram ' + dias + ' dias desde o início do trânsito da devolução.') : '';
      return 'Prezados,\n\n'
        + 'Referente ao pedido ' + (pedido || '(informe o número)') + prod + ', a devolução consta como enviada pelo cliente, porém NÃO foi recebida em nosso endereço até o momento.' + d + '\n\n'
        + 'Como o produto não retornou fisicamente para nós e o prazo já se esgotou, entendemos que houve extravio da devolução durante o transporte sob responsabilidade da Magalu Entregas.\n\n'
        + 'Solicitamos o ressarcimento/indenização do valor do pedido (' + val + '), uma vez que o reembolso ao cliente já foi processado e não recebemos a mercadoria de volta.\n\n'
        + 'Ficamos no aguardo de uma posição. Obrigado.';
    }

    // v4.30 - ML: reclamacao vai DENTRO do pedido (aba mensagens). Texto pronto
    // pra colar la, cobrando o extravio da devolucao.
    function mlTextoReclamacao(pedido, produto, dias, valor) {
      var val = (valor != null && !isNaN(valor)) ? ('R$ ' + Number(valor).toFixed(2).replace('.', ',')) : 'o valor do pedido';
      var prod = produto ? (' (' + produto + ')') : '';
      var d = dias ? (' Já são ' + dias + ' dias desde o início do trânsito.') : '';
      return 'Olá. A devolução deste pedido' + prod + ' consta como enviada, mas NÃO chegou até nós.' + d
        + ' Como o produto não retornou e o reembolso ao comprador já foi feito, solicitamos o ressarcimento de ' + val
        + ' referente ao extravio da devolução. Obrigado.';
    }
    function mlCopiarReclamacao(pedido, produtoB64, dias, valor) {
      var produto = ''; try { produto = produtoB64 ? decodeURIComponent(escape(atob(produtoB64))) : ''; } catch (e) {}
      var txt = mlTextoReclamacao(pedido, produto, dias, valor);
      var ok = function () { var el = document.getElementById('cpml_' + pedido); if (el) { var o = el.textContent; el.textContent = '✅ copiado!'; setTimeout(function () { el.textContent = o; }, 1800); } };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok).catch(function () { magaluCopiarFallback(txt, ok); });
      else magaluCopiarFallback(txt, ok);
    }

    function magaluCopiarReclamacao(pedido, produtoB64, dias, valor) {
      var produto = '';
      try { produto = produtoB64 ? decodeURIComponent(escape(atob(produtoB64))) : ''; } catch (e) { produto = ''; }
      var txt = magaluTextoReclamacao(pedido, produto, dias, valor);
      var ok = function () {
        var el = document.getElementById('cp_' + pedido);
        if (el) { var o = el.textContent; el.textContent = '✅ copiado!'; setTimeout(function () { el.textContent = o; }, 1800); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(ok).catch(function () { magaluCopiarFallback(txt, ok); });
      } else { magaluCopiarFallback(txt, ok); }
    }
    function magaluCopiarFallback(txt, cb) {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); if (cb) cb();
    }
