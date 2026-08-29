// Roda com: node test/leitor-etiqueta.test.js
//
// Guarda o caso de 29/08: etiqueta Magalu da AMB colada (Ctrl+V) no
// computador nao achava nada. Dois motivos empilhados:
//
//  1. o QR nunca era lido no desktop (BarcodeDetector so existe no
//     Android), e o pedido estava DENTRO do QR;
//  2. o leitor de texto nao tinha padrao de Magalu, e escolhia por peso
//     generico — o rastreio (peso 9) ganharia do pedido, sendo que na
//     Magalu o rastreio e justamente o que NAO acha devolucao.

const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'colar-imagem.js'), 'utf8');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// extrai as funcoes puras do arquivo real (sem DOM)
function extrair(nome, ate) {
  const ini = SRC.indexOf(nome);
  const fim = SRC.indexOf(ate, ini);
  return SRC.slice(ini, fim);
}
const bloco =
  extrair('var PADROES = [', '  // ── a area visivel') +
  extrair('function interpretarQr(bruto)', '  async function lerTexto');
const api = new Function(bloco + '; return { candidatos, interpretarQr, reconhecerEtiqueta };')();

// ── 1. O QR REAL da etiqueta Magalu da AMB (29/08) ───────────────────
// Formato REAL do QR da etiqueta Magalu (campos e estrutura conferidos na
// etiqueta da AMB em 29/08), mas com valores SINTETICOS: pedido, UUID, tag e
// CEP trocados. O que importa aqui e a FORMA — nome, endereco e CEP de
// cliente nao entram no repositorio (apontamento do Codex).
const QR_REAL = '{"external_grouper_code":"1500000000000001","external_code":"00000000-0000-4000-8000-000000000001","tag_code":"100000000-01","logistical_flow_start":"DROP_OFF","logistical_flow_operation":"DIRECT","service_name":"CONVENTIONAL","receiver_zipcode":"00000000"}';
{
  const r = api.interpretarQr(QR_REAL);
  ok(!!r, 'o QR real da Magalu e interpretado');
  // v5.2: manda o JSON CRU — o servidor usa isso pra ir direto ao Magalu
  ok(r && r.valor === QR_REAL,
     '  e manda o JSON CRU pro servidor (que assim liga o modo magalu-first)');
  ok(r && r.mostrar === '1500000000000001', '  guardando o pedido pra exibir na tela');
  ok(r && r.extra && r.extra.pedido === '1500000000000001', '  e tambem em extra.pedido');
  // o servidor reconhece pelos NOMES dos campos: confere que eles vao junto
  ok(/external_grouper_code|tag_code|logistical_flow/i.test(String(r && r.valor)),
     '  os campos que o server.js procura (~424) viajam na busca');
  ok(!/^20\d{14}$/.test('1500000000000001'),
     '  (e por isso importa: o numero pelado NAO casa a pista de Magalu do server)');
  ok(r && r.mostrar !== '100000000-01', '  e o que se mostra NAO e o tag_code (rastreio)');
  ok(r && r.extra && r.extra.uuid_pacote === '00000000-0000-4000-8000-000000000001',
     '  e guarda o UUID do pacote (era o que faltava pro link do Magalu)');
}

// ── 2. o texto da etiqueta, quando o QR falha (foto torta, borrada) ──
const TEXTO_MAGALU = `MAGALU ENTREGAS AGENCIA MAGALU LEVES MLRD MALHA-DIRETA
100000000-01 HRIO 03 RBT 248
PEDIDO: 1500000000000001 NOTA FISCAL: 1906 DATA ESTIMADA: 16/07/2026
DESTINATARIO NOME DE TESTE REMETENTE AMBTOTAL`;
{
  const et = api.reconhecerEtiqueta(TEXTO_MAGALU.replace(/\s+/g, ' '));
  ok(et && et.nome === 'Magalu', 'a etiqueta e reconhecida como Magalu pelo texto');
  const c = api.candidatos(TEXTO_MAGALU);
  ok(c.length > 0, '  e rende candidatos (antes rendia ZERO — nao havia padrao Magalu)');
  ok(c[0].valor === '1500000000000001', '  o PRIMEIRO oferecido e o pedido');
  ok(!c.find((x) => x.valor === '100000000-01'),
     '  e o rastreio nao aparece nem como opcao (a etiqueta o proibe)');
  ok(!!c.find((x) => x.valor === '1906'), '  a NF continua disponivel como alternativa');
}

// ── 3. protocolo de devolucao ganha do pedido, quando existe ─────────
{
  const c = api.candidatos('AGENCIA MAGALU PROTOCOLO: 2026062600477033 PEDIDO: 1500000000000001');
  ok(c[0].valor === '2026062600477033',
     'havendo PROTOCOLO da devolucao, ele vem primeiro (e o caminho preferido)');
}

// ── 4. nao quebrar o que ja funcionava ──────────────────────────────
{
  const c = api.candidatos('SHOPEE BR260514290476K PEDIDO 260807PBTHEWQG');
  ok(!!c.find((x) => x.valor === 'BR260514290476K'), 'Shopee: rastreio continua sendo oferecido');
  ok(!!c.find((x) => x.valor === '260807PBTHEWQG'), '  e o pedido tambem');
  ok(api.reconhecerEtiqueta('SHOPEE BR26051429') === null,
     '  etiqueta nao-Magalu nao entra nas regras da Magalu');

  const nf = api.candidatos('CHAVE 35260832461988000182550010000773211336345892');
  ok(nf[0].valor === '35260832461988000182550010000773211336345892', 'chave da DANFE segue no topo');

  const cor = api.candidatos('CORREIOS AD123456789BR');
  ok(cor[0].valor === 'AD123456789BR', 'Correios reverso segue reconhecido');
}

// ── 5. v5.1: o QR do MERCADO LIVRE tambem e JSON — nao pode ser jogado fora
{
  const qrML = '{"id":"47416667668","t":"l"}';
  const r = api.interpretarQr(qrML);
  ok(r !== null, 'QR do ML (JSON) NAO e descartado — o servidor sabe ler esse formato');
  ok(r && r.valor === qrML, '  e vai INTEIRO pro servidor, que extrai o id como sempre fez');
  ok(!!String(r && r.valor).match(/["']?[ii]d["']?\s*[:=]\s*["']?(\d{8,20})/i),
     '  (confere: o padrao do server.js casa com o que estamos mandando)');
}

// ── 6. o mesmo leitor precisa existir na AMB — foi la que o caso aconteceu
{
  const AMB = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'js-AMB', 'colar-imagem.js'), 'utf8');
  ok(AMB.indexOf('lerQrNoCanvas') !== -1, 'AMB tem o leitor de QR (o caso relatado era da AMB)');
  ok(AMB.indexOf('external_grouper_code') !== -1, '  e conhece o QR da Magalu');
  ok(AMB.indexOf('ETIQUETAS') !== -1, '  e reconhece a etiqueta antes de escolher o campo');
  ok(AMB === SRC, '  e os dois arquivos estao IGUAIS (nada ficou so de um lado)');
  ok(AMB.indexOf('ULTIMO_QR_MAGALU') !== -1, '  e o UUID do pacote e propagado tambem na AMB');

  const HTML_AMB = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'index-AMB.html'), 'utf8');
  const HTML_GOOD = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  ok(/jsqr@/i.test(HTML_AMB), 'a AMB carrega a biblioteca de QR');
  ok(/jsqr@/i.test(HTML_GOOD), '  e a GOOD tambem');
  // sem furar o cache, o navegador serve o arquivo velho e o conserto "nao chega"
  ok(/colar-imagem\.js\?v=b330/.test(HTML_AMB), '  cache-buster da AMB atualizado');
  ok(/colar-imagem\.js\?v=4570/.test(HTML_GOOD), '  e o da GOOD tambem');
}

// ── v5.2: o UUID do pacote nao pode morrer no parser ────────────────
{
  ok(SRC.indexOf('window.ULTIMO_QR_MAGALU') !== -1,
     'o UUID do pacote fica guardado onde outra tela possa pegar');
  ok(SRC.indexOf("dispatchEvent(new CustomEvent('qr-magalu-lido'") !== -1,
     '  e avisa por evento, pra quem for montar o link do Magalu nao decodificar de novo');
  ok(SRC.indexOf('uuid_pacote: lido.extra.uuid_pacote') !== -1, '  com o UUID dentro');
}

// ── 7. QR de outros formatos ────────────────────────────────────────
{
  ok(api.interpretarQr('260807PBTHEWQG').valor === '260807PBTHEWQG', 'QR simples: usa o proprio conteudo');
  ok(api.interpretarQr('https://shopee.com.br/x/260807PBTHEWQG').valor === '260807PBTHEWQG',
     'QR que e URL: tira o identificador de dentro');
  ok(api.interpretarQr('{"algum_campo":"1"}') === null,
     'JSON desconhecido: NAO chuta (cai pro texto em vez de buscar lixo)');
  ok(api.interpretarQr('') === null, 'QR vazio: nada');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
