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
  //
  // v4.9x (review do Codex no #257) - a 1a versao gastava o orcamento
  // (`podeGastarNaFoto()`) ANTES de validar se o `pai` derivado da chave era
  // usavel. Uma chave como `A-B` consumia a cota mesmo sem chegar a
  // consultar o Bling (o `pai.length >= 3` barrava depois), e seis chaves
  // assim no mesmo minuto esgotavam o teto pra itens validos seguintes.
  // Agora o orcamento so e gasto no instante em que a chamada ao Bling de
  // fato vai acontecer - DEPOIS do `pai` validado.
  ok(/if \(!url && \/\[-_\]\/\.test\(chave\)\) \{/.test(rota),
     '  ⚠️ deriva e valida o pai ANTES de mexer no orcamento');
  ok(/pai && pai !== chave && pai\.length >= 3 && podeGastarNaFoto\(\)/.test(rota),
     '  ⚠️ e SO gasta orcamento com um pai valido, bem antes de chamar o Bling');

  // ⚠️ o ORÇAMENTO existe porque a 1ª versão quebrou tudo: a lista pede
  // foto de até 12 produtos de uma vez, cada um com até 4 tentativas — ~50
  // chamadas simultâneas. A cota estourou e o Bling recusou TODAS,
  // inclusive as que antes funcionavam. O dono viu "sumiram todas as
  // imagens": eu tornei pior o que vim consertar.
  ok(/function podeGastarNaFoto/.test(src),
     '⚠️ ha orcamento de chamadas pra foto');
  ok(/FOTO_EXTRA_POR_MIN \|\| 6/.test(src),
     '  com teto por minuto, ajustavel por env');
  ok(/nao pode atropelar a bipagem/i.test(src),
     '  e o porque escrito (foto e enfeite; a bipagem divide a mesma cota)');
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
