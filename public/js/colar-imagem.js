// ════════════════════════════════════════════════════════════════════════
//  colar-imagem.js  v5 — COLAR (Ctrl+V), ARRASTAR ou ESCOLHER a foto
//  ------------------------------------------------------------------
//  Igual ao 1688/AliExpress: copia a imagem, clica na busca, Ctrl+V.
//
//  Por que a v1 nao funcionou no computador:
//   - O BarcodeDetector (leitor de codigo) so existe no Android. No
//     Chrome/Edge de computador ele NAO existe, entao o passo 1 sempre
//     falhava calado e caia direto no OCR.
//   - O OCR baixa ~10MB de idioma na primeira vez. Sem aviso claro,
//     parecia travado.
//   - E nao havia nada na tela dizendo que dava pra colar.
//
//  Agora: uma AREA VISIVEL na busca, tres jeitos de mandar a imagem
//  (colar, arrastar, escolher arquivo) e o status escrito em cada passo.
// ════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var PADROES = [
    { nome: 'chave da NF-e',        re: /\b(\d{44})\b/,                 peso: 10 },
    { nome: 'rastreio Correios',    re: /\b([A-Z]{2}\d{9}[A-Z]{2})\b/i, peso: 9 },
    { nome: 'rastreio Shopee',      re: /\b(BR[A-Z0-9]{10,})\b/i,       peso: 9 },
    { nome: 'pedido Shopee',        re: /\b(\d{6}[A-Z0-9]{6,10})\b/,    peso: 8 },
    { nome: 'pedido Mercado Livre', re: /\b(20000\d{11})\b/,            peso: 8 },
    { nome: 'numero da NF',         re: /\bNF[-\s:]*0*(\d{3,9})\b/i,    peso: 6 },
  ];

  /**
   * v5 - PRIMEIRO RECONHECE A ETIQUETA, DEPOIS PROCURA O CAMPO CERTO.
   *
   * Antes era so a lista acima, por peso, sem saber que etiqueta estava
   * olhando. Duas consequencias praticas:
   *
   *  - Magalu nao tinha padrao NENHUM, entao a etiqueta da AMB colada em
   *    29/08 nao rendia candidato algum;
   *  - o rastreio pesa 9 e ganharia do pedido, mas na Magalu o rastreio e
   *    exatamente o que NAO acha devolucao (esta escrito no "O que bipar").
   *
   * Agora: se der pra dizer de quem e a etiqueta, valem as regras DELA —
   * inclusive as proibicoes. Se nao der, cai na lista geral, como antes.
   */
  var ETIQUETAS = [
    {
      nome: 'Magalu',
      // "Magalu Entregas", "AGENCIA MAGALU", "MAGALU" no cabecalho
      marca: /\bMAGALU\b/i,
      campos: [
        // protocolo da devolucao: 16 digitos comecando com o ano
        { nome: 'protocolo Magalu',  re: /\b(20\d{14})\b/,                    peso: 10 },
        { nome: 'pedido Magalu',     re: /PEDIDO[^0-9]{0,12}(\d{14,18})\b/i,   peso: 9 },
        { nome: 'pedido Magalu',     re: /\b(\d{16})\b/,                       peso: 7 },
        { nome: 'numero da NF',      re: /NOTA\s*FISCAL[^0-9]{0,8}0*(\d{3,9})\b/i, peso: 6 },
      ],
      // o codigo de barras grande e o RASTREIO da transportadora: nao acha
      // devolucao. Some da lista pra ninguem clicar nele por engano.
      proibido: [/\b\d{9}-\d{2}\b/, /\b\d{9,12}-0\d\b/],
    },
  ];

  function reconhecerEtiqueta(t) {
    for (var i = 0; i < ETIQUETAS.length; i++) {
      if (ETIQUETAS[i].marca.test(t)) return ETIQUETAS[i];
    }
    return null;
  }

  function candidatos(texto) {
    var t = String(texto || '').replace(/\s+/g, ' ');
    var et = reconhecerEtiqueta(t);
    var lista = et ? et.campos.concat(PADROES) : PADROES;
    var proibido = (et && et.proibido) || [];
    var visto = {}, out = [];

    lista.forEach(function (p) {
      var m = t.match(p.re);
      if (!m || !m[1]) return;
      var v = m[1].toUpperCase();
      if (visto[v]) return;
      // na etiqueta reconhecida, o que ela mesma proibe nao entra
      for (var k = 0; k < proibido.length; k++) if (proibido[k].test(v)) return;
      visto[v] = 1;
      out.push({ valor: v, tipo: p.nome, peso: p.peso });
    });

    return out.sort(function (a, b) { return b.peso - a.peso; });
  }

  // ── a area visivel, criada por JS (nao precisa mexer no index) ──
  var zona, statusEl, previaEl, opcoesEl, inputArquivo;

  function montarZona() {
    if (document.getElementById('btnAnexarEtiqueta')) return;
    // v4 - vira um BOTAO pequeno ao lado do "ler nome do remetente", com o
    // mesmo peso visual dele. O painel de status so aparece enquanto le a
    // imagem, e some depois.
    var ocr = document.querySelector('[onclick*="abrirOcrRemetente"]');
    var linha = ocr ? ocr.parentNode : null;
    var input = document.getElementById('codigo');
    if (!linha || !input) return;

    var btn = document.createElement('button');
    btn.id = 'btnAnexarEtiqueta';
    btn.type = 'button';
    btn.title = 'cole (Ctrl+V), arraste ou escolha a foto da etiqueta';
    btn.style.cssText = 'flex:0 0 auto;max-width:132px;padding:8px 12px;background:transparent;'
      + 'color:#534AB7;border:1px solid #CECBF6;border-radius:10px;font-weight:500;font-size:12.5px;'
      + 'line-height:1.2;cursor:pointer;';
    btn.innerHTML = '\u{1F4CE}<br>anexar imagem etiqueta';
    linha.appendChild(btn);

    zona = document.createElement('div');
    zona.id = 'zonaColar';
    zona.style.cssText = 'display:none;margin-top:8px;border:1.5px dashed #CECBF6;border-radius:10px;'
      + 'padding:9px 12px;background:#faf8ff;align-items:center;gap:10px;';
    zona.innerHTML =
      '<img id="zonaColarPrevia" alt="" style="display:none;width:52px;height:52px;object-fit:contain;'
      + 'background:#fff;border:1px solid #e4dcf1;border-radius:8px;flex:0 0 auto;">'
      + '<div style="flex:1;min-width:0;">'
      + '  <div id="zonaColarStatus" style="font-size:12.5px;color:#534AB7;"></div>'
      + '  <div id="zonaColarOpcoes" style="margin-top:6px;"></div>'
      + '</div>';
    linha.parentNode.insertBefore(zona, linha.nextSibling);

    statusEl = document.getElementById('zonaColarStatus');
    previaEl = document.getElementById('zonaColarPrevia');
    opcoesEl = document.getElementById('zonaColarOpcoes');

    inputArquivo = document.createElement('input');
    inputArquivo.type = 'file';
    inputArquivo.accept = 'image/*';
    inputArquivo.style.display = 'none';
    document.body.appendChild(inputArquivo);
    inputArquivo.addEventListener('change', function () {
      if (inputArquivo.files && inputArquivo.files[0]) processar(inputArquivo.files[0]);
    });
    btn.addEventListener('click', function () { inputArquivo.click(); });
  }

  function trabalhando(sim) {
    if (!zona) return;
    zona.style.display = sim ? 'flex' : 'none';
    if (!sim) { status(''); if (opcoesEl) opcoesEl.innerHTML = ''; if (previaEl) previaEl.style.display = 'none'; }
  }

  function status(txt) { if (statusEl) statusEl.textContent = txt || ''; }

  function usar(valor) {
    var input = document.getElementById('codigo');
    if (input) input.value = valor;
    status('achei ' + valor + ' — buscando...');
    if (opcoesEl) opcoesEl.innerHTML = '';
    if (typeof buscar === 'function') buscar();
    setTimeout(function () { trabalhando(false); }, 1500);   // v3 - o aviso some
  }
  window.usarCodigoColado = usar;

  function oferecer(lista) {
    if (!opcoesEl) return;
    if (!lista.length) {
      status('não achei código nem texto reconhecível nessa imagem — tente uma foto mais nítida ou digite o código.');
      return;
    }
    if (lista.length === 1) { usar(lista[0].valor); return; }
    status('achei mais de um código — qual é o certo?');
    opcoesEl.innerHTML = lista.slice(0, 4).map(function (c) {
      return '<button type="button" onclick="usarCodigoColado(\'' + c.valor + '\')" '
        + 'style="display:block;width:100%;text-align:left;margin-bottom:4px;background:#fff;'
        + 'border:1px solid #e4dcf1;border-radius:8px;padding:7px 9px;cursor:pointer;font-size:12.5px;">'
        + '<b style="font-family:ui-monospace,monospace;">' + c.valor + '</b> '
        + '<span style="color:#71659a;font-size:11px;">' + c.tipo + '</span></button>';
    }).join('');
  }

  async function lerCodigo(img) {
    if (!('BarcodeDetector' in window)) return null;   // computador nao tem
    try {
      var det = new BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'qr_code', 'pdf417'],
      });
      var codes = await det.detect(img);
      if (codes && codes.length) {
        // v5.1 (Codex): no Android o detector acha os DOIS codigos da etiqueta
        // Magalu — o de barras grande (rastreio, que NAO acha devolucao) e o
        // QR (que tem o pedido). Pegar o primeiro da lista era sorte. O QR
        // vem na frente sempre.
        var qr = codes.find(function (c) { return c.format === 'qr_code'; });
        var barras = codes.find(function (c) { return c.format !== 'qr_code'; });
        // v5.3 (Codex): preferir o QR nao pode DESCARTAR um codigo de barras
        // valido. Em etiqueta nao-Magalu com um QR qualquer (rastreio,
        // propaganda), ficar so com o QR fazia o de barras — que e o codigo
        // certo ali — nunca ser tentado. Devolve os dois; quem chama usa o
        // de barras se o QR nao render nada util.
        return {
          preferido: String((qr || codes[0]).rawValue || '').trim(),
          reserva: barras ? String(barras.rawValue || '').trim() : null,
        };
      }
    } catch (e) {}
    return null;
  }

  /**
   * v5 - LER O QR NO COMPUTADOR.
   *
   * O BarcodeDetector acima so existe no Android. No Chrome/Edge de
   * computador ele nao existe, entao o QR NUNCA era lido: sobrava o OCR,
   * que le texto e ignora QR. Foi o que aconteceu com a etiqueta Magalu
   * colada em 29/08 — o pedido estava DENTRO do QR e ninguem olhava la.
   *
   * O jsQR faz isso em JavaScript puro, em qualquer navegador. Varre a
   * imagem inteira e, se nao achar, tenta de novo com o dobro do tamanho
   * (QR pequeno de print de WhatsApp costuma so aparecer ampliado).
   */
  async function lerQrNoCanvas(img) {
    if (typeof jsQR === 'undefined') return null;
    try {
      // v5.1 (Codex): TETO no canvas. Foto de celular moderno chega a 4000px;
      // dobrar dava 8000x8000 = 256 MB so no ImageData, o que trava ou estoura
      // a aba justamente em quem tirou foto boa. Acima do teto, nao amplia.
      var TETO = 4000;
      var maior = Math.max(img.width, img.height);
      if (!maior) return null;
      // v5.3 (Codex): o teto anterior so impedia AMPLIAR — uma foto de 48 MP
      // (8064x6048) ainda criava o canvas no tamanho original: ~195 MB so de
      // ImageData, e a aba morria antes de chegar no OCR. Agora imagem grande
      // e REDUZIDA ate o teto; a pequena e que ganha o passe de 2x.
      var base = maior > TETO ? (TETO / maior) : 1;
      var passes = base < 1 ? [base] : [1, 2];
      for (var escala of passes) {
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * escala);
        c.height = Math.round(img.height * escala);
        if (!c.width || !c.height) return null;
        var ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        var d = ctx.getImageData(0, 0, c.width, c.height);
        var r = jsQR(d.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
        if (r && r.data) return String(r.data).trim();
      }
    } catch (e) {}
    return null;
  }

  /**
   * v5 - O QUE FAZER COM O CONTEUDO DO QR.
   *
   * O QR da etiqueta Magalu nao e um numero: e um JSON. Medido na
   * etiqueta real da AMB (29/08):
   *
   *   {"external_grouper_code":"1550970116332325",   <- O PEDIDO. e este.
   *    "external_code":"db1d4527-...",               <- UUID do pacote
   *    "tag_code":"197008400-01",                    <- o RASTREIO. NAO e este.
   *    "logistical_flow_start":"DROP_OFF", ...}
   *
   * Jogar o JSON inteiro na busca nao acha nada, e pegar o campo errado
   * acha o rastreio — que, como esta escrito no "O que bipar", e
   * justamente o que NAO serve pra achar devolucao Magalu.
   *
   * Devolve { valor, tipo, extra } ou null se nao souber ler.
   */
  // v6 - EXPOSTA: o scanner da CAMERA usa a mesma regra.
  //
  // Ate 29/08 a camera pegava codes[0] — o primeiro codigo que entrasse no
  // quadro. Numa etiqueta Magalu, o codigo de barras e grande e o QR e
  // pequeno: dava pra bipar o RASTREIO, que e justamente o que nao acha
  // devolucao. Duplicar a logica aqui criaria duas copias pra divergir
  // (a licao do dia), entao a funcao vira publica e os dois leitores
  // chamam a MESMA.
  window.interpretarCodigoLido = function (bruto) { return interpretarQr(bruto); };

  function interpretarQr(bruto) {
    var txt = String(bruto || '').trim();
    if (!txt) return null;

    // Magalu: JSON com os campos da etiqueta
    if (txt.charAt(0) === '{') {
      var j = null;
      try { j = JSON.parse(txt); } catch (e) { j = null; }
      if (j && j.external_grouper_code) {
        // v5.3 (Codex): o servidor precisa RECONHECER que veio da Magalu —
        // ele procura external_grouper_code/tag_code/logistical_flow e liga o
        // modo "magalu-first" (server.js ~424), indo direto ao Magalu; com o
        // numero pelado a busca bate no Mercado Livre antes e coleciona 404.
        //
        // Mas mandar o QR INTEIRO leva junto dado do cliente — o
        // receiver_zipcode, e o que a Magalu resolver acrescentar amanha. E
        // isso vai pra querystring do GET e pro log do servidor, que registra
        // o codigo recebido. Entao vai o MINIMO que liga o modo magalu-first:
        // o pedido e o discriminador. CEP e afins ficam de fora.
        var minimo = JSON.stringify({
          external_grouper_code: String(j.external_grouper_code).trim(),
          logistical_flow_start: 'DROP_OFF',
        });
        return {
          valor: minimo,
          mostrar: String(j.external_grouper_code).trim(),
          tipo: 'pedido Magalu (do QR)',
          extra: {
            pedido: String(j.external_grouper_code).trim(),
            uuid_pacote: j.external_code || null,
            rastreio: j.tag_code || null,
          },
        };
      }
      // v5.1 (Codex): o QR do MERCADO LIVRE tambem e JSON — {"id":"47416667668","t":"l"}.
      // O servidor JA sabe ler esse formato (server.js ~447, mQrML). Devolver
      // null aqui jogaria fora um QR que hoje FUNCIONA: o ML ia parar de ser
      // lido por imagem. Entao o JSON do ML segue INTEIRO pro servidor, que
      // extrai o id como sempre fez.
      if (j && (j.id || j.t)) {
        return { valor: txt, tipo: 'QR do Mercado Livre', bruto: true };
      }
      return null;   // JSON que nao conheco: nao chuta
    }

    // QR que e uma URL (ML e Magalu usam): tira o identificador de dentro
    if (/^https?:\/\//i.test(txt)) {
      var mSh = txt.match(/\b(\d{6}[A-Z0-9]{6,10})\b/);
      if (mSh) return { valor: mSh[1], tipo: 'pedido Shopee (do QR)' };
      var mNum = txt.match(/\b(\d{14,20})\b/);
      if (mNum) return { valor: mNum[1], tipo: 'codigo do QR' };
      return null;
    }

    // QR simples: o proprio conteudo
    return { valor: txt, tipo: 'codigo do QR' };
  }

  async function lerTexto(dataUrl) {
    if (typeof Tesseract === 'undefined') {
      status('o leitor de texto não carregou nesta página.');
      return '';
    }
    status('lendo o texto da etiqueta... (a primeira vez baixa o idioma e demora ~20s)');
    try {
      dataUrl = await prepararImagem(dataUrl);   // v3 - melhora a leitura
      var worker = await Tesseract.createWorker('por', 1, {
        logger: function (m) {
          if (m && m.status === 'recognizing text') {
            status('lendo o texto da etiqueta... ' + Math.round((m.progress || 0) * 100) + '%');
          }
        },
      });
      // v3 - so letras MAIUSCULAS, numeros e pontuacao de etiqueta. Sem
      // isso o Tesseract inventa acentos e confunde 6 com 8 (foi o que
      // aconteceu: leu BR264131068541Q no lugar de BR264131066541Q).
      try {
        await worker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-/:',
        });
      } catch (e) {}
      var r = await worker.recognize(dataUrl);
      await worker.terminate();
      return (r && r.data && r.data.text) || '';
    } catch (e) {
      status('não consegui ler o texto: ' + (e.message || e));
      return '';
    }
  }

  /**
   * v3 - PREPARO DA IMAGEM (o que mais melhora a leitura).
   * Amplia 2x, tira a cor e estica o contraste. Print de WhatsApp vem
   * pequeno e comprimido; sem isso o Tesseract erra digito parecido
   * (6/8, 0/O, 5/S). Nao mexe na imagem original — trabalha numa copia.
   */
  async function prepararImagem(dataUrl) {
    try {
      var img = new Image();
      await new Promise(function (r) { img.onload = r; img.onerror = r; img.src = dataUrl; });
      if (!img.width) return dataUrl;
      var escala = img.width < 1400 ? 2 : 1;
      var c = document.createElement('canvas');
      c.width = img.width * escala; c.height = img.height * escala;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      var d = ctx.getImageData(0, 0, c.width, c.height);
      var px = d.data, min = 255, max = 0, i;
      for (i = 0; i < px.length; i += 4) {
        var g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
        px[i] = px[i + 1] = px[i + 2] = g;
        if (g < min) min = g;
        if (g > max) max = g;
      }
      var faixa = Math.max(1, max - min);
      for (i = 0; i < px.length; i += 4) {
        var v = ((px[i] - min) * 255 / faixa) | 0;
        v = v < 0 ? 0 : (v > 255 ? 255 : v);
        px[i] = px[i + 1] = px[i + 2] = v;
      }
      ctx.putImageData(d, 0, 0);
      return c.toDataURL('image/png');
    } catch (e) { return dataUrl; }
  }

  async function processar(blob) {
    montarZona();
    if (opcoesEl) opcoesEl.innerHTML = '';
    var dataUrl = await new Promise(function (res) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.readAsDataURL(blob);
    });
    trabalhando(true);
    if (previaEl) { previaEl.src = dataUrl; previaEl.style.display = ''; }
    status('imagem recebida, procurando o código de barras...');

    var img = new Image();
    await new Promise(function (r) { img.onload = r; img.onerror = r; img.src = dataUrl; });

    // 1) leitor nativo (so Android)
    var nativo = await lerCodigo(img);
    var codigo = nativo && nativo.preferido ? nativo.preferido : null;
    var reservaBarras = nativo && nativo.reserva ? nativo.reserva : null;

    // 2) v5 - QR no canvas: e o que faz o computador enxergar o QR.
    //    Roda ANTES do OCR porque o QR e exato — o OCR chuta digito.
    //
    // v5.3 (Codex): roda tambem quando o leitor nativo achou SO o codigo de
    // barras. Na etiqueta Magalu o de barras e grande e o QR e pequeno: o
    // detector as vezes ve so o primeiro, e ai iamos buscar o RASTREIO — que
    // e exatamente o que nao acha devolucao. O jsQR costuma recuperar o QR
    // que o nativo perdeu; se nao recuperar, o de barras continua de reserva.
    var achouQrNativo = !!(nativo && nativo.preferido && !nativo.reserva)
      || (!!codigo && codigo !== reservaBarras);
    if (!codigo || !achouQrNativo) {
      status('procurando o QR code da etiqueta...');
      var doCanvas = await lerQrNoCanvas(img);
      if (doCanvas) codigo = doCanvas;
    }

    if (codigo) {
      var lido = interpretarQr(codigo);
      if (lido) {
        if (lido.extra && lido.extra.rastreio) {
          status('QR lido — usando o PEDIDO ' + (lido.mostrar || lido.valor)
            + ' (o rastreio ' + lido.extra.rastreio + ' nao acha devolucao)');
        }
        // v5.2 (Codex): o UUID do pacote morria aqui — so o `valor` seguia
        // adiante. Ele e o que falta pro link que abre o pedido no painel do
        // Magalu, entao fica guardado onde outra tela possa pegar, em vez de
        // ter que decodificar o QR de novo.
        if (lido.extra && lido.extra.uuid_pacote) {
          try {
            window.ULTIMO_QR_MAGALU = {
              pedido: lido.extra.pedido || null,
              uuid_pacote: lido.extra.uuid_pacote,
              rastreio: lido.extra.rastreio || null,
              lido_em: new Date().toISOString(),
            };
            document.dispatchEvent(new CustomEvent('qr-magalu-lido', { detail: window.ULTIMO_QR_MAGALU }));
          } catch (e) {}
        }
        usar(lido.valor);
        return;
      }
      // v5.3: o QR nao rendeu nada util. Se o leitor nativo tambem achou um
      // codigo de BARRAS, ele e a resposta desta etiqueta — usa antes do OCR.
      if (reservaBarras) {
        status('o QR nao serviu — usando o codigo de barras da etiqueta');
        usar(reservaBarras);
        return;
      }
      // QR ilegivel pra nos: nao joga o conteudo cru na busca, tenta o texto
      status('o QR tem um formato que eu nao conheco — vou ler o texto da etiqueta');
    }

    oferecer(candidatos(await lerTexto(dataUrl)));
    setTimeout(function () { trabalhando(false); }, 6000);
  }

  function imagemDe(dt) {
    if (!dt) return null;
    var itens = dt.items || [];
    for (var i = 0; i < itens.length; i++) {
      if (itens[i].type && itens[i].type.indexOf('image/') === 0) {
        var f = itens[i].getAsFile();
        if (f) return f;
      }
    }
    var arqs = dt.files || [];
    for (var j = 0; j < arqs.length; j++) {
      if (arqs[j].type && arqs[j].type.indexOf('image/') === 0) return arqs[j];
    }
    return null;
  }

  // colar em QUALQUER lugar (inclusive dentro do campo de busca)
  ['paste'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var blob = imagemDe(e.clipboardData || window.clipboardData);
      if (!blob) return;                  // colou texto: comportamento normal
      e.preventDefault();
      processar(blob);
    }, true);
  });

  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    var blob = imagemDe(e.dataTransfer);
    if (!blob) return;
    e.preventDefault();
    processar(blob);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montarZona);
  } else {
    montarZona();
  }
})();
