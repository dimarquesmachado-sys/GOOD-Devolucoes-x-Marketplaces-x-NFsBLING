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

// ── 2b. o helper de PRODUCAO (lib) — GOOD e fabrica usam o MESMO (Codex #539) ──
const { anexarCanalPedido } = require('../lib/marketplace-exibido');
ok(anexarCanalPedido({ ok: true, order: { id: '702-2868620-1873028' } }).canal_pedido === 'amazon', '⚠️ resposta com pedido Amazon sai com canal_pedido: amazon');
ok(anexarCanalPedido({ ok: true, order: { id: '2000012345678901' } }).canal_pedido === 'ml', '  pedido ML sai com canal_pedido: ml');
ok(anexarCanalPedido({ ok: true, order: {} }).canal_pedido === null, '  sem numero do pedido: null');
const erroR = anexarCanalPedido({ ok: false, erro: 'x' });
ok(erroR.canal_pedido === null && erroR.ok === false, '  resposta de erro passa intacta (so ganha o campo)');
ok(anexarCanalPedido({ canal_pedido: 'shopee', order: { id: '2000012345678901' } }).canal_pedido === 'shopee', '  campo ja preenchido nao e sobrescrito');
ok(/const enviar = \(r\) => res\.json\(require\('\.\/lib\/marketplace-exibido'\)\.anexarCanalPedido\(r\)\)/.test(rota),
   '  a GOOD usa o helper da lib (nao uma copia)');
const fab = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
ok(/return require\('\.\.\/\.\.\/lib\/marketplace-exibido'\)\.anexarCanalPedido\(resultado\);/.test(fab),
   '⚠️ a FABRICA (AMB/Girassol) anexa o canal em comRecados — por onde passam todas as saidas');
const saidasFab = (fab.match(/res\.json\(/g) || []).length;
const saidasComRecados = (fab.match(/res\.json\(await comRecados\(resultado/g) || []).length;
ok(saidasFab > 0 && saidasFab === saidasComRecados, `  todas as ${saidasFab} saidas da fabrica passam por comRecados (nenhuma crua)`);

// ── 3. o front rotula pelo canal e nunca mais assume ML ──
const front = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'busca.js'), 'utf8');
const semCom = front.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
ok(!/Order ID \(ML\)/.test(semCom), '⚠️ busca.js: "Order ID (ML)" saiu');
ok(/data\.canal_pedido && _NOMES_CANAL\[data\.canal_pedido\]/.test(semCom) && /'Pedido ' \+ _NOMES_CANAL\[_canal\] : 'Pedido'/.test(semCom),
   '  rotulo = "Pedido <canal>" pelo canal_pedido, ou so "Pedido"');
ok(/if \(order\.pack_id\) html \+=/.test(semCom), '  Pack ID (so do ML) aparece quando existe');
// b670 - os campos do pedido do ML (nickname, id do comprador, data da venda, status da venda e
// do pagamento) so aparecem com valor; sem pedido nem status o bloco Pedido some
ok(/if \(buyerNick !== '-'\) html \+=/.test(semCom) && /if \(buyerId !== '-'\) html \+=/.test(semCom) && /if \(order\.date_created\) html \+=/.test(semCom),
   '⚠️ b670: nickname, ID e data da venda so aparecem quando ha valor (nada de "-" em fila)');
ok(/if \(order\.status\) html \+=/.test(semCom) && /if \(payment\.status \|\| payment\.transaction_amount_refunded\) html \+=/.test(semCom),
   '  status da venda e do pagamento idem');
ok(/if \(order\.id \|\| order\.status \|\| payment\.status\) \{/.test(semCom), '  sem pedido nem status, o bloco Pedido inteiro some');
ok(!/<div class="label">Nickname<\/div><div class="valor">\$\{escapeHtml\(buyerNick\)\}<\/div><\/div>`;\n/.test(semCom.replace(/if \(buyerNick !== '-'\) html \+= `[^\n]*\n/, '')),
   '  nenhuma linha dessas sobrou incondicional');
// ?v= bumpado nas duas telas (a GOOD numera 47xx; a AMB/Girassol b5xx+)
ok(Number((fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8').match(/js\/busca\.js\?v=(\d+)/) || [])[1]) >= 4789, '  index.html (GOOD): ?v= do busca.js bumpado (>= 4789)');
ok(/js-AMB\/busca\.js\?v=b67\d/.test(fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'index-AMB.html'), 'utf8')), '  index-AMB.html: ?v= do busca.js bumpado (b669)');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
