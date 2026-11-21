// b744 - a linha `version` do /health carrega a descricao do build (e, por um tempo, a cadeia dos anteriores);
// a tela do estoquista mostra so "9.126.258 (b744)". Exportada no window pro teste executar.
function versaoCurta(v) {
  const t = String(v || '').trim();
  if (!t) return '?';
  const m = t.match(/^([0-9][^\s(]*)\s*\(\s*(b\d+)/);
  if (m) return m[1] + ' (' + m[2] + ')';
  return t.split(/[(;]/)[0].trim().slice(0, 40) || '?';
}
if (typeof window !== 'undefined') window.versaoCurta = versaoCurta;
// ============================================================
// auth.js - login, logout, checagem de sessao
// ============================================================

let usuarioLogado = null;

async function checarSessao() {
  try {
    const r = await fetch((window.APP_BASE || '') + '/api/auth/me');
    const d = await r.json();
    if (d.ok) {
      // Tanto admin quanto estoquista vao pra mesma tela
      // Admin so ve um botao extra "Painel Admin"
      usuarioLogado = d.usuario;
      // b778 - a tela de triagem mostra o "Sem fotos" do reportar problema SO pro admin (o servidor confere de novo)
      window.__ehAdmin = (d.tipo === 'admin');
      document.getElementById('userNome').textContent = d.usuario;

      // Mostra botao Admin se for admin
      const btnAdmin = document.getElementById('btnPainelAdmin');
      if (btnAdmin) {
        btnAdmin.style.display = (d.tipo === 'admin') ? 'inline-block' : 'none';
      }

      loginScreen.classList.remove('show');
      appContainer.style.display = '';
      inputCodigo.focus();

      fetch('/health').then(r => r.json()).then(d => {
        const span = document.getElementById('serverVersion');
        // b744 - so o NUMERO e o build na tela do estoquista; a descricao inteira do build fica no title (hover)
        if (span) { span.textContent = `server v${versaoCurta(d.version)}`; span.title = String(d.version || ''); }
      }).catch(() => {});
      return true;
    }
  } catch (e) {}

  // Sem sessao - mostra login
  loginScreen.classList.add('show');
  appContainer.style.display = 'none';
  // Foca direto no campo usuario pra agilizar
  setTimeout(() => document.getElementById('loginUser')?.focus(), 100);
  return false;
}

async function fazerLogin(e) {
  e.preventDefault();
  const usuario = document.getElementById('loginUser').value.trim();
  const senha = document.getElementById('loginPass').value;
  const erroEl = document.getElementById('loginErro');
  const btn = document.getElementById('btnLogin');

  erroEl.classList.remove('show');
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    const r = await fetch((window.APP_BASE || '') + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });
    const d = await r.json();

    if (d.ok) {
      // Tanto admin quanto estoquista vao pra mesma tela
      await checarSessao();
      // b220 (review do Codex) - o link "🔎 Abrir a venda" do recado abre
      // /amb/?bipe=<id>; se a sessao tinha expirado, a busca disparou antes
      // do login e levou 401. Agora, ao entrar, ela e refeita sozinha.
      if (window._bipePendente) {
        var alvo = window._bipePendente;
        window._bipePendente = null;
        var campo = document.getElementById('codigo');
        if (campo) campo.value = alvo;
        if (typeof buscar === 'function') setTimeout(buscar, 80);
      }
    } else {
      erroEl.textContent = d.erro || 'Erro ao logar';
      erroEl.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  } catch (err) {
    erroEl.textContent = 'Erro de conexao';
    erroEl.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

async function fazerLogout(e) {
  if (e) e.preventDefault();
  try {
    await fetch((window.APP_BASE || '') + '/api/auth/logout', { method: 'POST' });
  } catch (err) {}
  location.reload();
}
