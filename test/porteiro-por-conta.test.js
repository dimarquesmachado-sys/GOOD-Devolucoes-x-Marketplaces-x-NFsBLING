'use strict';
// b577 — o porteiro central da cota do Bling por CONTA: a Girassol/AMB pedem a vez na conta DELAS; pausa de uma conta
// nao segura a outra; a GOOD segue na instancia padrao. Roda o ritmo e o porteiro de producao com o porteiro falso.
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
process.env.BLING_RITMO_URL = 'https://porteiro.falso'; process.env.BLING_RITMO_KEY = 'k';
const axios = require('axios');
const pedidos = [];
let respostas = [{ ok: false, esperar_ms: 120 }];
axios.post = async (url, corpo, opts) => { pedidos.push({ url, params: opts && opts.params }); const d = respostas.shift() || { ok: true }; return { status: 200, data: d }; };
(async () => {
  const P = require(path.join(__dirname, '..', 'lib', 'ritmo-porteiro.js'));
  const g = P.criarPorteiro({ conta: 'girassol' });
  ok(P.CONTA === 'good' && g.CONTA === 'girassol', '⚠️ a GOOD segue na instancia padrao (good); a Girassol tem a dela');
  await g.avisar429(30, 'operacao');
  ok(g.diagnostico().pausa_termina_em_s > 0 && P.diagnostico().pausa_termina_em_s === 0, '⚠️ pausa da conta da Girassol NAO segura a GOOD');
  ok(pedidos.some((p) => /aviso-429/.test(p.url) && p.params.conta === 'girassol' && p.params.prioridade === 'operacao'), '  o 429 vai pro porteiro na conta girassol, com a origem');
  // o ritmo da empresa pede a vez ao porteiro da conta dela antes de liberar
  pedidos.length = 0; respostas = [{ ok: false, esperar_ms: 120 }, { ok: true }];
  const R = require(path.join(__dirname, '..', 'lib', 'ritmo-por-empresa.js')).criarRitmo({ nome: 'teste', contaPorteiro: 'ambtotal' });
  const t0 = Date.now(); await R.aguardarVez({ fundo: true }); const dt = Date.now() - t0;
  const perm = pedidos.filter((p) => /permissao/.test(p.url));
  ok(perm.length >= 2 && perm.every((p) => p.params.conta === 'ambtotal' && p.params.prioridade === 'fundo'), '⚠️ o ritmo da AMB pede a vez na conta ambtotal, como FUNDO (' + perm.length + ' pedidos)');
  ok(dt >= 100, '  respeitou o "espere" do porteiro antes de liberar (' + dt + ' ms)');
  const semPorteiro = require(path.join(__dirname, '..', 'lib', 'ritmo-por-empresa.js')).criarRitmo({ nome: 'x' });
  ok(semPorteiro.estado().porteiro === null, '  sem contaPorteiro, so o ritmo local (como antes)');
  const fs = require('fs'); const A = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'bling-AMB.js'), 'utf8');
  ok(/contaPorteiro: CHAVE_TOKEN,/.test(A) && (A.match(/ritmo\.avisar429\([^\n]*opcoes\.fundo \? 'fundo' : 'operacao'\)/g) || []).length === 4, '⚠️ o Bling da AMB/Girassol liga o porteiro da conta dela e avisa os 4 429 com a origem');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
