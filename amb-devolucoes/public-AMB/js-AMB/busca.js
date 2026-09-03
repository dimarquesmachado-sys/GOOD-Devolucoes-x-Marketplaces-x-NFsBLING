// ============================================================
// busca.js - busca pela etiqueta, render do resultado completo
// v3.18.0 - 3o botao PRODUTO DIVERGENTE
// ============================================================
// Inclui: buscar, buscarLinksBling, renderizar, renderizarErro,
//         verificarTriagemExistente, renderizarBotoesTriagem,
//         renderizarTriagemDuplicata, forcarReTriagem

let ultimaBusca = null; // dados completos da ultima busca


// ev2 - o codigo passou pelo CHECKOUT OFFLINE? (etiqueta anexada / NF)
// A resposta do bipe fica em window._ultimaRespostaBipe; este bloco
// aparece em TODOS os caminhos de render (achado, serie, nome, nada).
function blocoEventosCheckout() {
  var data = window._ultimaRespostaBipe;
  if (!data || !Array.isArray(data.eventos_checkout) || !data.eventos_checkout.length) return '';
  var evs = data.eventos_checkout.map(function (e) {
    var quando = '';
    try { quando = e.criado_em ? new Date(e.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; } catch (x) {}
    var tipoLegivel = e.tipo === 'nf_anexada' ? '🧾 NF anexada' : '📎 Etiqueta anexada';
    var ped = (e.extra && e.extra.pedido) ? ' · pedido <code>' + escapeHtml(String(e.extra.pedido)) + '</code>' : '';
    return '<div style="padding:2px 0;">' + tipoLegivel + ' · <code>' + escapeHtml(e.codigo || '') + '</code>' + ped
      + (e.quem ? ' · por ' + escapeHtml(e.quem) : '') + (quando ? ' · ' + quando : '') + '</div>';
  }).join('');
  return '<div style="margin-top:10px;background:#eef3fb;border:1px solid #c9d8f0;border-radius:8px;padding:8px 10px;font-size:12.5px;color:#1c3a63;">'
    + '<div style="margin-bottom:3px;"><b>📦 Registro do checkout offline</b></div>' + evs + '</div>';
}

async function buscar() {
  const codigo = inputCodigo.value.trim();
  if (!codigo) { toast('Digite ou bipe um codigo', 'err'); return; }

  divResultado.classList.remove('show');
  divResultado.innerHTML = '';
  divLoading.classList.add('show');
  btnBuscar.disabled = true;

  try {
    const resp = await fetch(`/api/devolucao/identificar/${encodeURIComponent(codigo)}`);
    const data = await resp.json();
    window._ultimaRespostaBipe = data;   // ev2 - pro bloco do checkout
    ultimaBusca = data;
    renderizar(data, resp.ok);
  } catch (err) {
    renderizarErro('Erro de conexao: ' + err.message);
  } finally {
    divLoading.classList.remove('show');
    btnBuscar.disabled = false;
    // v3.14.8: select() da foco e abre teclado virtual no celular - so faz em desktop
    if (!('ontouchstart' in window)) inputCodigo.select();
  }
}

// ================ BUSCA SOB DEMANDA BLING ================
async function buscarLinksBling(orderId, dataVenda, numeroNF) {
  const btn = document.getElementById('btnBlingDemanda');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-mini"></span>Buscando no Bling...';

  try {
    const params = new URLSearchParams();
    if (dataVenda) params.set('data', dataVenda);
    if (numeroNF) params.set('numeroNF', numeroNF);
    const queryStr = params.toString() ? `?${params.toString()}` : '';
    const url = `/api/nf/buscar-links-bling/${encodeURIComponent(orderId)}${queryStr}`;
    const resp = await fetch(url);
    const data = await resp.json();

    const containerBotoes = document.getElementById('botoesNF');
    if (!containerBotoes) return;

    if (data.ok && data.nf) {
      // Atualiza nf na busca atual pra triagem usar
      if (ultimaBusca) ultimaBusca.nf = { ...(ultimaBusca.nf || {}), ...data.nf };
      let novosBotoes = '';
      if (data.nf.linkDanfe) novosBotoes += `<a href="${data.nf.linkDanfe}" target="_blank" class="btn-action">📄 DANFE Bling</a>`;
      if (data.nf.linkPdf) novosBotoes += `<a href="${data.nf.linkPdf}" target="_blank" class="btn-action">📥 Baixar PDF</a>`;
      if (data.nf.linkXml) novosBotoes += `<a href="${data.nf.linkXml}" target="_blank" class="btn-action">📋 XML</a>`;
      if (data.nf.idBling) novosBotoes += `<a href="https://www.bling.com.br/notas.fiscais.php#edit/${data.nf.idBling}" target="_blank" class="btn-action azul">🔗 Editar no Bling</a>`;

      const badgeFonte = document.querySelector('.badge-fonte-ml, .badge-fonte-bling');
      if (badgeFonte) {
        badgeFonte.className = 'badge badge-fonte-bling';
        badgeFonte.textContent = 'via Bling + ML';
      }

      btn.outerHTML = novosBotoes;
    } else {
      btn.disabled = false;
      btn.style.background = '#b00020';
      btn.innerHTML = '⚠️ Nao localizado no Bling';
      setTimeout(() => {
        btn.style.background = '';
        btn.innerHTML = '🔍 Tentar Bling de novo';
        btn.disabled = false;
      }, 3000);
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '⚠️ Erro de conexao';
  }
}

// ================ RENDER ================
function renderizar(data, ok) {
  if (!ok || !data.encontrado) {
    // v3.51 - MESMO NUMERO em series diferentes (a casa emite serie 1=normal,
    // 2=ML FULL, outras p/ Magalu/Amazon FULL). Nunca escolhemos por ele:
    // mostra as NFs lado a lado pra bater com o que esta na caixa.
    if (data.ambiguidade_nf?.opcoes?.length) {
      renderizarEscolhaSerie(data.ambiguidade_nf);
      return;
    }
    // v3.30 - candidatos por NOME (etiqueta Correios Amazon etc): lista
    // clicavel; o clique dispara a busca pela NF (fluxo que ja existe).
    if (data.candidatos_nome && data.candidatos_nome.length > 0) {
      renderizarCandidatosNome(data.erro, data.candidatos_nome);
      return;
    }
    renderizarErro(data.erro || 'Codigo nao encontrado', data.tentativas);
    return;
  }

  const order = data.order || {};
  const shipment = data.shipment || {};
  const claim = data.claim || {};
  const nf = data.nf || null;

  const itemOrder = order.order_items?.[0];
  const itemShip = shipment.shipping_items?.[0];
  const buyer = order.buyer || {};
  const payment = order.payments?.[0] || {};

  // Itens: prioriza Bling (titulo limpo + EAN), fallback pro ML
  const itensBling = Array.isArray(nf?.itens) && nf.itens.length > 0 ? nf.itens : null;
  const itensML = Array.isArray(order.order_items) ? order.order_items : [];

  // Monta lista unificada de itens pra render
  let itensRender = [];
  if (itensBling) {
    // Usa Bling como fonte principal
    itensRender = itensBling.map((it, i) => ({
      titulo: it.titulo || '-',
      sku: it.sku || itensML[i]?.item?.seller_sku || '-',
      ean: it.ean || '-',
      // b235 (review do Codex) - o id do produto tem que SOBREVIVER a
      // remontagem do item aqui; sem isso o `?produtoId=` nunca era enviado
      // e a parte 1 nao servia pra nada.
      produto_id: (it.produto_id || it.produtoId || (it.produto && it.produto.id)) || null,
      quantidade: Number(it.quantidade) || itensML[i]?.quantity || 1,
      valor: it.valor || itensML[i]?.unit_price,
      mlb: itensML[i]?.item?.id || null,
      fonte: 'bling',
    }));
  } else if (itensML.length > 0) {
    // Fallback ML
    itensRender = itensML.map(it => ({
      titulo: it.item?.title || '-',
      sku: it.item?.seller_sku || '-',
      ean: '-',
      quantidade: it.quantity || 1,
      valor: it.unit_price,
      mlb: it.item?.id || null,
      fonte: 'ml',
    }));
  } else if (itemShip) {
    // Fallback super basico
    itensRender = [{
      titulo: itemShip.description || '-',
      sku: '-', ean: '-',
      quantidade: itemShip.quantity || 1,
      valor: null,
      mlb: itemShip.id || null,
      fonte: 'shipment',
    }];
  }

  // Totais agregados
  const qtdTotal = itensRender.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);
  const valorTotal = order?.total_amount;
  const variacao = itemOrder?.item?.variation_attributes?.length
    ? itemOrder.item.variation_attributes.map(v => `${v.name}: ${v.value_name}`).join(' | ')
    : null;

  const buyerNome = buyer.first_name
    ? `${buyer.first_name} ${buyer.last_name || ''}`.trim()
    : '-';
  const buyerNick = buyer.nickname || '-';
  const buyerId = buyer.id || '-';

  const ehDevolucao = data.eh_devolucao;

  // v3.32 - RECADOS: aviso que o Diego prendeu a essa venda/NF. Aparece em
  // destaque no topo e exige ciencia do estoquista (fica registrado quem leu).
  // v3.35 - POR QUE ESTE PRODUTO VOLTOU (declarado ANTES do uso: na v3.34
  // a const ficava 25 linhas depois do if e quebrava com "Cannot access
  // '_mot' before initialization")
  const _mot = data.motivo_devolucao || null;

  let html = '<div class="card">';
  if (_mot) {
    const _ctx = _mot.contexto || {};
    html += '<div style="border-left:6px solid ' + _mot.cor + ';background:#fafafa;border-radius:10px;padding:11px 13px;margin-bottom:12px;">'
      + '<div style="font-size:15px;font-weight:800;color:' + _mot.cor + ';">' + escapeHtml(_mot.titulo) + '</div>'
      + '<div style="font-size:13px;color:#444;margin-top:3px;">' + escapeHtml(_mot.detalhe) + '</div>';
    if (_ctx.pontos && _ctx.pontos.length) {
      html += '<div style="font-size:12px;color:#555;margin-top:6px;background:#fff;border-radius:6px;padding:6px 8px;">'
        + '<b>O que o Mercado Livre informou:</b><br>'
        + _ctx.pontos.map(function (p) { return '• ' + escapeHtml(p); }).join('<br>')
        + '</div>';
    }
    if (_ctx.pacote_consolidado) {
      html += '<div style="margin-top:6px;background:#e3f2fd;border:1px solid #90caf9;border-radius:6px;padding:6px 8px;font-size:12px;color:#0d47a1;font-weight:700;">📦 ATENÇÃO: o Mercado Livre juntou MAIS DE UMA devolução neste mesmo pacote — confira se veio mais de um produto na caixa.</div>';
    }
    if (_mot.reclamacao_id) {
      html += '<div style="font-size:11px;color:#777;margin-top:3px;">Reclamação nº ' + escapeHtml(_mot.reclamacao_id) + '</div>';
    }
    if (_mot.risco_fraude) {
      html += '<div style="margin-top:6px;background:#c62828;color:#fff;border-radius:6px;padding:5px 8px;font-size:12px;font-weight:700;">⚠️ O Mercado Livre marcou irregularidade neste pedido — confira o produto com atenção</div>';
    }
    html += '</div>';
  }
  window._recadosPendentes = (data.recados || []).filter(rc => !rc.ciente_em).map(rc => rc.id);

  for (const rc of (data.recados || [])) {
    const lido = !!rc.ciente_em;
    html += '<div id="recado-' + rc.id + '" style="border:3px solid ' + (lido ? '#9e9e9e' : '#c62828') + ';background:' + (lido ? '#fafafa' : '#fff3e0') + ';border-radius:10px;padding:12px;margin-bottom:12px;">'
      // b226 (pedido do Diego) - cores invertidas: o TITULO fica no vinho
      // (#7f1d1d) e o texto do recado no vermelho mais claro (#c62828).
      + '<div style="font-size:15px;font-weight:800;color:' + (lido ? '#616161' : '#7f1d1d') + ';">📣 RECADO SOBRE ESSA DEVOLUÇÃO</div>'
      // b223 (pedido do Diego) - o texto do recado E a instrucao: ele estava
      // do mesmo tamanho do resto da tela e passava batido. Agora vem
      // grande, em negrito e com fundo proprio, pra o estoquista ler antes
      // de encostar na caixa.
      + '<div style="font-size:' + (lido ? '16px' : '21px') + ';font-weight:' + (lido ? '600' : '800') + ';'
      + 'line-height:1.35;margin:10px 0;white-space:pre-wrap;color:' + (lido ? '#444' : '#c62828') + ';'
      + (lido ? '' : 'background:#fff;border:2px solid #f0b4ae;border-radius:9px;padding:11px 13px;')
      + '" id="recado-texto-' + rc.id + '">' + escapeHtml(rc.texto) + '</div>'
      + (lido
          ? '<div style="font-size:12px;color:#666;">✅ ciente por ' + escapeHtml(rc.ciente_por || '-') + ' em ' + (rc.ciente_em ? String(rc.ciente_em).slice(0, 10).split('-').reverse().join('/') : '-') + '</div>'
          : '<button onclick="recadoCiente(' + rc.id + ', this)" style="background:#2e7d32;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:800;cursor:pointer;">✓ OK, ciente</button>')
      + '</div>';
  }

  // BADGES TOPO — b85: viram uma linha flex pra o botao do marketplace
  // caber no canto direito, em vez de ocupar uma linha so pra ele.
  html += '<div class="linha-selos">';
  html += ehDevolucao
    ? '<span class="badge badge-devolucao">📦 DEVOLUCAO</span>'
    : '<span class="badge badge-info">📦 ENVIO</span>';
  html += `<span class="badge badge-info">Metodo: ${data.metodo || '-'}</span>`;
  // v3.28 - rotulo do marketplace conforme o metodo (era fixo "ML")
  const nomeMkt = data.magalu ? 'Magalu'
    : (data.tiktok || String(data.metodo || '').includes('tiktok')) ? 'TikTok'
    : (data.shopee || String(data.metodo || '').includes('shopee')) ? 'Shopee'
    : (String(data.metodo || '').includes('nf') || String(data.metodo || '').includes('chave')) ? (data.magalu ? 'Magalu' : 'Nota Fiscal')
    : 'Mercado Livre';
  if (order && order.id) html += `<span class="badge badge-sucesso">✅ Pedido ${nomeMkt === 'Nota Fiscal' ? '' : nomeMkt}</span>`;
  if (nf) {
    html += '<span class="badge badge-nfe">🧾 NF-e</span>';
    html += `<span class="badge badge-fonte-ml">via ${nomeMkt}</span>`;
  }

  // ── TIKTOK (v4.66): o retrato que o painel deles ja mostrava ────────
  //
  // O dono conferiu a tela do TikTok e apontou que e a mais completa
  // entre os marketplaces — rastreio, transportadora, trajeto, armazem.
  // Quase tudo ja vinha na coleta e nao aparecia aqui.
  //
  // O aviso de "NAO vem pacote" vem PRIMEIRO e em vermelho: metade das
  // devolucoes do TikTok e reembolso puro, e o estoquista precisa saber
  // disso antes de qualquer outra coisa.
  if (data.tiktok) {
    const tk = data.tiktok;
    html += '<div style="margin-top:10px;padding:10px;border-radius:8px;background:#f7f7f9;border:1px solid #ddd">';

    if (tk.vai_chegar === false) {
      html += '<div style="padding:8px;border-radius:6px;background:#ffebee;border:2px solid #c62828;'
        + 'color:#b71c1c;font-weight:700;margin-bottom:8px">'
        + '🚫 SEM DEVOLUÇÃO FÍSICA — nenhum pacote vai chegar por esta solicitação'
        + (tk.motivo_texto ? '<div style="font-weight:400;margin-top:4px">Motivo: ' + escapeHtml(String(tk.motivo_texto)) + '</div>' : '')
        + '</div>';
    } else if (tk.vai_chegar === null) {
      html += '<div style="padding:8px;border-radius:6px;background:#fff8e1;border:2px solid #f9a825;'
        + 'color:#e65100;font-weight:600;margin-bottom:8px">'
        + '⏳ Solicitação ainda EM ABERTO — pode virar devolução com retorno ou só reembolso</div>';
    }

    if (tk.combinada) {
      html += '<div style="padding:8px;border-radius:6px;background:#e8eaf6;border:2px solid #3949ab;'
        + 'color:#1a237e;font-weight:700;margin-bottom:8px">'
        + '📦📦 DEVOLUÇÃO COMBINADA — esta caixa pode ter MAIS DE UM PEDIDO</div>';
    }

    // ── O RECADO DO CLIENTE (v4.66) ────────────────────────────────
    //
    // Ideia do dono: "é tipo o recado anotação que eu faço no ADMIN pra
    // outros pedidos de outros marketplaces, só q o TIKTOK dando de
    // graça, sem trabalho manual pra mim".
    //
    // O TikTok pede pro cliente escrever o que houve, e esse texto vem na
    // coleta (return_reason_text, 99 de 99). "Produto muito pequeno,
    // diferente do que foi mostrado" diz ao estoquista o que procurar na
    // caixa — muito mais util que o motivo generico.
    //
    // Estilo igual ao recado do admin, pra ser lido do mesmo jeito.
    if (tk.motivo_texto) {
      html += '<div style="border:3px solid #1565c0;background:#e3f2fd;border-radius:10px;'
        + 'padding:12px;margin-bottom:10px">'
        + '<div style="font-weight:800;color:#0d47a1;margin-bottom:4px">💬 O QUE O CLIENTE DISSE</div>'
        + '<div style="font-size:15px;color:#0d47a1">' + escapeHtml(String(tk.motivo_texto)) + '</div>'
        + '</div>';
    }

    // b180 (Codex): TUDO que vem do TikTok passa por escapeHtml. O texto e
    // escrito pelo CLIENTE — se ele mandar HTML na reclamacao, executaria
    // aqui dentro do painel do admin. Vale pros campos tecnicos tambem:
    // nome de transportadora e endereco de armazem vem de fora.
    const linha = (rot, val) => val
      ? '<div style="margin:3px 0"><b>' + rot + ':</b> ' + escapeHtml(String(val)) + '</div>' : '';
    html += linha('Transportadora', tk.transportadora);
    html += linha('Rastreio da devolução', tk.rastreio);
    html += linha('Como o cliente devolveu', tk.metodo_devolucao);
    html += linha('Armazém de destino', tk.armazem_destino);
    html += linha('Motivo', tk.motivo);   // o texto do cliente ja apareceu acima
    html += linha('Valor do reembolso', tk.valor != null ? ('R$ ' + Number(tk.valor).toFixed(2)) : null);

    // ── PACOTE PARCIAL (v4.66) ──────────────────────────────────────
    //
    // O TikTok abre UMA solicitacao por item da nota, cada uma com seu
    // rastreio — ou seja, VARIAS CAIXAS do mesmo pedido. Sem este aviso o
    // estoquista abre a primeira, ve metade dos itens da nota e marca
    // DIVERGENCIA, quando na verdade esta tudo certo e a outra vem depois.
    //
    // Pedido dele: "se ele souber que é 1 pacote de 2, e q é parcial,
    // orientando pra ele triar só 5 unidades dessa vez, aí perfeito".
    if (tk.pacotes && tk.pacotes.length > 1) {
      const qual = tk.pacotes.findIndex((p) => p.esta) + 1;
      html += '<div style="border:3px solid #ef6c00;background:#fff3e0;border-radius:10px;'
        + 'padding:12px;margin:10px 0">'
        + '<div style="font-weight:800;color:#e65100;font-size:16px;margin-bottom:6px">'
        + '📦 ENTREGA PARCIAL — pacote ' + (qual || '?') + ' de ' + tk.pacotes.length + '</div>'
        + '<div style="color:#e65100;margin-bottom:8px">Este pedido volta em '
        + tk.pacotes.length + ' caixas separadas. <b>Confira só o que vem NESTA</b> — '
        + 'o resto chega em outra entrega, não marque divergência.</div>';

      tk.pacotes.forEach((p, i) => {
        const dest = p.esta;
        html += '<div style="margin:6px 0;padding:8px;border-radius:6px;'
          + 'background:' + (dest ? '#fff' : '#fafafa') + ';'
          + 'border:' + (dest ? '2px solid #ef6c00' : '1px solid #ddd') + '">'
          + '<b>' + (dest ? '👉 ESTA CAIXA' : 'Caixa ' + (i + 1)) + '</b>'
          + (p.rastreio ? ' · <code>' + escapeHtml(String(p.rastreio)) + '</code>' : '')
          + (p.status ? ' · ' + escapeHtml(String(p.status)) : '');
        if (p.itens && p.itens.length) {
          html += '<ul style="margin:4px 0 0 18px">';
          p.itens.forEach((it) => {
            html += '<li>' + (it.qtd != null ? escapeHtml(String(it.qtd)) + '× ' : '')
              + (it.sku ? '<code>' + escapeHtml(String(it.sku)) + '</code> ' : '')
              + escapeHtml(String(it.nome || '')) + '</li>';
          });
          html += '</ul>';
        }
        html += '</div>';
      });
      html += '</div>';
    } else if (tk.itens && tk.itens.length) {
      // caixa unica: a lista simples de sempre
      html += '<div style="margin-top:8px"><b>Itens que deveriam vir nesta devolução:</b><ul style="margin:4px 0 0 18px">';
      tk.itens.forEach((it) => {
        html += '<li>' + (it.qtd != null ? escapeHtml(String(it.qtd)) + '× ' : '')
          + (it.sku ? '<code>' + escapeHtml(String(it.sku)) + '</code> ' : '')
          + escapeHtml(String(it.nome || '')) + '</li>';
      });
      html += '</ul></div>';
    }

    // devolucao encadeada: o cliente abriu, cancelou, abriu de novo
    if (tk.anterior_id || tk.proxima_id) {
      html += '<div style="margin-top:6px;font-size:13px;color:#666">'
        + '🔗 Faz parte de uma sequência de solicitações do mesmo pedido</div>';
    }

    html += '</div>';
  }

  // b75 - BOTAO PRA ABRIR O PEDIDO NO MARKETPLACE.
  // O backend manda data.link_marketplace pronto (na Shopee ele passa
  // pelo de-para que resolve o order_sn no id interno). Se nao vier,
  // monta pelo canal identificado — assim vale pro ML e pro Magalu.
  (function () {
    let alvo = data.link_marketplace || null;
    if (!alvo && order && order.id) {
      const m = String(data.metodo || '').toLowerCase();
      if (data.magalu || m.includes('magalu')) {
        alvo = { nome: 'Magalu', url: '/magalu/ir/amb?n=' + encodeURIComponent(String(order.id).replace(/\D/g, '')) };
      } else if (data.shopee || m.includes('shopee')) {
        alvo = { nome: 'Shopee', url: 'https://mover-pedidos-aguardando-x-atendido.onrender.com/amb-checkout-offline/ir-shopee?sn=' + encodeURIComponent(order.id) };
      } else if (/^\d{10,}$/.test(String(order.id))) {
        alvo = { nome: 'Mercado Livre', url: 'https://www.mercadolivre.com.br/vendas/' + encodeURIComponent(order.id) + '/detalhe' };
      }
    }
    if (alvo) {
      html += `<a class="selo-mkt" href="${alvo.url}" target="_blank" rel="noopener"
        >🔗 Abrir pedido na ${escapeHtml(alvo.nome)}</a>`;
    }
  })();
  html += '</div>';

  // b263 (aviso da Shopee de 17/08/2026) - as APIs de devolucao passaram a
  // dizer quando volta SO PARTE da quantidade (`is_partial_quantity_return`)
  // e quando o reembolso foi menor que o maximo (`is_refund_amount_adjusted`).
  // Isso muda o trabalho do galpao: hoje o estoquista so descobre que voltou
  // 1 de 3 abrindo a caixa. O aviso vem ANTES, no topo do card.
  (function () {
    var sh = data.shopee || null;
    if (!sh) return;
    var parcial = sh.is_partial_quantity_return === true;
    var ajustado = sh.is_refund_amount_adjusted === true;
    if (!parcial && !ajustado) return;
    html += '<div style="background:#FFF3E0;border:2px solid #E65100;border-radius:9px;'
      + 'padding:11px 13px;margin:10px 0;">'
      + (parcial ? '<div style="font-size:16px;font-weight:800;color:#E65100;">📦 Devolução PARCIAL — não volta tudo</div>'
          + '<div style="font-size:13.5px;color:#7a4a10;margin-top:3px;">O comprador está devolvendo apenas parte das unidades. '
          + 'Confira a quantidade na caixa antes de lançar o estoque.</div>' : '')
      + (ajustado ? '<div style="font-size:' + (parcial ? '13px' : '15px') + ';font-weight:' + (parcial ? '600' : '800')
          + ';color:#E65100;margin-top:' + (parcial ? '7px' : '0') + ';">💰 Reembolso menor que o valor máximo</div>'
          + '<div style="font-size:13px;color:#7a4a10;">A Shopee devolveu ao comprador menos que o total do pedido.</div>' : '')
      + '</div>';
  })();

  // b80 - a barra amarela gigante saiu: a quantidade agora vive
  // dentro do card do produto, em cima do titulo (sem repetir).

  // CARDS DOS PRODUTOS (Bling = titulo limpo + EAN, ML = fallback)
  if (itensRender.length > 0) {
    if (itensRender.length > 1) {
      html += `<div class="multi-aviso">⚠️ Devolucao com ${itensRender.length} produtos diferentes - confira cada um abaixo</div>`;
    }
  html += `<style>
    .dvi{display:grid;grid-template-columns:150px minmax(0,1fr);grid-template-areas:"f q" "f t" "f c";gap:7px 16px;align-items:center;}
    .dvi-f{grid-area:f;width:150px;height:150px;border-radius:10px;object-fit:contain;background:#fff;border:1px solid #e4dcf1;display:flex;align-items:center;justify-content:center;font-size:34px;}
    .dvi-q{grid-area:q;justify-self:start;display:inline-flex;align-items:baseline;gap:8px;
      background:#FAC775;color:#412402;font-weight:700;padding:7px 14px;border-radius:8px;
      font-size:14px;letter-spacing:.3px;}
    .dvi-q b{font-size:22px;font-weight:700;}
    .dvi-t{grid-area:t;font-size:15.5px;line-height:1.35;}
    .dvi-c{grid-area:c;display:flex;flex-wrap:wrap;gap:7px;}
    .dvi-cod{display:flex;align-items:center;gap:8px;border-radius:7px;padding:6px 11px;font-size:13.5px;}
    .dvi-cod b{font-size:10.5px;font-weight:500;letter-spacing:.4px;}
    .dvi-cod span{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;}
    .dvi-sku{background:#E6F1FB;color:#0C447C;} .dvi-sku span{color:#042C53;}
    .dvi-ean{background:#EEEDFE;color:#3C3489;} .dvi-ean span{color:#26215C;}
    @media (max-width:600px){
      .dvi{grid-template-columns:minmax(0,1fr);grid-template-areas:"q" "f" "t" "c";text-align:center;gap:9px 0;}
      .dvi-q{justify-self:stretch;justify-content:center;padding:9px 10px;font-size:13.5px;}
      .dvi-q b{font-size:20px;}
      .dvi-f{justify-self:center;}
      .dvi-t{font-size:14px;}
      .dvi-c{flex-direction:column;gap:5px;}
      .dvi-cod{justify-content:center;}
      .dvi-cod span{font-size:15px;}
    }
    .linha-selos{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-bottom:10px;}
    .selo-mkt{margin-left:auto;background:#561A9E;color:#fff;text-decoration:none;padding:8px 14px;border-radius:9px;font-weight:700;font-size:13px;white-space:nowrap;}
    @media (max-width:600px){.selo-mkt{margin-left:0;flex:1 1 100%;text-align:center;}}
    .triagem-botoes{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:9px!important;}
    .triagem-btn{padding:14px 8px!important;font-size:13px!important;line-height:1.25!important;}
    .triagem-btn-icon{font-size:22px!important;}
    @media (max-width:600px){.triagem-botoes{grid-template-columns:1fr!important;} .triagem-btn{padding:16px 10px!important;font-size:15px!important;}}
    .nfl{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;}
    .nfl-tit{font-size:12px;font-weight:700;color:#1b5e20;letter-spacing:.4px;flex:0 0 auto;}
    .nfl-n{font-size:20px;font-weight:700;color:#1b5e20;}
    .nfl-s{font-size:12.5px;color:#0F6E56;background:#E1F5EE;border-radius:6px;padding:2px 9px;}
    .nfl-v{font-size:15px;font-weight:700;}
    .nfc-v{flex:1;min-width:0;background:#fff;border:1px solid #ddd;border-radius:6px;padding:5px 9px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;overflow-x:auto;white-space:nowrap;}
    .nfl-b{flex:0 0 auto;padding:5px 10px;font-size:12.5px;}
    .nfl-btns{display:flex;gap:6px;flex:0 0 auto;margin-left:auto;}
    .nfk{display:flex;align-items:center;gap:8px;margin-top:8px;}
    .nfk-l{font-size:10px;color:#5F5E5A;letter-spacing:.4px;flex:0 0 auto;}
    @media (max-width:600px){
      .nfl{gap:5px 10px;}
      .nfl-tit{flex:1 1 100%;}
      .nfl-btns{flex:1 1 100%;margin-left:0;}
      .nfl-btns .btn-action{flex:1;}
      .nfk{flex-wrap:wrap;background:#f3f7f3;border-radius:8px;padding:8px 9px;}
      .nfk-l{flex:1 1 100%;}
      .nfc-v{flex:1 1 100%;white-space:normal;word-break:break-all;font-size:12px;line-height:1.45;border:none;background:none;padding:0;overflow:visible;}
    }
  </style>`;
    html += '<div class="itens-lista">';
    // b78 - FOTO DO PRODUTO no card do item. Fica a ESQUERDA, do lado do
    // 2x/titulo/SKU/EAN, pra o estoquista bater o olho e conferir com a
    // caixa sem procurar em outro canto. A imagem entra depois (a busca
    // nao espera por ela) - ver buscarFotosItens() abaixo.
    itensRender.forEach((it, _i) => {
      html += `<div class="item-card dvi">
        <div class="dvi-f" id="fotoitem-${_i}">\u{1F4E6}</div>
        <div class="dvi-q">${qtdPorExtenso(it.quantidade)}</div>
        <div class="dvi-t">${escapeHtml(it.titulo)}</div>
        <div class="dvi-c">
          ${it.sku && it.sku !== '-' ? `<div class="dvi-cod dvi-sku"><b>SKU</b><span>${escapeHtml(it.sku)}</span></div>` : ''}
          ${it.ean && it.ean !== '-' ? `<div class="dvi-cod dvi-ean"><b>EAN</b><span>${escapeHtml(it.ean)}</span></div>` : ''}
        </div>
      </div>`;
    });
    html += '</div>';
  }

  // AVISOS
  if (data.avisos?.length) {
    data.avisos.forEach(a => {
      // b74 - aviso de SUCESSO nao pode ter cara de alerta. "NF achada"
      // aparecia com ⚠️ igual a um erro. Agora o que deu certo vem em
      // verde com ✅; o que e problema segue amarelo com ⚠️.
      const ehBoa = /^(nf_via_|nf_achada|ok_)/.test(String(a.tipo || ''));
      html += ehBoa
        ? `<div style="margin-top:10px;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:9px 11px;font-size:13px;color:#1b5e20;">✅ ${escapeHtml(a.mensagem)}</div>`
        : `<div class="aviso-box" style="margin-top:10px;">⚠️ ${escapeHtml(a.mensagem)}</div>`;
    });
  }

  // ====== GRID 2 COLUNAS ======
  html += '<div class="grid-desktop" style="margin-top:14px;">';

  // ============ NF (LARGURA TOTAL) ============
  if (nf) {
    html += '<div class="secao-nf">';
    html += '<div class="nfl">';
    html += '<span class="nfl-tit">\u{1F9FE} NOTA FISCAL</span>';
    html += `<span class="nfl-n">NF ${escapeHtml(nf.numero || '-')}</span>`;
    html += `<span class="nfl-s">serie ${escapeHtml(nf.serie || '-')}</span>`;
    html += `<span>${dataFmt(nf.dataEmissao)}</span>`;
    html += `<span class="nfl-v">${moeda(nf.valor)}</span>`;
    if (nf.peso) { html += `<span>${nf.peso}g</span>`; }

    html += '<span id="botoesNF" class="nfl-btns">';
    if (order.id) {
      html += `<button id="btnBlingDemanda" class="btn-action cinza" onclick="buscarLinksBling('${order.id}', '${order.date_created || ''}', '${nf.numero || ''}')">🔍 Links Bling</button>`;
    }
    html += '</span>';
    html += '</div>';
    if (nf.chaveAcesso) {
      html += '<div class="nfk"><span class="nfk-l">CHAVE</span>'
        + `<span class="nfc-v" id="nfChave">${escapeHtml(nf.chaveAcesso)}</span>`
        + `<button class="btn-action cinza nfl-b" onclick="copiarChaveNF(this)" title="copiar a chave">\u{1F4CB}</button></div>`;
    }
    html += '</div>';
  } else if (order.id) {
    html += '<div class="secao-nf">';
    html += '<div class="secao-nf-titulo">🧾 Nota Fiscal</div>';
    html += `<p style="margin: 10px 0;">⚠️ NF-e nao localizada${data.magalu ? ' (pedido Magalu ' + escapeHtml(String(data.magalu.protocolo || '')) + ')' : ' via ' + nomeMkt}.</p>`;
    html += '<div id="botoesNF">';
    html += `<button id="btnBlingDemanda" class="btn-action" onclick="buscarLinksBling('${order.id}', '${order.date_created || ''}', '')">🔍 Buscar no Bling (~5s)</button>`;
    html += '</div>';
    html += '</div>';
  }

  // ============ TRIAGEM (NOVA Fase 3) ============
  if (order.id) {
    html += `
      <div class="secao-triagem">
        <div class="secao-triagem-titulo">🎯 Triagem</div>
        <div id="triagemConteudo">
          <div style="text-align:center;padding:14px;color:#888;font-size:13px;">
            <div class="spinner" style="width:20px;height:20px;display:inline-block;"></div>
            <p style="margin-top:6px;">Verificando se ja foi triada...</p>
          </div>
        </div>
        <div id="triagemSucesso"></div>
      </div>
    `;
  }

  // ============ DETALHES EXTRAS (valor total, variacao) ============
  if (valorTotal || variacao) {
    html += '<div class="bloco">';
    html += '<div class="secao-titulo">Detalhes do pedido</div>';
    html += '<div class="item-grid">';
    if (valorTotal) {
      html += `<div><div class="label">Valor total</div><div class="valor"><strong>${moeda(valorTotal)}</strong></div></div>`;
    }
    if (variacao) {
      html += `<div style="grid-column: 1/-1;"><div class="label">Variacao</div><div class="valor">${escapeHtml(variacao)}</div></div>`;
    }
    html += '</div>';
    html += '</div>';
  }

  // ============ COMPRADOR ============
  html += '<div class="bloco">';
  html += '<div class="secao-titulo">Comprador</div>';
  html += '<div class="item-grid">';
  html += `<div><div class="label">Nome</div><div class="valor">${escapeHtml(buyerNome)}</div></div>`;
  html += `<div><div class="label">Nickname</div><div class="valor">${escapeHtml(buyerNick)}</div></div>`;
  html += `<div><div class="label">ID</div><div class="valor">${buyerId}</div></div>`;
  html += `<div><div class="label">Data da venda</div><div class="valor">${dataFmt(order.date_created)}</div></div>`;
  html += '</div>';
  html += '</div>';

  // ============ PEDIDO ============
  html += '<div class="bloco">';
  html += '<div class="secao-titulo">Pedido</div>';
  html += '<div class="item-grid">';
  // b74 - o rotulo era fixo "Order ID (ML)" e aparecia assim tambem em
  // pedido Shopee/Magalu. Agora segue o canal identificado.
  const _rotuloPedido = data.magalu ? 'Pedido Magalu'
    : (data.shopee || String(data.metodo || '').includes('shopee')) ? 'Pedido Shopee'
    : 'Order ID (ML)';
  html += `<div><div class="label">${_rotuloPedido}</div><div class="valor">${order.id || '-'}</div></div>`;
  html += `<div><div class="label">Pack ID</div><div class="valor">${order.pack_id || '-'}</div></div>`;
  html += `<div><div class="label">Status venda</div><div class="valor">${traduzirStatus(order.status)}</div></div>`;
  html += `<div><div class="label">Status pagamento</div><div class="valor">${traduzirPagamento(payment.status)}${payment.transaction_amount_refunded ? ' (estornado: ' + moeda(payment.transaction_amount_refunded) + ')' : ''}</div></div>`;
  html += '</div>';
  html += '</div>';

  // ============ ENVIO ============
  if (shipment.id) {
    html += '<div class="bloco">';
    html += '<div class="secao-titulo">Envio / Devolucao</div>';
    html += '<div class="item-grid">';
    html += `<div><div class="label">Shipment ID</div><div class="valor">${shipment.id}</div></div>`;
    html += `<div><div class="label">Status envio</div><div class="valor">${traduzirStatusEnvio(shipment.status)}</div></div>`;
    html += `<div><div class="label">Tipo</div><div class="valor">${escapeHtml(shipment.type || 'forward')}</div></div>`;
    html += `<div><div class="label">Custo do envio</div><div class="valor">${moeda(shipment.base_cost)}</div></div>`;
    if (shipment.tags?.length) {
      html += `<div style="grid-column: 1/-1;"><div class="label">Tags ML</div><div class="valor">${escapeHtml(shipment.tags.join(', '))}</div></div>`;
    }
    html += '</div>';
    html += '</div>';
  }

  // ============ TIMELINE ============
  if (shipment.status_history) {
    const sh = shipment.status_history;
    html += '<div class="secao-timeline">';
    html += '<div class="secao-titulo">📍 Linha do tempo</div>';
    html += '<ul class="timeline">';
    if (sh.date_handling) html += `<li>Preparado <span class="timeline-data">${dataFmt(sh.date_handling)}</span></li>`;
    if (sh.date_ready_to_ship) html += `<li>Etiqueta gerada <span class="timeline-data">${dataFmt(sh.date_ready_to_ship)}</span></li>`;
    if (sh.date_shipped) html += `<li>Enviado <span class="timeline-data">${dataFmt(sh.date_shipped)}</span></li>`;
    if (sh.date_delivered) html += `<li><strong>Entregue ${ehDevolucao ? 'no galpao' : 'ao comprador'}</strong> <span class="timeline-data">${dataFmt(sh.date_delivered)}</span></li>`;
    html += '</ul>';
    html += '</div>';
  }

  html += '</div>'; // fim grid-desktop

  // DEBUG
  html += '<details><summary>🔧 Tentativas e diagnostico</summary>';
  // b89 - quanto a busca demorou e onde. A rota faz varias chamadas de
  // rede em sequencia; com isso na tela da pra ver qual etapa pesa.
  if (data._ms) {
    const seg = (data._ms / 1000).toFixed(1);
    html += `<div style="font-size:12.5px;color:#555;margin:6px 0;">`
      + `⏱️ a busca levou <b>${seg}s</b>`;
    if (Array.isArray(data._marcos) && data._marcos.length) {
      html += ' &mdash; ' + data._marcos.map(function (m) {
        return escapeHtml(m.fase) + ' ' + (m.ms / 1000).toFixed(1) + 's';
      }).join(' · ');
    }
    html += '</div>';
  }
  html += '<ul class="tentativas-list">';
  data.tentativas.forEach(t => {
    const icone = t.ok ? '✅' : '❌';
    html += `<li>${icone} <strong>${escapeHtml(t.tipo)}</strong>: <code>${escapeHtml(String(t.codigo))}</code> → status ${t.status || '?'}`;
    if (t.tem_fiscal_key !== undefined) html += ` <em>(fiscal_key: ${t.tem_fiscal_key ? 'SIM' : 'NAO'})</em>`;
    if (t.encontradas !== undefined) html += ` <em>(${t.encontradas} encontradas)</em>`;
    if (t.claims_encontradas !== undefined) html += ` <em>(${t.claims_encontradas} claims)</em>`;
    html += '</li>';
  });
  html += '</ul></details>';

  html += '</div>';

  divResultado.innerHTML = html + blocoEventosCheckout();   // ev2
  divResultado.classList.add('show');
  buscarFotosItens(itensRender);   // b78 - fotos dos itens (nao bloqueia)

  // Apos render, verifica triagem existente (nao bloqueia o render).
  // v3.21 - vendas de OUTROS marketplaces (Magalu, Amazon...) identificadas
  // pela chave da DANFE NAO tem shipment (conceito do ML). Antes, o if
  // abaixo era falso e a rodinha "Verificando..." girava pra sempre.
  // Agora: usa a chave da NF como identificador alternativo; e se nao houver
  // nada, ao menos renderiza os botoes (nunca deixa rodinha eterna).
  // v3.27 - o campo no JSON e "chaveAcesso" (nao "chave") - por isso a
  // verificacao de "ja triada" nunca rodava pra vendas sem shipment
  // (Magalu, DANFE, numero da NF): idParaTriagem ficava null e os botoes
  // apareciam direto, sem checar duplicata.
  // v3.28 - a MESMA devolucao pode ter sido triada por outro identificador
  // (ex: Diego triou pela chave da NF; o QR chega com o protocolo). Passamos
  // os DOIS pro status, que busca por OR - reconhece por qualquer porta.
  // b166.4 (Codex): o NUMERO DA NF entra na cascata do principal. Buscando
  // pelo numero, a nota pode voltar SEM chaveAcesso — e ai, sem shipment e
  // sem protocolo Magalu, o idPrincipal ficava null e a verificacao nem era
  // chamada. Resultado: registro gravado por nf_numero passava sem banner,
  // que e justamente o que este PR veio impedir. Fica por ultimo pra nao
  // roubar a vez de identificador mais especifico.
  const idPrincipal = shipment.id || nf?.chaveAcesso || nf?.chave
    || data.magalu?.protocolo || nf?.numero || null;
  // b166.1 (Codex): TODAS as portas pelas quais aquele pacote pode ter sido
  // gravado antes. Antes ia so o protocolo Magalu como alternativo, entao
  // registro salvo pelo numero da NF ou pelo rastreio dos Correios passava
  // batido e dava pra triar de novo sem aviso.
  const idAlternativo = [
    data.magalu?.protocolo,
    shipment.id,
    nf?.chaveAcesso, nf?.chave,
    nf?.numero,                       // o numero da NF, sem os 44 digitos
    data.pack?.id,
    // b166.2 (Codex): o RASTREIO da remessa reversa. Numa etiqueta dos
    // Correios (AD/AP...BR) o backend guarda o codigo bipado em
    // data.ml_return.tracking — nao em shipment.tracking. Sem esta linha, o
    // registro gravado so pelo tracking continuava sem ser achado, que era
    // exatamente o caso que o filtro novo veio cobrir.
    data.ml_return?.tracking, data.return?.tracking,
    shipment.tracking, data.tracking,
    // b167 - O PEDIDO VOLTA A ENTRAR SEMPRE.
    //
    // Eu tinha tirado o pedido achando que evitava falso positivo: os dados
    // mostravam o pedido 2000017367190752 com DOIS shipments, e eu li isso
    // como "dois envios legitimos". Com as duas etiquetas na mao (29/08), a
    // premissa caiu: uma e a NOSSA POSTAGEM (envio 47501559178) e a outra e
    // a que o ML deu pro cliente DEVOLVER (47528658744). Mesma venda, ida e
    // volta — e por isso deu pra triar duas vezes.
    //
    // O identificador estavel de uma venda nao e o envio, que muda; e a NF
    // (uma por venda, em qualquer marketplace) e o PACK, que e o mesmo nas
    // duas etiquetas. O pedido idem. Entao vai tudo.
    data.order?.id,
  ];
  window._magaluProtocolo = data.magalu?.protocolo || null; // p/ triagem gravar
  if (idPrincipal) {
    verificarTriagemExistente(idPrincipal, idAlternativo);
  } else {
    renderizarBotoesTriagem();
  }
}

// ================ VERIFICAR TRIAGEM EXISTENTE ================
/**
 * b78 - Busca a foto de cada item DEPOIS que o resultado ja apareceu.
 * A identificacao nao pode esperar por imagem. O servidor resolve pelo
 * SKU (ou pelo id do produto) e cacheia, entao bipar o mesmo produto de
 * novo ja vem instantaneo. Uma de cada vez com pausa: sao chamadas ao
 * Bling. Se nao vier foto, o 📦 fica e nada quebra.
 */
async function buscarFotosItens(itens) {
  if (!Array.isArray(itens) || !itens.length) return;
  for (let i = 0; i < itens.length && i < 4; i++) {
    const it = itens[i];
    // b235 - item com vinculo mas SEM codigo: o id vira a chave, senao a
    // busca era descartada aqui mesmo, com o identificador confiavel em mao.
    const pidItem = (it && (it.produto_id || it.produtoId)) ? String(it.produto_id || it.produtoId).replace(/\D/g, '') : '';
    const chave = (it && (it.sku || it.id)) || (pidItem || null);
    if (!chave || chave === '-') {
      if (!pidItem) continue;
    }
    const alvo = document.getElementById('fotoitem-' + i);
    if (!alvo) continue;
    try {
      // b225 - manda tambem o EAN que a tela ja mostra: quando o SKU do
      // anuncio nao casa com o codigo do Bling, e por ele que a foto vem.
      // b233 - o id do produto vindo do item da NF e o caminho que nao erra:
      // e o vinculo que o Bling gravou na emissao. Vai na frente do SKU.
      const pid = pidItem;
      const r = await fetch('/api/produto/imagem/' + encodeURIComponent(chave || pidItem)
        + (pid ? '?produtoId=' + encodeURIComponent(pid) : ''), { credentials: 'same-origin' });
      const d = await r.json();
      if (d && d.ok && !d.imagem && d.motivo) console.info('[FOTO]', chave, '→', d.motivo);
      if (d && d.ok && d.imagem) {
        alvo.outerHTML = '<img class="dvi-f" src="' + escapeHtml(d.imagem) + '" alt=""'
          + ' onclick="abrirZoomProduto(this.src)" onerror="this.style.display=\'none\'"'
          + ' style="cursor:zoom-in;">';
      }
    } catch (e) { /* sem foto nao atrapalha a triagem */ }
    await new Promise(r2 => setTimeout(r2, 150));
  }
}

/**
 * Quantidade por extenso, como na nota fiscal: "2 (DUAS) UNIDADES".
 * Ate 20 escreve a palavra; acima disso so o numero (o galpao nunca
 * recebe devolucao com 30 pecas do mesmo item, e "TRINTA E TRES" na
 * tela nao ajuda ninguem).
 */
function qtdPorExtenso(n) {
  var q = Number(n) || 0;
  var nomes = ['ZERO', 'UMA', 'DUAS', 'TRES', 'QUATRO', 'CINCO', 'SEIS', 'SETE', 'OITO',
    'NOVE', 'DEZ', 'ONZE', 'DOZE', 'TREZE', 'QUATORZE', 'QUINZE', 'DEZESSEIS',
    'DEZESSETE', 'DEZOITO', 'DEZENOVE', 'VINTE'];
  var palavra = nomes[q] ? ' (' + nomes[q] + ')' : '';
  // o numero sai em <b> pra ficar maior dentro da pastilha amarela
  return '<b>' + q + '</b><span>' + palavra.trim()
    + (q === 1 ? ' UNIDADE VOLTANDO' : ' UNIDADES VOLTANDO') + '</span>';
}

/** Copia a chave da NF (antes so dava pra selecionar na mao). */
function copiarChaveNF(btn) {
  var el = document.getElementById('nfChave');
  if (!el) return;
  var txt = el.textContent.trim();
  try { navigator.clipboard.writeText(txt); } catch (e) {
    var t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t);
    t.select(); try { document.execCommand('copy'); } catch (e2) {} document.body.removeChild(t);
  }
  var antes = btn.innerHTML; btn.innerHTML = '\u2705';
  setTimeout(function () { btn.innerHTML = antes; }, 1200);
}

async function verificarTriagemExistente(shipmentId, idAlternativo) {
  window._forcarTriagem = false; // reset ao bipar nova etiqueta
  const cont = document.getElementById('triagemConteudo');
  if (!cont) return;

  try {
    // b166.1 (Codex): manda TODOS os identificadores que existirem, nao so
    // dois. A consulta do servidor procura por shipment, pedido, tracking,
    // numero da NF e chave — mas so acha o que a gente MANDA. Um registro
    // gravado so pelo numero da NF nao era achado, porque o front mandava a
    // chave de 44 digitos; o filtro nf_numero.eq.<chave> nunca casava.
    const extras = (Array.isArray(idAlternativo) ? idAlternativo : [idAlternativo])
      .map((x) => String(x == null ? '' : x).trim())
      .filter((x) => x && x !== String(shipmentId));
    const vistos = {};
    const unicos = extras.filter((x) => (vistos[x] ? false : (vistos[x] = true)));
    const extra = unicos.length
      ? '?' + unicos.map((x) => 'tambem=' + encodeURIComponent(x)).join('&')
      : '';
    const r = await fetch('/api/triagem/status/' + encodeURIComponent(shipmentId) + extra);
    const d = await r.json();
    if (!d.ok) {
      renderizarBotoesTriagem();
      return;
    }
    const registros = d.registros || [];
    if (registros.length === 0) {
      renderizarBotoesTriagem();
      return;
    }
    renderizarTriagemDuplicata(registros[0]);
  } catch (err) {
    renderizarBotoesTriagem();
  }
}

function renderizarBotoesTriagem() {
  const cont = document.getElementById('triagemConteudo');
  if (!cont) return;
// b223/b224 (review do Codex) - PRECISA ser global: o `onclick` inline e
// avaliado no escopo da window, e a funcao estava presa dentro de
// renderizarBotoesTriagem — clicar dava ReferenceError e o atalho, que
// existe justamente pro celular, nunca rolava a tela.
window.irProRecado = function () {
  const id = (window._recadosPendentes || [])[0];
  const el = id ? document.getElementById('recado-' + id) : document.querySelector('[id^="recado-"]');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  let n = 0;
  const piscar = setInterval(() => {
    el.style.boxShadow = (n % 2 === 0) ? '0 0 0 6px rgba(198,40,40,.35)' : 'none';
    if (++n > 5) { clearInterval(piscar); el.style.boxShadow = 'none'; }
  }, 220);
  // b224 - guarda o handle: se a busca re-renderizar o card no meio, o
  // intervalo antigo ficava mexendo num elemento que ja saiu da tela.
  if (window._piscaRecado) clearInterval(window._piscaRecado);
  window._piscaRecado = piscar;
};

  // v3.33 - TRAVA: recado sem ciencia bloqueia a triagem. O estoquista tem
  // que ler e clicar "OK, ciente" antes de incluir no estoque/reportar.
  if ((window._recadosPendentes || []).length > 0) {
    cont.innerHTML = '<div style="border:3px solid #c62828;background:#fff3e0;border-radius:10px;padding:16px;text-align:center;">'
      + '<div style="font-size:19px;font-weight:800;color:#c62828;">🔒 Triagem bloqueada</div>'
      // b223 - o caminho pra destravar tem que saltar: fonte maior, o botao
      // desenhado do mesmo jeito que ele vai ver la em cima, e um atalho que
      // rola a tela ate o recado (em celular ele fica fora da area visivel).
      + '<div style="font-size:16px;margin-top:8px;line-height:1.5;">Leia o <b>RECADO</b> no topo da tela e clique em</div>'
      + '<div style="display:inline-block;background:#2e7d32;color:#fff;border-radius:8px;padding:9px 18px;'
      + 'font-size:16px;font-weight:800;margin:9px 0 4px;">✓ OK, ciente</div>'
      + '<div style="font-size:16px;">para liberar os botões.</div>'
      + '<button type="button" onclick="irProRecado()" style="margin-top:11px;background:#c62828;color:#fff;'
      + 'border:none;border-radius:9px;padding:11px 20px;font-size:15px;font-weight:800;cursor:pointer;">'
      + '⬆️ Ir para o recado</button>'
      + '</div>';
    return;
  }
  // v3.18.0 - 3 botoes: APROVAR (verde), PROBLEMA (vermelho), DIVERGENTE (roxo)
  cont.innerHTML = `
    <div class="triagem-instrucao">
      Confere o produto, abre o pacote e escolhe abaixo:
    </div>
    <div class="triagem-botoes">
      <button class="triagem-btn triagem-btn-aprovar" onclick="abrirModalAprovar()">
        <span class="triagem-btn-icon">✅</span>
        INCLUIR<br>ESTOQUE
      </button>
      <button class="triagem-btn triagem-btn-problema" onclick="abrirModalProblema()">
        <span class="triagem-btn-icon">⚠️</span>
        REPORTAR<br>PROBLEMA
      </button>
      <button class="triagem-btn triagem-btn-divergente" onclick="abrirModalDivergente()"
              style="background:linear-gradient(135deg,#7b1fa2,#4a148c); color:white;">
        <span class="triagem-btn-icon">🔄</span>
        PRODUTO<br>DIVERGENTE
      </button>
    </div>
    <div style="font-size:11px; color:#666; margin-top:8px; text-align:center; line-height:1.5;">
      💡 <strong>Divergente</strong> = produto que voltou é diferente do que estava na NF
      (ex: enviamos o errado pelo cliente)
    </div>
  `;
}

function renderizarTriagemDuplicata(reg) {
  const cont = document.getElementById('triagemConteudo');
  if (!cont) return;

  // v3.18.0 - inclui 'divergente' no label
  let tipoLabel;
  if (reg.tipo === 'aprovado') {
    tipoLabel = '✅ APROVADA (incluida no estoque)';
  } else if (reg.tipo === 'problema') {
    tipoLabel = '⚠️ COM PROBLEMA';
  } else if (reg.tipo === 'divergente') {
    tipoLabel = '🔄 PRODUTO DIVERGENTE';
  } else {
    tipoLabel = reg.tipo || '?';
  }

  const statusLabel = reg.status === 'concluido'
    ? '<span style="background:#999;color:white;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:700;">✅ CONCLUIDA POR DIEGO</span>'
    : '<span style="background:#f57c00;color:white;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:700;">⏳ AGUARDANDO DIEGO</span>';

  const data = new Date(reg.created_at).toLocaleString('pt-BR', {
    dateStyle: 'short', timeStyle: 'short',
  });

  // b166.2 (Codex): o nome vem do CAMPO, nao mais so da descricao.
  //
  // A extracao por texto usava \w+, que nao aceita espaco nem acento: um
  // "Joao Silva" ou "Joao" com til viravam "Por ?" mesmo com o nome
  // gravado. E em triagem aprovada comum a descricao vem vazia, entao nao
  // havia texto nenhum de onde extrair.
  //
  // A coluna `funcionario` sempre teve o nome. A leitura da descricao fica
  // de reserva, pros registros antigos que so tem o texto.
  let triadoPor = String(reg.funcionario || '').trim();
  if (!triadoPor) {
    const desc = reg.problema_descricao || '';
    // [^\]] e o que muda: pega o nome inteiro ate o fecha-colchete,
    // espacos e acentos inclusos
    const m1 = desc.match(/Aprovado por\s+([^\[\]\n]+?)\s*(?:\[|$)/i);
    const m2 = desc.match(/\[Reportado por\s+([^\]]+)\]/i);
    const m3 = desc.match(/\[DIVERGENTE por\s+([^\]]+)\]/i);
    if (m2) triadoPor = m2[1].trim();
    else if (m3) triadoPor = m3[1].trim();
    else if (m1) triadoPor = m1[1].trim();
  }
  if (!triadoPor) triadoPor = '?';

  // b166 - VERMELHO e com ACENTO (pedido do dono, 29/08). Era laranja e sem
  // acento; num galpao corrido, laranja passa por "aviso" e nao por "pare".
  cont.innerHTML = `
    <div style="background:#ffebee;border:3px solid #c62828;border-radius:10px;padding:16px;text-align:center;">
      <div style="font-size:36px;margin-bottom:6px;">⛔</div>
      <div style="font-size:17px;font-weight:800;color:#b71c1c;margin-bottom:6px;">
        ESTA DEVOLUÇÃO JÁ FOI TRIADA
      </div>
      <div style="font-size:13.5px;color:#4e342e;line-height:1.6;">
        <strong>${escapeHtml(tipoLabel)}</strong><br>
        Por <strong>${escapeHtml(triadoPor)}</strong> em <strong>${escapeHtml(data)}</strong><br>
        ${statusLabel}
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid #ef9a9a;font-size:12.5px;color:#4e342e;">
        ${reg.status === 'concluido'
          ? 'Já foi resolvida. <strong>Não precisa fazer nada.</strong>'
          : 'O Diego já foi avisado. <strong>Aguarde retorno.</strong>'}
      </div>

      <!-- b166 - o aviso de re-triagem virou BANNER, nao popup. O confirm()
           some com um Enter distraido; o banner fica na tela e obriga a ler
           antes de achar o botao. -->
      <div id="avisoReTriagem" style="display:none;margin-top:14px;background:#b71c1c;color:#fff;border-radius:8px;padding:12px 14px;text-align:left;">
        <div style="font-size:14px;font-weight:800;margin-bottom:4px;">⛔ ATENÇÃO — vai criar um SEGUNDO registro</div>
        <div style="font-size:12.5px;line-height:1.55;">
          Este pacote já foi triado. Triar de novo <strong>não corrige</strong> a triagem anterior:
          cria outra, e o Diego vai ver as duas na hora de emitir a NF.<br>
          <strong>Só continue se a primeira foi engano.</strong>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-action" style="background:#fff;color:#b71c1c;font-weight:800;font-size:12px;padding:8px 14px;"
            onclick="forcarReTriagem()">Sim, triar mesmo assim</button>
          <button class="btn-action" style="background:rgba(255,255,255,0.18);color:#fff;font-size:12px;padding:8px 14px;"
            onclick="document.getElementById('avisoReTriagem').style.display='none';document.getElementById('btnAbrirReTriagem').style.display='';">
            Cancelar</button>
        </div>
      </div>

      <button id="btnAbrirReTriagem" class="btn-action cinza" style="margin-top:12px;font-size:11px;padding:6px 12px;"
        onclick="this.style.display='none';document.getElementById('avisoReTriagem').style.display='block';">
        🔄 Triar mesmo assim (só se foi engano)
      </button>
    </div>
  `;
}

function forcarReTriagem() {
  window._forcarTriagem = true;
  renderizarBotoesTriagem();
  toast('Modo re-triagem ativado', 'ok');
}

// v3.51 - Escolha de SERIE: o mesmo numero existe em mais de uma serie.
// Mostra o essencial de cada NF (serie, data, valor, cliente, produto) pro
// estoquista bater com o pacote e clicar na certa. Clicar re-busca pela
// CHAVE da NF escolhida, que e inequivoca.
function renderizarEscolhaSerie(amb) {
  const opcoes = amb.opcoes || [];
  let html = '<div class="card">';
  html += '<div class="erro-box" style="background:#fff8e7;border-color:#f57c00;color:#8a5200;">';
  html += '<strong>⚠️ Existem ' + opcoes.length + ' notas com o numero ' + escapeHtml(String(amb.numero)) + '</strong>';
  html += '<div style="margin-top:6px;font-size:13px;">A empresa emite em varias series (1 = venda normal, 2 = ML FULL, e outras para Magalu/Amazon FULL). Confira o produto e o cliente na caixa e escolha a nota certa:</div>';
  html += '</div>';

  opcoes.forEach((o) => {
    const data = o.dataEmissao ? new Date(o.dataEmissao).toLocaleDateString('pt-BR') : '-';
    const valor = (o.valor != null) ? ('R$ ' + Number(o.valor).toFixed(2).replace('.', ',')) : '-';
    html += '<div class="item" style="margin-top:12px;border-left-color:#f57c00;">';
    html += '<div style="font-weight:700;font-size:15px;">NF ' + escapeHtml(String(o.numero)) + ' · <span style="color:#f57c00;">SERIE ' + escapeHtml(String(o.serie)) + '</span></div>';
    if (o.produto) html += '<div style="margin-top:6px;font-size:13px;">📦 ' + escapeHtml(o.produto) + '</div>';
    if (o.sku) html += '<div style="font-size:12px;color:#666;">SKU ' + escapeHtml(o.sku) + '</div>';
    html += '<div style="margin-top:6px;font-size:12px;color:#666;">👤 ' + escapeHtml(o.cliente || '-') + ' &nbsp;·&nbsp; 📅 ' + data + ' &nbsp;·&nbsp; 💰 ' + valor + '</div>';
    if (o.numeroPedidoLoja) html += '<div style="font-size:12px;color:#666;">Pedido loja: ' + escapeHtml(String(o.numeroPedidoLoja)) + '</div>';
    if (o.chave) {
      html += '<button class="btn btn-verde" style="margin-top:10px;" onclick="escolherNFSerie(\'' + escapeHtml(o.chave) + '\')">✅ E esta (serie ' + escapeHtml(String(o.serie)) + ')</button>';
    }
    html += '</div>';
  });

  html += '<div style="margin-top:14px;font-size:12px;color:#666;">💡 Se preferir, bipe a <b>chave da DANFE</b> (44 digitos) — ela ja identifica a serie sozinha.</div>';
  html += '</div>';
  divResultado.innerHTML = html + blocoEventosCheckout();   // ev2
  divResultado.classList.add('show');
}

// Escolheu uma serie: re-busca pela chave (inequivoca) e segue o fluxo normal
function escolherNFSerie(chave) {
  inputCodigo.value = chave;
  buscar();
}

// v3.30 - lista de candidatos achados pelo NOME do remetente
function renderizarCandidatosNome(mensagem, candidatos) {
  // v3.30.1 - padrao da casa: divResultado + classList.add('show')
  // (sem o 'show' o CSS esconde a area - era o "nada acontece na tela")
  let html = '<div class="card" style="border-left: 4px solid #f57c00;">';
  html += '<h3 style="margin-top:0;">👤 ' + escapeHtml(mensagem || 'Candidatos pelo nome') + '</h3>';
  html += '<div style="display:flex; flex-direction:column; gap:8px;">';
  for (const c of candidatos) {
    const dt = c.dataEmissao ? String(c.dataEmissao).slice(0, 10).split('-').reverse().join('/') : '-';
    const vl = (c.valor != null) ? ('R$ ' + Number(c.valor).toFixed(2).replace('.', ',')) : '-';
    const alvo = c.serie && c.serie !== '1' ? (c.numero + '/' + c.serie) : c.numero;
    // b226 - o candidato que esta NA ESPREITA ganha estrela, borda e o
    // produto. [stated] "se ele tem q triar um mouse, e tem 5 maristelas na
    // relação da busca, e 1 maristela é uma bola de basquete, com certeza
    // ele já sabe q aquele da relação não é o mouse."
    const naEsp = !!c.na_espreita;
    const estilo = naEsp
      ? 'text-align:left; padding:12px 14px; border:3px solid #f9a825; background:#fff8e1; color:#333; box-shadow:0 2px 10px rgba(249,168,37,.4);'
      : 'text-align:left; padding:10px 12px; opacity:.85;';
    let itens = '';
    // b227: os itens aparecem em TODOS os candidatos que os tem, nao so nos
    // da espreita — e o que deixa o estoquista descartar sem abrir nada
    if (Array.isArray(c.itens) && c.itens.length) {
      itens = '<div style="margin-top:6px; font-size:13px; color:' + (naEsp ? '#5d4037' : '#333') + ';">'
        + c.itens.slice(0, 3).map((it) => '📦 <b>' + escapeHtml(String(it.qtd)) + '×</b> '
            + escapeHtml(it.descricao || it.sku || '?')).join('<br>')
        + (c.itens.length > 3 ? '<br>… +' + (c.itens.length - 3) : '')
        + '</div>';
    } else if (naEsp && c.produto) {
      itens = '<div style="margin-top:6px; font-size:13px; color:#5d4037;">📦 ' + escapeHtml(c.produto) + '</div>';
    }
    html += '<button class="btn" style="' + estilo + '" onclick="document.getElementById(\'codigo\').value=\'' + alvo + '\'; buscar();">'
      + (naEsp ? '<span style="font-size:18px;">⭐</span> ' : '')
      + '<b>' + escapeHtml(c.nome) + '</b>'
      // b229 (Codex): ENTREGUE e EM TRANSITO sao estados diferentes — antes
      // tudo virava "entregue ha Nd", e o estoquista via como ja chegado um
      // pacote que ainda estava no correio
      + (naEsp ? ' <span style="font-size:11px; background:' + (c.espreita_estado === 'entregue' ? '#f9a825' : '#90caf9')
          + '; color:#333; padding:2px 8px; border-radius:10px; font-weight:700;">'
          + (c.espreita_estado === 'entregue'
              ? '📬 ENTREGUE' + (c.espreita_dias != null ? ' há ' + escapeHtml(String(c.espreita_dias)) + 'd' : '')
              : '🚚 A CAMINHO' + (c.espreita_dias != null ? ' · ' + escapeHtml(String(c.espreita_dias)) + 'd em trânsito' : ''))
          + '</span>' : '')
      + '<br>🧾 NF ' + escapeHtml(c.numero) + (c.serie ? ' (série ' + escapeHtml(c.serie) + ')' : '') + ' · ' + dt + ' · ' + vl
      + (naEsp && c.tracking ? ' · 📮 ' + escapeHtml(c.tracking) : '')
      + itens
      + '</button>';
  }
  html += '</div>';
  html += '<p style="font-size:12px; color:#888; margin-bottom:0;">⚠️ Confere o produto da CAIXA antes de escolher — nomes podem se repetir.</p>';
  html += '</div>';
  divResultado.innerHTML = html + blocoEventosCheckout();   // ev2
  divResultado.classList.add('show');
}

// v3.32 - ciencia do recado (registra quem leu e quando)
async function recadoCiente(id, btn) {
  btn.disabled = true;
  btn.textContent = 'salvando...';
  try {
    const r = await fetch('/api/recado/' + id + '/ciente', { method: 'POST' });
    const d = await r.json();
    if (!d.ok) { btn.disabled = false; btn.textContent = '✓ OK, ciente'; alert('Falhou: ' + (d.erro || '')); return; }
    window._recadosPendentes = (window._recadosPendentes || []).filter(x => x !== id);
    if ((window._recadosPendentes || []).length === 0) renderizarBotoesTriagem(); // libera a triagem
    // b224 (review do Codex) - o texto tambem sai do estado "grita": sem
    // isto ele continuava 21px/800 vermelho depois do "OK, ciente", e so
    // voltava ao normal na proxima busca.
    const txt = document.getElementById('recado-texto-' + id);
    if (txt) {
      txt.style.fontSize = '16px';
      txt.style.fontWeight = '600';
      txt.style.color = '#444';
      txt.style.background = 'none';
      txt.style.border = 'none';
      txt.style.padding = '0';
    }
    const box = document.getElementById('recado-' + id);
    if (box) {
      box.style.borderColor = '#9e9e9e';
      box.style.background = '#fafafa';
      btn.outerHTML = '<div style="font-size:12px;color:#666;">✅ ciente por ' + escapeHtml(d.usuario || '-') + ' agora</div>';
    }
  } catch (e) { btn.disabled = false; btn.textContent = '✓ OK, ciente'; }
}

function renderizarErro(mensagem, tentativas) {
  let html = '<div class="card"><div class="erro-box"><strong>❌ ' + escapeHtml(mensagem) + '</strong></div>';
  if (tentativas?.length) {
    html += '<div class="secao-titulo" style="margin-top:14px;">Tentativas</div><ul class="tentativas-list">';
    tentativas.forEach(t => {
      html += `<li>${escapeHtml(t.tipo)}: <code>${escapeHtml(String(t.codigo))}</code> → status ${t.status}</li>`;
    });
    html += '</ul>';
  }
  html += '</div>';
  divResultado.innerHTML = html + blocoEventosCheckout();   // ev2
  divResultado.classList.add('show');
}
