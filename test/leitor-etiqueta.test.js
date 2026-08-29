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
const QR_REAL = '{"external_grouper_code":"1550970116332325","external_code":"db1d4527-1e61-462e-af25-e5c71e11756f","tag_code":"197008400-01","logistical_flow_start":"DROP_OFF","logistical_flow_operation":"DIRECT","service_name":"CONVENTIONAL","receiver_zipcode":"24875525"}';
{
  const r = api.interpretarQr(QR_REAL);
  ok(!!r, 'o QR real da Magalu e interpretado');
  ok(r && r.valor === '1550970116332325',
     '  e devolve o PEDIDO — o mesmo numero que funcionou digitado a mao');
  ok(r && r.valor !== '197008400-01', '  e NAO o tag_code (rastreio, que nao acha devolucao)');
  ok(r && r.extra && r.extra.uuid_pacote === 'db1d4527-1e61-462e-af25-e5c71e11756f',
     '  e guarda o UUID do pacote (era o que faltava pro link do Magalu)');
}

// ── 2. o texto da etiqueta, quando o QR falha (foto torta, borrada) ──
const TEXTO_MAGALU = `MAGALU ENTREGAS AGENCIA MAGALU LEVES MLRD MALHA-DIRETA
197008400-01 HRIO 03 RBT 248
PEDIDO: 1550970116332325 NOTA FISCAL: 1906 DATA ESTIMADA: 16/07/2026
DESTINATARIO MONICA ILYRIA VON ABEL REMETENTE AMBTOTAL`;
{
  const et = api.reconhecerEtiqueta(TEXTO_MAGALU.replace(/\s+/g, ' '));
  ok(et && et.nome === 'Magalu', 'a etiqueta e reconhecida como Magalu pelo texto');
  const c = api.candidatos(TEXTO_MAGALU);
  ok(c.length > 0, '  e rende candidatos (antes rendia ZERO — nao havia padrao Magalu)');
  ok(c[0].valor === '1550970116332325', '  o PRIMEIRO oferecido e o pedido');
  ok(!c.find((x) => x.valor === '197008400-01'),
     '  e o rastreio nao aparece nem como opcao (a etiqueta o proibe)');
  ok(!!c.find((x) => x.valor === '1906'), '  a NF continua disponivel como alternativa');
}

// ── 3. protocolo de devolucao ganha do pedido, quando existe ─────────
{
  const c = api.candidatos('AGENCIA MAGALU PROTOCOLO: 2026062600477033 PEDIDO: 1550970116332325');
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

// ── 5. QR de outros formatos ────────────────────────────────────────
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
