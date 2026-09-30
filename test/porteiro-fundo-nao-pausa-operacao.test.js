'use strict';
// ⚠️ O CLIENTE DO PORTEIRO: 429 do FUNDO não pausa a OPERAÇÃO, e sem
// Retry-After manda 0 (não 60) — casado com o central (Mover-Pedidos #538).
//
// 30/09: a esteira da GOOD parou 8 vezes em 12 minutos por 429 que eram do
// índice de nomes. E o "60" que este cliente mandava como se fosse
// Retry-After fazia o central pausar 60s sempre, ignorando a escada.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// isolo o modulo: sem porteiro central alcançável, tudo cai no local
process.env.BLING_RITMO_URL = '';
const porteiro = require('../lib/ritmo-porteiro');

(async () => {
  // ── 429 de FUNDO: a operação não espera ─────────────────────────
  {
    await porteiro.avisar429(0, 'fundo');
    const op = await porteiro.pedirPermissao('operacao');
    ok(op.via !== 'espere', '⚠️ 429 do FUNDO nao faz a OPERACAO esperar (via=' + op.via + ')');
    const fu = await porteiro.pedirPermissao('fundo');
    ok(fu.via === 'espere', '  mas o fundo espera');
    const d = porteiro.diagnostico();
    ok(d.pausa_fundo_termina_em_s > 0 && d.pausa_termina_em_s === 0,
       '  e o diagnostico mostra as 2 pausas separadas');
  }

  // ── 429 de OPERAÇÃO: curto ───────────────────────────────────────
  {
    porteiro.avisarOk();
    await porteiro.avisar429(0, 'operacao');
    const d = porteiro.diagnostico();
    ok(d.pausa_termina_em_s > 0 && d.pausa_termina_em_s <= 5,
       '⚠️ 429 da OPERACAO pausa CURTO localmente (' + d.pausa_termina_em_s + 's, nao 60)');
  }

  // ── o avisarOk zera as duas ──────────────────────────────────────
  {
    porteiro.avisarOk();
    const d = porteiro.diagnostico();
    ok(d.pausa_termina_em_s === 0 && d.pausa_fundo_termina_em_s === 0,
       '  avisarOk zera as 2 pausas');
  }

  // ── e o bling.js manda a prioridade, e 0 sem Retry-After ─────────
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'bling.js'), 'utf8');
    const semCom = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const chamadas = (semCom.match(/porteiroRitmo\.avisar429\(/g) || []).length;
    const comPri = (semCom.match(/avisar429\([^\n]*'fundo' : 'operacao'\)/g) || []).length;
    ok(chamadas >= 2 && chamadas === comPri,
       `⚠️ TODOS os avisar429 do bling.js mandam quem tomou (${comPri}/${chamadas})`);
    ok(!/avisar429\([^)]*: 60\)/.test(semCom),
       '⚠️ e nenhum manda 60 como se fosse Retry-After (o central usa a escada)');
    const rp = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ritmo-porteiro.js'), 'utf8');
    ok(/prioridade: ehFundo \? 'fundo' : 'operacao'/.test(rp),
       '  e o ritmo-porteiro repassa a prioridade pro central');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
