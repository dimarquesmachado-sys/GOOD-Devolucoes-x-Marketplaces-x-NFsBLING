'use strict';

/**
 * lib/drenagem.js — o processo que vai morrer para de trabalhar.
 * ---------------------------------------------------------------------
 * ⚠️ ÚLTIMO ITEM DO PARECER DE 09/09: "locks em `Map` não cobrem deploy com
 * duas instâncias. Em um deploy com instância antiga e nova sobrepostas,
 * ambas podem executar timers, receber 401 e tentar renovar."
 *
 * O QUE ACONTECE HOJE, num deploy:
 *   1. o Render sobe o processo NOVO
 *   2. o VELHO continua vivo por segundos até minutos
 *   3. os DOIS têm 8 rotinas de fundo rodando
 *   4. os DOIS podem tomar 401 e tentar renovar token
 *   5. os DOIS consomem a cota do Bling da mesma conta
 *
 * ⚠️ E o refresh do ML é de USO ÚNICO: se os dois renovarem, um consome o
 * do outro — a corrida que estamos matando entre serviços, acontecendo
 * DENTRO do mesmo serviço.
 *
 * ---------------------------------------------------------------------
 * O QUE ESTE MÓDULO FAZ, E O QUE NÃO FAZ
 *
 * FAZ: quando o Render manda `SIGTERM` (o aviso de "vou te matar"), as
 * rotinas de fundo param imediatamente. As requisições que já estão em voo
 * terminam — quem está bipando não perde o trabalho.
 *
 * NÃO FAZ: lease distribuído. O parecer sugeriu isso para o ML, e é o
 * desenho certo — mas depende do Mover-Pedidos, que é o dono eleito dos
 * tokens. Do lado daqui, parar de trabalhar ao receber o aviso resolve a
 * sobreposição de deploy, que é o caso concreto e frequente.
 *
 * ⚠️ E não é proteção contra escala horizontal (duas instâncias
 * permanentes). Se um dia houver, o lease vira obrigatório.
 */

let drenando = false;
let em = null;

const timers = new Set();
const paradas = [];

/**
 * Registra um timer para ser cancelado na drenagem.
 *
 * ⚠️ Use no lugar de `setInterval` direto. Um timer não registrado
 * continua rodando no processo que já deveria estar quieto — e é
 * exatamente o que causa a sobreposição.
 */
function intervalo(fn, ms) {
  const t = setInterval(() => {
    if (drenando) return;   // dupla trava: o timer pode disparar no meio
    fn();
  }, ms);
  timers.add(t);
  return t;
}

/** Idem para `setTimeout`. */
function daquiA(fn, ms) {
  const t = setTimeout(() => {
    if (drenando) return;
    fn();
  }, ms);
  timers.add(t);
  return t;
}

/**
 * Registra algo a ser chamado na drenagem — para módulos que têm o próprio
 * estado a encerrar (uma fila, um índice em construção).
 */
function aoDrenar(fn) {
  paradas.push(fn);
}

/** Está drenando? Rotinas longas devem consultar isto entre as páginas. */
function estaDrenando() {
  return drenando;
}

function diagnostico() {
  return {
    drenando,
    desde: em,
    timers_registrados: timers.size,
    _nota: 'ao receber SIGTERM as rotinas de fundo param; requisicoes em voo '
      + 'terminam. Evita que o processo velho e o novo trabalhem juntos '
      + 'durante o deploy — o refresh do ML e de uso unico.',
  };
}

/**
 * Liga a drenagem. Chamar UMA vez, no boot.
 *
 * ⚠️ NÃO chama `process.exit()`. Quem decide a hora de morrer é o Render;
 * matar o processo aqui derrubaria requisições em andamento — trocaria um
 * problema invisível por um visível no galpão.
 */
function ligar() {
  for (const sinal of ['SIGTERM', 'SIGINT']) {
    process.on(sinal, () => {
      if (drenando) return;
      drenando = true;
      em = new Date().toISOString();

      for (const t of timers) clearInterval(t);
      timers.clear();

      for (const fn of paradas) {
        try { fn(); } catch (e) { /* uma parada nao pode travar as outras */ }
      }

      console.log(`[drenagem] ${sinal} recebido — rotinas de fundo PARADAS. `
        + 'As requisicoes em voo terminam normalmente.');
    });
  }
}

module.exports = { ligar, intervalo, daquiA, aoDrenar, estaDrenando, diagnostico };
