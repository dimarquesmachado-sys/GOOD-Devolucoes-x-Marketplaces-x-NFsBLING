// ============================================================
// scanner.js - camera mobile pra bipar etiqueta de devolucao
// ============================================================
// Licoes Girassol: pausa entre leituras, lastCode pra evitar dupla, BarcodeDetector

let scannerStream = null;
let scannerDetector = null;
let scannerScanning = false;
let scannerPaused = false;
let scannerLastCode = '';
let scannerLastCodeAt = 0;

async function abrirCameraScanner() {
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
      const raw = String(codes[0].rawValue).trim();
      // Evita ler 2x o mesmo em <4s
      if (raw !== scannerLastCode || Date.now() - scannerLastCodeAt > 4000) {
        scannerLastCode = raw;
        scannerLastCodeAt = Date.now();
        scannerPaused = true;
        processarBipagemEtiqueta(raw);
      }
    }
  }).catch(() => {}).finally(() => {
    if (scannerScanning) requestAnimationFrame(scannerLoop);
  });
}

function processarBipagemEtiqueta(codigo) {
  const status = document.getElementById('scannerStatus');

  // Etiquetas ML são so digitos (ex: 46912301194). Pack IDs são 16 digitos (ex: 2000012153272513).
  // Se vier QR Code com JSON, tenta extrair id
  let codigoLimpo = codigo;
  try {
    const j = JSON.parse(codigo);
    if (j.id) codigoLimpo = String(j.id);
  } catch(e) {}

  // Tira espaços, hifens e caracteres não numéricos
  codigoLimpo = codigoLimpo.replace(/[^0-9]/g, '');

  // Etiquetas válidas: 9-20 dígitos
  if (codigoLimpo.length < 9 || codigoLimpo.length > 20) {
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

  // Preenche o campo de busca + fecha camera + dispara busca
  const inp = document.getElementById('codigo');
  if (inp) inp.value = codigoLimpo;

  setTimeout(() => {
    fecharCameraScanner();
    // Dispara busca automatica
    if (typeof buscar === 'function') buscar();
  }, 800);
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
}
