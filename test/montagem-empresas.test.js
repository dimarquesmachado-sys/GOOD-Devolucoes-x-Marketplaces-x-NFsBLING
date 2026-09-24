'use strict';
// ⚠️ UMA EMPRESA QUE FALHA NAO PODE DERRUBAR AS OUTRAS.
//
// Antes, `criarApp` lançando derrubava o boot inteiro: a GOOD e a AMB — que
// estão atendendo — ficavam fora por causa de uma env faltando na empresa
// NOVA. Já aconteceu em 18/09: 3 deploys falhados, 7 versões atrasado sem
// ninguém notar.
//
// 📌 Este teste cobre a estrutura do Codex (freio por env, estado no health)
// e o cuidado que ela perdia (503 que explica, em vez de 404).
//
// ⚠️ (achado do Codex, P1) - este arquivo TINHA um 3o caso, "se nenhuma
// montar, o processo cai" — só que `empresas` aqui é sempre as de FORA (a
// AMB, e um dia a Girassol); a GOOD é o host que chama `montarEmpresas` e
// nunca entra nessa lista. Com 1 empresa ativa (o caso de hoje), a falha
// dela batia "nenhuma montou" e o `throw` derrubava o processo inteiro —
// reproduzindo o incidente de 18/09 que este módulo existe pra evitar. O
// caso abaixo prova o oposto: falhar todas as empresas de fora NUNCA lança.

const { montarEmpresas, diagnostico, freada, nomeFreio } =
  require('../lib/montagem-empresas');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const fazApp = () => {
  const rotas = [];
  return { rotas, use: (rota, h) => rotas.push({ rota, handler: h }) };
};
const fazLog = () => {
  const linhas = [];
  const push = (m) => linhas.push(String(m));
  return { linhas, log: push, warn: push, error: push };
};

// ── a falha fica contida ────────────────────────────────────────────
{
  const app = fazApp(); const logger = fazLog();
  const empresas = [
    { chave: 'ambtotal', rota: '/amb' },
    { chave: 'quebrada', rota: '/quebrada' },
    { chave: 'girassol', rota: '/girassol' },
    { chave: 'quarta', rota: '/quarta' },
  ];
  const criarApp = (c) => {
    if (c === 'quebrada') throw new Error('SESSION_SECRET ausente');
    return { empresa: c };
  };
  const r = montarEmpresas({
    app, empresas, criarApp,
    ambiente: { DEVOLUCOES_DESATIVAR_GIRASSOL: '1' }, logger,
  });

  const montadas = r.filter((x) => x.estado === 'montada').map((x) => x.chave);
  ok(montadas.join(',') === 'ambtotal,quarta',
     '⚠️ a quebrada e a freada saem; as outras montam');
  ok(r.find((x) => x.chave === 'quebrada').estado === 'falhou',
     '  e a que falhou e NOMEADA no diagnostico');
  ok(r.find((x) => x.chave === 'girassol').estado === 'desativada_por_env',
     '  e a freada aparece como desativada (nao como falha)');
  ok(logger.linhas.some((l) => /as outras continuam/.test(l)),
     '  e o log diz que a falha foi contida');

  // ⚠️ o 503 que EXPLICA — a versão só-estrutura perdia isto
  const rotaQuebrada = app.rotas.find((x) => x.rota === '/quebrada');
  ok(!!rotaQuebrada, '⚠️ a rota da quebrada EXISTE (nao da 404)');
  if (rotaQuebrada) {
    let status = null; let corpo = null;
    rotaQuebrada.handler({}, {
      status(s) { status = s; return this; },
      json(c) { corpo = c; return this; },
    });
    ok(status === 503, '  e responde 503');
    ok(corpo && /SESSION_SECRET/.test(corpo.motivo || ''),
       '⚠️ com o MOTIVO no corpo (404 mandaria procurar no lugar errado)');
  }
}

// ── ⚠️ mesmo que NENHUMA monte, o processo NAO cai ──────────────────
//
// `empresas` aqui é só as de FORA — a GOOD (o host) já está no ar antes
// deste módulo rodar, com ou sem nenhuma delas. Lançar aqui derrubaria a
// GOOD junto, e com 1 única empresa ativa (o caso de hoje) "nenhuma montou"
// é exatamente "a única falhou" — o incidente de 18/09 de novo.
{
  const app = fazApp(); const logger = fazLog();
  let caiu = false;
  let r = null;
  try {
    r = montarEmpresas({
      app, logger, ambiente: {},
      empresas: [{ chave: 'a', rota: '/a' }, { chave: 'b', rota: '/b' }],
      criarApp: () => { throw new Error('tudo quebrado'); },
    });
  } catch (e) { caiu = true; }
  ok(!caiu, '⚠️ mesmo as DUAS empresas de fora falhando, nada e lancado');
  ok(r && r.every((x) => x.estado === 'falhou'),
     '  as duas ficam nomeadas como falha no diagnostico');

  // ⚠️ o caso REAL de hoje: uma unica empresa ativa (a AMB) e ela falha.
  const app2 = fazApp(); const logger2 = fazLog();
  let caiu2 = false;
  try {
    montarEmpresas({
      app: app2, logger: logger2, ambiente: {},
      empresas: [{ chave: 'ambtotal', rota: '/amb' }],
      criarApp: () => { throw new Error('AMB_SESSION_SECRET ausente'); },
    });
  } catch (e) { caiu2 = true; }
  ok(!caiu2, '⚠️ a UNICA empresa ativa falhando tambem nao derruba o processo');
}

// ── ⚠️ mas tudo DESATIVADO nao e falha ──────────────────────────────
//
// Se o dono freou todas, isso é escolha dele — derrubar seria transformar uma
// decisão em incidente.
{
  const app = fazApp(); const logger = fazLog();
  let caiu = false;
  try {
    montarEmpresas({
      app, logger,
      empresas: [{ chave: 'a', rota: '/a' }],
      criarApp: () => ({}),
      ambiente: { DEVOLUCOES_DESATIVAR_A: '1' },
    });
  } catch (e) { caiu = true; }
  ok(!caiu, '⚠️ todas FREADAS nao derruba (e escolha do dono, nao falha)');
}

// ── o freio, e uma quarta empresa sem codigo novo ───────────────────
{
  ok(nomeFreio('quarta') === 'DEVOLUCOES_DESATIVAR_QUARTA',
     '⚠️ o freio vale pra uma 4a empresa sem mexer em codigo');
  ok(freada('x', { DEVOLUCOES_DESATIVAR_X: 'sim' }), '  aceita sim/1/true/on');
  ok(!freada('x', { DEVOLUCOES_DESATIVAR_X: '0' }), '  e 0 nao freia');
  ok(!freada('x', {}), '  e sem a env, nao freia');
}

// ── lista vazia nao e falha ─────────────────────────────────────────
{
  const app = fazApp();
  let caiu = false;
  try { montarEmpresas({ app, empresas: [], criarApp: () => ({}), logger: fazLog() }); }
  catch (e) { caiu = true; }
  ok(!caiu, '  lista vazia nao derruba (contrato sem empresa ativa)');
  ok(diagnostico().length === 0, '  e o diagnostico fica vazio');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
