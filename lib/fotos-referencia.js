'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  lib/fotos-referencia.js — b706 (P1-01 do ROTEIRO-LIQUIDACAO-2026-11)
//
//  A referencia de uma foto de triagem e a URL PUBLICA que o proprio servidor devolveu no
//  /api/triagem/upload-foto: `https://<projeto>.supabase.co/storage/v1/object/public/<bucket>/<caminho>`.
//  Ate o b705 as rotas de escrita (aprovar, problema, divergente, consertado, defeitos/adicionar — nas
//  3 empresas) gravavam QUALQUER string que viesse no array de fotos, e o painel montava essa string
//  dentro de atributo HTML e de onclick. Aqui a porta fecha: so entra o que tem a forma do upload.
//
//  Peca unica: a GOOD (server.js) e a fabrica (compat-AMB.js) usam o mesmo middleware.
// ════════════════════════════════════════════════════════════════════════════

const CAMPOS_DE_FOTOS = ['fotos', 'fotos_parcial', 'problema_fotos', 'problemaFotos'];
const TAMANHO_MAXIMO = 1000;
// caracteres que uma URL de upload deste servidor pode ter — nada de aspas, espaco, <, >, =, ?, # ou crase
const CARACTERES = /^[A-Za-z0-9:/._%@~-]+$/;
const SEGMENTO = /^[A-Za-z0-9._%@~-]+$/;

function hostsPermitidos() {
  const hosts = new Set();
  for (const [k, v] of Object.entries(process.env)) {
    if (!/SUPABASE_URL$/.test(k) || !v) continue;
    try { hosts.add(new URL(v).hostname.toLowerCase()); } catch (e) { /* env torta nao abre porta nenhuma */ }
  }
  return hosts;
}

function bucketsPermitidos() {
  const buckets = new Set(['fotos-problema']);
  for (const [k, v] of Object.entries(process.env)) if (/FOTOS_BUCKET$/.test(k) && v) buckets.add(String(v));
  return buckets;
}

/** true so pra URL publica de objeto no bucket de fotos de um Supabase configurado neste servico. */
function ehReferenciaDeFoto(v) {
  if (typeof v !== 'string' || !v || v.length > TAMANHO_MAXIMO || !CARACTERES.test(v)) return false;
  let u;
  try { u = new URL(v); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.search !== '' || u.hash !== '' || u.username || u.password) return false;
  if (!hostsPermitidos().has(u.hostname.toLowerCase())) return false;
  const partes = u.pathname.split('/');
  // ['', 'storage', 'v1', 'object', 'public', bucket, ...caminho]
  if (partes.length < 7 || partes[1] !== 'storage' || partes[2] !== 'v1' || partes[3] !== 'object' || partes[4] !== 'public') return false;
  if (!bucketsPermitidos().has(partes[5])) return false;
  const caminho = partes.slice(6);
  return caminho.every((s) => SEGMENTO.test(s) && s !== '.' && s !== '..');
}

/**
 * Devolve { campo, posicao } da primeira referencia invalida no corpo (olha o envelope `dados` e a raiz,
 * nos 4 nomes que a tela usa), ou null se tudo e foto. Campo que nao e lista fica pra rota tratar, como antes.
 */
function primeiraFotoInvalida(body) {
  const fontes = [];
  if (body && typeof body === 'object') {
    if (body.dados && typeof body.dados === 'object') fontes.push(body.dados);
    fontes.push(body);
  }
  for (const b of fontes) {
    for (const campo of CAMPOS_DE_FOTOS) {
      const lista = b[campo];
      if (!Array.isArray(lista)) continue;
      for (let i = 0; i < lista.length; i++) {
        if (lista[i] == null || lista[i] === '') continue;   // a fabrica ja filtra falsy; aqui nao e o lugar de recusar
        if (!ehReferenciaDeFoto(lista[i])) return { campo, posicao: i };
      }
    }
  }
  return null;
}

/** Express: 400 se alguma foto do corpo nao veio do upload deste servidor. Nao devolve o valor recusado. */
function exigirFotosValidas(req, res, next) {
  const ruim = primeiraFotoInvalida(req.body);
  if (!ruim) return next();
  return res.status(400).json({
    ok: false,
    erro: 'referencia de foto invalida: a foto precisa ser a URL devolvida pelo upload deste servidor',
    campo: ruim.campo,
    posicao: ruim.posicao,
  });
}

/**
 * O nome do usuario vira PASTA no caminho do upload. Codex (#577): `getPublicUrl` nao codifica `+` nem `'`, entao um
 * login com esses caracteres gerava uma URL que o proprio validador recusa. A pasta usa so caracteres de URL; o
 * login continua sendo o que e (so o caminho muda). Vazio vira 'usuario'.
 */
function nomeDePastaSeguro(usuario) {
  const limpo = String(usuario == null ? '' : usuario).replace(/[^A-Za-z0-9._@-]/g, '_').replace(/^\.+$/, '_');
  return limpo || 'usuario';
}

module.exports = { ehReferenciaDeFoto, primeiraFotoInvalida, exigirFotosValidas, nomeDePastaSeguro, CAMPOS_DE_FOTOS };
