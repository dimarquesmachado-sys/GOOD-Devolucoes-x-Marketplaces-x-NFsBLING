// js-AMB/painel-espreita.js — modulo do painel unico (docs/MODULARIZACAO.md, fatia 6).
//
// MOVIDO de painel-AMB.html em b687, SEM EDICAO: a ESPREITA (devolucoes a caminho) — em tres secoes, cada
// uma com a sua marca no lugar de onde saiu no script principal:
//   acoes  — as acoes inline no card (comentario, abrir/fechar, confirmar processado);
//   filtro — filtro, busca e ordem (window._espFiltro/_espBusca/_espOrdem) e a selecao do alerta pra NF;
//   lista  — carregarEspreita e renderEspreita.
// Carregado por <script src> ANTES do script principal; na carga so cria os quatro `window._esp*`.

// @secao acoes
    // v3.80.2 - acoes da espreita INLINE no card (zero popups)
    window._espComentarios = {};
    async function espreitaNotaPost(payload) {
      const r = await fetch((window.APP_BASE || '') + '/api/admin/espreita/nota', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      return await r.json();
    }
    function espreitaFechar(chave) {
      const area = document.getElementById('espArea-' + chave);
      if (area) { area.style.display = 'none'; area.innerHTML = ''; }
    }
    function espreitaErro(chave, msg) {
      const el = document.getElementById('espErro-' + chave);
      if (el) el.textContent = '❌ ' + msg;
    }
    function espreitaAbrir(chave, modo) {
      const area = document.getElementById('espArea-' + chave);
      if (!area) return;
      const btnCss = 'border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;';
      if (modo === 'comentar') {
        const atual = window._espComentarios[chave] || '';
        area.innerHTML = '<div style="background:#faf5ff;border:1px solid #c9b3e6;border-radius:8px;padding:10px;margin-top:8px;">'
          + '<b style="font-size:12px;color:var(--marca-texto);">💬 Comentário / tratativa com o marketplace</b>'
          + '<textarea id="espTexto-' + chave + '" rows="3" style="width:100%;box-sizing:border-box;margin-top:6px;padding:8px;border:1px solid #ccc;border-radius:8px;font-size:13px;">' + escapeHtml(atual) + '</textarea>'
          + '<div style="margin-top:6px;">'
          + '<button onclick="espreitaSalvarComentario(\'' + chave + '\')" style="background:#2e7d32;color:#fff;' + btnCss + '">💾 Salvar</button> '
          + '<button onclick="espreitaFechar(\'' + chave + '\')" style="background:#999;color:#fff;' + btnCss + '">✖ Cancelar</button>'
          + '<span id="espErro-' + chave + '" style="font-size:12px;color:#c62828;margin-left:8px;"></span>'
          + '</div></div>';
      } else {
        area.innerHTML = '<div style="background:#fff8e1;border:1px solid #ffcc80;border-radius:8px;padding:10px;margin-top:8px;">'
          + '<b style="font-size:12px;">Marcar como JÁ PROCESSADO?</b> <span style="font-size:12px;color:#666;">Some do painel (chegou antes do app, ou já tratado).</span>'
          + '<div style="margin-top:6px;">'
          + '<button onclick="espreitaConfirmarProcessado(\'' + chave + '\')" style="background:#2e7d32;color:#fff;' + btnCss + '">✅ Sim, processar</button> '
          + '<button onclick="espreitaFechar(\'' + chave + '\')" style="background:#999;color:#fff;' + btnCss + '">✖ Cancelar</button>'
          + '<span id="espErro-' + chave + '" style="font-size:12px;color:#c62828;margin-left:8px;"></span>'
          + '</div></div>';
      }
      area.style.display = '';
      const ta = document.getElementById('espTexto-' + chave);
      if (ta) ta.focus();
    }
    async function espreitaSalvarComentario(chave) {
      const ta = document.getElementById('espTexto-' + chave);
      const d = await espreitaNotaPost({ chave, comentario: String(ta ? ta.value : '') });
      if (!d.ok) return espreitaErro(chave, d.erro || 'erro desconhecido');
      carregarEspreita();
    }
    async function espreitaConfirmarProcessado(chave) {
      const d = await espreitaNotaPost({ chave, baixado: true });
      if (!d.ok) return espreitaErro(chave, d.erro || 'erro desconhecido');
      carregarEspreita();
    }

// @secao filtro
    // v3.81 - filtro/ordenacao client-side (re-render sem novo fetch)
    window._espFiltro = 'todos';
    window._espBusca = '';

    // v3.96 - selecionar itens do alerta e mandar pra fila de NF
    function alertaMarcarTodos(on) {
      document.querySelectorAll('.chkAlerta').forEach(function (c) { c.checked = on; });
    }
    async function alertaMandarParaNF() {
      const sel = [...document.querySelectorAll('.chkAlerta:checked')].map(function (c) { return c.value; });
      const msg = document.getElementById('alertaMsg');
      if (sel.length === 0) { msg.innerHTML = '<span style="color:#c62828;">Marque pelo menos um.</span>'; return; }
      if (!confirm('Mandar ' + sel.length + ' devolução(ões) pra fila "Aprovadas - aguardando NF"?\n\nElas vão aparecer lá com todos os itens da venda, pra você escolher o depósito e emitir.')) return;
      // b507 (auditoria multiempresa): a rota agora existe na AMB/Girassol, com o banco e o ML DESTA empresa
      msg.innerHTML = '<span style="color:#666;">enviando...</span>';
      try {
        const r = await fetch((window.APP_BASE || '') + '/api/admin/espreita/lancar-nf', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pedidos: sel }),
        });
        const d = await r.json();
        if (!d.ok) { msg.innerHTML = '<span style="color:#c62828;">' + escapeHtml(d.erro || 'erro') + '</span>'; return; }
        let t = '<span style="color:#2e7d32;">✅ ' + d.criados + ' na fila de NF</span>';
        if ((d.ja_existiam || []).length) t += ' <span style="color:#666;">· ' + d.ja_existiam.length + ' já tinham registro</span>';
        if ((d.sem_nf || []).length) t += ' <span style="color:#c62828;">· ⚠️ ' + d.sem_nf.length + ' SEM NF: ' + d.sem_nf.join(', ') + '</span>';
        if ((d.falhas || []).length) t += ' <span style="color:#c62828;">· ' + d.falhas.length + ' falharam</span>';
        if ((d.restantes || []).length) t += ' <span style="color:#e65100;">· ⏳ faltam ' + d.restantes.length + ' (tempo esgotado): marque de novo e envie — os já criados são pulados</span>';
        msg.innerHTML = t;
        setTimeout(function () { carregar(); }, 1800);
      } catch (e) { msg.innerHTML = '<span style="color:#c62828;">erro de conexão</span>'; }
    }
    function espreitaBuscar(v) {
      window._espBusca = String(v || '').trim().toUpperCase();
      if (window._espDados) renderEspreita(window._espDados);
    }
    window._espOrdem = 'antigas'; // 'antigas' = mais dias primeiro | 'novas' = menos dias primeiro
    function espreitaFiltrar(f) { window._espFiltro = f; if (window._espDados) renderEspreita(window._espDados); }
    function espreitaOrdenar() { window._espOrdem = (window._espOrdem === 'antigas') ? 'novas' : 'antigas'; if (window._espDados) renderEspreita(window._espDados); }

// @secao lista
    async function carregarEspreita() {
      atualizarCacheRecados();
      try {
        const r = await fetch((window.APP_BASE || '') + '/api/admin/espreita');
        const d = await r.json();
        const sec = document.getElementById('secaoEspreita');
        const lista = document.getElementById('listaEspreita');
        // v3.80.3 - indice frio (logo apos deploy) NAO some mais: avisa e re-tenta
        if (!d.ok || !d.quente) {
          // b204 - o aviso passa a DIZER O MOTIVO por fonte. Antes ficava
          // "aquecendo" pra sempre sem explicar qual indice estava frio,
          // desligado ou com erro — e o Diego so via a tela vazia.
          document.getElementById('countEspreita').textContent = '…';
          // b205 (review do Codex) - o painel exige apenas LOGIN, entao o
          // texto cru do erro (proxy Shopee, API, indice) nao vai pra tela:
          // o estoquista ve "indisponivel agora" e o detalhe fica no console
          // pro Diego. Sem isso, qualquer conta logada leria a mensagem crua.
          var f = (d && d.fontes) || {};
          try { console.info('[ESPREITA] fontes:', JSON.parse(JSON.stringify(f))); } catch (e) {}
          var linhaFonte = function (nome, o) {
            o = o || {};
            var estado = o.quente ? '<span style="color:#0F6E56;">pronta</span>'
              : o.desligada ? '<span style="color:#8C1D18;">desligada' + (o.falta ? ' — falta ' + escapeHtml(String(o.falta)) : '') + '</span>'
              : o.construindo ? '<span style="color:#8a5200;">montando o índice…</span>'
              : o.erro ? '<span style="color:#8C1D18;">indisponível agora</span>'
              : '<span style="color:#8a5200;">índice frio</span>';
            return '<div style="padding:2px 0;"><b>' + nome + ':</b> ' + estado + '</div>';
          };
          lista.innerHTML = '<div style="background:#FFFBF0;border:1px solid #ffe082;border-radius:9px;padding:10px 12px;font-size:12.5px;color:#7a5c00;">'
            + '<div style="margin-bottom:6px;">⏳ Ainda não dá pra montar a lista — atualiza sozinho a cada 45s.</div>'
            + linhaFonte('Mercado Livre', f.ml)
            + linhaFonte('Shopee', f.shopee)
            + linhaFonte('Magalu', f.magalu)
            + linhaFonte('Índice de nomes', f.nomes)
            + '</div>';
          sec.style.display = '';
          setTimeout(carregarEspreita, 45000);
          return;
        }
        window._espDados = d;
        renderEspreita(d);
      } catch (e) {
        // v3.83.1 - antes o erro era engolido e a secao sumia sem explicacao
        console.error('[ESPREITA] falhou:', e);
        const sec = document.getElementById('secaoEspreita');
        const lista = document.getElementById('listaEspreita');
        if (sec && lista) {
          lista.innerHTML = '<p style="color:#c62828;font-size:13px;">⚠️ Erro ao montar o painel: ' + escapeHtml(String(e && e.message || e)) + '</p>';
          sec.style.display = '';
        }
      }
    }

    function renderEspreita(d) {
        const sec = document.getElementById('secaoEspreita');
        const lista = document.getElementById('listaEspreita');
        window._espComentarios = {};
        const emT = d.em_transito || [];
        const atras = d.atrasadas_30d || [];
        document.getElementById('countEspreita').textContent = emT.length;
        window._espUltima = new Date();
        if (emT.length === 0 && (d.entregues || d.nunca_bipadas || []).length === 0) {
          lista.innerHTML = '<p style="color:#888;font-size:13px;">Nenhuma devolução a caminho. 🎉</p>';
          sec.style.display = '';
          return;
        }
        // v3.78 - link direto pra venda/devolucao no marketplace
        const linkVenda = (e) => {
          if (e.marketplace === 'ml' && e.pedido) return 'https://www.mercadolivre.com.br/vendas/' + encodeURIComponent(e.pedido) + '/detalhe';
          if (e.marketplace === 'shopee' && e.pedido) return e.link_marketplace || null;   // b399 // v3.80 - de-para order_sn->id interno, cai DENTRO do pedido
          if (e.marketplace === 'magalu') {
            // v4.36 - com o UUID da entrega em maos (deliveries[0].id, descoberto
            // via HAR), montamos o link DIRETO pro portal do seller - sem depender
            // do redirect externo.
            if (e.pedido && e.magalu_delivery_uuid) return 'https://seller.magalu.com/pedidos/' + encodeURIComponent(e.pedido) + '/' + encodeURIComponent(e.magalu_delivery_uuid);
            // v3.92 - fallback: redirect oficial que resolve o uuid no servico Mover Pedidos
            if (e.pedido) return e.link_marketplace || null;   // b399
            // fallback: sem numero do pedido, cai no portal de devolucoes por uuid
            if (e.uuid && e.categoria === 'agencia') return 'https://seller.magaluentregas.com.br/gestao-de-devolucoes/detalhes?id=' + encodeURIComponent(e.uuid) + '&type=' + encodeURIComponent(e.tipo || 'CUSTOMER_RETURN') + '&category=orders';
            return 'https://seller.magaluentregas.com.br/gestao-de-devolucoes';
          }
          return null;
        };
        const MKT = {
          magalu: { nome: 'Magalu', cor: '#1565c0' },
          ml: { nome: 'Mercado Livre', cor: '#f9a825' },
          shopee: { nome: 'Shopee', cor: '#e65100' },
        };
        // b521 (Codex): fonte quente COM erro = lista antiga na tela; avisa (o texto cru do erro fica no console, ver b205)
        const fm = (d.fontes && d.fontes.magalu) || {};
        if (fm.erro) { try { console.info('[ESPREITA] magalu:', String(fm.erro)); } catch (e) {} }
        const avisoMagalu = fm.erro
          ? '<div style="background:#FFFBF0;border:1px solid #ffe082;border-radius:9px;padding:8px 12px;margin-bottom:8px;font-size:12.5px;color:#7a5c00;">⚠️ Magalu indisponível agora — a lista do Magalu pode estar desatualizada' + (fm.idade_min != null ? ' (última atualização há ' + escapeHtml(String(fm.idade_min)) + ' min)' : '') + '.</div>'
          : '';
        let html = avisoMagalu + '<p style="font-size:13px;color:#666;margin:4px 0 10px;">' +
          (window._espBusca ? '🔍 <b>filtrando por "' + escapeHtml(window._espBusca) + '"</b> · ' : '') +
          '<span style="color:#888;">🕐 atualizado ' + (window._espUltima ? window._espUltima.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '') + ' · atualiza sozinho a cada 4 min</span> · ' +
          '🚚 <b>' + emT.length + '</b> em trânsito · ⏰ <b style="color:#c62828;">' + atras.length + '</b> atrasada(s) +30d' +
          (d.ml_aguardando_postagem ? ' · 🏷️ ' + d.ml_aguardando_postagem + ' ML aguardando o cliente postar' : '') +
          (d.magalu_chegadas_30d ? ' · 📥 ' + d.magalu_chegadas_30d + ' Magalu chegaram em 30d' : '') +
          (d.shopee_recebidas_baixadas ? ' · ✅ ' + d.shopee_recebidas_baixadas + ' Shopee já bipadas (baixa automática)' : '') +
          (d.baixadas_manuais ? ' · 🧹 ' + d.baixadas_manuais + ' baixadas manualmente' : '') + '</p>';
        // v3.82 - bloco de alerta: consta ENTREGUE e ninguem bipou aqui
        const nb = d.entregues || d.nunca_bipadas || [];
        if (nb.length > 0) {
          html += '<div style="border:2px solid #c62828;border-radius:10px;padding:12px;margin-bottom:14px;background:#fff5f5;">'
            + '<b style="color:#c62828;">🚨 Consta ENTREGUE no marketplace, mas ninguém bipou aqui (' + nb.length + ')</b>'
            + '<div style="font-size:12px;color:#666;margin:4px 0 8px;">Confere no galpão: pode estar guardado sem registro — ou não chegou de verdade.</div>'
            + '<div style="margin:6px 0 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
            + '<label style="font-size:12px;"><input type="checkbox" onchange="alertaMarcarTodos(this.checked)"> marcar todos</label>'
            + '<button onclick="alertaMandarParaNF()" style="background:#1565c0;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;">📥 Mandar selecionados pra fila de NF</button>'
            + '<span id="alertaMsg" style="font-size:12px;"></span>'
            + '</div>';
          for (const e of nb) {
            const m = MKT[e.marketplace] || { nome: e.marketplace, cor: '#616161' };
            html += '<div style="border-left:4px solid ' + m.cor + ';background:#fff;border-radius:8px;padding:8px 10px;margin-bottom:6px;">'
              + '<span style="background:' + m.cor + ';color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">' + m.nome + '</span> '
              + (e.pedido && e.marketplace === 'ml' ? '<input type="checkbox" class="chkAlerta" value="' + escapeHtml(String(e.pedido)) + '" style="margin-right:7px;transform:scale(1.2);"> ' : '')
              + '<b>' + escapeHtml(String(e.pedido || e.tracking || '-')) + '</b>'
              + (e.pack_id ? ' · <span style="font-size:11px;color:#555;">pack <code>' + escapeHtml(String(e.pack_id)) + '</code></span>' : '')
              + (e.pedido && e.tracking ? ' · <code style="font-size:11px;">' + escapeHtml(String(e.tracking)) + '</code>' : '')
              + (e.valor != null ? ' · R$ ' + Number(e.valor).toFixed(2).replace('.', ',') : '')
              + (linkVenda(e) ? ' <a href="' + linkVenda(e) + '" target="_blank" rel="noopener" style="background:#1565c0;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;text-decoration:none;margin-left:6px;">🔗 abrir</a>' : '')
              + (e.marketplace === 'magalu' ? magaluProtocolosHtml(e) : '') // v4.46 - protocolos na linha do abrir (alerta)
              + '<br><span style="font-size:12px;color:#555;">Entregue há <b>' + (e.dias_desde != null ? e.dias_desde : '?') + ' dia(s)</b> · sem triagem no sistema'
              + (e.cliente ? ' · 👤 ' + escapeHtml(e.cliente) : '')
              // b607 - porte da GOOD (b236.7): venda num PACK com varios pedidos — o sistema NAO chuta qual voltou (NF e
              // produto errados seriam piores que nada), mas o card DIZ isso e o que fazer, senao parece bug.
              + (e.pack_varios_pedidos
                  ? ' · <span style="color:#e65100;" title="A venda tem ' + escapeHtml(String(e.pack_varios_pedidos))
                    + ' pedidos no mesmo pack. Nao da pra saber qual voltou sem abrir no ML — por isso nao mostro NF e produto, pra nao arriscar o errado.">'
                    + '📦 pack com ' + escapeHtml(String(e.pack_varios_pedidos)) + ' pedidos — abra no ML pra ver qual voltou</span>'
                  : '') + (e.nf ? ' · 🧾 NF ' + escapeHtml(String(e.nf)) : '') + (e.logistica ? ' · <span style="background:#455a64;color:#fff;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;">' + escapeHtml(e.logistica) + (e.nf_devolucao ? ' · <span style="background:#2e7d32;color:#fff;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:800;">✅ NF DEVOLUÇÃO ' + escapeHtml(String(e.nf_devolucao.nf || '')) + '</span>' : '') + '</span>' : '') + (e.nf_devolucao ? ' · <span style="background:#2e7d32;color:#fff;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:800;">✅ NF DEVOLUÇÃO ' + escapeHtml(String(e.nf_devolucao.nf || '')) + '</span>' : '') + '</span>'
              + ((e.itens && e.itens.length)
                  ? '<div style="font-size:12px;color:#333;margin-top:4px;background:#fff;border-radius:6px;padding:5px 8px;">'
                    + e.itens.map(function (it) {
                        return '📦 <b>' + (it.qtd || 1) + '×</b> ' + escapeHtml(it.titulo || '-')
                          + (it.sku ? ' · <code style="font-size:11px;">' + escapeHtml(it.sku) + '</code>' : '');
                      }).join('<br>')
                    + '</div>'
                  : (e.produto ? '<br><span style="font-size:12px;color:#333;">📦 ' + escapeHtml(e.produto) + (e.qtd ? ' ×' + e.qtd : '') +
                      ((e.sku || e.valor_nf != null) ? '<br><span style="color:#555;">' + (e.sku ? '🏷️ ' + escapeHtml(String(e.sku)) + '  ' : '') + (e.valor_nf != null ? '💵 NF R$ ' + Number(e.valor_nf).toFixed(2).replace('.', ',') : '') + '</span>' : '') +
                      '</span>' : ''))
              + (e.comentario ? '<div style="font-size:12px;color:var(--marca-texto);background:#f3e5f5;border-radius:6px;padding:6px 8px;margin-top:6px;">💬 ' + comentarioComLinks(e.comentario, e.marketplace) + '</div>' : '')
              + '<div style="margin-top:6px;">'
              + '<button onclick="espreitaAbrir(\'' + e.chave_nota + '\', \'processar\')" style="background:#2e7d32;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;">✓ achei / já processado</button> '
              + '<button onclick="espreitaAbrir(\'' + e.chave_nota + '\', \'comentar\')" style="background:var(--marca);color:var(--sobre-marca);border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;">💬 ' + (e.comentario ? 'editar comentário' : 'comentário') + '</button>'
              + ' <button id="btnAlerta-' + e.chave_nota + '" onclick="alertarEstoquista(\'' + escapeHtml(String(e.pedido || '')) + '\', \'' + escapeHtml(String(e.tracking || '')) + '\', \'' + e.chave_nota + '\')" style="background:#c62828;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;">📣 ' + (recadoDaChave(e.pedido, e.tracking) ? 'aviso ✔' : 'aviso estoquista') + '</button>'
              + '</div>'
              + (e.marketplace === 'magalu' && e.ticket ? (
                  '<div style="margin-top:5px;font-size:11px;color:#555;">🎫 Ticket: <a href="' + magaluLinkTicket(e.ticket) + '" target="_blank" rel="noopener" style="color:#1565c0;font-weight:700;text-decoration:none;">' + escapeHtml(String(e.ticket)) + '</a>'
                  + ' <button title="alterar" onclick="magaluEditarTicket(\'' + escapeHtml(String(e.chave_nota)) + '\', \'' + escapeHtml(String(e.ticket)) + '\')" style="background:none;border:none;cursor:pointer;font-size:12px;">✏️</button>'
                  + ' <button title="apagar" onclick="magaluApagarTicket(\'' + escapeHtml(String(e.chave_nota)) + '\')" style="background:none;border:none;cursor:pointer;font-size:12px;">🗑️</button></div>'
                ) : '')
              + (e.marketplace === 'magalu' && !e.ticket ? (
                  '<div style="margin-top:5px;background:#eef;border-radius:8px;padding:6px 9px;">'
                  + '<span style="font-size:11px;color:#555;font-weight:700;">🎫 Nº do ticket:</span> '
                  + '<input id="tk_' + escapeHtml(String(e.chave_nota)) + '" placeholder="cole o protocolo" style="width:130px;padding:4px 7px;border:1px solid #c9b3e6;border-radius:6px;font-size:12px;">'
                  + ' <button onclick="magaluSalvarTicket(\'' + escapeHtml(String(e.chave_nota)) + '\')" style="background:var(--marca);color:var(--sobre-marca);border:none;border-radius:6px;padding:4px 9px;font-size:12px;font-weight:700;cursor:pointer;">salvar ticket</button></div>'
                ) : '')
              + '<div id="espArea-' + e.chave_nota + '" style="display:none;"></div>' + '<div id="recadoArea-' + e.chave_nota + '" style="display:none;"></div></div>';
            window._espComentarios[e.chave_nota] = e.comentario || '';
          }
          html += '</div>';
        }

        const F = window._espFiltro || 'todos';
        let itens = (F === 'todos') ? emT : emT.filter(x => x.marketplace === F);
        // v3.95 - busca por texto (com 45 itens, o Ctrl+F nao dava conta)
        const _q = window._espBusca || '';
        if (_q) {
          itens = itens.filter(function (x) {
            return [x.pedido, x.tracking, x.nf, x.cliente, x.produto, x.pack_id, x.status]
              .some(function (v) { return String(v == null ? '' : v).toUpperCase().indexOf(_q) >= 0; });
          });
        }
        itens = [...itens].sort((x, y) => (window._espOrdem === 'novas')
          ? ((x.dias_em_transito || 0) - (y.dias_em_transito || 0))
          : ((y.dias_em_transito || 0) - (x.dias_em_transito || 0)));
        const fb = (id, rot, cor) => '<button onclick="espreitaFiltrar(\'' + id + '\')" style="border:none;border-radius:14px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;margin-right:6px;background:' + (F === id ? cor : '#e0e0e0') + ';color:' + (F === id ? '#fff' : '#555') + ';">' + rot + '</button>';
        html += '<div style="margin:2px 0 8px;">'
          + '<input type="text" id="espBuscaInput" value="' + escapeHtml(window._espBusca || '') + '" placeholder="🔍 Filtrar por pedido, rastreio, NF, cliente ou produto..." '
          + 'oninput="espreitaBuscar(this.value)" '
          + 'style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #ccc;border-radius:8px;font-size:14px;">'
          + '</div>';
        html += '<div style="margin:2px 0 10px;">'
          + fb('todos', 'Todos (' + emT.length + ')', '#37474f')
          + fb('ml', 'Mercado Livre (' + emT.filter(x => x.marketplace === 'ml').length + ')', '#f9a825')
          + fb('magalu', 'Magalu (' + emT.filter(x => x.marketplace === 'magalu').length + ')', '#1565c0')
          + fb('shopee', 'Shopee (' + emT.filter(x => x.marketplace === 'shopee').length + ')', '#e65100')
          + '<button onclick="espreitaOrdenar()" style="border:1px solid var(--marca);background:#fff;color:var(--marca-texto);border-radius:14px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;">' + (window._espOrdem === 'antigas' ? '⌛ mais antigas primeiro' : '🕐 mais recentes primeiro') + ' ↕</button>'
          + '</div>';
        for (const e of itens) {
          const m = MKT[e.marketplace] || { nome: e.marketplace || '?', cor: '#616161' };
          const atrasada = (e.dias_em_transito || 0) > 30;
          html += '<div style="border:1px solid ' + (atrasada ? '#ef9a9a' : '#c9b3e6') + ';border-left:5px solid ' + (atrasada ? '#c62828' : 'var(--marca)') + ';border-radius:8px;padding:10px 12px;margin-bottom:8px;background:' + (atrasada ? '#fff5f5' : '#faf5ff') + ';">' +
            '<span style="background:' + m.cor + ';color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">' + m.nome + '</span> ' +
            '<b>' + escapeHtml(String(e.pedido || e.tracking || '-')) + '</b>' +
            (e.pack_id ? ' · <span style="font-size:11px;color:#555;">pack <code>' + escapeHtml(String(e.pack_id)) + '</code></span>' : '') +
            (e.pedido && e.tracking ? ' · <code style="font-size:11px;">' + escapeHtml(String(e.tracking)) + '</code>' : '') +
            (e.valor != null ? ' · R$ ' + Number(e.valor).toFixed(2).replace('.', ',') : '') +
            (linkVenda(e) ? ' <a href="' + linkVenda(e) + '" target="_blank" rel="noopener" style="background:#1565c0;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;text-decoration:none;margin-left:6px;">🔗 abrir</a>' : '') +
            (e.marketplace === 'magalu' ? magaluProtocolosHtml(e) : '') + // v4.46 - protocolos na linha do abrir
            '<br><span style="font-size:12px;color:#555;">' +
            (e.dias_em_transito != null ? 'Em trânsito há <b>' + e.dias_em_transito + ' dia(s)</b>' : 'Em trânsito') +
            (e.status ? ' · ' + escapeHtml(String(e.status)) : '') +
            // b607 - porte da GOOD (b236.8): o pack ambiguo tambem no card EM TRANSITO — mesma frase, mesmo motivo
            (e.pack_varios_pedidos
              ? ' · <span style="color:#e65100;" title="A venda tem ' + escapeHtml(String(e.pack_varios_pedidos))
                + ' pedidos no mesmo pack. Nao da pra saber qual voltou sem abrir no ML.">'
                + '📦 pack com ' + escapeHtml(String(e.pack_varios_pedidos)) + ' pedidos — abra no ML pra ver qual voltou</span>'
              : '') +
            (e.chegou_cd ? ' — <b style="color:#00695c;">🏭 em revisão no CD do ML (ainda não despachado pra você)</b>' : (e.no_cd_ml ? ' — <b style="color:#00695c;">🚚 a caminho do CD do ML (ainda não chegou lá)</b>' : (e.congelada ? ' — <b style="color:#616161;">🧊 status congelado na Shopee, confirmar no 🔗</b>' : (atrasada ? ' — <b style="color:#c62828;">⚠️ candidata a extravio, cobrar o marketplace</b>' : '')))) + '</span>' +
            // v4.43 - linha 1: cliente + NF + logistica juntos (NF so aqui, uma vez)
            ((e.cliente || e.nf || e.logistica || e.dinheiro) ?
              '<br><span style="font-size:12px;color:#333;">' +
              (e.cliente ? '👤 ' + escapeHtml(e.cliente) + '  ' : '') +
              (e.nf ? '🧾 NF ' + escapeHtml(String(e.nf)) + '  ' : '') +
              (e.logistica ? '<span style="background:#455a64;color:#fff;padding:1px 7px;border-radius:8px;font-size:11px;font-weight:700;">' + escapeHtml(e.logistica) + '</span>  ' : '') +
              (e.dinheiro === 'retido_com_voce' ? '💰 <b style="color:#2e7d32;">dinheiro retido com você</b>' :
               e.dinheiro === 'estornado_cliente' ? '↩️ <b style="color:#e65100;">dinheiro estornado ao cliente</b>' : '') +
              '</span>' : '') +
            // v4.50 - selo verde quando ja tem NF de devolucao emitida no Bling
            (e.nf_devolucao ? '<br><span style="background:#2e7d32;color:#fff;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:800;">✅ TEM NF DE DEVOLUÇÃO — NF ' + escapeHtml(String(e.nf_devolucao.nf || '')) + ' de ' + escapeHtml(String(e.nf_devolucao.data || '')) + '</span> <span style="font-size:11px;color:#666;">(já resolvida — pode dar baixa)</span>' : '') +
            // v4.43 - linha 2: produto + qtd + SKU + valor da NF (sem repetir a NF)
            ((e.produto || e.sku || e.valor_nf != null) ?
              '<br><span style="font-size:12px;color:#333;">' +
              (e.produto ? '📦 ' + escapeHtml(e.produto) + (e.qtd ? ' <b>×' + e.qtd + '</b>' : '') : '') +
              ((e.sku || e.valor_nf != null) ? '<br><span style="color:#555;">' +
                (e.sku ? '🏷️ SKU <code>' + escapeHtml(String(e.sku)) + '</code>  ' : '') +
                (e.valor_nf != null ? '💵 NF R$ ' + Number(e.valor_nf).toFixed(2).replace('.', ',') : '') +
              '</span>' : '') +
              '</span>' : '') +
            (e.comentario ? '<div style="font-size:12px;color:var(--marca-texto);background:#f3e5f5;border-radius:6px;padding:6px 8px;margin-top:6px;">💬 ' + comentarioComLinks(e.comentario, e.marketplace) + '</div>' : '') +
            '<div style="margin-top:6px;">' +
              '<button onclick="espreitaAbrir(\'' + e.chave_nota + '\', \'processar\')" style="background:#2e7d32;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;">✓ já processado</button> ' +
              '<button onclick="espreitaAbrir(\'' + e.chave_nota + '\', \'comentar\')" style="background:var(--marca);color:var(--sobre-marca);border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;">💬 ' + (e.comentario ? 'editar comentário' : 'comentário') + '</button>' +
              ' <button id="btnAlerta-' + e.chave_nota + '" onclick="alertarEstoquista(\'' + escapeHtml(String(e.pedido || '')) + '\', \'' + escapeHtml(String(e.tracking || '')) + '\', \'' + e.chave_nota + '\')" style="background:#c62828;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;">📣 ' + (recadoDaChave(e.pedido, e.tracking) ? 'aviso ✔' : 'aviso estoquista') + '</button>' +
            // v4.30 - ML: link pra mensagens DENTRO do pedido + texto pronto pra colar
            (e.marketplace === 'ml' && e.pedido ? (
              ' <a href="https://www.mercadolivre.com.br/vendas/novo/mensagens/' + encodeURIComponent(e.pedido) + '" target="_blank" rel="noopener" style="background:#f9a825;color:#000;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;text-decoration:none;">💬 mensagens do pedido</a>' +
              ' <button id="cpml_' + escapeHtml(String(e.pedido)) + '" onclick="mlCopiarReclamacao(\'' + escapeHtml(String(e.pedido)) + '\', \'' + btoa(unescape(encodeURIComponent(String(e.produto || '')))) + '\', ' + (e.dias_em_transito || 0) + ', ' + (e.valor != null ? Number(e.valor) : 'null') + ')" style="background:#00695c;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;">📋 copiar texto</button>'
            ) : '') +
            // v4.30 - Shopee: link pro pedido (o 🔗 ja resolve o de-para order_sn->id interno)
            (e.marketplace === 'shopee' && e.pedido ? (
              ' <a href="https://mover-pedidos-aguardando-x-atendido.onrender.com/' + (window.APP_PASTA_CHECKOUT || 'amb-checkout-offline') + '/ir-shopee?sn=' + encodeURIComponent(e.pedido) + '" target="_blank" rel="noopener" style="background:#e65100;color:#fff;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;text-decoration:none;">📦 abrir pedido Shopee</a>'
            ) : '') +
            // v4.46 - TICKET MANUAL: sempre presente pra Magalu, num bloco proprio
            // (separado do comentario). Se tem ticket salvo -> link + editar/apagar,
            // SEM caixinha e SEM botao de abrir nova. Se nao tem -> so a caixinha.
            // v4.46 - TICKET: se JA TEM, so uma linha discreta com o link + editar/apagar.
            // se NAO TEM, a caixinha pra colar + copiar texto. Sem quadro grande quando ja salvo.
            (e.marketplace === 'magalu' && e.ticket ? (
              '<div style="margin-top:6px;font-size:11px;color:#555;">' +
                '🎫 Ticket: <a href="' + magaluLinkTicket(e.ticket) + '" target="_blank" rel="noopener" style="color:#1565c0;font-weight:700;text-decoration:none;">' + escapeHtml(String(e.ticket)) + '</a>' +
                ' <button title="alterar" onclick="magaluEditarTicket(\'' + escapeHtml(String(e.chave_nota)) + '\', \'' + escapeHtml(String(e.ticket)) + '\')" style="background:none;border:none;cursor:pointer;font-size:12px;">✏️</button>' +
                ' <button title="apagar" onclick="magaluApagarTicket(\'' + escapeHtml(String(e.chave_nota)) + '\')" style="background:none;border:none;cursor:pointer;font-size:12px;">🗑️</button>' +
              '</div>'
            ) : '') +
            (e.marketplace === 'magalu' && !e.ticket ? (
              '<div style="margin-top:6px;background:#eef;border-radius:8px;padding:6px 9px;">' +
                '<span style="font-size:11px;color:#555;font-weight:700;">🎫 Nº do ticket:</span> ' +
                '<input id="tk_' + escapeHtml(String(e.chave_nota)) + '" placeholder="cole o protocolo" style="width:130px;padding:4px 7px;border:1px solid #c9b3e6;border-radius:6px;font-size:12px;">' +
                ' <button onclick="magaluSalvarTicket(\'' + escapeHtml(String(e.chave_nota)) + '\')" style="background:var(--marca);color:var(--sobre-marca);border:none;border-radius:6px;padding:4px 9px;font-size:12px;font-weight:700;cursor:pointer;">salvar ticket</button>' +
                ' <button id="cp_' + escapeHtml(String(e.pedido || '')) + '" onclick="magaluCopiarReclamacao(\'' + escapeHtml(String(e.pedido || '')) + '\', \'' + btoa(unescape(encodeURIComponent(String(e.produto || '')))) + '\', ' + (e.dias_em_transito || 0) + ', ' + (e.valor != null ? Number(e.valor) : 'null') + ')" style="background:#00695c;color:#fff;border:none;border-radius:6px;padding:4px 9px;font-size:11px;font-weight:700;cursor:pointer;">📋 copiar texto</button>' +
              '</div>'
            ) : '') +
            '</div>' +
            '<div id="espArea-' + e.chave_nota + '" style="display:none;"></div>' + '<div id="recadoArea-' + e.chave_nota + '" style="display:none;"></div></div>';
          window._espComentarios[e.chave_nota] = e.comentario || '';
        }
        lista.innerHTML = html;
        sec.style.display = '';
        // devolve o foco e o cursor pro campo (o render recria o input)
        if (window._espBusca) {
          const inp = document.getElementById('espBuscaInput');
          if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
        }
    }
