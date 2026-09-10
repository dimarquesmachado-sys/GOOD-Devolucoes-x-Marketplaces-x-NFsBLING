// Roda com: node test/estrela-entregues-recentes.test.js
//
// ⚠️ O CASO REAL: o dono buscou "charles", achou 5 NFs, e o card do Charles
// Alexandre veio SEM ESTRELA — mesmo com a devolução dele a caminho.
//
// A CAUSA, achada com o /health: a espreita tinha 40 devoluções com NF, e o
// índice estava completo. A matéria-prima existia. Mas a devolução dele foi
// ENTREGUE ONTEM, e o cruzamento só olhava `em_transito` e `nunca_bipadas`.
//
// ⚠️ E `nunca_bipadas` JÁ É a lista de entregues — com PISO DE 5 DIAS. O
// piso existe por bom motivo (recém-entregue pode estar só na fila de
// recebimento, e alertar seria falso alarme), mas ele serve ao ALERTA, não
// à BUSCA: a caixa entregue ontem é exatamente a que o estoquista tem na
// mão agora.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const codigo = srv.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── ⚠️ o campo existe no PRODUTOR ───────────────────────────────────
//
// Minha primeira tentativa consumia `cacheEsp.entregues`, que NÃO EXISTE —
// o teste `campo-tem-produtor` acusou. É a Regra 4.12 (ler o produtor antes
// de escrever o consumidor), e foi a segunda vez que ela me pegou hoje.
{
  ok(/entregues_recentes: entreguesRecentes/.test(codigo),
     'o cache EXPÕE `entregues_recentes` (o produtor existe)');
  ok(/let entreguesRecentes = \[\]/.test(codigo),
     '  declarada FORA do try (o `baseAlerta` nao alcanca o retorno)');
  // ⚠️ b274.1 (Codex, P1): montava a partir do `baseAlerta`, que JA vem
  // filtrado por `dias_desde >= 5` — filtrar de novo por `< 5` nunca
  // devolvia nada. A lista saia SEMPRE VAZIA e o conserto era decorativo.
  //
  // Agora sai de `brutos`, que e a lista sem filtro nenhum.
  ok(/entreguesRecentes = brutos/.test(codigo),
     '  ⚠️ e montada a partir de `brutos` (ANTES do filtro de 5 dias)');
  const iRec = codigo.indexOf('entreguesRecentes = brutos');
  const iFiltro = codigo.indexOf('dias_desde >= 5');
  ok(iRec > 0 && iRec < iFiltro,
     '  e vem ANTES do filtro no arquivo (senao a lista nasce vazia)');
}

// ── ⚠️ e o piso de 5 dias não é mexido ──────────────────────────────
//
// O alerta continua igual. A lista nova é separada, mesma origem, sem o
// piso — em vez de afrouxar o alerta e criar falso alarme.
{
  ok(/d\.dias_desde >= 5/.test(codigo),
     '⚠️ o PISO do alerta continua em 5 dias (nao afrouxei o alerta)');
  ok(/d\.dias_desde < 5/.test(codigo),
     '  e a lista nova pega justamente quem esta ABAIXO dele');
}

// ── e o cruzamento consome ──────────────────────────────────────────
{
  const i = codigo.indexOf('const espreita = []');
  const bloco = codigo.slice(i, i + 600);
  ok(/cacheEsp\.entregues_recentes/.test(bloco),
     'o cruzamento da busca por nome inclui as entregues recentes');
  ok(/\.filter\(\(e\) => !e\.baixado\)/.test(bloco),
     '  ⚠️ e o filtro `!baixado` continua — o que ja foi bipado sai');
}

// ── ⚠️ a chave do cache e atribuida ANTES de enriquecer ────────────
//
// `brutos` não tem `chave_nota`, e `garantirEnriquecimentoEspreita` filtra
// justamente por ele — rejeitava TODAS as recentes, e a lista saía sem NF.
// Sem NF não há cruzamento, e a estrela continuaria sem aparecer.
{
  const iMont = codigo.indexOf('entreguesRecentes = brutos');
  const bloco = codigo.slice(iMont, iMont + 400);
  ok(/chave_nota: String\(d\.tracking/.test(bloco),
     '⚠️ a `chave_nota` e atribuida na montagem (senao o enriquecimento rejeita)');

  // e é a MESMA expressão do alerta — se divergirem, o cache não bate
  const nEx = (codigo.match(/String\(d\.tracking \|\| \(d\.marketplace \+ ':' \+ d\.pedido\)\)/g) || []).length;
  ok(nEx >= 2, '  e e a MESMA expressao do alerta (achei ' + nEx + ' usos)');
}

// ── ⚠️ e o bloco roda FORA do `if` do alerta ────────────────────────
//
// Estava dentro de `if (candidatos.length > 0)`. Num dia sem alertas (5-90
// dias) mas com entregas recentes, o bloco inteiro era pulado — e a estrela
// não aparecia justamente no dia tranquilo.
{
  const iIf = codigo.indexOf('if (candidatos.length > 0)');
  const iBloco = codigo.indexOf('resolverIdentidadeEspreita(entreguesRecentes,');
  ok(iBloco > 0, 'as recentes passam pela identidade');

  // ⚠️ acho onde o `if` FECHA, contando chaves a partir dele — e comparo
  // posicoes. Minha 1a versao contava o saldo ATE o bloco, e dava 1 por
  // causa do `{ }` que eu abro pra agrupar as recentes: acusava DENTRO
  // quando esta fora.
  const linhas = codigo.split('\n');
  const lIf = linhas.findIndex((l) => l.includes('if (candidatos.length > 0)'));
  let prof = 0;
  let lFecha = -1;
  for (let k = lIf; k < linhas.length; k++) {
    prof += (linhas[k].match(/\{/g) || []).length - (linhas[k].match(/\}/g) || []).length;
    if (prof <= 0 && k > lIf) { lFecha = k; break; }
  }
  const lBloco = linhas.findIndex((l) => l.includes('resolverIdentidadeEspreita(entreguesRecentes,'));
  ok(lFecha > 0 && lBloco > lFecha,
     '  ⚠️ e o bloco esta FORA do if do alerta (if fecha em ' + (lFecha + 1)
     + ', bloco em ' + (lBloco + 1) + ')');
}

// ── ⚠️ b307/b308 (Codex, P2): identidade ANTES da triagem, e COM TETO ──
//
// Ordem antiga: consultava `devolucoes` com o pedido/tracking CRU e SO
// DEPOIS descobria a identidade — uma devolucao so-com-rastreio ja triada
// pelo PEDIDO (descoberto so ali) nunca era vista pela consulta anterior.
// E a identidade rodava SEM TETO: numa janela de 5 dias cheia de packs ML
// sem `order_id`, isso travava `montarEspreita()` inteiro.
{
  ok(/async function resolverIdentidadeEspreita\(itens, limite\)/.test(codigo),
     'resolverIdentidadeEspreita aceita um teto OPCIONAL');
  ok(/resolverIdentidadeEspreita\(baseAlerta\)/.test(codigo),
     '  o alerta continua SEM teto (poucos candidatos, sem risco)');
  ok(/TETO_IDENT_RECENTES/.test(codigo),
     '  as recentes passam um teto (janela de 5 dias pode ter muito pack)');

  const iIdent = codigo.indexOf('resolverIdentidadeEspreita(entreguesRecentes,');
  const iTriagem = codigo.indexOf("from('devolucoes')\n              .select('order_id').in('order_id', pedidosR)");
  ok(iIdent > 0 && iTriagem > 0 && iIdent < iTriagem,
     '  ⚠️ e a identidade roda ANTES da reconsulta de triagem (senao o pedido descoberto chega tarde demais)');

  ok(/packsR[\s\S]{0,200}from\('devolucoes'\)[\s\S]{0,100}pack_id/.test(codigo),
     '  a reconsulta tambem cobre o PACK (venda de carrinho pode estar gravada por ele)');
  ok(/triadas\.has\(String\(d\.pack_id/.test(codigo),
     '  e o filtro final exclui por pack tambem');
}

// ── ⚠️ b306 (Codex, P2): entregues_recentes protegida contra o "desabou" ──
//
// `guardarCacheEspreita` so contava `em_transito` pra decidir se a fonte
// caiu — um marketplace so-com-recentes (zero em_transito) nao tinha
// protecao nenhuma: uma busca vazia passageira apagava a estrela toda.
{
  const iF = codigo.indexOf('function contarPorMarketplace');
  const bloco = codigo.slice(iF, iF + 400);
  ok(/r\.entregues_recentes/.test(bloco),
     'contarPorMarketplace tambem conta `entregues_recentes` (nao so em_transito)');
}

// ── ⚠️ e o que ja foi triado sai da lista ───────────────────────────
{
  const iMont = codigo.indexOf('entreguesRecentes = brutos');
  const trecho = codigo.slice(iMont, iMont + 2500);
  ok(/espreita_notas[\s\S]{0,300}baixado/.test(trecho),
     'devolucao ja triada nos ultimos 5 dias e removida (le `espreita_notas`)');
}

// ── e sem teto artificial no enriquecimento ─────────────────────────
//
// ⚠️ Eu tinha posto 15: acima disso o resto ficava sem NF. A janela é curta
// por natureza, e o cache já está quente do alerta.
{
  // ⚠️ b274.3 (Codex, P2): eu tinha TIRADO o teto — e criei pior. Com cache
  // frio e 5 dias movimentados, o `montarEspreita` esperava TODOS
  // serialmente, e ele esta no caminho da TELA. Troquei "alguns sem
  // estrela" por "a tela lenta", que e o problema que passei o dia
  // consertando na busca por nome.
  //
  // O desenho certo e o do alerta: espera um punhado e joga o RESTO no
  // enriquecimento de fundo.
  ok(/TETO_ENRIQ_RECENTES/.test(codigo),
     'o enriquecimento sincrono das recentes TEM teto (a tela nao espera todos)');
  ok(/dispararEnriquecimentoEspreita\(entreguesRecentes\)/.test(codigo),
     '  e o resto vai pro enriquecimento de FUNDO');

  // ── ⚠️ e quem ja foi BIPADO sai da lista ──────────────────────────
  //
  // `espreita_notas.baixado` e a baixa MANUAL. Quem foi triado normalmente
  // esta em `devolucoes` — e sem checar, devolucao triada ontem ganhava
  // estrela como se ninguem tivesse mexido.
  ok(/from\('devolucoes'\)[\s\S]{0,200}order_id/.test(codigo),
     'o filtro checa a tabela `devolucoes` (quem foi BIPADO)');
  ok(/triadas\.has\(String\(d\.tracking/.test(codigo),
     '  por pedido E por tracking, como o alerta faz');
}

// ── ⚠️ e o LIMITE DA SERIE esta documentado, nao fingido ────────────
//
// O cruzamento casa por número+SÉRIE e o ML Full usa série 2 — mas o
// enriquecimento NÃO produz série nenhuma. Copiar um campo inexistente
// seria fingir que resolvi.
{
  ok(/LIMITE CONHECIDO, NAO RESOLVIDO AQUI/.test(srv),
     '⚠️ o limite da serie esta ESCRITO (o Full nao ganha estrela ainda)');
  ok(!/d\.nf_serie = en\./.test(codigo),
     '  e nao copio campo de serie que nao existe');
}

// ── ⚠️ e as recentes passam por IDENTIDADE e ENRIQUECIMENTO ─────────
//
// A identidade descobre o PEDIDO pelo rastreio; o enriquecimento traz a
// NF — e o cruzamento casa por numero+serie da NF. Sem os dois, a entregue
// de ontem chega sem os campos que o casamento usa, e a estrela continuaria
// sem aparecer, agora por falta de DADO em vez de falta de lista.
{
  ok(/resolverIdentidadeEspreita\(entreguesRecentes,/.test(codigo),
     'as recentes passam pela identidade (descobre o pedido)');
  ok(/garantirEnriquecimentoEspreita\(entreguesRecentes/.test(codigo),
     '  e pelo enriquecimento (traz a NF, que e a chave do cruzamento)');
}

// ── e o /health mostra ──────────────────────────────────────────────
{
  ok(/entregues_recentes: cont\('entregues_recentes'\)/.test(codigo),
     'o /health mostra a contagem (pra diagnosticar sem ler codigo)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
