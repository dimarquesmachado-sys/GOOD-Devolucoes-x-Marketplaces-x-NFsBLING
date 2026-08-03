// ════════════════════════════════════════════════════════════════════════
//  colar-imagem.js — COLAR (Ctrl+V) ou ARRASTAR uma imagem na busca
//  ------------------------------------------------------------------
//  Caso real do Diego: o cliente manda a foto da etiqueta pelo WhatsApp,
//  ele esta no COMPUTADOR e nao tem como bipar com a camera. Agora ele
//  copia a imagem (Ctrl+C no WhatsApp Web, ou "copiar imagem" no print)
//  e da Ctrl+V em qualquer lugar da tela.
//
//  Ordem de tentativa — a barata primeiro:
//   1. BarcodeDetector na imagem (mesmo motor da camera). Resolve na
//      hora quando o codigo esta legivel.
//   2. Se nao ler o codigo, OCR (Tesseract, o mesmo do "ler nome do
//      remetente") e procura no texto os padroes que a busca entende.
//      Isso salva a maioria dos prints do WhatsApp: a compressao
//      costuma estragar as barras finas, mas o NUMERO impresso embaixo
//      delas o OCR le bem.
//
//  Se achar mais de um candidato, PERGUNTA — nao adivinha.
// ════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var painel = null;

  // ── os formatos que a busca ja entende, do mais especifico pro mais geral
  var PADROES = [
    { nome: 'chave da NF-e',      re: /\b(\d{44})\b/,                       peso: 10 },
    { nome: 'rastreio Correios',  re: /\b([A-Z]{2}\d{9}[A-Z]{2})\b/i,       peso: 9 },
    { nome: 'rastreio Shopee',    re: /\b(BR[A-Z0-9]{10,})\b/i,             peso: 9 },
    { nome: 'pedido Shopee',      re: /\b(\d{6}[A-Z0-9]{6,10})\b/,          peso: 8 },
    { nome: 'pedido Mercado Livre', re: /\b(20000\d{11})\b/,                peso: 8 },
    { nome: 'numero da NF',       re: /\bNF[-\s:]*0*(\d{3,9})\b/i,          peso: 6 },
  ];

  function acharCandidatos(texto) {
    var t = String(texto || '').replace(/\s+/g, ' ');
    var vistos = {}, out = [];
    PADROES.forEach(function (p) {
      var m = t.match(p.re);
      if (m && m[1]) {
        var v = m[1].toUpperCase();
        if (!vistos[v]) { vistos[v] = 1; out.push({ valor: v, tipo: p.nome, peso: p.peso }); }
      }
    });
    return out.sort(function (a, b) { return b.peso - a.peso; });
  }

  // ── painel que mostra o que esta acontecendo (sem ele o usuario acha
  //    que nao funcionou, porque o OCR demora alguns segundos)
  function abrirPainel(dataUrl) {
    fecharPainel();
    painel = document.createElement('div');
    painel.id = 'painelColar';
    painel.style.cssText = 'margin:12px 0;padding:12px;border:2px dashed #7B3FC4;border-radius:12px;'
      + 'background:#faf7ff;display:flex;gap:12px;align-items:flex-start;';
    painel.innerHTML =
      '<img src="' + dataUrl + '" alt="" style="width:110px;height:110px;object-fit:contain;'
      + 'background:#fff;border:1px solid #e4dcf1;border-radius:8px;flex:0 0 auto;">'
      + '<div style="flex:1;min-width:0;">'
      + '  <div style="font-weight:700;color:#561A9E;font-size:14px;">Imagem colada</div>'
      + '  <div id="colarStatus" style="font-size:13px;color:#555;margin-top:5px;">lendo o codigo de barras...</div>'
      + '  <div id="colarOpcoes" style="margin-top:8px;"></div>'
      + '</div>'
      + '<button onclick="fecharPainelColar()" title="fechar" style="flex:0 0 auto;background:none;'
      + 'border:none;font-size:20px;cursor:pointer;color:#888;line-height:1;">&times;</button>';
    var alvo = document.querySelector('.card') || document.body;
    alvo.appendChild(painel);
    painel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function fecharPainel() {
    if (painel && painel.parentNode) painel.parentNode.removeChild(painel);
    painel = null;
  }
  window.fecharPainelColar = fecharPainel;

  function status(txt) {
    var el = document.getElementById('colarStatus');
    if (el) el.textContent = txt;
  }

  function usar(valor) {
    var input = document.getElementById('codigo');
    if (input) { input.value = valor; }
    fecharPainel();
    if (typeof buscar === 'function') buscar();
  }
  window.usarCodigoColado = usar;

  function mostrarOpcoes(lista) {
    var box = document.getElementById('colarOpcoes');
    if (!box) return;
    if (!lista.length) {
      status('Nao achei codigo nem texto reconhecivel nessa imagem.');
      box.innerHTML = '<div style="font-size:12.5px;color:#777;">Tenta uma imagem mais nitida, '
        + 'ou digita o codigo na mao.</div>';
      return;
    }
    if (lista.length === 1) { status('Achei: ' + lista[0].tipo); usar(lista[0].valor); return; }
    status('Achei mais de um codigo — qual e o certo?');
    box.innerHTML = lista.slice(0, 4).map(function (c) {
      return '<button onclick="usarCodigoColado(\'' + c.valor + '\')" '
        + 'style="display:block;width:100%;text-align:left;margin-bottom:5px;background:#fff;'
        + 'border:1px solid #e4dcf1;border-radius:8px;padding:8px 10px;cursor:pointer;font-size:13px;">'
        + '<b style="font-family:ui-monospace,monospace;">' + c.valor + '</b>'
        + ' <span style="color:#71659a;font-size:11.5px;">' + c.tipo + '</span></button>';
    }).join('');
  }

  // ── 1) codigo de barras direto da imagem
  async function lerCodigo(bitmapOuImg) {
    if (!('BarcodeDetector' in window)) return null;
    try {
      var det = new BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'qr_code', 'pdf417'],
      });
      var codes = await det.detect(bitmapOuImg);
      if (codes && codes.length) return String(codes[0].rawValue || '').trim();
    } catch (e) { /* segue pro OCR */ }
    return null;
  }

  // ── 2) OCR (mesmo Tesseract que a tela ja carrega pro nome do remetente)
  async function lerTexto(dataUrl) {
    if (typeof Tesseract === 'undefined') return '';
    status('nao li o codigo — lendo o texto da etiqueta (demora alguns segundos)...');
    try {
      var worker = await Tesseract.createWorker('por', 1);
      var r = await worker.recognize(dataUrl);
      await worker.terminate();
      return (r && r.data && r.data.text) || '';
    } catch (e) { return ''; }
  }

  async function processar(blob) {
    var dataUrl = await new Promise(function (res) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.readAsDataURL(blob);
    });
    abrirPainel(dataUrl);

    var img = new Image();
    await new Promise(function (res) { img.onload = res; img.onerror = res; img.src = dataUrl; });

    var codigo = await lerCodigo(img);
    if (codigo) { status('codigo de barras lido'); usar(codigo); return; }

    var texto = await lerTexto(dataUrl);
    mostrarOpcoes(acharCandidatos(texto));
  }

  function daTransferencia(dt) {
    if (!dt) return null;
    var itens = dt.items || [];
    for (var i = 0; i < itens.length; i++) {
      if (itens[i].type && itens[i].type.indexOf('image/') === 0) return itens[i].getAsFile();
    }
    var arqs = dt.files || [];
    for (var j = 0; j < arqs.length; j++) {
      if (arqs[j].type && arqs[j].type.indexOf('image/') === 0) return arqs[j];
    }
    return null;
  }

  document.addEventListener('paste', function (e) {
    var blob = daTransferencia(e.clipboardData);
    if (!blob) return;                 // colou texto: deixa o navegador fazer o normal
    e.preventDefault();
    processar(blob);
  });

  ['dragover', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (ev === 'dragover') { e.preventDefault(); return; }
      var blob = daTransferencia(e.dataTransfer);
      if (!blob) return;
      e.preventDefault();
      processar(blob);
    });
  });
})();
