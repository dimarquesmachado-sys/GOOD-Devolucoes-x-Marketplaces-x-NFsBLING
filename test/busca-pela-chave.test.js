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
    ok(r.match === null, '  e se o detalhe mostrar OUTRA chave, recusa');
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
  ok(/chaveAcesso=' \+ ch/.test(GOOD), '  usando `chaveAcesso=` — a grafia `chave=` ignora o filtro');

  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const i = src.indexOf("'/api/admin/sem-retorno'");
    const rota = src.slice(i, i + 60000);
    const zero = rota.indexOf('FASE ZERO');
    const numero = rota.search(/for \(const item of (comNumero|vinculoCache\.fila\(itens, 'amb', 25, \(x\) => x\.nf_numero)/);
    ok(zero > 0 && numero > 0 && zero < numero,
       nome + ': a chave e a FASE ZERO, antes da busca por numero');
    ok(/nao ha NF com esta chave nesta conta/.test(rota),
       nome + ': e quando nao acha, diz que a chave nao esta nesta conta');
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
