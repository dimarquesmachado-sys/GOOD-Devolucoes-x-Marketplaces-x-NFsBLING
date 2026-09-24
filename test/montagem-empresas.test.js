'use strict';
// ⚠️ UMA EMPRESA QUE FALHA NAO PODE DERRUBAR AS OUTRAS.
//
// Antes, `criarApp` lançando derrubava o boot inteiro: a GOOD e a AMB — que
// estão atendendo — ficavam fora por causa de uma env faltando na empresa
// NOVA. Já aconteceu em 18/09: 3 deploys falhados, 7 versões atrasado sem
// ninguém notar.
//
// 📌 Este teste cobre as DUAS versões da peça: a estrutura do Codex (freio
// por env, estado no health) e os 2 cuidados que ela perdia (503 que explica,
// derrubar quando nenhuma sobe).

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

  // ⚠️ o 503 que EXPLICA — para a que FALHOU e para a que foi FREADA.
  //
  // 404 mandaria o dono procurar no lugar errado nos dois casos: "nunca foi
  // configurada" quando na verdade falhou, ou quando foi ELE que desligou.
  const responder = (rota) => {
    const r = app.rotas.find((x) => x.rota === rota);
    if (!r) return null;
    let status = null; let corpo = null;
    r.handler({}, {
      status(s) { status = s; return this; },
      json(c) { corpo = c; return this; },
    });
    return { status, corpo };
  };

  const quebrada = responder('/quebrada');
  ok(quebrada && quebrada.status === 503,
     '⚠️ a rota da que FALHOU existe e responde 503 (nao 404)');
  ok(quebrada && quebrada.corpo.estado === 'falhou', '  dizendo que falhou');

  const freadaResp = responder('/girassol');
  ok(freadaResp && freadaResp.status === 503,
     '⚠️ e a rota da FREADA tambem (nao 404)');
  ok(freadaResp && freadaResp.corpo.estado === 'desativada_por_env',
     '  com estado diferente: foi o dono que desligou');

  // ⚠️ e NENHUM dos dois vaza a excecao — esta rota fica ANTES do login
  const vaza = (r) => JSON.stringify(r && r.corpo || {});
  ok(!/SESSION_SECRET/.test(vaza(quebrada)),
     '⚠️ e o corpo NAO entrega o nome da env (rota antes do login)');
  ok(!/SESSION_SECRET/.test(vaza(freadaResp)), '  nos dois casos');
}

// ── ⚠️ se NENHUMA montar, derruba ───────────────────────────────────
//
// Servir um app vazio que responde 200 no /health é pior que cair: o Render
// acha que está tudo bem, não reinicia, e ninguém percebe.
{
  const app = fazApp(); const logger = fazLog();
  let caiu = false;
  try {
    montarEmpresas({
      app, logger, ambiente: {},
      empresas: [{ chave: 'a', rota: '/a' }, { chave: 'b', rota: '/b' }],
      criarApp: () => { throw new Error('tudo quebrado'); },
    });
  } catch (e) { caiu = /NENHUMA empresa montou/.test(e.message); }
  ok(caiu, '⚠️ se TODAS falham, o processo cai (nao serve app vazio)');
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
