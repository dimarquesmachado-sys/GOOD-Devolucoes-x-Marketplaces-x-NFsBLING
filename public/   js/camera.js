// ============================================================
// camera.js - camera fullscreen pra tirar fotos do PROBLEMA
// ============================================================
// Tira no minimo 6 fotos e sobe pra Supabase em paralelo

let cameraStream = null;

async function abrirCamera() {
  // Fecha modal de descricao
  document.getElementById('modalProblema').classList.remove('show');
  // Abre overlay
  const overlay = document.getElementById('cameraOverlay');
  overlay.classList.add('show');
  atualizarCameraUI();

  const video = document.getElementById('cameraVideo');

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' }, // camera traseira
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    video.srcObject = cameraStream;
    await video.play().catch(() => {});
  } catch (err) {
    console.error('Camera error:', err);
    toast('Erro ao abrir camera: ' + err.message, 'err');
    // Fallback - usa input file
    fecharCamera();
    document.getElementById('modalProblema').classList.add('show');
    toast('Use upload manual', 'err');
  }
}

function fecharCamera(forcar) {
  const fotos = window.fotosUploadadas || [];
  const total = fotos.filter(f => !f.uploading && f.url).length;

  // Se ja tem fotos e nao chegou em 6, pergunta
  if (!forcar && total > 0 && total < 6) {
    if (!confirm(`Voce ja tirou ${total} foto${total === 1 ? '' : 's'}. Fechar agora vai DESCARTAR essas fotos. Continuar?`)) {
      return;
    }
    window.fotosUploadadas = []; // limpa
  }

  const overlay = document.getElementById('cameraOverlay');
  const video = document.getElementById('cameraVideo');

  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  video.srcObject = null;
  overlay.classList.remove('show');
}

function capturarFoto() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  const btn = document.getElementById('cameraCapture');

  // Verifica se video carregou
  if (!video.videoWidth || video.videoWidth < 100) {
    toast('Aguarde a camera carregar...', 'err');
    return;
  }

  // Anti clique duplo (debounce 600ms)
  if (btn.dataset.busy === 'true') return;
  btn.dataset.busy = 'true';
  setTimeout(() => { btn.dataset.busy = 'false'; }, 600);

  // Captura frame
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Feedback visual
  btn.style.transform = 'scale(0.85)';
  setTimeout(() => { btn.style.transform = ''; }, 150);

  // Converte pra blob e faz upload em segundo plano
  canvas.toBlob(async (blob) => {
    if (!blob) {
      toast('Erro ao capturar', 'err');
      return;
    }

    // Garante array global
    window.fotosUploadadas = window.fotosUploadadas || [];
    const idx = window.fotosUploadadas.length;
    window.fotosUploadadas.push({ url: null, uploading: true, blob });
    atualizarCameraUI();

    // Upload (em paralelo - usuario pode tirar mais fotos enquanto sobe)
    try {
      const formData = new FormData();
      formData.append('foto', blob, `foto-${Date.now()}.jpg`);
      const r = await fetch('/api/triagem/upload-foto', {
        method: 'POST',
        body: formData,
      });
      const d = await r.json();
      if (d.ok && d.url) {
        window.fotosUploadadas[idx] = { url: d.url, uploading: false };
      } else {
        window.fotosUploadadas.splice(idx, 1);
        toast('Erro ao subir foto: ' + (d.erro || 'falha'), 'err');
      }
    } catch (err) {
      window.fotosUploadadas.splice(idx, 1);
      toast('Erro ao subir foto', 'err');
    }
    atualizarCameraUI();
  }, 'image/jpeg', 0.85);
}

function removerFotoCamera(idx) {
  if (!window.fotosUploadadas) return;
  window.fotosUploadadas.splice(idx, 1);
  atualizarCameraUI();
}

function atualizarCameraUI() {
  const fotos = window.fotosUploadadas || [];
  const total = fotos.filter(f => !f.uploading && f.url).length;
  const subindo = fotos.filter(f => f.uploading).length;

  // Contador
  const counter = document.getElementById('cameraCounter');
  if (total >= 6) {
    counter.textContent = `✅ ${total} fotos${subindo ? ` (+${subindo} subindo...)` : ''}`;
  } else {
    counter.textContent = `${total} foto${total === 1 ? '' : 's'} · faltam ${Math.max(0, 6 - total)} pra completar 6${subindo ? ` (${subindo} subindo)` : ''}`;
  }

  // Botao captura - muda cor quando completo
  const btnCapture = document.getElementById('cameraCapture');
  if (total >= 6) btnCapture.classList.add('completo');
  else btnCapture.classList.remove('completo');

  // Botao finalizar - SO libera com >=6 fotos prontas (sem upload pendente)
  const btnFinalizar = document.getElementById('cameraFinalizar');
  btnFinalizar.disabled = total < 6 || subindo > 0;
  if (subindo > 0) {
    btnFinalizar.innerHTML = '<span class="spinner-mini"></span>Subindo...';
  } else if (total >= 6) {
    btnFinalizar.innerHTML = `📨 Enviar (${total} fotos)`;
  } else {
    btnFinalizar.innerHTML = `🔒 Faltam ${6 - total}`;
  }

  // Hint
  const hint = document.getElementById('cameraHint');
  if (total >= 6) {
    hint.textContent = '✅ Minimo atingido. Pode tirar mais ou clicar Enviar';
  } else if (total >= 1) {
    hint.textContent = `Faltam ${6 - total} fotos pra completar 6`;
  } else {
    hint.textContent = 'Toque pra fotografar - sequencia: caixa, produto, etiqueta';
  }

  // Thumbnails
  const thumbs = document.getElementById('cameraThumbs');
  thumbs.innerHTML = fotos.map((f, i) => {
    const numHtml = `<span class="num">${i + 1}</span>`;
    const delBtn = `<button class="del-thumb" onclick="removerFotoCamera(${i})">✕</button>`;
    if (f.uploading) {
      // Mostra placeholder durante upload (pode usar URL local do blob)
      let preview = '';
      try {
        preview = `<img src="${URL.createObjectURL(f.blob)}" alt="">`;
      } catch (e) {}
      return `<div class="camera-thumb">
        ${preview}
        ${numHtml}
        <div class="uploading-overlay"><div class="spinner-mini"></div></div>
      </div>`;
    }
    return `<div class="camera-thumb">
      <img src="${f.url}" alt="foto ${i+1}">
      ${numHtml}
      ${delBtn}
    </div>`;
  }).join('');
}

function finalizarFotos() {
  const fotos = window.fotosUploadadas || [];
  const fotosOk = fotos.filter(f => !f.uploading && f.url).map(f => f.url);
  if (fotosOk.length < 6) {
    toast(`Voce so tem ${fotosOk.length} fotos. MINIMO sao 6.`, 'err');
    return;
  }
  // Fecha camera (forcar=true pra nao perguntar) e envia
  fecharCamera(true);
  enviarProblema();
}
