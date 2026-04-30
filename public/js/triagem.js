// ============================================================
// triagem.js - fluxos APROVAR e PROBLEMA (orquestracao)
// ============================================================
// Inclui: abrir/fechar modais, montar payload, confirmar aprovar,
//         enviar problema, mostrar sucesso

function fecharModal(id) {
  document.getElementById(id).classList.remove('show');
}

// ================ TRIAGEM - APROVAR COM BIPAGEM ================
function abrirModalAprovar() {
  if (!ultimaBusca) return;
  const order = ultimaBusca.order || {};
  const nf = ultimaBusca.nf || {};
  const itensBling = Array.isArray(nf.itens) && nf.itens.length > 0 ? nf.itens : null;
  const itensML = Array.isArray(order.order_items) ? order.order_items : [];

  // Reset estado bipagem
  bipagemEstado = {
    itensEsperados: [],
    totalEsperado: 0,
    totalBipado: 0,
    tentativasErro: 0,
    forcado: false,
    observacao: null,
  };

  let itensHtml = '';
  if (itensBling) {
    itensBling.forEach((it, i) => {
      const qtd = Number(it.quantidade) || itensML[i]?.quantity || 1;
      const sku = it.sku || itensML[i]?.item?.seller_sku || '-';
      const ean = it.ean || '-';
      bipagemEstado.itensEsperados.push({
        titulo: it.titulo || '-',
        sku, ean, quantidade: qtd, bipados: 0,
      });
      bipagemEstado.totalEsperado += qtd;
      itensHtml += `<div style="padding:6px 0;border-bottom:1px solid #eee;" data-item-idx="${i}">
        <strong>${escapeHtml(it.titulo || '-')}</strong><br>
        <span style="font-size:12px;color:#666;">
          SKU <strong>${escapeHtml(sku)}</strong>
          ${ean !== '-' ? ` · EAN <strong>${escapeHtml(ean)}</strong>` : ''}
          · <strong id="bipItem${i}">0/${qtd}</strong>
        </span>
      </div>`;
    });
  } else {
    itensML.forEach((it, i) => {
      const qtd = Number(it.quantity) || 1;
      bipagemEstado.itensEsperados.push({
        titulo: it.item?.title || '-',
        sku: it.item?.seller_sku || '-',
        ean: '-',
        quantidade: qtd, bipados: 0,
      });
      bipagemEstado.totalEsperado += qtd;
      itensHtml += `<div style="padding:6px 0;border-bottom:1px solid #eee;" data-item-idx="${i}">
        <strong>${escapeHtml(it.item?.title || '-')}</strong><br>
        <span style="font-size:12px;color:#666;">
          SKU <strong>${escapeHtml(it.item?.seller_sku || '-')}</strong>
          · <strong id="bipItem${i}">0/${qtd}</strong>
        </span>
      </div>`;
    });
  }

  document.getElementById('modalAprovarDetalhes').innerHTML = itensHtml || '<em>Nenhum item encontrado</em>';

  // Verifica se TEM EAN cadastrado em todos os itens
  const todosComEan = bipagemEstado.itensEsperados.every(it => it.ean && it.ean !== '-');
  const aviso = document.getElementById('bipagemAviso');
  const conteudo = document.getElementById('bipagemConteudo');

  if (!todosComEan) {
    // Tenta buscar EAN no Bling pelo SKU em background antes de desistir
    aviso.style.display = 'block';
    aviso.style.background = '#fff3e0';
    aviso.style.border = '1px solid #ffc107';
    aviso.style.color = '#5d4037';
    aviso.innerHTML = `<div style="font-size:16px;margin-bottom:6px;">🔍 Buscando EAN do produto no Bling...</div>
      <div style="font-size:11px;opacity:0.7;">Aguarde alguns segundos</div>`;
    conteudo.style.display = 'none';

    document.getElementById('btnConfirmarAprovar').disabled = true;
    document.getElementById('btnConfirmarAprovar').style.opacity = '0.5';
    document.getElementById('btnConfirmarAprovar').style.cursor = 'not-allowed';

    // Mostra modal e busca EAN em paralelo
    document.getElementById('modalAprovar').classList.add('show');
    buscarEansFaltantes();
    return;
  }

  // Tem EAN em todos - libera bipagem
  aviso.style.display = 'none';
  conteudo.style.display = 'block';
  ativarBipagem();
  document.getElementById('modalAprovar').classList.add('show');
}

async function confirmarAprovar() {
  if (!ultimaBusca) return;
  const btn = document.getElementById('btnConfirmarAprovar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-mini"></span>Salvando...';

  try {
    // Se ainda nao tem idBling salvo, busca automaticamente em background
    // pra Diego ter botao "Abrir NF no Bling" funcionando direto
    const order = ultimaBusca.order || {};
    const nf = ultimaBusca.nf || {};
    if (order.id && nf.numero && !nf.idBling) {
      btn.innerHTML = '<span class="spinner-mini"></span>Localizando NF no Bling...';
      try {
        const params = new URLSearchParams();
        if (order.date_created) params.set('data', order.date_created);
        params.set('numeroNF', nf.numero);
        const url = `/api/nf/buscar-links-bling/${encodeURIComponent(order.id)}?${params.toString()}`;
        const r = await fetch(url);
        const d = await r.json();
        if (d.ok && d.nf) {
          ultimaBusca.nf = { ...nf, ...d.nf };
        }
      } catch (e) {
        // sem stress, segue mesmo sem idBling
      }
      btn.innerHTML = '<span class="spinner-mini"></span>Salvando...';
    }

    const payload = montarPayloadTriagem();
    if (window._forcarTriagem) payload.forcar = true;

    // Inclui flags de bipagem se foi forcado
    if (bipagemEstado.forcado && bipagemEstado.observacao) {
      payload.bipagem_forcada = true;
      payload.bipagem_observacao = bipagemEstado.observacao;
    }

    const r = await fetch('/api/triagem/aprovar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (d.ok) {
      fecharModal('modalAprovar');
      mostrarSucesso('✅ Incluido no estoque!', 'Diego ja foi avisado. Quando for emitir, basta clicar em "Abrir NF no Bling" no painel.');
      toast('Aprovacao registrada!', 'ok');
      setTimeout(() => {
        divResultado.classList.remove('show');
        inputCodigo.value = '';
        inputCodigo.focus();
      }, 2500);
    } else if (r.status === 409 && d.erro === 'duplicata') {
      fecharModal('modalAprovar');
      toast('Esta devolucao ja foi triada antes!', 'err');
      if (ultimaBusca?.shipment?.id) verificarTriagemExistente(ultimaBusca.shipment.id);
    } else {
      toast('Erro: ' + (d.erro || 'falha'), 'err');
      btn.disabled = false;
      btn.innerHTML = '✅ Confirmar';
    }
  } catch (err) {
    toast('Erro de conexao', 'err');
    btn.disabled = false;
    btn.innerHTML = '✅ Confirmar';
  }
}

function montarPayloadTriagem() {
  const order = ultimaBusca.order || {};
  const shipment = ultimaBusca.shipment || {};
  const itemOrder = order.order_items?.[0];
  const buyer = order.buyer || {};
  const nf = ultimaBusca.nf || {};

  const buyerNome = buyer.first_name
    ? `${buyer.first_name} ${buyer.last_name || ''}`.trim()
    : null;

  // Prioriza dados do Bling (titulo limpo, EAN), fallback ML
  const itemBling = (Array.isArray(nf.itens) && nf.itens.length > 0) ? nf.itens[0] : null;
  const tituloProduto = itemBling?.titulo || itemOrder?.item?.title || null;
  const skuProduto = itemBling?.sku || itemOrder?.item?.seller_sku || null;
  const qtdTotal = (Array.isArray(nf.itens) && nf.itens.length > 0)
    ? nf.itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0)
    : (itemOrder?.quantity || null);

  return {
    shipment_id: shipment.id,
    order_id: order.id,
    pack_id: order.pack_id,
    buyer_id: buyer.id,
    buyer_nome: buyerNome,
    produto_titulo: tituloProduto,
    produto_mlb: itemOrder?.item?.id,
    produto_sku: skuProduto,
    produto_qtd: qtdTotal,
    produto_valor_unit: itemOrder?.unit_price,
    nf_numero: nf.numero,
    nf_serie: nf.serie,
    nf_chave: nf.chaveAcesso,
    nf_valor: nf.valor,
    nf_data_emissao: nf.dataEmissao,
    nf_id_bling: nf.idBling,
    nf_link_danfe: nf.linkDanfe || nf.linkConsulta,
  };
}

function mostrarSucesso(titulo, mensagem) {
  const el = document.getElementById('triagemSucesso');
  if (!el) return;
  el.innerHTML = `
    <div class="triagem-sucesso">
      <h3>${escapeHtml(titulo)}</h3>
      <p>${escapeHtml(mensagem)}</p>
    </div>
  `;
  // Remove os botoes de triagem
  const botoes = document.querySelector('.triagem-botoes');
  if (botoes) botoes.style.display = 'none';
}

// ================ TRIAGEM - PROBLEMA ================
function abrirModalProblema() {
  // Reset estado
  window.fotosUploadadas = [];
  document.getElementById('problemaDescricao').value = '';
  document.getElementById('modalProblema').classList.add('show');
}

async function enviarProblema() {
  const fotos = window.fotosUploadadas || [];
  const fotosOk = fotos.filter(f => !f.uploading && f.url).map(f => f.url);
  if (fotosOk.length < 6) {
    toast(`Minimo 6 fotos obrigatorias (atual: ${fotosOk.length})`, 'err');
    return;
  }

  const descricao = document.getElementById('problemaDescricao').value.trim();

  // Loading no botao captura (caso voltar) e toast geral
  toast('Enviando problema...', '');

  try {
    const payload = montarPayloadTriagem();
    payload.descricao = descricao;
    payload.fotos = fotosOk;
    if (window._forcarTriagem) payload.forcar = true;

    const r = await fetch('/api/triagem/problema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (d.ok) {
      mostrarSucesso('⚠️ Problema reportado!', 'Email enviado pra Diego com as fotos. Aguarde retorno.');
      toast('Problema enviado!', 'ok');
      window.fotosUploadadas = [];
      setTimeout(() => {
        divResultado.classList.remove('show');
        inputCodigo.value = '';
        inputCodigo.focus();
      }, 2500);
    } else if (r.status === 409 && d.erro === 'duplicata') {
      toast('Esta devolucao ja foi triada antes!', 'err');
      if (ultimaBusca?.shipment?.id) verificarTriagemExistente(ultimaBusca.shipment.id);
    } else {
      toast('Erro: ' + (d.erro || 'falha'), 'err');
    }
  } catch (err) {
    toast('Erro de conexao', 'err');
  }
}
