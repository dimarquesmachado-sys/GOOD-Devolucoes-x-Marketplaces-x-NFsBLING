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
//
//  b789 - PACOTE MELI (etiqueta do ML sem nome de cliente: venda que nao foi
//  entregue e voltou). O codigo de barras e o QR dela sao o envio DE VOLTA,
//  que nao acha a venda; o que acha e o "Ref. ID" impresso. Entao: o botao
//  "pacote MELI", a leitura do Ref. ID na foto, e — quando a busca pelo
//  codigo de uma foto nao acha — a nova tentativa, sozinha, pelo Ref. ID
//  da mesma foto.
//
//  b790 (Codex #638) - ler demora, e o estoquista nao espera: toda leitura
//  (colar/anexar, a foto do cartao e a tentativa automatica) so mexe na tela
//  se, quando termina, a tela ainda e a de quando comecou (`aindaVale`).
//  b791 (idem, 2a rodada) - mexer em qualquer campo conta como "a tela mudou";
//  e numero que pode ter sido lido pela metade (partido pelo leitor, ou com
//  letra grudada) nunca e buscado sozinho: a tela mostra as leituras e pergunta.
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

    // b789 - o "Ref. ID" do pacote MELI (so quando o ROTULO foi lido; numero solto, aqui, nao diz nada). A etiqueta
    // Magalu nao tem. Usa o texto ORIGINAL: o numero do Ref. ID nao continua na linha de baixo.
    if (!et) {
      candidatosRefId(texto, '').forEach(function (c) {
        if (!c.rotulado || visto[c.valor]) return;
        visto[c.valor] = 1;
        out.push(c);
      });
    }

    return out.sort(function (a, b) { return b.peso - a.peso; });
  }

  /**
   * b789 - O "Ref. ID" DA ETIQUETA DE VOLTA DO MERCADO LIVRE ("pacote MELI": venda que nao foi entregue e voltou, sem
   * nome de cliente). O codigo de barras e o QR dessa etiqueta sao o envio DE VOLTA, que o ML nao deixa consultar; o
   * numero que acha a venda e o "Ref. ID" impresso no alto dela.
   *
   * Texto MEDIDO na foto da AMB (21/11), com este mesmo leitor e esta mesma lista de caracteres (so maiusculas e
   * numeros): "Ref. ID: 48126024340" saiu "R. 1D: 48126024340" — as minusculas somem e o I vira 1. Por isso o ROTULO e
   * reconhecido frouxo (R + ate 2 letras, depois I/1/L e D/0/O) — mas com ALGO separando o "R" do "ID" (ponto/espaco)
   * ou com os dois pontos depois, senao "RIO 21999998888" passaria por Ref. ID. E o NUMERO, firme: 10 a 13 digitos NA
   * MESMA LINHA.
   *
   * b791 (Codex #638) - O NUMERO PODE TER SIDO LIDO PELA METADE. A etiqueta imprime o fim do numero em negrito e o
   * leitor as vezes o PARTE com um espaco — e nao da pra saber onde: "481260 24340" so pode ser 48126024340, mas
   * "4812602434 0" pode ser o de 10 digitos ou o de 11 (aceitar o primeiro pedaco "inteiro" jogava o ultimo digito
   * fora e buscava OUTRO envio). Entao cada numero sai com TODAS as leituras possiveis dos pedacos vizinhos (`leituras`)
   * e com `certo`: verdadeiro so quando ha UMA leitura e nenhuma letra grudada nele (letra grudada pode ser um digito
   * que o leitor trocou — "4812602434O"). So o numero `certo` e buscado sozinho; o resto vira pergunta, com as leituras
   * lado a lado pra bater com a etiqueta.
   *
   * Devolve candidatos no formato de `candidatos`:
   *  - leu o rotulo → SO as leituras do numero dele (rotulado: true);
   *  - nao leu o rotulo → os numeros soltos de 10 a 13 digitos (e as outras leituras de cada um) que NAO sao o codigo ja
   *    tentado (`jaTentado`): quem chama decide (um so e `certo` = e ele; senao a tela pergunta).
   */
  // As leituras possiveis de uma fileira de pedacos de digitos separados por espaco: as juncoes de pedacos SEGUIDOS que
  // dao de 10 a 13 digitos. Com `k`, so as que contem o pedaco `k` (o numero solto que ja tinha o tamanho certo).
  function leituras(partes, k) {
    var out = [];
    for (var i = 0; i < partes.length && (k == null || i <= k); i++) {
      var junto = '';
      for (var j = i; j < partes.length; j++) {
        junto += partes[j];
        if (junto.length > 13) break;
        if (junto.length >= 10 && (k == null || j >= k) && out.indexOf(junto) === -1) out.push(junto);
      }
    }
    return out;
  }
  function candidatosRefId(texto, jaTentado) {
    var linhas = String(texto || '').toUpperCase().split(/\r?\n/);
    var fora = String(jaTentado || '').replace(/\D/g, '');
    var letra = function (l, pos) { return /[A-Z]/.test(l.charAt(pos)); };
    for (var i = 0; i < linhas.length; i++) {
      // o numero termina num pedaco INTEIRO (o digito seguinte, se houver, e de outro pedaco — nunca corta um no meio)
      var m = linhas[i].match(/\bR[A-Z]{0,2}(?:[ .]{1,3}[I1L][D0O][ .:]{0,3}|[I1L][D0O][ .]{0,2}:[ .]{0,2})(\d[\d ]{8,16}\d)(?!\d)/);
      if (!m) continue;
      var doRotulo = leituras(m[1].trim().split(/ +/), null);
      if (!doRotulo.length || doRotulo.indexOf(fora) !== -1) continue;
      var umaSo = doRotulo.length === 1 && !letra(linhas[i], m.index + m[0].length);
      return doRotulo.map(function (n) { return { valor: n, tipo: 'Ref. ID (Mercado Livre)', peso: 9, rotulado: true, certo: umaSo }; });
    }
    var visto = {}, out = [];
    linhas.forEach(function (l) {
      var fileira = /\d+(?: +\d+)*/g, g;
      while ((g = fileira.exec(l))) {
        var partes = g[0].split(/ +/);
        var grudada = letra(l, g.index - 1) || letra(l, g.index + g[0].length);
        for (var k = 0; k < partes.length; k++) {
          if (partes[k].length < 10 || partes[k].length > 13) continue;   // so o que ja era um numero de envio sozinho
          var lidas = leituras(partes, k);
          if (lidas.indexOf(fora) !== -1) continue;                        // e o codigo que acabou de falhar (inteiro ou partido)
          lidas.forEach(function (n) {
            if (visto[n]) return;
            visto[n] = 1;
            out.push({ valor: n, tipo: 'número da etiqueta (pode ser o Ref. ID)', peso: 5, rotulado: false, certo: lidas.length === 1 && !grudada });
          });
        }
      }
    });
    return out;
  }

  // ── a area visivel, criada por JS (nao precisa mexer no index) ──
  var zona, statusEl, previaEl, opcoesEl, inputArquivo, inputArquivoRef;

  // b789 - estado da leitura do Ref. ID (pacote MELI)
  var ultimaEtiqueta = null;   // { dataUrl, codigo, vez, tentou }: a ultima imagem cujo codigo foi pra busca
  var vez = 0;                 // cada imagem nova invalida a leitura em andamento da anterior

  // b790 (Codex #638) - LEITURA QUE TERMINA DEPOIS DE O ESTOQUISTA TER SEGUIDO ADIANTE NAO MEXE NA TELA.
  // Ler uma imagem demora (o texto leva de 5 a 20 s). Nesse meio tempo ele pode bipar a caixa seguinte, buscar um Ref. ID
  // na mao, abrir o cartao do pacote MELI, comecar a digitar (outro codigo, ou o Ref. ID no cartao) ou mandar outra
  // imagem — e a leitura velha, ao terminar, escrevia no campo e disparava uma busca POR CIMA do que ele estava vendo ou
  // digitando (a venda de outra caixa na tela).
  // Toda leitura tira um RETRATO da tela quando comeca e so mexe nela se, ao terminar, nada disso mudou:
  //   vez   — chegou outra imagem depois desta;
  //   busca — a geracao da tela (`_buscaSeq`, do busca.js): sobe a cada busca e quando o cartao do pacote MELI e aberto;
  //   campo — o que esta escrito no campo de busca;
  //   mexidas — b791 (Codex #638): ele mexeu em ALGUM campo da pagina depois (digitou, marcou, escolheu). O apontamento:
  //             comecou a digitar o Ref. ID no cartao enquanto a foto era lida, e a leitura, ao terminar, buscava e
  //             levava o cartao embora com o que ele estava digitando. Vale pra qualquer campo, nao so o do cartao: o
  //             que ele esta digitando nao e trocado pelo que a leitura achou.
  var mexidas = 0;
  document.addEventListener('input', function () { mexidas++; }, true);
  function geracaoDaBusca() { return typeof _buscaSeq === 'number' ? _buscaSeq : 0; }
  function campoDeBusca() { var c = document.getElementById('codigo'); return c ? String(c.value || '').trim() : ''; }
  function retrato() { return { vez: vez, busca: geracaoDaBusca(), campo: campoDeBusca(), mexidas: mexidas }; }
  function aindaVale(t) { return t.vez === vez && t.busca === geracaoDaBusca() && t.campo === campoDeBusca() && t.mexidas === mexidas; }
  // A leitura foi atropelada. Se a area de leitura ainda e DELA (nao chegou outra imagem), some com ela e com o "lendo..."
  // do cartao — senao ficariam na tela prometendo um resultado que nao vem.
  function largar(t) { if (t.vez === vez) { avisoNoCartao(''); trabalhando(false); } }
  // O "some depois" e UM so e cancelavel. A leitura do Ref. ID comeca logo depois de uma busca que falhou, e o
  // "some em 1,5 s" daquela busca apagava o aviso desta no meio da leitura. Trabalho novo cancela o sumico pendente;
  // entre dois pedidos de sumir vale o que vence primeiro (como era com os dois setTimeout soltos).
  var somTimer = null, somQuando = 0;
  function sumirEm(ms) {
    var quando = Date.now() + ms;
    if (somTimer && somQuando <= quando) return;
    clearTimeout(somTimer);
    somQuando = quando;
    somTimer = setTimeout(function () { somTimer = null; trabalhando(false); }, ms);
  }
  // o recado dentro do cartao "pacote MELI" da tela (busca.js), quando ele esta aberto
  function avisoNoCartao(txt) {
    var el = document.getElementById('statusRefId');
    if (!el) return;
    el.textContent = txt || '';
    el.style.display = txt ? 'block' : 'none';
  }

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
    // b542 - celular (dono, 05/10: 'triagem, anexar etiqueta, botao fora'): a linha quebra em vez de empurrar o botao
    // pra fora da tela, e o botao nunca passa da largura da linha.
    linha.style.flexWrap = 'wrap';
    btn.style.maxWidth = '100%';
    linha.appendChild(btn);

    // b789 - "pacote MELI" (pedido do dono, 21/11: "um botao pra clicar e marcar que e pacote MELI"): a etiqueta do ML
    // sem nome de cliente. Abre o cartao do Ref. ID (busca.js) sem precisar bipar antes. Mesmo desenho do botao ao lado.
    var meli = document.createElement('button');
    meli.id = 'btnPacoteMeli';
    meli.type = 'button';
    meli.title = 'etiqueta do Mercado Livre SEM nome de cliente (remetente MELI): busca pelo Ref. ID impresso nela';
    meli.style.cssText = btn.style.cssText;
    meli.innerHTML = '\u{1F4E6}<br>pacote MELI';
    meli.addEventListener('click', function () { if (typeof abrirPacoteMeli === 'function') abrirPacoteMeli(); });
    linha.appendChild(meli);

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

    // b789 - a foto pedida pelo cartao "pacote MELI" tem entrada propria: ela vai DIRETO ao Ref. ID (sem modo guardado
    // numa variavel, que ficaria valendo pra proxima foto se o estoquista desistisse desta)
    inputArquivoRef = document.createElement('input');
    inputArquivoRef.id = 'arquivoRefId';
    inputArquivoRef.type = 'file';
    inputArquivoRef.accept = 'image/*';
    inputArquivoRef.style.display = 'none';
    document.body.appendChild(inputArquivoRef);
    inputArquivoRef.addEventListener('change', function () {
      var arq = inputArquivoRef.files && inputArquivoRef.files[0];
      inputArquivoRef.value = '';   // a MESMA foto de novo tem que disparar outra leitura
      if (arq) processar(arq, true);
    });
  }

  function trabalhando(sim) {
    if (sim) { clearTimeout(somTimer); somTimer = null; }   // b789: trabalho novo cancela o sumico pendente
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
    sumirEm(1500);   // v3 - o aviso some
  }
  window.usarCodigoColado = usar;

  function oferecer(lista, semNada, perguntar) {
    // b789: os candidatos a Ref. ID desta leitura (os que vieram de `candidatosRefId`). Se a busca por um deles ACHAR
    // uma venda, a tela mostra o numero lido pra conferir com a etiqueta (busca.js) — leitura de texto troca digito.
    window._refIdsLidosDaFoto = lista.filter(function (c) { return typeof c.rotulado === 'boolean'; }).map(function (c) { return c.valor; });
    if (!opcoesEl) return;
    if (!lista.length) {
      status(semNada || 'não achei código nem texto reconhecível nessa imagem — tente uma foto mais nítida ou digite o código.');
      return;
    }
    // b791: um numero que talvez nao tenha sido lido inteiro (`certo: false`) NUNCA e buscado sozinho, venha de onde vier
    if (lista.length === 1 && !perguntar && lista[0].certo !== false) { usar(lista[0].valor); return; }
    status(lista.length === 1 ? 'achei este número na etiqueta — é o Ref. ID? toque nele pra buscar.' : 'achei mais de um código — qual é o certo?');
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

  async function processar(blob, soRefId) {
    montarZona();
    ++vez;                // b789: imagem nova — a leitura em andamento na anterior nao mexe mais na tela
    var t = retrato();    // b790: ...e esta so mexe se, ao terminar, a tela ainda for a de agora
    avisoNoCartao('');    // b790: o "lendo o Ref. ID..." que uma leitura anterior deixou no cartao ja nao vale
    if (opcoesEl) opcoesEl.innerHTML = '';
    var dataUrl = await new Promise(function (res) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.readAsDataURL(blob);
    });
    trabalhando(true);
    if (previaEl) { previaEl.src = dataUrl; previaEl.style.display = ''; }

    // b789 - a foto pedida pelo cartao "pacote MELI": o codigo de barras e o QR dessa etiqueta sao o envio DE VOLTA, que
    // nao acha a venda — nem tenta. Le o texto e vai direto ao Ref. ID impresso.
    if (soRefId) {
      status('imagem recebida, procurando o Ref. ID impresso na etiqueta...');
      avisoNoCartao('\u{1F50E} Lendo o Ref. ID na foto…');
      var listaRef = candidatosRefId(await lerTexto(dataUrl), '');
      if (!aindaVale(t)) { largar(t); return; }   // b790: outra imagem, outra busca, o cartao reaberto ou o campo mexido
      mostrarRefId(listaRef);
      return;
    }
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
    // b790: ele seguiu adiante enquanto o codigo era lido? entao esta imagem nao escreve no campo, nao busca e nem gasta
    // os segundos da leitura de texto. (Daqui ate a leitura de texto nao ha espera: este e o unico ponto.)
    if (!aindaVale(t)) { largar(t); return; }

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
        // b789: se a busca por este codigo nao achar (pacote MELI), o Ref. ID esta nesta mesma imagem
        ultimaEtiqueta = { dataUrl: dataUrl, codigo: String(lido.valor).trim(), vez: t.vez, tentou: false };
        usar(lido.valor);
        return;
      }
      // v5.3: o QR nao rendeu nada util. Se o leitor nativo tambem achou um
      // codigo de BARRAS, ele e a resposta desta etiqueta — usa antes do OCR.
      if (reservaBarras) {
        status('o QR nao serviu — usando o codigo de barras da etiqueta');
        ultimaEtiqueta = { dataUrl: dataUrl, codigo: String(reservaBarras).trim(), vez: t.vez, tentou: false };   // b789
        usar(reservaBarras);
        return;
      }
      // QR ilegivel pra nos: nao joga o conteudo cru na busca, tenta o texto
      status('o QR tem um formato que eu nao conheco — vou ler o texto da etiqueta');
    }

    var textoLido = await lerTexto(dataUrl);
    if (!aindaVale(t)) { largar(t); return; }   // b790: idem — a leitura de texto e a etapa demorada
    oferecer(candidatos(textoLido));
    sumirEm(6000);
  }

  // b789 - o que fazer com o que a leitura do Ref. ID achou: um so → busca; varios → pergunta (e o aviso NAO some
  // sozinho, pra dar tempo de escolher); nenhum → diz, e manda digitar no cartao.
  // `soRotulado`: na tentativa AUTOMATICA ninguem disse que a etiqueta e um pacote MELI — entao so o numero que veio com
  // o ROTULO "Ref. ID" e buscado sozinho. Numero solto de 11 digitos pode ser telefone ou CPF de uma etiqueta que nem e
  // do ML: nao vai pra busca (nem pro registro do servidor) sem alguem tocar nele.
  // b791: e so o numero `certo` (lido inteiro e sozinho — ver `candidatosRefId`) e buscado sem perguntar.
  function mostrarRefId(lista, soRotulado) {
    var um = lista.length === 1 ? lista[0] : null;
    var perguntar = lista.length > 1 || (!!um && (um.certo === false || (!!soRotulado && !um.rotulado)));
    if (!lista.length) {
      avisoNoCartao('Não consegui ler o Ref. ID nessa foto — digite os números dele aqui em cima.');
      sumirEm(6000);
    } else if (perguntar) {
      avisoNoCartao(lista.length > 1 ? 'Achei mais de um número na foto — toque no Ref. ID na lista lá em cima, ou digite aqui.'
        : um.certo === false ? 'Li um número na foto, mas talvez não inteiro — confira com a etiqueta: se for o Ref. ID, toque nele lá em cima; senão, digite aqui.'
        : 'Achei um número na foto, mas não li o rótulo "Ref. ID" — se for ele, toque nele lá em cima; senão, digite aqui.');
    }
    oferecer(lista, 'não consegui ler o Ref. ID nessa foto — tente uma foto mais nítida ou digite os números dele.', perguntar);
  }

  /**
   * b789 - A BUSCA QUE FALHOU VEIO DE UMA FOTO? O Ref. ID ESTA NELA.
   * A tela (busca.js) chama isto quando o ML responde que o envio buscado nao existe. Se esse codigo saiu da ULTIMA
   * imagem mandada (o QR/codigo de barras de um pacote MELI e o envio DE VOLTA), le o texto da mesma imagem, pega o
   * "Ref. ID" impresso e busca por ele — sem o estoquista fazer nada.
   * O resultado e usado UMA vez por imagem (se o Ref. ID tambem nao achar, nao entra em laco), e a leitura e LARGADA se
   * nesse meio tempo o estoquista seguiu adiante (regra do `aindaVale`, la em cima).
   * b790: so comeca se a imagem ainda e a ULTIMA que chegou — se ele ja mandou outra, a da vez e a nova, e esta leitura
   * nao pode passar na frente dela. E a leitura (a parte demorada) e UMA por imagem: se a busca do MESMO codigo se
   * repetir enquanto ela anda (apertou Buscar de novo — e a mesma caixa), a busca mais nova espera a mesma leitura e e
   * ela quem decide o que fazer com o resultado.
   * `digitos` = o numero que o servidor de fato buscou (o id de dentro do QR), pra nao oferecer ele mesmo de novo.
   */
  window.tentarRefIdDaEtiqueta = async function (codigoBuscado, digitos) {
    try {
      var e = ultimaEtiqueta;
      if (!e || e.tentou || e.vez !== vez || String(codigoBuscado || '').trim() !== e.codigo) return false;
      var t = retrato();
      t.campo = e.codigo;   // esta leitura e DO codigo que falhou: so vale com ele (ainda) no campo de busca
      e.t = t;              // a busca mais nova deste codigo e quem decide
      montarZona();
      trabalhando(true);
      if (previaEl) { previaEl.src = e.dataUrl; previaEl.style.display = ''; }
      avisoNoCartao('\u{1F50E} Lendo o Ref. ID na foto que você mandou…');
      if (!e.lendo) e.lendo = lerTexto(e.dataUrl);
      var texto = await e.lendo;
      if (e.t !== t) return false;                      // uma busca mais nova do mesmo codigo assumiu esta leitura
      if (!aindaVale(t)) { largar(t); return false; }
      e.tentou = true;
      var lista = candidatosRefId(texto, digitos || e.codigo);
      mostrarRefId(lista, true);
      return lista.length > 0;
    } catch (err) { return false; }
  };

  // b789 - o botao de foto do cartao "pacote MELI"
  window.lerRefIdDaFoto = function () { montarZona(); if (inputArquivoRef) inputArquivoRef.click(); };

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
