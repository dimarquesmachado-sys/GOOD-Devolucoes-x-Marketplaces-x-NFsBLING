'use strict';
// b669 — O ROTULO DO PEDIDO NO BIPE SEGUE O CANAL DETECTADO.
//
// ⚠️ CASO REAL (GOOD, 07/11, NF 080932): pedido 702-2868620-1873028 (formato
// Amazon) aparecia como "Order ID (ML)". O front nao tem o detector da casa e a
// resposta da identificacao nao dizia o canal. Agora TODA saida de
// /api/devolucao/identificar passa por `enviar`, que anexa `canal_pedido` pelo
// numero do pedido (lib/marketplace-exibido.marketplacePeloPedido), e o front
// rotula "Pedido Amazon" / "Pedido Mercado Livre" / ... ou so "Pedido".
//
// Roda com: node test/rotulo-pedido-pelo-canal.test.js

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

// ── 1. o detector da casa (producao) classifica os formatos reais ──
const { marketplacePeloPedido } = require('../lib/marketplace-exibido');
ok(marketplacePeloPedido('702-2868620-1873028') === 'amazon', '⚠️ 702-2868620-1873028 e Amazon');
ok(marketplacePeloPedido('2000012345678901') === 'ml', '  2000+12 digitos e Mercado Livre');
ok(marketplacePeloPedido('261002HAX1E72F') === 'shopee', '  261002HAX1E72F e Shopee');
ok(marketplacePeloPedido('') === null && marketplacePeloPedido(null) === null, '  vazio: null (rotulo generico)');

// ── 2. a rota: toda saida passa por enviar(), que anexa canal_pedido ──
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const ini = srv.indexOf("app.get('/api/devolucao/identificar/:codigo'");
const fim = srv.indexOf("app.get('/api/nf/buscar-links-bling/:orderId'", ini);
const rota = srv.slice(ini, fim).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
ok(ini > 0 && fim > ini, '⚠️ achei a rota de identificacao');
ok(!/res\.json\(resultado\)/.test(rota), '  nenhuma saida `res.json(resultado)` crua sobrou na rota');
ok((rota.match(/enviar\(resultado\)/g) || []).length >= 5, '  as saidas passam por enviar(resultado) (' + (rota.match(/enviar\(resultado\)/g) || []).length + ')');
ok(/r\.canal_pedido = idPedido \? \(require\('\.\/lib\/marketplace-exibido'\)\.marketplacePeloPedido\(idPedido\) \|\| null\) : null;/.test(rota),
   '  enviar() anexa canal_pedido pelo detector da casa (null quando nao ha pedido/confianca)');

// ── 2b. enviar() de verdade: extraio o helper e exercito com res falso ──
const iniEnviar = rota.indexOf('const enviar = (r) => {');
const fimEnviar = rota.indexOf('};', iniEnviar) + 2;
const corpo = rota.slice(iniEnviar, fimEnviar);
// eslint-disable-next-line no-new-func
const fabrica = new Function('res', 'require', corpo + '\nreturn enviar;');
const req2 = (m) => require(path.join(RAIZ, m.replace('./', '')));
let enviado = null;
const enviar = fabrica({ json: (x) => { enviado = x; return x; } }, req2);
enviar({ ok: true, order: { id: '702-2868620-1873028' } });
ok(enviado && enviado.canal_pedido === 'amazon', '⚠️ resposta com pedido Amazon sai com canal_pedido: amazon');
enviar({ ok: true, order: { id: '2000012345678901' } });
ok(enviado && enviado.canal_pedido === 'ml', '  pedido ML sai com canal_pedido: ml');
enviar({ ok: true, order: {} });
ok(enviado && enviado.canal_pedido === null, '  sem numero do pedido: null');
enviar({ ok: false, erro: 'x' });
ok(enviado && enviado.canal_pedido === null && enviado.ok === false, '  resposta de erro passa intacta (so ganha o campo)');

// ── 3. o front rotula pelo canal e nunca mais assume ML ──
const front = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'busca.js'), 'utf8');
const semCom = front.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
ok(!/Order ID \(ML\)/.test(semCom), '⚠️ busca.js: "Order ID (ML)" saiu');
ok(/data\.canal_pedido && _NOMES_CANAL\[data\.canal_pedido\]/.test(semCom) && /'Pedido ' \+ _NOMES_CANAL\[_canal\] : 'Pedido'/.test(semCom),
   '  rotulo = "Pedido <canal>" pelo canal_pedido, ou so "Pedido"');
ok(/if \(order\.pack_id\) html \+=/.test(semCom), '  Pack ID (so do ML) aparece quando existe');
// ?v= bumpado nas duas telas (a GOOD numera 47xx; a AMB/Girassol b5xx+)
ok(Number((fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8').match(/js\/busca\.js\?v=(\d+)/) || [])[1]) >= 4788, '  index.html (GOOD): ?v= do busca.js bumpado (>= 4788)');
ok(/js-AMB\/busca\.js\?v=b669/.test(fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'index-AMB.html'), 'utf8')), '  index-AMB.html: ?v= do busca.js bumpado (b669)');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
