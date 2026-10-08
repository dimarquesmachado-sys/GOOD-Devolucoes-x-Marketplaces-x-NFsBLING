'use strict';
// b591 — dono, 08/10 (NF 127013): card de kit diz KIT no topo e o bloco "Voltaram N produtos" so aparece na PARCIAL.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const h = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
function f(n) { const i = h.search(new RegExp('function ' + n + '\\s*\\(')); let j = h.indexOf('{', i), p = 0, k = j; for (; k < h.length; k++) { if (h[k] === '{') p++; else if (h[k] === '}') { p--; if (!p) break; } } return h.slice(i, k + 1); }
const ctx = { escapeHtml: (x) => String(x) }; vm.createContext(ctx);
vm.runInContext(f('faltasDevolucaoParcial') + f('linhaItensDevolvidos') + f('textoVariosProdutos') + h.match(/var SELO_VARIOS = [^\n]+\n/)[0] + f('nProdutosDistintos') + f('nDistintosNF') + f('seloVariosProdutos') + f('regDoCard') + f('ocultarVoltaramSeCompleto'), ctx);
const nf = [{ sku: '7150-110v', quantidade: 1 }, { sku: 'CABOLATERAL', quantidade: 1 }, { sku: 'KP19', quantidade: 1 }];
ok(/3 produtos na NF/.test(ctx.textoVariosProdutos(3)) && !/KIT/.test(ctx.textoVariosProdutos(3)), '  a linha diz "3 produtos na NF · itens abaixo" (sem chamar de KIT — Codex #474)');
ok(/VÁRIOS PRODUTOS/.test(ctx.seloVariosProdutos({ nf_itens: nf })) && ctx.seloVariosProdutos({ nf_itens: [nf[0]] }) === '', '⚠️ selo VARIOS PRODUTOS no titulo quando a NF tem mais de 1 produto (e so entao)');
ok((h.match(/<div class="item-titulo"><span class="titulo-txt">\$\{escapeHtml\(d\.produto_titulo \|\| '-'\)\}<\/span><span class="selo-varios">\$\{seloVariosProdutos\(d\)\}<\/span>/g) || []).length === 3, '⚠️ os 3 cards (aprovadas, problemas, divergentes) tem o titulo trocavel e o selo');
ok(/tit\.textContent = an\[0\]\.titulo;/.test(h), '⚠️ com UM anuncio, o titulo do anuncio vira o titulo principal do card');
ok(/Voltaram/.test(ctx.linhaItensDevolvidos({ itens_devolvidos: [{ sku: 'A', qtd: 1 }, { sku: 'B', qtd: 1 }] })), '  sem a lista da NF no card, o bloco do que voltou continua (Codex #474)');
ok(ctx.linhaItensDevolvidos({ itens_devolvidos: [{ sku: '7150-110v', qtd: 1 }, { sku: 'CABOLATERAL', qtd: 1 }, { sku: 'KP19', qtd: 1 }], nf_itens: nf }) === '', '⚠️ voltou TUDO: nao repete a lista (caso real NF 127013)');
ok(/Voltaram/.test(ctx.linhaItensDevolvidos({ itens_devolvidos: [{ sku: '7150-110v', qtd: 1 }, { sku: 'KP19', qtd: 1 }], nf_itens: nf })), '  devolucao PARCIAL: o bloco continua, dizendo o que voltou');
// Codex #474 (rodada 2)
ok(/VÁRIOS PRODUTOS/.test(ctx.seloVariosProdutos({ nf_itens: [{ sku: 'A' }, { sku: null, titulo: 'Peca sem codigo' }] })), '⚠️ linha da NF sem SKU conta como produto no selo');
const volt = [{ sku: 'A', qtd: 1 }, { sku: 'B', qtd: 1 }];
const regAntigo = { id: 7, itens_devolvidos: volt };
const mkBlk = () => { let removido = false; return { removido: () => removido, el: { id: 'card-7', querySelector: () => ({ remove: () => { removido = true; } }) } }; };
ctx.dados = { aprovadas: [regAntigo] };
let c = mkBlk(); ctx.ocultarVoltaramSeCompleto(c.el, [{ sku: 'A', quantidade: 1 }, { sku: 'B', quantidade: 1 }]);
ok(c.removido(), '⚠️ lista da NF chegou depois e voltou tudo: o bloco "Voltaram" sai');
c = mkBlk(); ctx.ocultarVoltaramSeCompleto(c.el, [{ sku: 'A', quantidade: 1 }, { sku: 'B', quantidade: 1 }, { sku: 'C', quantidade: 1 }]);
ok(!c.removido(), '  lista tardia com item que nao voltou (parcial): o bloco fica');
ok(/d\.anuncio_titulo, d\.anuncio_sku/.test(h) && /reg\.anuncio_titulo = an\[0\]\.titulo/.test(h), '⚠️ titulo/SKU do anuncio entram na busca');
ok(/el\.replaceWith\(novo\);\s*if \(typeof autoCarregarItens === 'function'\) autoCarregarItens\(\);/.test(h), '⚠️ atualizarUmCard reaplica o titulo do anuncio no card novo');
ok(/var anuncioPorPedido = \{\};/.test(h) && /\.\.\.anuncioDaBusca\(d\),/.test(h) && /anuncioPorPedido\[String\(pedido\)\] = \{ titulo: an\[0\]\.titulo/.test(h), '⚠️ a busca pelo titulo do anuncio sobrevive ao redesenho de outro card (cache por pedido — Codex #474)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
