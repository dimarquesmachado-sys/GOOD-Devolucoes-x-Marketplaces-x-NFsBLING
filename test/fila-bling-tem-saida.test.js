// Roda com: node test/fila-bling-tem-saida.test.js
//
// ⚠️ MEDIDO EM PRODUÇÃO (10/09): 6+ minutos de serviço no ar e o `/health`
// mostrava `paginas_lidas: null`, `erro: null`, `total: 0` — a varredura do
// índice COMEÇOU e nunca chegou ao fim, e nem falhou. O estoquista buscava
// "charles" e não achava nada.
//
// A CAUSA: o porteiro de ritmo pôs a conta `good` em pausa (429), e quem
// esperava na fila esperava PARA SEMPRE — a promessa nunca rejeitava.
//
// ⚠️ E o pior não era a demora: o `emConstrucao` guarda essa promessa, então
// TODA busca seguinte esperava a MESMA coisa travada. Uma varredura
// pendurada travava a busca por nome inteira.
//
// 📌 Nós fizemos ~22 chamadas em 6 min — bem abaixo do limite. A pausa veio
// do outro serviço que divide a conta `good`. Esperar é o certo; esperar
// SEM FIM é que não.

const ritmo = require('../lib/ritmo-bling.js');
const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

(async () => {
  // ── a espera normal continua igual ────────────────────────────────
  //
  // ⚠️ O teto não pode atropelar o ritmo: 400ms entre chamadas é o que
  // protege a cota da conta.
  {
    const t0 = Date.now();
    await ritmo.aguardarVez();
    await ritmo.aguardarVez();
    const gasto = Date.now() - t0;
    ok(gasto >= 380 && gasto < 2000,
       'a espera normal segue o ritmo (' + gasto + 'ms pra 2 chamadas)');
  }

  // ── ⚠️ mas a espera SEM FIM tem saída ─────────────────────────────
  {
    let estourou = false;
    try {
      await ritmo.aguardarVez({ tetoMs: 50 });
    } catch (e) {
      estourou = !!e.filaEstourou;
    }
    ok(estourou, '⚠️ passou do teto, a promessa REJEITA (nao pendura)');
  }

  // ── e o erro é identificável ──────────────────────────────────────
  //
  // Quem chama precisa distinguir "a fila estourou" de "o Bling recusou" —
  // são decisões diferentes: a primeira é para tentar depois, a segunda
  // pode ser dado ruim.
  {
    let e2 = null;
    try { await ritmo.aguardarVez({ tetoMs: 30 }); } catch (e) { e2 = e; }
    ok(e2 && e2.filaEstourou === true,
       '  e marca `filaEstourou` (quem chama distingue de erro do Bling)');
    ok(e2 && /porteiro|429/.test(e2.message),
       '  com a causa provavel na mensagem');
  }

  // ── ⚠️ e a construção do índice também tem teto ───────────────────
  //
  // O teto da fila protege UMA chamada. A construção inteira (19 páginas)
  // precisa do seu — senão fica pendurada somando esperas legítimas.
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'nf-nomes.js'), 'utf8');
    ok(/NF_NOMES_TETO_CONSTRUCAO_MS/.test(src),
       'a construcao do indice tem teto proprio (e ajustavel por env)');
    ok(/IDX\.emConstrucao = Promise\.race/.test(src),
       '  ⚠️ e o `emConstrucao` guarda a versao COM teto');
    ok(/IDX\.construindoDesde = null/.test(src),
       '  e limpa o carimbo ao terminar (senao o /health mente)');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
