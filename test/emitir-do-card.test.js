// Roda com: node test/emitir-do-card.test.js
//
// [stated] "se tá ali, pode até criar gerar automático esse registro. pq no
// fim, o q vai interessar mm é a emissão da NF e pra qual depósito eu vou
// direcionar"
//
// POR QUE PRECISA REGISTRAR: quem emite a NF de devolucao e a extensao
// Bridge, e ela grava o resultado usando o id de uma TRIAGEM. Os casos do
// card de estornadas nao tem triagem — ninguem bipou, o produto nem sempre
// voltou. Entao o registro e criado na hora em que ele manda emitir.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const PAINEL = fs.readFileSync(path.join(RAIZ, 'public', 'painel-devolucoes.html'), 'utf8');

// ── a rota que registra ──────────────────────────────────────────────
{
  const i = SERVER.indexOf("'/api/admin/sem-retorno/registrar'");
  ok(i !== -1, 'ha rota que registra o caso pra poder emitir');
  const rota = SERVER.slice(i, i + 4000);

  ok(/tipo: 'aprovado'/.test(rota),
     'o registro entra como APROVADO — cai na fila normal de "aguardando NF"');
  ok(/\.eq\('order_id', pedido\)/.test(rota),
     'e confere se JA existe antes de criar');
  ok(/ja_existia: true/.test(rota),
     '  devolvendo o id do existente: clicar duas vezes nao cria dois registros');
  ok(/nf_ja_emitida: !!existente\.nf_devolucao_id_bling/.test(rota),
     '  e avisando quando a NF ja saiu');

  ok(/\[ESTORNADA SEM RETORNO\]/.test(rota),
     'o registro carrega o RASTRO de onde veio');
  ok(/NAO houve bipagem: a mercadoria pode nao ter voltado/.test(rota),
     '  dizendo que nao houve bipagem — quem olhar depois precisa saber');

  ok(/sem pedido, nao da pra registrar/.test(rota), 'e sem pedido, recusa');
}

// ── a correcao dele sobre o estoque ──────────────────────────────────
{
  ok(/A NF DE VENDA JA[\s\S]{0,40}DEU BAIXA no estoque/.test(SERVER),
     'o comentario registra POR QUE a entrada nao duplica estoque');
  ok(/é só gerar devolução normal, e depósito Geral/.test(SERVER),
     '  com a correcao dele, que estava certa e a minha preocupacao nao');
}

// ── o botao e a funcao no card ───────────────────────────────────────
{
  const iFn = PAINEL.indexOf('async function gerarDoCardEstornadas');
  ok(iFn !== -1, 'ha funcao que registra e abre o modal');
  const fn = PAINEL.slice(iFn, iFn + 3000);

  ok(/sem-retorno\/registrar/.test(fn), '  chamando a rota de registro');
  ok(/abrirModalGerarDevolucao\(\s*String\(j\.id\)/.test(fn),
     'e caindo no MESMO modal das "Aprovadas" — nao duplico fluxo de emissao');
  ok(/JÁ tem NF de devolução emitida/.test(fn),
     'com aviso quando a NF ja saiu: duas notas da mesma venda e problema fiscal');
  ok(/j\.ja_existia/.test(fn), '  e avisando quando o caso ja estava registrado');
  ok(/dados do card ilegíveis/.test(fn), 'JSON quebrado nao vira excecao solta');

  ok(/🧾 Gerar NF de devolução<\/button>/.test(PAINEL), 'e o botao aparece no card');
  ok(/const podeGerar = x\.nf_id_bling &&/.test(PAINEL),
     '  so quando a NF foi localizada no Bling — sem ela o modal nao saberia de qual gerar');
}

// ── o JSON no atributo aguenta texto real ────────────────────────────
{
  const montar = (d) => JSON.stringify(JSON.stringify(d)).replace(/'/g, '&#39;');
  const comApostrofo = { pedido: '1', produto: "Lustre 8' Dourado d'agua" };
  const attr = montar(comApostrofo);
  ok(!attr.includes("'"), 'produto com APOSTROFO nao quebra o atributo HTML');

  const voltou = JSON.parse(JSON.parse(attr.replace(/&#39;/g, "'")));
  ok(voltou.produto === comApostrofo.produto, '  e o texto sobrevive de volta inteiro');

  const comAspas = montar({ produto: 'Globo 15" Branco' });
  ok(JSON.parse(JSON.parse(comAspas)).produto === 'Globo 15" Branco',
     'e com aspas duplas tambem');
}

// ── v4.81.1: os cinco furos que a revisao pegou ─────────────────────
{
  // 1. a Bridge monta a devolucao com a nota INTEIRA — nao da pra
  //    restringir aos itens reembolsados. Emitir direto daqui
  //    transmitiria TODOS pra SEFAZ, e e irreversivel.
  ok(/function abrirModalGerarDevolucao\([^)]*soRascunho\)/.test(PAINEL),
     'o modal aceita "so rascunho"');
  ok(/\$\{soRascunho \?/.test(PAINEL),
     '  e esconde o "Gerar \+ Emitir" quando pedido');
  ok(/todos os itens da nota original/.test(PAINEL),
     '  explicando por que: a nota sai com a original inteira');
  const iFn = PAINEL.indexOf('async function gerarDoCardEstornadas');
  const fn = PAINEL.slice(iFn, iFn + 3500);
  ok(/String\(d\.nf_chave \|\| ''\)\.replace\(\/\[\^0-9\]\/g, ''\),\s*\n\s*true\n/.test(fn),
     'e o card SEMPRE pede so rascunho — que e o que o dono ja faz (edita no Bling)');

  // 2. card que ainda da pra CANCELAR nao pode oferecer devolucao
  ok(/x\.nf_id_bling && x\.acao !== 'cancelar_nf'/.test(PAINEL),
     'o botao some quando a acao e CANCELAR NF');
  ok(/a devolução só depois do prazo/.test(PAINEL),
     '  e a tela diz por que, pra ele nao perder o prazo de cancelamento');

  // 3. mercadoria que NAO voltou nao pode entrar no estoque geral
  ok(/d\.entrada_estoque === false/.test(fn),
     'avisa quando o produto NAO voltou');
  ok(/senão entra saldo que não existe no galpão/.test(fn),
     '  porque entrada ali criaria saldo inexistente (o de DEFEITO e o lugar)');

  // 4. a chave e a SOLICITACAO, nao o pedido
  const iR = SERVER.indexOf("'/api/admin/sem-retorno/registrar'");
  const rota = SERVER.slice(iR, iR + 4500);
  ok(/\[caso:' \+ chaveCaso \+ '\]/.test(rota),
     'o registro guarda a chave da SOLICITACAO');
  ok(/const existente = chaveCaso/.test(rota),
     '  e a busca casa por ela: a 2a solicitacao do mesmo pedido nao e bloqueada pela NF da 1a');

  // 5. o JSON vai em data-attribute, nao em handler inline
  ok(/data-caso="' \+ escapeHtml\(JSON\.stringify/.test(PAINEL),
     'os dados vao num data-attribute, escapados');
  ok(/b\.dataset\.caso/.test(PAINEL), '  e um listener le dali');
  ok(!/onclick=\\'gerarDoCardEstornadas/.test(PAINEL),
     '  sem handler inline: entidade HTML no titulo virava aspa solta e quebrava o onclick');
}

// ── b193: as tres consequencias que a revisao pegou ─────────────────
{
  const iFn2 = PAINEL.indexOf('async function gerarDoCardEstornadas');
  const fn2 = PAINEL.slice(iFn2, iFn2 + 4000);

  // 1. registrar UM caso nao pode sumir com os IRMAOS
  ok(/casosRegistrados\.add\(m\[1\]\)/.test(SERVER),
     'o registro do CARD marca so aquele caso (`[caso:X]`)');
  ok(/triadosSemMarcador\.add\(String\(t\.order_id\)\)/.test(SERVER),
     '  e a triagem de BIPE derruba o pedido todo — ali o produto voltou de verdade');
  ok(/casosRegistrados\.has\(String\(m\.id\)\)/.test(SERVER),
     'entao registrar uma nota nao some com as IRMAS do mesmo pedido');

  // 2. clique duplo
  ok(/if \(_gerandoEstornada\) return;/.test(fn2),
     'clique duplo nao cria dois registros (a checagem do servidor nao pega a corrida)');
  ok(/_gerandoEstornada = false;/.test(fn2), '  e a trava solta no fim');

  // 3. b199: o popup SAIU a pedido do dono ("não faz pop up assim não").
  //    O que protege agora: o servidor nao cria duplicata, a fila tem
  //    lixeira, e o toast conta o que aconteceu.
  ok(!/confirm\('Registrar este caso/.test(fn2),
     'sem popup de confirmacao — o dono pediu pra tirar');
  ok(/o registro e reversivel/.test(PAINEL),
     '  com o motivo registrado: o registro e reversivel pela lixeira da fila');
}

// ── b193.1: os dois P1 que quase passaram ───────────────────────────
{
  // 1. eu lia um campo que NAO buscava — o conserto dos irmaos nao
  //    funcionava, e eles voltavam a sumir todos
  const iSel = SERVER.indexOf('pedidosMagalu.slice(i, i + 200)');
  const trecho = SERVER.slice(Math.max(0, iSel - 800), iSel);
  ok(/\.select\('order_id, problema_descricao'\)/.test(trecho),
     'a consulta busca `problema_descricao`, que e lido logo depois');
  ok(/o campo vinha undefined/.test(SERVER),
     '  com o motivo registrado: sem ele TODO registro parecia triagem de bipe');

  // 2. na fila normal, a esteira manda `emitir: true` SEMPRE — e isso
  //    contornaria a protecao de so-rascunho deste PR
  ok(/\[SO RASCUNHO\]/.test(SERVER),
     'o registro do card entra MARCADO como so-rascunho');
  ok(/c\.dataset\.sorascunho !== '1'/.test(PAINEL),
     'e a ESTEIRA pula esses casos: ela emite direto, e sairia a nota inteira');
  // b193.3: o CONCLUIR em lote tambem — concluido esconde o caso, e o
  // rascunho ainda precisa ser validado no Bling
  ok(/c\.dataset\.sorascunho !== '1'\)/.test(PAINEL.slice(PAINEL.indexOf('async function concluirSelecionadas'))),
     'e o CONCLUIR em lote tambem os pula');
  ok(/conclua depois de validar a NF no Bling/.test(PAINEL),
     '  avisando quantos foram pulados e por que');
  // b193.4: e o concluir de UM card tambem — foi a terceira porta pro
  // mesmo problema (emitir em lote, concluir em lote, concluir individual)
  ok(/Já validou a NF no Bling\?/.test(PAINEL),
     'e o concluir INDIVIDUAL pergunta antes de esconder o caso');
  ok(/chk\.dataset\.sorascunho === '1'/.test(PAINEL.slice(PAINEL.indexOf('async function concluir('))),
     '  lendo o marcador do proprio card');
  ok(/data-sorascunho="/.test(PAINEL), '  com o marcador no checkbox');
  // a chamada tem parenteses internos, entao conto as ocorrencias em vez
  // de tentar casar a linha inteira
  const botoesMarcados = (PAINEL.match(/replace\(\/\[\^0-9\]\/g, ''\)\}', \$\{\(d\.problema_descricao/g) || []).length;
  ok(botoesMarcados >= 2,
     '  e o botao da fila normal tambem so oferece rascunho nesses (achei ' + botoesMarcados + ')');

  const ocorr = (PAINEL.match(/data-sorascunho="/g) || []).length;
  ok(ocorr >= 2, 'o marcador esta nas DUAS secoes com esteira (achei ' + ocorr + ')');
}

// ── b193.2: dois campos que nao chegavam, e uma contagem errada ─────
{
  const iR2 = SERVER.indexOf("'/api/admin/sem-retorno'");
  const rota2 = SERVER.slice(iR2, iR2 + 32000);   // a rota cresceu de novo (b195)
  ok(/entrada_estoque: d\.entrada_estoque/.test(rota2),
     '`entrada_estoque` CHEGA no card (era lido e nunca repassado)');
  ok(/prejuizo_integral: d\.prejuizo_integral/.test(rota2),
     '  e `prejuizo_integral` tambem — a tarja vermelha dependia dele');

  // o registro sintetico nao pode contar como caixa recebida
  const PARCIAL = fs.readFileSync(path.join(RAIZ, 'lib', 'devolucao-parcial.js'), 'utf8');
  ok(/includes\('\[ESTORNADA SEM RETORNO\]'\)\) continue;/.test(PARCIAL),
     'registro do card NAO conta como caixa recebida na contagem de parciais');
  ok(/apareceria como COMPLETO, e o dono emitiria a nota/.test(PARCIAL),
     '  senao um pedido de 2 caixas com 1 triada pareceria completo');

  const dp = require('../lib/devolucao-parcial');
  const g = dp.agrupar([
    { id: 1, order_id: 'P1', created_at: '2026-08-01', problema_descricao: 'bipagem OK' },
    { id: 2, order_id: 'P1', created_at: '2026-08-02', problema_descricao: '[ESTORNADA SEM RETORNO] [caso:X]' },
  ], { P1: 2 });
  ok(g[0] && g[0].vieram === 1 && g[0].completo === false,
     '  conferido: 1 triagem real + 1 registro do card = ainda aguardando a 2a caixa');
}

// ── b199: sem popup, e com selecao multipla ─────────────────────────
//
// [stated] "não faz pop up assim não. e tem como selecionar todas? mais
// de uma?"
{
  const PAINEIS = [
    ['GOOD', PAINEL],
    ['AMB (servido)', fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8')],
    ['AMB (direto)', fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel2-AMB.html'), 'utf8')],
  ];

  for (const [nome, html] of PAINEIS) {
    ok(!/confirm\('Registrar este caso/.test(html),
       nome + ': sem o popup de confirmacao');
    ok(/chk-estornada/.test(html), nome + ': tem checkbox pra selecionar');
    ok(/chkTodasEstornadas/.test(html), nome + ': tem "marcar todas"');
    ok(/async function gerarLoteEstornadas/.test(html), nome + ': tem a funcao do lote');
    ok(/checkbox \+ botaoGerar \+ linkNF/.test(html), nome + ': o card renderiza os dois');
  }

  // b199.1: o botao NAO promete o que nao faz
  ok(/Mandar selecionadas pra fila de NF/.test(PAINEL),
     'o botao diz MANDAR PRA FILA — ele nao gera rascunho, so registra');
  ok(/O lote NÃO gera nota nenhuma — só organiza a fila/.test(PAINEL),
     '  e a barra explica: a geracao passa pela Bridge, um a um');

  // a rota que o lote chama existe nas DUAS empresas
  const AMB_APP = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/router\.post\('\/api\/admin\/sem-retorno\/registrar'/.test(AMB_APP),
     'a AMB tem a rota de registrar — sem ela todo clique dava 404');

  // b199.2: os tres P1 da rodada
  ok(/status: 'aprovado',/.test(AMB_APP),
     'o registro entra com status APROVADO — a AMB filtra a fila por essa coluna');
  ok(/a AMB filtra a fila pela coluna `status`/.test(AMB_APP),
     '  com o motivo: com "pendente" ele nunca apareceria em "Aprovadas"');
  ok(/sem-retorno\/registrar', auth\.requerAdmin/.test(AMB_APP),
     'e exige ADMIN, nao qualquer login — o painel da AMB e aberto a estoquista');
  ok(/casosRegistrados\.has\(String\(d\.id\)\)/.test(AMB_APP),
     'registrar UM caso nao some com os IRMAOS do mesmo pedido');

  // o rotulo nao volta a prometer rascunho
  for (const [nome, html] of [
    ['GOOD', PAINEL],
    ['AMB (servido)', fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8')],
    ['AMB (direto)', fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel2-AMB.html'), 'utf8')],
  ]) {
    ok(!/Gerar rascunhos das selecionadas/.test(html),
       nome + ': o rotulo nao promete rascunho em lugar nenhum');
    ok(/dataset\.sorascunho !== '1'/.test(html),
       nome + ': a esteira pula os casos do card');
  }

  // e o modal da AMB nao recebe o parametro errado
  for (const [nome, html] of [
    ['AMB (servido)', fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8')],
    ['AMB (direto)', fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel2-AMB.html'), 'utf8')],
  ]) {
    ok(/todos os itens da original/.test(html),
       nome + ': avisa por toast em vez de passar `true` na posicao errada');
    ok(/querySelectorAll\('\.btn-gerar-estornada'\)/.test(html),
       nome + ': o botao e LIGADO depois de montar o HTML');
  }
  ok(/if \(j\.nf_ja_emitida\) \{ jaTinham\+\+; continue; \}/.test(PAINEL),
     'quem JA tem NF fica de fora do lote — segunda nota da mesma venda e problema fiscal');
  ok(/if \(_loteEstornadas\) return;/.test(PAINEL),
     'e o lote nao dispara duas vezes');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
