// Roda com: node test/devolucoes-capturadas.test.js
//
// A captura guarda o que os marketplaces contam sobre devolucoes, pra que
// o dado esteja aqui quando o pacote chegar no galpao.
//
// Ideia do dono (29/08): "tinha q ter um cron a meia noite pra pegar esses
// dados previamente, ate pq a devolucao sempre demora mais q 1 dia pra
// chegar ate nos".
//
// O "a espreita" ja varria os tres marketplaces — o que faltava era
// GUARDAR. Ele remontava tudo do zero a cada 3 min e vivia so em memoria.

const fs = require('fs');
const path = require('path');
const cap = require('../lib/devolucoes-capturadas');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// ── tradução: do formato do espreita para o da tabela ────────────────
{
  // uma devolucao do ML como o espreita entrega
  const ml = cap.traduzir({
    marketplace: 'ml',
    pedido: '2000017367190752',
    pack_id: '2000013967364577',
    tracking: null,
    shipment_devolucao: '47528658744',
    cliente: 'LUCIENE ARAUJO HUESA FULINE',
    produto: 'Luminaria Chao 177cm',
    qtd: 1,
    nf: '002070',
    chave_nota: '3'.repeat(44),
    status: 'em transito',
    valor: 143.46,
    dias_em_transito: 10,
  }, 'good');

  ok(!!ml, 'devolucao do ML e traduzida');
  ok(ml.chave_marketplace === '47528658744',
     '  a chave e o shipment da REVERSA (mais estavel que o pedido)');
  ok(ml.pack === '2000013967364577',
     '  o pack e guardado — e o que amarra ida e volta (medido em 29/08)');
  ok(ml.nf_numero === '002070' && ml.nf_chave.length === 44, '  NF e chave junto');
  ok(ml.valor_refund === 143.46, '  valor vira numero');
  ok(ml.produto_qtd === 1, '  quantidade vira inteiro');
  ok(ml.empresa === 'good' && ml.marketplace === 'ml', '  empresa e marketplace em minusculas');
  ok(!!ml.cru, '  e o CRU vai junto (pra nao perder campo que ainda nao mapeamos)');

  // b184.2: o tipo do TikTok vira COLUNA — e por ele que o painel de
  // estornadas separa reembolso puro de devolucao com retorno
  const tk = cap.traduzir({ marketplace: 'tiktok', pedido: '585514776487560610',
    tipo_tiktok: 'REFUND', status: 'RETURN_OR_REFUND_REQUEST_COMPLETE', valor: 36 }, 'good');
  ok(tk.tipo_tiktok === 'REFUND', 'o tipo do TikTok vira COLUNA, nao so campo dentro do cru');
  ok(cap.traduzir({ marketplace: 'ml', pedido: '1', tipo: 'devolucao' }, 'good').tipo_tiktok === 'devolucao',
     '  e o campo `tipo` generico dos outros marketplaces tambem cai ali');

  // dias em transito viram data — pra dar pra filtrar por periodo depois
  const dias = (Date.now() - new Date(ml.criado_no_mkt).getTime()) / 864e5;
  ok(Math.abs(dias - 10) < 0.1, '  "10 dias em transito" vira data de criacao');
}

// ── o que NAO pode entrar ────────────────────────────────────────────
{
  ok(cap.traduzir(null, 'good') === null, 'nulo nao vira linha');
  ok(cap.traduzir({ marketplace: 'ml' }, 'good') === null,
     'sem NENHUM identificador nao vira linha (sem chave nao ha upsert; linha orfa so suja)');
  ok(cap.traduzir({ pedido: '123' }, 'good') === null, 'sem marketplace tambem nao');
  ok(cap.traduzir({ marketplace: 'ml', pedido: '123' }, null) === null, 'sem empresa tambem nao');
}

// ── Magalu e Shopee, que tem outro vocabulario ───────────────────────
{
  const mag = cap.traduzir({
    marketplace: 'magalu', pedido: '1550970116332325',
    chave: '2608120X9WFWWG', categoria: 'agencia', valor: 189.9,
  }, 'good');
  ok(mag.chave_marketplace === '1550970116332325' || mag.chave_marketplace === '2608120X9WFWWG',
     'Magalu: usa o identificador que tiver (nao tem shipment)');
  ok(mag.status === 'agencia' || mag.motivo === 'agencia', '  a categoria vira status/motivo');

  const sho = cap.traduzir({
    marketplace: 'shopee', pedido: '260807PBTHEWQG',
    tracking: 'BR260514290476K', valor: 47.9, dias_em_transito: 3,
  }, 'good');
  ok(sho.chave_marketplace === 'BR260514290476K', 'Shopee: o rastreio e a chave');
  ok(sho.rastreio === 'BR260514290476K', '  e fica tambem no campo proprio, pra busca');
}

// ── gravação: em lotes, e re-capturar ATUALIZA ───────────────────────
{
  const upserts = [];
  const supabaseFalso = {
    from() {
      return {
        upsert(linhas, opts) { upserts.push({ linhas, opts }); return Promise.resolve({ error: null }); },
      };
    },
  };

  const muitas = [];
  for (let i = 0; i < 450; i++) {
    muitas.push(cap.traduzir({ marketplace: 'ml', pedido: 'P' + i, tracking: 'T' + i }, 'good'));
  }

  cap.guardar(supabaseFalso, muitas).then((r) => {
    ok(r.ok && r.gravadas === 450, 'grava as 450 linhas');
    ok(upserts.length === 3, '  em LOTES de 200 (upsert gigante estoura o limite do PostgREST): 3 lotes');
    ok(upserts[0].opts.onConflict === 'empresa,marketplace,chave_marketplace',
       '  com upsert por empresa+marketplace+chave: re-capturar ATUALIZA, nao duplica');
    ok(!!upserts[0].linhas[0].visto_por_ultimo,
       '  e carimba visto_por_ultimo — quando ele para de avancar, o marketplace parou de listar');

    // ── o modulo esta ligado no ciclo do espreita? ────────────────────
    const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    ok(/capturarDevolucoes\(r\);/.test(SERVER),
       'a captura roda junto do espreita (que ja varre os 3 marketplaces — nao criei cron novo)');
    // b184.2: o campo certo, e o TikTok junto
    ok(/resultadoEspreita\.em_transito/.test(SERVER),
       '  lendo `em_transito`, que e o que montarEspreita devolve (eu lia `.itens`, que nao existe → gravava ZERO)');
    ok(/tiktokPonte\.sondaDevolucoes\('good'/.test(SERVER),
       '  e puxando o TikTok tambem, que NAO passa pelo espreita (vem pela ponte)');
    ok(/falha aqui nao pode derrubar a captura dos outros/.test(SERVER),
       '  com falha do TikTok isolada dos outros 3 marketplaces');
    ok(/CAPTURA_INTERVALO_MS = 60 \* 60 \* 1000/.test(SERVER),
       '  mas com ritmo proprio: de hora em hora, nao a cada 3 min como ele');
    ok(/if \(!supabase \|\| CAPTURA_RODANDO\) return;/.test(SERVER),
       '  e com trava, pra duas capturas nao rodarem juntas');
    ok(/devCapturadas,/.test(SERVER) && /capturaEstado: \(\) => CAPTURA_ESTADO/.test(SERVER),
       '  as deps sao PASSADAS pro rotas-debug (usar o escopo do server ja derrubou o boot 2x)');

    const DEBUG = fs.readFileSync(path.join(__dirname, '..', 'lib', 'rotas-debug.js'), 'utf8');
    ok(/devCapturadas, capturaEstado,/.test(DEBUG), '  e recebidas la');
    ok(/api\/debug\/capturadas/.test(DEBUG), 'ha rota pra acompanhar a captura');

    console.log('');
    console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
    process.exit(falhas ? 1 : 0);
  });
}
