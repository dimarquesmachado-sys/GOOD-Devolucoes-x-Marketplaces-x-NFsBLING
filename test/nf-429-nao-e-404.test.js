'use strict';
// ⚠️ "NAO SEI" != "NAO EXISTE" — a busca de NF por numero com o Bling em 429.
//
// Girassol, 01/10: com 1 em 3 chamadas tomando 429, TODAS as sondas de ancora
// falhavam, a funcao devolvia [] e o bipe dizia "NF 126421 nao localizada no
// Bling, confira o numero" — pra uma nota que EXISTIA (estava no indice e na
// espreita). O operador desistia dela. Regra 4.14(d): so resposta CONCLUSIVA
// recusa; 429/timeout/erro adiam e pedem pra tentar de novo.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

(async () => {
  const criar = require('../lib/nf-pessoa');
  const sleep = () => Promise.resolve();

  // ── 1) o Bling em 429 em TODAS as chamadas: null, nao []
  {
    const nfp = criar({ chamarBling: async () => ({ ok: false, status: 429, error: 'rate limit' }), sleep });
    const r = await nfp.buscarNFsPorNumero('126421', null, { mesesAtras: 2 });
    ok(r === null, '⚠️ Bling em 429 em todas as sondas -> null (INDISPONIVEL), nao [] ("nao existe")');
  }
  // ── 2) o Bling responde mas a NF realmente nao existe: [] continua []
  {
    const nfp = criar({ chamarBling: async () => ({ ok: true, status: 200, data: { data: [] } }), sleep });
    const r = await nfp.buscarNFsPorNumero('126421', null, { mesesAtras: 2 });
    ok(Array.isArray(r) && r.length === 0, '  Bling respondeu vazio em tudo -> [] (nao existe mesmo) — nao virou null');
  }
  // ── 3) sondas MISTAS (algumas 429, alguma respondeu): segue, nao e indisponivel
  {
    let n = 0;
    const nfp = criar({ chamarBling: async () => (++n % 2 ? { ok: false, status: 429 } : { ok: true, status: 200, data: { data: [] } }), sleep });
    const r = await nfp.buscarNFsPorNumero('126421', null, { mesesAtras: 2 });
    ok(Array.isArray(r), '  sondas mistas (parte 429, parte vazia) -> lista (a busca andou; nao e indisponivel)');
  }

  // ── os 4 chamadores tratam null (Regra 4.14b: cada saida tem ramo em cada chamador)
  const semCom = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const [p, nome] of [['server.js', 'GOOD'], ['amb-devolucoes/lib-AMB/identificar-AMB.js', 'AMB/Girassol']]) {
    const s = semCom(p);
    ok(/if \(achadas === null\) \{ blingIndisponivel = true; achadas = \[\]; \}/.test(s), `  identificar ${nome}: trata o null`);
    ok(/O Bling NAO RESPONDEU ao procurar a NF/.test(s) && /ISSO NAO QUER DIZER QUE A NOTA NAO EXISTE/.test(s),
       `⚠️ identificar ${nome}: a mensagem diz "tente de novo", nao "confira o numero"`);
    ok(/blingIndisponivel \? 503 : 404/.test(s), `  identificar ${nome}: responde 503 (indisponivel), nao 404`);
    // e o ramo do indisponivel vem ANTES do "nao localizada"
    ok(s.indexOf('if (!idNF && blingIndisponivel)') < s.indexOf('nao localizada no Bling (procurei'), `  identificar ${nome}: o ramo do indisponivel vem antes do "nao localizada"`);
  }
  ok(/if \(achadas === null\)/.test(semCom('amb-devolucoes/lib-AMB/rotas-admin-AMB.js')) && /bling_indisponivel: true/.test(semCom('amb-devolucoes/lib-AMB/rotas-admin-AMB.js')),
     '  rotas-admin (raio-x da NF): trata o null');
  ok(/if \(achadas === null\)/.test(semCom('lib/rotas-debug.js')), '  rotas-debug: trata o null');
  // nenhum chamador esquecido
  const chamadas = [...fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').matchAll(/buscarNFsPorNumero\(/g)].length
    + [...fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8').matchAll(/await buscarNFsPorNumero\(/g)].length;
  ok(chamadas >= 2, `  os chamadores de producao estao cobertos (${chamadas} chamadas vistas)`);

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
