// ============================================================
// app.js - entry point
// ============================================================
// Carrega POR ULTIMO. Define refs globais do DOM,
// liga event listeners e dispara checagem de sessao.

// ================ REFERENCIAS DO DOM ================
// Compartilhadas com auth.js, busca.js, triagem.js
const inputCodigo = document.getElementById('codigo');
const btnBuscar = document.getElementById('btnBuscar');
const divLoading = document.getElementById('loading');
const divResultado = document.getElementById('resultado');
const loginScreen = document.getElementById('loginScreen');
const appContainer = document.getElementById('appContainer');

// ================ ESTADO GLOBAL ================
// Compartilhado com camera.js
window.fotosUploadadas = [];

// ================ EVENT LISTENERS ================
// Enter no campo de busca dispara buscar()
inputCodigo.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); buscar(); }
});

// Ao carregar a pagina, checa se ja tem sessao
window.addEventListener('load', checarSessao);

// ================ MODAIS: TECLADO E FOCO (b767, V-08) ================
// Nenhum modal tratava Esc, o foco ficava atras do modal e o Tab saia dele. Uma peca so, pra TODOS os
// `.modal-bg` e a `.camera-overlay` (triagem, defeito, cola-bipe, localizacao, camera): ao abrir (classe `show`), guarda quem
// tinha o foco e foca o primeiro campo/botao do modal; Tab/Shift+Tab circulam dentro; Esc fecha o modal de cima
// (o da camera pela propria fecharCamera, que confirma se ha foto pendente); ao fechar, o foco volta pra quem abriu.
(function modaisAcessiveis() {
  const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const origem = new WeakMap();   // modal -> elemento que tinha o foco antes de abrir
  const visiveis = (modal) => Array.from(modal.querySelectorAll(FOCAVEIS)).filter((el) => el.offsetParent !== null || el === document.activeElement);
  const abertos = () => Array.from(document.querySelectorAll('.modal-bg.show, .camera-overlay.show'));
  const deCima = () => { const a = abertos(); return a.length ? a[a.length - 1] : null; };

  function aoAbrir(modal) {
    if (!origem.has(modal)) origem.set(modal, document.activeElement);
    const alvo = visiveis(modal).find((el) => !/fechar|cancelar|close/i.test(el.textContent || '')) || visiveis(modal)[0];
    if (alvo && !modal.contains(document.activeElement)) { try { alvo.focus({ preventScroll: true }); } catch (e) { /* sem foco possivel */ } }
  }
  function aoFechar(modal) {
    const volta = origem.get(modal); origem.delete(modal);
    if (volta && typeof volta.focus === 'function' && document.contains(volta) && !abertos().length) { try { volta.focus({ preventScroll: true }); } catch (e) { /* idem */ } }
  }
  function fecharDeCima(modal) {
    if (modal.id === 'cameraOverlay' && typeof fecharCamera === 'function') return fecharCamera();
    if (modal.id === 'modalColaBipe' && typeof fecharColaBipe === 'function') return fecharColaBipe();
    modal.classList.remove('show');
  }

  const observador = new MutationObserver((mutacoes) => {
    for (const m of mutacoes) {
      const el = m.target;
      if (!(el instanceof Element) || !(el.classList.contains('modal-bg') || el.classList.contains('camera-overlay'))) continue;
      const aberto = el.classList.contains('show');
      const estava = /\bshow\b/.test(m.oldValue || '');
      if (aberto && !estava) aoAbrir(el);
      else if (!aberto && estava) aoFechar(el);
    }
  });
  observador.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });

  document.addEventListener('keydown', (e) => {
    const modal = deCima();
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); fecharDeCima(modal); return; }
    if (e.key !== 'Tab') return;
    const lista = visiveis(modal);
    if (!lista.length) { e.preventDefault(); return; }
    const primeiro = lista[0]; const ultimo = lista[lista.length - 1];
    if (!modal.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? ultimo : primeiro).focus(); return; }
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  }, true);
  window.__modaisAcessiveis = { abertos, deCima };   // pro teste de navegador
})();
