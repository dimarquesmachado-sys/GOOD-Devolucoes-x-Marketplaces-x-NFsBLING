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
      + 'width:100%;max-width:860px;max-height:92vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.3);"></div>';
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
      + '<b style="font-size:16px;flex:1;">' + titulo + '</b>'
      + (extra || '')
      + '<button onclick="fecharCaixaDefeitos()" style="background:rgba(255,255,255,.2);color:#fff;'
      + 'border:none;border-radius:8px;padding:6px 12px;cursor:pointer;">✕ Fechar</button></div>';
  }

  // ── 1) BUSCA ───────────────────────────────────────────────────────
  window.abrirBuscaDefeitos = function (termo) {
    abrir(topo('🔧 Estoque de Defeitos',
      euSouAdmin ? '<button onclick="abrirFilaPedidos()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;">📥 Pedidos</button>' : '')
      + '<div style="padding:14px;">'
      + '<div style="display:flex;gap:7px;margin-bottom:12px;">'
      + '<input id="defBusca" placeholder="SKU, EAN, localização ou nome do produto"'
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
      var d = await api('/api/defeitos/lista?q=' + encodeURIComponent(q.trim()));
      var itens = d.itens || [];
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
        return '<div onclick="abrirFichaDefeito(\'' + esc(it.id) + '\')" '
          + 'style="border:1px solid #eee;border-left:4px solid #9E1A1A;border-radius:9px;padding:10px 12px;'
          + 'margin-bottom:7px;cursor:pointer;display:flex;gap:12px;align-items:flex-start;">'
          + '<div id="fotodef-' + i + '" data-sku="' + esc(sku) + '" '
          + 'style="width:84px;height:84px;flex:0 0 auto;border-radius:9px;background:#f2f2f7;'
          + 'border:1px solid #e4dcf1;display:flex;align-items:center;justify-content:center;font-size:26px;color:#bbb;">📦</div>'
          + '<div style="flex:1;min-width:0;">'
          + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
          + '<b style="font-size:13.5px;">📍 ' + esc(it.localizacao || 'sem local') + '</b>'
          + '<code style="background:#f2f2f7;border-radius:5px;padding:1px 7px;font-size:12px;">' + esc(sku) + '</code>'
          + '<span style="margin-left:auto;background:#FBEAE8;color:#8C1D18;border-radius:11px;padding:1px 9px;font-size:11.5px;">'
          + esc(it.quantidade || 1) + ' peça(s)</span></div>'
          + '<div style="font-size:13px;margin-top:4px;font-weight:600;">' + esc(it.titulo || '') + '</div>'
          + (laudo
              ? '<div style="font-size:12.5px;color:#8C1D18;background:#FBEAE8;border-radius:7px;padding:5px 9px;margin-top:6px;">🔧 ' + esc(laudo) + '</div>'
              : '<div style="font-size:12px;color:#999;margin-top:6px;font-style:italic;">sem descrição do defeito — abra a ficha e escreva no histórico</div>')
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

  // ── 2) FICHA ───────────────────────────────────────────────────────
  window.abrirFichaDefeito = async function (id) {
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

    var html = topo('📍 ' + esc(it.localizacao || 'sem local'))
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
    html += SUB('HISTÓRICO DA PEÇA')
      + '<div style="border-left:2px solid #eee;padding-left:12px;margin-bottom:10px;">'
      + '<div style="margin-bottom:9px;"><div style="font-size:13.5px;' + (it.laudo ? 'color:#8C1D18;font-weight:600;' : 'color:#999;font-style:italic;') + '">'
      + esc(it.laudo || 'sem descrição do defeito')
      + ' <a href="#" onclick="event.preventDefault();corrigirLaudo()" '
      + 'style="font-size:11.5px;color:#561A9E;text-decoration:none;">✏️ Corrigir</a></div>'
      + '<div style="font-size:11.5px;color:#888;">' + esc(it.quem || '-') + ' · ' + dataBr(it.criado_em) + ' · entrada</div></div>'
      + com.map(function (c) {
          return '<div style="margin-bottom:9px;"><div style="font-size:13.5px;">' + esc(c.texto)
            + ' <a href="#" onclick="event.preventDefault();corrigirComentario(\'' + esc(c.id) + '\')" '
            + 'style="font-size:11.5px;color:#561A9E;text-decoration:none;">✏️</a></div>'
            + '<div style="font-size:11.5px;color:#888;">' + esc(c.quem || '-') + ' · ' + dataBr(c.criado_em) + '</div></div>';
        }).join('')
      + '</div>'
      + '<div style="display:flex;gap:7px;margin-bottom:14px;">'
      + '<input id="defCom" placeholder="escrever no histórico desta peça..." '
      + 'style="flex:1;height:38px;font-size:13px;padding:0 10px;border:1px solid #ddd;border-radius:8px;">'
      + '<button onclick="comentarDefeito(\'' + esc(it.id) + '\')" style="border:1px solid #561A9E;background:#561A9E;'
      + 'color:#fff;border-radius:8px;padding:0 16px;height:38px;cursor:pointer;font-weight:600;">Adicionar</button></div>';

    // pecas retiradas
    html += SUB('PEÇAS RETIRADAS DESTA');
    html += pec.length
      ? pec.map(function (p) {
          return '<div style="background:#f7f7fa;border-radius:8px;padding:8px 11px;font-size:13px;margin-bottom:5px;">'
            + '🔧 <b>' + esc(p.peca) + '</b>'
            + (p.usada_em ? ' <span style="color:#777;font-size:11.5px;">→ ' + esc(p.usada_em) + '</span>' : '')
            + ' <span style="color:#999;font-size:11.5px;">· ' + esc(p.quem || '-') + ' · ' + dataBr(p.criado_em) + '</span></div>';
        }).join('')
      : '<div style="font-size:12.5px;color:#999;margin-bottom:6px;">nada foi retirado ainda.</div>';

    // pedidos ja feitos
    if (ped.length) {
      html += SUB('PEDIDOS DESTA PEÇA')
        + ped.map(function (p) { return linhaPedido(p, false); }).join('');
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
      + '</div></div>';
    abrir(html);
  };

  /**
   * b112 - Retirada avulsa: o estoquista tirou uma peca pra usar em outro
   * conserto, mas ESTA continua com defeito. Registra em pecas_retiradas
   * e escreve no historico - sem virar pedido nenhum, porque nao ha nada
   * pra o admin autorizar.
   */
  window.retirarPeca = async function (id) {
    var peca = prompt('O que você retirou desta peça? (ex: parafuso, cúpula, lâmpada)');
    if (peca === null) return;
    peca = String(peca).trim();
    if (peca.length < 2) { alert('escreva o que foi retirado'); return; }
    var onde = prompt('Usou em quê? (opcional — ex: NF 076823, ou a peça que consertou)') || '';
    var r = await api('/api/defeitos/' + encodeURIComponent(id) + '/peca-retirada', {
      method: 'POST',
      body: JSON.stringify({ peca: peca, usada_em: String(onde).trim() || null }),
    });
    if (!r.ok) { alert(r.erro || 'não consegui registrar'); return; }
    abrirFichaDefeito(id);
  };

  window.comentarDefeito = async function (id) {
    var el = document.getElementById('defCom');
    var texto = (el && el.value || '').trim();
    if (texto.length < 2) { alert('escreva o comentário'); return; }
    var r = await api('/api/defeitos/' + encodeURIComponent(id) + '/comentario',
      { method: 'POST', body: JSON.stringify({ texto: texto }) });
    if (!r.ok) { alert(r.erro || 'não consegui salvar'); return; }
    abrirFichaDefeito(id);
  };

  /**
   * b114 - CORRIGIR o que ja foi escrito. Antes so dava pra acrescentar:
   * um defeito digitado errado na entrada ficava errado pra sempre. A
   * correcao fica registrada no historico, entao nao se perde o rastro.
   */
  window.corrigirLaudo = async function () {
    if (!fichaAberta || !fichaAberta.item) return;
    var id = fichaAberta.item.id;
    var novo = prompt('Descrição do defeito:', fichaAberta.item.laudo || '');
    if (novo === null) return;
    novo = String(novo).trim();
    if (novo.length < 3) { alert('escreva a descrição do defeito'); return; }
    var r = await api('/api/defeitos/' + encodeURIComponent(id) + '/laudo', {
      method: 'PUT', body: JSON.stringify({ texto: novo }),
    });
    if (!r.ok) { alert(r.erro || 'não consegui corrigir'); return; }
    abrirFichaDefeito(id);
  };

  window.corrigirComentario = async function (cid) {
    if (!fichaAberta || !fichaAberta.item) return;
    var id = fichaAberta.item.id;
    var atual = (fichaAberta.comentarios || []).find(function (c) { return String(c.id) === String(cid); });
    var novo = prompt('Corrigir o texto:', (atual && atual.texto) || '');
    if (novo === null) return;
    novo = String(novo).trim();
    if (novo.length < 2) { alert('escreva o texto'); return; }
    var r = await api('/api/defeitos/comentario/' + encodeURIComponent(cid), {
      method: 'PUT', body: JSON.stringify({ texto: novo }),
    });
    if (!r.ok) { alert(r.erro || 'não consegui corrigir'); return; }
    abrirFichaDefeito(id);
  };

  // ── 3) MONTEI UMA BOA (com doadores obrigatorios) ──────────────────
  window.abrirMontarBoa = async function (id, sku) {
    selecionados = {};
    var d = await api('/api/defeitos/lista?q=' + encodeURIComponent(sku || ''));
    var itens = (d.itens || []).filter(function (x) { return String(x.id) !== String(id); });
    var html = topo('🔧 Montei uma boa')
      + '<div style="padding:14px;">'
      + '<div style="background:#FEF6E7;border-left:3px solid #EF9F27;border-radius:0 8px 8px 0;padding:10px 12px;font-size:13px;margin-bottom:12px;">'
      + 'Marque <b>de quais peças você tirou partes</b> e escreva o que tirou de cada uma. '
      + 'Sem isso não dá pra enviar — é o que deixa registrado de onde saiu cada parte.</div>'
      + '<div style="font-size:11px;color:#888;letter-spacing:.4px;margin-bottom:6px;">A PEÇA QUE VOCÊ MONTOU</div>'
      + '<div style="display:flex;gap:7px;margin-bottom:14px;">'
      + '<input id="boaSku" value="' + esc(sku || '') + '" placeholder="SKU do produto bom" style="flex:1;height:38px;padding:0 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;">'
      + '<input id="boaQtd" type="number" min="1" value="1" style="width:76px;height:38px;padding:0 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;">'
      + '</div>'
      + '<div style="font-size:11px;color:#888;letter-spacing:.4px;margin-bottom:6px;">DE ONDE VIERAM AS PARTES</div>';
    html += itens.length
      ? itens.map(function (x) {
          return '<div style="border:1px solid #eee;border-radius:9px;padding:9px 11px;margin-bottom:6px;">'
            + '<label style="display:flex;gap:8px;align-items:center;cursor:pointer;">'
            + '<input type="checkbox" onchange="marcarDoador(this,\'' + esc(x.id) + '\')">'
            + '<span style="font-size:13px;"><b>📍 ' + esc(x.localizacao || '-') + '</b> · '
            + esc(x.titulo || '') + '</span></label>'
            + '<input id="peca_' + esc(x.id) + '" placeholder="o que você tirou desta? (ex: cúpula, base)" '
            + 'oninput="marcarPeca(\'' + esc(x.id) + '\',this.value)" '
            + 'style="width:100%;height:34px;margin-top:7px;padding:0 10px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;display:none;"></div>';
        }).join('')
      : '<div style="font-size:12.5px;color:#999;">nenhuma outra peça com esse SKU no estoque de defeitos.</div>';
    html += '<textarea id="boaObs" placeholder="observação (opcional)" style="width:100%;margin-top:12px;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:13px;min-height:56px;"></textarea>'
      + '<button onclick="enviarPedidoBoa(\'' + esc(id) + '\')" style="width:100%;margin-top:12px;background:#116B4E;color:#fff;border:none;border-radius:9px;padding:14px;font-weight:700;font-size:15px;cursor:pointer;">Enviar Pro Admin Lançar No Estoque</button>'
      + '</div>';
    abrir(html);
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
    if (!doadores.length) { alert('Marque de quais peças você tirou as partes.'); return; }
    var vazio = doadores.filter(function (d) { return !d.peca; });
    if (vazio.length) { alert('Escreva o que você tirou de cada peça marcada.'); return; }
    var r = await api('/api/defeitos/pedido', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'recuperado', defeito_id: id,
        sku: (document.getElementById('boaSku') || {}).value || '',
        quantidade: (document.getElementById('boaQtd') || {}).value || 1,
        observacao: (document.getElementById('boaObs') || {}).value || '',
        doadores: doadores,
      }),
    });
    if (!r.ok) { alert(r.erro || 'não consegui enviar'); return; }
    alert('Pedido enviado. O admin vai lançar no estoque.');
    abrirFichaDefeito(id);
  };

  window.pedirDescarte = async function (id, sku) {
    var motivo = prompt('Por que essa peça não serve mais? (fica registrado)');
    if (motivo === null) return;
    if (String(motivo).trim().length < 3) { alert('escreva o motivo'); return; }
    var r = await api('/api/defeitos/pedido', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'descarte', defeito_id: id, sku: sku, observacao: motivo }),
    });
    if (!r.ok) { alert(r.erro || 'não consegui enviar'); return; }
    alert('Pedido de descarte enviado. Aguarde a autorização.');
    abrirFichaDefeito(id);
  };

  // ── 4) FILA DE PEDIDOS ─────────────────────────────────────────────
  function linhaPedido(p, comAcoes) {
    var cor = p.tipo === 'descarte' ? '#9E1A1A' : '#116B4E';
    var selo = p.tipo === 'descarte'
      ? '<span style="background:#FBEAE8;color:#8C1D18;border-radius:6px;padding:2px 8px;font-size:11.5px;">DESCARTE</span>'
      : '<span style="background:#E1F5EE;color:#0F6E56;border-radius:6px;padding:2px 8px;font-size:11.5px;">RECUPERADA</span>';
    var estado = {
      pendente: '<span style="color:#8a6d00;">aguardando o admin</span>',
      autorizado: '<span style="color:#0F6E56;">autorizado — pode executar</span>',
      recusado: '<span style="color:#8C1D18;">recusado</span>',
      concluido: '<span style="color:#555;">concluído</span>',
    }[p.status] || esc(p.status);

    var h = '<div style="border:1px solid #eee;border-left:4px solid ' + cor + ';border-radius:9px;padding:11px;margin-bottom:8px;">'
      + '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:5px;">' + selo
      + '<b style="font-size:13.5px;">' + esc(p.sku || '-') + '</b>'
      + '<span style="color:#888;font-size:11.5px;">' + esc(p.quem_pediu || '-') + ' · ' + dataBr(p.criado_em) + '</span>'
      + '<span style="margin-left:auto;font-size:12px;">' + estado + '</span></div>'
      + (p.observacao ? '<div style="font-size:12.5px;color:#555;margin-bottom:6px;">' + esc(p.observacao) + '</div>' : '');

    var doa = Array.isArray(p.doadores) ? p.doadores : [];
    if (doa.length) {
      h += '<div style="font-size:12px;color:#666;margin-bottom:6px;">tirou: '
        + doa.map(function (d) { return esc(d.peca) + ' (peça #' + esc(d.defeito_id) + ')'; }).join(' · ') + '</div>';
    }
    if (comAcoes && p.status === 'pendente') {
      h += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">';
      if (p.tipo === 'recuperado') {
        h += '<input id="q_' + p.id + '" type="number" min="1" value="' + esc(p.quantidade || 1) + '" style="width:64px;height:34px;padding:0 8px;border:1px solid #ddd;border-radius:8px;">'
          + '<button onclick="decidirPedido(' + p.id + ',\'autorizar\')" style="flex:1;background:#116B4E;color:#fff;border:none;border-radius:8px;padding:9px;cursor:pointer;font-weight:600;">Lançar No Estoque</button>';
      } else {
        h += '<button onclick="decidirPedido(' + p.id + ',\'autorizar\')" style="flex:1;background:#9E1A1A;color:#fff;border:none;border-radius:8px;padding:9px;cursor:pointer;font-weight:600;">Autorizar Descarte</button>';
      }
      h += '<button onclick="decidirPedido(' + p.id + ',\'recusar\')" style="border:1px solid #ddd;background:#fff;border-radius:8px;padding:9px 14px;cursor:pointer;">Recusar</button></div>';
    }
    if (comAcoes && p.status === 'autorizado') {
      h += '<button onclick="decidirPedido(' + p.id + ',\'concluir\')" style="width:100%;margin-top:4px;border:1px solid #ddd;background:#fff;border-radius:8px;padding:9px;cursor:pointer;">Marcar Como Feito</button>';
    }
    return h + '</div>';
  }

  window.abrirFilaPedidos = async function () {
    abrir(topo('📥 Pedidos do galpão') + '<div style="padding:16px;color:#888;">carregando...</div>');
    var d = await api('/api/defeitos/pedidos');
    var lista = (d && d.pedidos) || [];
    var html = topo('📥 Pedidos do galpão')
      + '<div style="padding:14px;">'
      + (lista.length ? lista.map(function (p) { return linhaPedido(p, true); }).join('')
                      : '<div style="color:#888;font-size:13px;">nenhum pedido por enquanto.</div>')
      + '</div>';
    abrir(html);
  };

  window.decidirPedido = async function (id, acao) {
    var q = document.getElementById('q_' + id);
    var r = await api('/api/defeitos/pedido/' + id + '/decidir', {
      method: 'POST',
      body: JSON.stringify({ acao: acao, quantidade: q ? q.value : undefined }),
    });
    if (!r.ok) { alert(r.erro || 'não consegui'); return; }
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
