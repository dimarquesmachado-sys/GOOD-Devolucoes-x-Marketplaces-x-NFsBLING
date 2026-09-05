// Roda com: node test/espreita-paridade-ramos.test.js
//
// A ESPREITA TEM DOIS RAMOS que montam card: `em_transito` (a caminho) e
// `nunca_bipadas` (consta entregue, ninguem bipou). Eles consomem o MESMO
// enriquecimento, mas sao montados em lugares diferentes do server.js.
//
// Foi por isso que este PR levou 6 rodadas: eu tratava um campo num ramo e
// esquecia o outro. Aconteceu com `pedido`, com `nf_devolucao` e com
// `dinheiro` — este ultimo eu so achei auditando campo a campo, depois que
// o dono mandou "pesquisa mais a fundo".
//
// Este teste compara os dois e falha se um ganhar campo que o outro nao tem.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// ── os dois ramos, campo a campo ────────────────────────────────────
{
  const iT = SRC.indexOf('if (en) { d.cliente = en.cliente;');
  const blocoTransito = SRC.slice(iT, iT + 700);
  const doTransito = new Set([...blocoTransito.matchAll(/d\.(\w+) = en\./g)].map((m) => m[1]));
  // tratados nas linhas vizinhas, fora do `if (en) {...}`
  for (const extra of ['pedido', 'nf_devolucao', 'dinheiro']) doTransito.add(extra);

  const iA = SRC.indexOf('nuncaBipadas = baseAlerta.map');
  const fimA = SRC.indexOf('nuncaBipadas = nuncaBipadas.filter', iA);
  const blocoAlerta = SRC.slice(iA, fimA);
  const doAlerta = new Set([...blocoAlerta.matchAll(/(\w+):\s*(?:d\.|en\?|\(\(\))/g)].map((m) => m[1]));

  const soNoTransito = [...doTransito].filter((c) => !doAlerta.has(c));
  ok(soNoTransito.length === 0,
     'todo campo dos EM TRANSITO existe tambem no card de ALERTA'
     + (soNoTransito.length ? ' (FALTAM no alerta: ' + soNoTransito.join(', ') + ')' : ''));

  // os que importam pra decisao do dono, um a um
  for (const campo of ['pedido', 'nf_devolucao', 'dinheiro', 'cliente', 'produto', 'itens', 'nf']) {
    ok(doAlerta.has(campo), '  alerta entrega `' + campo + '`');
  }
}

// ── b236.8: o campo tem que ter VALOR, nao so existir ───────────────
//
// Meu teste anterior comparava a LISTA de campos dos dois ramos e passou —
// mas `dinheiro` no alerta era calculado de `status_money`, que o produtor
// (`lib/ml-returns.js`) nao punha nas entregues. O campo existia e valia
// null sempre. Paridade de fachada.
{
  const ML = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ml-returns.js'), 'utf8');
  const iE = ML.indexOf('entreguesLista.push({');
  const linhaEntregues = ML.slice(iE, ML.indexOf('});', iE));
  ok(/status_money/.test(linhaEntregues),
     'o produtor poe `status_money` nas ENTREGUES (as de transito ja tinham)');

  // e os campos que o card de alerta DERIVA precisam ter fonte
  const iA = SRC.indexOf('nuncaBipadas = baseAlerta.map');
  const blocoA = SRC.slice(iA, SRC.indexOf('nuncaBipadas = nuncaBipadas.filter', iA));
  const derivaDe = [...blocoA.matchAll(/d\.(\w+) ===/g)].map((m) => m[1]);
  for (const campo of new Set(derivaDe)) {
    ok(new RegExp(campo).test(linhaEntregues) || ['marketplace'].includes(campo),
       '  o alerta deriva de `' + campo + '`, e o produtor entrega');
  }
}

// ── nenhuma saida do enriquecedor fica sem consumidor ───────────────
{
  const i = SRC.indexOf('async function enriquecerItemEspreita');
  let n = 0; let j = i;
  for (;;) {
    if (SRC[j] === '{') n++;
    else if (SRC[j] === '}') { n--; if (n === 0) break; }
    j++;
  }
  const fn = SRC.slice(i, j);
  const resto = SRC.slice(0, i) + SRC.slice(j);
  const produz = [...new Set([...fn.matchAll(/out\.(\w+)\s*=/g)].map((m) => m[1]))]
    .filter((c) => !c.startsWith('_'));   // `_incompleto`/`_motivo` sao internos

  const orfaos = produz.filter((c) => !new RegExp('en\\??\\.?' + c + '\\b').test(resto));
  ok(orfaos.length === 0,
     'todo campo que o enriquecedor produz e consumido por algum ramo'
     + (orfaos.length ? ' (ORFAOS: ' + orfaos.join(', ') + ')' : ' (' + produz.length + ' conferidos)'));
}

// ── b237.6: TUDO que a identidade resolve chega ao CACHE ────────────
//
// Este bug apareceu TRES vezes em caminhos diferentes: o pedido resolvido
// ficava so no item `d`, o enriquecimento pulava a propria descoberta
// (porque `d.pedido` ja existia) e o cache saia sem `pedido_descoberto`.
// Na carga seguinte o atalho de cache devolvia um cache "completo" sem
// pedido, e o card voltava a ficar sem link e sem produto.
{
  const iR = SRC.indexOf('async function resolverIdentidadeEspreita');
  const iE = SRC.indexOf('async function enriquecerItemEspreita');
  const resolver = SRC.slice(iR, iE);

  // cada caminho que seta `d.pedido` tem que marcar a origem
  const setaPedido = [...resolver.matchAll(/d\.pedido = String\(([^)]+)\)/g)];
  ok(setaPedido.length >= 2, 'ha mais de um caminho que resolve o pedido (' + setaPedido.length + ')');
  ok(/d\.pedido_resolvido_pela_identidade = /.test(resolver),
     '  o caminho do order_id DIRETO marca a origem');
  ok(/d\.pedido_do_pack_resolvido = /.test(resolver),
     '  e o caminho do PACK com 1 pedido tambem');

  // e o enriquecedor grava os dois no cache
  const enr = SRC.slice(iE, iE + 3000);
  ok(/d\.pedido_do_pack_resolvido \|\| d\.pedido_resolvido_pela_identidade/.test(enr),
     'o enriquecedor grava QUALQUER pedido resolvido no cache (um so ponto)');
  for (const campo of ['pack_id', 'pack_varios_pedidos', 'pedidos_do_pack', 'ship_do_pack']) {
    ok(new RegExp('out\\.' + campo).test(enr),
       '  e tambem `' + campo + '`, senao a proxima carga reconsulta o ML');
  }
}

// ── e o caso do pack ambiguo se explica na tela ─────────────────────
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'painel-devolucoes.html'), 'utf8');
  ok((html.match(/pack_varios_pedidos/g) || []).length >= 3,
     'os DOIS cards (alerta e em transito) explicam o pack ambiguo');
  ok(/abra no ML pra ver qual voltou/.test(html),
     '  dizendo o que fazer, em vez de so ficar vazio');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
