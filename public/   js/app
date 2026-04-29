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
