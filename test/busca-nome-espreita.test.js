// Roda com: node test/busca-nome-espreita.test.js
//
// [stated] "quando ele pesquisar assim por nome, e vir mais de 1 resultado,
// meio q dizer qual está pendente de recebimento? Alguma estrelinha... e
// mostrar além do nome e nota fiscal, o produto e quantidade?"
//
// A ESPREITA ja sabe quais devolucoes estao a caminho, com NF e produto.
// A busca por nome cruza com ela: quem esta la ganha estrela, vem primeiro,
// e mostra o que ha na caixa. Sem chamada extra ao Bling.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// ── a logica do cruzamento, com a ESTRUTURA REAL do montarEspreita ──
//
// b229 (Codex): meu teste anterior simulava `ESP_CACHE.itens` — um campo
// que NAO EXISTE. Passava verde enquanto a producao nunca cruzava nada.
// Agora simulo o que `montarEspreita()` devolve de verdade:
//   { em_transito: [...], nunca_bipadas: [...] }, cada item com
//   nf, nf_serie?, tracking, dias | dias_em_transito, baixado, itens
{
  const candidatos = [
    { numero: '133832', serie: '1', nome: 'Maristela Aparecida Felisberto' },
    { numero: '076687', serie: '1', nome: 'Maristela De (almeidamaristela...)' },
    { numero: '076687', serie: '2', nome: 'Outra pessoa, mesma NF em serie 2' },
    { numero: '073232', serie: '1', nome: 'MARISTELA RODRIGUES RAMOS' },
  ];
  const ESP_CACHE = {
    nunca_bipadas: [
      { nf: '76687', nf_serie: '1', tracking: 'AP303530734BR', dias: 23, produto: 'Luminária Mesa 2x1 Pixar',
        itens: [{ qtd: 1, descricao: 'Luminária Mesa 2x1 Pixar Abajur', sku: '417-VAR-1xLED' }] },
      { nf: '73232', tracking: 'XX1', dias: 5, baixado: true },   // ja processado: NAO ganha estrela
    ],
    em_transito: [
      { nf: '133832', tracking: 'YY2', dias_em_transito: 4 },
    ],
  };
  // exatamente o que o server.js faz
  const espreita = []
    .concat(ESP_CACHE.nunca_bipadas.map((e) => ({ ...e, _estado: 'entregue' })))
    .concat(ESP_CACHE.em_transito.map((e) => ({ ...e, _estado: 'em_transito' })))
    .filter((e) => !e.baixado);
  const chaveNF = (nf, serie) => String(nf || '').replace(/^0+/, '') + '/' + (String(serie || '').replace(/^0+/, '') || '1');
  const porNF = new Map();
  for (const e of espreita) {
    const n = String(e.nf || '').replace(/^0+/, ''); if (!n) continue;
    const k = chaveNF(n, e.nf_serie || e.serie);
    if (!porNF.has(k) || e._estado === 'entregue') porNF.set(k, e);
  }
  const out = candidatos.map((c) => {
    const e = porNF.get(chaveNF(c.numero, c.serie));
    return e ? { ...c, na_espreita: true, espreita_estado: e._estado,
      espreita_dias: e._estado === 'entregue' ? e.dias : e.dias_em_transito, itens: e.itens, tracking: e.tracking } : c;
  }).sort((a, b) => (b.na_espreita ? 1 : 0) - (a.na_espreita ? 1 : 0));

  const m = out.find((c) => c.numero === '076687' && c.serie === '1');
  ok(m && m.na_espreita && m.espreita_estado === 'entregue' && m.espreita_dias === 23,
     'a Maristela da NF 76687/1: estrela, ENTREGUE ha 23d');
  ok(m && m.itens[0].descricao.includes('Luminária'), '  e o produto da caixa');
  ok(m && m.tracking === 'AP303530734BR', '  e o rastreio');

  const s2 = out.find((c) => c.numero === '076687' && c.serie === '2');
  ok(s2 && !s2.na_espreita, 'a MESMA NF em serie 2 NAO ganha a estrela — a chave e numero+serie');

  const t = out.find((c) => c.numero === '133832');
  ok(t && t.na_espreita && t.espreita_estado === 'em_transito' && t.espreita_dias === 4,
     'a NF 133832 esta A CAMINHO (4d em transito), nao "entregue"');

  const b = out.find((c) => c.numero === '073232');
  ok(b && !b.na_espreita, 'a NF 73232 esta BAIXADA (ja processada): sem estrela');

  ok(out[0].na_espreita && out[1].na_espreita && !out[2].na_espreita,
     'os dois estrelados vem primeiro');
}

// ── e esta nas duas empresas, no servidor e no front ────────────────
{
  const SRV = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  ok(/na_espreita: true/.test(SRV), 'GOOD servidor: marca o candidato que esta na espreita');
  ok(/candidatos_nome\.sort\(/.test(SRV), '  e ordena: estrelados primeiro');
  ok(/cacheEsp\.nunca_bipadas/.test(SRV) && /cacheEsp\.em_transito/.test(SRV),
     '  lendo `nunca_bipadas` e `em_transito` — os campos que montarEspreita DEVOLVE (nao `itens`)');
  ok(/\.filter\(\(e\) => !e\.baixado\)/.test(SRV), '  e sem os baixados');
  ok(/const chaveNF = \(nf, serie\)/.test(SRV), '  com chave numero+SERIE');

  const AMB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8');
  ok(/na_espreita: true/.test(AMB), 'AMB servidor: marca tambem');
  ok(/espreitaMontada\(\)/.test(AMB),
     '  lendo a espreita JA AGREGADA (ML+Shopee+Magalu, sem baixados, sem CD do ML) — nao o mlReturns cru');
  const APP = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/ESPREITA_AMB_CACHE = \{/.test(APP) && /espreitaMontada: \(\) => ESPREITA_AMB_CACHE/.test(APP),
     '  e o app-AMB guarda a ultima espreita e passa por FUNCAO (escopo derrubou o boot 2x)');
  ok(/\.filter\(\(x\) => !x\.no_cd_ml\)/.test(APP), '  sem os que vao pro CD do ML');
  const iDecl = APP.indexOf('let ESPREITA_AMB_CACHE');
  const iUso = APP.indexOf('ESPREITA_AMB_CACHE = {');
  ok(iDecl > 0 && iDecl < iUso, '  declarada ANTES de usar');

  for (const [nome, rel] of [['GOOD', 'public/js/busca.js'],
                             ['AMB', 'amb-devolucoes/public-AMB/js-AMB/busca.js']]) {
    const js = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/ENTREGUE/.test(js) && /A CAMINHO/.test(js), nome + ' front: distingue ENTREGUE de A CAMINHO');
    ok(/⭐/.test(js), nome + ' front: com a estrela');
    ok(/c\.itens\.slice\(0, 3\)/.test(js), nome + ' front: e ate 3 itens da caixa, com quantidade');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
