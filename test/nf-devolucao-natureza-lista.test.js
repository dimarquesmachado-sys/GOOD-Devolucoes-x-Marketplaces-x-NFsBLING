'use strict';
// ⚠️ `naturezasDevolucaoIds()` DEVOLVE UMA LISTA, nao um id so.
//
// Apontamento do Codex no PR #341: `acharNfDevolucaoBling` (lib/nf-pessoa.js)
// recebe `naturezaId` e comparava a NF inteira contra ELE como string unica
// (`=== natureza`). Mas o campo da ficha que os dois chamadores passam
// (`fiscal.naturezasDevolucaoIds()`) pode vir com VARIAS naturezas separadas
// por virgula — e' o formato dela em lib/empresas.js (ex. GOOD
// '5776118802,15110882187'). Com uma lista, a comparacao nunca batia com
// nenhuma NF: nenhuma nota de devolucao seria encontrada, e o painel
// liberaria gerar uma SEGUNDA nota pra uma volta que ja tinha nota.
//
// 📌 O teste EXECUTA a funcao real com uma dependencia falsa do Bling, nao
// so confere o texto do arquivo.

const criarNfPessoa = require('../lib/nf-pessoa');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

async function rodar() {
  const NF_COM_2A_NATUREZA = {
    id: 999, numero: '456', serie: '1',
    dataEmissao: '2026-01-10', chaveAcesso: 'abc',
    naturezaOperacao: { id: '15110882187' },   // a 2a da lista, nao a 1a
    contato: { nome: 'JOAO DA SILVA' },
    valorNota: 100,
  };

  const chamarBling = async (url) => {
    if (/^\/nfe\?/.test(url)) {
      // so a pagina 1 tem dado; as seguintes fecham o laco (lista < 100)
      if (/pagina=1/.test(url)) return { ok: true, data: { data: [NF_COM_2A_NATUREZA] } };
      return { ok: true, data: { data: [] } };
    }
    if (/^\/nfe\/999$/.test(url)) {
      return { ok: true, data: { data: { itens: [{ codigo: 'SKU-ABC' }] } } };
    }
    return { ok: false };
  };

  const nfp = criarNfPessoa({ chamarBling, sleep: async () => {} });

  // ── a lista com a natureza CERTA na 2a posicao precisa achar a NF ───
  const r = await nfp.acharNfDevolucaoBling({
    cliente: 'JOAO DA SILVA', sku: 'SKU-ABC',
    desde: '2026-01-01', naturezaId: '111,15110882187',
  });
  ok(r.ok === true && r.achou === true && r.nf && r.nf.id === 999,
     'acha a NF quando a natureza dela e a 2a de uma lista separada por virgula');

  // ── sem a natureza da NF na lista, continua nao achando (nao virou "aceita tudo") ─
  const r2 = await nfp.acharNfDevolucaoBling({
    cliente: 'JOAO DA SILVA', sku: 'SKU-ABC',
    desde: '2026-01-01', naturezaId: '111,222',
  });
  ok(r2.ok === true && r2.achou === false,
     '  e continua RECUSANDO quando nenhuma natureza da lista bate (sem falso positivo)');

  // ── sem naturezaId nenhum, continua recusando com motivo (nao busca tudo) ──
  const r3 = await nfp.acharNfDevolucaoBling({
    cliente: 'JOAO DA SILVA', sku: 'SKU-ABC', desde: '2026-01-01',
  });
  ok(r3.ok === false && /natureza/.test(r3.motivo),
     '  e sem naturezaId nenhum, recusa com motivo (nao procura sem natureza)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
}

rodar();
