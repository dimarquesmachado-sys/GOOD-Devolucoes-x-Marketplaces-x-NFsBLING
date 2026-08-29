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
  // v5.3: manda o MINIMO que liga o modo magalu-first — sem dado do cliente
  ok(r && /external_grouper_code/.test(r.valor),
     '  manda o campo que o servidor procura (liga o modo magalu-first)');
  ok(r && !/receiver_zipcode|24875525|00000000"/.test(r.valor),
     '  mas NAO o CEP do cliente — isso iria pra querystring e pro log do servidor');
  ok(r && !/service_name|logistical_flow_operation/.test(r.valor),
     '  nem os outros campos da etiqueta que nao servem pra busca');
  ok(r && r.valor.length < 120, '  payload enxuto (o QR inteiro tem 300+ caracteres)');
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

// ── 6. o mesmo leitor precisa CHEGAR na AMB — foi la que o caso aconteceu
{
  // Desde a unificacao (29/08) a AMB nao tem copia deste arquivo: ela serve
  // o da GOOD. Entao a checagem aqui e que ele NAO voltou a ser copiado —
  // uma copia nova e o comeco da proxima divergencia — e que a rota da AMB
  // continua listando este modulo como compartilhado.
  const COPIA_AMB = path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'js-AMB', 'colar-imagem.js');
  ok(!fs.existsSync(COPIA_AMB),
     'a AMB NAO tem copia local do leitor (serve o da GOOD; foi a copia que causou o caso de 29/08)');

  const APP_AMB = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/JS_COMPARTILHADOS[\s\S]{0,200}colar-imagem\.js/.test(APP_AMB),
     '  e o app-AMB serve colar-imagem.js a partir da pasta da GOOD');
  ok(SRC.indexOf('lerQrNoCanvas') !== -1, '  (o arquivo unico tem o leitor de QR)');
  ok(SRC.indexOf('external_grouper_code') !== -1, '  conhece o QR da Magalu');
  ok(SRC.indexOf('ETIQUETAS') !== -1, '  e reconhece a etiqueta antes de escolher o campo');
  ok(SRC.indexOf('ULTIMO_QR_MAGALU') !== -1, '  e propaga o UUID do pacote');

  const HTML_AMB = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'index-AMB.html'), 'utf8');
  const HTML_GOOD = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  ok(/jsqr@/i.test(HTML_AMB), 'a AMB carrega a biblioteca de QR');
  ok(/jsqr@/i.test(HTML_GOOD), '  e a GOOD tambem');
  // sem furar o cache, o navegador serve o arquivo velho e o conserto "nao chega"
  // o numero muda a cada entrega, entao o teste checa so que SAIU do
  // valor velho — travar num numero fixo faz este teste quebrar em toda
  // mudanca de front, sem nada estar errado (aconteceu em 29/08).
  ok(/colar-imagem\.js\?v=b(?!129)\w+/.test(HTML_AMB),
     '  cache-buster da AMB saiu do b129 antigo');
  ok(/colar-imagem\.js\?v=4[5-9]\d\d/.test(HTML_GOOD),
     '  e o da GOOD acompanha a versao do servidor');
}

// ── v5.3: o TETO do canvas precisa REDUZIR, nao so deixar de ampliar
{
  // reproduz a decisao de escala do arquivo
  function passes(w, h) {
    var TETO = 4000, maior = Math.max(w, h);
    var base = maior > TETO ? (TETO / maior) : 1;
    return base < 1 ? [base] : [1, 2];
  }
  const foto48mp = passes(8064, 6048);
  ok(foto48mp.length === 1 && foto48mp[0] < 1,
     'foto de 48 MP e REDUZIDA (antes criava canvas de ~195 MB e matava a aba)');
  ok(Math.round(8064 * foto48mp[0]) <= 4000, '  ate caber no teto de 4000px');
  const printPequeno = passes(900, 600);
  ok(printPequeno.join(',') === '1,2', 'print pequeno continua ganhando o passe de 2x');
  ok(SRC.indexOf('var passes = base < 1 ? [base] : [1, 2];') !== -1, '  e e isso que o arquivo faz');
}

// ── v5.3: nativo que achou SO barras nao pode pular o jsQR
{
  ok(SRC.indexOf('achouQrNativo') !== -1,
     'quando o nativo acha so o codigo de barras, o jsQR ainda roda');
  ok(SRC.indexOf('if (!codigo || !achouQrNativo)') !== -1,
     '  (na Magalu o de barras e grande e o QR e pequeno: o nativo as vezes ve so o primeiro)');
}

// ── v5.3: os eventos do checkout precisam entender o QR da Magalu
{
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i = SERVER.indexOf('async function buscarEventosCheckout');
  const trecho = SERVER.slice(i, i + 1200);
  ok(/external_grouper_code/.test(trecho),
     'buscarEventosCheckout extrai o pedido de dentro do QR Magalu');
  ok(trecho.indexOf('external_grouper_code') < trecho.indexOf('A-Za-z0-9_-]{5,60}'),
     '  ANTES do teste de formato (o JSON tem pontuacao e passa de 60 chars: era rejeitado)');
}

// ── v5.3: preferir o QR nao pode DESCARTAR um codigo de barras valido
{
  ok(SRC.indexOf('reserva: barras ?') !== -1,
     'o leitor nativo devolve tambem o codigo de BARRAS, nao so o QR preferido');
  ok(SRC.indexOf('if (reservaBarras) {') !== -1,
     '  e o fluxo usa esse de barras quando o QR nao rende nada util');
  ok(SRC.indexOf('usar(reservaBarras)') < SRC.indexOf('oferecer(candidatos('),
     '  ANTES de cair no OCR (etiqueta nao-Magalu com QR de propaganda seguia quebrada)');
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
