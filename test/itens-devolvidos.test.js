// Roda com: node test/itens-devolvidos.test.js
//
// Ate a v4.77 a triagem gravava SEMPRE nf.itens[0].sku e a quantidade SOMADA
// de todos os itens da nota. Numa nota multi-produto isso descreve o PEDIDO,
// nao a devolucao.
//
// Caso real (GOOD, NF 076466, cliente Antonio): dois SKUs na mesma nota —
// KJDDE-693-8 e KJDDE-693-6, 2 unidades cada. Ficava gravado
// "KJDDE-693-8, qtd 4", seja qual for o item que o Lucas triou.
//
// O conserto nao e adivinhar: o estoquista JA BIPA cada item, e
// bipagemEstado.itensEsperados[].bipados guarda o que ele conferiu.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const TRIAGEM = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'triagem.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const PAINEL = fs.readFileSync(path.join(RAIZ, 'public', 'painel-devolucoes.html'), 'utf8');

// ── a triagem usa o que foi BIPADO ───────────────────────────────────
{
  ok(/bipadosDeVerdade = esperados\.filter\(\(i\) => \(Number\(i\.bipados\) \|\| 0\) > 0\)/.test(TRIAGEM),
     'a triagem olha o que o estoquista BIPOU, item a item');
  ok(/const itemBipado = bipadosDeVerdade\.length > 0 \? bipadosDeVerdade\[0\] : null;/.test(TRIAGEM),
     '  e o SKU vem do item bipado, nao do primeiro da nota');
  ok(/qtdTotal = bipadosDeVerdade\.length > 0/.test(TRIAGEM),
     '  a quantidade soma so os BIPADOS, nao a nota inteira');
  ok(/itens_devolvidos: itensDevolvidos/.test(TRIAGEM),
     'e vai a lista completa do que voltou');
  ok(/cai no comportamento antigo/.test(TRIAGEM),
     'bipagem pulada cai no comportamento antigo — e o que da pra afirmar sem o dado');
}

// ── a decisao, nos quatro cenarios ───────────────────────────────────
{
  const montar = (esperados, itensNF) => {
    const bip = esperados.filter((i) => (Number(i.bipados) || 0) > 0);
    const item = bip.length > 0 ? bip[0] : (itensNF.length > 0 ? itensNF[0] : null);
    const qtd = bip.length > 0
      ? bip.reduce((s, i) => s + (Number(i.bipados) || 0), 0)
      : itensNF.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);
    return { sku: item && item.sku, qtd, lista: bip.length > 0 ? bip.length : null };
  };
  const NF = [{ sku: 'KJDDE-693-8', quantidade: 2 }, { sku: 'KJDDE-693-6', quantidade: 2 }];

  const so2o = montar([{ sku: 'KJDDE-693-8', bipados: 0 }, { sku: 'KJDDE-693-6', bipados: 2 }], NF);
  ok(so2o.sku === 'KJDDE-693-6' && so2o.qtd === 2,
     'so o SEGUNDO item voltou: grava ele, com a qtd dele (antes: 1o item, qtd 4)');

  const parcial = montar([{ sku: 'KJDDE-693-8', bipados: 1 }, { sku: 'KJDDE-693-6', bipados: 0 }], NF);
  ok(parcial.sku === 'KJDDE-693-8' && parcial.qtd === 1,
     'so UMA unidade do primeiro: qtd 1, nao 4');

  const ambos = montar([{ sku: 'KJDDE-693-8', bipados: 2 }, { sku: 'KJDDE-693-6', bipados: 2 }], NF);
  ok(ambos.qtd === 4 && ambos.lista === 2,
     'os DOIS voltaram: qtd 4 e a lista com 2 SKUs');

  const pulada = montar([{ sku: 'KJDDE-693-8', bipados: 0 }, { sku: 'KJDDE-693-6', bipados: 0 }], NF);
  ok(pulada.sku === 'KJDDE-693-8' && pulada.qtd === 4 && pulada.lista === null,
     'bipagem PULADA: comportamento antigo, sem inventar');
}

// ── grava e aparece ──────────────────────────────────────────────────
{
  const ocorrencias = (SERVER.match(/itens_devolvidos: dados\.itens_devolvidos \|\| null,/g) || []).length;
  ok(ocorrencias === 3,
     'a coluna e gravada em TODOS os pontos de insercao (achei ' + ocorrencias + ')');

  ok(/itens_devolvidos\.length > 1/.test(PAINEL),
     'o card marca quando a devolucao tem mais de um SKU');
  ok(/📦 \$\{d\.itens_devolvidos\.length\} SKUs/.test(PAINEL),
     '  com a contagem visivel');
  ok(/title="\$\{escapeHtml\(d\.itens_devolvidos\.map/.test(PAINEL),
     '  e a lista no title, escapada');

  const DOC = fs.readFileSync(path.join(RAIZ, 'docs', 'ITENS-DEVOLVIDOS.md'), 'utf8');
  ok(/ALTER TABLE devolucoes\s+ADD COLUMN IF NOT EXISTS itens_devolvidos jsonb/.test(DOC),
     'o SQL da coluna esta documentado');
  ok(/devolucoes_amb/.test(DOC), '  pras DUAS empresas');
  ok(/a informação nunca existiu/.test(DOC),
     'e a doc diz que triagens antigas nao dao pra reconstruir — o dado nunca existiu');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
