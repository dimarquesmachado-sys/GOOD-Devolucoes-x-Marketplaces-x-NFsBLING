'use strict';
// ⚠️ O CLIENTE DO BLING DA AMB/GIRASSOL TEM QUE RESPEITAR A COTA.
//
// Ele NÃO passava por fila nenhuma: batia direto, tomava 429, esperava 1,5s
// fixo e batia de novo. A AMB nunca incomodou (volume baixo); a Girassol tem o
// dobro e saturou o Bling dela no 1º pré-aquecimento — o log encheu de 429.
//
// 📌 E a cota do Bling é DA CONTA. Uma fila por empresa, cada uma com seu
// limite — não a fila da GOOD, que é singleton com a conta cravada.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const { criarRitmo } = require('../lib/ritmo-por-empresa');

// ── o ritmo segura no limite ────────────────────────────────────────
(async () => {
  {
    const r = criarRitmo({ nome: 't', limitePorSegundo: 3 });
    const t0 = Date.now(); const tempos = [];
    for (let i = 0; i < 4; i++) { await r.aguardarVez(); tempos.push(Date.now() - t0); }
    ok(tempos[2] < 200 && tempos[3] >= 900,
       `⚠️ 3 passam na hora, a 4a espera a janela (${tempos.join(',')}ms)`);
  }

  // ── interativo passa na frente do fundo ─────────────────────────
  {
    const r = criarRitmo({ nome: 't', limitePorSegundo: 1 });
    await r.aguardarVez();
    const ordem = [];
    const pF = r.aguardarVez({ fundo: true }).then(() => ordem.push('fundo'));
    await new Promise((x) => setTimeout(x, 30));
    const pI = r.aguardarVez().then(() => ordem.push('interativo'));
    await Promise.all([pF, pI]);
    ok(ordem[0] === 'interativo',
       '⚠️ quem esta na tela passa na frente do indice');
  }

  // ── ⚠️ o 429 pausa PROPORCIONAL, não 60s cegos ──────────────────
  //
  // Dado medido em 28/09 (log da Girassol): o Bling NÃO manda retry-after.
  // Então a pausa é escolha nossa — curta e crescente, não fixa.
  {
    const r = criarRitmo({ nome: 't' });
    ok(r.avisar429() === 1000, '  1o 429 sem retry-after: 1s');
    ok(r.avisar429() === 2000, '  2o seguido: 2s');
    ok(r.avisar429() === 4000, '  3o seguido: 4s (dobra)');
    ok(r.avisar429(7) === 7000, '⚠️ com retry-after do Bling, OBEDECE');
    r.avisarOk();
    ok(r.avisar429() === 1000, '  depois de um OK, zera');
    let teto = 0;
    for (let i = 0; i < 10; i++) teto = r.avisar429();
    ok(teto === 15000, '  e nunca passa de 15s');
  }

  // ── o teto de espera não prende ninguém pra sempre ──────────────
  {
    const r = criarRitmo({ nome: 't', limitePorSegundo: 1, tetoMs: 300 });
    await r.aguardarVez();
    r.avisar429(5);   // pausa 5s, teto 300ms
    let estourou = false;
    try { await r.aguardarVez(); } catch (e) { estourou = !!e.filaEstourou; }
    ok(estourou, '⚠️ passou do teto: rejeita com `filaEstourou` (nao prende)');
  }

  // ── ⚠️ e o cliente da AMB USA o ritmo ────────────────────────────
  {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'bling-AMB.js'), 'utf8');
    const semCom = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(/ritmo-por-empresa/.test(semCom), '⚠️ o bling-AMB cria o ritmo dele');
    ok(/nome: CHAVE_TOKEN \+ '\/bling'/.test(semCom),
       '  com o nome da EMPRESA (uma fila por conta)');
    ok(/await ritmo\.aguardarVez\(\{ fundo: !!opcoes\.fundo \}\)/.test(semCom),
       '⚠️ e pede a vez ANTES de chamar');
    ok(/ritmo\.avisar429\(/.test(semCom), '  e avisa o ritmo no 429');
    ok(!/await sleep\(1500\);/.test(semCom),
       '⚠️ e o sleep(1500) fixo SAIU (era o martelo)');
    ok(/estadoRitmo/.test(semCom), '  e expoe o estado (pro /status)');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
