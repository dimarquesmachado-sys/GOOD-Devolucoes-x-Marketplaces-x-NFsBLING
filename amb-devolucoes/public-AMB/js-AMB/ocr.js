// ============================================================
// OCR DO REMETENTE (v3.31) - fotografa a etiqueta Correios e le o NOME
// ------------------------------------------------------------
// Fluxo: camera -> captura frame -> Tesseract.js (roda NO CELULAR,
// portugues) -> extrai o bloco REMETENTE -> mostra num campo EDITAVEL
// (OCR erra; o humano confere em 2s) -> "Buscar" joga na busca por
// nome que ja existe (colapso RENATONEVES == Renato Neves).
//
// Primeira leitura baixa o modelo (~15MB, fica em cache do navegador).
// Dica de uso: aproximar a camera SO do bloco REMETENTE - frame menor
// = leitura mais rapida e mais certeira.
// ============================================================

let ocrStream = null;
let ocrWorker = null;
let ocrCarregando = false;

const OCR_LIXO = /GOOD|IMPORT|MAGAZINE|DESTINAT|CORREIOS|SEDEX|PAC\b|REVERSO|ETICKET|E-TICKET|CONTROLE|CLIENTE|ASSINATURA|RECEBEDOR|DOCUMENTO|CEP|RUA\b|AV\b|AVENIDA|ALAMEDA|TRAVESSA|ESTRADA|PRACA|PRAÇA|BAIRRO|CENTRO|JARDIM|VILA\b|CIDADE|BRASIL|TABOAO|SERRA|OLIVEIRAS|RUSCITTO/i;

function ocrContaLetras(s) {
  return (String(s || '').match(/[A-Za-zÀ-ú]/g) || []).length;
}

// Extrai o nome do REMETENTE do texto cru do OCR.
// 1) linha do/apos "REMETENTE" (tolerante a erro de OCR: /REMET/)
// 2) fallback: melhor linha "so letras" que nao e lixo/endereco
function extrairRemetente(texto) {
  const linhas = String(texto || '').split(/\n+/).map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < linhas.length; i++) {
    if (/REMET/i.test(linhas[i])) {
      const mesma = linhas[i].replace(/.*REMET\w*[:.\s]*/i, '').trim();
      if (ocrContaLetras(mesma) >= 5 && !OCR_LIXO.test(mesma)) return mesma;
      for (let j = i + 1; j <= i + 2 && j < linhas.length; j++) {
        const cand = linhas[j].replace(/[^A-Za-zÀ-ú\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (ocrContaLetras(cand) >= 5 && !OCR_LIXO.test(cand)) return cand;
      }
    }
  }
  const candidatas = linhas
    .map(l => l.replace(/[^A-Za-zÀ-ú\s]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(l => ocrContaLetras(l) >= 8 && !OCR_LIXO.test(l) && !/\d/.test(l));
  return candidatas[0] || '';
}

async function abrirOcrRemetente() {
  const painel = document.getElementById('ocrPanel');
  if (!painel) return;
  painel.style.display = 'block';
  document.getElementById('ocrStatus').textContent = 'Abrindo camera...';
  document.getElementById('ocrNome').value = '';
  document.getElementById('ocrResultadoArea').style.display = 'none';
  try {
    ocrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 } },
      audio: false,
    });
    const video = document.getElementById('ocrVideo');
    video.srcObject = ocrStream;
    await video.play();
    document.getElementById('ocrStatus').textContent = '📷 Aproxima do bloco REMETENTE e captura';
  } catch (e) {
    document.getElementById('ocrStatus').textContent = '❌ Camera indisponivel: ' + (e.message || e);
  }
}

function fecharOcrRemetente() {
  const painel = document.getElementById('ocrPanel');
  if (painel) painel.style.display = 'none';
  if (ocrStream) { ocrStream.getTracks().forEach(t => t.stop()); ocrStream = null; }
}

async function garantirWorkerOcr(statusEl) {
  if (ocrWorker) return ocrWorker;
  if (ocrCarregando) { statusEl.textContent = '⏳ Leitor ja carregando...'; return null; }
  ocrCarregando = true;
  statusEl.textContent = '⬇️ Baixando o leitor (1a vez ~15MB, depois fica salvo)...';
  try {
    ocrWorker = await Tesseract.createWorker('por', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          statusEl.textContent = '🔎 Lendo... ' + Math.round((m.progress || 0) * 100) + '%';
        }
      },
    });
    return ocrWorker;
  } catch (e) {
    statusEl.textContent = '❌ Falha ao carregar o leitor: ' + (e.message || e);
    return null;
  } finally {
    ocrCarregando = false;
  }
}

async function capturarELerOcr() {
  const statusEl = document.getElementById('ocrStatus');
  const video = document.getElementById('ocrVideo');
  if (!video || !video.videoWidth) { statusEl.textContent = '❌ Camera ainda nao pronta'; return; }

  // captura o frame (limita a largura pra acelerar o OCR no celular)
  const escala = Math.min(1, 1280 / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * escala);
  canvas.height = Math.round(video.videoHeight * escala);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

  const worker = await garantirWorkerOcr(statusEl);
  if (!worker) return;

  statusEl.textContent = '🔎 Lendo...';
  try {
    const { data } = await worker.recognize(canvas);
    const nome = extrairRemetente(data && data.text);
    const area = document.getElementById('ocrResultadoArea');
    const campo = document.getElementById('ocrNome');
    if (nome) {
      campo.value = nome;
      area.style.display = 'block';
      statusEl.textContent = '✅ Nome lido — confere/corrige e busca:';
    } else {
      campo.value = '';
      area.style.display = 'block';
      statusEl.textContent = '⚠️ Nao achei o REMETENTE na foto. Aproxima mais do bloco e tenta de novo — ou digita o nome abaixo:';
    }
  } catch (e) {
    statusEl.textContent = '❌ Leitura falhou: ' + (e.message || e) + ' — tenta de novo';
  }
}

function buscarNomeDoOcr() {
  const nome = String(document.getElementById('ocrNome').value || '').trim();
  if (ocrContaLetras(nome) < 5) {
    document.getElementById('ocrStatus').textContent = '⚠️ Nome muito curto (minimo 5 letras)';
    return;
  }
  fecharOcrRemetente();
  const campo = document.getElementById('codigo');
  campo.value = nome;
  buscar();
}
