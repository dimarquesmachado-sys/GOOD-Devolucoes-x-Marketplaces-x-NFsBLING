'use strict';
// ⚠️ O PRÉ-AQUECIMENTO SATUROU A COTA E ATRASOU A EMISSÃO DE NF.
//
// O dono emitiu 2 NFs juntas e levou 3 minutos. O log mostrou o serviço
// recém-reiniciado, com três varreduras competindo: o índice de devoluções do
// ML (195s), o de nomes (148s, 6.231 NFs) e o de notas de entrada.
//
// A intenção antiga ("1 minuto depois do outro pra não empilhar") não se
// cumpria: o atraso era fixo e a DURAÇÃO não. O ml-returns começava aos 180s
// e terminava aos 375s — o nf-nomes entrava em cima, aos 240s.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
const semCom = APP.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── a fila existe e espera de verdade ───────────────────────────────
{
  ok(/async function esperarTerminar/.test(semCom),
     '⚠️ existe a espera entre as rotinas');
  ok(/await esperarTerminar\('ml-returns'/.test(semCom)
     && /await esperarTerminar\('nf-nomes'/.test(semCom),
     '  e as pesadas esperam a anterior');
  ok(/PREAQ_TETO_MS/.test(semCom),
     '⚠️ com TETO — se uma travar, as seguintes rodam');
}

// ── ⚠️ e os módulos aceitam atraso 0 ────────────────────────────────
//
// Sem isso, o encadeamento não vale nada: cada um esperaria o próprio minuto
// e voltariam a se atropelar — parecendo consertado.
{
  for (const m of ['nf-entrada', 'magalu', 'ml-returns', 'nf-nomes']) {
    const src = fs.readFileSync(
      path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', `${m}-AMB.js`), 'utf8');
    ok(/function preAquecer\(atrasoMs/.test(src),
       `  ${m}: preAquecer aceita o atraso`);
    ok(/atrasoMs != null/.test(src),
       `  ⚠️ ${m}: usa \`!= null\` (com \`||\` o 0 viraria o padrao)`);
  }
}

// ── ⚠️ P1 (Codex, PR #356): retry pendente nao pode virar "terminou" ──
//
// `construindo` cobre so a chamada em voo. Entre uma tentativa e a
// proxima do retry (backoff de 30s a 10min), ele fica FALSO — e quem so
// olha `construindo` acha que a rotina terminou e libera a proxima,
// competindo com o retry que ainda vai disparar.
{
  for (const m of ['ml-returns', 'nf-nomes']) {
    const src = fs.readFileSync(
      path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', `${m}-AMB.js`), 'utf8');
    ok(/let retryPendente = false;/.test(src),
       `  ${m}: tem o sinalizador de retry pendente`);
    ok(/retryPendente = true;/.test(src),
       `  ${m}: liga no 1o agendamento do preAquecer`);
    ok(/retry_pendente: retryPendente,/.test(src),
       `  ${m}: expoe no statusIndice`);
  }
  ok(/if \(!st \|\| \(!st\.construindo && !st\.retry_pendente\)\) return;/.test(semCom),
     '⚠️ a fila do app-AMB espera `construindo` OU `retry_pendente`');
}

// ── e a simulacao prova a diferenca: so `construindo` libera cedo ────
//
// 3 polls simulados: a chamada em voo ja terminou (falhou) nos 3, mas o
// retry agendado so realmente concluiu no 3o.
{
  const polls = [
    { construindo: false, retry_pendente: true },
    { construindo: false, retry_pendente: true },
    { construindo: false, retry_pendente: false },
  ];
  const contarPolls = (checarRetry) => {
    for (let i = 0; i < polls.length; i++) {
      const st = polls[i];
      if (!st || (!st.construindo && (!checarRetry || !st.retry_pendente))) return i + 1;
    }
    return -1;
  };
  ok(contarPolls(false) === 1,
     '⚠️ SO com `construindo`: libera no 1o poll, com o retry ainda pendente (o bug)');
  ok(contarPolls(true) === 3,
     '  com `retry_pendente`: so libera quando o retry realmente terminou');
}

// ── ⚠️ P2 (Codex, PR #356): o Magalu tambem precisa aparecer "construindo" ──
//
// `magalu.statusIndice()` nao tinha `construindo` nenhum: a fila liberava
// no 1o poll (5s), mesmo com a fase 1 (paginas de tickets) ainda em voo.
{
  const src = fs.readFileSync(
    path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'magalu-AMB.js'), 'utf8');
  ok(/ticketsRodando: false/.test(src),
     '  magalu: tem o sinalizador de tickets em construcao');
  ok(/INDICES\.ticketsRodando = true;/.test(src) && /INDICES\.ticketsRodando = false;/.test(src),
     '  magalu: liga/desliga ao redor da construcao (fase 1 + fase 2)');
  ok(/construindo: INDICES\.ticketsRodando,/.test(src),
     '  magalu: statusIndice expoe `construindo`');
}

// ── ⚠️ P2 (Codex, PR #356): nao agendar o preAquecer 2x ─────────────
//
// Se o ML/Magalu forem autorizados DURANTE os 3min de espera do boot, o
// /oauth/callback ja chama preAquecer() na hora — chamar de novo aqui
// duplicaria a varredura (e, no Magalu, duplicaria o setInterval
// PERMANENTE de refresh).
{
  ok(/const mlJaAutorizado = ml\.temToken\(\);/.test(semCom)
     && /const magaluJaAutorizado = magalu\.temToken\(\);/.test(semCom),
     '⚠️ o estado do token e capturado ANTES da espera de 3min');
  ok(/if \(mlJaAutorizado\) \{/.test(semCom) && /if \(magaluJaAutorizado\) \{/.test(semCom),
     '  e o agendamento do boot so roda se o token JA existia antes da espera');
}

// ── os dois caminhos da espera, exercitados ─────────────────────────
{
  const TETO = 900;
  const esperar = async (status) => {
    const ate = Date.now() + TETO;
    while (Date.now() < ate) {
      await new Promise((r) => setTimeout(r, 100));
      let st; try { st = status(); } catch (e) { return 'sem-status'; }
      if (!st || !st.construindo) return 'terminou';
    }
    return 'teto';
  };

  return (async () => {
    let fim = Date.now() + 300;
    ok(await esperar(() => ({ construindo: Date.now() < fim })) === 'terminou',
       '  espera ate a rotina terminar');
    ok(await esperar(() => ({ construindo: true })) === 'teto',
       '⚠️ e desiste no teto (rotina travada nao prende a fila)');
    ok(await esperar(() => { throw new Error('sem status'); }) === 'sem-status',
       '  e segue se o status nem responder');

    console.log('');
    console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
    process.exit(falhas ? 1 : 0);
  })();
}
