// ============================================================
// helpers.js - utilitarios usados por todos os modulos
// ============================================================
// (nao depende de nenhum outro modulo - carrega 1o)

// ================ TOAST ================
let toastTimeout;
function toast(msg, tipo = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (tipo || '');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 3000);
}

// ================ FORMATADORES ================
function moeda(v) {
  if (v == null) return '-';
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',');
}

function dataFmt(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ================ SONS DE FEEDBACK ================
function beepOk() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 1000; osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(); osc.stop(ctx.currentTime + 0.15);
  } catch(e) {}
}

function beepErro() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 250; osc.type = 'square';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
  } catch(e) {}
}

// ================ TRADUTORES DE STATUS ML ================
function traduzirStatus(s) {
  return ({ paid:'✅ Paga', cancelled:'❌ Cancelada', pending:'⏳ Pendente', confirmed:'✅ Confirmada', invalid:'⚠️ Invalida' })[s] || s || '-';
}

function traduzirPagamento(s) {
  return ({ approved:'✅ Aprovado', refunded:'↩️ Estornado', cancelled:'❌ Cancelado', pending:'⏳ Pendente', rejected:'⚠️ Rejeitado' })[s] || s || '-';
}

function traduzirStatusEnvio(s) {
  return ({ delivered:'✅ Entregue', shipped:'🚚 Em transito', ready_to_ship:'📦 Pronto', pending:'⏳ Pendente', cancelled:'❌ Cancelado', not_delivered:'⚠️ Nao entregue' })[s] || s || '-';
}
