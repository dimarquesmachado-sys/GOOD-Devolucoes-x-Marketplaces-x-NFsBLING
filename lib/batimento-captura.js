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

module.exports = { registrarBatimento, lerBatimento, empresasComBatimento };
