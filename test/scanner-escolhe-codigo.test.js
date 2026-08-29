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

// ── a escolha, simulada ──────────────────────────────────────────────
{
  function escolher(codes, modo) {
    const qr = codes.find((c) => c.format === 'qr_code');
    const barras = codes.find((c) => c.format !== 'qr_code');
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

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
