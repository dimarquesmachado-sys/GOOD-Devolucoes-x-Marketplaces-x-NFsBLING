// Roda com: node test/roteamento-codigo-bipado.test.js
//
// Guarda o bug de 27/08, achado com etiqueta REAL (SPX Devolucao):
// o "Pedido" impresso (order_sn 250807PBTHEWQG) perdia as letras na
// normalizacao, virava "250807" e era tratado como NUMERO DE NF. A busca
// respondia "NF 250807 nao localizada no Bling" e retornava ali, sem
// nunca consultar a Shopee — e esse e justamente o codigo que a nossa
// mensagem de erro manda o estoquista digitar.

const fs = require('fs');
const path = require('path');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// Reproduz a decisao exatamente como esta no server.
function classificar(codigoOriginal) {
  const codigoLimpo = String(codigoOriginal).replace(/[^0-9]/g, '');
  const ehChaveNFe = codigoLimpo.length === 44;
  const mNumSerie = String(codigoOriginal || '').trim().match(/^(\d{4,9})\s*[\/\-]\s*(\d{1,3})$/);
  const temLetraNoOriginal = /[A-Za-z]/.test(String(codigoOriginal || '').trim());
  const ehNumeroNF = !ehChaveNFe && (mNumSerie || (/^\d{4,9}$/.test(codigoLimpo) && !temLetraNoOriginal));
  return ehChaveNFe ? 'chave_danfe' : (ehNumeroNF ? 'numero_nf' : 'segue_cascata');
}

// ── o caso que quebrou, com os dados da etiqueta real ────────────────
ok(classificar('250807PBTHEWQG') === 'segue_cascata',
   'Pedido da etiqueta SPX (250807PBTHEWQG) SEGUE pra Shopee — nao vira NF');
ok(classificar('26081204X9WFWWG') === 'segue_cascata',
   'Autorizacao de Retorno (26081204X9WFWWG) tambem segue');
ok(classificar('BR260514290476K') === 'segue_cascata',
   'rastreio SPX (BR260514290476K) segue');
ok(classificar('260623TX31XFMT') === 'segue_cascata',
   'o exemplo de order_sn citado na propria mensagem de erro segue');

// ── e o que E numero de NF continua sendo ────────────────────────────
ok(classificar('75053') === 'numero_nf', 'numero de NF puro continua NF');
ok(classificar('002605') === 'numero_nf', '  com zeros a esquerda tambem');
ok(classificar('75053/2') === 'numero_nf', '  com serie (75053/2) tambem');
ok(classificar('75053-2') === 'numero_nf', '  com hifen tambem');
ok(classificar(' 75053 ') === 'numero_nf', '  com espaco em volta tambem');
ok(classificar('35260864289091000100550010000032331386489869') === 'chave_danfe',
   'chave da DANFE (44 digitos) continua chave');

// ── outros marketplaces nao podem ser engolidos pela rota de NF ──────
ok(classificar('AD123456789BR') === 'segue_cascata', 'Correios reverso segue');
ok(classificar('2000017772797838') === 'segue_cascata', 'pedido ML (16 digitos) segue');
ok(classificar('47416667668') === 'segue_cascata', 'shipment ML (11 digitos) segue');

// ── o conserto esta MESMO no server (nao so neste teste) ─────────────
ok(/const temLetraNoOriginal = \/\[A-Za-z\]\/\.test/.test(SERVER),
   'o server calcula temLetraNoOriginal');
ok(/ehNumeroNF = !ehChaveNFe && \(mNumSerie \|\| \(\/\^\\d\{4,9\}\$\/\.test\(codigoLimpo\) && !temLetraNoOriginal\)\)/.test(SERVER),
   '  e usa isso na decisao de numero_nf');

// ── a mensagem de erro manda digitar o Pedido: o caminho tem que existir ─
ok(/DIGITE o "Pedido" impresso na etiqueta/.test(SERVER),
   'a mensagem de erro orienta digitar o Pedido...');
ok(classificar('260623TX31XFMT') !== 'numero_nf',
   '  ...e agora esse Pedido nao morre na rota de NF (era o beco sem saida)');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
