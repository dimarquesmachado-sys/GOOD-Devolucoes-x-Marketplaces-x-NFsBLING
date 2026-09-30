'use strict';
// Revisao do Codex no #386: pausa de fundo do central nao segura a operacao,
// e o despachante acorda quando entra operacao durante o sono do fundo.
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

process.env.BLING_RITMO_URL = 'http://porteiro.invalido';
process.env.BLING_RITMO_KEY = 'k';
const axios = require('axios');
axios.post = async () => ({ status: 200, data: { ok: false, pausa_s: 30, motivo: '429' } });
const porteiro = require('../lib/ritmo-porteiro');

(async () => {
  const fu = await porteiro.pedirPermissao('fundo');
  ok(fu.via === 'espere', 'fundo recebe a pausa do central');
  const d = porteiro.diagnostico();
  ok(d.pausa_fundo_termina_em_s > 0 && d.pausa_termina_em_s === 0,
     '⚠️ pausa devolvida a pedido de FUNDO fica em pausaFundoAte, nao em pausaAte');
  axios.post = async () => ({ status: 200, data: { ok: true } });
  const op = await porteiro.pedirPermissao('operacao');
  ok(op.via === 'porteiro', '⚠️ a operacao nao espera a pausa do fundo (via=' + op.via + ')');

  // despachante: operacao que chega acorda o sono do fundo negado
  const ritmo = require('../lib/ritmo-bling');
  axios.post = async (u, _b, cfg) => (cfg.params.prioridade === 'fundo'
    ? { status: 200, data: { ok: false, esperar_ms: 5000 } }
    : { status: 200, data: { ok: true } });
  porteiro.avisarOk();
  ritmo.aguardarVez({ fundo: true, tetoMs: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 100));
  const t0 = Date.now();
  await ritmo.aguardarVez({ tetoMs: 20000 });
  const ms = Date.now() - t0;
  ok(ms < 1500, '⚠️ operacao que chega durante o sono do fundo passa na hora (' + ms + 'ms)');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
