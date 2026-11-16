'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  lib/cabecalhos-seguranca.js — b708 (V-05 do ROTEIRO-LIQUIDACAO-2026-11, etapa 2 "iniciar CSP compativel")
//
//  O servico e UM so pras 3 empresas (a GOOD hospeda; /amb e /girassol montam no mesmo app), entao os cabecalhos
//  entram uma vez, antes de tudo, e valem pra todas — e pra qualquer CNPJ futuro.
//
//  Duas camadas, de proposito:
//   1. O QUE NAO QUEBRA NADA, ja em vigor: nosniff, referrer, nao ser emoldurado por outro site, `object-src 'none'`,
//      `base-uri 'self'`, `form-action 'self'`. Nenhuma tela usa <object>, <base>, formulario pra fora ou iframe de
//      terceiro — e cada uma dessas e uma porta a menos pra quem conseguir injetar algo.
//   2. A POLITICA COMPLETA em MODO RELATO (Content-Security-Policy-Report-Only): o navegador NAO bloqueia, so avisa
//      em POST /api/csp-relato o que bloquearia. A auditoria do Codex pediu CSP "depois de testar compatibilidade
//      com os scripts legados": as telas tem ~140 handlers inline, Tesseract (worker em blob + wasm), QZ Tray
//      (websocket em localhost), fotos de produto de meia duzia de hosts. Impor isso as cegas derrubaria o bipe.
//      Primeiro medir (contagem por diretiva e host em /health → `csp`), depois apertar, fatia a fatia.
//
//  O relato NAO guarda URL completa (pode trazer ?k= ou token) — so o host da origem bloqueada e a diretiva.
// ════════════════════════════════════════════════════════════════════════════

const ROTA_RELATO = '/api/csp-relato';

// camada 1 — vale em todo lugar
const CSP_EM_VIGOR = "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

// camada 2 — o que se pretende impor um dia; hoje so relata
const CSP_RELATO = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss://localhost:* ws://localhost:*",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  'report-uri ' + ROTA_RELATO,
].join('; ');

const TETO_CHAVES = 200;

function criar() {
  const relatos = new Map();   // "diretiva | host" -> contagem
  let descartados = 0;
  let total = 0;
  let ultimo = null;

  function middleware(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', CSP_EM_VIGOR);
    res.setHeader('Content-Security-Policy-Report-Only', CSP_RELATO);
    next();
  }

  function hostDe(v) {
    const s = String(v || '');
    if (!s || s === 'inline' || s === 'eval' || s === 'self' || s === 'data' || s === 'blob' || s === 'wasm-eval') return s || '(vazio)';
    try { return new URL(s).host || s.slice(0, 40); } catch (e) { return s.replace(/[?#].*$/, '').slice(0, 40); }
  }

  /** Recebe o relato do navegador (formato `csp-report` legado e o novo `reports`). Nunca guarda a URL inteira. */
  function registrar(corpo) {
    const itens = [];
    if (corpo && corpo['csp-report']) itens.push(corpo['csp-report']);
    if (Array.isArray(corpo)) for (const r of corpo) if (r && r.body) itens.push(r.body);
    for (const it of itens) {
      const diretiva = String(it['effective-directive'] || it.effectiveDirective || it['violated-directive'] || it.violatedDirective || '?').split(' ')[0].slice(0, 40);
      const host = hostDe(it['blocked-uri'] || it.blockedURL);
      const chave = diretiva + ' | ' + host;
      total++;
      ultimo = new Date().toISOString();
      if (!relatos.has(chave) && relatos.size >= TETO_CHAVES) { descartados++; continue; }
      relatos.set(chave, (relatos.get(chave) || 0) + 1);
    }
    return itens.length;
  }

  function rotaRelato(req, res) {
    const n = registrar(req.body);
    res.status(204).end();
    return n;
  }

  function diagnostico() {
    const por_diretiva_e_host = {};
    for (const [k, v] of [...relatos.entries()].sort((a, b) => b[1] - a[1])) por_diretiva_e_host[k] = v;
    return { modo: 'relato (nao bloqueia)', em_vigor: CSP_EM_VIGOR, total, chaves: relatos.size, descartados, ultimo, por_diretiva_e_host };
  }

  return { middleware, registrar, rotaRelato, diagnostico, ROTA_RELATO, CSP_EM_VIGOR, CSP_RELATO };
}

module.exports = { criar, ROTA_RELATO, CSP_EM_VIGOR, CSP_RELATO };
