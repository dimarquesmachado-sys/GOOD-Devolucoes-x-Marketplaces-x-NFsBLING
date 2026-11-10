'use strict';
// lib/batimento-captura.js
//
// b674 - O BATIMENTO DA CAPTURA DE CADA EMPRESA, NUM LUGAR SO.
//
// ⚠️ POR QUE EXISTE
//
// A rota /api/admin/sonda-empresa/:chave so passava o batimento da GOOD
// (`CAPTURA_ESTADO` e variavel do server.js); pra Girassol/AMB a checagem
// "captura recente" caia no caminho de linha de comando e respondia "sem
// batimento do servidor — rode pela rota", mesmo rodando pela rota (visto em
// producao, 09/11). O estado da captura da fabrica vive dentro de cada
// instancia (CAPTURA.estado em app-AMB.js), com a MESMA forma da GOOD:
// { ultima, gravadas, erro }. Cada lado registra aqui um getter pela
// chaveDados (good / amb / girassol) e a sonda le qualquer empresa.
//
// Getter, nao valor: o estado e trocado inteiro a cada ciclo (`CAPTURA_ESTADO =
// {...}`); guardar o objeto congelaria a primeira foto.

const REGISTRO = new Map();   // chaveDados (minusculo) -> () => { ultima, gravadas, erro }

function registrarBatimento(empresa, getter) {
  if (!empresa || typeof getter !== 'function') return;
  REGISTRO.set(String(empresa).trim().toLowerCase(), getter);
}

function lerBatimento(empresa) {
  const g = REGISTRO.get(String(empresa || '').trim().toLowerCase());
  if (!g) return null;
  try { return g() || null; } catch (e) { return null; }
}

function empresasComBatimento() { return [...REGISTRO.keys()]; }

// b675 - PROVA VIVA DO BLING, pelo cliente da PROPRIA empresa.
//
// A sonda testava o access token lido do ambiente (a "sombra" do boot). O access
// do Bling vence em 6 h: numa empresa com pouco movimento (AMB) ele chegava
// vencido na sonda -> "HTTP 401 — credencial RECUSADA", enquanto a producao
// renova no primeiro 401 e segue (visto em 09/11). E a sonda NAO pode renovar por
// conta propria: o refresh do Bling e de uso unico — um segundo cliente
// renovando quebraria a cadeia do cliente vivo. Entao cada lado registra aqui
// uma funcao que faz UMA chamada de leitura pelo cliente vivo da empresa
// (`/situacoes/modulos`), com a renovacao da propria cadeia se precisar.
// Devolve { ok, status?, error? } como o cliente devolve.
const PROVAS_BLING = new Map();

function registrarProvaBling(empresa, fn) {
  if (!empresa || typeof fn !== 'function') return;
  PROVAS_BLING.set(String(empresa).trim().toLowerCase(), fn);
}

function provaBling(empresa) {
  return PROVAS_BLING.get(String(empresa || '').trim().toLowerCase()) || null;
}

// b676 - PROVA VIVA DA SHOPEE, pelo cliente da propria empresa (mesmo desenho da do Bling).
// A sonda dizia "Shopee: NAO VERIFICADO (proxy configurado; a loja e conferida no /status)"
// — o unico canal que ela nao provava. O cliente vivo de cada empresa ja faz a chamada
// barata e certa: `buscarDevolucoesProxy(false)` (cache de 5 min; senao UMA chamada ao
// shopee-nf-sync com a loja da ficha e a chave interna; nada de Bling). Ela prova URL,
// chave e loja cadastrada no proxy. Devolve a lista (array) ou lanca com o motivo.
const PROVAS_SHOPEE = new Map();

function registrarProvaShopee(empresa, fn) {
  if (!empresa || typeof fn !== 'function') return;
  PROVAS_SHOPEE.set(String(empresa).trim().toLowerCase(), fn);
}

function provaShopee(empresa) {
  return PROVAS_SHOPEE.get(String(empresa || '').trim().toLowerCase()) || null;
}

module.exports = { registrarBatimento, lerBatimento, empresasComBatimento, registrarProvaBling, provaBling, registrarProvaShopee, provaShopee };
