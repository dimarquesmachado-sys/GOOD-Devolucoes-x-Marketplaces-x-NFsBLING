// ============================================================
// bipagem.js - validacao EAN no modal de APROVAR
// v3.17.0 - suporte a botao DEVOLUCAO PARCIAL
// ============================================================
// Estado e funcoes da bipagem obrigatoria EAN antes de aprovar inclusao no estoque

// Estado da bipagem (compartilhado com triagem.js)
let bipagemEstado = {
  itensEsperados: [],   // [{titulo, sku, ean, quantidade, bipados: 0}]
  totalEsperado: 0,
  totalBipado: 0,
  tentativasErro: 0,    // conta erros consecutivos
  forcado: false,
  observacao: null,
};

async function buscarEansFaltantes() {
  // Busca EAN no Bling pra cada item sem EAN, paralelamente
  const promises = bipagemEstado.itensEsperados.map(async (it, idx) => {
    if (it.ean && it.ean !== '-') return; // ja tem
    if (!it.sku || it.sku === '-') return; // sem SKU nao tem como buscar

    try {
      const r = await fetch(`/api/produto/ean-por-sku/${encodeURIComponent(it.sku)}`);
      const d = await r.json();
      if (d.ok && d.encontrado && d.produto?.gtin) {
        it.ean = String(d.produto.gtin).trim();
        console.log(`[BIPAGEM] EAN achado pra ${it.sku}: ${it.ean}`);
      }
    } catch (e) {
      console.warn(`[BIPAGEM] Erro busca EAN ${it.sku}:`, e);
    }
  });

  await Promise.all(promises);

  const aviso = document.getElementById('bipagemAviso');
  const conteudo = document.getElementById('bipagemConteudo');

  // Re-checa se TODOS estao com EAN agora
  const todosComEan = bipagemEstado.itensEsperados.every(it => it.ean && it.ean !== '-');

  if (todosComEan) {
    // Atualiza UI dos itens (mostra EAN agora)
    bipagemEstado.itensEsperados.forEach((it, idx) => {
      const el = document.getElementById(`bipItem${idx}`);
      if (el && el.parentElement) {
        const span = el.parentElement;
        // Adiciona EAN no texto se nao tiver
        if (it.ean && !span.innerHTML.includes('EAN')) {
          span.innerHTML = span.innerHTML.replace(
            ` · <strong id="bipItem${idx}">`,
            ` · EAN <strong>${it.ean}</strong> · <strong id="bipItem${idx}">`
          );
        }
      }
    });

    aviso.style.display = 'none';
    conteudo.style.display = 'block';
    ativarBipagem();
  } else {
    // Continua sem EAN - libera confirmar SEM bipagem (com aviso)
    const semEan = bipagemEstado.itensEsperados.filter(it => !it.ean || it.ean === '-');
    const skusSemEan = semEan.map(it => it.sku).join(', ');

    aviso.style.display = 'block';
    aviso.style.background = '#fff3e0';
    aviso.style.border = '1px solid #ffc107';
    aviso.style.color = '#5d4037';
    aviso.innerHTML = `⚠️ Produto(s) sem EAN no Bling: <strong>${escapeHtml(skusSemEan)}</strong><br>
      <span style="font-size:11px;opacity:0.8;">Bipagem desabilitada - confira o produto visualmente.</span>`;
    conteudo.style.display = 'none';

    document.getElementById('btnConfirmarAprovar').disabled = false;
    document.getElementById('btnConfirmarAprovar').style.opacity = '1';
    document.getElementById('btnConfirmarAprovar').style.cursor = 'pointer';
  }
}

function ativarBipagem() {
  // Reset área bipagem ao estado inicial
  document.getElementById('bipagemContador').textContent = `0 / ${bipagemEstado.totalEsperado}`;
  document.getElementById('bipagemContador').style.color = '#2e7d32';
  document.getElementById('bipagemInput').value = '';
  document.getElementById('bipagemErro').style.display = 'none';
  document.getElementById('bipagemForcar').style.display = 'none';
  document.getElementById('bipagemObservacao').value = '';
  document.getElementById('btnConfirmarAprovar').disabled = true;
  document.getElementById('btnConfirmarAprovar').style.opacity = '0.5';
  document.getElementById('btnConfirmarAprovar').style.cursor = 'not-allowed';

  // v3.17.0: esconde botao parcial no inicio (so aparece apos 1a bipagem)
  atualizarBotaoParcial();

  // Listener de bipagem - scanner manda Enter no fim
  const inp = document.getElementById('bipagemInput');
  inp.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      processarBipagem(inp.value.trim());
      inp.value = '';
    }
  };
  // Foca pra estoquista bipar direto
  setTimeout(() => inp.focus(), 200);
}

// v3.17.0 - mostra/esconde botao DEVOLUCAO PARCIAL conforme progresso
// REGRA: aparece apenas quando bipou >= 1 E < total esperado
function atualizarBotaoParcial() {
  const btn = document.getElementById('btnDevolucaoParcial');
  if (!btn) return;

  const bipados = bipagemEstado.totalBipado;
  const total = bipagemEstado.totalEsperado;

  if (bipados >= 1 && bipados < total) {
    btn.style.display = 'flex';
  } else {
    btn.style.display = 'none';
  }
}

function processarBipagem(codigo) {
  if (!codigo) return;

  // v3.19.1 - matching tolerante: EAN comparado DIGITO a DIGITO (imune a
  // sujeira invisivel de leitor) OU SKU exato (cobre etiqueta de produto
  // 4x2,5 que sai com SKU quando o item nao tem EAN, e caixas com SKU).
  const cod = String(codigo).trim();
  const codDigitos = cod.replace(/\D/g, '');
  const codUpper = cod.toUpperCase();
  const itemMatch = bipagemEstado.itensEsperados.find(it => {
    if (it.bipados >= it.quantidade) return false;
    const eanDig = String(it.ean || '').replace(/\D/g, '');
    if (eanDig && codDigitos.length >= 8 && eanDig === codDigitos) return true;
    const sku = String(it.sku || '').trim().toUpperCase();
    if (sku && sku !== '-' && sku === codUpper) return true;
    return false;
  });

  if (itemMatch) {
    // ✅ BIPAGEM CORRETA
    itemMatch.bipados++;
    bipagemEstado.totalBipado++;
    bipagemEstado.tentativasErro = 0; // reseta erros
    beepOk();

    // Atualiza contador geral
    document.getElementById('bipagemContador').textContent =
      `${bipagemEstado.totalBipado} / ${bipagemEstado.totalEsperado}`;

    // Atualiza contador por item
    const idx = bipagemEstado.itensEsperados.indexOf(itemMatch);
    const elItem = document.getElementById(`bipItem${idx}`);
    if (elItem) elItem.textContent = `${itemMatch.bipados}/${itemMatch.quantidade}`;

    // Esconde erro se estava aparecendo
    document.getElementById('bipagemErro').style.display = 'none';

    // Completou tudo?
    if (bipagemEstado.totalBipado >= bipagemEstado.totalEsperado) {
      document.getElementById('bipagemContador').textContent = `✅ ${bipagemEstado.totalEsperado} / ${bipagemEstado.totalEsperado}`;
      document.getElementById('btnConfirmarAprovar').disabled = false;
      document.getElementById('btnConfirmarAprovar').style.opacity = '1';
      document.getElementById('btnConfirmarAprovar').style.cursor = 'pointer';
    }

    // v3.17.0: atualiza botao parcial (aparece se 1 <= bipado < total)
    atualizarBotaoParcial();
  } else {
    // ❌ BIPAGEM ERRADA
    bipagemEstado.tentativasErro++;
    beepErro();

    // Pega EAN(s)/SKU(s) esperados pra mostrar
    const eansEsperados = bipagemEstado.itensEsperados
      .filter(it => it.bipados < it.quantidade)
      .map(it => {
        const partes = [];
        if (it.ean && it.ean !== '-') partes.push(it.ean);
        if (it.sku && it.sku !== '-') partes.push('SKU ' + it.sku);
        return partes.join(' / ') || '-';
      })
      .join('  ou  ');

    document.getElementById('bipagemEsperado').textContent = eansEsperados;
    document.getElementById('bipagemRecebido').textContent = codigo;
    document.getElementById('bipagemErro').style.display = 'block';

    // 2a tentativa errada - libera "forcar com observacao"
    if (bipagemEstado.tentativasErro >= 2) {
      document.getElementById('bipagemForcar').style.display = 'block';
      atualizarBotaoForcar();
    }
  }
}

function atualizarBotaoForcar() {
  const obs = document.getElementById('bipagemObservacao').value.trim();
  const contador = document.getElementById('bipagemObsContador');
  const btn = document.getElementById('btnForcar');

  contador.textContent = `${obs.length} / 20`;
  contador.style.color = obs.length >= 20 ? '#2e7d32' : '#999';

  if (obs.length >= 20) {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  } else {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  }
}

function finalizarComObservacao() {
  const obs = document.getElementById('bipagemObservacao').value.trim();
  if (obs.length < 20) {
    alert('A observacao precisa ter no minimo 20 caracteres.');
    return;
  }
  bipagemEstado.forcado = true;
  bipagemEstado.observacao = obs;
  // Pula direto pra confirmar
  confirmarAprovar();
}
