'use strict';
// b660 — a loja TikTok de cada empresa vem do REGISTRO (lib/empresas), nao de um mapa fixo.
//
// ⚠️ O QUE ESTE TESTE PROTEGE: `lib/tiktok-ponte.js` era o ultimo lugar do repo que listava
// empresas a mao ({ good, amb, ambtotal, girassol }). Uma 4a empresa entrava pela fabrica e o
// TikTok dela falhava calado ("empresa sem loja TikTok mapeada") ate alguem editar o arquivo.
// Agora a ponte le a ficha: chave canonica, chaveDados e os aliases do contrato resolvem; a
// loja e o chaveDados (o nome que o Mover-Pedidos usa em TIKTOK_LOJAS) ou `lojaTiktok`.
//
// Roda com: node test/tiktok-loja-pelo-registro.test.js

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const ponte = require('../lib/tiktok-ponte');
const { EMPRESAS } = require('../lib/empresas');

// ── as 3 de hoje, pelas 3 portas (chave, chaveDados, alias do contrato) ──
ok(ponte.lojaDaEmpresa('good') === 'good' && ponte.lojaDaEmpresa('gimpo') === 'good', '⚠️ good: pela chave e pelo alias do contrato (gimpo)');
ok(ponte.lojaDaEmpresa('ambtotal') === 'amb' && ponte.lojaDaEmpresa('amb') === 'amb', '  ambtotal: pela chave e pelo chaveDados/alias (amb) — a loja e amb, como o Mover-Pedidos chama');
ok(ponte.lojaDaEmpresa('girassol') === 'girassol' && ponte.lojaDaEmpresa('gira') === 'girassol', '  girassol: pela chave e pelo alias (gira)');
ok(ponte.lojaDaEmpresa('GOOD ') === 'good', '  maiusculas e espaco nao atrapalham');
ok(ponte.lojaDaEmpresa('inexistente') === null && ponte.lojaDaEmpresa('') === null && ponte.lojaDaEmpresa(null) === null,
   '  fora do registro continua null — nunca cai em padrao');

// ── uma 4a empresa entra SEM editar a ponte ──────────────────────────
EMPRESAS.aurora = { chave: 'aurora', chaveDados: 'aurora' };
ok(ponte.lojaDaEmpresa('aurora') === 'aurora', '⚠️ 4a empresa na ficha ganha loja sem ninguem mexer na ponte');
EMPRESAS.nova = { chave: 'nova', chaveDados: 'nova_dados', lojaTiktok: 'novashop' };
ok(ponte.lojaDaEmpresa('nova') === 'novashop' && ponte.lojaDaEmpresa('nova_dados') === 'novashop',
   '  `lojaTiktok` na ficha manda quando o nome da loja no Mover-Pedidos nao e o chaveDados');
delete EMPRESAS.aurora; delete EMPRESAS.nova;
ok(ponte.lojaDaEmpresa('aurora') === null, '  e some do registro, some da ponte');

// ── a sonda diz as empresas do REGISTRO quando a pedida nao existe ──
(async () => {
  const r = await ponte.sondaDevolucoes('inexistente', {});
  ok(r && r.ok === false && /no registro: good, ambtotal, girassol/.test(String(r.erro)),
     '  sonda com empresa desconhecida lista as empresas do registro (nao um mapa)');

  // ── invariante de texto: nenhum mapa fixo de empresas na ponte ──
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tiktok-ponte.js'), 'utf8');
  const semComentario = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(!/LOJA_POR_EMPRESA|girassol:\s*'girassol'|ambtotal:\s*'amb'/.test(semComentario),
     '⚠️ a ponte nao lista empresas a mao (le lib/empresas + aliases do contrato)');
  ok(/require\('\.\/empresas'\)/.test(semComentario) && /aliases/.test(semComentario), '  e consulta o registro e os aliases do contrato');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
