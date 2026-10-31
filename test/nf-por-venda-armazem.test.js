'use strict';
// 30/10 — o mapa venda -> NF (fonte firme da NF de venda da Shopee na espreita da Girassol/AMB) ficava so na memoria:
// todo deploy apagava, e os cards da Shopee ficavam sem NF firme (a prova pelo XML do #505 nao rodava). Roda a peca
// de PRODUCAO (nf-nomes-AMB) com Bling e armazem de mentira.
const ARQ = require.resolve('../amb-devolucoes/lib-AMB/nf-nomes-AMB');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
function armazem(inicial, { falhaLeitura } = {}) {
  const arq = { ...(inicial || {}) }; let gravacoes = 0;
  return { arq, get gravacoes() { return gravacoes; },
    carregar: async (n) => (arq[n] ? JSON.parse(JSON.stringify(arq[n])) : null),
    carregarComEstado: async (n) => (falhaLeitura ? { ok: false, erro: 'timeout' } : { ok: true, obj: arq[n] ? JSON.parse(JSON.stringify(arq[n])) : null }),
    salvar: async (n, o) => { gravacoes++; arq[n] = JSON.parse(JSON.stringify(o)); return { ok: true }; } };
}
const chave = (num) => '3526092754845600014755001' + String(num).padStart(9, '0') + '1' + '93656845' + '6';
function montar(arm, chamadas) {
  delete require.cache[ARQ];
  return require(ARQ).criar({ PREFIXO_ENV: 'TNFV_', armazemNfNomes: arm, clienteBling: { chamarBling: async (u) => {
    chamadas && chamadas.push(u);
    if (/\/pedidos\/vendas\/V1$/.test(u)) return { ok: true, status: 200, data: { data: { id: 'V1', notaFiscal: { id: 'N1' } } } };
    if (/\/nfe\/N1$/.test(u)) return { ok: true, status: 200, data: { data: { id: 'N1', numero: '127877', serie: '1', chaveAcesso: chave(127877) } } };
    return { ok: false, status: 404 };
  } } });
}
(async () => {
  // 1) boot: carrega o que esta guardado e valido; o vencido (40 dias) fica de fora
  const agora = Date.now();
  const arm1 = armazem({ 'nf-por-venda': { v: {
    VOK: { numero: '126747', serie: '1', loja: '2609069UWS4UFX', em: agora - 2 * 86400e3 },
    VVELHA: { numero: '100', serie: '1', loja: 'PEDVELHO', em: agora - 40 * 86400e3 },
  } } });
  const m1 = montar(arm1);
  const r1 = await m1.carregarNfPorVenda();
  ok(r1.ok && r1.carregados === 1 && m1.nfDaLoja('2609069UWS4UFX') && m1.nfDaLoja('2609069UWS4UFX').numero === '126747',
    '⚠️ depois de um deploy, a NF firme da Shopee volta do armazem (tosquiadeira 2609069UWS4UFX -> 126747)');
  ok(!m1.nfDaLoja('PEDVELHO'), '  entrada com mais de 30 dias nao vale (e reconsultada — cobre NF cancelada e reemitida)');
  ok(m1.statusIndice().nf_por_venda.vieram_do_armazem === 1, '  o status do indice mostra quanto veio do armazem');
  // 2) a recarga pelo Bling grava no armazem
  const chamadas = [];
  const arm2 = armazem();
  const m2 = montar(arm2, chamadas);
  await m2.carregarNfPorVenda();
  m2.dispararNfPorVenda([{ id: 'V1', loja: '260924T7C5SE41' }]);
  for (let i = 0; i < 30 && !m2.nfDaLoja('260924T7C5SE41'); i++) await espera(100);
  ok(m2.nfDaLoja('260924T7C5SE41') && m2.nfDaLoja('260924T7C5SE41').numero === '127877', '  a recarga pelo Bling acha a NF da venda (127877)');
  await espera(10600);
  const g = arm2.arq['nf-por-venda'] && arm2.arq['nf-por-venda'].v && arm2.arq['nf-por-venda'].v.V1;
  ok(g && g.numero === '127877' && g.loja === '260924T7C5SE41' && g.em, '⚠️ o que a recarga achou e GRAVADO no armazem');
  // 3) deploy simulado: peca nova, mesmo armazem — nao consulta o Bling de novo
  const chamadas3 = [];
  const m3 = montar(arm2, chamadas3);
  await m3.carregarNfPorVenda();
  m3.dispararNfPorVenda([{ id: 'V1', loja: '260924T7C5SE41' }]);
  await espera(300);
  ok(m3.nfDaLoja('260924T7C5SE41') && m3.nfDaLoja('260924T7C5SE41').numero === '127877' && chamadas3.length === 0, '⚠️ peca nova (deploy) le do armazem e NAO gasta consulta no Bling');
  // 4) leitura falhou: nao marca carregado e nao grava por cima do guardado
  const arm4 = armazem({ 'nf-por-venda': { v: { VX: { numero: '9', serie: '1', loja: 'L9', em: agora } } } }, { falhaLeitura: true });
  const m4 = montar(arm4);
  const r4 = await m4.carregarNfPorVenda();
  ok(r4.ok === false && m4.statusIndice().nf_por_venda.carregado_do_armazem === false && arm4.gravacoes === 0, '  leitura do armazem falhou: nao grava (nao apaga o que estava guardado)');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
