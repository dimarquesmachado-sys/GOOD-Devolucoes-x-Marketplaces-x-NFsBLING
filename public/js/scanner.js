// ============================================================
// scanner.js - camera mobile pra bipar codigo de barras
// ============================================================
// Licoes Girassol: pausa entre leituras, lastCode pra evitar dupla, BarcodeDetector
// v3.14.9: suporta 2 modos:
//   - 'etiqueta': bipa etiqueta da devolucao -> preenche campo busca + buscar()
//   - 'bipagem': bipa EAN do produto -> chama processarBipagem() do bipagem.js

let scannerStream = null;
let scannerDetector = null;
let scannerScanning = false;
let scannerPaused = false;
let scannerLastCode = '';
let scannerLastCodeAt = 0;
// v3.34.2 - quantos quadros ja passaram vendo SO codigo de barras numa
// etiqueta. Serve pra dar chance ao QR (pequeno) aparecer antes de aceitar
// o rastreio (grande). Zera a cada leitura nova e ao abrir a camera.
let scannerEsperasSemQr = 0;
let scannerModo = 'etiqueta'; // 'etiqueta' ou 'bipagem'

async function abrirCameraScanner(modo = 'etiqueta') {
  scannerEsperasSemQr = 0;   // v3.34.2 - comeca a contagem do zero
  scannerModo = modo;

  // Verifica se navegador suporta BarcodeDetector
  if (!('BarcodeDetector' in window)) {
    toast('Camera scanner nao suportada. Use Chrome ou Edge no celular.', 'err');
    return;
  }
  try {
    scannerDetector = new BarcodeDetector({
      formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'qr_code', 'pdf417']
    });
  } catch (e) {
    toast('Erro ao iniciar scanner: ' + e.message, 'err');
    return;
  }

  // Atualiza titulo do scanner conforme o modo
  const tituloEl = document.querySelector('#scannerOverlay div[style*="font-weight:700"]');
  if (tituloEl) {
    tituloEl.textContent = modo === 'bipagem'
      ? '📷 Bipar EAN do produto'
      : '📷 Bipar etiqueta';
  }

  // Atualiza texto inicial do status conforme modo
  const statusEl = document.getElementById('scannerStatus');
  if (statusEl) {
    statusEl.style.background = 'rgba(0,0,0,0.85)';
    statusEl.textContent = modo === 'bipagem'
      ? 'Aponte para o EAN do produto'
      : 'Aponte para o codigo de barras';
  }

  const overlay = document.getElementById('scannerOverlay');
  overlay.style.display = 'flex';

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    const video = document.getElementById('scannerVideo');
    video.srcObject = scannerStream;
    await video.play();

    scannerScanning = true;
    scannerPaused = false;
    scannerLastCode = '';
    scannerLoop();
  } catch (e) {
    toast('Erro ao abrir camera: ' + e.message, 'err');
    fecharCameraScanner();
  }
}

// Atalho pra abrir em modo bipagem (chamado do botao do modal aprovar)
function abrirCameraBipagem() {
  abrirCameraScanner('bipagem');
}

function scannerLoop() {
  if (!scannerScanning || !scannerDetector) return;
  if (scannerPaused) {
    requestAnimationFrame(scannerLoop);
    return;
  }
  const video = document.getElementById('scannerVideo');
  if (!video || video.videoWidth < 100) {
    requestAnimationFrame(scannerLoop);
    return;
  }
  scannerDetector.detect(video).then(codes => {
    if (codes.length > 0) {
      // v3.34 - ESCOLHE o codigo, nao pega o primeiro que aparecer.
      //
      // Ate 29/08 era codes[0]. Numa etiqueta Magalu o codigo de barras e
      // grande e o QR e pequeno: com sorte de enquadramento, o estoquista
      // bipava o RASTREIO — que e justamente o que NAO acha devolucao (esta
      // escrito no "O que bipar" do proprio painel). Virava loteria.
      //
      // O QR vem na frente porque e onde mora o identificador util (na
      // Magalu, o pedido); o de barras fica de reserva, pra etiqueta que so
      // tem ele.
      // v3.34.1 (Codex): a preferencia por QR vale pra ETIQUETA. No modo
      // 'bipagem' a tela espera o EAN DO PRODUTO — e embalagem costuma ter
      // o EAN em codigo de barras e algum QR de propaganda ao lado. Preferir
      // o QR ali ignoraria o EAN valido e mandaria numero errado pra busca.
      const qr = codes.find(c => c.format === 'qr_code');
      // v3.34.2 (Codex): o detector pede code_128, code_39, itf e pdf417
      // alem do EAN. Se a embalagem mostrar um desses ANTES do ean_13, o
      // "primeiro nao-QR" pegava o valor errado, era recusado, e no quadro
      // seguinte pegava o mesmo de novo — o EAN ao lado ficava inalcancavel.
      // v3.34.3 (Codex): a prioridade do EAN vale SO no modo produto. Em
      // modo etiqueta, se a camera pegar o EAN do produto junto com o
      // codigo da etiqueta dos Correios (Code 128), preferir o EAN mandaria
      // o codigo do PRODUTO em vez do identificador da devolucao.
      const ean = codes.find(c => c.format === 'ean_13' || c.format === 'ean_8');
      const naoQr = codes.find(c => c.format !== 'qr_code');
      const barras = (scannerModo === 'bipagem') ? (ean || naoQr) : naoQr;
      const escolhido = (scannerModo === 'bipagem')
        ? (barras || qr || codes[0])     // produto: EAN na frente
        : (qr || barras || codes[0]);    // etiqueta: QR na frente
      let raw = String(escolhido.rawValue || '').trim();

      // v3.34 - o QR da Magalu e um JSON, e o do ML tambem. Quem sabe ler
      // isso e o interpretarCodigoLido, do leitor de imagem — a MESMA
      // funcao, nao uma copia (duplicar foi o que gerou metade dos bugs de
      // hoje). Se ele nao reconhecer o formato, usa o que veio, e o
      // servidor decide.
      // v3.34.2 (Codex): NUMA ETIQUETA, ESPERA O QR APARECER.
      //
      // O QR da Magalu e pequeno e o codigo de barras e grande: eles nem
      // sempre entram no mesmo detect(). Sem isto, o primeiro quadro que
      // pega so o de barras aceitava o RASTREIO e ja disparava a busca —
      // o scanner nunca olhava o quadro seguinte, onde o QR apareceria.
      // Ou seja, o bug que este PR veio consertar continuaria acontecendo,
      // so que por timing.
      //
      // Entao: em modo etiqueta, se veio SO codigo de barras, deixa
      // algumas frames pro QR aparecer antes de aceitar. Passado isso, o
      // de barras vale — etiqueta que so tem ele nao pode travar o
      // estoquista.
      if (scannerModo !== 'bipagem' && !qr && barras) {
        scannerEsperasSemQr = (scannerEsperasSemQr || 0) + 1;
        if (scannerEsperasSemQr < 12) return;   // ~12 quadros, menos de 1s
      } else {
        scannerEsperasSemQr = 0;
      }

      let jaResolvido = false;
      try {
        if (scannerModo !== 'bipagem' && typeof window.interpretarCodigoLido === 'function') {
          const lido = window.interpretarCodigoLido(raw);
          // v3.34.2 (Codex): QR de texto SOLTO (propaganda, wifi, link) sempre
          // "resolvia", porque o interpretador devolve o proprio conteudo pra
          // qualquer texto. Numa etiqueta com QR desses ao lado do codigo de
          // barras, o texto ganhava — e se tivesse 9 a 44 caracteres, ia pra
          // busca como se fosse identificador.
          // v3.34.3 (Codex): "codigo do QR" e o tipo tanto do texto solto
          // quanto da URL de onde a gente EXTRAIU um identificador. So o
          // primeiro e generico: se o valor devolvido difere do texto lido,
          // o interpretador achou algo ali dentro e isso vale mais que o
          // codigo de barras ao lado.
          const extraiuAlgo = lido && String(lido.valor || '') !== String(raw || '');
          const qrGenerico = lido && lido.tipo === 'codigo do QR'
            && !extraiuAlgo
            && !/^\{/.test(String(lido.valor || ''));
          if (qrGenerico && barras) {
            raw = String(barras.rawValue || raw).trim();
          } else if (lido && lido.valor) {
            raw = String(lido.valor).trim();
            // v3.34.1 (Codex): o payload do MAGALU nao pode passar pela
            // limpeza generica do processarBipagemEtiqueta. Aquela funcao so
            // sabe extrair JSON do ML (procura `id`); o JSON do Magalu
            // sobrevive inteiro, vira uma string alfanumerica de 61
            // caracteres e e RECUSADA pelo limite de 44 antes de chegar na
            // busca. Ou seja: sem isto, o caminho da camera nao acharia
            // devolucao Magalu nenhuma — justamente o que este PR veio
            // consertar.
            //
            // Quando o interpretador ja resolveu, vai DIRETO pra busca.
            // v3.34.3 (Codex): JSON do MERCADO LIVRE ({"id":"474...","t":"lm"})
            // nao pode ir cru pra busca. A rota principal ate sabe ler, mas
            // o campo da tela fica com o JSON inteiro e o resto do fluxo
            // (historico, re-busca) trabalha com aquilo. O
            // processarBipagemEtiqueta ja extraia o `id`; aqui a gente faz o
            // mesmo antes de desviar.
            const mIdML = String(lido.valor).match(/["']?id["']?\s*[:=]\s*["']?(\d{8,20})/i);
            if (mIdML) raw = mIdML[1];

            // so o payload do MAGALU precisa pular a limpeza (o dela e o
            // unico que a limpeza destroi)
            // so pelo TIPO: repetir o nome do campo do Magalu aqui seria
            // duplicar o conhecimento que mora no interpretador — e
            // duplicacao foi a origem de metade dos bugs de hoje.
            jaResolvido = !mIdML && lido.tipo === 'pedido Magalu (do QR)';
          } else if (barras && qr) {
            // QR que nao soubemos ler: o de barras e a resposta desta etiqueta
            raw = String(barras.rawValue || raw).trim();
          }
        }
      } catch (e) { /* na duvida, segue com o codigo cru */ }
      // Evita ler 2x o mesmo em <4s
      if (raw !== scannerLastCode || Date.now() - scannerLastCodeAt > 4000) {
        scannerLastCode = raw;
        scannerLastCodeAt = Date.now();
        scannerPaused = true;
        if (scannerModo === 'bipagem') {
          processarLeituraBipagem(raw);
        } else if (jaResolvido) {
          // ja veio pronto do interpretador: NAO passa pela limpeza, que
          // destruiria o payload do Magalu (ver comentario acima).
          // Mesmo encerramento do processarBipagemEtiqueta: preenche o campo,
          // fecha a camera, tira o foco (senao abre o teclado no celular) e
          // dispara a busca.
          const campo = document.getElementById('codigo');
          if (campo) campo.value = raw;
          const st = document.getElementById('scannerStatus');
          if (st) {
            st.style.background = 'rgba(46,125,50,0.95)';
            st.textContent = '✅ Etiqueta lida — buscando...';
          }
          setTimeout(() => {
            fecharCameraScanner();
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
            if (typeof buscar === 'function') buscar();
          }, 800);
        } else {
          processarBipagemEtiqueta(raw);
        }
      }
    }
  }).catch(() => {}).finally(() => {
    if (scannerScanning) requestAnimationFrame(scannerLoop);
  });
}

// MODO ETIQUETA: bipou etiqueta -> preenche campo busca + buscar()
function processarBipagemEtiqueta(codigo) {
  const status = document.getElementById('scannerStatus');

  // Etiquetas ML são so digitos (ex: 46912301194). Pack IDs são 16 digitos (ex: 2000012153272513).
  // Se vier QR Code com JSON, tenta extrair id
  let codigoLimpo = codigo;
  try {
    const j = JSON.parse(codigo);
    if (j.id) codigoLimpo = String(j.id);
  } catch(e) {}

  // v3.20.4: QR das etiquetas ML = {"id":"47416667668","t":"lm"} -
  // extrai o id direto (vira busca de shipment limpa).
  let mQrML = String(codigoLimpo).match(/["']?[ïi]d["']?\s*[:=]\s*["']?(\d{8,20})/i);
  if (!mQrML && /^\{|"?t"?\s*[:=]\s*"?lm/i.test(String(codigoLimpo))) {
    const runs = String(codigoLimpo).match(/\d{8,20}/g) || [];
    if (runs.length === 1) mQrML = [null, runs[0]];
  }
  if (mQrML) codigoLimpo = mQrML[1];

  // v3.19.2: preserva LETRAS (tracking SPX da Shopee = BR...A/V/D).
  // Se vier QR com URL, extrai o token BR...; senao so tira simbolos.
  const mSpx = String(codigoLimpo).toUpperCase().match(/BR[A-Z0-9]{9,}/);
  if (mSpx) codigoLimpo = mSpx[0];
  codigoLimpo = String(codigoLimpo).replace(/[^0-9A-Za-z]/g, '');

  // Etiquetas validas: 9-44 chars (ML digitos, SPX BR..., chave DANFE 44)
  if (codigoLimpo.length < 9 || codigoLimpo.length > 44) {
    beepErro();
    status.style.background = 'rgba(198,40,40,0.95)';
    status.textContent = `❌ Codigo invalido: ${codigo.slice(0, 30)}`;
    // Volta a procurar depois de 2s
    setTimeout(() => {
      status.style.background = 'rgba(0,0,0,0.85)';
      status.textContent = 'Aponte para o codigo de barras';
      scannerPaused = false;
    }, 2000);
    return;
  }

  // OK!
  beepOk();
  status.style.background = 'rgba(46,125,50,0.95)';
  status.textContent = `✅ Lido: ${codigoLimpo}`;

  // Preenche o campo de busca
  const inp = document.getElementById('codigo');
  if (inp) {
    inp.value = codigoLimpo;
    // v3.14.8: tira foco do campo pra nao abrir teclado virtual no celular
    inp.blur();
  }

  setTimeout(() => {
    fecharCameraScanner();
    // v3.14.8: garante que o foco NAO volta pro campo (que abriria teclado)
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    // Dispara busca automatica
    if (typeof buscar === 'function') buscar();
  }, 800);
}

// MODO BIPAGEM: bipou EAN -> chama processarBipagem() do bipagem.js
// v3.14.9: scanner fica ABERTO entre leituras (pra bipar varias unidades em sequencia)
function processarLeituraBipagem(codigo) {
  const status = document.getElementById('scannerStatus');

  // EAN-13 ou EAN-8 - aceita qualquer string de digitos
  let codigoLimpo = codigo.replace(/[^0-9]/g, '');

  if (codigoLimpo.length < 8 || codigoLimpo.length > 14) {
    beepErro();
    status.style.background = 'rgba(198,40,40,0.95)';
    status.textContent = `❌ EAN invalido: ${codigo.slice(0, 20)}`;
    setTimeout(() => {
      status.style.background = 'rgba(0,0,0,0.85)';
      status.textContent = 'Aponte para o EAN do produto';
      scannerPaused = false;
    }, 1500);
    return;
  }

  // Salva contador antes da bipagem pra detectar se aumentou (= acerto)
  const bipadoAntes = (typeof bipagemEstado !== 'undefined') ? bipagemEstado.totalBipado : 0;

  // Chama o processador de bipagem (que valida o EAN, atualiza contadores, etc)
  if (typeof processarBipagem === 'function') {
    processarBipagem(codigoLimpo);
  }

  // Verifica resultado
  const bipadoDepois = (typeof bipagemEstado !== 'undefined') ? bipagemEstado.totalBipado : 0;
  const acertou = bipadoDepois > bipadoAntes;
  const completou = (typeof bipagemEstado !== 'undefined') &&
                    (bipagemEstado.totalBipado >= bipagemEstado.totalEsperado);

  if (completou) {
    // Completou! Fecha scanner
    status.style.background = 'rgba(46,125,50,0.95)';
    status.textContent = `✅ Completo! ${bipagemEstado.totalEsperado}/${bipagemEstado.totalEsperado}`;
    setTimeout(() => {
      fecharCameraScanner();
    }, 1000);
  } else if (acertou) {
    // Acertou mas ainda falta - libera scanner pra proxima leitura
    status.style.background = 'rgba(46,125,50,0.95)';
    status.textContent = `✅ ${bipagemEstado.totalBipado}/${bipagemEstado.totalEsperado} - bipe o proximo`;
    setTimeout(() => {
      status.style.background = 'rgba(0,0,0,0.85)';
      status.textContent = 'Aponte para o EAN do produto';
      scannerPaused = false;
    }, 1500);
  } else {
    // EAN errado - libera scanner pra tentar de novo
    status.style.background = 'rgba(245,124,0,0.95)';
    status.textContent = `⚠️ EAN nao confere com o esperado`;
    setTimeout(() => {
      status.style.background = 'rgba(0,0,0,0.85)';
      status.textContent = 'Aponte para o EAN do produto';
      scannerPaused = false;
    }, 1500);
  }
}

function fecharCameraScanner() {
  scannerScanning = false;
  scannerPaused = false;
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  const video = document.getElementById('scannerVideo');
  if (video) video.srcObject = null;
  document.getElementById('scannerOverlay').style.display = 'none';
  // v3.14.9: reset modo pro padrao (etiqueta)
  scannerModo = 'etiqueta';
}
