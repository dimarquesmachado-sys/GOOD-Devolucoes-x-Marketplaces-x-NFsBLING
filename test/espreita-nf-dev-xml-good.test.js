'use strict';
// 29/10 — GOOD nivelada pelo #505: a espreita da GOOD marca nf_devolucao_xml (a marca que a baixa em massa do painel
// unico aceita) quando a NF de venda do card tem NF de devolucao provada pelo XML. Roda a peca de PRODUCAO
// (lib/espreita-nf-dev-xml) com a fabrica de PRODUCAO (nf-entrada-AMB) num Bling de mentira.
const path = require('path'); const fs = require('fs');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const { marcarNfDevolucaoXml } = require('../lib/espreita-nf-dev-xml');
const CNPJ = '27548456000147';
const chave = (serie, numero) => '3526' + '09' + CNPJ + '55' + String(serie).padStart(3, '0') + String(numero).padStart(9, '0') + '1' + '93656845' + '6';
const hoje = new Date().toISOString().slice(0, 10) + ' 10:00:00';
const LISTA = [{ id: 'A1', numero: '7001', dataEmissao: hoje, situacao: 5, naturezaOperacao: { id: 5776118802 }, contato: { nome: 'Cliente ML' } },
  { id: 'B2', numero: '7002', dataEmissao: hoje, situacao: 5, naturezaOperacao: { id: 5776118802 }, contato: { nome: 'Cliente Shopee' } }];
const XMLS = { 'http://xml/A1': '<NFe><infNFe><ide><NFref><refNFe>' + chave(1, 50001) + '</refNFe></NFref></ide><emit><CNPJ>' + CNPJ + '</CNPJ></emit></infNFe></NFe>',
  'http://xml/B2': '<NFe><infNFe><ide><NFref><refNFe>' + chave(1, 50002) + '</refNFe></NFref></ide><emit><CNPJ>' + CNPJ + '</CNPJ></emit></infNFe></NFe>' };
const clienteBling = { chamarBling: async (p) => {
  if (/^\/nfe\?/.test(p)) return { ok: true, status: 200, data: { data: /pagina=1&/.test(p) ? LISTA : [] } };
  const m = /^\/nfe\/(\w+)$/.exec(p); return m ? { ok: true, status: 200, data: { data: { id: m[1], xml: 'http://xml/' + m[1] } } } : { ok: false, status: 404 };
} };
const fetchOrig = global.fetch;
global.fetch = async (u) => (XMLS[u] ? { ok: true, status: 200, text: async () => XMLS[u] } : { ok: false, status: 503, text: async () => '' });
(async () => {
  const nfe = require('../amb-devolucoes/lib-AMB/nf-entrada-AMB').criar({ PREFIXO_ENV: 'TESTEGOOD_', clienteBling, fiscal: { naturezasDevolucaoIds: () => '5776118802,15110882187' } });
  // indice frio: nao marca nada (e nao quebra)
  const frio = marcarNfDevolucaoXml([{ marketplace: 'ml', pedido: 'P1', nf_ml_numero: '50001', nf_ml_serie: '1' }], { jaEmitida: (o) => nfe.jaEmitida(o) });
  ok(!frio[0].nf_devolucao_xml, '  indice ainda frio: nao marca (e nao quebra)');
  await nfe.construirIndice();
  for (let i = 0; i < 40 && nfe.statusIndice().devolucoes.provando; i++) await new Promise((r) => setTimeout(r, 100));
  const porPedido = { S1: { numero: '50002', serie: '1' }, S9: { numero: '59999', serie: null } };
  const deps = { jaEmitida: (o) => nfe.jaEmitida(o), acharPorPedido: (p) => porPedido[p] || null };
  const orig = [
    { marketplace: 'ml', pedido: 'P1', nf_ml_numero: '50001', nf_ml_serie: '1' },        // ML: NF de venda no card
    { marketplace: 'shopee', pedido: 'S1' },                                              // Shopee: NF pelo pedido
    { marketplace: 'ml', pedido: 'P3', nf_ml_numero: '50003', nf_ml_serie: '1' },        // sem devolucao no Bling
    { marketplace: 'shopee', pedido: 'S9' },                                              // NF do pedido sem serie
    { marketplace: 'magalu', pedido: 'M1', cliente: 'Fulano' },                           // sem NF firme
  ];
  const out = marcarNfDevolucaoXml(orig, deps);
  ok(out[0].nf_devolucao_xml === true && out[0].nf_devolucao_emitida === '7001', '⚠️ GOOD/ML: devolucao 7001 feita a mao reconhecida pela NF de venda 50001 do card');
  ok(out[1].nf_devolucao_xml === true, '⚠️ GOOD/Shopee: NF de venda achada pelo PEDIDO no indice de NFs -> reconhecida');
  ok(!out[2].nf_devolucao_xml && !out[3].nf_devolucao_xml && !out[4].nf_devolucao_xml, '⚠️ sem devolucao, sem serie ou sem NF firme: NAO marca (nao chuta)');
  ok(!orig[0].nf_devolucao_xml && out[2] === orig[2], '  nao mexe nos objetos de quem chamou (podem ser do cache)');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok(/require\('\.\/amb-devolucoes\/lib-AMB\/nf-entrada-AMB'\)\.criar\(\{\s*PREFIXO_ENV: 'GOOD_',\s*fiscal: FICHA_GOOD\.fiscal,/.test(srv), '  GOOD usa a MESMA peca da fabrica (nf-entrada-AMB) com a ficha fiscal dela');
  ok(/em_transito: marcarNfDevolucaoXml\(unificada, NF_DEV_XML_DEPS\)/.test(srv) && /nunca_bipadas: marcarNfDevolucaoXml\(nuncaBipadas, NF_DEV_XML_DEPS\)/.test(srv)
    && /entregues_recentes: marcarNfDevolucaoXml\(entreguesRecentes, NF_DEV_XML_DEPS\)/.test(srv), '⚠️ espreita da GOOD marca as tres listas (em transito, chegou e nao bipou, entregues recentes)');
  ok(/drenagem\.daquiA\(\(\) => nfEntradaGood\.preAquecer\(0\)/.test(srv), '  o indice de notas de entrada da GOOD e agendado no boot');
  const painel = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
  ok(/it\.nf_devolucao_xml/.test(painel), '  painel unico (o mesmo da GOOD) aceita a marca nf_devolucao_xml na baixa em massa');
  global.fetch = fetchOrig;
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
