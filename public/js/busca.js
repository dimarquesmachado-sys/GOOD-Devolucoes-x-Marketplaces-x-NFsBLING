// ============================================================
// busca.js - busca pela etiqueta, render do resultado completo
// v3.18.0 - 3o botao PRODUTO DIVERGENTE
// ============================================================
// Inclui: buscar, buscarLinksBling, renderizar, renderizarErro,
//         verificarTriagemExistente, renderizarBotoesTriagem,
//         renderizarTriagemDuplicata, forcarReTriagem

let ultimaBusca = null; // dados completos da ultima busca

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
      + '<div style="font-size:15px;font-weight:800;color:' + (lido ? '#616161' : '#c62828') + ';">📣 RECADO SOBRE ESSA DEVOLUÇÃO</div>'
      + '<div style="font-size:15px;margin:6px 0;white-space:pre-wrap;">' + escapeHtml(rc.texto) + '</div>'
      + (lido
          ? '<div style="font-size:12px;color:#666;">✅ ciente por ' + escapeHtml(rc.ciente_por || '-') + ' em ' + (rc.ciente_em ? String(rc.ciente_em).slice(0, 10).split('-').reverse().join('/') : '-') + '</div>'
          : '<button onclick="recadoCiente(' + rc.id + ', this)" style="background:#2e7d32;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:800;cursor:pointer;">✓ OK, ciente</button>')
      + '</div>';
  }

  // BADGES TOPO — v4.37: linha flex, com o botao do marketplace no canto
  html += '<div class="linha-selos">';
  html += ehDevolucao
    ? '<span class="badge badge-devolucao">📦 DEVOLUCAO</span>'
    : '<span class="badge badge-info">📦 ENVIO</span>';
  html += `<span class="badge badge-info">Metodo: ${data.metodo || '-'}</span>`;
  // v3.28 - rotulo do marketplace conforme o metodo (era fixo "ML")
  const nomeMkt = data.magalu ? 'Magalu'
    : (data.shopee || String(data.metodo || '').includes('shopee')) ? 'Shopee'
    : (String(data.metodo || '').includes('nf') || String(data.metodo || '').includes('chave')) ? (data.magalu ? 'Magalu' : 'Nota Fiscal')
    : 'Mercado Livre';
  if (order && order.id) html += `<span class="badge badge-sucesso">✅ Pedido ${nomeMkt === 'Nota Fiscal' ? '' : nomeMkt}</span>`;
  if (nf) {
    html += '<span class="badge badge-nfe">🧾 NF-e</span>';
    html += `<span class="badge badge-fonte-ml">via ${nomeMkt}</span>`;
  }

  // v4.33 - a barra amarela gigante saiu: a quantidade agora vive
  // dentro do card do produto, em cima do titulo (sem repetir).

  // v4.37 - BOTAO PRA ABRIR O PEDIDO NO MARKETPLACE, no canto direito da
  // linha dos selos. Shopee passa pelo de-para do checkout da GOOD (que
  // resolve o order_sn no id interno) e Magalu pela rota OAuth da GOOD.
  (function () {
    let alvo = data.link_marketplace || null;
    if (!alvo && order && order.id) {
      const m = String(data.metodo || '').toLowerCase();
      if (data.magalu || m.includes('magalu')) {
        alvo = { nome: 'Magalu', url: '/magalu/ir/good?n=' + encodeURIComponent(String(order.id).replace(/\D/g, '')) };
      } else if (data.shopee || m.includes('shopee')) {
        alvo = { nome: 'Shopee', url: 'https://mover-pedidos-aguardando-x-atendido.onrender.com/good-checkout-offline/ir-shopee?sn=' + encodeURIComponent(order.id) };
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
    // v4.31 - FOTO DO PRODUTO no card do item, a esquerda do 2x/titulo/
    // SKU/EAN: o estoquista bate o olho e confere com a caixa sem
    // procurar em outro canto. A imagem entra depois (a identificacao
    // nao espera por ela) - ver buscarFotosItens().
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
      html += `<div class="aviso-box" style="margin-top:10px;">⚠️ ${escapeHtml(a.mensagem)}</div>`;
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
  html += `<div><div class="label">Order ID (ML)</div><div class="valor">${order.id || '-'}</div></div>`;
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

  divResultado.innerHTML = html;
  divResultado.classList.add('show');
  buscarFotosItens(itensRender);   // v4.31 - fotos dos itens (nao bloqueia)

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
  const idPrincipal = shipment.id || nf?.chaveAcesso || nf?.chave || data.magalu?.protocolo || null;
  const idAlternativo = (data.magalu?.protocolo && data.magalu.protocolo !== idPrincipal) ? data.magalu.protocolo : null;
  window._magaluProtocolo = data.magalu?.protocolo || null; // p/ triagem gravar
  if (idPrincipal) {
    verificarTriagemExistente(idPrincipal, idAlternativo);
  } else {
    renderizarBotoesTriagem();
  }
}

// ================ VERIFICAR TRIAGEM EXISTENTE ================
/**
 * v4.31 - Busca a foto de cada item DEPOIS que o resultado ja apareceu.
 * A identificacao nao pode esperar por imagem. O servidor resolve pelo
 * SKU (ou pelo id do produto) e cacheia, entao bipar o mesmo produto de
 * novo ja vem instantaneo. Uma de cada vez com pausa: sao chamadas ao
 * Bling. Se nao vier foto, o 📦 fica e nada quebra.
 */
async function buscarFotosItens(itens) {
  if (!Array.isArray(itens) || !itens.length) return;
  for (let i = 0; i < itens.length && i < 4; i++) {
    const it = itens[i];
    const chave = (it && (it.sku || it.id)) || null;
    if (!chave || chave === '-') continue;
    const alvo = document.getElementById('fotoitem-' + i);
    if (!alvo) continue;
    try {
      const r = await fetch('/api/produto/imagem/' + encodeURIComponent(chave), { credentials: 'same-origin' });
      const d = await r.json();
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
    const extra = idAlternativo ? ('?tambem=' + encodeURIComponent(idAlternativo)) : '';
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
  // v3.33 - TRAVA: recado sem ciencia bloqueia a triagem. O estoquista tem
  // que ler e clicar "OK, ciente" antes de incluir no estoque/reportar.
  if ((window._recadosPendentes || []).length > 0) {
    cont.innerHTML = '<div style="border:3px solid #c62828;background:#fff3e0;border-radius:10px;padding:16px;text-align:center;">'
      + '<div style="font-size:16px;font-weight:800;color:#c62828;">🔒 Triagem bloqueada</div>'
      + '<div style="font-size:14px;margin-top:6px;">Leia o <b>RECADO</b> no topo da tela e clique em <b>"✓ OK, ciente"</b> para liberar os botões.</div>'
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

  // Extrair quem triou da descricao
  let triadoPor = '?';
  const desc = reg.problema_descricao || '';
  const m1 = desc.match(/Aprovado por\s+(\w+)/i);
  const m2 = desc.match(/\[Reportado por\s+(\w+)\]/i);
  const m3 = desc.match(/\[DIVERGENTE por\s+(\w+)\]/i);
  if (m1) triadoPor = m1[1];
  else if (m2) triadoPor = m2[1];
  else if (m3) triadoPor = m3[1];

  cont.innerHTML = `
    <div style="background:#fff3e0;border:2px solid #ff9800;border-radius:10px;padding:14px;text-align:center;">
      <div style="font-size:32px;margin-bottom:6px;">⚠️</div>
      <div style="font-size:15px;font-weight:700;color:#e65100;margin-bottom:4px;">
        Esta devolucao JA FOI TRIADA
      </div>
      <div style="font-size:13px;color:#5d4037;line-height:1.6;">
        <strong>${escapeHtml(tipoLabel)}</strong><br>
        Por <strong>${escapeHtml(triadoPor)}</strong> em <strong>${escapeHtml(data)}</strong><br>
        ${statusLabel}
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid #ffcc80;font-size:12px;color:#5d4037;">
        ${reg.status === 'concluido'
          ? 'Ja foi resolvida. Nao precisa fazer nada.'
          : 'Diego ja foi avisado. Aguarde retorno.'}
      </div>
      <button class="btn-action cinza" style="margin-top:12px;font-size:11px;padding:6px 12px;"
        onclick="if(confirm('Tem certeza que quer triar de novo? Isso vai criar um SEGUNDO registro.')) forcarReTriagem()">
        🔄 Triar mesmo assim (so se foi engano)
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
  divResultado.innerHTML = html;
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
    html += '<button class="btn" style="text-align:left; padding:10px 12px;" onclick="document.getElementById(\'codigo\').value=\'' + alvo + '\'; buscar();">'
      + '<b>' + escapeHtml(c.nome) + '</b><br>'
      + '🧾 NF ' + escapeHtml(c.numero) + (c.serie ? ' (série ' + escapeHtml(c.serie) + ')' : '') + ' · ' + dt + ' · ' + vl
      + '</button>';
  }
  html += '</div>';
  html += '<p style="font-size:12px; color:#888; margin-bottom:0;">⚠️ Confere o produto da CAIXA antes de escolher — nomes podem se repetir.</p>';
  html += '</div>';
  divResultado.innerHTML = html;
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
  divResultado.innerHTML = html;
  divResultado.classList.add('show');
}
