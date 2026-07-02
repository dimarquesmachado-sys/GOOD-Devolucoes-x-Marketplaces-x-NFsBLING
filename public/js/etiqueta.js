// ============================================================
// etiqueta.js (v3.19.0) - Etiqueta de produto 4x2,5cm na Zebra
// Portado do Checkout Offline: mesmo ZPL (320x200 dots @203dpi),
// mesma engrenagem QZ Tray, impressora salva por computador.
// Uso: botao 🏷️ em cada item da conferencia de bipagem.
// ============================================================

const ETQ_PRINTER_KEY = 'gdev_printer_etq';

function qzDisponivel() {
  return typeof qz !== 'undefined';
}

async function conectarQZ() {
  if (!qzDisponivel()) {
    throw new Error('QZ Tray nao carregou nesta pagina (recarregue com Ctrl+Shift+R)');
  }
  if (qz.websocket.isActive()) return;

  // v3.19.3 - MODO ASSINADO: o servidor entrega o certificado (o mesmo do
  // checkout, ja confiado no QZ Tray do notebook) e assina cada pedido.
  // Resultado: impressao SILENCIOSA, sem popup de Allow.
  let certTxt = null;
  try {
    const r = await fetch('/api/qz/cert');
    if (r.ok) {
      const t = await r.text();
      if (t.includes('BEGIN CERTIFICATE')) certTxt = t;
    }
  } catch (e) { /* sem certificado configurado */ }

  if (certTxt) {
    qz.security.setCertificatePromise(function (resolve) { resolve(certTxt); });
    try { qz.security.setSignatureAlgorithm('SHA512'); } catch (e) { /* qz antigo */ }
    qz.security.setSignaturePromise(function (toSign) {
      return function (resolve, reject) {
        fetch('/api/qz/sign?request=' + encodeURIComponent(toSign))
          .then(function (r) {
            if (!r.ok) throw new Error('assinatura falhou (HTTP ' + r.status + ')');
            return r.text();
          })
          .then(resolve)
          .catch(reject);
      };
    });
  } else {
    // Sem QZ_CERT/QZ_PRIVKEY no Render: modo antigo (popup Allow 1x)
    try { qz.security.setCertificatePromise(function (resolve) { resolve(); }); } catch (e) { /* ok */ }
    try { qz.security.setSignaturePromise(function () { return function (resolve) { resolve(); }; }); } catch (e) { /* ok */ }
  }
  await qz.websocket.connect();
}

function getImpressoraEtiqueta() {
  return localStorage.getItem(ETQ_PRINTER_KEY) || '';
}

async function escolherImpressoraEtiqueta() {
  try {
    await conectarQZ();
    const lista = await qz.printers.find();
    const arr = Array.isArray(lista) ? lista : [lista];
    if (arr.length === 0) {
      toast('Nenhuma impressora encontrada no QZ Tray', 'err');
      return;
    }
    const atual = getImpressoraEtiqueta();
    const msg = 'Escolha a impressora da ETIQUETA DE PRODUTO (Zebra):\n\n' +
      arr.map((p, i) => `${i + 1}. ${p}${p === atual ? '  <- atual' : ''}`).join('\n') +
      '\n\nDigite o numero:';
    const r = prompt(msg, atual && arr.indexOf(atual) >= 0 ? String(arr.indexOf(atual) + 1) : '1');
    if (r === null) return;
    const ix = parseInt(r, 10) - 1;
    if (isNaN(ix) || ix < 0 || ix >= arr.length) {
      toast('Numero invalido', 'err');
      return;
    }
    localStorage.setItem(ETQ_PRINTER_KEY, arr[ix]);
    toast('🖨 Zebra da etiqueta: ' + arr[ix], 'ok');
  } catch (e) {
    toast('Erro ao listar impressoras: ' + (e.message || e) + ' — o QZ Tray esta aberto?', 'err');
  }
}

// 40x25mm @ 203dpi = 320x200 dots. Titulo ate 3 linhas, SKU,
// codigo de barras Code128 do EAN + numero embaixo (= checkout).
function montarZplEtiqueta(p, copias) {
  const clean = s => String(s || '').replace(/[\^~]/g, ' ');
  const titulo = clean(p.nome).slice(0, 120);
  const sku = clean(p.sku);
  const ean = String(p.ean || '').replace(/\D/g, '');
  const dados = ean || sku.replace(/[^\x20-\x7E]/g, ''); // barras: EAN; sem EAN, o SKU
  if (!dados) return null;
  const z = ['^XA', '^CI28', '^PW320', '^LL200', '^LH0,0',
    '^FO8,8^A0N,17,17^FB306,3,3,L^FD' + titulo + '^FS',   // titulo (ate 3 linhas)
    '^FO8,72^A0N,23,23^FD' + sku + '^FS',                 // SKU
    '^FO12,102^BY2,2^BCN,62,Y,N,N^FD' + dados + '^FS'];   // barras + numero embaixo
  if (copias && copias > 1) z.push('^PQ' + copias + ',0,0,N');
  z.push('^XZ');
  return z.join('');
}

async function imprimirEtiquetaProduto(prod, copias) {
  if (!prod) return;
  if (copias == null) {
    const r = prompt('Quantas etiquetas?', String(prod.quantidade || 1));
    if (r === null) return;
    copias = Math.max(1, Math.min(50, parseInt(r, 10) || 1));
  }
  const zpl = montarZplEtiqueta(prod, copias);
  if (!zpl) {
    toast('Produto sem EAN nem SKU pra etiqueta', 'err');
    return;
  }
  try {
    await conectarQZ();
    let printer = getImpressoraEtiqueta();
    if (!printer) {
      await escolherImpressoraEtiqueta();
      printer = getImpressoraEtiqueta();
    }
    if (!printer) return;
    const cfg = qz.configs.create(printer);
    await qz.print(cfg, [{ type: 'raw', format: 'command', flavor: 'plain', data: zpl }]);
    toast('🏷️ ' + copias + ' etiqueta(s) enviada(s) → ' + printer, 'ok');
  } catch (e) {
    toast('Erro na impressao: ' + (e.message || e) + ' — QZ Tray aberto? Zebra ligada?', 'err');
  }
}

// Botao 🏷️ da linha do item na conferencia de bipagem
function imprimirEtiquetaItemBipagem(idx) {
  const it = (typeof bipagemEstado !== 'undefined' && bipagemEstado.itensEsperados)
    ? bipagemEstado.itensEsperados[idx]
    : null;
  if (!it) {
    toast('Item nao encontrado no estado da bipagem', 'err');
    return;
  }
  imprimirEtiquetaProduto({
    nome: it.titulo,
    sku: it.sku,
    ean: it.ean && it.ean !== '-' ? it.ean : '',
    quantidade: it.quantidade,
  });
}
