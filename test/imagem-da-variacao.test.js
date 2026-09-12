// Roda com: node test/imagem-da-variacao.test.js
//
// ⚠️ CASO REAL (11/09): vários defeitos na lista aparecendo com ícone de
// caixa em vez da foto. O padrão saltou no print — `288-VAR`, `801s-BP`,
// `RA-45-GOLD-ASH`, `KJDD-E-003-GOLD`. **Todos variações.**
//
// NO BLING, A FOTO DA VARIAÇÃO COSTUMA ESTAR NO PAI. A variação herda
// visualmente, mas o registro dela vem sem imagem própria — e as 3
// tentativas da rota procuravam só por ela.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const src = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'rotas-admin-nf.js'), 'utf8');
const i = src.indexOf("app.get('/api/produto/imagem/:id'");
const rota = src.slice(i, i + 6000);

// ── ⚠️ a rota tenta o produto pai ───────────────────────────────────
{
  ok(/pai_da_variacao/.test(rota),
     '⚠️ a rota tenta o PAI da variacao quando nao acha a foto');
  ok(/chave\.replace\(\/\[-_\]\[\^-_\]\+\$\/, ''\)/.test(rota),
     '  cortando o sufixo no ultimo separador');

  // ⚠️ e SÓ quando as outras falharam: foto é enfeite, não vale gastar
  // chamada do Bling (que espera na fila do porteiro)
  ok(/if \(!url && \/\[-_\]\/\.test\(chave\)\)/.test(rota),
     '  ⚠️ e SO quando as outras tentativas falharam (foto e enfeite)');
}

// ── e o corte funciona nos casos reais do print ─────────────────────
{
  const casos = [
    ['288-VAR', '288'],
    ['801s-BP', '801s'],
    ['RA-45-GOLD-ASH', 'RA-45-GOLD'],
    ['KJDD-E-003-GOLD', 'KJDD-E-003'],
    ['SEMTRACO', null],          // sem separador: não tenta
  ];
  for (const [sku, esperado] of casos) {
    const pai = sku.replace(/[-_][^-_]+$/, '');
    const vale = pai !== sku && pai.length >= 3 ? pai : null;
    ok(vale === esperado,
       '  ' + sku.padEnd(17) + ' → ' + (vale || '(nao tenta)'));
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
