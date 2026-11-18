// ============================================================
// camera.js - camera fullscreen pra tirar fotos do PROBLEMA
// v3.17.0 - tambem suporta fluxo de DEVOLUCAO PARCIAL (interceptado em finalizarFotos)
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

// v3.17.0 - Versao especial pra abrir camera direto pelo fluxo PARCIAL
// (sem precisar do modalProblema antes)
async function abrirCameraParaParcial() {
  const overlay = document.getElementById('cameraOverlay');
  overlay.classList.add('show');
  atualizarCameraUI();

  const video = document.getElementById('cameraVideo');

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
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
    fecharCamera();
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
    // v3.17.0/v3.18.0: se cancelar fluxo parcial OU divergente, limpa as flags
    window._fluxoParcial = false;
    window._fluxoDivergente = false;
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
    // b716 (P1-07, auditoria do Codex 15/11) - a foto e um OBJETO com identidade, nao uma POSICAO. O callback do upload
    // escrevia o resultado na POSICAO idx do array: se o estoquista fechasse a triagem e abrisse outra enquanto a foto subia
    // (o array e trocado em 9 pontos do triagem.js), a resposta antiga entrava no pacote NOVO — foto de A no card de B,
    // e um upload fantasma que nunca saia de "subindo". Agora a resposta so atualiza a entrada que a originou, e so se
    // ela ainda estiver na lista corrente.
    const entrada = registrarFotoPendente(window.fotosUploadadas, blob);
    atualizarCameraUI();

    // Upload (em paralelo - usuario pode tirar mais fotos enquanto sobe)
    let resultado = null;
    try {
      const formData = new FormData();
      formData.append('foto', blob, `foto-${Date.now()}.jpg`);
      const r = await fetch((window.APP_BASE || '') + '/api/triagem/upload-foto', {
        method: 'POST',
        body: formData,
      });
      resultado = await r.json();
    } catch (err) {
      resultado = null;
    }
    const estado = concluirUploadDeFoto(entrada, resultado);
    if (estado === 'falhou') toast('Erro ao subir foto' + (resultado && resultado.erro ? ': ' + resultado.erro : ''), 'err');
    if (estado !== 'descartado') atualizarCameraUI();   // resposta de um fluxo que ja fechou nao redesenha o atual
  }, 'image/jpeg', 0.85);
}

// b716 (P1-07) - identidade das fotos: cada entrada tem um id proprio; a conclusao do upload acha a entrada por
// IDENTIDADE na lista CORRENTE (window.fotosUploadadas). Lista trocada (outra triagem) ou foto removida enquanto
// subia = 'descartado': nem grava, nem mexe no fluxo novo.
let _seqFotoCamera = 0;
function registrarFotoPendente(lista, blob) {
  const entrada = { id: 'foto-' + (++_seqFotoCamera) + '-' + Date.now().toString(36), url: null, uploading: true, blob, previewUrl: null };
  lista.push(entrada);
  return entrada;
}
// b761 (V-08): o preview da foto pendente e UM blob: URL por foto, criado uma vez e REVOGADO quando a foto deixa
// de estar pendente (subiu, falhou, foi removida ou o fluxo trocou). Antes, cada redesenho da tira de miniaturas
// criava um createObjectURL novo e nenhum era revogado — num turno de centenas de fotos o navegador do celular
// segurava todos os blobs ate a aba fechar.
function previewDaFotoPendente(entrada) {
  if (!entrada.previewUrl) {
    try { entrada.previewUrl = URL.createObjectURL(entrada.blob); } catch (e) { entrada.previewUrl = null; }
  }
  return entrada.previewUrl;
}
function soltarPreview(entrada) {
  if (entrada && entrada.previewUrl) {
    try { URL.revokeObjectURL(entrada.previewUrl); } catch (e) { /* ja revogado */ }
    entrada.previewUrl = null;
  }
}
function concluirUploadDeFoto(entrada, resultado) {
  soltarPreview(entrada);   // subiu, falhou ou foi descartada: o blob local nao serve mais
  const lista = window.fotosUploadadas || [];
  const i = lista.indexOf(entrada);
  if (i < 0) return 'descartado';
  if (resultado && resultado.ok && resultado.url) {
    entrada.url = resultado.url;
    entrada.uploading = false;
    return 'ok';
  }
  lista.splice(i, 1);
  return 'falhou';
}

function removerFotoCamera(idx) {
  if (!window.fotosUploadadas) return;
  const [removida] = window.fotosUploadadas.splice(idx, 1);
  soltarPreview(removida);
  atualizarCameraUI();
}

function atualizarCameraUI() {
  const fotos = window.fotosUploadadas || [];
  const total = fotos.filter(f => !f.uploading && f.url).length;
  const subindo = fotos.filter(f => f.uploading).length;

  // v3.17.0 - texto adapta se for fluxo parcial
  const ehParcial = !!window._fluxoParcial;
  // v3.18.0 - novo: fluxo divergente usa minimo 3 fotos
  const ehDivergente = !!window._fluxoDivergente;
  const minFotos = ehDivergente ? 3 : 6;

  // Contador
  const counter = document.getElementById('cameraCounter');
  if (total >= minFotos) {
    counter.textContent = `✅ ${total} fotos${subindo ? ` (+${subindo} subindo...)` : ''}`;
  } else {
    counter.textContent = `${total} foto${total === 1 ? '' : 's'} · faltam ${Math.max(0, minFotos - total)} pra completar ${minFotos}${subindo ? ` (${subindo} subindo)` : ''}`;
  }

  // Botao captura - muda cor quando completo
  const btnCapture = document.getElementById('cameraCapture');
  if (total >= minFotos) btnCapture.classList.add('completo');
  else btnCapture.classList.remove('completo');

  // Botao finalizar - SO libera com >=minFotos prontas (sem upload pendente)
  const btnFinalizar = document.getElementById('cameraFinalizar');
  btnFinalizar.disabled = total < minFotos || subindo > 0;
  if (subindo > 0) {
    btnFinalizar.innerHTML = '<span class="spinner-mini"></span>Subindo...';
  } else if (total >= minFotos) {
    btnFinalizar.innerHTML = (ehParcial || ehDivergente)
      ? `▶️ Continuar (${total} fotos)`
      : `📨 Enviar (${total} fotos)`;
  } else {
    btnFinalizar.innerHTML = `🔒 Faltam ${minFotos - total}`;
  }

  // Hint
  const hint = document.getElementById('cameraHint');
  if (total >= minFotos) {
    hint.textContent = (ehParcial || ehDivergente)
      ? '✅ Mínimo atingido. Pode tirar mais ou clicar Continuar'
      : '✅ Minimo atingido. Pode tirar mais ou clicar Enviar';
  } else if (total >= 1) {
    hint.textContent = `Faltam ${minFotos - total} fotos pra completar ${minFotos}`;
  } else if (ehDivergente) {
    hint.textContent = 'Sequência: produto recebido, NF, etiqueta';
  } else if (ehParcial) {
    hint.textContent = 'Sequência: 1 do pacote, 1 da etiqueta, 4 do(s) produto(s)';
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
      const urlPreview = previewDaFotoPendente(f);   // b761: um blob: por foto, nao um por redesenho
      const preview = urlPreview ? `<img src="${urlPreview}" alt="">` : '';
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

// v3.17.0/3.18.0 - finalizarFotos bifurca: parcial OU divergente OU problema
function finalizarFotos() {
  const fotos = window.fotosUploadadas || [];
  const fotosOk = fotos.filter(f => !f.uploading && f.url).map(f => f.url);

  // v3.18.0 - minimo varia conforme fluxo
  const ehDivergente = !!window._fluxoDivergente;
  const minFotos = ehDivergente ? 3 : 6;

  if (fotosOk.length < minFotos) {
    toast(`Voce so tem ${fotosOk.length} fotos. MINIMO sao ${minFotos}.`, 'err');
    return;
  }
  // Fecha camera (forcar=true pra nao perguntar)
  fecharCamera(true);

  // v3.17.0 / v3.18.0 - bifurca fluxo
  if (window._fluxoParcial) {
    abrirConfirmacaoParcial(fotosOk);
  } else if (window._fluxoDivergente) {
    abrirConfirmacaoDivergente(fotosOk);
  } else {
    enviarProblema();
  }
}
