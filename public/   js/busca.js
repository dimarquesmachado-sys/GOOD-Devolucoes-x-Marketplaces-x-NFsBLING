// ============================================================
// busca.js - busca pela etiqueta, render do resultado completo
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
    inputCodigo.select();
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

  let html = '<div class="card">';

  // BADGES TOPO
  html += ehDevolucao
    ? '<span class="badge badge-devolucao">📦 DEVOLUCAO</span>'
    : '<span class="badge badge-info">📦 ENVIO</span>';
  html += `<span class="badge badge-info">Metodo: ${data.metodo || '-'}</span>`;
  if (order && order.id) html += '<span class="badge badge-sucesso">✅ Order ML</span>';
  if (nf) {
    html += '<span class="badge badge-nfe">🧾 NF-e</span>';
    html += '<span class="badge badge-fonte-ml">via Mercado Livre</span>';
  }

  // QUANTIDADE EM DESTAQUE - total agregado
  if (qtdTotal > 0) {
    const ehMulti = itensRender.length > 1;
    html += `<div class="qtd-destaque">
      <div class="qtd-label">⚖️ Devolvendo</div>
      <div class="qtd-valor">${qtdTotal}</div>
      <div class="qtd-unidade">unidade${qtdTotal > 1 ? 's' : ''}${ehMulti ? ` em ${itensRender.length} produtos` : ''}</div>
    </div>`;
  }

  // CARDS DOS PRODUTOS (Bling = titulo limpo + EAN, ML = fallback)
  if (itensRender.length > 0) {
    if (itensRender.length > 1) {
      html += `<div class="multi-aviso">⚠️ Devolucao com ${itensRender.length} produtos diferentes - confira cada um abaixo</div>`;
    }
    html += '<div class="itens-lista">';
    itensRender.forEach((it) => {
      html += `<div class="item-card">
        <div class="item-card-header">
          <div class="item-card-qtd">${it.quantidade}x</div>
          <div class="item-card-titulo">${escapeHtml(it.titulo)}</div>
        </div>
        <div class="item-card-info">
          ${it.sku && it.sku !== '-' ? `<div class="info-codigo sku"><span class="info-label">SKU</span><span class="info-valor">${escapeHtml(it.sku)}</span></div>` : ''}
          ${it.ean && it.ean !== '-' ? `<div class="info-codigo ean"><span class="info-label">EAN</span><span class="info-valor">${escapeHtml(it.ean)}</span></div>` : ''}
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
    html += '<div class="secao-nf-titulo">🧾 Nota Fiscal</div>';
    html += '<div class="item-grid">';
    html += `<div><div class="label">Numero NF-e</div><div class="valor"><span class="nfe-numero">${escapeHtml(nf.numero || '-')}</span></div></div>`;
    html += `<div><div class="label">Serie</div><div class="valor"><strong>${escapeHtml(nf.serie || '-')}</strong></div></div>`;
    html += `<div><div class="label">Data emissao</div><div class="valor">${dataFmt(nf.dataEmissao)}</div></div>`;
    html += `<div><div class="label">Valor NF</div><div class="valor"><strong>${moeda(nf.valor)}</strong></div></div>`;
    if (nf.peso) {
      html += `<div><div class="label">Peso</div><div class="valor">${nf.peso}g</div></div>`;
    }
    if (nf.chaveAcesso) {
      html += `<div style="grid-column: 1/-1;"><div class="label">Chave de acesso</div><div class="nfe-chave">${escapeHtml(nf.chaveAcesso)}</div></div>`;
    }
    html += '</div>';

    html += '<div style="margin-top: 12px;" id="botoesNF">';
    if (order.id) {
      html += `<button id="btnBlingDemanda" class="btn-action cinza" onclick="buscarLinksBling('${order.id}', '${order.date_created || ''}', '${nf.numero || ''}')">🔍 Buscar links Bling</button>`;
    }
    html += '</div>';
    html += '</div>';
  } else if (order.id) {
    html += '<div class="secao-nf">';
    html += '<div class="secao-nf-titulo">🧾 Nota Fiscal</div>';
    html += '<p style="margin: 10px 0;">⚠️ NF-e nao localizada via Mercado Livre.</p>';
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

  // Apos render, verifica triagem existente (nao bloqueia o render)
  if (shipment.id) {
    verificarTriagemExistente(shipment.id);
  }
}

// ================ VERIFICAR TRIAGEM EXISTENTE ================
async function verificarTriagemExistente(shipmentId) {
  window._forcarTriagem = false; // reset ao bipar nova etiqueta
  const cont = document.getElementById('triagemConteudo');
  if (!cont) return;

  try {
    const r = await fetch('/api/triagem/status/' + encodeURIComponent(shipmentId));
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
    </div>
  `;
}

function renderizarTriagemDuplicata(reg) {
  const cont = document.getElementById('triagemConteudo');
  if (!cont) return;

  const tipoLabel = reg.tipo === 'aprovado'
    ? '✅ APROVADA (incluida no estoque)'
    : '⚠️ COM PROBLEMA';
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
  if (m1) triadoPor = m1[1];
  else if (m2) triadoPor = m2[1];

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
