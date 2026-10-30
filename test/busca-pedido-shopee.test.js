'use strict';
// 29/10 — dono digitou o pedido Shopee 2609069UWS4UFX (tosquiadeira R$ 1.574,90, entregue e nunca conferida) e o
// sistema leu 'NF 26090694'. Monta a ROTA DE PRODUCAO da identificacao (Girassol/AMB) com dependencias de mentira e
// confere: o pedido vai pra Shopee primeiro e nunca vira numero de NF. E a GOOD e a tela unica seguem a mesma regra.
const path = require('path'); const fs = require('fs');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const nulo = async () => null;
function montar(shopeeHit, magaluFake) {
  const rotas = {};
  const app = { get: (p, ...f) => { rotas[p] = f[f.length - 1]; }, post() {}, put() {}, delete() {}, use() {} };
  const consultasNF = [];
  const deps = {
    chaveDados: 'girassol', pastaCheckout: 'girassol-backup-offline', requerLogin: (q, r, n) => n && n(), sleep: async () => {},
    chamarML: async () => ({ ok: false, status: 404 }), chamarBling: async () => ({ ok: false, status: 404 }), chamarMagalu: async () => ({ ok: false, status: 404 }),
    buscarNFnoML: nulo, buscarNFePorId: nulo, buscarNFBlindada: async () => ({ ok: false, nf: null }),
    buscarNFnoBlingPorNumero: async (n) => { consultasNF.push(n); return null; },
    buscarNFsPorNumero: async (n) => { consultasNF.push(n); return []; },
    mapItensNF: () => [], resolverIdNFPorChave: nulo, buscarClaimsPorShipment: nulo, buscarClaimDetalhada: nulo, buscarReturnPorClaim: nulo,
    buscarOrderViaShipmentReturn: nulo, buscarOrdersPorComprador: nulo, classificarMotivoDevolucao: () => null, acharDevolucao: nulo, buscarPorNome: nulo,
    shopee: { cfg: { ativo: true }, acharDevolucao: async (c) => (shopeeHit && String(c).trim() === shopeeHit.order_sn ? { hit: shopeeHit, qtd: 1 } : { hit: null, qtd: 0 }),
      buscarDevolucoesProxy: async () => [], consultarPedidoCancelado: nulo },
    magalu: magaluFake || { cfg: { ativo: false } }, nfNomes: { buscarPorNumero: () => null, statusIndice: () => ({}) },
    tiktokPonte: null, tiktokDev: null, mlReturns: { acharPorTracking: () => null, statusIndice: () => ({}) }, espreitaMontada: () => null,
    aguardarVezBling: async () => {}, supabase: null, db: { ligado: () => false },
  };
  const arq = path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js');
  delete require.cache[require.resolve(arq)];
  require(arq)(app, deps);
  const chamar = (codigo) => new Promise((resolve) => {
    const res = { _s: 200, status(s) { this._s = s; return this; }, json(o) { resolve({ status: this._s, corpo: o }); }, set() { return this; } };
    Promise.resolve(rotas['/api/devolucao/identificar/:codigo']({ params: { codigo }, query: {}, headers: {}, usuario: 'teste' }, res)).catch((e) => resolve({ erro: e }));
  });
  return { chamar, consultasNF };
}
(async () => {
  const HIT = { order_sn: '2609069UWS4UFX', return_sn: '2609110RFJFHEP7', tracking_number: 'AP487838326BR', status: 'ACCEPTED', reason: 'CHANGE_MIND',
    itens: [{ nome: 'Tosquiadeira 550W', sku: '6676-220v', qtd: 1 }] };
  // 1) pedido Shopee que esta na lista: vai pra Shopee primeiro
  { const m = montar(HIT); const r = await m.chamar('2609069UWS4UFX');
    const t = (r.corpo && r.corpo.tentativas) || [];
    ok(t.some((x) => x.tipo === 'shopee_return' && x.ok), '⚠️ pedido Shopee 2609069UWS4UFX: a Shopee e consultada PRIMEIRO e acha (antes: lido como "NF 26090694")');
    ok(!t.some((x) => x.tipo === 'numero_nf') && !m.consultasNF.includes('26090694'), '⚠️ e nunca vira numero de NF (nenhuma busca pela "NF 26090694")'); }
  // 2) pedido Shopee que NAO esta na lista: ainda assim nao vira NF
  { const m = montar(null); const r = await m.chamar('260813898DFEWW');
    const t = (r.corpo && r.corpo.tentativas) || [];
    ok(!t.some((x) => x.tipo === 'numero_nf') && !m.consultasNF.includes('260813898'), '⚠️ pedido Shopee fora da lista: nao vira "NF 260813898" (protecao que a GOOD ja tinha)'); }
  // 3) numero de NF de verdade continua sendo NF
  { const m = montar(null); const r = await m.chamar('124729');
    const t = (r.corpo && r.corpo.tentativas) || [];
    ok(t.some((x) => x.tipo === 'numero_nf') || m.consultasNF.includes('124729'), '  numero de NF de verdade (124729) continua buscado como NF'); }
  // 29/10: com a Shopee ja tendo achado, a Magalu NAO e consultada (antes: 'magalu_devolucao: 26090694 -> 404')
  { let chamadas = 0;
    const mag = { cfg: { ativo: true, autorizado: true }, acharDevolucao: async () => { chamadas++; return null; } };
    const m = montar(HIT, mag); const r = await m.chamar('2609069UWS4UFX');
    const t = (r.corpo && r.corpo.tentativas) || [];
    ok(chamadas === 0 && !t.some((x) => x.tipo === 'magalu_devolucao'), '⚠️ Shopee achou: a Magalu nao e consultada a toa (sem "magalu_devolucao 26090694 -> 404")'); }
  { let chamadas = 0;
    const mag = { cfg: { ativo: true, autorizado: true }, acharDevolucao: async () => { chamadas++; return null; } };
    const m = montar(null, mag); await m.chamar('260813898DFEWW');
    ok(chamadas === 1, '  Shopee NAO achou: a Magalu continua sendo a reserva (fallback tardio mantido)'); }
  // 4) GOOD e tela unica
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok(/if \(!shipment && !pack && !pistaMagalu && !resultado\._shopeeDev\) \{/.test(srv), '  GOOD: a mesma regra (Magalu so se a Shopee nao achou)');
  ok(/const pistaPedidoShopee = /.test(srv) && /if \(\(pistaSPX \|\| pistaPedidoShopee\) && shopee\.cfg\.ativo\)/.test(srv), '  GOOD: o pedido Shopee tambem vai pra Shopee primeiro');
  const tela = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'busca.js'), 'utf8');
  ok(/window\._ultimoCodigoBusca = codigo;/.test(tela) && /if \(!_ehShopee\) sugerirRetiro\(\);/.test(tela), '  tela unica: nao sugere retirada do Full do ML pra codigo da Shopee');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
