'use strict';
// 14/10 — a FICHA da vez dada pelo porteiro vai nos avisos de 429 e de sucesso (Girassol/AMB e GOOD). Sem ela o porteiro
// ignorava o aviso de sucesso (o degrau so descia pelo tempo) e nao conseguia classificar os 429 do Devolucoes.
// Roda o cliente, o ritmo e o despacho de PRODUCAO com o porteiro falso.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
process.env.BLING_RITMO_URL = 'https://porteiro.falso'; process.env.BLING_RITMO_KEY = 'k';
const axios = require('axios');
const pedidos = [];
let respostas = [];
axios.post = async (url, corpo, opts) => { pedidos.push({ url, params: (opts && opts.params) || {} }); const d = respostas.shift() || { ok: true, ficha: 'F-PADRAO' }; return { status: 200, data: d }; };
(async () => {
  const P = require(path.join(__dirname, '..', 'lib', 'ritmo-porteiro.js'));
  const g = P.criarPorteiro({ conta: 'girassol' });
  respostas = [{ ok: true, ficha: 'F1' }];
  const perm = await g.pedirPermissao('operacao');
  ok(perm.via === 'porteiro' && perm.ficha === 'F1', '⚠️ a permissao devolve a FICHA que o porteiro deu');
  pedidos.length = 0;
  await g.avisar429(0, 'operacao', 'F1');
  await g.avisarOk('fundo', 'F1');
  const a429 = pedidos.find((p) => /aviso-429/.test(p.url)); const aok = pedidos.find((p) => /aviso-ok/.test(p.url));
  ok(a429 && a429.params.ficha === 'F1', '⚠️ o aviso de 429 leva a ficha (o porteiro classifica: no limite x consumo de fora)');
  ok(aok && aok.params.ficha === 'F1' && aok.params.servico === 'devolucoes', '⚠️ o aviso de sucesso leva a ficha (sem ela o porteiro ignorava e o degrau nao zerava)');
  // o ritmo da Girassol/AMB entrega a ficha a quem esperou a vez
  respostas = [{ ok: true, ficha: 'F2' }];
  const R = require(path.join(__dirname, '..', 'lib', 'ritmo-por-empresa.js')).criarRitmo({ nome: 'teste-ficha', contaPorteiro: 'girassol' });
  const f2 = await R.aguardarVez({});
  ok(f2 === 'F2', '⚠️ aguardarVez da Girassol/AMB devolve a ficha da vez (' + f2 + ')');
  const semPorteiro = require(path.join(__dirname, '..', 'lib', 'ritmo-por-empresa.js')).criarRitmo({ nome: 'x' });
  ok((await semPorteiro.aguardarVez({})) === null, '  sem porteiro: aguardarVez devolve null (ritmo local, como antes)');
  // as duas copias do Bling passam a ficha nos avisos
  const amb = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'bling-AMB.js'), 'utf8');
  ok((amb.match(/_ficha = await ritmo\.aguardarVez\(/g) || []).length === 3 && (amb.match(/ritmo\.avisarOk\(opcoes\.fundo \? 'fundo' : 'operacao', _ficha\)/g) || []).length === 3 && (amb.match(/opcoes\.fundo \? 'fundo' : 'operacao', _ficha\);/g) || []).length >= 4, '⚠️ o Bling da Girassol/AMB guarda a ficha e manda nos avisos (3 sucessos, 4 de 429)');
  const good = fs.readFileSync(path.join(__dirname, '..', 'lib', 'bling.js'), 'utf8');
  ok((good.match(/_ficha = await ritmo\.aguardarVez\(/g) || []).length === 1 && (good.match(/_ficha = opcoes\.semRitmo \? null : await ritmo\.aguardarVez\(/g) || []).length === 3 && /_ficha = opcoes\.ficha \|\| null/.test(good) && (good.match(/if \(_ficha\) porteiroRitmo\.avisarOk\(/g) || []).length === 4 && (good.match(/'operacao', _ficha\);/g) || []).length === 3, '⚠️ o Bling da GOOD tambem (agora avisa o sucesso com ficha — antes nem avisava)');
  const rb = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ritmo-bling.js'), 'utf8');
  ok(/proximo\(permissao && permissao\.ficha\)/.test(rb) && /liberar\(ficha \|\| null\)/.test(rb), '  o despacho da GOOD entrega a ficha a quem esperou');
  // Codex: sucesso que saiu ANTES de um 429 mais novo nao limpa a pausa local
  const h = P.criarPorteiro({ conta: 'girassol' });
  const antes = Date.now() - 50;
  await h.avisar429(0, 'operacao', 'F9');
  await h.avisarOk('operacao', 'F8', antes);
  ok(h.diagnostico().pausa_ativa === true, '⚠️ sucesso mais velho que o 429 NAO limpa a pausa local');
  await h.avisarOk('operacao', 'F9', Date.now() + 5);
  ok(h.diagnostico().pausa_ativa === false, '  sucesso mais novo que o 429 limpa a pausa local');
  // semRitmo: a ficha de quem esperou por fora chega ao aviso
  const repassa = /buscarNFePorId\(c\.id, \{ semRitmo: true, ficha: fichaVez \}\)/;
  ok(repassa.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')) && repassa.test(fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8')), '⚠️ as NFs com espera por fora (GOOD e AMB) repassam a ficha');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
