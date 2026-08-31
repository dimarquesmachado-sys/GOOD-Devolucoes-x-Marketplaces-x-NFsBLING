// Roda com: node test/marcadores-estornada.test.js
//
// A CLASSE DE BUG QUE ISTO MATA: eu gravava um marcador na descricao e
// esquecia de ensinar algum leitor a ler. Aconteceu TRES vezes seguidas —
// `[DEFEITO]`, `[SO RASCUNHO]` e `[data:]` — porque os leitores viviam em 3
// paineis diferentes e eu so lembrava de um.
//
// Agora quem monta e quem le moram na MESMA peca, o servidor decodifica, e a
// tela le campos normais.

const fs = require('fs');
const path = require('path');
const m = require('../lib/marcadores-estornada');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// ── monta e le: o que entra e o que sai ─────────────────────────────
{
  const d = m.montarDescricao({
    chave_caso: 'P1#76466',
    nf_emitida_em: '2026-05-14T10:00:00Z',
    marketplace: 'tiktok', classe: 'refund',
  });
  const r = m.ler(d);
  ok(r.veio_do_card === true, 'a linha do card se identifica');
  ok(r.so_rascunho === true, 'e diz que e so rascunho');
  ok(r.chave_caso === 'P1#76466', 'a chave da solicitacao volta inteira');
  ok(r.data_origem === '2026-05-14', 'e a data da NOTA, nao a do registro');

  ok(m.ler('bipagem normal').veio_do_card === false,
     'linha de BIPE nao e tocada — nada muda pra ela');
  ok(m.ler(null).veio_do_card === false, 'e descricao vazia tambem nao');
}

// ── o deposito: DEFEITO e o padrao ──────────────────────────────────
{
  ok(m.ler(m.montarDescricao({ entrada_estoque: false })).dep_sugerido === 'defeito',
     'nao voltou -> DEFEITO');
  ok(m.ler(m.montarDescricao({})).dep_sugerido === 'defeito',
     'campo AUSENTE (reembolso TikTok) -> DEFEITO, nao Geral');
  ok(m.ler(m.montarDescricao({ entrada_estoque: null })).dep_sugerido === 'defeito',
     'classe ambigua do Magalu (null) -> DEFEITO tambem');
  ok(m.ler(m.montarDescricao({ entrada_estoque: true })).dep_sugerido === '',
     'so vai pra GERAL quando SABEMOS que voltou');
}

// ── o enriquecimento nao estraga as outras linhas ───────────────────
{
  const linhas = [
    { id: 1, problema_descricao: 'bipagem OK' },
    { id: 2, problema_descricao: m.montarDescricao({ chave_caso: 'X', entrada_estoque: false }) },
  ];
  const out = m.enriquecer(linhas);
  ok(out[0].dep_sugerido === undefined, 'linha de bipe passa intacta');
  ok(out[1].dep_sugerido === 'defeito' && out[1].so_rascunho === true,
     'e a do card ganha os campos decodificados');
  ok(m.enriquecer(null).length === 0, 'lista vazia nao quebra');
}

// ── ninguem mais decodifica por conta propria ───────────────────────
{
  for (const [nome, rel] of [
    ['GOOD', 'public/painel-devolucoes.html'],
    ['AMB (servido)', 'amb-devolucoes/public-AMB/painel-AMB.html'],
    ['AMB (direto)', 'amb-devolucoes/public-AMB/painel2-AMB.html'],
  ]) {
    const html = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(!/\[DEFEITO\\\]\/\.test\(d\.problema_descricao/.test(html),
       nome + ': nao le [DEFEITO] com regex — usa `d.dep_sugerido`');
    ok(!/problema_descricao \|\| ''\)\.includes\('\[SO RASCUNHO\]'\)/.test(html),
       nome + ': nao le [SO RASCUNHO] com includes — usa `d.so_rascunho`');
  }

  // e o servidor decodifica antes de mandar
  const SERVER = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const AMB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/marcadores\.enriquecer\(aprovadas\)/.test(SERVER), 'a GOOD enriquece a fila');
  // b200.1: o campo da AMB e `registros` — conferido em `listarFila`
  ok(/marcadores\.enriquecer\(r\.registros\)/.test(AMB),
     'e a AMB enriquece `registros`, que e o que `listarFila` devolve');
  ok(!/enriquecer\(r\.itens\)|enriquecer\(r\.data\)/.test(AMB),
     '  nao `itens` nem `data`, que nao existem — a decodificacao nao chegaria em nada');

  // e o handler da GOOD RESPONDE (um `return` solto matava a rota)
  const iFila = SERVER.indexOf("app.get('/api/admin/devolucoes'");
  const fila = SERVER.slice(iFila, iFila + 7000);
  ok(!/return\s*\n\s*\/\//.test(fila),
     'sem `return` solto antes do res.json — ele encerrava a rota e o painel travava');
  ok(/marcadores\.montarDescricao/.test(SERVER) && /marcadores\.montarDescricao/.test(AMB),
     'e as duas MONTAM pela mesma peca — marcador novo mexe num arquivo so');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
