// Roda com: node test/shopee-amb-chegada-real.test.js
//
// Apontamento do Codex no PR #300 (P1): o refatoro b349 trocou o estado
// solto do Shopee-AMB por um objeto SHP (SHP.chegada no lugar do extinto
// `CHEGADA`), mas esqueceu 3 usos em resumoEspreita()/dispararChegadas().
// Isso derruba `ReferenceError: CHEGADA is not defined` sempre que o proxy
// responde com sucesso — e /api/espreita descartava TODOS os cards Shopee.
//
// Este teste executa resumoEspreita() de ponta a ponta (fetch mockado) pra
// provar que o bloco `chegadas` do retorno nao explode mais.

'use strict';

process.env.SHOPEE_PROXY_URL = 'http://proxy.teste';
process.env.SHOPEE_PROXY_KEY = 'chave-teste';
process.env.AMB_SHOPEE_LOJA = 'amb';

// ⚠️ b362: o modulo virou FABRICA (3 de 13) — exporta `{ criar }`, nao a
// instancia pronta. Sem isto o teste pegava o objeto da fabrica e chamava
// `resumoEspreita` nele, que nao existe ali.
const _shopeeMod = require('../amb-devolucoes/lib-AMB/shopee-AMB');
const shopee = (typeof _shopeeMod.criar === 'function')
  ? _shopeeMod.criar({ PREFIXO_ENV: 'AMB_' })
  : _shopeeMod;

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const fetchOriginal = global.fetch;
global.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, devolucoes: [
    { order_sn: 'PED1', status: 'ACCEPTED', logistics_status: 'DELIVERY_DONE',
      tracking_number: 'BR1', create_time: Math.floor(Date.now() / 1000) - 5 * 86400 },
  ] }),
});

(async () => {
  let resumo;
  let erro = null;
  try {
    resumo = await shopee.resumoEspreita();
  } catch (e) {
    erro = e;
  }

  ok(!erro, 'resumoEspreita() nao lanca (antes: ReferenceError: CHEGADA is not defined)');
  if (erro) console.log('    erro:', erro.message);

  ok(!!resumo && resumo.quente === true, 'e retorna quente:true com a lista mockada');
  ok(!!resumo && !!resumo.chegadas, 'o bloco chegadas existe no retorno');
  ok(!!resumo && resumo.chegadas && resumo.chegadas.com_data === 0,
     '  com_data comeca em 0 (nenhuma chegada real consultada ainda)');
  ok(!!resumo && resumo.chegadas && resumo.chegadas.ainda_nao === 0,
     '  ainda_nao tambem comeca em 0');

  global.fetch = fetchOriginal;

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
