// b657 - O DESEMPATE DA NF TRATA 'ml' E 'mercadolivre' COMO UM CANAL SO.
//
// A triagem grava 'ml' (b462/b648); a NF do Bling declara "Mercado Livre",
// que o confrontar normaliza pra 'mercadolivre'. Na igualdade crua, caso de
// ML triado novo x NF de ML caia em DIVERGE e virava sinal CONTRA na escada
// de desempate — exatamente o par que mais aparece. Este teste exercita a
// funcao DE PRODUCAO (avaliar) e trava a classe.
const assert = require('assert');
const { avaliar } = require('../lib/confrontar-nf');

const nfML = { lojaVirtual: { nome: 'Mercado Livre' } };

// 1) caso novo ('ml') x NF de ML: canal tem que BATER
let r = avaliar({ marketplace: 'ml' }, nfML);
assert(r.bate.includes('marketplace'), '1) ml x NF "Mercado Livre" devia BATER, veio: ' + JSON.stringify(r));
assert(!r.diverge.includes('marketplace'), '1b) nao pode divergir');

// 2) caso legado ('mercadolivre') x NF de ML: segue batendo como antes
r = avaliar({ marketplace: 'mercadolivre' }, nfML);
assert(r.bate.includes('marketplace'), '2) legado x NF ML devia BATER');

// 3) canal realmente diferente segue DIVERGINDO (a equivalencia nao afrouxa o resto)
r = avaliar({ marketplace: 'shopee' }, nfML);
assert(r.diverge.includes('marketplace'), '3) shopee x NF ML devia DIVERGIR');

console.log('confronto-canal-ml: OK');
