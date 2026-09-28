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
    // ⚠️ b443 (Codex, P1): ESPAÇADAS, não rajada. Minha 1ª versão soltava as
    // 3 no mesmo milissegundo — uma rajada no início da janela encosta na
    // anterior e o Bling conta 6 em pouco mais de 1s.
    ok(tempos[1] >= 300 && tempos[2] >= 600 && tempos[3] >= 950,
       `⚠️ as liberacoes sao ESPACADAS (~333ms), nao em rajada (${tempos.join(',')}ms)`);
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

  // ── ⚠️ quem estourou o teto NÃO consome vaga ────────────────────
  //
  // Antes o callback expirado ficava na fila, o despachante registrava a
  // liberação e SÓ DEPOIS ele descobria que já tinha desistido — a vaga ia
  // pro lixo e o próximo esperava um intervalo à toa.
  {
    const r = criarRitmo({ nome: 't', limitePorSegundo: 3, tetoMs: 100 });
    r.avisar429(1);   // pausa 1s: os 2 abaixo vão estourar o teto de 100ms
    const a = r.aguardarVez().catch(() => 'estourou');
    const b = r.aguardarVez().catch(() => 'estourou');
    await Promise.all([a, b]);
    // ao sair da pausa, o próximo pedido deve ser atendido sem pagar por eles
    await new Promise((x) => setTimeout(x, 1000));
    const antes = r.estado().liberadas;
    await r.aguardarVez();
    ok(r.estado().liberadas === antes + 1,
       '⚠️ os 2 expirados NAO contaram como liberacao (so o vivo contou)');
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

    // ⚠️ b443 (Codex, P1): TODO 429 avisa — semRetentativa, retry do 401,
    // 2º 429 seguido. Um 429 que a fila não vê é um 429 que se repete.
    const avisos = (semCom.match(/ritmo\.avisar429\(/g) || []).length;
    ok(avisos >= 4, `⚠️ o 429 avisa o ritmo em TODOS os caminhos (${avisos} pontos, era 1)`);

    // e o retry pós-401 passa pela fila
    const i401 = semCom.indexOf('if (status === 401)');
    const bloco401 = semCom.slice(i401, semCom.indexOf('if (status === 429)', i401));
    ok(/await ritmo\.aguardarVez/.test(bloco401),
       '⚠️ o retry pos-401 pede a VEZ (nao chama fazer() direto)');
  }

  // ── ⚠️ o pré-aquecimento entra como FUNDO ────────────────────────
  //
  // Ninguém na AMB passava `fundo: true` — tudo entrava como interativo, e o
  // índice de 8.000 notas competia de igual com o clique do estoquista.
  {
    const nomes = fs.readFileSync(
      path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'), 'utf8');
    ok(/chamarBling\(`\/nfe[^`]*`, \{ fundo: deFundo/.test(nomes),
       '⚠️ a varredura de nomes passa `fundo` pro cliente');
    const ent = fs.readFileSync(
      path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-entrada-AMB.js'), 'utf8');
    ok(/chamarBling\(`\/nfe[^`]*`, \{ fundo: true/.test(ent),
       '  e a de notas de entrada tambem');

    // e o identificar não pede mais vez na fila da GOOD
    const ident = fs.readFileSync(
      path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8');
    const identSem = ident.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(!/ritmoBling\.aguardarVez/.test(identSem),
       '⚠️ o identificar NAO pede mais vez na fila singleton da GOOD');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
