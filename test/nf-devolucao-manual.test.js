'use strict';
// 29/10 — NF de devolucao feita A MAO no Bling (dono: tosquiadeira 2609069UWS4UFX, venda NF 126747). A espreita so
// reconhecia pelo numero do pedido, que essas notas nao trazem (Girassol: pedidos_indexados 0). Agora: pela NF de
// VENDA que a devolucao referencia no XML. Roda a fabrica de PRODUCAO (nf-entrada-AMB) com Bling e XML de mentira.
const path = require('path'); const fs = require('fs');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const CNPJ = '27548456000147';
const chave = (cnpj, serie, numero) => '3526' + '09' + cnpj + '55' + String(serie).padStart(3, '0') + String(numero).padStart(9, '0') + '1' + '93656845' + '6';
const xml = (refs, emit) => '<nfeProc><NFe><infNFe Id="NFe1"><ide>' + refs.map((r) => '<NFref><refNFe>' + r + '</refNFe></NFref>').join('')
  + '</ide><emit><CNPJ>' + emit + '</CNPJ></emit></infNFe></NFe></nfeProc>';
const hoje = new Date().toISOString().slice(0, 10) + ' 10:00:00';
const LISTA = [
  { id: 'A1', numero: '9001', dataEmissao: hoje, situacao: 5, naturezaOperacao: { id: 777 }, contato: { nome: 'Antonio Galdino' } },   // a da tosquiadeira
  { id: 'B2', numero: '9002', dataEmissao: hoje, situacao: 2, naturezaOperacao: { id: 777 }, contato: { nome: 'Cancelada' } },         // cancelada
  { id: 'C3', numero: '9003', dataEmissao: hoje, situacao: 5, naturezaOperacao: { id: 999 }, contato: { nome: 'Outra natureza' } },    // nao e devolucao
  { id: 'D4', numero: '9004', dataEmissao: hoje, situacao: 6, naturezaOperacao: { id: 777 }, contato: { nome: 'Outro CNPJ' } },        // referencia NF de outro CNPJ
  { id: 'E5', numero: '9005', dataEmissao: hoje, situacao: 5, naturezaOperacao: { id: 777 }, contato: { nome: 'XML fora do ar' } },    // XML indisponivel
];
const XMLS = {
  'http://xml/A1': xml([chave(CNPJ, 1, 126747)], CNPJ),
  'http://xml/B2': xml([chave(CNPJ, 1, 555)], CNPJ),
  'http://xml/C3': xml([chave(CNPJ, 1, 666)], CNPJ),
  'http://xml/D4': xml([chave('11111111000111', 1, 777)], CNPJ),
};
const detalhes = [];
const clienteBling = { chamarBling: async (p) => {
  if (/^\/nfe\?/.test(p)) return { ok: true, status: 200, data: { data: /pagina=1&/.test(p) ? LISTA : [] } };
  const m = /^\/nfe\/(\w+)$/.exec(p); if (m) { detalhes.push(m[1]); return { ok: true, status: 200, data: { data: { id: m[1], xml: 'http://xml/' + m[1] } } }; }
  return { ok: false, status: 404 };
} };
const fetchOrig = global.fetch;
global.fetch = async (u) => (XMLS[u] ? { ok: true, status: 200, text: async () => XMLS[u] } : { ok: false, status: 503, text: async () => '' });
(async () => {
  const nfe = require('../amb-devolucoes/lib-AMB/nf-entrada-AMB').criar({ PREFIXO_ENV: 'TESTE_', clienteBling, fiscal: { naturezasDevolucaoIds: () => '777' } });
  await nfe.construirIndice();
  for (let i = 0; i < 40 && nfe.statusIndice().devolucoes.provando; i++) await new Promise((r) => setTimeout(r, 100));
  const r = nfe.jaEmitida({ nfVenda: '126747', serieVenda: '1' });
  ok(r.emitida === true && r.via === 'xml' && r.nf && r.nf.numero === '9001', '⚠️ NF de devolucao feita a mao (9001) reconhecida pela NF de VENDA 126747 que ela referencia no XML');
  ok(nfe.jaEmitida({ nfVenda: '126747' }).emitida === false, '⚠️ sem a serie da venda, nao chuta');
  ok(nfe.jaEmitida({ nfVenda: '555', serieVenda: '1' }).emitida === false && !detalhes.includes('B2'), '⚠️ devolucao CANCELADA nao conta (nem e lida)');
  ok(nfe.jaEmitida({ nfVenda: '666', serieVenda: '1' }).emitida === false && !detalhes.includes('C3'), '  nota de outra natureza nao e candidata (nem e lida)');
  ok(nfe.jaEmitida({ nfVenda: '777', serieVenda: '1' }).emitida === false, '⚠️ referencia a NF de OUTRO CNPJ nao conta');
  const st = nfe.statusIndice().devolucoes;
  ok(st.candidatas === 3 && st.provadas === 2 && st.vendas_reconhecidas === 1, '  status mostra candidatas/provadas/reconhecidas (E5 com XML fora do ar fica pra tentar de novo): ' + JSON.stringify(st));
  // 'nao sei' tenta de novo na proxima rodada; conclusivo nao e relido
  XMLS['http://xml/E5'] = xml([chave(CNPJ, 1, 888)], CNPJ);
  const antes = detalhes.length;
  await nfe.construirIndice();
  for (let i = 0; i < 40 && nfe.statusIndice().devolucoes.provando; i++) await new Promise((r) => setTimeout(r, 100));
  ok(nfe.jaEmitida({ nfVenda: '888', serieVenda: '1' }).emitida === true && detalhes.slice(antes).join(',') === 'E5', '⚠️ "nao sei" (XML fora do ar) tenta de novo; as ja provadas NAO sao relidas (cota do Bling)');
  ok(nfe.jaEmitida({ pedido: 'X' }).emitida === false, '  chamada antiga (so pedido) continua igual');
  const app = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  const bloco = (/const nfVendaFirme = [\s\S]*?: null;/.exec(app) || [''])[0];
  ok(bloco && !/nfNome/.test(bloco) && /nfDev\.emitida === true/.test(app), '⚠️ espreita: so NF de venda FIRME (ML, pedido, loja) — o palpite pelo nome fica de fora');
  const painel = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
  ok(/concat\(esp\.entregues \|\| \[\]\)/.test(painel) && /it\.nf_devolucao_emitida/.test(painel), '  painel: a baixa em massa olha as ENTREGUES e a marca do XML');
  global.fetch = fetchOrig;
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
