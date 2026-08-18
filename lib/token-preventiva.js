// ═══════════════════════════════════════════════════════════════════
// RENOVAÇÃO PREVENTIVA DE TOKENS — peça ÚNICA, empresa como PARÂMETRO
//
// Pedido do Diego (18/08): "faz tudo, pensando q fique fácil conectar uma
// empresa no futuro tb. acho q é lib q chama".
//
// POR QUE ISTO EXISTE
// O access token se renova sozinho quando expira (o 401 dispara a troca).
// O risco está no REFRESH: ele tem validade própria (meses) e é de USO
// ÚNICO. Se um módulo ficar parado tempo demais, o refresh vence e só volta
// reautorizando A MÃO — no Magalu isso significa refazer o consentimento
// inteiro no navegador certo (client OAuth, redirect, 2FA, seletor de loja).
// Então renovamos de tempos em tempos mesmo sem uso.
//
// COMO ADICIONAR UMA EMPRESA NOVA
//   const { registrarPreventiva } = require('./token-preventiva');
//   registrarPreventiva({
//     empresa: 'girassol', integracao: 'ml',
//     temRefresh: () => !!REFRESH_TOKEN,
//     renovar: async () => await renovarToken(),   // true/false
//     persistiu: () => ultimaPersistencia,         // gravou de fato?
//     carimboEnv: 'GIRASSOL_ML_RENOVADO_EM',
//     diasEnv: 'GIRASSOL_ML_RENOVAR_DIAS',
//   });
// Nada mais: o registro entra no relatório de /tokens/preventiva sozinho.
//
// AS ARMADILHAS QUE ESTA LIB JÁ RESOLVE (custaram 4 rodadas de review):
//  · setInterval com dias estoura o limite de 32 bits do Node e vira 1ms —
//    30 dias viraria um LOOP contínuo queimando refresh de uso único.
//    Por isso: batimento de 1h que só age quando o intervalo venceu.
//  · renovar sem conseguir GRAVAR deixa a env com o refresh já consumido —
//    o ciclo só conta como cumprido quando persistiu.
//  · o carimbo tem que sobreviver ao restart, senão todo deploy reinicia o
//    ciclo; e carimbo inválido (Infinity, futuro) travaria a renovação PARA
//    SEMPRE, com o token morrendo em silêncio meses depois.
//  · preventiva e 401 podem chamar a renovação ao mesmo tempo com o MESMO
//    refresh — quem chega depois pega carona na que já está rodando.
// ═══════════════════════════════════════════════════════════════════

const REGISTRO = new Map();   // 'empresa/integracao' -> estado

const UMA_HORA = 60 * 60 * 1000;
const DIAS_PADRAO = 7;
const MIN_DIAS = 1;
const MAX_DIAS = 180;

/** Intervalo em dias, validado. Texto, 0, negativo, Infinity ou absurdo
 *  caem no padrão — senão o batimento renovaria de hora em hora (ou nunca). */
function diasDe(chaveEnv) {
  const v = Number(process.env[chaveEnv]);
  return (Number.isFinite(v) && v >= MIN_DIAS && v <= MAX_DIAS) ? v : DIAS_PADRAO;
}

/** Carimbo da última renovação, validado. Data futura ou não-finita faria
 *  `agora - carimbo` ficar negativo e o intervalo nunca vencer. */
function carimboDe(chaveEnv) {
  const t = Number(process.env[chaveEnv]);
  return (Number.isFinite(t) && t > 0 && t <= Date.now()) ? t : 0;
}

/**
 * Registra uma integração. Devolve funções prontas para o módulo usar:
 *  - preventiva({ forcar })  → renova se o intervalo venceu
 *  - ligar({ atrasoMs })     → agenda o primeiro disparo e o batimento
 *  - marcarRenovado()        → chamar em QUALQUER renovação que persistiu
 *  - parEnvCarimbo()         → { key, value } pra gravar junto do token
 */
function registrarPreventiva(opcoes) {
  const {
    empresa, integracao,
    temRefresh, renovar, persistiu,
    carimboEnv, diasEnv,
    aoRenovar = null,
  } = opcoes || {};

  if (!empresa || !integracao) throw new Error('registrarPreventiva: informe empresa e integracao');
  if (typeof renovar !== 'function') throw new Error('registrarPreventiva: renovar precisa ser funcao');

  const id = `${empresa}/${integracao}`;
  const rotulo = `${empresa.toUpperCase()}/${integracao}`;

  const estado = {
    empresa, integracao, id, rotulo, carimboEnv, diasEnv,
    ultima: carimboDe(carimboEnv),   // sobrevive ao restart
    emVoo: null,                     // uma renovação por integração
  };

  /** Chamar sempre que uma renovação (preventiva OU por 401) tiver GRAVADO. */
  function marcarRenovado() { estado.ultima = Date.now(); }

  /** Par pra incluir no MESMO write do token — nenhuma escrita a mais. */
  function parEnvCarimbo() {
    return carimboEnv ? { key: carimboEnv, value: String(Date.now()) } : null;
  }

  async function preventiva({ forcar = false } = {}) {
    const dias = diasDe(diasEnv);
    const intervalo = dias * 24 * 60 * 60 * 1000;
    const desde = Date.now() - estado.ultima;

    if (!forcar && estado.ultima && desde < intervalo) {
      return {
        ok: true, pulou: true, empresa, integracao,
        proxima_em_dias: Math.max(0, Math.round((intervalo - desde) / 86400000)),
      };
    }
    if (typeof temRefresh === 'function' && !temRefresh()) {
      return { ok: false, empresa, integracao, erro: 'sem refresh token - precisa autorizar de novo' };
    }

    // uma renovação por integração: preventiva e 401 usariam o mesmo refresh
    if (estado.emVoo) return estado.emVoo;
    estado.emVoo = (async () => {
      let renovou = false;
      try { renovou = !!(await renovar()); } catch (e) { renovou = false; }
      const gravou = (typeof persistiu === 'function') ? !!persistiu() : renovou;
      // só conta como cumprido se GRAVOU: senão a env ficou com o refresh
      // já consumido e a próxima tentativa precisa acontecer
      if (renovou && gravou) {
        marcarRenovado();
        if (typeof aoRenovar === 'function') { try { aoRenovar(); } catch (e) { /* nao trava */ } }
      }
      return { ok: renovou && gravou, empresa, integracao, renovado: renovou, persistiu: gravou, dias };
    })();
    try { return await estado.emVoo; } finally { estado.emVoo = null; }
  }

  /** Agenda. `atrasoMs` escalona o primeiro disparo entre integrações, pra
   *  não disputarem a escrita das env vars nem o aquecimento dos índices. */
  function ligar({ atrasoMs = 2 * 60 * 1000 } = {}) {
    if (estado.agendado) return;
    estado.agendado = true;
    const primeiro = setTimeout(() => {
      // SEM forcar: forçando aqui, o carimbo restaurado seria ignorado e
      // todo restart consumiria outro refresh
      preventiva().catch(() => {});
      const bat = setInterval(() => { preventiva().catch(() => {}); }, UMA_HORA);
      if (bat.unref) bat.unref();
    }, atrasoMs);
    if (primeiro.unref) primeiro.unref();
    console.log(`[${rotulo}] renovacao preventiva ligada: a cada ${diasDe(diasEnv)} dia(s)`);
  }

  estado.preventiva = preventiva;
  estado.ligar = ligar;   // ligarPendentes precisa alcançar
  REGISTRO.set(id, estado);
  return { preventiva, ligar, marcarRenovado, parEnvCarimbo };
}

/**
 * Liga TODAS as registradas que ainda não foram agendadas, escalonando o
 * primeiro disparo. É isto que faz empresa nova funcionar sozinha: basta
 * registrar (mesmo depois do boot, como acontece com módulos criados por
 * fábrica) que a próxima varredura pega.
 */
function ligarPendentes({ passoMinutos = 6, inicioMinutos = 2 } = {}) {
  let i = 0;
  const jaAgendadas = [...REGISTRO.values()].filter((e) => e.agendado).length;
  for (const estado of REGISTRO.values()) {
    if (estado.agendado) continue;
    const min = inicioMinutos + ((jaAgendadas + i) * passoMinutos);
    estado.ligar({ atrasoMs: min * 60 * 1000 });
    i++;
  }
  return i;
}

/** Estado de todas — alimenta a rota de conferência, agrupado por empresa. */
async function relatorio({ forcar = false, prazoMs = 20000 } = {}) {
  const comPrazo = (p) => Promise.race([
    p,
    new Promise((ok) => setTimeout(() => ok({ ok: false, erro: `prazo de ${prazoMs / 1000}s estourou — pode ter renovado assim mesmo` }), prazoMs)),
  ]);
  const out = {};
  for (const [, e] of REGISTRO) {
    if (!out[e.empresa]) out[e.empresa] = {};
    try { out[e.empresa][e.integracao] = await comPrazo(e.preventiva({ forcar })); }
    catch (err) { out[e.empresa][e.integracao] = { ok: false, erro: String(err.message || err) }; }
  }
  return out;
}

/** Só lista o que está registrado, sem renovar nada. */
function listar() {
  return [...REGISTRO.values()].map((e) => ({
    empresa: e.empresa, integracao: e.integracao,
    dias: diasDe(e.diasEnv),
    ultima_renovacao: e.ultima ? new Date(e.ultima).toISOString() : null,
    carimbo_env: e.carimboEnv || null,
    dias_env: e.diasEnv || null,
  }));
}

module.exports = { registrarPreventiva, ligarPendentes, relatorio, listar };
