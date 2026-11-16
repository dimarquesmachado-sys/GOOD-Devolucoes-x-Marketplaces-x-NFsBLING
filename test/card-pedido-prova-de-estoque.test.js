'use strict';
// b724 — Codex #583: O CARD DO PEDIDO SO DIZ "LANCADO EM ESTOQUE" COM PROVA (estoque_produto_id).
//
// Desde o b724 a reserva grava estoque_sku/estoque_qtd da TENTATIVA antes do Bling responder (pra o relancamento
// forcado repetir a mesma tentativa). Relancamento recusado ou incerto deixa estoque_qtd > 0 SEM entrada nenhuma —
// e o card (peca unica das 3 empresas) usava estoque_qtd como prova: pintava "LANCADO" e escondia o ambar.
// Aqui a funcao linhaPedido roda DE VERDADE (recorte por marcadores, test/_recorte.js) com stubs minimos.
// Roda com: node test/card-pedido-prova-de-estoque.test.js
const fs = require('fs');
const path = require('path');
const { entreMarcadores } = require('./_recorte');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const F = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'js-AMB', 'defeitos-ficha.js'), 'utf8');
const fonte = entreMarcadores(F, 'function linhaPedido(p, comAcoes, daAbaArquivadas) {', 'window.abrirFilaPedidos = ');
const stubs = { esc: (v) => String(v == null ? '' : v), dataBr: (v) => String(v || '-'), euSouAdmin: true, capitalizar: (v) => String(v), window: {}, document: { getElementById: () => null }, console };
// `with` precisa de codigo nao-estrito: o corpo do new Function e sloppy; o recorte so define a funcao e a devolve
const linhaPedido = new Function('__stubs', 'with (__stubs) { ' + fonte + '\n return linhaPedido; }')(stubs);

const base = { id: 'p1', tipo: 'recuperado', defeito_id: 1, sku: 'SKU-X', quantidade: 2, titulo: 'Peca X' };
const html = (p) => linhaPedido(Object.assign({}, base, p), true, false);

// tentativa gravada (estoque_qtd/estoque_sku) SEM confirmacao: nada de LANCADO; ambar aparece
{
  const h = html({ status: 'autorizado', estoque_sku: 'SKU-CERTA', estoque_qtd: 2, estoque_produto_id: null, estoque_operacao: null });
  ok(!/LANÇADO EM ESTOQUE/.test(h), '⚠️ (Codex #583) relancamento recusado (estoque_qtd=2, sem estoque_produto_id): o card NAO diz LANCADO');
  ok(/AINDA SEM LANÇAMENTO/.test(h), '  e mostra o ambar "ainda sem lancamento"');
  ok(/relancarEstoque\(/.test(h), '  com o botao de relancar');
}
// incerto (marca LANCANDO e qtd tentada): tambem sem prova
{
  const h = html({ status: 'autorizado', estoque_sku: 'SKU-CERTA', estoque_qtd: 2, estoque_produto_id: null, estoque_operacao: 'LANCANDO abc' });
  ok(!/LANÇADO EM ESTOQUE/.test(h) && /AINDA SEM LANÇAMENTO/.test(h), '  operacao INCERTA (LANCANDO …) com qtd tentada: sem LANCADO, com ambar');
}
// confirmado: LANCADO com a quantidade e o link do Bling
{
  const h = html({ status: 'concluido', estoque_sku: 'SKU-CERTA', estoque_qtd: 2, estoque_produto_id: 909, estoque_operacao: 'LANCADO abc' });
  ok(/LANÇADO EM ESTOQUE · 2 un\./.test(h) && /buscaid=909/.test(h), '  confirmado (estoque_produto_id): LANCADO · 2 un. + link do Bling');
  ok(!/AINDA SEM LANÇAMENTO/.test(h), '  sem ambar');
}
// fechada a mao sem prova, mesmo com qtd tentada: cinza honesto
{
  const h = html({ status: 'concluido', estoque_qtd: 1, estoque_produto_id: null });
  ok(!/LANÇADO EM ESTOQUE/.test(h) && /FECHADA sem registro de entrada/.test(h), '  concluida sem estoque_produto_id (qtd tentada): "fechada sem registro", nao LANCADO');
}
// a correcao de SKU apos recusa definitiva nao reenvia o `forcar` consumido
{
  const rel = entreMarcadores(F, 'window.relancarEstoque = async function (pedidoId, btn, forcar, correcao) {', 'window.restaurarRegistro = ');
  ok(/relancarEstoque\(pedidoId, btn, undefined, \{ sku: novo\.trim\(\) \}\)/.test(rel), '⚠️ (Codex #583) correcao de SKU relanca SEM o forcar consumido');
  ok(!/relancarEstoque\(pedidoId, btn, forcar, \{ sku/.test(rel), '  nenhum caminho reenvia o forcar junto da correcao');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
