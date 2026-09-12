// Roda com: node test/defeito-colunas-obrigatorias.test.js
//
// ⚠️ CASO REAL (11/09), e a mensagem já legível graças ao #247:
//
//   null value in column "shipment_id" of relation "devolucoes"
//   violates not-null constraint
//
// A tabela `devolucoes` nasceu para retorno de VENDA — todo registro vinha
// com envio, comprador e NF. O **defeito de estoque** é controle interno:
// não tem venda, nem cliente, nem envio. E a coluna continua exigindo valor.
//
// ⚠️ E o defeito não preenche 14 das colunas que a triagem preenche. Se
// outra delas também for NOT NULL, o erro vem UMA DE CADA VEZ — e o dono
// descobre no tapa, perdendo o preenchimento a cada tentativa.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const iDef = srv.indexOf("tipo: 'defeito_estoque'");
const ini = srv.lastIndexOf('insert([{', iDef);
const insert = srv.slice(ini, srv.indexOf('}])', ini));

// ── ⚠️ o shipment_id é preenchido, e de forma reconhecível ──────────
{
  ok(/shipment_id: 'DEF-'/.test(insert),
     '⚠️ o defeito preenche `shipment_id` (a coluna e NOT NULL)');
  ok(/Date\.now\(\)/.test(insert) && /Math\.random\(\)/.test(insert),
     '  com id proprio e unico');

  // ⚠️ e NÃO pode ser só dígito: colidiria com shipment de verdade do ML
  ok(/'DEF-'/.test(insert),
     '  ⚠️ com prefixo DEF- (quem olhar a tabela sabe que nao e envio real)');
}

// ── e a falha por coluna obrigatória diz QUAL ───────────────────────
//
// ⚠️ Não dá para saber daqui quais das 14 colunas ausentes são NOT NULL —
// só o banco sabe, e é o de produção. Então a mensagem tem que servir.
{
  // ⚠️ recorto ate o fim do bloco contando chaves: a janela de 1400 chars
  // quebrou quando o tratamento cresceu pra cobrir CHECK constraint tambem.
  // Nona vez hoje que janela fixa me da resposta errada.
  const iErr = srv.indexOf('if (error) {', iDef);
  let prof = 0;
  let fimErr = iErr;
  for (let k = srv.indexOf('{', iErr); k < srv.length; k++) {
    if (srv[k] === '{') prof++;
    else if (srv[k] === '}') { prof--; if (prof === 0) { fimErr = k; break; } }
  }
  const bloco = srv.slice(iErr, fimErr);
  ok(/null value in column/.test(bloco),
     'o erro de coluna obrigatoria e reconhecido');
  ok(/coluna_faltando/.test(bloco),
     '  e devolve QUAL coluna faltou');
  ok(/nao vem de venda/.test(bloco),
     '  explicando por que ela falta (defeito nao vem de venda)');

  // ⚠️ e CHECK constraint tambem: o dono levou DOIS erros de banco
  // seguidos — coluna obrigatoria, depois valor fora da lista aceita.
  ok(/violates check constraint/.test(bloco),
     '⚠️ e reconhece CHECK constraint tambem (nao so NOT NULL)');
  ok(/regra_violada/.test(bloco),
     '  devolvendo QUAL regra foi violada');
}

// ── e o parse da mensagem do Postgres funciona ──────────────────────
{
  const casos = [
    ['null value in column "shipment_id" of relation "devolucoes" violates not-null constraint', 'shipment_id'],
    ['null value in column "order_id" of relation "devolucoes" violates not-null constraint', 'order_id'],
    ['outro erro qualquer', null],
  ];
  for (const [msg, esperado] of casos) {
    const m = /null value in column "(\w+)"/.exec(msg);
    const achado = m ? m[1] : null;
    ok(achado === esperado,
       '  parse: ' + (esperado || '(sem coluna)') + ' → ' + (achado || '(sem coluna)'));
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
