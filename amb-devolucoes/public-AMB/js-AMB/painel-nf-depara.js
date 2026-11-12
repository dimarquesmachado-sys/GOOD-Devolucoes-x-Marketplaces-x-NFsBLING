// js-AMB/painel-nf-depara.js — modulo do painel unico (docs/MODULARIZACAO.md, fatia 5).
//
// MOVIDO de painel-AMB.html em b684, SEM EDICAO: o indice de NFs de devolucao (carregarNFsDevolucao,
// baixarComNF, o estado window._indiceNFDev) e o de-para de SKU (alternarDepara, previaRetroativa,
// aplicarRetroativa, salvarDepara, apagarDepara).
// Carregado por <script src> ANTES do script principal; na carga so cria `window._indiceNFDev`. O resto e
// chamado por clique. No script principal, a marca `// @painel-modulo js-AMB/painel-nf-depara.js#nf-depara`
// fica no lugar de onde o bloco saiu.

// @secao nf-depara
    // v4.48 - carrega as NFs de devolucao do Bling e mostra numa tabela.
    // Modo diagnostico: mostra os campos crus + o detalhe de uma, pra o Diego
    // me dizer como a nota referencia o pedido (ai eu ligo o cruzamento auto).
    // v4.50 - carrega o indice de NFs de devolucao e cruza com o a espreita.
    // Mostra quantas devolucoes em aberto ja tem nota emitida (= resolvidas) e
    // permite dar baixa em massa. Limpa os antigos de uma vez.
    window._indiceNFDev = {};
    async function carregarNFsDevolucao() {
      var msg = document.getElementById('nfDevMsg');
      var lista = document.getElementById('listaNFsDevolucao');
      msg.innerHTML = '⏳ Consultando o Bling e cruzando com o à espreita... isso detalha ~100 notas, leva de 30s a 1min. Aguarde.';
      lista.innerHTML = '';
      try {
        // 1) monta o indice de pedidos com NF de devolucao
        var r = await fetch((window.APP_BASE || '') + '/api/admin/indice-nf-devolucao?paginas=6');   // b328 - rota DA AMB (antes chamava a da GOOD)
        var d = await r.json();
        if (!d.ok) { msg.innerHTML = '<span style="color:#c62828;">' + escapeHtml(d.erro || 'erro') + '</span>'; return; }
        window._indiceNFDev = d.pedidos || {};
        window._indiceNFDevSemPedido = d.sem_pedido || [];   // b335 - notas do Full (sem pedido)
        // b335 r4 (Codex #78): so vale como retrato se o servidor confirmar
        // (cache_ok). Build que falhou volta ok:true com pedidos:{} — e {} e
        // truthy, entao o painel marcava fresco por 15 min e abafava o retry.
        // A idade vem do servidor pra respeitar o TTL curto do build parcial.
        window._indiceNFDevOk = (d.cache_ok === true);   // b335 r2/r4
        window._indiceNFDevTs = Date.now() - (Number(d.idade_ms) || 0);   // b335 r3/r4
        try { renderizar(); } catch (e) { /* fila redesenha no proximo ciclo */ }
        var totalIndice = d.total || 0;

        // 2) pega o a espreita atual pra cruzar
        var re2 = await fetch((window.APP_BASE || '') + '/api/admin/espreita');
        var esp = await re2.json();
        var emT = (esp.em_transito || []);
        var nb = (esp.nunca_bipadas || []);
        // 29/10: as ENTREGUES (bloco 'chegou na sua matriz') tambem — e onde ficam as que alguem resolveu a mao no Bling
        var todos = emT.concat(nb).concat(esp.entregues || []).concat(esp.entregues_recentes || []);   // GOOD: entregue < 5 dias vem em entregues_recentes

        // 3) quais itens em aberto tem NF de devolucao? Pelo pedido (indice do Bling) OU pela marca do servidor, que
        // reconhece a devolucao pela NF de venda que ela referencia no XML (vale pra nota feita a mao, sem o pedido)
        var vistos = {};
        var comNF = todos.filter(function (it) {
          var ped = String(it.pedido || '').replace(/\s/g, '');
          var chave = String(it.chave_nota || it.tracking || (it.marketplace + ':' + it.pedido));
          if (vistos[chave]) return false;
          var tem = !!((ped && window._indiceNFDev[ped]) || it.nf_devolucao_xml);
          if (tem) vistos[chave] = true;
          return tem;
        });

        msg.innerHTML = '<b>' + totalIndice + '</b> pedidos com NF de devolução no Bling · <b style="color:#2e7d32;">' + comNF.length + '</b> deles ainda constam no à espreita (já resolvidos — dá pra baixar).';

        if (comNF.length === 0) {
          lista.innerHTML = '<div style="background:#e8f5e9;border-radius:8px;padding:12px;font-size:13px;color:#2e7d32;">🎉 Nenhuma devolução em aberto tem NF emitida. Tudo que já foi resolvido no Bling também já saiu do à espreita.</div>';
          return;
        }

        var h = '<div style="background:#fff5f5;border:1px solid #ffcdd2;border-radius:8px;padding:10px;margin-bottom:10px;">'
          + '<b>' + comNF.length + ' devoluções</b> ainda no à espreita já têm NF de devolução emitida — ou seja, já foram resolvidas. Você pode dar baixa em todas de uma vez:<br>'
          + '<button onclick="baixarComNF()" style="background:#c62828;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-weight:700;cursor:pointer;margin-top:8px;">🧹 Dar baixa nas ' + comNF.length + ' devoluções resolvidas</button>'
          + '<span id="baixaNFMsg" style="font-size:12px;margin-left:10px;"></span></div>';
        h += '<table style="width:100%;border-collapse:collapse;font-size:12px;">'
          + '<tr style="background:#f5f5f5;text-align:left;"><th style="padding:6px;">Marketplace</th><th style="padding:6px;">Pedido</th><th style="padding:6px;">Cliente</th><th style="padding:6px;">NF devol.</th><th style="padding:6px;">Data NF</th></tr>';
        window._comNFparaBaixar = comNF;
        for (var i = 0; i < comNF.length; i++) {
          var it = comNF[i];
          var info = window._indiceNFDev[String(it.pedido).replace(/\s/g, '')] || {};
          h += '<tr style="border-bottom:1px solid #eee;">'
            + '<td style="padding:6px;">' + escapeHtml(String(it.marketplace || '-')) + '</td>'
            + '<td style="padding:6px;"><code>' + escapeHtml(String(it.pedido || '-')) + '</code></td>'
            + '<td style="padding:6px;">' + escapeHtml(String(it.cliente || '-')) + '</td>'
            + '<td style="padding:6px;"><b>' + escapeHtml(String(info.nf || '-')) + '</b></td>'
            + '<td style="padding:6px;">' + escapeHtml(String(info.data || '-')) + '</td>'
            + '</tr>';
        }
        h += '</table>';
        lista.innerHTML = h;
      } catch (e) { msg.innerHTML = '<span style="color:#c62828;">erro: ' + escapeHtml(e.message) + '</span>'; }
    }

    // baixa em massa dos itens que tem NF de devolucao
    async function baixarComNF() {
      var comNF = window._comNFparaBaixar || [];
      if (!comNF.length) return;
      if (!confirm('Dar baixa em ' + comNF.length + ' devoluções que já têm NF emitida? Elas saem do à espreita (mas ficam no histórico).')) return;
      var bmsg = document.getElementById('baixaNFMsg');
      var ok = 0, erro = 0;
      for (var i = 0; i < comNF.length; i++) {
        bmsg.textContent = 'baixando ' + (i + 1) + '/' + comNF.length + '...';
        try {
          var chave = comNF[i].chave_nota || comNF[i].chave || String(comNF[i].tracking || (comNF[i].marketplace + ':' + comNF[i].pedido));
          var r = await fetch((window.APP_BASE || '') + '/api/admin/espreita/nota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: chave, baixado: true, comentario: 'Baixa automática: NF de devolução já emitida no Bling.' }) });
          var d = await r.json();
          if (d.ok) ok++; else erro++;
        } catch (e) { erro++; }
        await new Promise(function (res) { setTimeout(res, 100); });
      }
      bmsg.innerHTML = '<b style="color:#2e7d32;">✅ ' + ok + ' baixadas</b>' + (erro ? ' · <span style="color:#c62828;">' + erro + ' com erro</span>' : '') + '. Recarregue o à espreita.';
    }

    // b258 - de-para de SKU pela tela: lista o que existe e cadastra novo.
    async function alternarDepara() {
      var cx = document.getElementById('caixaDepara');
      if (!cx) return;
      if (cx.style.display !== 'none') { cx.style.display = 'none'; return; }
      cx.style.display = '';
      cx.innerHTML = '<div style="font-size:13px;color:#888;">carregando…</div>';
      var lista = [];
      try {
        var r = await fetch((window.APP_BASE || '') + '/api/admin/sku-depara', { credentials: 'same-origin' });
        var d = await r.json();
        if (d && d.ok) lista = d.lista || [];
      } catch (e) {}
      var linhas = lista.map(function (x) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid #eee;font-size:13px;">'
          + '<code style="background:#f3f0fa;border-radius:5px;padding:2px 6px;">' + escapeHtml(x.sku_antigo) + '</code>'
          + '<span style="color:#888;">vira</span>'
          + '<code style="background:#e8f5e9;border-radius:5px;padding:2px 6px;">' + escapeHtml(x.sku_atual) + '</code>'
          + '<button onclick="apagarDepara(\'' + escapeHtml(x.sku_antigo) + '\')" '
          + 'style="margin-left:auto;background:#fff;color:#8C1D18;border:1px solid #e0b4b0;border-radius:7px;'
          + 'padding:3px 9px;font-size:11.5px;cursor:pointer;">remover</button></div>';
      }).join('');
      cx.innerHTML = '<div style="background:#f7f5fc;border:1px solid #d6cff0;border-radius:9px;padding:12px;">'
        + '<div style="font-size:12.5px;color:#4a3f6b;margin-bottom:9px;">O anúncio Full do ML não deixa trocar o SKU depois que tem vendas. '
        + 'Quando o produto é renomeado no Bling, ligue o código antigo ao atual aqui — o app passa a tratar os dois como o mesmo produto.</div>'
        + '<div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center;">'
        + '<input id="dpAntigo" placeholder="SKU antigo (o da venda)" style="flex:1;min-width:170px;height:34px;padding:0 9px;border:1px solid #b9aee0;border-radius:7px;font-size:13px;">'
        + '<span style="color:#888;">→</span>'
        + '<input id="dpAtual" placeholder="SKU atual (o do Bling)" style="flex:1;min-width:170px;height:34px;padding:0 9px;border:1px solid #b9aee0;border-radius:7px;font-size:13px;">'
        + '<button onclick="salvarDepara()" style="background:#3C3489;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-weight:700;font-size:13px;cursor:pointer;">Ligar</button>'
        + '</div><div id="dpMsg" style="font-size:12.5px;margin-top:7px;"></div>'
        + (linhas ? '<div style="margin-top:11px;">' + linhas + '</div>'
                  : '<div style="margin-top:11px;font-size:12.5px;color:#888;">Nenhuma ligação cadastrada ainda.</div>')
        // b259 - registros gravados ANTES da ligacao ficaram com o codigo
        // aposentado; aqui ele ve QUANTOS sao e decide corrigir.
        + (lista.length ? '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed #d6cff0;">'
            + '<button onclick="previaRetroativa()" style="background:#fff;color:#3C3489;border:1px solid #b9aee0;'
            + 'border-radius:8px;padding:7px 13px;font-size:12.5px;font-weight:700;cursor:pointer;">'
            + '🕓 Registros antigos com o código velho</button>'
            + '<div id="dpRetro" style="margin-top:9px;"></div></div>' : '')
        + '</div>';
    }

    // b259 - PREVIA primeiro: mostra quantos registros mudariam e quais,
    // antes de reescrever qualquer coisa.
    async function previaRetroativa() {
      var cx = document.getElementById('dpRetro');
      if (!cx) return;
      cx.innerHTML = '<span style="font-size:12.5px;color:#888;">conferindo…</span>';
      try {
        var r = await fetch((window.APP_BASE || '') + '/api/admin/sku-depara/retroativo', { credentials: 'same-origin' });
        var d = await r.json();
        if (!d || !d.ok) { cx.innerHTML = '<span style="font-size:12.5px;color:#c62828;">' + escapeHtml((d && d.erro) || 'não consegui conferir') + '</span>'; return; }
        if (!d.total) { cx.innerHTML = '<span style="font-size:12.5px;color:#2e7d32;">✅ Nenhum registro antigo com código velho.</span>'; return; }
        var amostra = (d.registros || []).slice(0, 8).map(function (x) {
          return '<div style="font-size:12px;color:#555;padding:2px 0;">#' + escapeHtml(String(x.id)) + ' · '
            + escapeHtml(x.de) + ' → <b>' + escapeHtml(x.para) + '</b></div>';
        }).join('');
        cx.innerHTML = '<div style="background:#FFF8E1;border:1px solid #ffe082;border-radius:8px;padding:10px 12px;">'
          + '<div style="font-size:13px;color:#7a5c00;font-weight:700;margin-bottom:6px;">'
          + d.total + ' registro(s) ainda com o código antigo</div>' + amostra
          + (d.total > 8 ? '<div style="font-size:11.5px;color:#8a7a4a;margin-top:4px;">…e mais ' + (d.total - 8) + '</div>' : '')
          + '<button onclick="aplicarRetroativa()" style="margin-top:9px;background:#3C3489;color:#fff;border:none;'
          + 'border-radius:8px;padding:8px 15px;font-size:12.5px;font-weight:700;cursor:pointer;">Corrigir os ' + d.total + '</button>'
          + '</div>';
      } catch (e) { cx.innerHTML = '<span style="font-size:12.5px;color:#c62828;">erro de conexão.</span>'; }
    }

    async function aplicarRetroativa() {
      var cx = document.getElementById('dpRetro');
      if (!cx || window._retroRodando) return;
      window._retroRodando = true;
      cx.innerHTML = '<span style="font-size:12.5px;color:#555;">corrigindo…</span>';
      try {
        var r = await fetch((window.APP_BASE || '') + '/api/admin/sku-depara/retroativo', { method: 'POST', credentials: 'same-origin' });
        var d = await r.json();
        cx.innerHTML = (d && d.ok)
          ? '<span style="font-size:12.5px;color:#2e7d32;">✅ ' + (d.trocados || 0) + ' registro(s) corrigido(s)'
            + ((d.falhas && d.falhas.length) ? ' · ' + d.falhas.length + ' falharam' : '') + '</span>'
          : '<span style="font-size:12.5px;color:#c62828;">' + escapeHtml((d && d.erro) || 'não consegui corrigir') + '</span>';
      } catch (e) {
        cx.innerHTML = '<span style="font-size:12.5px;color:#c62828;">erro de conexão.</span>';
      } finally { window._retroRodando = false; }
    }

    async function salvarDepara() {
      var msg = document.getElementById('dpMsg');
      var a = (document.getElementById('dpAntigo') || {}).value || '';
      var b = (document.getElementById('dpAtual') || {}).value || '';
      if (!a.trim() || !b.trim()) { if (msg) msg.innerHTML = '<span style="color:#c62828;">preencha os dois códigos.</span>'; return; }
      if (msg) msg.innerHTML = '<span style="color:#555;">salvando…</span>';
      try {
        var r = await fetch((window.APP_BASE || '') + '/api/admin/sku-depara', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku_antigo: a.trim(), sku_atual: b.trim() }),
        });
        var d = await r.json();
        if (d && d.ok) { document.getElementById('caixaDepara').style.display = 'none'; alternarDepara(); return; }
        if (msg) msg.innerHTML = '<span style="color:#c62828;">' + escapeHtml((d && d.erro) || 'não consegui salvar') + '</span>';
      } catch (e) { if (msg) msg.innerHTML = '<span style="color:#c62828;">erro de conexão.</span>'; }
    }

    async function apagarDepara(sku) {
      try {
        await fetch((window.APP_BASE || '') + '/api/admin/sku-depara/' + encodeURIComponent(sku), { method: 'DELETE', credentials: 'same-origin' });
      } catch (e) {}
      document.getElementById('caixaDepara').style.display = 'none';
      alternarDepara();
    }
