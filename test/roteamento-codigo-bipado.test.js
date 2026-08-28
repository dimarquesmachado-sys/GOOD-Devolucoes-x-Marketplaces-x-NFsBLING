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
  const semRotulosNF = String(codigoOriginal || '').trim()
    .replace(/[\u00ba\u00b0]/g, ' ')
    .replace(/\b(?:nf-?e?|nota|fiscal|n[uu\u00fa]mero|num|n)\b/gi, ' ')
    .replace(/[\s:.#\-]+/g, '');
  const temLetraNoOriginal = /[A-Za-z]/.test(semRotulosNF);
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

// ── seg5.1: prefixo textual de NF continua funcionando ───────────────
// Uso normal de quem digita. Com a regra crua "tem letra => nao e NF",
// esses passariam a vagar pela cascata e voltar "nao encontrado", tornando
// NF valida impossivel de buscar (apontamento do Codex).
ok(classificar('NF 75053') === 'numero_nf', '"NF 75053" continua NF');
ok(classificar('NF: 002605') === 'numero_nf', '"NF: 002605" tambem');
ok(classificar('NFe 75053') === 'numero_nf', '"NFe 75053" tambem');
ok(classificar('nf-e 75053') === 'numero_nf', '"nf-e 75053" tambem');
ok(classificar('Nota Fiscal 75053') === 'numero_nf', '"Nota Fiscal 75053" tambem');
ok(classificar('NOTA 75053') === 'numero_nf', '"NOTA 75053" tambem');
// seg5.2: o rotulo aparece tambem no FIM e como marcador de numero
ok(classificar('75053 NFe') === 'numero_nf', '"75053 NFe" (rotulo no fim) tambem');
ok(classificar('N\u00ba 75053') === 'numero_nf', '"N\u00ba 75053" (marcador de numero) tambem');
ok(classificar('N\u00b0 75053') === 'numero_nf', '  e com o simbolo de grau');
ok(classificar('Nota Fiscal n\u00ba 75053') === 'numero_nf', '"Nota Fiscal n\u00ba 75053" tambem');
ok(classificar('numero 75053') === 'numero_nf', '"numero 75053" tambem');

// e o rotulo nao pode virar porta dos fundos pro codigo Shopee
ok(classificar('NF 250807PBTHEWQG') === 'segue_cascata',
   '  mas "NF 250807PBTHEWQG" NAO vira NF (sobra letra depois do rotulo)');
ok(classificar('250807PBNFEWQG') === 'segue_cascata',
   '  e "NFE" NO MEIO de um order_sn nao e tocado (rotulo so como palavra inteira)');

// ── outros marketplaces nao podem ser engolidos pela rota de NF ──────
ok(classificar('AD123456789BR') === 'segue_cascata', 'Correios reverso segue');
ok(classificar('2000017772797838') === 'segue_cascata', 'pedido ML (16 digitos) segue');
ok(classificar('47416667668') === 'segue_cascata', 'shipment ML (11 digitos) segue');

// ── o conserto esta MESMO no server (nao so neste teste) ─────────────
ok(/const semRotulosNF = String\(codigoOriginal/.test(SERVER),
   'o server tira os rotulos de NF antes de checar letras');
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
