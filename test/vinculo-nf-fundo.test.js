'use strict';
// 29/10 — estornadas da GOOD: 16 de 25 notas da Magalu 'nao localizada no Bling', mas a nota EXISTE (serie 001,
// propria). O vinculo era feito so na abertura (6s, ~3 cards) e guardado so na memoria (deploy apagava). Roda a peca
// de PRODUCAO (lib/vinculo-nf-cache): vinculo pela chave permanente no armazem + fila de segundo plano.
const fs = require('fs'); const path = require('path');
const vc = require('../lib/vinculo-nf-cache');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const ch = (n) => '3526103246198800018255001' + String(n).padStart(9, '0') + '1893419862';
function armazemFalso(inicial, { leituraFalha } = {}) {
  const arq = { ...(inicial || {}) }; let salvos = 0;
  const st = { falha: !!leituraFalha };
  return { arq, st, get salvos() { return salvos; },
    carregar: async (nome) => (arq[nome] ? JSON.parse(JSON.stringify(arq[nome])) : null),
    carregarComEstado: async (nome) => (st.falha ? { ok: false, erro: 'timeout' } : { ok: true, obj: arq[nome] ? JSON.parse(JSON.stringify(arq[nome])) : null }),
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
  const opsVistas = [];
  const buscar = async (c, op) => { opsVistas.push(op || {});
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
  ok(opsVistas.length === 4 && opsVistas.every((o) => o.fundo === true), '⚠️ Codex: a fila consulta o Bling no modo FUNDO (nao compete com o galpao)');
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
  // Codex: vinculo achado ANTES de o armazem carregar e gravado depois do carregamento
  vc.guardar({ nf_chave: ch(44444) }, 'cedo', 'chave', {}, 'teste4');
  const arm4 = armazemFalso();
  await vc.ligarArmazem('teste4', arm4);
  await new Promise((r) => setTimeout(r, 5600));
  ok(arm4.arq['vinculos-nf-chave'] && arm4.arq['vinculos-nf-chave'].v['teste4|chave:' + ch(44444)].id === 'cedo', '⚠️ Codex: vinculo achado antes do armazem carregar e gravado depois (nao fica so na memoria)');
  // Codex: leitura do armazem FALHOU — nao marca carregado e nao grava por cima do que esta guardado
  const arm5 = armazemFalso({ 'vinculos-nf-chave': { v: { ['teste5|chave:' + ch(1)]: { id: 'guardado' } } } }, { leituraFalha: true });
  const r5 = await vc.ligarArmazem('teste5', arm5);
  vc.guardar({ nf_chave: ch(2) }, 'novo', 'chave', {}, 'teste5');
  await new Promise((r) => setTimeout(r, 5600));
  ok(r5.ok === false && arm5.salvos === 0 && arm5.arq['vinculos-nf-chave'].v['teste5|chave:' + ch(1)].id === 'guardado', '⚠️ Codex: leitura falhou -> nao grava (nao apaga os vinculos guardados)');
  // Codex: o upload FALHOU ({ ok:false }, sem lancar) -> reagenda e grava na proxima tentativa
  const arm7 = armazemFalso(); let tentativas = 0; const salvarOk = arm7.salvar;
  arm7.salvar = async (n, o) => (++tentativas === 1 ? { ok: false, erro: 'rede' } : salvarOk(n, o));
  await vc.ligarArmazem('teste7', arm7);
  const stOrig = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => stOrig(fn, ms === 60000 ? 10 : ms === 5000 ? 10 : ms, ...a);   // encurta so as esperas da gravacao
  vc.guardar({ nf_chave: ch(7) }, 'x7', 'chave', {}, 'teste7');
  await new Promise((r) => stOrig(r, 300));
  global.setTimeout = stOrig;
  ok(tentativas === 2 && arm7.arq['vinculos-nf-chave'].v['teste7|chave:' + ch(7)].id === 'x7', '⚠️ Codex: upload falhou -> tenta de novo e grava (nao fica so na memoria)');
  // Codex: servidor drenando (deploy) -> a fila nao comeca outra consulta
  const dr = require('../lib/drenagem'); const orig = dr.estaDrenando; dr.estaDrenando = () => true;
  let chamadas = 0;
  const f6 = vc.completarChaveEmFundo([{ nf_chave: ch(61) }, { nf_chave: ch(62) }], 'teste6', async () => { chamadas++; return null; }, { pausaMs: 5 });
  await f6.promessa; dr.estaDrenando = orig;
  ok(chamadas === 0, '⚠️ Codex: com o servidor desligando, a fila de segundo plano para');
  // armazem de verdade: 'nao existe' x 'falhou' (Supabase de mentira)
  const { criarArmazem } = require('../lib/armazem-indices');
  const sbCom = (erro) => ({ storage: { from: () => ({ download: async () => ({ data: null, error: erro }) }) } });
  const nao = await criarArmazem({ obterSupabase: () => sbCom({ message: 'Object not found', statusCode: '404' }), chave: 'x' }).carregarComEstado('a');
  const falhou = await criarArmazem({ obterSupabase: () => sbCom({ message: 'fetch failed', statusCode: '500' }), chave: 'x' }).carregarComEstado('a');
  ok(nao.ok === true && nao.obj === null && falhou.ok === false, '  armazem: "arquivo nao existe" e diferente de "falhou a leitura"');
  // as duas buscas pela chave repassam o fundo
  for (const arq of ['lib/bling.js', 'amb-devolucoes/lib-AMB/admin-helpers-AMB.js']) {
    const s = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
    ok(/chamarBling\(url, opcoes\.fundo \? \{ fundo: true \} : \{\}\)/.test(s) && /buscarNFePorId\(lista\[0\]\.id, opcoes\.fundo \? \{ fundo: true \} : \{\}\)/.test(s), '  ' + arq + ': a busca pela chave repassa o modo fundo (lista e detalhe)');
  }
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
