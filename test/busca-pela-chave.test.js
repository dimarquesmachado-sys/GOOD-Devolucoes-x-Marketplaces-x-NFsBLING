// Roda com: node test/busca-pela-chave.test.js
//
// [stated] "existiria alguma forma de eu relacionar o número da chave
// danfe, que fica dentro da NF? como eu pegaria isso, end point sei lá?"
//
// A resposta veio pela rota de diagnostico: `?chaveAcesso=` FUNCIONA.
// Testado com a NF 70115 da GOOD — 1 linha, chave certa, base de 5.
//
// Isso muda a arquitetura: pra todo caso que TEM chave, a busca e exata em
// uma chamada. Escada, candidatas e filtro de serie viram reserva pros que
// nao tem.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const CH = '35260332461988000182550010000701151290080214';   // a NF 70115, real

// ── a funcao, com o Bling simulado ──────────────────────────────────
{
  // simula a lib da AMB, que recebe tudo por injecao
  const criar = require('../amb-devolucoes/lib-AMB/admin-helpers-AMB.js');
  const mk = (respostaLista, respostaDetalhe) => criar({
    chamarBling: async () => respostaLista,
    chamarML: async () => ({}),
    buscarNFePorId: async () => respostaDetalhe || { ok: false },
    sleep: async () => {},
  });

  // 1 linha com a chave certa -> acha
  let h = mk({ ok: true, data: { data: [{ id: 25429008021, numero: '070115', chaveAcesso: CH }] } });
  h.buscarNFPelaChave(CH).then((r) => {
    ok(r.match && r.match.id === 25429008021, 'chave -> acha a nota em 1 chamada');
    ok(r.via === 'filtro_direto_chave', '  marcando de onde veio');
  });

  // 5 linhas = a API ignorou o filtro -> NAO aceita
  h = mk({ ok: true, data: { data: [{ id: 1, chaveAcesso: CH }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] } });
  h.buscarNFPelaChave(CH).then((r) => {
    ok(r.match === null && r.via === 'chave-ignorada',
       '5 linhas = filtro ignorado: NAO aceita, mesmo com a certa entre elas');
  });

  // 1 linha SEM chave -> confirma no detalhe
  h = mk({ ok: true, data: { data: [{ id: 77 }] } },
         { ok: true, data: { data: { id: 77, chaveAcesso: CH } } });
  h.buscarNFPelaChave(CH).then((r) => {
    ok(r.match && r.match.id === 77, 'lista sem chave: confirma no detalhe e aceita');
  });

  // 1 linha SEM chave e o detalhe diverge -> NAO aceita
  h = mk({ ok: true, data: { data: [{ id: 77 }] } },
         { ok: true, data: { data: { id: 77, chaveAcesso: '9'.repeat(44) } } });
  h.buscarNFPelaChave(CH).then((r) => {
    ok(r.match === null && r.via === 'chave-ignorada',
       '  e se o detalhe mostrar OUTRA chave, e filtro IGNORADO — nao "nao achou" (esfriaria 20min)');
  });

  // chave invalida
  h = mk({});
  h.buscarNFPelaChave('123').then((r) => {
    ok(r.ok === false && r.motivo === 'chave invalida', 'chave curta nem chama a API');
  });

  // b221.1: nota CANCELADA nao serve, nem pela chave
  h = mk({ ok: true, data: { data: [{ id: 5, chaveAcesso: CH, situacao: 2 }] } });
  h.buscarNFPelaChave(CH).then((r) => {
    ok(r.match === null && r.via === 'chave-nota-morta',
       'nota cancelada (situacao 2): recusa, com o motivo');
  });

  // b221.1: falha no detalhe NAO e "nao achou"
  h = mk({ ok: true, data: { data: [{ id: 77 }] } }, { ok: false, status: 429 });
  h.buscarNFPelaChave(CH).then((r) => {
    ok(r.ok === false && r.error === 'detalhe falhou',
       'detalhe com 429: erro, nao "chave-nao-achou" — senao esfriava o item por 20min');
  });

  // b221.1: cancelamento pelo chamador
  h = mk({ ok: true, data: { data: [{ id: 77 }] } }, { ok: true, data: { data: { id: 77, chaveAcesso: CH } } });
  h.buscarNFPelaChave(CH, { cancelar: { agora: true } }).then((r) => {
    ok(r.ok === false && r.error === 'cancelado',
       'chamador desistiu: a helper para antes do detalhe');
  });

  // b221.2: 200 com corpo estranho e ERRO, nao "nao achou"
  h = mk({ ok: true, data: { data: 'nao-e-array' } });
  h.buscarNFPelaChave(CH).then((r) => {
    ok(r.ok === false && r.error === 'resposta sem lista',
       '200 sem lista: erro (quinta vez desta familia) — senao esfriava o item');
  });

  // b221.6: detalhe SEM chave nenhuma = resposta inutil, nao "nao achou"
  h = mk({ ok: true, data: { data: [{ id: 77 }] } }, { ok: true, data: { data: { id: 77 } } });
  h.buscarNFPelaChave(CH).then((r) => {
    ok(r.ok === false && r.error === 'detalhe sem chave',
       'detalhe 200 mas sem chaveAcesso: ERRO — nao confirmo nem nego (esfriaria 20min)');
  });

  // b221.3: UMA linha com OUTRA chave = o filtro nao funcionou
  h = mk({ ok: true, data: { data: [{ id: 9, chaveAcesso: '9'.repeat(44) }] } });
  h.buscarNFPelaChave(CH).then((r) => {
    ok(r.match === null && r.via === 'chave-ignorada',
       'uma linha com chave DIFERENTE: filtro ignorado, nao "chave-nao-achou"');
  });

  // erro da API
  h = mk({ ok: false, status: 429 });
  h.buscarNFPelaChave(CH).then((r) => {
    ok(r.ok === false && r.status === 429, 'erro da API passa adiante, com o status');
  });
}

// ── e e a FASE ZERO nas duas empresas ───────────────────────────────
setTimeout(() => {
  const GOOD = fs.readFileSync(path.join(RAIZ, 'lib', 'bling.js'), 'utf8');
  ok(/async function buscarNFPelaChave/.test(GOOD), 'a GOOD tem a funcao');
  ok(/buscarNFPelaChave,/.test(GOOD.slice(GOOD.indexOf('module.exports'))), '  e exporta');
  ok(/tipo=1&chaveAcesso=' \+ ch/.test(GOOD),
     '  usando `tipo=1&chaveAcesso=` — so nota de SAIDA; a de entrada tem chave tambem');
  ok(/async function comCancelamento/.test(GOOD),
     'o cancelamento vale DENTRO da chamada, e limpa o vigia ao terminar');
  const CACHE = fs.readFileSync(path.join(RAIZ, 'lib', 'vinculo-nf-cache.js'), 'utf8');
  ok(/if \(v\.numero && v\.via === 'chave'\) item\.nf_numero = v\.numero;/.test(CACHE),
     'o cache SOBRESCREVE o numero so quando veio da CHAVE — as outras fases gravam o capturado');

  // b221.3: rodizio curto pra falha transitoria
  const c = require('../lib/vinculo-nf-cache.js');
  c._CACHE.clear();
  const lento = { nf_chave: '5'.repeat(44) };
  c.adiarPouco(lento, 'good', 'chave');
  ok(c.esperando(lento, 'good', 'chave') === true,
     'item que deu timeout sai da frente (adiarPouco)');
  ok(/vinculoCache\.adiarPouco\(item, /.test(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8')),
     '  e a fase zero usa isso na falha transitoria — senao os mesmos lentos travavam a fila');

  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const i = src.indexOf("'/api/admin/sem-retorno'");
    const rota = src.slice(i, i + 60000);
    const zero = rota.indexOf('FASE ZERO');
    const numero = rota.search(/for \(const item of (comNumero|vinculoCache\.fila\(itens, 'amb', 25, \(x\) => x\.nf_numero)/);
    ok(zero > 0 && numero > 0 && zero < numero,
       nome + ': a chave e a FASE ZERO, antes da busca por numero');
    // b221.4: cada resposta da fase zero tem seu ramo, e o motivo esta no
    // ramo ALCANCAVEL (antes ficou dentro do de falha transitoria)
    const z = rota.slice(rota.indexOf('FASE ZERO'), rota.indexOf('FASE ZERO') + 4500);
    ok(/r\.via === 'chave-nao-achou'\) \{[\s\S]{0,400}marcarFalha[\s\S]{0,200}nao ha NF com esta chave/.test(z),
       nome + ': vazio de verdade -> esfria 20min E recebe o motivo (no ramo certo)');
    ok(/r\.via === 'chave-nota-morta'\) \{[\s\S]{0,300}marcarFalha/.test(z),
       nome + ': nota cancelada -> esfria 20min, com a situacao no motivo');
    ok(/\} else \{[\s\S]{0,400}adiarPouco/.test(z) && !/chave-ignorada'\) \{[\s\S]{0,200}marcarFalha/.test(z),
       nome + ': filtro ignorado e falha transitoria -> adia 2min, NAO 20');
    ok(/if \(r\.match\.numero\) item\.nf_numero = String\(r\.match\.numero\)/.test(rota),
       nome + ': o numero da nota achada SOBRESCREVE o capturado — a chave e a autoridade');
    ok(/cancelar\.agora = true/.test(rota),
       nome + ': o prazo CANCELA a chamada, nao so abandona');
  }
  {
    const s = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
    ok(/const buscarNFPelaChave = blingClient\.buscarNFPelaChave/.test(s),
       'GOOD: a funcao esta REEXPORTADA no server.js (a 4a fantasma passou por aqui)');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
}, 300);
