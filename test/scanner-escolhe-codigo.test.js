// Roda com: node test/scanner-escolhe-codigo.test.js
//
// O scanner da CAMERA pegava codes[0] — o primeiro codigo que entrasse no
// quadro. Numa etiqueta Magalu, o codigo de barras e grande e o QR e
// pequeno: com sorte de enquadramento, o estoquista bipava o RASTREIO, que
// e justamente o que NAO acha devolucao (esta escrito no "O que bipar" do
// proprio painel). Virava loteria.
//
// Levantado pelo dono em 29/08: "quando bipa pelo celular, às vezes o
// celular pega só um código. não faz igual agora o computador tá fazendo
// de ler a etiqueta toda né?"

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const SCANNER = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'scanner.js'), 'utf8');
const COLAR = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'colar-imagem.js'), 'utf8');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// ── o scanner escolhe, nao pega o primeiro ───────────────────────────
ok(!/const raw = String\(codes\[0\]\.rawValue\)/.test(SCANNER),
   'o scanner NAO usa mais codes[0] cego');
ok(/codes\.find\(c => c\.format === 'qr_code'\)/.test(SCANNER),
   '  procura o QR entre os codigos lidos');
ok(/const escolhido = \(scannerModo === 'bipagem'\)/.test(SCANNER),
   '  e a escolha depende do MODO (etiqueta x EAN do produto)');

// ── e usa a MESMA funcao do leitor de imagem, nao uma copia ──────────
ok(/window\.interpretarCodigoLido/.test(SCANNER),
   'o scanner chama a funcao do leitor de imagem');
ok(/window\.interpretarCodigoLido = function/.test(COLAR),
   '  que o colar-imagem expoe');
ok(!/external_grouper_code/.test(SCANNER),
   '  e NAO duplica a logica do QR Magalu (duplicar gerou metade dos bugs de hoje)');
ok(/typeof window\.interpretarCodigoLido === 'function'/.test(SCANNER),
   '  checando que existe antes de chamar');
ok(/catch \(e\) \{ \/\* na duvida, segue com o codigo cru \*\//.test(SCANNER),
   '  e com catch: falha na interpretacao nao pode travar o bipe');

// ── v3.34.1: a preferencia depende do MODO ───────────────────────────
// No modo 'bipagem' a tela espera o EAN DO PRODUTO, e embalagem costuma ter
// o EAN em codigo de barras com algum QR de propaganda ao lado. Preferir o
// QR ali ignoraria o EAN valido e mandaria numero errado pra busca.
ok(/scannerModo === 'bipagem'\)\s*\n\s*\? \(barras \|\| qr/.test(SCANNER),
   'no modo EAN do produto, o codigo de BARRAS vem na frente');
ok(/: \(qr \|\| barras \|\| codes\[0\]\);/.test(SCANNER),
   '  e na etiqueta, o QR');
ok(/scannerModo !== 'bipagem' && typeof window\.interpretarCodigoLido/.test(SCANNER),
   '  e o interpretador de QR nem roda no modo do produto');

// ── v3.34.1: o payload do Magalu nao passa pela limpeza generica ─────
// processarBipagemEtiqueta so sabe extrair JSON do ML (procura `id`). O JSON
// do Magalu sobrevive inteiro, vira string alfanumerica de 61 caracteres e e
// RECUSADA pelo limite de 44 antes de chegar na busca — ou seja, sem isto o
// caminho da camera nao acharia devolucao Magalu nenhuma.
ok(/let jaResolvido = false;/.test(SCANNER), 'marca quando o interpretador ja resolveu');
ok(/} else if \(jaResolvido\) \{/.test(SCANNER), '  e desvia da limpeza nesse caso');
ok(/fecharCameraScanner\(\);[\s\S]{0,200}if \(typeof buscar === 'function'\) buscar\(\);/.test(SCANNER),
   '  encerrando igual ao caminho normal: fecha a camera e dispara a busca');
{
  const i = SCANNER.indexOf('} else if (jaResolvido) {');
  const trecho = SCANNER.slice(i, i + 900);
  ok(/document\.activeElement\.blur\(\)/.test(trecho),
     '  e tirando o foco, senao abre o teclado no celular (licao da v3.14.8)');
}

// ── v3.34.2: espera o QR aparecer antes de aceitar so o de barras ────
// O QR da Magalu e pequeno e o codigo de barras e grande: eles nem sempre
// entram no mesmo detect(). Sem esperar, o primeiro quadro que pegasse so
// o de barras aceitava o RASTREIO e ja disparava a busca — o bug que este
// PR veio consertar, voltando por timing.
ok(/let scannerEsperasSemQr = 0;/.test(SCANNER), 'ha contador de quadros sem QR');
ok(/if \(scannerModo !== 'bipagem' && !qr && barras\) \{/.test(SCANNER),
   '  em modo ETIQUETA com so codigo de barras, espera');
ok(/if \(scannerEsperasSemQr < 12\) return;/.test(SCANNER),
   '  ~12 quadros (menos de 1s) — depois disso o de barras vale');
ok(/scannerEsperasSemQr = 0;\s*\n\s*\}/.test(SCANNER), '  e zera quando o QR aparece');
{
  const i = SCANNER.indexOf('async function abrirCameraScanner');
  ok(/scannerEsperasSemQr = 0;/.test(SCANNER.slice(i, i + 200)),
     '  e ao abrir a camera, pra nao herdar a contagem da leitura anterior');
}

// ── v3.34.2: QR de texto solto nao ganha do codigo de barras ─────────
// O interpretador devolve o proprio conteudo pra QUALQUER texto, entao um
// QR de propaganda/wifi/link sempre "resolvia" e ganhava — e se tivesse 9
// a 44 caracteres, ia pra busca como se fosse identificador.
ok(/const qrGenerico = lido && lido\.tipo === 'codigo do QR'/.test(SCANNER),
   'QR generico (texto solto) e reconhecido como tal');
ok(/if \(qrGenerico && barras\) \{/.test(SCANNER),
   '  e cede a vez pro codigo de barras quando ele existe');

// ── v3.34.2: EAN na frente dos outros codigos de barras ──────────────
ok(/c\.format === 'ean_13' \|\| c\.format === 'ean_8'/.test(SCANNER),
   'no modo produto, EAN vem antes de code_128/itf/pdf417 (o detector pede todos)');

// ── v3.34.3: URL com identificador extraido NAO e "generico" ────────
ok(/const extraiuAlgo = lido && v !== String\(raw \|\| ''\)/.test(SCANNER),
   'QR que teve identificador EXTRAIDO nao e tratado como texto solto');
ok(/&& !extraiuAlgo/.test(SCANNER), '  entao nao cede a vez pro codigo de barras');

// ── v3.34.3: JSON do ML tem o id extraido antes da busca ────────────
ok(/const mIdML = String\(lido\.valor\)\.match/.test(SCANNER),
   'JSON do Mercado Livre tem o `id` extraido antes de ir pra busca');
ok(/jaResolvido = !mIdML &&/.test(SCANNER),
   '  e so o payload do MAGALU pula a limpeza (o dela e o unico que a limpeza destroi)');

// ── a escolha, simulada ──────────────────────────────────────────────
{
  function escolher(codes, modo) {
    const qr = codes.find((c) => c.format === 'qr_code');
    const ean = codes.find((c) => c.format === 'ean_13' || c.format === 'ean_8');
    const naoQr = codes.find((c) => c.format !== 'qr_code');
    const barras = (modo === 'bipagem') ? (ean || naoQr) : naoQr;
    const esc = (modo === 'bipagem') ? (barras || qr || codes[0]) : (qr || barras || codes[0]);
    return esc.rawValue;
  }

  const magalu = [
    { format: 'code_128', rawValue: '197008400-01' },                    // rastreio, entra primeiro no quadro
    { format: 'qr_code', rawValue: '{"external_grouper_code":"1500000000000001"}' },
  ];
  ok(escolher(magalu).indexOf('external_grouper_code') !== -1,
     'etiqueta Magalu: escolhe o QR, nao o rastreio que apareceu primeiro');

  const soBarras = [{ format: 'code_128', rawValue: 'BR260514290476K' }];
  ok(escolher(soBarras) === 'BR260514290476K',
     'etiqueta so com codigo de barras: usa ele, como sempre');

  const soQr = [{ format: 'qr_code', rawValue: '260807PBTHEWQG' }];
  ok(escolher(soQr) === '260807PBTHEWQG', 'etiqueta so com QR: usa ele');

  // o mesmo quadro, no modo EAN do produto: agora o de barras ganha
  const produto = [
    { format: 'qr_code', rawValue: 'https://propaganda.exemplo' },   // QR entrou primeiro
    { format: 'ean_13', rawValue: '7898978766010' },
  ];
  ok(escolher(produto, 'bipagem') === '7898978766010',
     'bipando o EAN do produto: escolhe o CODIGO DE BARRAS, ignorando o QR de propaganda');
  ok(escolher(produto, 'etiqueta').indexOf('propaganda') !== -1,
     '  (o mesmo quadro no modo etiqueta escolheria o QR — por isso o modo importa)');

  // v3.34.2: embalagem com outro codigo de barras alem do EAN
  const embalagem = [
    { format: 'code_128', rawValue: 'LOTE-ABC-99' },      // aparece primeiro
    { format: 'ean_13', rawValue: '7898978766010' },
  ];
  ok(escolher(embalagem, 'bipagem') === '7898978766010',
     'embalagem com code_128 e EAN: escolhe o EAN, nao o primeiro nao-QR');

  // v3.34.3: mas em modo ETIQUETA a prioridade do EAN nao vale
  const correiosComProduto = [
    { format: 'code_128', rawValue: 'AD123456789BR' },   // o codigo da devolucao
    { format: 'ean_13', rawValue: '7898978766010' },     // o EAN do produto, visivel no pacote
  ];
  ok(escolher(correiosComProduto, 'etiqueta') === 'AD123456789BR',
     'etiqueta dos Correios com o EAN do produto a vista: escolhe o codigo da DEVOLUCAO');
  ok(escolher(correiosComProduto, 'bipagem') === '7898978766010',
     '  e o mesmo quadro, bipando produto, escolhe o EAN');
}

// ── as duas empresas usam o MESMO scanner ────────────────────────────
{
  const copiaAmb = path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'js-AMB', 'scanner.js');
  ok(!fs.existsSync(copiaAmb),
     'a AMB nao tem copia do scanner — serve o da GOOD (unificado hoje), entao o conserto chega nas duas');
}

// ── ordem de carregamento: o scanner vem ANTES do colar-imagem ───────
{
  const HTML = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8');
  const iScanner = HTML.indexOf('js/scanner.js');
  const iColar = HTML.indexOf('js/colar-imagem.js');
  ok(iScanner !== -1 && iColar !== -1 && iScanner < iColar,
     'o scanner e carregado ANTES do colar-imagem — de proposito o teste registra isso');
  ok(/typeof window\.interpretarCodigoLido === 'function'/.test(SCANNER),
     '  e por isso a funcao e consultada na HORA DE BIPAR, nao no carregamento (senao nao existiria ainda)');
}

// ── v3.34.4: QR reconhecido nao cede a vez, mesmo sem transformar ────
// O QR simples da Shopee (pedido: 6 digitos + alfanumerico) sai igual ao
// que entrou. Classificar como "generico" fazia ele ceder pro codigo de
// barras ao lado — que na Shopee e o rastreio, justamente o que nao acha.
ok(/const pareceIdentificador =/.test(SCANNER),
   'QR cujo valor TEM CARA de identificador nao e generico');
ok(/\^\\d\{6\}\[A-Z0-9\]\{6,10\}\$/.test(SCANNER), '  pedido Shopee reconhecido');
ok(/\^BR\[A-Z0-9\]\{9,\}\$/.test(SCANNER), '  rastreio SPX tambem');
ok(/!extraiuAlgo && !pareceIdentificador/.test(SCANNER),
   '  e so cede quando NAO transformou E NAO parece identificador');

// ── v3.34.4: a AMB entende o QR Magalu nos eventos do checkout ───────
{
  const IDENT_AMB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8');
  const i = IDENT_AMB.indexOf('async function buscarEventosCheckout');
  const trecho = IDENT_AMB.slice(i, i + 1200);
  ok(/external_grouper_code/.test(trecho),
     'a AMB extrai o pedido de dentro do QR Magalu antes de consultar os eventos');
  ok(trecho.indexOf('external_grouper_code') < trecho.indexOf('A-Za-z0-9_-]{5,60}'),
     '  ANTES do teste de formato (o JSON tem pontuacao e passa de 60: era rejeitado)');
  const SERVER_GOOD = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  ok(/external_grouper_code/.test(SERVER_GOOD.slice(SERVER_GOOD.indexOf('async function buscarEventosCheckout'), SERVER_GOOD.indexOf('async function buscarEventosCheckout') + 1200)),
     '  e a GOOD ja tinha (v4.57.4) — agora as duas empresas iguais');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
