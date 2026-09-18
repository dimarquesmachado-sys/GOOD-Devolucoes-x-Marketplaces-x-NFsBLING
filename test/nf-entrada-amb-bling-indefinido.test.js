// Roda com: node test/nf-entrada-amb-bling-indefinido.test.js
//
// Apontamento do Codex (inline, PR #322, P1):
//
//   `nf-entrada-AMB.js` (b372) trocou `const bling = require('./bling-AMB')`
//   por `blingPadrao`, mas dentro de `criar(cfgEmpresa)` nunca declarou o
//   `bling` que `construirIndice()` e `sondarTipos()` continuam usando.
//   Toda chamada (indice agendado, `/nf/entrada/sonda`, etc.) rejeitava com
//   `ReferenceError: bling is not defined` — o indice ficava frio pra
//   sempre, calado dentro do try/catch.
//
// Testado EXECUTANDO construirIndice() de verdade (regra da casa:
// comportamento, nao grep de fonte), com bling.chamarBling trocado por um
// mock. `node --check` nao pega isso: e um ReferenceError em tempo de
// execucao, nao um erro de sintaxe.

const nfEntradaFactory = require('../amb-devolucoes/lib-AMB/nf-entrada-AMB.js');
const configAMB = require('../amb-devolucoes/config-AMB.js');
const bling = require('../amb-devolucoes/lib-AMB/bling-AMB.js');
// ⚠️ b377 - o modulo agora EXIGE o cliente da empresa.
//
// Antes caia na instancia PADRAO, criada no require com o `config-AMB`
// fixo — a empresa nova usaria o Bling DA AMBTOTAL sem nada avisar.
//
// 📌 O teste ja substitui o `chamarBling` (e o que ele exercita), entao
// so preciso entregar o objeto pelo caminho novo.
// ⚠️ UMA instancia, criada aqui, pra o teste poder substituir o
// `chamarBling` NELA — antes ele substituia no MODULO, que agora nao tem
// instancia propria.
const blingDaEmpresa = require('../amb-devolucoes/lib-AMB/bling-AMB')
  .criar(require('../amb-devolucoes/config-AMB'));
const comCliente = (cfg) => Object.assign({}, cfg, { clienteBling: blingDaEmpresa });


let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const chamarBlingOriginal = blingDaEmpresa.chamarBling;

(async () => {
  try {
    blingDaEmpresa.chamarBling = async (url) => {
      if (url.startsWith('/nfe')) {
        return {
          ok: true, status: 200,
          data: { data: [{ id: '1', numero: '10', contato: { nome: 'Fulano De Tal' }, dataEmissao: new Date().toISOString(), numeroLoja: 'PED1' }] },
        };
      }
      return { ok: false, status: 400 };
    };

    const nf = nfEntradaFactory.criar(comCliente(configAMB));

    let erro = null;
    await nf.construirIndice().catch((e) => { erro = e; });

    ok(!erro, '⚠️ P1 (Codex): construirIndice() nao explode com ReferenceError: bling is not defined');

    const st = nf.statusIndice();
    ok(st.total === 1, '  o indice populou com a NF do mock (bling foi de fato chamado)');
    ok(!st.erro, '  sem erro registrado');

    const r = nf.jaEmitida({ pedido: 'PED1' });
    ok(r.emitida === true, '  jaEmitida acha a NF indexada pelo pedido');

    let erroSonda = null;
    await nf.sondarTipos().catch((e) => { erroSonda = e; });
    ok(!erroSonda, '⚠️ P1 (Codex): sondarTipos() tambem nao explode (mesma variavel bling)');
  } finally {
    blingDaEmpresa.chamarBling = chamarBlingOriginal;
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
