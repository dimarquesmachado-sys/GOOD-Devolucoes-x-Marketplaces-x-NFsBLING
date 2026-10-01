'use strict';
// ⚠️ O PAYLOAD DA TRIAGEM MANDA O MARKETPLACE — a busca sabia, o card nao.
//
// Achado do Codex (01/10): a busca identifica shopee/tiktok/magalu/ml, mas
// `montarPayloadTriagem()` nao mandava. A AMB gravava `marketplace: null`
// sempre; a GOOD nem tinha o campo. O card nascia sem origem mesmo com a
// busca certa.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const front = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'triagem.js'), 'utf8');
const i = front.indexOf('function montarPayloadTriagem()');
const fn = front.slice(i, front.indexOf('\n}\n', i));

ok(/marketplace: marketplaceTriagem,/.test(fn), '⚠️ o payload tem o campo marketplace');
ok(/ultimaBusca\.marketplace/.test(fn), '  vem do que a busca identificou');
ok(/shopee_return: 'shopee'/.test(fn) && /magalu_devolucao: 'magalu'/.test(fn) && /tiktok_devolucao: 'tiktok'/.test(fn),
   '  e deduz do metodo SO quando o metodo nomeia um marketplace');
ok(!/mapaMetodo\[.*\]\s*\|\|\s*ultimaBusca\.metodo/.test(fn) && !/marketplace: ultimaBusca\.marketplace \|\| ultimaBusca\.metodo/.test(fn),
   '  e NAO grava "numero_nf"/"chave_danfe" como marketplace (nao sao)');

// ⚠️ Regra 12: a coluna existe nas tabelas _amb/_girassol (a AMB ja grava); na
// raiz da GOOD NAO SEI — por isso la vai em update separado e tolerante, nunca
// no insert.
const amb = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'supabase-AMB.js'), 'utf8');
ok(/marketplace:\s+dados\.marketplace \|\| null/.test(amb), '  a AMB/Girassol grava no registrarTriagem (ja gravava)');

const good = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const semCom = good.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
ok(!/\.insert\(\[\{\s*marketplace:/.test(semCom),
   '⚠️ a GOOD NAO poe marketplace no INSERT (coluna pode nao existir na raiz — quebraria toda triagem)');
const iH = semCom.indexOf('async function gravarMarketplaceTriagem(');
const iE = semCom.indexOf('async function enriquecerTriagem(');
ok(iH >= 0 && iE > iH, 'marcadores do helper e do enriquecimento existem');
const helper = semCom.slice(iH, iE);
const enr = semCom.slice(iE, semCom.indexOf('\n}\n', iE));
ok(/update\(\{ marketplace: String\(dados\.marketplace\) \}\)/.test(helper),
   '  a GOOD grava em update SEPARADO (helper gravarMarketplaceTriagem)');
ok(/add column if not exists marketplace/.test(helper),
   '  e se a coluna faltar, o aviso diz o ALTER TABLE a rodar');
const iCham = enr.indexOf('gravarMarketplaceTriagem(');
ok(iCham >= 0 && iCham < enr.indexOf('buscarPedidoBlingPorNumeroLoja'),
   '⚠️ o enriquecimento grava ANTES das buscas lentas no Bling (restart/25s nao perdem a origem)');

const iC = semCom.indexOf("app.post('/api/triagem/consertado'");
const cons = semCom.slice(iC, semCom.indexOf('\n});\n', iC));
ok(iC >= 0 && /gravarMarketplaceTriagem\(data\.id, dados\)/.test(cons),
   '⚠️ a rota do consertado (que nao enriquece) tambem grava o marketplace');

// P1: order.id NAO prova ML (na busca por NF vem do numeroPedidoLoja)
ok(!/order\.id \? 'ml'/.test(fn), '⚠️ order.id NAO vira "ml" (NF de Magalu/Amazon tem order.id)');
ok(/correios_reverso_ml: 'ml'/.test(fn) && /shipment_id: 'ml'/.test(fn),
   '  ML so por metodo real de ML devolvido pelo servidor');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
