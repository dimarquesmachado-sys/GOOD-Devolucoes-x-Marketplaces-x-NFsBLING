// ============================================================
// public/admin/relatorios.js
// ------------------------------------------------------------
// Frontend do relatorio. Usa fetch direto pros endpoints.
// ============================================================

// Estado global
let dadosAtual = null;   // ultima resposta de /api/admin/relatorios/devolucoes
let tagsCache = [];      // todas as tags
let devolucaoSelecionadaId = null; // pro modal de aplicar tags

// ============================================================
// HELPERS
// ============================================================

function fmtMoeda(v) {
  if (v === null || v === undefined || isNaN(v)) return 'R$ 0,00';
  return Number(v).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDataCurta(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setarDatasPadrao() {
  // Default: ultimos 30 dias
  const hoje = new Date();
  const trintaAtras = new Date();
  trintaAtras.setDate(hoje.getDate() - 30);
  document.getElementById('dataInicio').value = trintaAtras.toISOString().split('T')[0];
  document.getElementById('dataFim').value = hoje.toISOString().split('T')[0];
}

// ============================================================
// CARREGAR DADOS
// ============================================================

async function carregar() {
  const params = new URLSearchParams();
  const dataInicio = document.getElementById('dataInicio').value;
  const dataFim = document.getElementById('dataFim').value;
  const tipo = document.getElementById('tipo').value;
  const produtoSku = document.getElementById('produtoSku').value.trim();
  const funcionario = document.getElementById('funcionario').value;
  const tagId = document.getElementById('tagId').value;

  if (dataInicio) params.set('data_inicio', dataInicio);
  if (dataFim) params.set('data_fim', dataFim);
  if (tipo && tipo !== 'todos') params.set('tipo', tipo);
  if (produtoSku) params.set('produto_sku', produtoSku);
  if (funcionario) params.set('funcionario', funcionario);
  if (tagId) params.set('tag_id', tagId);

  document.getElementById('tabelaWrap').innerHTML = '<div class="loading">Carregando...</div>';

  try {
    const r = await fetch('/api/admin/relatorios/devolucoes?' + params.toString(), {
      credentials: 'include',
    });
    const d = await r.json();

    if (!d.ok) {
      document.getElementById('tabelaWrap').innerHTML = '<div class="loading" style="color:#b00020;">Erro: ' + escapeHtml(d.erro || 'desconhecido') + '</div>';
      return;
    }

    dadosAtual = d;
    renderizarCards(d.cards);
    renderizarRankings(d.rankingSKUs, d.rankingProblemas);
    renderizarFuncionarios(d.porFuncionario);
    renderizarTabela(d.devolucoes);
  } catch (err) {
    console.error('[carregar] erro:', err);
    document.getElementById('tabelaWrap').innerHTML = '<div class="loading" style="color:#b00020;">Erro ao carregar: ' + escapeHtml(err.message) + '</div>';
  }
}

function renderizarCards(c) {
  document.getElementById('cardTotal').textContent = c.total;
  document.getElementById('cardAprovadas').textContent = c.totalAprovado;
  document.getElementById('cardProblemas').textContent = c.totalProblema;
  document.getElementById('cardPctProblema').textContent = c.percentualProblema + '%';
  document.getElementById('cardValor').textContent = fmtMoeda(c.valorTotal);
}

function renderizarRankings(skus, problemas) {
  const elSku = document.getElementById('rankingSKUs');
  if (!skus || skus.length === 0) {
    elSku.innerHTML = '<div class="empty-state">Sem dados no período</div>';
  } else {
    elSku.innerHTML = skus.map((s, i) => {
      const posCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
      return `
        <div class="ranking-item">
          <div class="ranking-pos ${posCls}">${i + 1}</div>
          <div class="ranking-info">
            <div class="sku">${escapeHtml(s.sku)}</div>
            <div class="nome">${escapeHtml((s.titulo || '').substring(0, 60))}${s.titulo && s.titulo.length > 60 ? '...' : ''}</div>
          </div>
          <div class="ranking-numero">${s.qtde_total}</div>
        </div>
      `;
    }).join('');
  }

  const elProb = document.getElementById('rankingProblemas');
  if (!problemas || problemas.length === 0) {
    elProb.innerHTML = '<div class="empty-state">Nenhum problema reportado no período</div>';
  } else {
    elProb.innerHTML = problemas.map((s, i) => {
      const posCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
      return `
        <div class="ranking-item">
          <div class="ranking-pos ${posCls}">${i + 1}</div>
          <div class="ranking-info">
            <div class="sku">${escapeHtml(s.sku)}</div>
            <div class="nome">${escapeHtml((s.titulo || '').substring(0, 60))}${s.titulo && s.titulo.length > 60 ? '...' : ''}</div>
          </div>
          <div class="ranking-numero problema">${s.qtde_problema}</div>
        </div>
      `;
    }).join('');
  }
}

function renderizarFuncionarios(lista) {
  const sel = document.getElementById('funcionario');
  const valorAtual = sel.value;
  // Mantém a opção "Todos" + adiciona os outros
  const opts = ['<option value="">Todos</option>'];
  (lista || []).forEach(f => {
    if (f.nome === '(nao identificado)') return;
    opts.push(`<option value="${escapeHtml(f.nome)}">${escapeHtml(f.nome)} (${f.total})</option>`);
  });
  sel.innerHTML = opts.join('');
  sel.value = valorAtual; // Mantém seleção
}

function renderizarTabela(devolucoes) {
  const wrap = document.getElementById('tabelaWrap');
  document.getElementById('tabelaTitulo').textContent = `📋 Devoluções (${devolucoes.length})`;

  if (devolucoes.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Nenhuma devolução encontrada com esses filtros.</div>';
    return;
  }

  let html = '<table class="devolucoes"><thead><tr>';
  html += '<th>Data</th>';
  html += '<th>Tipo</th>';
  html += '<th>SKU</th>';
  html += '<th>Produto</th>';
  html += '<th>Qtde</th>';
  html += '<th>Valor</th>';
  html += '<th>NF</th>';
  html += '<th>Comprador</th>';
  html += '<th>Pedido ML</th>';
  html += '<th>Pedido Bling</th>';
  html += '<th>Funcionário</th>';
  html += '<th>Tags</th>';
  html += '</tr></thead><tbody>';

  for (const d of devolucoes) {
    const tagsHtml = (d.tags || []).map(t =>
      `<span class="tag" style="background:${escapeHtml(t.cor)};">${escapeHtml(t.nome)}</span>`
    ).join('');

    html += '<tr>';
    html += `<td>${fmtData(d.created_at)}</td>`;
    html += `<td><span class="tipo-badge tipo-${d.tipo}">${d.tipo}</span></td>`;
    html += `<td><strong>${escapeHtml(d.produto_sku || '—')}</strong></td>`;
    html += `<td>${escapeHtml((d.produto_titulo || '').substring(0, 50))}${d.produto_titulo && d.produto_titulo.length > 50 ? '...' : ''}</td>`;
    html += `<td>${d.produto_qtd || 1}</td>`;
    html += `<td>${fmtMoeda((d.produto_valor_unit || 0) * (d.produto_qtd || 1))}</td>`;
    html += `<td>${d.nf_link_danfe ? `<a href="${escapeHtml(d.nf_link_danfe)}" target="_blank">${escapeHtml(d.nf_numero || '?')}</a>` : escapeHtml(d.nf_numero || '—')}</td>`;
    html += `<td>${escapeHtml(d.buyer_nome || '—')}${d.buyer_nickname ? `<br><small style="color:#666;">${escapeHtml(d.buyer_nickname)}</small>` : ''}</td>`;
    html += `<td>${escapeHtml(d.order_id || '—')}</td>`;
    html += `<td>${escapeHtml(d.pedido_bling_numero || '—')}</td>`;
    html += `<td>${escapeHtml(d.funcionario || '—')}</td>`;
    html += `<td>${tagsHtml}<br><button class="btn-tags" onclick="abrirAplicarTags('${d.id}')">+ Tags</button></td>`;
    html += '</tr>';
  }

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ============================================================
// TAGS - GERENCIAR
// ============================================================

async function carregarTags() {
  try {
    const r = await fetch('/api/admin/tags', { credentials: 'include' });
    const d = await r.json();
    if (d.ok) {
      tagsCache = d.tags || [];
      // Atualiza dropdown de filtro
      const sel = document.getElementById('tagId');
      const valorAtual = sel.value;
      const opts = ['<option value="">Todas</option>'];
      tagsCache.forEach(t => {
        opts.push(`<option value="${t.id}">${escapeHtml(t.nome)}</option>`);
      });
      sel.innerHTML = opts.join('');
      sel.value = valorAtual;
    }
  } catch (e) {
    console.error('[carregarTags] erro:', e);
  }
}

function renderizarListaTags() {
  const wrap = document.getElementById('modalGerenciarLista');
  if (tagsCache.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Nenhuma tag cadastrada ainda.</div>';
    return;
  }
  wrap.innerHTML = tagsCache.map(t => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0;">
      <span class="tag" style="background:${escapeHtml(t.cor)};">${escapeHtml(t.nome)}</span>
      <span style="flex:1;font-size:12px;color:#666;">${escapeHtml(t.cor)}</span>
      <button class="btn danger" onclick="excluirTag('${t.id}', '${escapeHtml(t.nome).replace(/'/g, "\\'")}')">Excluir</button>
    </div>
  `).join('');
}

async function adicionarTag() {
  const nome = document.getElementById('novoTagNome').value.trim();
  const cor = document.getElementById('novoTagCor').value;
  if (!nome) {
    alert('Digite um nome');
    return;
  }
  try {
    const r = await fetch('/api/admin/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ nome, cor }),
    });
    const d = await r.json();
    if (!d.ok) {
      alert('Erro: ' + (d.erro || 'desconhecido'));
      return;
    }
    document.getElementById('novoTagNome').value = '';
    await carregarTags();
    renderizarListaTags();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

async function excluirTag(id, nome) {
  if (!confirm(`Excluir a tag "${nome}"?\n\nIsso removerá ela de todas as devoluções marcadas.`)) return;
  try {
    const r = await fetch('/api/admin/tags/' + id, {
      method: 'DELETE',
      credentials: 'include',
    });
    const d = await r.json();
    if (!d.ok) {
      alert('Erro: ' + (d.erro || 'desconhecido'));
      return;
    }
    await carregarTags();
    renderizarListaTags();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

// ============================================================
// TAGS - APLICAR NUMA DEVOLUCAO
// ============================================================

function abrirAplicarTags(devolucaoId) {
  if (tagsCache.length === 0) {
    alert('Você ainda não cadastrou nenhuma tag.\n\nClique em "🏷️ Gerenciar Tags" pra criar.');
    return;
  }

  devolucaoSelecionadaId = devolucaoId;
  const dev = (dadosAtual.devolucoes || []).find(d => d.id === devolucaoId);
  if (!dev) return;

  document.getElementById('modalAplicarInfo').innerHTML =
    `<strong>${escapeHtml(dev.produto_sku || '?')}</strong> · NF ${escapeHtml(dev.nf_numero || '?')} · ${escapeHtml(dev.buyer_nome || '?')}`;

  const tagsAtuais = new Set((dev.tags || []).map(t => t.id));

  const html = tagsCache.map(t => {
    const sel = tagsAtuais.has(t.id) ? 'selected' : '';
    return `<span class="tag-pickable ${sel}" data-id="${t.id}" style="background:${escapeHtml(t.cor)};">${escapeHtml(t.nome)}</span>`;
  }).join('');

  document.getElementById('modalAplicarLista').innerHTML = html;

  // Click pra alternar seleção
  document.querySelectorAll('#modalAplicarLista .tag-pickable').forEach(el => {
    el.addEventListener('click', () => el.classList.toggle('selected'));
  });

  document.getElementById('modalAplicarTags').classList.add('show');
}

async function salvarTagsAplicadas() {
  const selecionadas = [...document.querySelectorAll('#modalAplicarLista .tag-pickable.selected')]
    .map(el => el.dataset.id);

  try {
    const r = await fetch('/api/admin/devolucao/' + devolucaoSelecionadaId + '/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tag_ids: selecionadas }),
    });
    const d = await r.json();
    if (!d.ok) {
      alert('Erro: ' + (d.erro || 'desconhecido'));
      return;
    }
    document.getElementById('modalAplicarTags').classList.remove('show');
    await carregar(); // recarrega lista pra mostrar tags novas
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

// ============================================================
// EXPORTAR EXCEL
// ============================================================

function exportarExcel() {
  if (!dadosAtual || !dadosAtual.devolucoes || dadosAtual.devolucoes.length === 0) {
    alert('Nada pra exportar com esses filtros');
    return;
  }

  const linhas = dadosAtual.devolucoes.map(d => ({
    'Data': fmtDataCurta(d.created_at),
    'Hora': new Date(d.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    'Tipo': d.tipo,
    'SKU': d.produto_sku || '',
    'Produto': d.produto_titulo || '',
    'Qtde': d.produto_qtd || 1,
    'Valor unit.': Number(d.produto_valor_unit || 0),
    'Valor total': Number((d.produto_valor_unit || 0) * (d.produto_qtd || 1)),
    'NF número': d.nf_numero || '',
    'NF data': fmtDataCurta(d.nf_data_emissao),
    'Comprador': d.buyer_nome || '',
    'Apelido ML': d.buyer_nickname || '',
    'Pedido ML': d.order_id || '',
    'Pack ML': d.pack_id || '',
    'Pedido Bling': d.pedido_bling_numero || '',
    'Funcionário': d.funcionario || '',
    'Tags': (d.tags || []).map(t => t.nome).join(', '),
    'Descrição/Problema': d.problema_descricao || '',
    'Marketplace': d.marketplace || 'mercadolivre',
  }));

  const ws = XLSX.utils.json_to_sheet(linhas);

  // Formata colunas com largura
  ws['!cols'] = [
    { wch: 11 }, // Data
    { wch: 6 },  // Hora
    { wch: 10 }, // Tipo
    { wch: 18 }, // SKU
    { wch: 50 }, // Produto
    { wch: 6 },  // Qtde
    { wch: 12 }, // Valor unit
    { wch: 12 }, // Valor total
    { wch: 10 }, // NF número
    { wch: 11 }, // NF data
    { wch: 25 }, // Comprador
    { wch: 18 }, // Apelido
    { wch: 18 }, // Pedido ML
    { wch: 18 }, // Pack ML
    { wch: 12 }, // Pedido Bling
    { wch: 12 }, // Funcionário
    { wch: 30 }, // Tags
    { wch: 50 }, // Descrição
    { wch: 14 }, // Marketplace
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Devoluções');

  // Aba 2: Ranking SKUs
  if (dadosAtual.rankingSKUs && dadosAtual.rankingSKUs.length > 0) {
    const linhasSku = dadosAtual.rankingSKUs.map((s, i) => ({
      'Posição': i + 1,
      'SKU': s.sku,
      'Produto': s.titulo || '',
      'Qtde total': s.qtde_total,
      'Qtde aprovado': s.qtde_aprovado,
      'Qtde problema': s.qtde_problema,
      'Valor total devolvido': Number(s.valor_total || 0),
    }));
    const wsSku = XLSX.utils.json_to_sheet(linhasSku);
    wsSku['!cols'] = [{ wch: 8 }, { wch: 18 }, { wch: 50 }, { wch: 11 }, { wch: 14 }, { wch: 14 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsSku, 'Ranking SKUs');
  }

  // Nome do arquivo
  const dataInicio = document.getElementById('dataInicio').value || 'inicio';
  const dataFim = document.getElementById('dataFim').value || 'fim';
  const filename = `devolucoes_${dataInicio}_a_${dataFim}.xlsx`;

  XLSX.writeFile(wb, filename);
}

// ============================================================
// EVENTS
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  setarDatasPadrao();
  await carregarTags();

  document.getElementById('btnFiltrar').addEventListener('click', carregar);
  document.getElementById('btnLimpar').addEventListener('click', () => {
    setarDatasPadrao();
    document.getElementById('tipo').value = 'todos';
    document.getElementById('produtoSku').value = '';
    document.getElementById('funcionario').value = '';
    document.getElementById('tagId').value = '';
    carregar();
  });

  document.getElementById('btnExportar').addEventListener('click', exportarExcel);

  // Modal aplicar tags
  document.getElementById('modalAplicarCancelar').addEventListener('click', () => {
    document.getElementById('modalAplicarTags').classList.remove('show');
  });
  document.getElementById('modalAplicarSalvar').addEventListener('click', salvarTagsAplicadas);

  // Modal gerenciar tags
  document.getElementById('btnGerenciarTags').addEventListener('click', () => {
    renderizarListaTags();
    document.getElementById('modalGerenciarTags').classList.add('show');
  });
  document.getElementById('modalGerenciarFechar').addEventListener('click', () => {
    document.getElementById('modalGerenciarTags').classList.remove('show');
  });
  document.getElementById('btnAdicionarTag').addEventListener('click', adicionarTag);
  document.getElementById('novoTagNome').addEventListener('keydown', e => {
    if (e.key === 'Enter') adicionarTag();
  });

  // Carga inicial
  await carregar();
});

// Expor pra HTML inline (botões da tabela)
window.abrirAplicarTags = abrirAplicarTags;
window.excluirTag = excluirTag;
