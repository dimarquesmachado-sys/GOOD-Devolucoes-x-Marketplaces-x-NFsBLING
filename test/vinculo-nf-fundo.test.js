'use strict';
// 29/10 — estornadas da GOOD: 16 de 25 notas da Magalu 'nao localizada no Bling', mas a nota EXISTE (serie 001,
// propria). O vinculo era feito so na abertura (6s, ~3 cards) e guardado so na memoria (deploy apagava). Roda a peca
// de PRODUCAO (lib/vinculo-nf-cache): vinculo pela chave permanente no armazem + fila de segundo plano.
const fs = require('fs'); const path = require('path');
const vc = require('../lib/vinculo-nf-cache');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const ch = (n) => '3526103246198800018255001' + String(n).padStart(9, '0') + '1893419862';
function armazemFalso(inicial) {
  const arq = { ...(inicial || {}) }; let salvos = 0;
  return { arq, get salvos() { return salvos; },
    carregar: async (nome) => (arq[nome] ? JSON.parse(JSON.stringify(arq[nome])) : null),
    salvar: async (nome, obj) => { salvos++; arq[nome] = JSON.parse(JSON.stringify(obj)); return { ok: true } } };
}
(async () => {
  // 1) boot: carrega do armazem o que ja foi achado (deploy nao apaga)
  const kAntigo = 'teste1|chave:' + ch(69252);
  const arm1 = armazemFalso({ 'vinculos-nf-chave': { v: { [kAntigo]: { id: '999', numero: '069252', serie: '1', chave: ch(69252) } } } });
  const r1 = await vc.ligarArmazem('teste1', arm1);
  const it1 = [{ nf_chave: ch(69252), nf_numero: '69252', marketplace: 'magalu' }];
  vc.aplicar(it1, 'teste1');
  ok(r1.carregados === 1 && it1[0].nf_id_bling === '999' && it1[0].nf_numero === '069252' && it1[0].nf_achada_por === 'chave',
    '⚠️ depois de um deploy, o vinculo pela chave volta do armazem (antes: perdido)');
  // 2) permanente nao expira (o de 12h expirava)
  vc._CACHE.get(kAntigo).em = Date.now() - 48 * 3600 * 1000;
  ok(!!vc.ler({ nf_chave: ch(69252) }, 'teste1'), '  vinculo pela chave nao expira em 12h');
  // 3) fila de segundo plano: acha, 'nao existe' conclusivo, e 'nao sei' que tenta de novo
  const arm2 = armazemFalso();
  await vc.ligarArmazem('teste2', arm2);
  const itens = [
    { nf_chave: ch(80848), nf_numero: '80848' },    // existe
    { nf_chave: ch(80316), nf_numero: '80316' },    // existe
    { nf_chave: ch(11111), nf_numero: '11111' },    // nao existe nesta conta
    { nf_chave: ch(22222), nf_numero: '22222' },    // Bling fora (nao sei)
    { nf_numero: '33333' },                         // sem chave: nao entra
  ];
  const buscar = async (c) => {
    if (c === ch(80848)) return { ok: true, match: { id: 'id80848', numero: '080848' } };
    if (c === ch(80316)) return { ok: true, match: { id: 'id80316', numero: '080316' } };
    if (c === ch(11111)) return { ok: true, via: 'chave-nao-achou', match: null };
    return { ok: false, status: 429, match: null };
  };
  const f = vc.completarChaveEmFundo(itens, 'teste2', buscar, { pausaMs: 5 });
  ok(f.iniciada && f.pendentes === 4 && itens.slice(0, 4).every((x) => x.nf_vinculo_pendente) && !itens[4].nf_vinculo_pendente,
    '⚠️ os cards com chave que ficaram sem vez vao pra fila e ja saem marcados "procurando"');
  ok(vc.completarChaveEmFundo(itens, 'teste2', buscar).iniciada === false, '  uma fila por empresa por vez (nao duplica)');
  await f.promessa;
  const proxima = [{ nf_chave: ch(80848) }, { nf_chave: ch(80316) }, { nf_chave: ch(11111) }, { nf_chave: ch(22222) }];
  vc.aplicar(proxima, 'teste2');
  ok(proxima[0].nf_id_bling === 'id80848' && proxima[1].nf_id_bling === 'id80316', '⚠️ a PROXIMA abertura ja vem vinculada (80848 e 80316)');
  ok(vc.esperando(proxima[2], 'teste2', 'chave') && !proxima[2].nf_id_bling, '  "nao existe nesta conta" (conclusivo) esfria como antes');
  ok(!vc.esperando(proxima[3], 'teste2', 'chave') && !proxima[3].nf_id_bling, '  "nao sei" (429) nao esfria — a proxima abertura tenta de novo');
  await new Promise((r) => setTimeout(r, 5600));
  const salvo = arm2.arq['vinculos-nf-chave'];
  ok(salvo && salvo.v && salvo.v['teste2|chave:' + ch(80848)] && salvo.v['teste2|chave:' + ch(80848)].id === 'id80848', '⚠️ o que a fila achou foi GRAVADO no armazem (sobrevive a deploy)');
  // 4) nao grava antes de carregar (senao apagaria o que estava guardado)
  const arm3 = armazemFalso({ 'vinculos-nf-chave': { v: { ['teste3|chave:' + ch(1)]: { id: 'velho' } } } });
  vc.guardar({ nf_chave: ch(2) }, 'novo', 'chave', {}, 'teste3');
  await new Promise((r) => setTimeout(r, 5600));
  ok(arm3.salvos === 0 && arm3.arq['vinculos-nf-chave'].v['teste3|chave:' + ch(1)].id === 'velho', '  sem armazem ligado/carregado, nao grava (nao apaga o que estava guardado)');
  // 5) quem usa
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const fab = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/vinculoCache\.completarChaveEmFundo\(itens, empresa, buscarNFPelaChave\)/.test(srv) && /drenagem\.daquiA\(\(\) => vinculoCache\.ligarArmazem\('good'/.test(srv), '⚠️ GOOD: fila de segundo plano na rota e armazem ligado no boot');
  ok(/vinculoCache\.completarChaveEmFundo\(itens, CHAVE_DADOS,/.test(fab) && /vinculoCache\.ligarArmazem\(CHAVE_DADOS, CFG_EMPRESA\.armazemNfNomes\)/.test(fab), '⚠️ Girassol/AMB: idem');
  const painel = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
  ok(/x\.nf_vinculo_pendente\s*\?\s*'🔄 NF '/.test(painel), '  painel: card na fila diz "procurando no Bling", nao "nao localizada"');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
