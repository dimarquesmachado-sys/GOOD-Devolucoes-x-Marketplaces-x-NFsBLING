// ============================================================
// triagem.js - fluxos APROVAR e PROBLEMA (orquestracao)
// v3.17.0 - novo fluxo DEVOLUCAO PARCIAL (dentro do APROVAR)
// ============================================================
// Inclui: abrir/fechar modais, montar payload, confirmar aprovar,
//         enviar problema, mostrar sucesso, fluxo parcial

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

  // v3.17.0 - reseta flag de fluxo parcial
  window._fluxoParcial = false;

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
        <button onclick="imprimirEtiquetaItemBipagem(${i})" style="float:right; background:#5e35b1; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:14px; cursor:pointer; margin-left:8px;" title="Imprime a etiqueta 4x2,5 (EAN) na Zebra">🏷️</button>
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
        <button onclick="imprimirEtiquetaItemBipagem(${i})" style="float:right; background:#5e35b1; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:14px; cursor:pointer; margin-left:8px;" title="Imprime a etiqueta 4x2,5 (EAN) na Zebra">🏷️</button>
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
    magalu_protocolo: (ultimaBusca && ultimaBusca.magalu && ultimaBusca.magalu.protocolo) || window._magaluProtocolo || null, // v3.28
    order_id: order.id,
    pack_id: order.pack_id,
    buyer_id: buyer.id,
    buyer_nome: buyerNome,
    buyer_nickname: buyer.nickname || null,
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
  window._fluxoParcial = false; // v3.17.0 - garante fluxo problema (nao parcial)
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

// ============================================================
// v3.18.0 - FLUXO PRODUTO DIVERGENTE (envio errado do estoque)
// ============================================================
// Cliente comprou A, estoque enviou B, cliente devolveu B.
// Estoquista bipa o EAN de B -> sistema busca no Bling -> registra com SKU correto.

// Estado global do fluxo divergente
let divergenteEstado = {
  produtoEsperado: null,  // {sku, titulo} - o que estava na NF
  produtoCorreto: null,   // {sku, titulo, idBling} - o que voltou de fato
  qtd: 1,
  fotos: [],
};

function abrirModalDivergente() {
  if (!ultimaBusca) return;

  // Reset estado
  divergenteEstado = {
    produtoEsperado: null,
    produtoCorreto: null,
    qtd: 1,
    fotos: [],
  };
  window._fluxoDivergente = false;
  window.fotosUploadadas = [];

  // Pega item esperado da NF (1o item)
  const nf = ultimaBusca.nf || {};
  const itemBling = (Array.isArray(nf.itens) && nf.itens.length > 0) ? nf.itens[0] : null;
  const itemML = ultimaBusca.order?.order_items?.[0];

  divergenteEstado.produtoEsperado = {
    sku: itemBling?.sku || itemML?.item?.seller_sku || '?',
    titulo: itemBling?.titulo || itemML?.item?.title || '?',
    ean: itemBling?.ean || '?',
  };

  // Mostra info do esperado no modal
  document.getElementById('divergenteEsperadoInfo').innerHTML = `
    <strong>${escapeHtml(divergenteEstado.produtoEsperado.titulo)}</strong><br>
    <span style="font-size:11px; color:#666;">
      SKU <strong>${escapeHtml(divergenteEstado.produtoEsperado.sku)}</strong>
      ${divergenteEstado.produtoEsperado.ean !== '?' ? ` · EAN <strong>${escapeHtml(divergenteEstado.produtoEsperado.ean)}</strong>` : ''}
    </span>
  `;

  // Reseta campos
  document.getElementById('divergenteEAN').value = '';
  document.getElementById('divergenteResultado').style.display = 'none';
  document.getElementById('divergenteRecebidoInfo').innerHTML = '—';
  document.getElementById('divergenteQtd').value = '1';
  document.getElementById('divergenteObs').value = '';
  document.getElementById('btnContinuarDivergente').disabled = true;
  document.getElementById('btnContinuarDivergente').style.opacity = '0.5';
  document.getElementById('btnContinuarDivergente').style.cursor = 'not-allowed';

  document.getElementById('modalDivergente').classList.add('show');
  setTimeout(() => document.getElementById('divergenteEAN').focus(), 200);
}

// Busca produto no Bling pelo EAN ou SKU bipado
async function buscarProdutoDivergente() {
  const codigo = document.getElementById('divergenteEAN').value.trim();
  if (!codigo) {
    toast('Bipa o EAN ou digite o SKU', 'err');
    return;
  }

  // Verifica se nao bipou o MESMO produto da NF (seria erro - se for igual nao eh divergente)
  if (divergenteEstado.produtoEsperado.ean === codigo || divergenteEstado.produtoEsperado.sku === codigo) {
    if (!confirm('Esse codigo é o MESMO da NF original. Tem certeza que é divergente? Se sim, continua.')) {
      return;
    }
  }

  const btn = document.querySelector('#modalDivergente button[onclick="buscarProdutoDivergente()"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-mini"></span>Buscando...';
  }

  try {
    // Tenta buscar pelo codigo como SKU primeiro (mais rapido)
    let r = await fetch(`/api/produto/ean-por-sku/${encodeURIComponent(codigo)}`);
    let d = await r.json();
    let produto = d.encontrado ? d.produto : null;

    // Se nao achou como SKU, tenta como EAN (precisa endpoint que busca por EAN)
    // Por ora, se nao achou pelo SKU direto, mostra mensagem
    if (!produto) {
      // Mostra resultado mesmo sem dados completos do Bling
      // (estoquista pode continuar registrando manualmente)
      document.getElementById('divergenteResultado').style.display = 'block';
      document.getElementById('divergenteResultado').style.background = '#fff8e1';
      document.getElementById('divergenteResultado').style.borderColor = '#f57c00';
      document.getElementById('divergenteRecebidoInfo').innerHTML = `
        <span style="color:#e65100;">⚠️ Produto não encontrado no Bling pelo código <strong>${escapeHtml(codigo)}</strong></span><br>
        <span style="font-size:11px; color:#666;">Vai ser registrado com o código bipado mesmo. Diego analisa depois.</span>
      `;
      divergenteEstado.produtoCorreto = {
        sku: codigo,
        titulo: '(produto não cadastrado no Bling)',
        idBling: null,
      };
    } else {
      // Achou! Mostra confirmacao
      document.getElementById('divergenteResultado').style.display = 'block';
      document.getElementById('divergenteResultado').style.background = '#e8f5e9';
      document.getElementById('divergenteResultado').style.borderColor = '#2e7d32';
      document.getElementById('divergenteRecebidoInfo').innerHTML = `
        <strong>${escapeHtml(produto.nome || '?')}</strong><br>
        <span style="font-size:11px; color:#666;">
          SKU <strong>${escapeHtml(produto.codigo || codigo)}</strong>
          ${produto.gtin ? ` · EAN <strong>${escapeHtml(produto.gtin)}</strong>` : ''}
          · ID Bling: <code>${produto.id || '?'}</code>
        </span>
      `;
      divergenteEstado.produtoCorreto = {
        sku: produto.codigo || codigo,
        titulo: produto.nome || '(sem nome)',
        idBling: produto.id || null,
      };
    }

    // Libera botao continuar
    const btnCont = document.getElementById('btnContinuarDivergente');
    btnCont.disabled = false;
    btnCont.style.opacity = '1';
    btnCont.style.cursor = 'pointer';

  } catch (err) {
    toast('Erro: ' + err.message, 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔍 Buscar produto no Bling';
    }
  }
}

// Apos identificar produto, vai pra fotos (3 minimas)
function continuarDivergenteFotos() {
  if (!divergenteEstado.produtoCorreto) {
    toast('Bipe o produto que voltou primeiro', 'err');
    return;
  }

  // Salva qtd
  divergenteEstado.qtd = Math.max(1, parseInt(document.getElementById('divergenteQtd').value, 10) || 1);

  // Fecha modal e abre camera
  fecharModal('modalDivergente');
  window.fotosUploadadas = [];
  window._fluxoDivergente = true;

  // Reusa abertura de camera do fluxo parcial (sem modal de descricao)
  abrirCameraParaParcial();
}

// Chamado pelo finalizarFotos() em camera.js quando _fluxoDivergente=true
function abrirConfirmacaoDivergente(fotosOk) {
  window._fotosDivergente = fotosOk;

  document.getElementById('confirmacaoDivEsperado').innerHTML = `
    ${escapeHtml(divergenteEstado.produtoEsperado.titulo)}<br>
    <small style="color:#666;">SKU ${escapeHtml(divergenteEstado.produtoEsperado.sku)}</small>
  `;
  document.getElementById('confirmacaoDivRecebido').innerHTML = `
    ${escapeHtml(divergenteEstado.produtoCorreto.titulo)} (${divergenteEstado.qtd}x)<br>
    <small style="color:#666;">SKU ${escapeHtml(divergenteEstado.produtoCorreto.sku)}</small>
  `;
  document.getElementById('confirmacaoDivFotosCount').textContent = fotosOk.length;

  document.getElementById('modalConfirmacaoDivergente').classList.add('show');
}

// Envio final pro backend
async function encerrarDivergente() {
  const btn = document.getElementById('btnEncerrarDivergente');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-mini"></span>Salvando...';

  try {
    const fotosOk = window._fotosDivergente || [];
    if (fotosOk.length < 3) {
      toast('Erro: precisa ter 3+ fotos', 'err');
      btn.disabled = false;
      btn.innerHTML = '✅ Sim, Registrar';
      return;
    }

    // Busca idBling da NF se ainda nao tem
    const order = ultimaBusca.order || {};
    const nf = ultimaBusca.nf || {};
    if (order.id && nf.numero && !nf.idBling) {
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
      } catch (e) {}
    }

    // Monta payload baseado no triagem normal mas com SKU/titulo do produto que VOLTOU
    const payload = montarPayloadTriagem();

    // Sobrescreve com dados do produto correto (que voltou)
    payload.produto_sku_esperado = divergenteEstado.produtoEsperado.sku;
    payload.produto_correto_sku = divergenteEstado.produtoCorreto.sku;
    payload.produto_correto_titulo = divergenteEstado.produtoCorreto.titulo;
    payload.produto_qtd = divergenteEstado.qtd;
    payload.fotos = fotosOk;
    payload.observacao = document.getElementById('divergenteObs')?.value?.trim() || '';

    if (window._forcarTriagem) payload.forcar = true;

    const r = await fetch('/api/triagem/divergente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (d.ok) {
      fecharModal('modalConfirmacaoDivergente');
      // Reset flags
      window._fluxoDivergente = false;
      window._fotosDivergente = [];
      window.fotosUploadadas = [];

      mostrarSucesso(
        '🔄 Produto Divergente registrado!',
        `Esperado: ${divergenteEstado.produtoEsperado.sku} · Voltou: ${divergenteEstado.produtoCorreto.sku} (${divergenteEstado.qtd} un) + ${fotosOk.length} fotos. Diego vai analisar.`
      );
      toast('Divergente registrado!', 'ok');
      setTimeout(() => {
        divResultado.classList.remove('show');
        inputCodigo.value = '';
        inputCodigo.focus();
      }, 2800);
    } else if (r.status === 409 && d.erro === 'duplicata') {
      fecharModal('modalConfirmacaoDivergente');
      toast('Esta devolucao ja foi triada antes!', 'err');
      if (ultimaBusca?.shipment?.id) verificarTriagemExistente(ultimaBusca.shipment.id);
    } else {
      toast('Erro: ' + (d.erro || 'falha'), 'err');
      btn.disabled = false;
      btn.innerHTML = '✅ Sim, Registrar';
    }
  } catch (err) {
    toast('Erro de conexao', 'err');
    btn.disabled = false;
    btn.innerHTML = '✅ Sim, Registrar';
  }
}

// Dispara quando estoquista bipou >=1 mas < total e clica botao laranja
// Fluxo: modalDecisao -> camera (6 fotos) -> modalConfirmacao -> POST /api/triagem/aprovar com eh_parcial=true

// Chamado pelo botao laranja no modal de aprovar
function iniciarFluxoParcial() {
  // Mostra contagem atual no modal de decisao
  document.getElementById('parcialBipados').textContent = bipagemEstado.totalBipado;
  document.getElementById('parcialTotal').textContent = bipagemEstado.totalEsperado;
  document.getElementById('modalDecisaoParcial').classList.add('show');
}

// Opcao 1: faltou bipar - fecha modal, volta pra bipagem normal
function parcialFaltouBipar() {
  fecharModal('modalDecisaoParcial');
  // Volta foco pro input de bipagem
  setTimeout(() => {
    const inp = document.getElementById('bipagemInput');
    if (inp) inp.focus();
  }, 200);
}

// Opcao 2: cliente devolveu parcial mesmo - segue pro fluxo de fotos
function parcialConfirmarParcial() {
  fecharModal('modalDecisaoParcial');
  fecharModal('modalAprovar');

  // Reset fotos e seta flag de fluxo parcial
  window.fotosUploadadas = [];
  window._fluxoParcial = true;

  // Abre camera direto (sem passar pelo modal de descricao do problema)
  abrirCameraParaParcial();
}

// Chamado pelo finalizarFotos() (camera.js) quando window._fluxoParcial=true
function abrirConfirmacaoParcial(fotosOk) {
  // Guarda fotos pra usar em encerrarParcial()
  window._fotosParcial = fotosOk;

  // Preenche dados de confirmacao
  document.getElementById('confirmacaoBipados').textContent = bipagemEstado.totalBipado;
  document.getElementById('confirmacaoTotal').textContent = bipagemEstado.totalEsperado;
  document.getElementById('confirmacaoFotosCount').textContent = fotosOk.length;
  document.getElementById('parcialObservacao').value = '';

  // Abre modal de confirmacao final
  document.getElementById('modalConfirmacaoParcial').classList.add('show');
}

// Envio final pro backend
async function encerrarParcial() {
  const btn = document.getElementById('btnEncerrarParcial');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-mini"></span>Enviando...';

  try {
    const fotosOk = window._fotosParcial || [];
    if (fotosOk.length < 6) {
      toast('Erro: precisa ter 6+ fotos', 'err');
      btn.disabled = false;
      btn.innerHTML = '✅ Sim, Encerrar';
      return;
    }

    // Se ainda nao tem idBling salvo, busca automaticamente
    const order = ultimaBusca.order || {};
    const nf = ultimaBusca.nf || {};
    if (order.id && nf.numero && !nf.idBling) {
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
        // segue sem
      }
    }

    // Monta payload base (igual ao APROVAR normal)
    const payload = montarPayloadTriagem();

    // Sobrescreve produto_qtd com a quantidade REALMENTE recebida (bipada)
    payload.produto_qtd = bipagemEstado.totalBipado;

    // Flags de devolucao parcial
    payload.eh_parcial = true;
    payload.produto_qtd_original = bipagemEstado.totalEsperado;
    payload.fotos_parcial = fotosOk;
    payload.observacao_parcial = document.getElementById('parcialObservacao').value.trim();

    if (window._forcarTriagem) payload.forcar = true;

    const r = await fetch('/api/triagem/aprovar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (d.ok) {
      fecharModal('modalConfirmacaoParcial');
      // Reset flags
      window._fluxoParcial = false;
      window._fotosParcial = [];
      window.fotosUploadadas = [];

      mostrarSucesso(
        '📦 Devolução PARCIAL registrada!',
        `Documentação salva: ${bipagemEstado.totalBipado} de ${bipagemEstado.totalEsperado} unidades + ${fotosOk.length} fotos. Diego pode contestar com o marketplace se necessário.`
      );
      toast('Devolucao parcial registrada!', 'ok');
      setTimeout(() => {
        divResultado.classList.remove('show');
        inputCodigo.value = '';
        inputCodigo.focus();
      }, 2800);
    } else if (r.status === 409 && d.erro === 'duplicata') {
      fecharModal('modalConfirmacaoParcial');
      toast('Esta devolucao ja foi triada antes!', 'err');
      if (ultimaBusca?.shipment?.id) verificarTriagemExistente(ultimaBusca.shipment.id);
    } else {
      toast('Erro: ' + (d.erro || 'falha'), 'err');
      btn.disabled = false;
      btn.innerHTML = '✅ Sim, Encerrar';
    }
  } catch (err) {
    toast('Erro de conexao', 'err');
    btn.disabled = false;
    btn.innerHTML = '✅ Sim, Encerrar';
  }
}
