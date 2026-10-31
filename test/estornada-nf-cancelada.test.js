'use strict';
// 30/10 — estornadas sem retorno: 'casos resolvidos por CANCELAMENTO da NF de venda reaparecem aqui' (aviso da propria
// rota), com o botao de gerar devolucao contra nota morta. E o vinculo permanente do #509 podia ter sido feito ANTES
// do cancelamento. Roda a peca de PRODUCAO (lib/vinculo-nf-cache) e confere as duas rotas.
const fs = require('fs'); const path = require('path');
const vc = require('../lib/vinculo-nf-cache');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const ch = (n) => '3526103246198800018255001' + String(n).padStart(9, '0') + '1893419862';
function armazem() { const arq = {}; return { arq, carregarComEstado: async (n) => ({ ok: true, obj: arq[n] ? JSON.parse(JSON.stringify(arq[n])) : null }),
  salvar: async (n, o) => { arq[n] = JSON.parse(JSON.stringify(o)); return { ok: true }; } }; }
(async () => {
  // 1) nota morta: permanente, aplicada ate no card que ja veio com id do banco, e gravada no armazem
  const arm = armazem(); await vc.ligarArmazem('canc1', arm);
  vc.marcarMorta({ nf_chave: ch(1) }, 'canc1', 2);
  const card = { nf_chave: ch(1), nf_id_bling: '123' };
  vc.aplicar([card], 'canc1');
  ok(card.nf_cancelada === true && card.nf_situacao === 2, '⚠️ NF de venda cancelada marca o card (mesmo o que ja veio com id do banco)');
  await new Promise((r) => setTimeout(r, 5600));
  const salvo = arm.arq['vinculos-nf-chave'] && arm.arq['vinculos-nf-chave'].v['canc1|chave:' + ch(1)];
  ok(salvo && salvo.morta === true && salvo.situacao === 2, '  a marca de nota morta vai pro armazem (sobrevive a deploy)');
  const arm2 = { carregarComEstado: async () => ({ ok: true, obj: { v: { ['canc2|chave:' + ch(2)]: { morta: true, situacao: 9 } } } }), salvar: async () => ({ ok: true }) };
  await vc.ligarArmazem('canc2', arm2);
  const c2 = { nf_chave: ch(2) }; vc.aplicar([c2], 'canc2');
  ok(c2.nf_cancelada === true && c2.nf_situacao === 9, '  depois de um deploy, a nota denegada volta do armazem como morta');
  // 2) fila: busca da chave devolve nota morta -> marca permanente (antes: esfriava 20 min e voltava)
  const itens = [{ nf_chave: ch(3), nf_numero: '3' }];
  const f = vc.completarChaveEmFundo(itens, 'canc3', async () => ({ ok: true, via: 'chave-nota-morta', situacao: 2, match: null }), { pausaMs: 5 });
  await f.promessa;
  const c3 = { nf_chave: ch(3) }; vc.aplicar([c3], 'canc3');
  ok(c3.nf_cancelada === true, '⚠️ a fila de segundo plano que acha a nota cancelada marca permanente');
  // 3) revalidacao: vinculado ANTES do cancelamento, ainda cancelavel (prazo > 0) e conferido ha mais de 1h
  vc.guardar({ nf_chave: ch(4) }, 'id4', 'chave', { checado_em: Date.now() - 2 * 3600e3 }, 'canc4');
  vc.guardar({ nf_chave: ch(5) }, 'id5', 'chave', { checado_em: Date.now() - 2 * 3600e3 }, 'canc4');
  vc.guardar({ nf_chave: ch(6) }, 'id6', 'chave', { checado_em: Date.now() - 60e3 }, 'canc4');
  const lista = [
    { nf_chave: ch(4), prazo_cancelamento: 12 },   // cancelavel, velho -> reconfere (e esta cancelada)
    { nf_chave: ch(5), prazo_cancelamento: 0 },    // prazo acabou -> nao reconfere
    { nf_chave: ch(6), prazo_cancelamento: 12 },   // conferido ha 1 min -> nao reconfere
  ];
  vc.aplicar(lista, 'canc4');
  const consultadas = [];
  const f4 = vc.completarChaveEmFundo(lista, 'canc4', async (c) => { consultadas.push(c); return { ok: true, via: 'chave-nota-morta', situacao: 2, match: null }; }, { pausaMs: 5 });
  await f4.promessa;
  ok(consultadas.length === 1 && consultadas[0] === ch(4), '⚠️ so reconfere quem AINDA pode ser cancelado e nao foi conferido na ultima hora (1 de 3)');
  const depois = [{ nf_chave: ch(4), nf_id_bling: 'id4' }]; vc.aplicar(depois, 'canc4');
  ok(depois[0].nf_cancelada === true, '⚠️ vinculo feito antes do cancelamento: a reconferencia pega a nota morta');
  ok(!lista[0].nf_vinculo_pendente, '  reconferencia nao marca o card como "procurando"');
  // 4) as duas rotas tiram o cancelado da lista e marcam permanente na fase da chave
  for (const [arq, emp] of [['server.js', 'empresa'], ['amb-devolucoes/app-AMB.js', 'CHAVE_DADOS']]) {
    const s = fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
    ok(s.includes('vinculoCache.marcarMorta(item, ' + emp + ', r.situacao);') && /itens\.splice\(i, 1\); canceladasOcultas\+\+;/.test(s) && /canceladas_ocultas: canceladasOcultas,/.test(s),
      '⚠️ ' + arq + ': NF de venda cancelada sai da lista (canceladas_ocultas) e a marca e permanente');
  }
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
