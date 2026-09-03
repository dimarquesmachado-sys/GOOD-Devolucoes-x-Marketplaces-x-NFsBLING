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

// ── a logica do cruzamento, simulada com o caso real da tela ────────
{
  const candidatos = [
    { numero: '133832', nome: 'Maristela Aparecida Felisberto' },
    { numero: '076687', nome: 'Maristela De (almeidamaristela...)' },
    { numero: '073232', nome: 'MARISTELA RODRIGUES RAMOS' },
  ];
  const espreita = [
    { nf: '76687', tracking: 'AP303530734BR', dias: 23, produto: 'Luminária Mesa 2x1 Pixar',
      itens: [{ qtd: 1, descricao: 'Luminária Mesa 2x1 Pixar Abajur', sku: '417-VAR-1xLED' }] },
  ];
  const porNF = new Map(espreita.map((e) => [String(e.nf).replace(/^0+/, ''), e]));
  const out = candidatos.map((c) => {
    const e = porNF.get(String(c.numero).replace(/^0+/, ''));
    return e ? { ...c, na_espreita: true, itens: e.itens, tracking: e.tracking } : c;
  }).sort((a, b) => (b.na_espreita ? 1 : 0) - (a.na_espreita ? 1 : 0));

  ok(out[0].numero === '076687', 'a Maristela da espreita vem PRIMEIRO');
  ok(out[0].na_espreita === true, '  com a estrela');
  ok(out[0].itens[0].descricao.includes('Luminária'), '  e o produto da caixa');
  ok(out[0].tracking === 'AP303530734BR', '  e o rastreio, pra bater com a etiqueta');
  ok(!out[1].na_espreita && !out[2].na_espreita, 'as outras duas seguem sem estrela');
  ok(out.length === 3, 'nenhuma some — o dono ainda pode escolher outra');

  // o "076687" do indice casa com o "76687" da espreita (zeros a esquerda)
  ok(porNF.get('76687') !== undefined, 'a comparacao ignora zeros a esquerda');
}

// ── e esta nas duas empresas, no servidor e no front ────────────────
{
  const SRV = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  ok(/na_espreita: true/.test(SRV), 'GOOD servidor: marca o candidato que esta na espreita');
  ok(/candidatos_nome\.sort\(/.test(SRV), '  e ordena: estrelados primeiro');
  ok(/ESP_CACHE && Array\.isArray\(ESP_CACHE\.itens\)/.test(SRV),
     '  lendo do cache da espreita, sem chamada extra ao Bling');

  const AMB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8');
  ok(/na_espreita: true/.test(AMB), 'AMB servidor: marca tambem');
  ok(/Array\.isArray\(r\.entregues\)/.test(AMB) && /Array\.isArray\(r\.em_transito\)/.test(AMB),
     '  lendo `entregues` e `em_transito` do resumoEspreita — `atrasadas_30d` e numero, nao lista');

  for (const [nome, rel] of [['GOOD', 'public/js/busca.js'],
                             ['AMB', 'amb-devolucoes/public-AMB/js-AMB/busca.js']]) {
    const js = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/NA ESPREITA/.test(js), nome + ' front: mostra a etiqueta "NA ESPREITA"');
    ok(/⭐/.test(js), nome + ' front: com a estrela');
    ok(/c\.itens\.slice\(0, 3\)/.test(js), nome + ' front: e ate 3 itens da caixa, com quantidade');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
