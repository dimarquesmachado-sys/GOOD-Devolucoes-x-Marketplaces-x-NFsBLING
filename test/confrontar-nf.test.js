// Roda com: node test/confrontar-nf.test.js
//
// [stated] "tipo uma 2a verificação o nome do cliente? se não, deixa as NFs
// iguais q eu seleciono. ou checar ainda, de qual marketplace tá vindo a
// venda, e confrontar isso tb."
//
// As tres ideias dele viraram uma escada, da mais forte pra mais fraca:
//   chave > serie > marketplace > cliente
//
// E quando nada decide, as candidatas vao pro card — porque chutar aqui e
// gerar devolucao contra a venda errada.

const fs = require('fs');
const path = require('path');
const C = require('../lib/confrontar-nf');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// o caso REAL que ele achou
const CHAVE_S1 = '35260564289091000100550010000006371757802116';   // serie 001, mai/26
const CHAVE_S3 = '35260864289091000100550030000006371448079669';   // serie 003, ago/26

// ── a chave decide sozinha ──────────────────────────────────────────
{
  const item = { nf_chave: CHAVE_S1, nf_numero: '637', marketplace: 'magalu' };
  const certa = { id: 2, numero: '000637', chaveAcesso: CHAVE_S1, loja: 'MagaluOpenApi' };
  const outra = { id: 1, numero: '000637', chaveAcesso: CHAVE_S3, loja: 'MagaluOpenApi' };

  ok(C.avaliar(item, certa).decide === true, 'chave batendo decide sozinha');
  ok(C.avaliar(item, outra).recusa === true,
     'e serie divergente RECUSA — foi o caso real da NF 637');

  const r = C.escolher(item, [outra, certa]);
  ok(r.escolhida && r.escolhida.id === 2, 'entre as duas, escolhe a da serie certa');
  ok(r.por.includes('chave'), '  pela chave');
}

// ── o marketplace desempata ─────────────────────────────────────────
{
  ok(C.marketplaceDaNF({ loja: 'MagaluOpenApi' }) === 'magalu',
     'a "Origem loja virtual" do Bling vira o nome que usamos');
  ok(C.marketplaceDaNF({ loja: 'TikTok' }) === 'tiktok', '  TikTok tambem');
  ok(C.marketplaceDaNF({}) === null, 'e sem o campo, nao inventa');

  const item = { nf_numero: '637', marketplace: 'magalu' };
  const doMagalu = { id: 1, numero: '000637', loja: 'MagaluOpenApi' };
  const doTikTok = { id: 2, numero: '000637', loja: 'TikTok' };
  const a = C.avaliar(item, doMagalu);
  const b = C.avaliar(item, doTikTok);
  ok(a.bate.includes('marketplace'), 'a nota do mesmo marketplace pontua');
  ok(b.diverge.includes('marketplace'), '  e a de outro diverge');
}

// ── o cliente e a 2a verificacao, quando existe ─────────────────────
{
  const a = { id: 1, numero: '637', loja: 'MagaluOpenApi', contato: { nome: 'Ana Silva' } };
  const b = { id: 2, numero: '637', loja: 'MagaluOpenApi', contato: { nome: 'Bruno Costa' } };

  const semCliente = C.escolher({ nf_numero: '637', marketplace: 'magalu' }, [a, b]);
  ok(!semCliente.escolhida && semCliente.candidatas.length === 2,
     'sem cliente no caso, as DUAS viram candidatas — nao chuto');

  const comCliente = C.escolher(
    { nf_numero: '637', marketplace: 'magalu', cliente: 'Bruno Costa' }, [a, b]);
  ok(comCliente.escolhida && comCliente.escolhida.id === 2,
     'com o cliente, ele desempata');
  ok(comCliente.por.includes('cliente'), '  e o motivo fica registrado');

  // nome truncado pelo marketplace ainda casa
  const truncado = C.escolher(
    { nf_numero: '637', marketplace: 'magalu', cliente: 'Bruno Cos' }, [a, b]);
  ok(truncado.escolhida && truncado.escolhida.id === 2,
     'nome truncado pelo marketplace ainda casa (comparo por prefixo)');
}

// ── e o card mostra as candidatas ───────────────────────────────────
{
  for (const [nome, rel] of [
    ['GOOD', 'public/painel-devolucoes.html'],
    ['AMB (servido)', 'amb-devolucoes/public-AMB/painel-AMB.html'],
    ['AMB (direto)', 'amb-devolucoes/public-AMB/painel2-AMB.html'],
  ]) {
    const html = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/qual é a desta venda\?/.test(html), nome + ': o card pergunta qual das notas e');
    ok(/chk-candidata/.test(html), nome + '  com radio pra escolher');
    ok(/marcada\.dataset\.nfid/.test(html), nome + '  e a escolha manda no botao');
    ok(/escolha qual NF é a desta venda antes de gerar/.test(html),
       nome + '  sem escolher, nao gera');
  }

  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/confrontar\.escolher\(item,/.test(src), nome + ': a rota usa a escada');
    ok(/item\.nf_candidatas = veredito\.candidatas/.test(src),
       nome + '  e guarda as candidatas quando nada decide');
  }
}

// ── b209: a SERIE diz se a nota e nossa ou do FULL ──────────────────
//
// [stated] "na good vai ter série 2 pra MercadoLivre Full. tb tem amazon
// FULL, e Magalu FULL em outras series"
{
  ok(C.canalDaSerie('001', 'good') === 'propria', 'serie 1 = emissao nossa');
  ok(C.canalDaSerie('002', 'good') === 'mercadolivre-full',
     'serie 2 na GOOD = ML Full, como ele informou');
  ok(C.canalDaSerie('003', 'amb') === 'full',
     'serie 3 na AMB = Full (as notas de jul-ago/26 sao dela)');
  ok(C.canalDaSerie('007', 'amb') === 'full-desconhecido',
     'serie que ainda nao mapeei ainda e reconhecida como Full');
  ok(C.canalDaSerie('abc', 'good') === null, 'lixo nao vira canal');

  ok(C.ehDoFull('002', 'good') === true, 'e o Full e sinalizado');
  ok(C.ehDoFull('001', 'good') === false, '  a nossa nao');

  // o caso real: mesma NF 637 em duas series
  ok(C.serieDaChave('35260564289091000100550010000006371757802116') === '001'
     && C.serieDaChave('35260864289091000100550030000006371448079669') === '003',
     'a NF 637 existe nas duas series — a numeracao reinicia por serie');
}

// ── e a tela avisa quando a nota e do Full ──────────────────────────
{
  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/item\.nf_do_full = confrontar\.ehDoFull/.test(src),
       nome + ': a rota marca quando a nota e do Full');
  }
  for (const [nome, rel] of [
    ['GOOD', 'public/painel-devolucoes.html'],
    ['AMB (servido)', 'amb-devolucoes/public-AMB/painel-AMB.html'],
    ['AMB (direto)', 'amb-devolucoes/public-AMB/painel2-AMB.html'],
  ]) {
    const html = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/emitida pelo /.test(html) && /marketplace no Full/.test(html),
       nome + ': o card avisa que quem emitiu foi o marketplace');
  }
}

// ── b210: o mapa se APRENDE observando as notas ─────────────────────
//
// [stated] "vendas normais da matriz tudo série 1. daí cada marketplace com
// operação fullfilment vai ter 1 série específica"
//
// A regra e firme e toda nota traz serie e origem juntas — entao nao
// preciso que ele lembre dos numeros de cada Full.
{
  C._APRENDIDO.clear();
  ok(C.canalDaSerie('005', 'good') === 'full-desconhecido',
     'serie nunca vista e Full, mas sem saber de qual marketplace');

  for (let i = 0; i < 3; i++) C.aprender('good', '005', { loja: 'Amazon FBA' });
  ok(C.canalDaSerie('005', 'good') === 'amazon-full',
     'depois de ver 3 notas, o sistema sabe que a serie 5 e da Amazon');

  const mapa = C.mapaAprendido();
  ok(mapa.length === 1 && mapa[0].serie === '005' && mapa[0].vistas === 3,
     'e o mapa conta quantas vezes viu, pro dono conferir');

  // origem conflitante: NAO escolho sozinho
  C.aprender('good', '005', { loja: 'MagaluOpenApi' });
  ok(C.canalDaSerie('005', 'good') === 'full-desconhecido',
     'com duas origens na mesma serie, volto a "nao sei" — nao chuto');
  ok(C.mapaAprendido()[0].duvidoso === true,
     '  e marco como duvidoso, com as duas origens listadas');

  // a serie 1 nunca entra: e a matriz
  C._APRENDIDO.clear();
  C.aprender('good', '001', { loja: 'TikTok' });
  ok(C.mapaAprendido().length === 0,
     'serie 1 nao entra no mapa — e a emissao da matriz, nao de Full');
}

// ── e o aprendizado esta ligado ─────────────────────────────────────
{
  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/confrontar\.aprender\(/.test(src),
       nome + ': cada nota vinculada ensina o mapa');
  }
  const debug = fs.readFileSync(path.join(RAIZ, 'lib', 'rotas-debug.js'), 'utf8');
  ok(/'\/api\/debug\/series'/.test(debug),
     'e ha rota pra ele conferir o que o sistema aprendeu');
  ok(/duvidoso/.test(debug), '  com as series duvidosas destacadas');
}

// ── b210.1: os cinco da rodada ──────────────────────────────────────
{
  // `loja` no Bling e OBJETO com id — normalizar viraria "objectobject"
  ok(C.marketplaceDaNF({ loja: { id: 1, nome: 'TikTok' } }) === 'tiktok',
     'le o nome de dentro do objeto `loja`');
  ok(C.marketplaceDaNF({ loja: { id: 203764162 } }) === 'loja203764162',
     '  e sem nome, guarda o id em vez de virar lixo');
  ok(C.marketplaceDaNF({ loja: 'MagaluOpenApi' }) === 'magalu',
     '  texto direto continua funcionando');

  // a varredura devolve TODAS as vivas, senao a escada nunca oferece escolha
  for (const [nome, rel] of [['GOOD', 'lib/bling.js'],
                             ['AMB', 'amb-devolucoes/lib-AMB/admin-helpers-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/const vivasVarredura = candidatas/.test(src),
       nome + ': a varredura guarda todas as vivas');
    // b210.3: virou  — o acumulado de todas as paginas
    ok(/candidatas: todasAteAqui/.test(src),
       nome + '  e devolve a lista — senao a escada recebia 1 item so');
  }

  // a serie e marcada em TODA fase que vincula
  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/a SERIE e marcada pra TODOS que ganharam vinculo/.test(src),
       nome + ': a serie e marcada em toda fase, nao so na do numero');
    ok(/nao achei NF viva com o numero/.test(src),
       nome + ': e o motivo diz "nao achei", nao "nao existe"');
    ok(/fora do alcance da busca/.test(src),
       nome + '  porque a busca nao e exaustiva');
  }
}

// ── b210.2: acumular entre paginas, e aprender sem chave ────────────
{
  for (const [nome, rel] of [['GOOD', 'lib/bling.js'],
                             ['AMB', 'amb-devolucoes/lib-AMB/admin-helpers-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const i = src.indexOf('async function buscarNFnoBlingPorNumero');
    const fn = src.slice(i, i + 13000);
    ok(/const acumuladas = \[\];/.test(fn),
       nome + ': junta as candidatas de TODAS as paginas');
    ok(/candidatas: todas/.test(fn),
       nome + '  e entrega a lista completa no fim');
    ok(/retornar\s*\n?\s*\/\/ na primeira que casa expunha uma candidata so/.test(fn),
       nome + ': com o motivo — parar na 1a pagina escondia as outras');
  }

  // b210.3: no limite de paginas, entrega o ACUMULADO (nao so a ultima)
  for (const [nome, rel] of [['GOOD', 'lib/bling.js'],
                             ['AMB', 'amb-devolucoes/lib-AMB/admin-helpers-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const i = src.indexOf('async function buscarNFnoBlingPorNumero');
    const fn = src.slice(i, i + 13000);
    ok(/candidatas: todasAteAqui/.test(fn),
       nome + ': no limite de paginas entrega o acumulado, nao so a ultima');
    ok(!/candidatas: vivasVarredura,/.test(fn),
       nome + '  sem jogar fora as candidatas das paginas anteriores');
  }

  // b210.3: a varreduraFundo da AMB NAO tem acumulador — meu retorno
  // acumulado entrou nela por engano e daria ReferenceError
  {
    const src = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'admin-helpers-AMB.js'), 'utf8');
    const i = src.indexOf('async function varreduraFundo');
    const j = src.indexOf('async function buscarNFnoBlingPorNumero');
    const fundo = src.slice(i, j);
    ok(!/const todas = acumuladas/.test(fundo),
       'a varreduraFundo NAO usa `acumuladas` — daria ReferenceError');
    ok(/return \{ ok: true, match: null, totalScanned/.test(fundo),
       '  ela devolve um miss limpo, como antes');
  }

  // b216.2: a saida final distingue "varri tudo" de "acabaram as paginas"
  for (const [nome, rel] of [['GOOD', 'lib/bling.js'],
                             ['AMB', 'amb-devolucoes/lib-AMB/admin-helpers-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const i = src.indexOf('async function buscarNFnoBlingPorNumero');
    const fn = src.slice(i, i + 12000);
    ok(/listaCompleta: !paginasEsgotadas/.test(fn),
       nome + ': a saida final nao se declara completa quando bateu no teto');
    ok(/paginasEsgotadas = \(pagina === MAX_PAGINAS\)/.test(fn),
       nome + '  marcando na ultima pagina permitida');
    ok(!/candidatas: todas, listaCompleta: true/.test(fn),
       nome + '  sem o `true` fixo que valia pros dois casos');
  }

  // a logica, simulada
  {
    const MAX = 8;
    const sim = (paginasComDados, quebraPorFimDeDados) => {
      let esgotadas = false;
      for (let p = 1; p <= MAX; p++) {
        esgotadas = (p === MAX);
        if (quebraPorFimDeDados && p === paginasComDados) { esgotadas = false; break; }
      }
      return !esgotadas;
    };
    ok(sim(3, true) === true, 'dados acabaram na pagina 3: lista COMPLETA');
    ok(sim(99, false) === false,
       'bateu no teto com dados ainda vindo: INCOMPLETA (o painel nao escolhe sozinho)');
  }

  // b210.4: NENHUM caminho de erro descarta o acumulado
  for (const [nome, rel] of [['GOOD', 'lib/bling.js'],
                             ['AMB', 'amb-devolucoes/lib-AMB/admin-helpers-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const i = src.indexOf('async function buscarNFnoBlingPorNumero');
    const fn = src.slice(i, i + 9800);
    const semAcumulado = [...fn.matchAll(/return \{ ok: false[^;]{0,220}/g)]
      .filter((m) => !m[0].includes('candidatas'));
    ok(semAcumulado.length === 0,
       nome + ': erro no meio da varredura NAO joga fora o que ja achei');
  }

  // b210.4: o aviso de Full usa a serie da candidata quando falta a chave
  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/const serieDela = confrontar\.serieDaChave\(item\.nf_chave\)\s*\n?\s*\|\| \(escolhida/.test(src),
       nome + ': o aviso de Full usa a serie da candidata quando falta a chave');
  }

  // o mapa aprende mesmo quando a listagem omite a chave
  C._APRENDIDO.clear();
  C.aprender('good', '5', { loja: 'Amazon FBA' });
  ok(C.mapaAprendido().length === 1,
     'aprende pela `serie` da nota quando nao ha chave pra extrair');

  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/escolhida\.serie != null \? String\(escolhida\.serie\) : null/.test(src),
       nome + ': usa a serie da candidata como reserva');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
