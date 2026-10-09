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
  ok(pedidos.some((p) => /aviso-429/.test(p.url) && p.params.conta === 'girassol' && p.params.prioridade === 'operacao' && p.params.servico === 'devolucoes'), '  o 429 vai pro porteiro na conta girassol, com a origem e o servico (devolucoes)');
  // o ritmo da empresa pede a vez ao porteiro da conta dela antes de liberar
  pedidos.length = 0; respostas = [{ ok: false, esperar_ms: 120 }, { ok: true }];
  const R = require(path.join(__dirname, '..', 'lib', 'ritmo-por-empresa.js')).criarRitmo({ nome: 'teste', contaPorteiro: 'ambtotal' });
  const t0 = Date.now(); await R.aguardarVez({ fundo: true }); const dt = Date.now() - t0;
  const perm = pedidos.filter((p) => /permissao/.test(p.url));
  ok(perm.length >= 2 && perm.every((p) => p.params.conta === 'ambtotal' && p.params.prioridade === 'fundo'), '⚠️ o ritmo da AMB pede a vez na conta ambtotal, como FUNDO (' + perm.length + ' pedidos)');
  ok(dt >= 100, '  respeitou o "espere" do porteiro antes de liberar (' + dt + ' ms)');
  const semPorteiro = require(path.join(__dirname, '..', 'lib', 'ritmo-por-empresa.js')).criarRitmo({ nome: 'x' });
  ok(semPorteiro.estado().porteiro === null, '  sem contaPorteiro, so o ritmo local (como antes)');
  const RP = path.join(__dirname, '..', 'lib', 'ritmo-por-empresa.js');
  const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
  // Codex #466 P1: 429 de FUNDO nao segura a OPERACAO localmente
  pedidos.length = 0; respostas = [];
  const R2 = require(RP).criarRitmo({ nome: 't2', contaPorteiro: 'girassol' });
  R2.avisar429(5, 'fundo');
  const t2 = Date.now(); await R2.aguardarVez({});
  ok(Date.now() - t2 < 500 && R2.estado().pausa_fundo_termina_em_s >= 4, '⚠️ 429 de fundo nao segura a operacao (' + (Date.now() - t2) + ' ms)');
  // Codex #466 P2: sucesso de operacao nao cancela a pausa de fundo
  R2.avisarOk('operacao');
  ok(R2.estado().pausa_fundo_termina_em_s >= 4, '⚠️ sucesso de operacao preserva a pausa de fundo');
  R2.avisarOk('fundo');
  ok(R2.estado().pausa_fundo_termina_em_s === 0, '  sucesso de fundo limpa a pausa de fundo');
  // Codex #466 P2: operacao enfileirada acorda o despachante que dorme por causa de um item de fundo
  pedidos.length = 0; respostas = [{ ok: false, esperar_ms: 4000 }];
  const R3 = require(RP).criarRitmo({ nome: 't3', contaPorteiro: 'girassol' });
  R3.aguardarVez({ fundo: true }); await dorme(50);
  const t3 = Date.now(); await R3.aguardarVez({});
  ok(Date.now() - t3 < 1000, '⚠️ operacao nao herda a espera de 4s do fundo (' + (Date.now() - t3) + ' ms)');
  // Codex #466 P1: 429 que chega ENQUANTO espera o porteiro segura a liberacao
  pedidos.length = 0; respostas = [];
  const R4 = require(RP).criarRitmo({ nome: 't4', contaPorteiro: 'girassol' });
  const antes = axios.post;
  axios.post = async (...a) => { await dorme(100); return antes(...a); };
  const t4 = Date.now(); const p4 = R4.aguardarVez({}); await dorme(10); R4.avisar429(1, 'operacao'); await p4;
  axios.post = antes;
  ok(Date.now() - t4 >= 950, '⚠️ 429 durante o pedido ao porteiro segura a liberacao (' + (Date.now() - t4) + ' ms)');
  // Codex #466 P2: quem estourou o teto sai da fila e nao pede vaga ao porteiro
  pedidos.length = 0; respostas = [];
  const R5 = require(RP).criarRitmo({ nome: 't5', contaPorteiro: 'girassol', tetoMs: 100 });
  R5.avisar429(1, 'operacao');
  const venc = await R5.aguardarVez({}).then(() => false, (e) => !!e.filaEstourou);
  await dorme(1200);
  ok(venc && R5.estado().na_fila.interativa === 0 && pedidos.filter((p) => /permissao/.test(p.url)).length === 0, '⚠️ espera vencida sai da fila e nao consome vaga do porteiro');
  const fs = require('fs'); const A = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'bling-AMB.js'), 'utf8');
  ok(/contaPorteiro: CHAVE_TOKEN,/.test(A) && (A.match(/ritmo\.avisar429\([^\n]*opcoes\.fundo \? 'fundo' : 'operacao'\)/g) || []).length === 4, '⚠️ o Bling da AMB/Girassol liga o porteiro da conta dela e avisa os 4 429 com a origem');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
