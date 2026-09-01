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

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
