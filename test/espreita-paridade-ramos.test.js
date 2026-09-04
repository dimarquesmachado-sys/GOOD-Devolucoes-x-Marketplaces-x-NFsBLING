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

// ── e o caso do pack ambiguo se explica na tela ─────────────────────
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'painel-devolucoes.html'), 'utf8');
  ok(/pack_varios_pedidos/.test(html),
     'o card explica quando NAO da pra saber qual pedido do pack voltou');
  ok(/abra no ML pra ver qual voltou/.test(html),
     '  dizendo o que fazer, em vez de so ficar vazio');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
