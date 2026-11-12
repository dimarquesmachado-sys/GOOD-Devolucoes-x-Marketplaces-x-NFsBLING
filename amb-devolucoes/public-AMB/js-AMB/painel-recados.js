// js-AMB/painel-recados.js — modulo do painel unico (docs/MODULARIZACAO.md, fatia 2).
//
// MOVIDO de painel-AMB.html em b680, SEM EDICAO: os dois blocos de RECADOS PRO ESTOQUISTA, na ordem em
// que estavam no <script> principal —
//   A) cache dos recados, recado da chave, a caixinha de aviso no card (alertar/salvar/remover),
//      salvar e remover recado;
//   B) edicao inline (window.editarRecado / window.salvarEdicaoRecado), abrir/fechar a lista e
//      carregarRecados.
// Carregado por <script src> ANTES do script principal; na carga so toca em `window` (o cache e as duas
// funcoes penduradas nele). O resto e chamado por clique ou pelo carregar() do painel, depois de tudo.

// @secao A
    // v3.83 - recados pro estoquista
    // v4.46 - atalho: cria recado pro estoquista JA PRESO a esta venda, do card
    // v4.47 - cache dos recados, pra cada card saber se ja tem aviso pra ele
    window._recadosCache = window._recadosCache || [];
    async function atualizarCacheRecados() {
      try {
        var r = await fetch((window.APP_BASE || '') + '/api/admin/recados');
        var d = await r.json();
        window._recadosCache = (d.ok && d.recados) ? d.recados : [];
      } catch (e) {}
    }
    function recadoDaChave(pedido, tracking) {
      var alvos = [String(pedido || ''), String(tracking || '')].filter(Boolean);
      return (window._recadosCache || []).find(function (rc) {
        return alvos.indexOf(String(rc.identificador || rc.chave || '')) !== -1;   // b218
      }) || null;
    }

    // v4.47 - abre uma CAIXINHA inline no card (nao mais popup) pra escrever/editar
    // o aviso ao estoquista. Fica no proprio card.
    function alertarEstoquista(pedido, tracking, chaveNota) {
      var area = document.getElementById('recadoArea-' + chaveNota);
      if (!area) return;
      if (area.style.display === 'block') { area.style.display = 'none'; return; }
      var chave = String(pedido || tracking || '').trim();
      var existente = recadoDaChave(pedido, tracking);
      var val = existente ? String(existente.texto || '') : '';
      area.innerHTML =
        '<div style="background:#fff5f5;border:1px solid #ffcdd2;border-radius:8px;padding:8px;margin-top:6px;">' +
        '<div style="font-size:11px;color:#c62828;font-weight:700;margin-bottom:4px;">📣 Aviso pro estoquista (aparece quando bipar esta venda):</div>' +
        '<textarea id="recadoTxt-' + chaveNota + '" rows="2" style="width:100%;box-sizing:border-box;padding:6px;border:1px solid #c9b3e6;border-radius:6px;font-size:12px;" placeholder="Ex: conferir o vidro antes de guardar — cliente reclamou que veio trincado.">' + escapeHtml(val) + '</textarea>' +
        '<div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap;">' +
          '<button onclick="salvarAlertaEstoquista(\'' + chave + '\', \'' + chaveNota + '\')" style="background:#2e7d32;color:#fff;border:none;border-radius:6px;padding:5px 11px;font-size:12px;font-weight:700;cursor:pointer;">💾 salvar aviso</button>' +
          (existente ? '<button onclick="removerAlertaEstoquista(' + existente.id + ', \'' + chaveNota + '\')" style="background:#c62828;color:#fff;border:none;border-radius:6px;padding:5px 11px;font-size:12px;font-weight:700;cursor:pointer;">🗑️ remover aviso</button>' : '') +
          '<button onclick="document.getElementById(\'recadoArea-' + chaveNota + '\').style.display=\'none\'" style="background:#999;color:#fff;border:none;border-radius:6px;padding:5px 11px;font-size:12px;cursor:pointer;">✖ fechar</button>' +
          (existente ? '<span style="font-size:11px;color:' + (existente.ciente_em ? '#2e7d32' : '#e65100') + ';align-self:center;">' + (existente.ciente_em ? '✅ já visto pelo galpão' : '⏳ ainda não lido') + '</span>' : '') +
        '</div></div>';
      area.style.display = 'block';
      var ta = document.getElementById('recadoTxt-' + chaveNota);
      if (ta) ta.focus();
    }
    async function salvarAlertaEstoquista(chave, chaveNota) {
      var ta = document.getElementById('recadoTxt-' + chaveNota);
      if (!ta) return;
      var texto = String(ta.value || '').trim();
      if (!texto) { alert('Escreva o aviso antes de salvar.'); return; }
      if (!chave) { alert('Sem identificador pra prender o aviso.'); return; }
      try {
        var r = await fetch((window.APP_BASE || '') + '/api/admin/recado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: chave, texto: texto }) });
        var d = await r.json();
        if (!d.ok) { alert(d.erro || 'erro ao salvar'); return; }
        await atualizarCacheRecados();
        var area = document.getElementById('recadoArea-' + chaveNota);
        if (area) area.style.display = 'none';
        if (typeof carregarRecados === 'function') carregarRecados();
        // feedback discreto no botao
        var btn = document.getElementById('btnAlerta-' + chaveNota);
        if (btn) { btn.textContent = '✅ aviso salvo'; setTimeout(function () { btn.textContent = '📣 aviso estoquista'; }, 2000); }
      } catch (e) { alert('erro: ' + e.message); }
    }
    async function removerAlertaEstoquista(id, chaveNota) {
      if (!confirm('Remover este aviso pro estoquista?')) return;
      try {
        await fetch((window.APP_BASE || '') + '/api/admin/recado/' + id + '/remover', { method: 'POST' });
        await atualizarCacheRecados();
        var area = document.getElementById('recadoArea-' + chaveNota);
        if (area) area.style.display = 'none';
        if (typeof carregarRecados === 'function') carregarRecados();
      } catch (e) { alert('erro: ' + e.message); }
    }

    // b224: dia, hora e quem — [stated] "adiciona pra ficar mais claro, DIA
    // E HORÁRIO e o nome de quem adicionou a informação o recado"
    function quandoRecado(rc) {
      const d = rc && rc.criado_em ? new Date(rc.criado_em) : null;
      if (!d || isNaN(d)) return 'criado por ' + escapeHtml(rc.criado_por || '-');
      const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return '🕐 ' + dia + ' ' + hora + ' · <b>' + escapeHtml(rc.criado_por || '-') + '</b>';
    }

    async function salvarRecado() {
      const chave = document.getElementById('recadoChave').value.trim();
      const texto = document.getElementById('recadoTexto').value.trim();
      const msg = document.getElementById('recadoMsg');
      if (!chave || !texto) { msg.innerHTML = '<span style="color:#c62828;">Preencha o identificador e o texto.</span>'; return; }
      const r = await fetch((window.APP_BASE || '') + '/api/admin/recado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave, texto }) });
      const d = await r.json();
      if (!d.ok) { msg.innerHTML = '<span style="color:#c62828;">❌ ' + escapeHtml(d.erro || 'erro') + '</span>'; return; }
      // b222: aviso que se VE. [stated] "é mto mínimo a mensagem de Recado
      // Criado em verde que aparece... tem como ser mais visível?"
      //
      // Era um texto verde pequeno, sem fundo, que sumia no meio da tela.
      // Agora e uma faixa verde com o texto do recado dentro, que some
      // sozinha em 6s — e o toast tambem, pra quem estiver olhando outro
      // canto da pagina.
      msg.innerHTML = '<div style="background:#2e7d32;color:#fff;padding:12px 16px;border-radius:8px;'
        + 'font-size:15px;font-weight:600;margin-top:8px;display:flex;align-items:center;gap:10px;'
        + 'box-shadow:0 2px 8px rgba(46,125,50,.35);">'
        + '<span style="font-size:22px;">✅</span>'
        + '<div>Recado criado para <b>' + escapeHtml((d.recado && d.recado.identificador) || d.chave || chave) + '</b>'
        + '<div style="font-weight:400;font-size:13px;opacity:.9;margin-top:2px;">'
        + '"' + escapeHtml(texto) + '"</div></div></div>';
      if (typeof toast === 'function') toast('✅ Recado criado — o estoquista vai ver ao bipar ' + ((d.recado && d.recado.identificador) || d.chave || chave), 'ok');
      setTimeout(() => { if (msg.innerHTML.includes('Recado criado')) msg.innerHTML = ''; }, 6000);
      document.getElementById('recadoChave').value = '';
      document.getElementById('recadoTexto').value = '';
      carregarRecados();
    }
    async function removerRecado(id) {
      await fetch((window.APP_BASE || '') + '/api/admin/recado/' + id + '/remover', { method: 'POST' });
      carregarRecados();
    }

// @secao B
    // b219 - edicao INLINE do recado (sem popup): abre um bloco com os dois
    // campos preenchidos; salvar recarrega a lista, cancelar so fecha.
    window.editarRecado = function (id) {
      var cx = document.getElementById('edRecado' + id);
      if (!cx) return;
      if (cx.innerHTML) { cx.innerHTML = ''; return; }
      var atual = (window._recadosCarregados || []).filter(function (x) { return String(x.id) === String(id); })[0] || {};
      cx.innerHTML = '<div style="background:#fff;border:1.5px solid #3C3489;border-radius:9px;padding:10px;margin-top:8px;">'
        + '<input id="edRecId' + id + '" value="' + escapeHtml(atual.identificador || atual.chave || '') + '" '
        + 'placeholder="Pedido, NF, chave ou rastreio" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ccc;border-radius:7px;font-size:13px;margin-bottom:6px;">'
        + '<textarea id="edRecTxt' + id + '" rows="3" placeholder="o recado pro estoquista" '
        + 'style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ccc;border-radius:7px;font-size:13px;">'
        + escapeHtml(atual.texto || '') + '</textarea>'
        + '<div style="display:flex;gap:7px;justify-content:flex-end;margin-top:7px;">'
        + '<button onclick="document.getElementById(\'edRecado' + id + '\').innerHTML=\'\'" '
        + 'style="border:1px solid #ccc;background:#fff;color:#555;border-radius:8px;padding:7px 13px;cursor:pointer;">Cancelar</button>'
        + '<button onclick="salvarEdicaoRecado(' + id + ')" style="border:none;background:#3C3489;color:#fff;'
        + 'border-radius:8px;padding:7px 15px;font-weight:700;cursor:pointer;">Salvar</button></div>'
        + '<div id="edRecMsg' + id + '" style="font-size:12px;margin-top:6px;"></div></div>';
    };

    window.salvarEdicaoRecado = async function (id) {
      var msg = document.getElementById('edRecMsg' + id);
      var ident = (document.getElementById('edRecId' + id) || {}).value || '';
      var texto = (document.getElementById('edRecTxt' + id) || {}).value || '';
      if (!String(ident).trim() || !String(texto).trim()) {
        if (msg) msg.innerHTML = '<span style="color:#c62828;">preencha o identificador e o texto.</span>';
        return;
      }
      if (msg) msg.innerHTML = '<span style="color:#555;">salvando…</span>';
      try {
        const r = await fetch((window.APP_BASE || '') + '/api/admin/recado/' + id, {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identificador: ident, texto: texto }),
        });
        const d = await r.json();
        if (d && d.ok) {
          // b222 (review do Codex) - o cache que o AVISO do estoquista usa
          // (recadoDaChave/alertarEstoquista) so era refeito no ciclo do
          // espreita, ate 4 min depois. Se o identificador mudou, a venda
          // antiga continuava "com recado" e a nova sem — atualiza junto.
          if (typeof atualizarCacheRecados === 'function') { try { await atualizarCacheRecados(); } catch (e) {} }
          carregarRecados();
          return;
        }
        if (msg) msg.innerHTML = '<span style="color:#c62828;">' + escapeHtml((d && d.erro) || 'não consegui salvar') + '</span>';
      } catch (e) {
        if (msg) msg.innerHTML = '<span style="color:#c62828;">erro de conexão.</span>';
      }
    };

    // b212 (pedido do Diego) - abre/fecha a lista. Ela nasce fechada: ele
    // nao quer "dezenas de recados listados" ocupando o painel toda vez.
    function alternarListaRecados() {
      var lista = document.getElementById('listaRecados');
      if (!lista) return;
      var abrindo = lista.style.display === 'none';
      lista.style.display = abrindo ? '' : 'none';
      if (abrindo) carregarRecados();
      else {
        var btnR = document.getElementById('btnVerRecados');
        var n = document.getElementById('countRecados');
        if (btnR) btnR.textContent = '📋 Ver recados criados (' + ((n && n.textContent) || 0) + ')';
      }
    }

    async function carregarRecados() {
      try {
        // b213 (review do Codex) - o endpoint devolve SO os ativos quando
        // nao se pede o contrario; sem a segunda chamada o "histórico" que
        // eu prometi no botao nunca teria numero nenhum.
        const [r, rRes] = await Promise.all([
          fetch((window.APP_BASE || '') + '/api/admin/recados'),
          fetch((window.APP_BASE || '') + '/api/admin/recados?resolvidos=1'),
        ]);
        const d = await r.json();
        const lista = document.getElementById('listaRecados');
        if (!d.ok) { lista.innerHTML = '<span style="color:#c62828;font-size:13px;">' + escapeHtml(d.erro || 'erro') + '</span>'; return; }
        let resolvidosSrv = [];
        try { const dRes = await rRes.json(); if (dRes && dRes.ok) resolvidosSrv = dRes.recados || []; } catch (e) {}
        const rs = (d.recados || []).concat(resolvidosSrv);
        window._recadosCarregados = rs;   // b219 - a edicao le o texto atual daqui
        // b213 (review do Codex) - lista vazia TAMBEM zera o contador e o
        // rotulo do botao: antes o "(3)" ficava congelado depois de remover
        // o ultimo recado, dando a entender que ainda havia aviso pendente.
        if (rs.length === 0) {
          document.getElementById('countRecados').textContent = '0';
          var btnVazio = document.getElementById('btnVerRecados');
          if (btnVazio) btnVazio.textContent = (lista.style.display === 'none' ? '📋 Ver recados criados (0)' : '🙈 Esconder recados (0)');
          lista.innerHTML = '<span style="color:#888;font-size:13px;">Nenhum recado ativo.</span>';
          return;
        }
        // (a separacao ativos/resolvidos e feita abaixo)
        let h = '';
        // v4.45 - tres estados: ATIVO (aparece na triagem), resolvido (devolucao
        // ja triada/com NF - saiu da triagem mas fica no historico), lido (o
        // estoquista deu ciencia). O resolvido tem prioridade visual (esmaecido).
        // b223: TRES grupos, nao dois. [stated] "se o estoquista já leu a
        // mensagem, já triou o pacote, tira da frente... mas que não fique
        // ali confrontando com os recados EM ABERTO que esses sim são os
        // importantes."
        //
        // Antes so `resolvido` ia pra baixo; o "ciente por Lucas" ficava em
        // cima, disputando atencao com o que ninguem leu ainda. Lido = ja
        // cumpriu o papel. Sai da frente, mas continua a um clique.
        var todosAtivos = rs.filter(function (x) { return !x.resolvido; });
        var ativos = todosAtivos.filter(function (x) { return !x.ciente_em; });   // EM ABERTO: o que importa
        var lidos = todosAtivos.filter(function (x) { return !!x.ciente_em; });   // ja cientes
        var resolvidos = rs.filter(function (x) { return x.resolvido; });
        document.getElementById('countRecados').textContent = ativos.length;
        // b212 - o botao diz quantos ha; a lista so aparece se ele abrir
        var btnR = document.getElementById('btnVerRecados');
        if (btnR) {
          var aberta = document.getElementById('listaRecados').style.display !== 'none';
          btnR.textContent = (aberta ? '🙈 Esconder recados' : '📋 Ver recados criados')
            + ' (' + ativos.length + ' em aberto'
            + (lidos.length ? ' · ' + lidos.length + ' lidos' : '')
            + (resolvidos.length ? ' · ' + resolvidos.length + ' no histórico' : '') + ')';
        }
        // b224: FUNDIR os recados do mesmo pedido. [stated] "tem como mais de
        // 1 recado, fundir em 1 só? Pq eu Diego fiz um. A Angelica fez
        // outro." — o estoquista bipa UMA vez e precisa ver os dois juntos.
        // Agrupo pelo identificador; cada recado vira uma linha do mesmo
        // card, com sua data e autor. Os botoes de cada um continuam.
        var grupos = {};
        var ordem = [];
        for (const rc of ativos) {
          var k = String(rc.identificador || rc.chave || rc.id);
          if (!grupos[k]) { grupos[k] = []; ordem.push(k); }
          grupos[k].push(rc);
        }
        for (const k of ordem) {
          const doGrupo = grupos[k];
          if (doGrupo.length > 1) {
            // card fundido: o identificador uma vez, cada recado numa linha
            h += '<div style="border:1px solid #ffcdd2;background:#fff5f5;border-radius:8px;padding:10px;margin-bottom:6px;">'
              + '<b style="font-size:15px;">' + escapeHtml(k) + '</b>'
              + ' <span style="font-size:11px;background:#c62828;color:#fff;padding:2px 7px;border-radius:10px;">' + doGrupo.length + ' recados</span>';
            for (const rc of doGrupo) {
              h += '<div style="border-left:3px solid #e57373;padding:6px 10px;margin:8px 0 0 4px;">'
                + '<span style="font-size:13px;">' + escapeHtml(rc.texto) + '</span>'
                + '<br><span style="font-size:12px;color:#666;">' + quandoRecado(rc) + ' · ⏳ ainda não lido</span> '
                + '<button onclick="editarRecado(' + rc.id + ')" style="background:#3C3489;color:#fff;border:none;border-radius:8px;padding:3px 9px;font-size:11px;cursor:pointer;margin-left:6px;">✏️</button>'
                + '<button onclick="removerRecado(' + rc.id + ')" style="background:#999;color:#fff;border:none;border-radius:8px;padding:3px 9px;font-size:11px;cursor:pointer;margin-left:4px;">✖</button>'
                + '<div id="edRecado' + rc.id + '"></div>'
                + '</div>';
            }
            h += '<a href="' + (window.APP_BASE || '') + '/?bipe=' + encodeURIComponent(k) + '" target="_blank" '
              + 'style="background:#3C3489;color:#fff;border-radius:8px;padding:5px 11px;font-size:12px;font-weight:700;'
              + 'text-decoration:none;margin-top:8px;display:inline-block;">🔎 Abrir a venda</a>'
              + '</div>';
            continue;
          }
          const rc = doGrupo[0];
          const lido = !!rc.ciente_em;
          h += '<div style="border:1px solid ' + (lido ? '#c8e6c9' : '#ffcdd2') + ';background:' + (lido ? '#f1f8e9' : '#fff5f5') + ';border-radius:8px;padding:10px;margin-bottom:6px;">'
            + '<b>' + escapeHtml(rc.identificador || rc.chave || '(sem identificador)') + '</b> · <span style="font-size:13px;">' + escapeHtml(rc.texto) + '</span>'
            + '<br><span style="font-size:12px;color:#666;">' + quandoRecado(rc)
            + ' · ' + (lido ? '✅ ciente por ' + escapeHtml(rc.ciente_por || '-') : '⏳ ainda não lido pelo galpão') + '</span> '
            // b218 (pedido do Diego: "não tenho nem como saber qual venda é")
            // - o identificador volta a aparecer (acima) E ganha o caminho de
            // um clique pra abrir a venda inteira na tela de busca: produto,
            // cliente, NF, link do marketplace, tudo que a triagem ja mostra.
            // b219 (pedido do Diego) - editar sem sair da tela: abre os campos
            // ali mesmo, com o texto e o identificador atuais preenchidos.
            + '<button onclick="editarRecado(' + rc.id + ')" style="background:#3C3489;color:#fff;border:none;'
            + 'border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;margin-left:8px;">✏️ Editar</button>'
            + '<div id="edRecado' + rc.id + '"></div>'
            + '<a href="' + (window.APP_BASE || '') + '/?bipe=' + encodeURIComponent(rc.identificador || rc.chave || '') + '" target="_blank" '
            + 'style="background:#3C3489;color:#fff;border-radius:8px;padding:5px 11px;font-size:12px;font-weight:700;'
            + 'text-decoration:none;margin-left:8px;display:inline-block;">🔎 Abrir a venda</a>'
            + '<button onclick="removerRecado(' + rc.id + ')" style="background:#999;color:#fff;border:none;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;margin-left:8px;">✖ remover</button>'
            + '</div>';
        }
        // b223: bloco dos LIDOS — recolhido, mas separado do historico, porque
        // ainda estao na triagem (so ja foram vistos)
        if (lidos.length) {
          h += '<div style="margin-top:10px;"><details><summary style="cursor:pointer;font-size:13px;color:#2e7d32;font-weight:700;">'
            + '👀 Já lidos pelo galpão (' + lidos.length + ') — o estoquista está ciente, aguardando o pacote</summary>';
          for (const rc of lidos) {
            h += '<div style="border:1px solid #c8e6c9;background:#f1f8e9;border-radius:8px;padding:9px;margin:6px 0;opacity:0.85;">'
              + '<b>' + escapeHtml(rc.identificador || rc.chave || '(sem identificador)') + '</b> · <span style="font-size:13px;">' + escapeHtml(rc.texto) + '</span>'
              + '<br><span style="font-size:12px;color:#2e7d32;">✅ ciente por ' + escapeHtml(rc.ciente_por || '-') + '</span>'
              + '<span style="font-size:12px;color:#666;"> · criado por ' + escapeHtml(rc.criado_por || '-') + '</span> '
              + '<button onclick="editarRecado(' + rc.id + ')" style="background:#3C3489;color:#fff;border:none;'
              + 'border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;margin-left:8px;">✏️ Editar</button>'
              + '<div id="edRecado' + rc.id + '"></div>'
              + '<a href="' + (window.APP_BASE || '') + '/?bipe=' + encodeURIComponent(rc.identificador || rc.chave || '') + '" target="_blank" '
              + 'style="background:#3C3489;color:#fff;border-radius:8px;padding:5px 11px;font-size:12px;font-weight:700;'
              + 'text-decoration:none;margin-left:8px;display:inline-block;">🔎 Abrir a venda</a>'
              + '<button onclick="removerRecado(' + rc.id + ')" style="background:#999;color:#fff;border:none;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;margin-left:8px;">✖ remover</button>'
              + '</div>';
          }
          h += '</details></div>';
        }
        // bloco do historico (resolvidos): recolhido, esmaecido, so pra consulta
        if (resolvidos.length) {
          h += '<div style="margin-top:10px;"><details><summary style="cursor:pointer;font-size:13px;color:#666;font-weight:700;">✅ Já resolvidos / triados (' + resolvidos.length + ') — ficam agarrados ao pedido pra consulta</summary>';
          for (const rc of resolvidos) {
            h += '<div style="border:1px solid #ddd;background:#fafafa;border-radius:8px;padding:9px;margin:6px 0;opacity:0.75;">'
              + '<b>' + escapeHtml(rc.identificador || rc.chave || '(sem identificador)') + '</b> · <span style="font-size:13px;">' + escapeHtml(rc.texto) + '</span>'
              + '<br><span style="font-size:12px;color:#2e7d32;font-weight:700;">✅ devolução já triada / NF emitida — saiu da triagem</span>'
              + '<span style="font-size:12px;color:#666;"> · criado por ' + escapeHtml(rc.criado_por || '-') + '</span> '
              // b215 (review do Codex) - o "remover" do historico NAO removia:
              // o endpoint so marca `resolvido = true`, e a linha ja estava
              // resolvida — ela sumia da tela e voltava no proximo carregamento.
              // Enquanto nao houver exclusao de verdade, o botao sai daqui.
              // b220 (review do Codex) - o historico existe pra consulta, entao
              // ele tambem precisa do caminho de um clique pra venda.
              + '<a href="' + (window.APP_BASE || '') + '/?bipe=' + encodeURIComponent(rc.identificador || rc.chave || '') + '" target="_blank" '
              + 'style="background:#3C3489;color:#fff;border-radius:8px;padding:4px 10px;font-size:11.5px;font-weight:700;'
              + 'text-decoration:none;margin-left:8px;display:inline-block;">🔎 Abrir a venda</a>'
              + '<span style="font-size:11px;color:#999;margin-left:8px;">fica no histórico</span>'
              + '</div>';
          }
          h += '</details></div>';
        }
        lista.innerHTML = h;
      } catch (e) { /* opcional */ }
    }
