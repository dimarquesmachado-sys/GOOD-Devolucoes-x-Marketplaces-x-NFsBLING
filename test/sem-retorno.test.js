// Roda com: node test/sem-retorno.test.js
//
// Vendas que o marketplace reembolsou SEM devolucao fisica: o produto fica
// com o cliente, mas a NF de venda continua emitida, gerando imposto sobre
// uma receita que nao existiu.
//
// Ideia do dono (29/08):
//   "se a venda foi cancelada, a gente pode cancelar a nota fiscal e isentar
//    ao menos o imposto da venda. se não der pra cancelar, a gente gera a
//    nota fiscal de devolução q dá na mesma"
//
// TAMANHO: no TikTok da Girassol, o filtro "Apenas reembolso" mostrava 62
// casos contra 103 com devolucao.
//
// O PRAZO decide (medido em 25-28/08): ate 20 dias da pra CANCELAR a NF;
// passado isso, so NF de devolucao (501 intempestivo).

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const PAINEL = fs.readFileSync(path.join(RAIZ, 'public', 'painel-devolucoes.html'), 'utf8');

// ── a rota ───────────────────────────────────────────────────────────
{
  ok(/app\.get\('\/api\/admin\/sem-retorno', requerAdmin/.test(SERVER),
     'ha rota pras vendas estornadas sem retorno');

  const i = SERVER.indexOf("'/api/admin/sem-retorno'");
  const rota = SERVER.slice(i, SERVER.indexOf("app.get('/api/admin/espreita'", i));

  ok(/tipo === 'REFUND'/.test(rota),
     'so lista REEMBOLSO PURO — o que tem retorno fisico vai pro a espreita');
  ok(/st\.indexOf\('CANCEL'\) === -1/.test(rota),
     '  e descarta as canceladas: ali nao houve estorno');
  ok(/nf_devolucao_id_bling/.test(rota),
     'e quem JA tem NF de devolucao sai da lista (ja foi resolvido)');

  // o prazo da SEFAZ
  ok(/diasDesde <= 20/.test(rota), 'usa o prazo de 20 dias da SEFAZ pra decidir a acao');
  ok(/acao: podeCancelar \? 'cancelar_nf' : 'nf_devolucao'/.test(rota),
     '  dizendo em cada item se e CANCELAR ou NF DE DEVOLUCAO');
  ok(/e sempre POSTERIOR a venda/.test(rota),
     '  e o comentario registra que a base usada erra pro lado SEGURO (prazo real e menor)');

  // a ordenacao tem intencao
  ok(/a\.acao === 'cancelar_nf' \? -1 : 1/.test(rota),
     'quem ainda da pra cancelar vem PRIMEIRO — e a unica parte com prazo correndo');
  ok(/a\.prazo_cancelamento - b\.prazo_cancelamento/.test(rota),
     '  e dentro delas, o mais urgente');
  ok(/\(b\.valor \|\| 0\) - \(a\.valor \|\| 0\)/.test(rota),
     '  nas outras, o maior valor primeiro');

  ok(/NAO EMITE NADA/.test(SERVER.slice(Math.max(0, i - 2000), i)),
     'o comentario deixa claro que a rota so LISTA — quem emite e ele');
  ok(/deposito e o de DEFEITO/i.test(SERVER.slice(Math.max(0, i - 2000), i)),
     '  e que o deposito e o de DEFEITO, porque a mercadoria nunca chegou');
}

// ── o painel ─────────────────────────────────────────────────────────
{
  ok(/id="secaoSemRetorno"/.test(PAINEL), 'ha secao no painel');
  ok(/Estornadas sem retorno/.test(PAINEL), '  com titulo dizendo o que e');

  // pedido do dono: ACIMA do a espreita
  const iSemRetorno = PAINEL.indexOf('id="secaoSemRetorno"');
  const iEspreita = PAINEL.indexOf('id="secaoEspreita"');
  ok(iSemRetorno !== -1 && iEspreita !== -1 && iSemRetorno < iEspreita,
     'a secao fica ACIMA do "a espreita", como ele pediu');

  ok(/async function carregarSemRetorno/.test(PAINEL), 'ha funcao que carrega');
  ok(/carregarSemRetorno\(\); \/\/ v4\.69/.test(PAINEL), '  chamada junto do carregamento');
  ok(/catch \(e\) \{[\s\S]{0,120}nao a fila/.test(PAINEL),
     '  e falha nela NAO derruba a fila principal (bloco informativo)');

  ok(/style\.display = ''/.test(PAINEL.slice(PAINEL.indexOf('carregarSemRetorno'))),
     'a secao so aparece quando ha algo (nao polui o painel vazio)');
  ok(/CANCELAR NF · '/.test(PAINEL), 'cada item diz se e CANCELAR');
  ok(/NF DE DEVOLUÇÃO/.test(PAINEL), '  ou NF de devolucao');
  ok(/prazo de cancelamento — essas primeiro/.test(PAINEL),
     'e ha aviso no topo quando existem casos com o relogio correndo');
  ok(/depósito de <b>DEFEITO<\/b>/.test(PAINEL),
     'a explicacao lembra do deposito de DEFEITO (a mercadoria nunca chegou)');

  // seguranca: o texto vem do cliente e do marketplace
  const iFn = PAINEL.indexOf('async function carregarSemRetorno');
  const fn = PAINEL.slice(iFn, iFn + 3000);
  ok(/escapeHtml\(x\.produto/.test(fn) && /escapeHtml\(String\(x\.motivo\)\)/.test(fn),
     'tudo que vem de fora passa por escapeHtml (o motivo e escrito pelo cliente)');
  ok(/escapeHtml\(String\(x\.pedido/.test(fn) && /escapeHtml\(String\(x\.sku/.test(fn),
     '  inclusive pedido e SKU');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
