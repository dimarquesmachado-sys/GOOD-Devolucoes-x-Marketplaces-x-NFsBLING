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

  // b188: a janela padrao subiu pra 365 dias
  ok(/parseInt\(req\.query\.dias, 10\) \|\| 365/.test(rota),
     'a janela padrao e de 365 dias — NF de devolucao nao tem prazo, so o cancelamento tem');
  ok(/Math\.min\(730/.test(rota), '  com teto de 2 anos');
  ok(/nf_id_bling: d\.nf_id_bling \|\| null/.test(rota),
     'e a rota devolve o id da NF no Bling, que o modal precisa');
  ok(/buscarNFnoBlingPorNumero\(item\.nf_numero, null, \{ maxPaginas: 8 \}\)/.test(rota),
     '  buscando no Bling quando a captura nao tem (senao o dono cacaria a nota a mao)');
  ok(/segue sem o link; o numero da NF esta no card/.test(rota),
     '  e falha na busca nao derruba a lista');

  // b184.1: a EMPRESA e fixa, nao vem da URL
  ok(/const empresa = 'good';/.test(rota),
     'a empresa e FIXA — ?empresa=amb deixaria o admin da GOOD ver os dados da AMB');
  ok(!/req\.query\.empresa/.test(rota), '  e o parametro da querystring nao existe mais');
  ok(/\.eq\('empresa', empresa\)/.test(rota), '  mas o filtro no banco continua');
  ok(/\.eq\('tipo_tiktok', 'REFUND'\)/.test(rota),
     'e filtra REEMBOLSO PURO no BANCO, antes do limite de 500');
  ok(rota.indexOf(".eq('tipo_tiktok'") < rota.indexOf('.limit(LIMITE)'),
     '  (senao, numa janela com +500 capturadas, os reembolsos ficariam de fora)');
  ok(/st\.indexOf\('CANCEL'\) === -1/.test(rota),
     'descarta as canceladas: ali nao houve estorno (rede de seguranca, alem do filtro no banco)');
  // b184.1: a JANELA e do reembolso, e o STATUS filtra no banco
  ok(/\.gte\('criado_no_mkt', desde\)/.test(rota),
     'a janela ?dias conta do REEMBOLSO, nao da captura (que regrava tudo de hora em hora)');
  ok(/\.in\('status', \[/.test(rota),
     'e o status filtra NO BANCO — filtrar depois do limite tinha o mesmo defeito de antes');
  ok(rota.indexOf(".in('status'") < rota.indexOf('.limit(LIMITE)'),
     '  (antes do limite, senao numa janela cheia de pendentes as concluidas ficavam de fora)');

  // b184.1: pedido com VARIAS solicitacoes
  ok(/resolvidosFinos/.test(rota),
     'guarda os identificadores finos: o TikTok abre uma solicitacao por ITEM');
  ok(/nf_devolucao_id_bling/.test(rota),
     'quem JA tem NF de devolucao sai da lista');
  ok(/i \+= 200/.test(rota),
     '  conferindo TODOS os pedidos em fatias (o teto de 300 deixava os seguintes de fora)');
  ok(/nao consegui conferir quais ja tem NF/.test(rota),
     '  e falha nessa consulta e ERRO, nao lista incompleta: mostrar caso resolvido faria emitir NF duplicada');

  // o prazo da SEFAZ, contado da NOTA
  ok(/diasDesde <= 20/.test(rota), 'usa o prazo de 20 dias da SEFAZ pra decidir a acao');
  ok(/acao: podeCancelar \? 'cancelar_nf' : 'nf_devolucao'/.test(rota),
     '  dizendo em cada item se e CANCELAR ou NF DE DEVOLUCAO');
  // b184: a devolucao nasce DEPOIS da venda — contar dali dava mais prazo
  // do que existe, e o cancelamento voltaria 501 na cara do dono
  ok(/chave\.slice\(2, 4\)/.test(rota) && /chave\.slice\(4, 6\)/.test(rota),
     'o prazo conta da EMISSAO da nota, lida da chave da NF-e (posicoes 2-5, AAMM)');
  ok(/baseOrigem = 'chave_nfe'/.test(rota), '  marcando que a data veio da chave');
  ok(/baseOrigem = 'devolucao'/.test(rota) && /da MAIS prazo que o real/.test(rota),
     '  e quando nao ha chave, usa a devolucao e registra que e aproximacao otimista');
  ok(/prazo_base: baseOrigem/.test(rota), '  devolvendo a origem, pra tela poder avisar');
  ok(/uso o dia 1 \(a nota tem NO MAXIMO essa idade\)/.test(rota),
     '  e assume dia 1 do mes: a leitura mais conservadora');
  ok(/nunca sugiro cancelar algo ja intempestivo/.test(rota),
     '  preferindo NAO sugerir cancelamento a sugerir um que voltaria 501');

  // b188.1: a CHAVE manda sobre o numero
  // b188.3: a funcao devolve { ok, match }, nao a nota direto
  ok(/nf\.ok && nf\.match\) \? nf\.match : null/.test(rota),
     'le o `match` do resultado — eu lia `nf.id`, que nunca existe, e o link nunca apareceria');
  ok(/Promise\.race\(/.test(rota),
     'e o teto de tempo vai DENTRO da chamada: ela pagina com 400ms entre paginas e uma busca so ja passa de 8s');
  ok(/maxPaginas: 8/.test(rota), '  com menos paginas, porque aqui e so pra achar o link');

  // b188.3: uma saida pros que ficaram fora do corte
  ok(/req\.query\.ate/.test(rota),
     'ha ?ate=AAAA-MM-DD pra alcancar o que o limite cortou');
  ok(/consulta\.lte\('criado_no_mkt', ate\)/.test(rota),
     '  empurrando a janela pra tras, sem precisar paginar');

  ok(/chaveEsperada && chaveAchada && chaveEsperada !== chaveAchada/.test(rota),
     'a chave da NF-e manda: o NUMERO se repete entre series e traria a nota errada');
  ok(/Date\.now\(\) - INICIO_BUSCA > 8000/.test(rota),
     'e as buscas no Bling tem teto de tempo, pra nao travar o painel');
  ok(/doMagalu = semVinculo\.filter/.test(rota),
     '  e teto de quantidade, com COTA pro Magalu (15 dele + 10 dos outros)');
  ok(/item\.prazo_base === 'chave_nfe'[\s\S]{0,80}continue;/.test(rota),
     'a acao e RECALCULADA quando a chave so aparece na busca');
  ok(/item\.acao = podeAqui \? 'cancelar_nf' : 'nf_devolucao';/.test(rota),
     '  senao um caso ja intempestivo ficaria marcado como CANCELAR NF');

  // b188.2: janela cheia = pode haver caso fora da lista
  ok(/const cortou = \(data \|\| \[\]\)\.length >= LIMITE;/.test(rota),
     'a rota detecta quando a janela encheu');
  ok(/aviso_corte: cortou/.test(rota),
     '  e avisa, em vez de calar — os cortados sao os mais ANTIGOS, que so tem NF de devolucao como saida');
  ok(/aviso_corte/.test(PAINEL), '  com o aviso aparecendo na tela');

  // b196: achar a NF pelo PEDIDO quando nao ha numero nem chave ─────
//
// Caso real do dono: pedido 583529996785714778 (TikTok, R$ 189,10)
// aparecia "sem NF vinculada", mas a nota EXISTE no Bling — ele abriu e
// mostrou. A captura veio sem numero e sem chave porque a API do TikTok
// nao mandou (devolucao de abril, `return_line_items` vazio, sem buyer,
// sem sku). Mas o PEDIDO estava la.
{
  // b202: o filtro DIRETO vale pra todos, e roda PRIMEIRO
  // b203 (correcao DELE): pela NOTA primeiro. O pedido pode nao existir —
  // XML do Full importado nao cria pedido no Bling — e a nota sempre existe.
  // b204.4: as filas passaram a usar o rodizio do cache
  ok(/const comNumero = vinculoCache\.fila\(itens, empresa, 25, \(x\) => x\.nf_numero\)/.test(rota),
     'quem tem NUMERO de nota e buscado pela NOTA, que e a ponta firme');
  ok(/const semNota = vinculoCache\.fila\(itens, empresa, 25, \(x\) => !x\.nf_numero && x\.pedido\)/.test(rota),
     '  e a busca pelo PEDIDO fica pros que vieram SEM numero (o caso do TikTok)');
  ok(rota.indexOf('for (const item of semNota)') < rota.indexOf('for (const item of PARA_BUSCAR)'),
     '  e roda ANTES da busca por chave: o direto resolve em 1 chamada, a outra pagina');
  ok(/O RAPIDO PRIMEIRO/.test(rota),
     '  com o motivo: o lento gastava os 8s e o direto nem era tentado');
  ok(/buscarNFnoBlingPorOrderId\([\s\S]{0,80}item\.pedido/.test(rota),
     '  usando a funcao que ja existia pra isso');
  ok(/\.slice\(0, 10\)/.test(rota),
     '  com teto baixo: cada uma custa uma varredura no Bling');
  // b204.5: o teto era 12s e comia o da fase seguinte (a da CHAVE, que
  // pagina). Agora as tres fases cabem no mesmo orcamento.
  ok(/Date\.now\(\) - INICIO_BUSCA > 8000/.test(rota),
     '  com teto que deixa sobrar tempo pra fase da chave');
  ok(/nf_achada_por = 'pedido'/.test(rota),
     'marcando de onde veio: o casamento por pedido e menos exato que por chave');

  ok(/achada pelo pedido/.test(PAINEL),
     'e a tela AVISA, pra ele conferir que e a nota certa antes de emitir');

  const AMB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  // b203.1: a AMB usa a BLINDADA —  nao existe
  // nos ajudantes dela (o proprio arquivo avisa isso desde o b172)
  ok(/buscarNFBlindada\(\{[\s\S]{0,120}orderId: item\.pedido/.test(AMB),
     'e a AMB busca pela BLINDADA, que existe la e faz o filtro direto na fase 0');
  ok(!/ajudantes\.buscarNFnoBlingPorOrderId/.test(AMB),
     '  e nao chama mais a funcao inexistente — a busca dela NUNCA funcionou');
}

  ok(/aviso_cancelados/.test(rota),
     'a resposta avisa que casos resolvidos por CANCELAMENTO reaparecem (nao geram NF de devolucao)');

  // a ordenacao tem intencao
  ok(/a\.acao === 'cancelar_nf' \? -1 : 1/.test(rota),
     'quem ainda da pra cancelar vem PRIMEIRO — e a unica parte com prazo correndo');
  ok(/a\.prazo_cancelamento - b\.prazo_cancelamento/.test(rota),
     '  e dentro delas, o mais urgente');
  ok(/\(b\.valor \|\| 0\) - \(a\.valor \|\| 0\)/.test(rota),
     '  nas outras, o maior valor primeiro');

  // v4.81: a rota de LISTAR continua so listando — quem emite e a rota
  // /registrar + o modal de sempre, nao ela
  ok(!/blingClient\.emitir|emitirNFe/.test(rota),
     'a rota de listar NAO emite nada: quem emite e o fluxo de sempre');

  // ⚠️ O DEPOSITO MUDOU DE REGRA (correcao do dono, 30/08).
  //
  // Eu tinha escrito "sempre DEFEITO, a mercadoria nunca chegou". Errado
  // pros casos em que ela nunca SAIU: a NF de venda ja deu baixa no
  // estoque, entao a entrada CORRIGE a diferenca em vez de duplicar — e o
  // produto esta novo, no CD. [stated] "nos casos q o produto nunca foi
  // postado, é só gerar devolução normal, e depósito Geral. Simples."
  ok(/depósito de <b>DEFEITO<\/b>/.test(PAINEL),
     'a tela ainda orienta DEFEITO pra mercadoria que nao voltou ao CD');
  ok(/o produto voltou, então segue o depósito de sempre/.test(PAINEL),
     '  e o deposito de sempre pra quem voltou — a escolha final e dele no modal');
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
  ok(/carregarSemRetorno\(\);   \/\/ b184\.3/.test(PAINEL),
     '  e no timer tambem — o painel fica aberto o dia todo');
  ok(/catch \(e\) \{[\s\S]{0,120}nao a fila/.test(PAINEL),
     '  e falha nela NAO derruba a fila principal (bloco informativo)');

  ok(/style\.display = ''/.test(PAINEL.slice(PAINEL.indexOf('carregarSemRetorno'))),
     'a secao so aparece quando ha algo (nao polui o painel vazio)');
  // b184: e ESCONDE quando esvazia — antes a lista velha ficava na tela
  ok(/style\.display = 'none';[\s\S]{0,200}innerHTML = '';/.test(PAINEL),
     '  e ESCONDE quando o ultimo caso e resolvido (antes a lista velha ficava)');
  ok(/prazo_base === 'devolucao' \? ' ⚠️'/.test(PAINEL),
     'e marca com ⚠️ quando o prazo e aproximado, pra ele conferir antes de tentar cancelar');

  // b188: a TAG do marketplace, igual aos outros cards
  ok(/const CORES_MKT = \{ tiktok:/.test(PAINEL),
     'o card mostra a TAG do marketplace (ele nao sabia de onde vinha o caso)');
  ok(/NOMES_MKT\[mkt\] \|\| x\.marketplace/.test(PAINEL),
     '  com o nome legivel, e caindo no cru se aparecer marketplace novo');

  // b188.1: o botao de GERAR saiu — ele passaria o id errado (capturada x
  // triagem), a nota sairia com o pedido inteiro e sem o deposito de DEFEITO.
  // Botao que gera nota fiscal errada e pior que nao ter botao.
  {
    // a DEFINICAO da funcao, nao a primeira mencao (que e a chamada, 36 mil
    // caracteres antes) — foi o que fez tres verificacoes falharem a toa
    const iDef = PAINEL.indexOf('async function carregarSemRetorno');
    // e ATE o fim dela: 12 mil caracteres passavam da funcao e alcancavam o
    // carregarEspreita, que legitimamente chama o modal de gerar
    const fimDef = PAINEL.indexOf('async function carregarEspreita', iDef);
    const fnSR = PAINEL.slice(iDef, fimDef > iDef ? fimDef : iDef + 8000);
    // procura a CHAMADA, nao a mencao: o comentario que explica a remocao
    // cita o nome da funcao, e a busca crua acusava ele mesmo
    ok(!/onclick="abrirModalGerarDevolucao\(/.test(fnSR) && !/abrirModalGerarDevolucao\('/.test(fnSR),
       'o card NAO chama o modal de gerar: o id dele e de outra tabela (triagem, nao captura)');
    ok(/Abrir NF no Bling/.test(fnSR),
       '  leva pra NOTA no Bling, que e de onde ele agiria de qualquer forma');
    ok(/Lembre do depósito de DEFEITO/.test(fnSR),
       '  lembrando do deposito de DEFEITO ali mesmo');
    ok(/não localizada no Bling/.test(fnSR),
       '  e sem o id, mostra o numero da NF em vez de um link cego');
  }

  // b184.1: falha != fila vazia
  ok(/Não consegui carregar esta lista/.test(PAINEL),
     'FALHA da rota mostra erro, nao a tela de "nada pendente"');
  ok(/não<\/b> quer dizer que não há casos/.test(PAINEL),
     '  dizendo explicitamente que nao e o mesmo que fila vazia');
  ok(/CANCELAR NF · '/.test(PAINEL), 'cada item diz se e CANCELAR');
  ok(/NF DE DEVOLUÇÃO/.test(PAINEL), '  ou NF de devolucao');
  ok(/prazo de cancelamento — essas primeiro/.test(PAINEL),
     'e ha aviso no topo quando existem casos com o relogio correndo');
  ok(/depósito de <b>DEFEITO<\/b>/.test(PAINEL),
     'a explicacao lembra do deposito de DEFEITO (a mercadoria nunca chegou)');

  // seguranca: o texto vem do cliente e do marketplace
  const iFn = PAINEL.indexOf('async function carregarSemRetorno');
  // ate a proxima funcao, sem numero magico: a janela fixa ja falhou duas
  // vezes conforme o card cresceu (b188 tag+botao, b189 Magalu)
  const fFn = PAINEL.indexOf('async function carregarEspreita', iFn);
  const fn = PAINEL.slice(iFn, fFn > iFn ? fFn : iFn + 12000);
  ok(/escapeHtml\(x\.produto/.test(fn) && /escapeHtml\(String\(x\.motivo\)\)/.test(fn),
     'tudo que vem de fora passa por escapeHtml (o motivo e escrito pelo cliente)');
  ok(/escapeHtml\(String\(x\.pedido/.test(fn) && /escapeHtml\(String\(x\.sku/.test(fn),
     '  inclusive pedido e SKU');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
