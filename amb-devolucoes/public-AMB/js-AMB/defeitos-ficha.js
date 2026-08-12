// ════════════════════════════════════════════════════════════════════════
//  defeitos-ficha.js  (AMB Devol. b97)
//  ------------------------------------------------------------------
//  A TELA do ciclo do estoque de defeitos. Um arquivo so, carregado tanto
//  pela TRIAGEM quanto pelo PAINEL ADMIN - por isso ele monta o proprio
//  HTML e nao depende de nada estar na pagina.
//
//  Abre SEMPRE por cima (card), nunca leva ninguem pra outra pagina:
//    abrirBuscaDefeitos()   busca por SKU, EAN, localizacao ou produto
//    abrirFichaDefeito(id)  a ficha: fotos, historico, pecas, pedidos
//    abrirFilaPedidos()     a fila do galpao (autorizar / recusar)
//
//  A regra do Diego esta na tela tambem: pra "montei uma boa" o estoquista
//  E OBRIGADO a escolher de quais pecas tirou e escrever o que tirou de
//  cada uma - o botao so libera quando isso estiver preenchido.
// ════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var BASE = (location.pathname.indexOf('/amb') === 0) ? '/amb' : '';
  var euSouAdmin = false;
  var selecionados = {};        // defeito_id -> peca retirada (montar uma boa)
  // b115 - a ficha aberta fica AQUI. Antes eu mandava o texto atual dentro
  // do onclick com JSON.stringify: ele gera aspas DUPLAS e o atributo HTML
  // tambem usa aspas duplas, entao o atributo quebrava e o clique no lapis
  // nao chamava nada. Agora o botao passa so o id e a funcao le daqui.
  var fichaAberta = null;
  // b127 - a prateleira que esta sendo olhada: com defeito, recuperados ou
  // descartados. Sem isso a peca ja resolvida ficava no meio das outras e
  // o estoquista nao sabia em qual mexer.
  var abaAtual = 'defeito';
  // b123 - PILHA DE NAVEGACAO. Cada clique trocava a tela inteira e o unico
  // jeito de voltar era fechar e abrir de novo. Aqui guardamos por onde ele
  // passou: busca -> ficha -> outra ficha (seguindo "foi para a peca #4"),
  // e a seta desfaz passo a passo.
  var atual = null;
  var pilha = [];

  function registrar(tipo, arg, voltando) {
    if (voltando) { atual = { tipo: tipo, arg: arg }; return; }
    if (atual) pilha.push(atual);
    atual = { tipo: tipo, arg: arg };
  }

  window.voltarDefeitos = function () {
    var v = pilha.pop();
    if (!v) return;
    if (v.tipo === 'busca') abrirBuscaDefeitos(v.arg, true);
    else if (v.tipo === 'ficha') abrirFichaDefeito(v.arg, true);
    else if (v.tipo === 'fila') abrirFilaPedidos(true, v.arg === true);   // b190 - volta pra ABA em que ele estava
  };

  // b117 - aviso escrito NA TELA, no lugar de pop-up
  function avisoEm(id, txt, cor) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = txt || '';
    el.style.color = cor || '#8C1D18';
  }

  // b124 - primeira letra maiuscula no que aparece na tela. O estoquista
  // digita "teste 1" e fica "Teste 1" - sem mexer no que esta gravado.
  function capitalizar(t) {
    var x = String(t == null ? '' : t).trim();
    return x ? x.charAt(0).toUpperCase() + x.slice(1) : x;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dataBr(v) {
    if (!v) return '-';
    try { return new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
    catch (e) { return String(v); }
  }
  // b161 - relanca a entrada de estoque de um pedido (botao da ficha)
  window.relancarEstoque = async function (pedidoId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Lançando…'; }
    try {
      var r = await api('/api/defeitos/pedido/' + encodeURIComponent(pedidoId) + '/lancar-estoque',
        { method: 'POST', body: '{}' });
      if (r && r.ok) {
        alert('✅ Entrada lançada no Bling!' + (r.ja_lancado ? ' (já estava lançada)' : '')
          + (r.link ? '\n\nConfira: ' + r.link : ''));
        if (r.defeito_id && typeof abrirFichaDefeito === 'function') abrirFichaDefeito(r.defeito_id);
      } else {
        alert('❌ O Bling recusou de novo:\n\n' + ((r && r.erro) || 'erro desconhecido')
          + '\n\nSe for limite de requisições, espere 1 minuto e clique de novo.');
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Lançar estoque no Bling'; }
      }
    } catch (e) {
      alert('Erro de conexão: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Lançar estoque no Bling'; }
    }
  };

  // b166 - excluir o registro inteiro (so admin; motivo obrigatorio)
  // b168 - desfaz a exclusao (so admin)
  window.restaurarRegistro = async function (id) {
    if (!confirm('Restaurar este registro? Ele volta pra aba de origem.')) return;
    try {
      var r = await api('/api/defeitos/' + encodeURIComponent(id) + '/restaurar', { method: 'POST', body: '{}' });
      if (r && r.ok) {
        alert('↩️ Registro restaurado!');
        if (typeof abrirFichaDefeito === 'function') abrirFichaDefeito(id);
      } else {
        alert('Nao consegui restaurar: ' + ((r && r.erro) || 'erro desconhecido'));
      }
    } catch (e) { alert('Erro de conexao: ' + e.message); }
  };

  window.excluirRegistro = async function (id) {
    var motivo = prompt('EXCLUIR este registro do estoque de defeitos?\n\nEle some das listas (o historico fica guardado).\n\nMotivo da exclusao (obrigatorio):');
    if (motivo === null) return;
    motivo = String(motivo || '').trim();
    if (motivo.length < 5) { alert('Escreva o motivo (minimo 5 letras).'); return; }
    try {
      var r = await api('/api/defeitos/' + encodeURIComponent(id) + '/excluir',
        { method: 'POST', body: JSON.stringify({ motivo: motivo }) });
      if (r && r.ok) {
        alert('🚫 Registro excluido. Ele sai das listas; a ficha continua consultavel pelo historico.');
        if (typeof abrirBuscaDefeitos === 'function') abrirBuscaDefeitos();
      } else {
        alert('Nao consegui excluir: ' + ((r && r.erro) || 'erro desconhecido'));
      }
    } catch (e) { alert('Erro de conexao: ' + e.message); }
  };

  async function api(caminho, opcoes) {
    var r = await fetch(BASE + caminho, Object.assign({
      credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    }, opcoes || {}));
    return r.json();
  }

  // ── a janela (uma so, reaproveitada) ───────────────────────────────
  function caixa() {
    var d = document.getElementById('caixaDefeitos');
    if (d) return d;
    d = document.createElement('div');
    d.id = 'caixaDefeitos';
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2000;'
      + 'display:none;align-items:center;justify-content:center;padding:12px;';
    d.innerHTML = '<div id="caixaDefeitosCorpo" style="background:#fff;border-radius:14px;'
      + 'width:100%;max-width:1000px;max-height:92vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.3);"></div>';
    d.addEventListener('click', function (e) { if (e.target === d) fechar(); });
    document.body.appendChild(d);
    return d;
  }
  function abrir(html) {
    var d = caixa();
    document.getElementById('caixaDefeitosCorpo').innerHTML = html;
    d.style.display = 'flex';
  }
  function fechar() {
    var d = document.getElementById('caixaDefeitos');
    if (d) d.style.display = 'none';
    selecionados = {};
    pilha = [];
    atual = null;
  }
  window.fecharCaixaDefeitos = fechar;

  // b115 - subtitulo em negrito, escuro e com uma linha embaixo: antes era
  // cinza claro e sumia no meio do conteudo.
  function SUB(txt) {
    return '<div style="font-size:12px;font-weight:800;color:#3a3a44;letter-spacing:.6px;'
      + 'margin:16px 0 7px;padding-bottom:4px;border-bottom:2px solid #eee;">' + txt + '</div>';
  }

  function topo(titulo, extra) {
    return '<div style="position:sticky;top:0;background:#561A9E;color:#fff;padding:12px 16px;'
      + 'display:flex;align-items:center;gap:10px;z-index:2;">'
      + (pilha.length
          ? '<button onclick="voltarDefeitos()" title="voltar" style="background:rgba(255,255,255,.2);color:#fff;'
            + 'border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:15px;">&larr;</button>'
          : '')
      + '<b style="font-size:16px;flex:1;">' + titulo + '</b>'
      + (extra || '')
      + '<button onclick="fecharCaixaDefeitos()" style="background:rgba(255,255,255,.2);color:#fff;'
      + 'border:none;border-radius:8px;padding:6px 12px;cursor:pointer;">✕ Fechar</button></div>';
  }

  // ── 1) BUSCA ───────────────────────────────────────────────────────
  window.abrirBuscaDefeitos = function (termo, voltando) {
    registrar('busca', termo, voltando);
    // b128 - abriu, entao ele ja viu: o aviso do botao zera
    if (typeof window.marcarDefeitosVistos === 'function') window.marcarDefeitosVistos();
    abrir(topo('🔧 Estoque de Defeitos',
      euSouAdmin ? '<button onclick="abrirFilaPedidos()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;">📥 Solicitações</button>' : '')
      + '<div style="padding:14px;">'
      + '<div style="display:flex;gap:7px;margin-bottom:12px;">'
      + '<input id="defBusca" placeholder="SKU, EAN, localização, produto ou o número da peça (ex: peça 4)"'
      + ' style="flex:1;height:42px;font-size:14px;padding:0 12px;border:1px solid #ddd;border-radius:9px;">'
      + '<button onclick="buscarDefeitos()" style="background:#561A9E;color:#fff;border:none;border-radius:9px;padding:0 18px;font-weight:700;cursor:pointer;">Buscar</button>'
      + '</div><div id="defLista"><div style="color:#888;font-size:13px;">Digite e busque, ou veja os últimos abaixo.</div></div></div>');
    var i = document.getElementById('defBusca');
    if (i) {
      i.value = termo || '';
      i.addEventListener('keydown', function (e) { if (e.key === 'Enter') buscarDefeitos(); });
      i.focus();
    }
    buscarDefeitos();
  };

  window.buscarDefeitos = async function () {
    var el = document.getElementById('defLista');
    if (!el) return;
    var q = (document.getElementById('defBusca') || {}).value || '';
    el.innerHTML = '<div style="color:#888;font-size:13px;">procurando...</div>';
    try {
      var d = await api('/api/defeitos/lista?q=' + encodeURIComponent(q.trim())
        + '&estado=' + encodeURIComponent(abaAtual));
      var itens = d.itens || [];
      pintarAbas(d.contagem || {});
      if (!d.ok || !itens.length) {
        el.innerHTML = '<div style="color:#888;font-size:13px;">nada encontrado'
          + (d.erro ? ' (' + esc(d.erro) + ')' : '') + '.</div>';
        return;
      }
      var aviso = d.via_ean
        ? '<div style="background:#E6F1FB;color:#0C447C;border-radius:8px;padding:8px 11px;font-size:12.5px;margin-bottom:8px;">'
          + 'EAN ' + esc(d.via_ean.ean) + ' &rarr; SKU <b>' + esc(d.via_ean.sku) + '</b></div>'
        : '';
      // b110 - cada linha ganha a FOTO do produto (igual no "lancar
      // defeito") e mostra o DEFEITO sempre: quando nao ha descricao, diz
      // isso em vez de deixar um espaco vazio - que era o que fazia
      // parecer que o sistema tinha perdido a informacao.
      el.innerHTML = aviso + itens.map(function (it, i) {
        var sku = it.sku || '-';
        var laudo = String(it.laudo || '').trim();
        var selo = it.situacao === 'recuperado'
          ? '<span style="background:#E1F5EE;color:#0F6E56;border-radius:5px;padding:2px 8px;font-size:11.5px;font-weight:700;">RECUPERADA</span>'
          : (it.situacao === 'descartado'
              ? '<span style="background:#eee;color:#555;border-radius:5px;padding:2px 8px;font-size:11.5px;font-weight:700;">DESCARTADA</span>'
              : '');
        return '<div onclick="abrirFichaDefeito(\'' + esc(it.id) + '\')" '
          + 'style="border:1px solid #eee;border-left:4px solid #9E1A1A;border-radius:9px;padding:10px 12px;'
          + 'margin-bottom:7px;cursor:pointer;display:flex;gap:12px;align-items:flex-start;">'
          + '<div id="fotodef-' + i + '" data-sku="' + esc(sku) + '" '
          + 'style="width:84px;height:84px;flex:0 0 auto;border-radius:9px;background:#f2f2f7;'
          + 'border:1px solid #e4dcf1;display:flex;align-items:center;justify-content:center;font-size:26px;color:#bbb;">📦</div>'
          + '<div style="flex:1;min-width:0;">'
          + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
          + '<b style="font-size:13.5px;">📍 ' + esc(it.localizacao || 'sem local') + '</b>'
          + '<span style="background:#3C3489;color:#fff;border-radius:6px;padding:3px 10px;font-size:13px;font-weight:800;letter-spacing:.3px;">PEÇA #' + esc(it.id) + '</span>'
          + '<code style="background:#f2f2f7;border-radius:5px;padding:1px 7px;font-size:12px;">' + esc(sku) + '</code>'
          + selo
          + '<span style="margin-left:auto;background:#FBEAE8;color:#8C1D18;border-radius:11px;padding:1px 9px;font-size:11.5px;">'
          + esc(it.quantidade || 1) + ' peça(s)</span></div>'
          + '<div style="font-size:13px;margin-top:4px;font-weight:600;">' + esc(it.titulo || '') + '</div>'
          + (laudo
              ? '<div style="font-size:12.5px;color:#8C1D18;background:#FBEAE8;border-radius:7px;padding:5px 9px;margin-top:6px;">🔧 ' + esc(capitalizar(laudo)) + '</div>'
              : '<div style="font-size:12px;color:#999;margin-top:6px;font-style:italic;">Sem descrição do defeito — abra a ficha e escreva no histórico</div>')
          + (it.tem_fotos ? '<div style="font-size:11.5px;color:#777;margin-top:4px;">📷 ' + it.tem_fotos + ' foto(s)</div>' : '')
          + '</div></div>';
      }).join('');
      buscarFotosDefeitos(itens);
    } catch (e) {
      el.innerHTML = '<div style="color:#c62828;font-size:13px;">erro ao buscar</div>';
    }
  };

  /**
   * b110 - Busca a foto de cada linha DEPOIS que a lista ja apareceu. A
   * rota /api/produto/imagem aceita o SKU e cacheia no servidor, entao a
   * segunda consulta do mesmo produto e instantanea. Uma de cada vez com
   * pausa: sao chamadas ao Bling.
   */
  async function buscarFotosDefeitos(itens) {
    for (var i = 0; i < itens.length && i < 12; i++) {
      var cx = document.getElementById('fotodef-' + i);
      if (!cx || !cx.dataset.sku || cx.dataset.sku === '-') continue;
      try {
        var d = await api('/api/produto/imagem/' + encodeURIComponent(cx.dataset.sku));
        if (d && d.ok && d.imagem) {
          cx.outerHTML = '<img src="' + esc(d.imagem) + '" alt="" '
            + 'onclick="event.stopPropagation();window.open(this.src,\'_blank\')" '
            + 'onerror="this.style.display=\'none\'" '
            + 'style="width:84px;height:84px;flex:0 0 auto;border-radius:9px;object-fit:contain;'
            + 'background:#fff;border:1px solid #e4dcf1;cursor:zoom-in;">';
        }
      } catch (e) { /* sem foto nao atrapalha */ }
      await new Promise(function (r) { setTimeout(r, 140); });
    }
  }

  /** b127 - as tres prateleiras, com quantas pecas ha em cada. */
  function pintarAbas(cont) {
    var el = document.getElementById('defAbas');
    if (!el) return;
    var lista = [
      { id: 'defeito',    nome: '🔧 Com Defeito',  cor: '#9E1A1A' },
      { id: 'recuperado', nome: '✅ Recuperados',   cor: '#116B4E' },
      { id: 'descartado', nome: '🗑️ Descartados',  cor: '#555' },
      { id: 'excluido',   nome: '🚫 Excluídos',    cor: '#8C1D18' },   // b168
    ];
    el.innerHTML = lista.map(function (a) {
      var ativa = abaAtual === a.id;
      var n = cont[a.id] || 0;
      return '<button type="button" onclick="trocarAba(\'' + a.id + '\')" '
        + 'style="border:1px solid ' + (ativa ? a.cor : '#ddd') + ';background:' + (ativa ? a.cor : '#fff')
        + ';color:' + (ativa ? '#fff' : '#555') + ';border-radius:9px;padding:8px 14px;font-size:13.5px;'
        + 'font-weight:' + (ativa ? '800' : '500') + ';cursor:pointer;">'
        + a.nome + ' <span style="opacity:.8;">(' + n + ')</span></button>';
    }).join('');
  }

  window.trocarAba = function (id) {
    abaAtual = id;
    buscarDefeitos();
  };

  // ── 2) FICHA ───────────────────────────────────────────────────────
  /** b118 - HTML do historico, montado a partir da ficha em memoria. */
  function htmlHistorico() {
    if (!fichaAberta) return '';
    var it = fichaAberta.item, com = fichaAberta.comentarios || [];
    return '<div style="border-left:2px solid #eee;padding-left:12px;margin-bottom:10px;">'
      + '<div style="margin-bottom:9px;"><div style="font-size:13.5px;' + (it.laudo ? 'color:#8C1D18;font-weight:600;' : 'color:#999;font-style:italic;') + '">'
      + esc(capitalizar(it.laudo) || 'Sem descrição do defeito')
      + ' <a href="#" onclick="event.preventDefault();editarLaudo()" '
      + 'style="font-size:11.5px;color:#561A9E;text-decoration:none;">✏️ Corrigir</a>'
      // b119 - a descricao do defeito tambem ganha o 🗑️. Ela so tinha o
      // lapis, e apagar dependia de abrir, limpar o texto e salvar - coisa
      // que ninguem adivinha, ainda mais com o comentario logo abaixo
      // mostrando um 🗑️ do lado. Agora as duas linhas se comportam igual.
      // b166 - o 🗑️ da descricao de entrada SAIU (decisao do Diego): peca
      // sem defeito descrito e o cenario a evitar. Errou o registro? O
      // admin exclui o REGISTRO INTEIRO (botao no rodape da ficha).
      + '</div>'
      + '<div id="edLaudo"></div>'
      + '<div style="font-size:11.5px;color:#888;">' + esc(it.quem || '-') + ' · ' + dataBr(it.criado_em) + ' · entrada</div></div>'
      + com.map(function (c) {
          return '<div style="margin-bottom:9px;"><div style="font-size:13.5px;">' + esc(capitalizar(c.texto))
            + ' <a href="#" onclick="event.preventDefault();editarComentario(\'' + esc(c.id) + '\')" '
            + 'style="font-size:11.5px;color:#561A9E;text-decoration:none;">✏️</a>'
            + ' <a href="#" onclick="event.preventDefault();excluirComentario(\'' + esc(c.id) + '\')" '
            + 'style="font-size:11.5px;color:#8C1D18;text-decoration:none;">🗑️</a>'
            + '<div id="edCom' + esc(c.id) + '"></div></div>'
            + '<div style="font-size:11.5px;color:#888;">' + esc(c.quem || '-') + ' · ' + dataBr(c.criado_em) + '</div></div>';
        }).join('')
      + '</div>'
      + '<div style="display:flex;gap:7px;margin-bottom:4px;">'
      + '<input id="defCom" placeholder="escrever no histórico desta peça..." '
      // b121 - borda azul SEMPRE, nao so no clique: assim se enxerga que
      // ali da pra escrever, sem precisar descobrir clicando
      + 'style="flex:1;height:38px;font-size:13px;padding:0 10px;border:2px solid #7B3FC4;border-radius:8px;outline:none;">'
      + '<button onclick="comentarDefeito(\'' + esc(it.id) + '\')" style="border:1px solid #561A9E;background:#561A9E;'
      + 'color:#fff;border-radius:8px;padding:0 16px;height:38px;cursor:pointer;font-weight:600;">Adicionar</button></div>'
      + '<div id="msgCom" style="font-size:12px;color:#8C1D18;margin-bottom:12px;"></div>';
  }

  /** b120 - o que SAIU e o que ENTROU, com a direcao visivel. */
  function htmlPecas() {
    var saiu = (fichaAberta && fichaAberta.pecas_retiradas) || [];
    var entrou = (fichaAberta && fichaAberta.pecas_recebidas) || [];
    if (!saiu.length && !entrou.length) {
      return '<div style="font-size:12.5px;color:#999;margin-bottom:6px;">nada saiu nem entrou ainda.</div>';
    }
    var h = '';
    h += saiu.map(function (p) {
      return '<div style="background:#FBEAE8;border-left:3px solid #9E1A1A;border-radius:0 8px 8px 0;padding:8px 11px;font-size:13px;margin-bottom:5px;">'
        + '<b style="color:#8C1D18;">SAIU</b> ' + esc(capitalizar(p.peca))
        + (p.destino_defeito_id
            ? ' <a href="#" onclick="event.preventDefault();abrirFichaDefeito(\'' + esc(p.destino_defeito_id) + '\')" '
              + 'style="color:#561A9E;font-size:11.5px;">→ foi para a PEÇA #' + esc(p.destino_defeito_id) + '</a>'
            : (p.usada_em ? ' <span style="color:#777;font-size:11.5px;">→ ' + esc(p.usada_em) + '</span>' : ''))
        + ' <span style="color:#999;font-size:11.5px;">· ' + esc(p.quem || '-') + ' · ' + dataBr(p.criado_em) + '</span></div>';
    }).join('');
    h += entrou.map(function (p) {
      return '<div style="background:#E1F5EE;border-left:3px solid #116B4E;border-radius:0 8px 8px 0;padding:8px 11px;font-size:13px;margin-bottom:5px;">'
        + '<b style="color:#0F6E56;">ENTROU</b> ' + esc(capitalizar(p.peca))
        + ' <a href="#" onclick="event.preventDefault();abrirFichaDefeito(\'' + esc(p.defeito_id) + '\')" '
        + 'style="color:#561A9E;font-size:11.5px;">← veio da PEÇA #' + esc(p.defeito_id) + '</a>'
        + ' <span style="color:#999;font-size:11.5px;">· ' + esc(p.quem || '-') + ' · ' + dataBr(p.criado_em) + '</span></div>';
    }).join('');
    return h;
  }

  /** b120 - a frase do estado: a escrita por voce, ou a calculada. */
  function htmlEstado() {
    if (!fichaAberta) return '';
    var proprio = fichaAberta.estado_atual;
    var txt = capitalizar(proprio || fichaAberta.estado_sugerido || 'sem informação do estado');
    return '<div style="background:#FEF6E7;border-left:4px solid #EF9F27;border-radius:0 9px 9px 0;'
      + 'padding:10px 13px;margin:10px 0 4px;">'
      + '<div style="font-size:10.5px;color:#854F0B;letter-spacing:.5px;font-weight:800;margin-bottom:3px;">COMO ESTÁ AGORA</div>'
      + '<div style="font-size:14px;font-weight:600;color:#412402;">' + esc(txt)
      + ' <a href="#" onclick="event.preventDefault();editarEstado()" style="font-size:11.5px;color:#561A9E;text-decoration:none;font-weight:400;">✏️ Ajustar</a>'
      + (proprio
          ? ' <a href="#" onclick="event.preventDefault();limparEstado()" style="font-size:11.5px;color:#8C1D18;text-decoration:none;font-weight:400;">🗑️</a>'
          : '')
      + '</div>'
      + (proprio ? '' : '<div style="font-size:11px;color:#8a6d00;margin-top:3px;">calculado pelas movimentações</div>')
      + '<div id="edEstado"></div></div>';
  }

  function pintaEstado() {
    var el = document.getElementById('blocoEstado');
    if (el) el.innerHTML = htmlEstado();
  }

  /** Redesenha SO o pedaco que mudou - sem recarregar a ficha. */
  function pintaHistorico() {
    var el = document.getElementById('blocoHist');
    if (el) el.innerHTML = htmlHistorico();
  }
  function pintaPecas() {
    var el = document.getElementById('blocoPecas');
    if (el) el.innerHTML = htmlPecas();
  }

  window.abrirFichaDefeito = async function (id, voltando) {
    registrar('ficha', id, voltando);
    abrir(topo('carregando ficha...') + '<div style="padding:16px;color:#888;">um instante</div>');
    var d;
    try { d = await api('/api/defeitos/ficha/' + encodeURIComponent(id)); }
    catch (e) { d = { ok: false, erro: 'falha de conexao' }; }
    if (!d || !d.ok) {
      abrir(topo('🔧 Ficha') + '<div style="padding:16px;color:#c62828;">'
        + esc((d && d.erro) || 'não consegui abrir') + '</div>');
      return;
    }
    fichaAberta = d;
    var it = d.item, fotos = d.fotos || [], com = d.comentarios || [],
        pec = d.pecas_retiradas || [], ped = d.pedidos || [];

    // b121 - o numero da peca no titulo: e ele que voce ve no "foi para a
    // peca #4" e no dropdown, entao precisa estar visivel aqui tambem
    var html = topo('📍 ' + esc(it.localizacao || 'sem local') + ' &nbsp;<span style="opacity:.75;font-weight:400;">PEÇA #' + esc(it.id) + '</span>')
      + '<div style="padding:14px;">'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">'
      + '<code style="background:#f2f2f7;border-radius:5px;padding:2px 8px;font-size:13px;">' + esc(it.sku || '-') + '</code>'
      + '<span style="background:#FBEAE8;color:#8C1D18;border-radius:11px;padding:2px 10px;font-size:12px;">'
      + esc(it.quantidade) + ' peça(s)</span>'
      + '<span style="color:#888;font-size:12px;">NF ' + esc(it.nf_numero || '-') + ' · ' + esc(it.quem || '-') + ' · ' + dataBr(it.criado_em) + '</span></div>'
      + '<div style="font-size:15px;font-weight:600;margin-bottom:12px;">' + esc(it.titulo || '') + '</div>';

    // fotos
    // b115 - sem foto, a secao inteira SOME (nao adianta anunciar ausencia)
    if (fotos.length) {
      html += SUB('FOTOS (' + fotos.length + ')')
        + '<div style="display:flex;gap:7px;overflow-x:auto;padding-bottom:6px;margin-bottom:14px;">'
        + fotos.map(function (f) {
            return '<img src="' + esc(f) + '" alt="" onclick="window.open(this.src,\'_blank\')" '
              + 'style="width:96px;height:96px;flex:0 0 auto;object-fit:contain;background:#fff;border-radius:9px;'
              + 'border:1px solid #e4dcf1;cursor:zoom-in;">';
          }).join('') + '</div>';
    }

    // historico
    // b118 - o historico mora num bloco proprio que se redesenha sozinho.
    // Antes qualquer salvar/apagar recarregava a FICHA INTEIRA do servidor
    // e o card piscava.
    // b120 - COMO ESTA AGORA vem antes de tudo: e o que voce le pra decidir
    // se aproveita a peca. A descricao de entrada continua no historico,
    // como historia de como ela chegou.
    html += '<div id="blocoEstado">' + htmlEstado() + '</div>';

    html += SUB('HISTÓRICO DA PEÇA') + '<div id="blocoHist">' + htmlHistorico() + '</div>'
    html += SUB('PEÇAS RETIRADAS DESTA') + '<div id="blocoPecas">' + htmlPecas() + '</div>';

    // pedidos ja feitos
    if (ped.length) {
      html += SUB('PEDIDOS DESTA PEÇA')
        + ped.map(function (p) { return linhaPedido(p, false); }).join('');
    }

    // b126 - PECA FECHADA: recuperada (liberada pelo admin) ou descartada.
    // Aqui o estoquista nao tem mais nada a fazer - e pior, NAO DEVE
    // mexer. Os tres botoes somem e entra o aviso no lugar.
    // b127 - usa a situacao derivada (inclui as pecas autorizadas antes de
    // eu marcar o tipo na linha)
    var fechada = it.situacao === 'recuperado' || it.situacao === 'descartado' || it.situacao === 'excluido';   // b166
    if (fechada) {
      var recup = it.situacao === 'recuperado';
      html += '<div style="border-top:1px solid #eee;margin-top:16px;padding-top:14px;">'
        + '<div style="background:' + (recup ? '#E1F5EE' : '#FBEAE8') + ';border-left:5px solid '
        + (recup ? '#116B4E' : '#9E1A1A') + ';border-radius:0 10px 10px 0;padding:14px 16px;">'
        + '<div style="font-size:16px;font-weight:800;color:' + (recup ? '#0F6E56' : '#8C1D18') + ';">'
        + (recup ? '✅ PEÇA RECUPERADA — LIBERADA' : (it.situacao === 'excluido' ? '🚫 REGISTRO EXCLUÍDO' : '🗑️ DESCARTE AUTORIZADO')) + '</div>'
        // b168 - o admin pode DESFAZER a exclusao
        + (it.situacao === 'excluido' && euSouAdmin
            ? '<div style="margin-top:8px;"><button type="button" onclick="restaurarRegistro(\'' + esc(it.id) + '\')"'
              + ' style="background:#561A9E;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;">↩️ Restaurar registro (admin)</button></div>'
            : '')
        + '<div style="font-size:14px;margin-top:5px;color:#333;">'
        + (recup
            ? 'O admin já viu e liberou. Guarde a peça boa no armazém — não precisa mais mexer neste registro.'
            : 'O admin autorizou. Pode jogar fora.')
        + '</div></div></div>';
      abrir(html);
      return;
    }

    // acoes do estoquista
    // b112 - TRES caminhos, e nao dois. O mais comum e este primeiro:
    // tirei uma peca (um parafuso, a cupula) e a peca CONTINUA quebrada.
    // Antes so havia "montei uma boa" e "descarte" - nenhum dos dois
    // servia pra isso, e a retirada acabava nao sendo registrada.
    html += '<div style="border-top:1px solid #eee;margin-top:16px;padding-top:12px;display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button onclick="retirarPeca(\'' + esc(it.id) + '\')" '
      + 'style="flex:1;min-width:150px;background:#854F0B;color:#fff;border:none;border-radius:9px;padding:13px;font-weight:700;cursor:pointer;">🔧 Peça Retirada</button>'
      + '<button onclick="abrirMontarBoa(\'' + esc(it.id) + '\',\'' + esc(it.sku || '') + '\')" '
      + 'style="flex:1;min-width:150px;background:#116B4E;color:#fff;border:none;border-radius:9px;padding:13px;font-weight:700;cursor:pointer;">✅ Montei Uma Boa</button>'
      + '<button onclick="pedirDescarte(\'' + esc(it.id) + '\',\'' + esc(it.sku || '') + '\')" '
      + 'style="flex:1;min-width:150px;background:#9E1A1A;color:#fff;border:none;border-radius:9px;padding:13px;font-weight:700;cursor:pointer;">🗑️ Pedir Descarte</button>'
      + '</div>'
      // b166 - EXCLUIR REGISTRO (so admin, motivo obrigatorio). Soft
      // delete: o registro some das listas mas o historico fica.
      + (euSouAdmin
          ? '<div style="margin-top:10px;text-align:right;">'
            + '<a href="#" onclick="event.preventDefault();excluirRegistro(\'' + esc(it.id) + '\')" '
            + 'style="font-size:12px;color:#8C1D18;">🚫 Excluir este registro (admin)</a></div>'
          : '')
      + '<div style="display:none;">'
      + '</div>'
      + '<div id="edRetirada"></div><div id="edDescarte"></div>'
      + '</div>';
    abrir(html);
  };

  /**
   * b112 - Retirada avulsa: o estoquista tirou uma peca pra usar em outro
   * conserto, mas ESTA continua com defeito. Registra em pecas_retiradas
   * e escreve no historico - sem virar pedido nenhum, porque nao ha nada
   * pra o admin autorizar.
   */
  window.retirarPeca = async function (id) {
    // b120 - pergunta PARA ONDE a peca foi: mesmo lancamento, dois lados.
    // A lista traz as outras pecas do mesmo SKU, que e o caso real.
    var destinos = [];
    try {
      var d = await api('/api/defeitos/lista?q=' + encodeURIComponent((fichaAberta && fichaAberta.item.sku) || ''));
      destinos = (d.itens || []).filter(function (x) { return String(x.id) !== String(id); });
    } catch (e) {}
    var sel = document.getElementById('edRetirada');
    if (sel) sel.innerHTML = '';
    caixaEdicao('edRetirada', '', async function (txt, aviso) {
      if (txt.length < 2) { aviso('escreva o que foi retirado'); return; }
      var alvo = document.getElementById('destinoPeca');
      var r = await api('/api/defeitos/' + encodeURIComponent(id) + '/peca-retirada', {
        method: 'POST',
        body: JSON.stringify({
          peca: txt,
          destino_defeito_id: (alvo && alvo.value) || null,
        }),
      });
      if (!r.ok) { aviso(r.erro || 'não consegui registrar'); return; }
      if (r.registro) (fichaAberta.pecas_retiradas = fichaAberta.pecas_retiradas || []).push(r.registro);
      pintaPecas();
      pintaHistorico();
      pintaEstado();
    });
    // o seletor de destino entra dentro da caixinha que acabou de abrir
    var cx = document.getElementById('edRetirada');
    if (cx && destinos.length) {
      cx.querySelector('div').insertAdjacentHTML('beforeend',
        '<div style="margin-top:7px;font-size:12.5px;color:#555;">Foi para qual peça? '
        + '<select id="destinoPeca" style="margin-left:6px;padding:5px 8px;border:1px solid #ddd;border-radius:7px;font-size:12.5px;">'
        + '<option value="">— não foi pra outra peça —</option>'
        + destinos.map(function (x) {
            // b121 - com varias pecas iguais o dropdown ficava impossivel de
            // ler. Cada uma ja tem numero proprio (o id): mostro ele na
            // frente, com o local, a data e o defeito - que e o que
            // distingue duas luminarias iguais na prateleira.
            var quando = x.criado_em ? new Date(x.criado_em).toLocaleDateString('pt-BR') : '';
            var laudoCurto = String(x.laudo || '').slice(0, 34);
            return '<option value="' + esc(x.id) + '">PEÇA #' + esc(x.id)
              + ' · 📍 ' + esc(x.localizacao || '-')
              + (quando ? ' · ' + quando : '')
              + (laudoCurto ? ' · ' + esc(laudoCurto) : '')
              + '</option>';
          }).join('')
        + '</select></div>');
    }
  };

  window.comentarDefeito = async function (id) {
    var el = document.getElementById('defCom');
    var texto = (el && el.value || '').trim();
    if (texto.length < 2) { avisoEm('msgCom', 'escreva o comentário'); return; }
    var r = await api('/api/defeitos/' + encodeURIComponent(id) + '/comentario',
      { method: 'POST', body: JSON.stringify({ texto: texto }) });
    if (!r.ok) { avisoEm('msgCom', r.erro || 'não consegui salvar'); return; }
    if (r.comentario) (fichaAberta.comentarios = fichaAberta.comentarios || []).push(r.comentario);
    pintaHistorico();
  };

  /**
   * b114 - CORRIGIR o que ja foi escrito. Antes so dava pra acrescentar:
   * um defeito digitado errado na entrada ficava errado pra sempre. A
   * correcao fica registrada no historico, entao nao se perde o rastro.
   */
  /**
   * b116 - EDICAO NO PROPRIO CARD, sem pop-up do navegador (regra do
   * Diego). O texto vira uma caixa ali mesmo, com Salvar e Cancelar - e,
   * no caso do comentario, tambem Excluir.
   */
  function caixaEdicao(idCaixa, valor, onSalvar, onExcluir) {
    var alvo = document.getElementById(idCaixa);
    if (!alvo) return;
    if (alvo.innerHTML) { alvo.innerHTML = ''; return; }   // clicou de novo: fecha
    alvo.innerHTML =
      '<div style="margin:6px 0 4px;">'
      + '<textarea id="' + idCaixa + 'Txt" style="width:100%;box-sizing:border-box;min-height:58px;'
      + 'padding:8px 10px;border:1px solid #CECBF6;border-radius:8px;font-size:13.5px;font-family:inherit;"></textarea>'
      + '<div style="display:flex;gap:6px;margin-top:6px;">'
      + '<button type="button" onclick="' + idCaixa + 'Salvar()" style="background:#116B4E;color:#fff;border:none;'
      + 'border-radius:8px;padding:7px 14px;font-weight:600;cursor:pointer;font-size:12.5px;">Salvar</button>'
      + '<button type="button" onclick="document.getElementById(\'' + idCaixa + '\').innerHTML=\'\'" '
      + 'style="background:#eee;color:#444;border:none;border-radius:8px;padding:7px 14px;cursor:pointer;font-size:12.5px;">Cancelar</button>'
      + (onExcluir ? '<button type="button" onclick="' + idCaixa + 'Excluir()" style="margin-left:auto;background:#9E1A1A;'
          + 'color:#fff;border:none;border-radius:8px;padding:7px 14px;cursor:pointer;font-size:12.5px;">Excluir</button>' : '')
      + '</div>'
      + '<div id="' + idCaixa + 'Msg" style="font-size:12px;color:#8C1D18;margin-top:5px;"></div>'
      + '</div>';
    document.getElementById(idCaixa + 'Txt').value = valor || '';
    document.getElementById(idCaixa + 'Txt').focus();
    window[idCaixa + 'Salvar'] = function () {
      onSalvar(document.getElementById(idCaixa + 'Txt').value.trim(), function (erro) {
        var m = document.getElementById(idCaixa + 'Msg');
        if (m) m.textContent = erro || '';
      });
    };
    if (onExcluir) window[idCaixa + 'Excluir'] = onExcluir;
  }

  window.editarLaudo = function () {
    if (!fichaAberta || !fichaAberta.item) return;
    var id = fichaAberta.item.id;
    // b117 - salvar VAZIO apaga a descricao (antes eu exigia 3 letras e
    // por isso nao havia como limpar um texto escrito errado)
    caixaEdicao('edLaudo', fichaAberta.item.laudo || '', async function (txt, aviso) {
      var r = await api('/api/defeitos/' + encodeURIComponent(id) + '/laudo', {
        method: 'PUT', body: JSON.stringify({ texto: txt }),
      });
      if (!r.ok) { aviso(r.erro || 'não consegui salvar'); return; }
      fichaAberta.item.laudo = txt || null;
      if (r.registro) fichaAberta.item.laudo = r.registro.problema_descricao || null;
      pintaHistorico();
    });
  };

  window.editarEstado = function () {
    if (!fichaAberta || !fichaAberta.item) return;
    var id = fichaAberta.item.id;
    caixaEdicao('edEstado', fichaAberta.estado_atual || fichaAberta.estado_sugerido || '', async function (txt, aviso) {
      var r = await api('/api/defeitos/' + encodeURIComponent(id) + '/estado', {
        method: 'PUT', body: JSON.stringify({ texto: txt }),
      });
      if (!r.ok) { aviso(r.erro || 'não consegui salvar'); return; }
      fichaAberta.estado_atual = txt || null;
      pintaEstado();
    });
  };

  window.limparEstado = async function () {
    if (!fichaAberta || !fichaAberta.item) return;
    var r = await api('/api/defeitos/' + encodeURIComponent(fichaAberta.item.id) + '/estado', {
      method: 'PUT', body: JSON.stringify({ texto: '' }),
    });
    if (!r.ok) return;
    fichaAberta.estado_atual = null;
    pintaEstado();
  };

  window.apagarLaudo = async function () {
    if (!fichaAberta || !fichaAberta.item) return;
    var id = fichaAberta.item.id;
    var r = await api('/api/defeitos/' + encodeURIComponent(id) + '/laudo', {
      method: 'PUT', body: JSON.stringify({ texto: '' }),
    });
    if (!r.ok) { avisoEm('msgCom', r.erro || 'não consegui apagar'); return; }
    fichaAberta.item.laudo = null;
    // recarrega os comentarios pra aparecer o registro "apagou a descricao"
    try {
      var d = await api('/api/defeitos/ficha/' + encodeURIComponent(id));
      if (d && d.ok) fichaAberta.comentarios = d.comentarios || [];
    } catch (e) {}
    pintaHistorico();
  };

  window.editarComentario = function (cid) {
    if (!fichaAberta || !fichaAberta.item) return;
    var id = fichaAberta.item.id;
    var atual = (fichaAberta.comentarios || []).find(function (c) { return String(c.id) === String(cid); });
    caixaEdicao('edCom' + cid, (atual && atual.texto) || '', async function (txt, aviso) {
      if (!txt) { excluirComentario(cid); return; }   // vazio = apagar
      var r = await api('/api/defeitos/comentario/' + encodeURIComponent(cid), {
        method: 'PUT', body: JSON.stringify({ texto: txt }),
      });
      if (!r.ok) { aviso(r.erro || 'não consegui salvar'); return; }
      var alvo = (fichaAberta.comentarios || []).find(function (c) { return String(c.id) === String(cid); });
      if (alvo) alvo.texto = (r.comentario && r.comentario.texto) || txt;
      pintaHistorico();
    }, function () { excluirComentario(cid); });
  };

  window.excluirComentario = async function (cid) {
    if (!fichaAberta || !fichaAberta.item) return;
    // sem confirm: o proprio historico registra a exclusao, entao da pra
    // desfazer sabendo o que havia
    var id = fichaAberta.item.id;
    var r = await api('/api/defeitos/comentario/' + encodeURIComponent(cid), { method: 'DELETE' });
    if (!r.ok) { avisoEm('msgCom', r.erro || 'não consegui apagar'); return; }
    fichaAberta.comentarios = (fichaAberta.comentarios || [])
      .filter(function (c) { return String(c.id) !== String(cid); });
    pintaHistorico();
  };

  // ── 3) MONTEI UMA BOA (com doadores obrigatorios) ──────────────────
  window.abrirMontarBoa = async function (id, sku) {
    selecionados = {};
    var d = await api('/api/defeitos/lista?q=' + encodeURIComponent(sku || ''));
    var itens = (d.itens || []).filter(function (x) { return String(x.id) !== String(id); });
    var html = topo('🔧 Montei uma boa')
      + '<div style="padding:14px;">'
      + '<div style="background:#FEF6E7;border-left:3px solid #EF9F27;border-radius:0 8px 8px 0;padding:12px 14px;font-size:14.5px;line-height:1.45;margin-bottom:14px;">'
      + 'Marque <b>de quais peças você tirou partes</b> e escreva o que tirou de cada uma. '
      + 'Sem isso não dá pra enviar — é o que deixa registrado de onde saiu cada parte.</div>'
      + '<div style="font-size:12.5px;color:#666;letter-spacing:.4px;font-weight:700;margin-bottom:6px;">A PEÇA QUE VOCÊ MONTOU</div>'
      + '<div style="display:flex;gap:7px;margin-bottom:14px;">'
      + '<input id="boaSku" value="' + esc(sku || '') + '" placeholder="SKU do produto bom" style="flex:1;height:44px;padding:0 12px;border:1px solid #ddd;border-radius:8px;font-size:15px;">'
      + '<input id="boaQtd" type="number" min="1" value="1" style="width:76px;height:38px;padding:0 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;">'
      + '</div>'
      // b129 - conserto simples: nem sempre ele canibaliza outra peca
      + '<label style="display:flex;gap:9px;align-items:center;background:#E6F1FB;border:1px solid #b8d4ef;'
      + 'border-radius:9px;padding:11px 13px;margin-bottom:14px;cursor:pointer;font-size:14px;">'
      + '<input type="checkbox" id="soConserto" onchange="alternarSoConserto()" style="width:18px;height:18px;">'
      + '<span>Foi <b>só conserto</b> — não peguei peça de nenhuma outra</span></label>'
      + '<div id="blocoDoadores">'
      + '<div style="font-size:12.5px;color:#666;letter-spacing:.4px;font-weight:700;margin-bottom:6px;">DE ONDE VIERAM AS PARTES</div>';
    html += itens.length
      ? itens.map(function (x) {
          return '<div style="border:1px solid #eee;border-radius:9px;padding:9px 11px;margin-bottom:6px;">'
            + '<label style="display:flex;gap:8px;align-items:center;cursor:pointer;">'
            + '<input type="checkbox" onchange="marcarDoador(this,\'' + esc(x.id) + '\')">'
            + '<span style="font-size:14.5px;"><b>📍 ' + esc(x.localizacao || '-') + '</b> '
            + '<span style="background:#3C3489;color:#fff;border-radius:6px;padding:2px 9px;font-size:12px;font-weight:800;">PEÇA #' + esc(x.id) + '</span> · '
            + esc(x.titulo || '')
            + (x.laudo ? ' <span style="color:#8C1D18;font-size:11.5px;">(' + esc(String(x.laudo).slice(0, 40)) + ')</span>' : '')
            + '</span></label>'
            + '<input id="peca_' + esc(x.id) + '" placeholder="o que você tirou desta? (ex: cúpula, base)" '
            + 'oninput="marcarPeca(\'' + esc(x.id) + '\',this.value)" '
            + 'style="width:100%;height:42px;margin-top:8px;padding:0 12px;border:2px solid #7B3FC4;border-radius:8px;font-size:14px;display:none;"></div>';
        }).join('')
      : '<div style="font-size:12.5px;color:#999;">nenhuma outra peça com esse SKU no estoque de defeitos.</div>';
    html += '</div>'
      + '<textarea id="boaObs" placeholder="observação (opcional)" style="width:100%;margin-top:12px;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:13px;min-height:56px;"></textarea>'
      + '<div id="msgBoa" style="font-size:12.5px;color:#8C1D18;margin-top:8px;"></div>'
      + '<button onclick="enviarPedidoBoa(\'' + esc(id) + '\')" style="width:100%;margin-top:8px;background:#116B4E;color:#fff;border:none;border-radius:9px;padding:14px;font-weight:700;font-size:15px;cursor:pointer;">Enviar Pro Admin Lançar No Estoque</button>'
      + '</div>';
    abrir(html);
  };

  window.alternarSoConserto = function () {
    var c = document.getElementById('soConserto');
    var bloco = document.getElementById('blocoDoadores');
    if (bloco) bloco.style.display = (c && c.checked) ? 'none' : '';
    if (c && c.checked) selecionados = {};
  };

  window.marcarDoador = function (chk, id) {
    var campo = document.getElementById('peca_' + id);
    if (campo) campo.style.display = chk.checked ? '' : 'none';
    if (chk.checked) selecionados[id] = (campo && campo.value || '').trim();
    else delete selecionados[id];
  };
  window.marcarPeca = function (id, v) {
    if (selecionados[id] !== undefined) selecionados[id] = String(v || '').trim();
  };

  window.enviarPedidoBoa = async function (id) {
    var doadores = Object.keys(selecionados).map(function (k) {
      return { defeito_id: k, peca: selecionados[k] };
    });
    var c = document.getElementById('soConserto');
    var soConserto = !!(c && c.checked);
    if (!soConserto) {
      if (!doadores.length) { avisoEm('msgBoa', 'Marque de quais peças você tirou as partes — ou marque "foi só conserto".'); return; }
      var vazio = doadores.filter(function (d) { return !d.peca; });
      if (vazio.length) { avisoEm('msgBoa', 'Escreva o que você tirou de cada peça marcada.'); return; }
    }
    var r = await api('/api/defeitos/pedido', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'recuperado', defeito_id: id,
        sku: (document.getElementById('boaSku') || {}).value || '',
        titulo: (fichaAberta && fichaAberta.item && fichaAberta.item.titulo) || null,
        localizacao: (fichaAberta && fichaAberta.item && fichaAberta.item.localizacao) || null,
        quantidade: (document.getElementById('boaQtd') || {}).value || 1,
        observacao: (document.getElementById('boaObs') || {}).value || '',
        doadores: soConserto ? [] : doadores,
        sem_doadores: soConserto,
      }),
    });
    if (!r.ok) { avisoEm('msgBoa', r.erro || 'não consegui enviar'); return; }
    avisoEm('msgBoa', 'Pedido enviado — o admin vai lançar no estoque.', '#116B4E');
    setTimeout(function () { abrirFichaDefeito(id); }, 900);
  };

  window.pedirDescarte = function (id, sku) {
    caixaEdicao('edDescarte', '', async function (txt, aviso) {
      if (txt.length < 3) { aviso('escreva por que ela não serve mais'); return; }
      var r = await api('/api/defeitos/pedido', {
        method: 'POST',
        body: JSON.stringify({
        tipo: 'descarte', defeito_id: id, sku: sku, observacao: txt,
        titulo: (fichaAberta && fichaAberta.item && fichaAberta.item.titulo) || null,
        localizacao: (fichaAberta && fichaAberta.item && fichaAberta.item.localizacao) || null,
      }),
      });
      if (!r.ok) { aviso(r.erro || 'não consegui enviar'); return; }
      abrirFichaDefeito(id);
    });
  };

  // ── 4) FILA DE PEDIDOS ─────────────────────────────────────────────
  // b190 - `daAbaArquivadas` vem de QUEM renderizou, nao do estado
  // global: com duas requisicoes em voo, o global ja era o do clique novo.
  function linhaPedido(p, comAcoes, daAbaArquivadas) {
    // b191 (pedido do Diego) - a COR do card conta a historia do estoque:
    //   VERDE  = recuperada que JA entrou no estoque do Bling
    //   AMBAR  = recuperada que ainda NAO teve lancamento (e o que sobra pra fazer)
    //   VERMELHO = descarte (nao envolve entrada de estoque)
    // b192 (review do Codex) - lancamento AUTOMATICO e MANUAL contam:
    // quando a entrada automatica falha, a propria tela manda lancar a mao
    // no Bling e concluir; sem isso o card ficaria ambar pra sempre,
    // aparecendo como trabalho que ainda falta.
    // b193 (review do Codex) - NAO INVENTAR LANCAMENTO. O "Marcar Como
    // Feito" so troca o status: nao prova entrada no Bling. E solicitacao
    // RECUSADA nao e trabalho pendente. Ficaram 4 estados honestos:
    //   VERDE   estoque_produto_id -> entrada confirmada no Bling
    //   AMBAR   ainda esperando lancamento (pendente/autorizado)
    //   CINZA   fechada sem confirmacao (concluida a mao) ou recusada
    //   VERMELHO descarte
    var estoqueAuto = p.tipo === 'recuperado' && !!p.estoque_produto_id;
    var fechadaSemProva = p.tipo === 'recuperado' && !p.estoque_produto_id
      && (p.status === 'concluido' || p.status === 'recusado');
    var faltaLancar = p.tipo === 'recuperado' && !p.estoque_produto_id && !fechadaSemProva;
    var jaNoEstoque = estoqueAuto;
    var cor = p.tipo === 'descarte' ? '#9E1A1A'
      : estoqueAuto ? '#0F6E56'
      : fechadaSemProva ? '#6B6B6B'
      : '#B26A00';
    var fundoTopo = p.tipo === 'descarte' ? '#FDF7F7'
      : estoqueAuto ? '#F3FBF7'
      : fechadaSemProva ? '#F6F6F6'
      : '#FFFBF0';
    var selo = p.tipo === 'descarte'
      ? '<span style="background:#FBEAE8;color:#8C1D18;border-radius:6px;padding:2px 8px;font-size:11.5px;">DESCARTE</span>'
      : '<span style="background:#E1F5EE;color:#0F6E56;border-radius:6px;padding:2px 8px;font-size:11.5px;">RECUPERADA</span>';
    var estado = {
      pendente: '<span style="color:#8a6d00;">aguardando o admin</span>',
      autorizado: '<span style="color:#0F6E56;">autorizado — pode executar</span>',
      recusado: '<span style="color:#8C1D18;">recusado</span>',
      concluido: '<span style="color:#555;">concluído</span>',
    }[p.status] || esc(p.status);

    // b131 - o NUMERO DA PECA em faixa azul no topo do pedido. Sem isso a
    // fila virava uma lista de SKUs iguais e nao dava pra saber de qual
    // luminaria era cada pedido.
    // b191 - CONTORNO INTEIRO na cor (antes so a lateral esquerda era
    // colorida e a parte de baixo ficava aberta, sem fechar o card)
    var h = '<div style="border:2px solid ' + cor + ';border-radius:10px;overflow:hidden;margin-bottom:8px;">'
      + (p.defeito_id
          ? '<div onclick="abrirFichaDefeito(\'' + esc(p.defeito_id) + '\')" '
            + 'style="background:#3C3489;color:#fff;padding:8px 12px;font-size:15px;font-weight:800;'
            + 'letter-spacing:.4px;cursor:pointer;">PEÇA #' + esc(p.defeito_id)
            + '<span style="float:right;font-weight:400;font-size:12px;opacity:.85;">abrir ficha →</span></div>'
          : '')
      + '<div style="padding:11px;background:' + fundoTopo + ';">'
      + '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:5px;">' + selo
      + '<b style="font-size:13.5px;">' + esc(p.sku || '-') + '</b>'
      + '<span style="color:#888;font-size:11.5px;">' + esc(p.quem_pediu || '-') + ' · ' + dataBr(p.criado_em) + '</span>'
      + '<span style="margin-left:auto;font-size:12px;">' + estado + '</span>'
      // b194 (pedido do Diego) - o botao passa a se CHAMAR "Arquivar",
      // com a pastinha ao lado do nome (antes era so o icone solto, que
      // nao dizia o que fazia sem passar o mouse).
      + ((comAcoes && euSouAdmin)
          ? (daAbaArquivadas
              ? '<button type="button" title="Devolver esta solicitação para a fila" onclick="arquivarPedido(' + p.id + ',false,true)" '
                + 'style="border:1px solid #cfc7ea;background:#f4f1fb;color:#3C3489;border-radius:7px;'
                + 'padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;line-height:1.4;white-space:nowrap;">'
                + 'Desarquivar ↩️</button>'
              : '<button type="button" title="Já tratei — arquivar esta solicitação" onclick="arquivarPedido(' + p.id + ',true,false)" '
                + 'style="border:1px solid #ddd;background:#fff;color:#666;border-radius:7px;'
                + 'padding:4px 10px;font-size:12px;cursor:pointer;line-height:1.4;white-space:nowrap;">'
                + 'Arquivar 🗂️</button>')
          : '')
      + '</div>'
      + (p.titulo
          ? '<div style="font-size:14px;font-weight:600;margin:2px 0 6px;">' + esc(p.titulo) + '</div>'
          : '')
      + (p.localizacao ? '<div style="font-size:12px;color:#777;margin-bottom:5px;">📍 ' + esc(p.localizacao) + '</div>' : '')
      // b192 (review do Codex) - o selo NAO depende mais de `estoque_qtd`
      // (que so e gravado quando o pedido leva sku): quem nao distingue as
      // cores precisa LER que houve lancamento. Sem quantidade, mostra sem ela.
      + ((p.estoque_qtd || estoqueAuto)
          ? '<div style="background:#e9f7ef;border:1.5px solid #0F6E56;border-radius:9px;padding:8px 12px;margin:4px 0 7px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
            + '<b style="color:#0F6E56;font-size:14px;letter-spacing:.3px;">'
            + ('📦 LANÇADO EM ESTOQUE' + (p.estoque_qtd ? ' · ' + esc(p.estoque_qtd) + ' un.' : ''))
            + '</b>'
            + (p.estoque_produto_id
                ? '<a href="https://www.bling.com.br/estoque.php?buscaid=' + esc(p.estoque_produto_id)
                  + '" target="_blank" style="color:#561A9E;font-weight:600;font-size:12.5px;">conferir no Bling ↗</a>'
                : '')
            + '</div>'
          : '')
      // b192 - o AMBAR tambem se explica por escrito
      // b193 - o AMBAR so aparece quando a entrada AINDA E ESPERADA
      + ((faltaLancar && !p.estoque_qtd)
          ? '<div style="background:#FFF8E7;border:1.5px solid #B26A00;border-radius:9px;padding:7px 11px;margin:4px 0 7px;'
            + 'font-size:12.5px;color:#8a5200;font-weight:600;">⏳ AINDA SEM LANÇAMENTO NO ESTOQUE</div>'
          : '')
      // b193 - fechada SEM registro de entrada: diz exatamente isso, sem
      // afirmar que houve lancamento (o "Marcar Como Feito" nao prova nada)
      + ((fechadaSemProva && !p.estoque_qtd)
          ? '<div style="background:#F1F1F1;border:1.5px solid #9A9A9A;border-radius:9px;padding:7px 11px;margin:4px 0 7px;'
            + 'font-size:12.5px;color:#555;font-weight:600;">'
            + (p.status === 'recusado'
                ? '🚫 RECUSADA — nenhuma entrada de estoque prevista'
                : '✔️ FECHADA sem registro de entrada automática — confira no Bling se precisa lançar')
            + '</div>'
          : '')
      + (p.observacao ? '<div style="font-size:12.5px;color:#555;margin-bottom:6px;">' + esc(p.observacao) + '</div>' : '')
      // b161 - a entrada automatica falhou? botao de relancar (so faz
      // sentido pra RECUPERADA ja autorizada e ainda sem o id do produto)
      + ((p.tipo === 'recuperado' && (p.status === 'autorizado' || p.status === 'concluido') && !p.estoque_produto_id)
          ? '<div style="margin:4px 0 6px;"><button type="button" onclick="relancarEstoque(\'' + esc(p.id) + '\', this)"'
            + ' style="background:#0F6E56;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;">'
            + '🔄 Lançar estoque no Bling</button>'
            + ' <span style="font-size:11.5px;color:#a05a00;">a entrada automática não entrou — clique pra tentar de novo</span></div>'
          : '');

    var doa = Array.isArray(p.doadores) ? p.doadores : [];
    if (doa.length) {
      h += '<div style="font-size:12px;color:#666;margin-bottom:6px;">tirou: '
        + doa.map(function (d) { return esc(d.peca) + ' (PEÇA #' + esc(d.defeito_id) + ')'; }).join(' · ') + '</div>';
    }
    // b135 - so o ADMIN ve os botoes de decidir. O servidor ja recusava
    // (403 em autorizar/recusar), mas mostrar um botao que nao funciona e
    // pior do que nao mostrar: o estoquista clicaria achando que resolveu.
    if (comAcoes && p.status === 'pendente' && !euSouAdmin) {
      h += '<div style="font-size:12.5px;color:#8a6d00;background:#FEF6E7;border-radius:7px;'
        + 'padding:7px 10px;">⏳ Aguardando o admin liberar.</div>';
    }
    if (comAcoes && p.status === 'pendente' && euSouAdmin) {
      h += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">';
      if (p.tipo === 'recuperado') {
        // b164 - desde a b162 o botao LANCA DE VERDADE no Bling (entrada no
        // deposito Geral, com o custo do cadastro) e o pedido ja se
        // conclui sozinho. O texto do botao agora diz a verdade.
        h += '<div style="width:100%;font-size:11.5px;color:#777;margin-bottom:5px;">'
          + 'Quantas unidades boas saíram desta peça — vão entrar no depósito <b>Geral</b> do Bling:</div>'
          + '<input id="q_' + p.id + '" type="number" min="1" value="' + esc(p.quantidade || 1) + '" style="width:64px;height:34px;padding:0 8px;border:1px solid #ddd;border-radius:8px;">'
          + '<button onclick="decidirPedido(' + p.id + ',\'autorizar\')" style="flex:1;background:#116B4E;color:#fff;border:none;border-radius:8px;padding:9px;cursor:pointer;font-weight:600;">📦 Lançar Estoque no Bling</button>';
      } else {
        h += '<button onclick="decidirPedido(' + p.id + ',\'autorizar\')" style="flex:1;background:#9E1A1A;color:#fff;border:none;border-radius:8px;padding:9px;cursor:pointer;font-weight:600;">Autorizar Descarte</button>';
      }
      h += '<button onclick="decidirPedido(' + p.id + ',\'recusar\')" style="border:1px solid #ddd;background:#fff;border-radius:8px;padding:9px 14px;cursor:pointer;">Recusar</button></div>';
    }
    // b164 - recuperada COM estoque lancado nao precisa de "Marcar Como
    // Feito": o lancamento JA e a conclusao (o backend agora fecha
    // sozinho; esta condicao cobre tambem os pedidos antigos).
    if (comAcoes && p.status === 'autorizado' && !(p.tipo === 'recuperado' && p.estoque_produto_id)) {
      h += '<button onclick="decidirPedido(' + p.id + ',\'concluir\')" style="width:100%;margin-top:4px;border:1px solid #ddd;background:#fff;border-radius:8px;padding:9px;cursor:pointer;">Marcar Como Feito</button>';
    }
    // b191 - o botao saiu daqui: virou um botao PEQUENO no canto do
    // cabecalho do card (a faixa de largura total ocupava meia tela)
    return h + '</div></div>';
  }

  // b189 (pedido do Diego) - a fila ganhou DUAS ABAS: o que ainda esta na
  // frente dele e o que ele ja tratou. "Tirar da frente" nao apaga nem muda
  // status - so arquiva, e a outra aba devolve pra fila quando ele quiser.
  window.abrirFilaPedidos = async function (voltando, verArquivadas) {
    var arq = !!verArquivadas;
    window._filaArquivadas = arq;
    // b190 (review do Codex) - a aba vai na pilha de navegacao: abrir
    // uma peca a partir de "Ja tratadas" e voltar caia sempre em "Na fila".
    registrar('fila', arq, voltando);
    // b190 - resposta ATRASADA nao pinta a tela: trocar de aba antes de
    // a anterior chegar desenhava a lista velha com botoes da aba errada.
    var meuToken = (window._filaToken = (window._filaToken || 0) + 1);
    abrir(topo('📥 Solicitações do Galpão') + '<div style="padding:16px;color:#888;">carregando...</div>');
    var d = await api('/api/defeitos/pedidos' + (arq ? '?arquivados=1' : ''));
    if (meuToken !== window._filaToken) return;      // b190 - chegou tarde, ignora
    var lista = (d && d.pedidos) || [];
    var aba = function (rotulo, ativo, alvo) {
      return '<button type="button" onclick="abrirFilaPedidos(false,' + (alvo ? 'true' : 'false') + ')" '
        + 'style="border:none;border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;margin-right:7px;'
        + (ativo ? 'background:#3C3489;color:#fff;' : 'background:#eee;color:#555;') + '">' + rotulo + '</button>';
    };
    var vazio = arq
      ? 'nada arquivado ainda — o que você arquivar aparece aqui.'
      : 'nenhuma solicitação na fila. 🎉';
    var html = topo('📥 Solicitações do Galpão')
      + '<div style="padding:14px;">'
      + '<div id="filaAviso"></div>'
      + '<div style="margin-bottom:11px;">'
        + aba('⏳ Na fila', !arq, false)
        + aba('🗂️ Arquivadas', arq, true)   // b194 - era "Já tratadas"
      + '</div>'
      + (lista.length ? lista.map(function (p) { return linhaPedido(p, true, arq); }).join('')
                      : '<div style="color:#888;font-size:13px;">' + vazio + '</div>')
      + '</div>';
    abrir(html);
  };

  // b189 - tira da frente (ou devolve pra fila). SEM POPUP: o aviso de erro
  // aparece numa faixa dentro do proprio card, e a lista se recarrega.
  window.arquivarPedido = async function (id, arquivar, daAba) {
    var aviso = document.getElementById('filaAviso');
    try {
      var r = await api('/api/defeitos/pedido/' + id + '/arquivar', {
        method: 'POST', body: JSON.stringify({ arquivar: !!arquivar }),
      });
      if (r && r.ok) { abrirFilaPedidos(false, !!daAba); return; }   // b190
      if (aviso) {
        aviso.innerHTML = '<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;'
          + 'padding:9px 11px;font-size:12.5px;color:#7a5c00;margin-bottom:10px;">⚠ '
          + esc((r && r.erro) || 'não consegui') + '</div>';
      }
    } catch (e) {
      if (aviso) {
        aviso.innerHTML = '<div style="background:#fdecea;border:1px solid #f5c6c3;border-radius:8px;'
          + 'padding:9px 11px;font-size:12.5px;color:#8C1D18;margin-bottom:10px;">Erro de conexão.</div>';
      }
    }
  };

  window.decidirPedido = async function (id, acao) {
    var q = document.getElementById('q_' + id);
    var r = await api('/api/defeitos/pedido/' + id + '/decidir', {
      method: 'POST',
      body: JSON.stringify({ acao: acao, quantidade: q ? q.value : undefined }),
    });
    if (!r.ok) { alert(r.erro || 'não consegui'); return; }

    // b133 - o lancamento no Bling pode falhar sem invalidar a liberacao.
    // Aviso na hora, com o link pra conferir - ou pra lancar a mao.
    var est = r.pedido && r.pedido.estoque_bling;
    if (est) {
      if (est.ok) {
        alert('Liberado e lançado no Bling: ' + est.quantidade + ' un. no depósito Geral'
          + (est.custo ? ' · custo R$ ' + Number(est.custo).toFixed(2).replace('.', ',') + ' por unidade' : ' (SEM custo no cadastro do produto)')
          + '.');
        // b164 - NAO abre mais a aba do Bling sozinho (pedido do Diego):
        // o link "conferir a entrada" fica no card, clica quem quiser.
      } else {
        alert('Peça liberada, MAS o Bling não aceitou o lançamento:\n' + (est.erro || '')
          + '\n\nLance a entrada à mão no Bling. Ficou anotado no histórico da peça.');
      }
    }
    abrirFilaPedidos();
  };

  // descobre se quem esta logado e admin (pra mostrar a fila)
  (async function () {
    try {
      var m = await api('/api/auth/me');
      euSouAdmin = !!(m && (m.tipo === 'admin' || m.admin));
    } catch (e) {}
  })();
})();
