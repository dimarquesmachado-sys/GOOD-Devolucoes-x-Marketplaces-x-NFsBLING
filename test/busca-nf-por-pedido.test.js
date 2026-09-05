// Roda com: node test/busca-nf-por-pedido.test.js
//
// O dono viu "sem NF vinculada" num caso cuja nota EXISTE no Bling. A rota
// de diagnostico (#125) respondeu:
//
//   notas_vistas: 400
//   primeira_data: 2026-08-30  ultima_data: 2026-08-21   <- 9 DIAS
//   erro: TOO_MANY_REQUESTS (limite 3/segundo)
//
// E a venda era de ABRIL. Duas causas: a varredura comecava de HOJE e
// nunca chegaria la; e batia no limite do Bling no meio do caminho.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const BLING = fs.readFileSync(path.join(__dirname, '..', 'lib', 'bling.js'), 'utf8');
const i = BLING.indexOf('async function buscarNFnoBlingPorOrderId');
const fn = BLING.slice(i, i + 14000);   // b210.1: so esta funcao (~12,7k), nao o modulo inteiro

// ── a janela agora comeca na data certa ──────────────────────────────
{
  ok(/dataEmissaoInicial/.test(fn) && /dataEmissaoFinal/.test(fn),
     'a consulta FILTRA por data em vez de paginar de hoje pra tras');
  ok(/400 notas cobriram 9 DIAS/.test(fn),
     '  com a medicao registrada: 400 notas cobriam 9 dias, e a venda era de abril');
  // b197.1: a janela olha pra TRAS, nao pra frente
  ok(/const DIAS_ANTES = opcoes\.diasAntes \|\| 180;/.test(fn),
     '  e a janela vai 180 dias ANTES do evento');
  ok(/a venda sempre precede a devolucao/.test(fn),
     '  porque a data que recebo e a da DEVOLUCAO, e a venda veio antes');
  ok(/o Bling devolve do MAIS RECENTE primeiro/i.test(fn),
     '  e terminando depois do evento, a nota ficaria no FIM da lista');

  const ref = Date.parse('2026-04-19');
  const ini = new Date(ref - 180 * 864e5).toISOString().slice(0, 10);
  const fim = new Date(ref + 60 * 864e5).toISOString().slice(0, 10);
  ok(ini === '2025-10-21' && fim === '2026-06-18',
     'pro caso de 19/04, a janela vai de 21/10 a 18/06 — cobre venda antiga E nota emitida depois');
  ok(/60 \* 864e5/.test(fn),
     '  os 60 dias pra frente cobrem NF que sai bem depois (14/05 pra devolucao de 19/04)');

  // b197.2: a AMB precisa passar a data — ela nao monta `criado_em`
  const AMB = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/item\.nf_emitida_em \|\| item\.cancelado_em \|\| item\.criado_no_mkt/.test(AMB),
     'a AMB passa a data pela mesma cascata do prazo (ela nao monta `criado_em`)');
  ok(/sem elas a blindada pula as fases/.test(AMB),
     '  senao ia null e a blindada pularia as fases de janela');

  // e o retry nao empilha
  ok(/UMA tentativa extra por pagina, e so/.test(fn),
     'o retry do limite acontece UMA vez: insistir piora o proprio limite');

  // b197.3: o corte de 5 dias era da varredura antiga e atrapalhava
  ok(/if \(!filtroData && dataLimite/.test(fn),
     'o corte de 5 dias so vale SEM filtro de data');
  ok(/este break interrompia depois de 5 dias/.test(fn),
     '  senao a consulta abria a janela certa e desistia antes de chegar na nota');

  // e o prazo do chamador tem que caber nas paginas pedidas
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  // b197.4: a janela tem que CABER nas paginas lidas
  ok(/const DIAS_FATIA = opcoes\.diasFatia \|\| 20;/.test(fn),
     'a varredura vai em FATIAS de 20 dias, indo pra tras');
  ok(/6 paginas sao 600 notas, ou ~14 DIAS/.test(fn),
     '  porque 6 paginas cobrem ~14 dias na densidade real (400 notas em 9 dias)');
  ok(/usaFatias && paginasNaFatia >= PAGINAS_POR_FATIA/.test(fn),
     '  com teto POR fatia: senao uma densa consumiria tudo');
  // b197.8: mas o teto por fatia so vale QUANDO ha fatias
  ok(/o teto POR FATIA so vale QUANDO ha fatias/.test(fn),
     'sem `dataReferencia` a varredura e linear e usa o orcamento inteiro');
  ok(/encerrava na 2a pagina, ignorando as 12/.test(fn),
     '  antes ela parava na 2a pagina, ignorando o que o chamador pediu');
  ok(/fatiaAtual\+\+/.test(fn), '  e o laco avanca pra fatia anterior');

  // b197.5: PAGINA e CHAMADA sao contadores diferentes
  ok(/for \(let chamadas = 0; chamadas < MAX_PAGINAS; chamadas\+\+\)/.test(fn),
     'o teto global conta CHAMADAS, nao paginas');
  ok(/pagina = 1;              \/\/ b197\.5/.test(fn),
     '  e a pagina REINICIA a cada fatia');
  ok(/a fatia nova comecava na pagina 4, 7, 10/.test(fn),
     '  senao a fatia nova comecava na pagina 4, 7, 10 — pulando as mais recentes dela');

  // b197.5: fatia vazia nao encerra
  ok(/if \(lista\.length === 0\) \{[\s\S]{0,200}fatiaAtual\+\+/.test(fn),
     'fatia VAZIA avanca pra proxima em vez de encerrar a busca');
  ok(/nao diz nada sobre as[\s\S]{0,40}fatias anteriores/.test(fn),
     '  porque um mes fraco nao diz nada sobre os anteriores');

  ok(/maxPaginas: 12, paginasPorFatia: 2, delayMs: 450/.test(SERVER),
     '12 paginas em 6 fatias = 120 dias de alcance (com 6 chegava a 40)');
  ok(/26000 - \(Date\.now\(\) - INICIO_BUSCA\)/.test(SERVER),
     '  e o prazo desconta o tempo ja gasto pelas buscas anteriores');

  // b197.6: o FILTRO DIRETO resolve sem varrer
  ok(/numeroLoja=' \+ encodeURIComponent\(orderIdStr\)/.test(fn),
     'o Bling filtra por numeroLoja: UMA chamada, sem paginar');
  ok(/via: 'filtro_direto'/.test(fn), '  marcando de onde veio o resultado');

  // b198: o pedido mora em VARIOS campos — o dono mostrou a NF no Bling
  ok(/\[nf\.numeroPedidoLoja, nf\.numeroLoja, nf\.numeroPedido\]/.test(fn),
     'o pedido e procurado em varios campos: no caso real ele estava em "Numero loja virtual"');
  ok(/o Bling ja filtrou por numeroLoja/.test(fn),
     '  e sem nenhum bater, uso o que o filtro devolveu — ele nao traz nota de outro pedido');
  ok(/refT \+ 60 \* 864e5/.test(fn),
     'e a janela vai 60 dias pra frente: a devolucao era de 19/04 e a NF de 14/05');
  // b197.7: ordenar antes de escolher — a ordem do Bling nao e garantida
  ok(/\.sort\(\(a, b\) => String\(b\.dataEmissao/.test(fn),
     'o caminho direto ORDENA por dataEmissao antes de escolher');
  ok(/geraria a[\s\S]{0,30}devolucao contra a nota errada/.test(fn),
     '  senao um pedido com 2 notas vivas podia devolver a ANTIGA');
  ok(/vivas_no_pedido/.test(fn),
     '  e a resposta diz quando havia mais de uma');
  ok(/A varredura vira so o plano B/.test(fn),
     '  e a varredura em fatias fica como plano B');
  ok(/Escolher entre "cobre perto" e "olha longe" e escolher errado/.test(fn),
     '  porque a varredura nunca fechava a conta: 2 paginas cobrem 4,5 dias de uma fatia de 20');
}

// ── o limite de requisicoes nao e desistencia ────────────────────────
{
  ok(/const DELAY_MS = opcoes\.delayMs \|\| 700;/.test(fn),
     'o ritmo caiu pra 700ms: o Bling limita a 3 req/s e 400ms batia no teto');
  ok(/TOO_MANY_REQUESTS/i.test(fn),
     'e o limite e RECONHECIDO em vez de tratado como falha qualquer');
  // b237.7 (Codex): a checagem olhava o texto EXATO `chamarBling(url)` e
  // quebrou quando a chamada ganhou o parametro `{ fundo }` — o
  // comportamento (esperar e repetir a MESMA pagina) nao mudou. Agora
  // aceita argumentos extras, que e o que importa.
  ok(/await sleep\(1500\);[\s\S]{0,160}chamarBling\(url[^)]*\)/.test(fn),
     '  esperando e tentando a MESMA pagina de novo');
  ok(/indistinguivel de a nota nao existir/.test(fn),
     '  porque desistir ali devolvia "nao achei", que engana');
  ok(/limite_atingido: true/.test(fn),
     'e quando nem a segunda tentativa passa, a resposta DIZ que foi limite');
}

// ── b203: pela NOTA primeiro; o pedido e reserva ────────────────────
//
// [stated] "pq vc fica indo atrás de pedido. pode ser q algum pedido esteja
// com erro, não tenha, por ter sido importado XML do full. vc tinha q tá
// pegando nota fiscal. nf sim sempre terá."
//
// Isso explica por que o TikTok funcionou e o Magalu nao: o TikTok veio SEM
// numero (fui pelo pedido, e havia pedido); os 25 do Magalu tem numero e
// chave — a ponta firme, que eu ignorava.
{
  const iNum = BLING.indexOf('async function buscarNFnoBlingPorNumero');
  const fnNum = BLING.slice(iNum, iNum + 6000);
  ok(/'&numero=' \+ encodeURIComponent\(alvo\)/.test(fnNum),
     'ha filtro direto por NUMERO da nota — uma chamada, sem paginar');
  ok(/via: 'filtro_direto_numero'/.test(fnNum), '  marcando de onde veio');
  ok(/\[numeroNFStr, numeroNFLimpo\]/.test(fnNum),
     '  tentando com e sem zeros a esquerda (065999 e 65999)');
  ok(/nf sim sempre terá/.test(fnNum),
     '  com o motivo dele registrado: a nota sempre existe, o pedido nao');

  const SERVER2 = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i2 = SERVER2.indexOf("'/api/admin/sem-retorno'");
  const rota2 = SERVER2.slice(i2, i2 + 52000);   // a rota cresceu (b204.1)
  ok(rota2.indexOf('for (const item of comNumero)') < rota2.indexOf('for (const item of semNota)'),
     'a busca por NUMERO roda antes da por pedido');
  // b204.1: a fase da CHAVE agora vem por ultimo de proposito — ela e a
  // EXATA, e resolve o que o numero deixou ambiguo
  ok(rota2.indexOf('for (const item of PARA_BUSCAR)') > rota2.indexOf('for (const item of comNumero)'),
     '  e a por chave por ultimo: exata, resolve o que o numero deixou ambiguo');

  const AMB2 = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/buscarNFnoBlingPorNumero\(item\.nf_numero/.test(AMB2),
     'e a AMB busca pela nota tambem — sem isso ela ficaria pra tras de novo');

  // b203.1: numero se REPETE entre series — conferir a chave
  // b203.2: chave AUSENTE nao vale como confirmacao (era `|| !chaveAchada`)
  // b208: virou a ESCADA — chave > serie > marketplace > cliente
  ok(/confrontar\.escolher\(item,/.test(rota2),
     'a chave e conferida antes de aceitar: numero se repete entre SERIES');
  ok(/geraria a devolucao contra a venda errada/.test(rota2),
     '  senao o dono geraria a devolucao contra a venda errada');
  ok(/const chaveBate/.test(AMB2), '  na AMB tambem');

  // e a AMB ganhou o filtro direto na helper dela
  const HELP = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'admin-helpers-AMB.js'), 'utf8');
  ok(/'&numero=' \+ encodeURIComponent\(alvo\)/.test(HELP),
     'a helper da AMB tem o filtro direto por numero (so paginava antes)');
  ok(/!\[2, 9\]\.includes\(Number\(nf && nf\.situacao\)\)/.test(HELP),
     '  com a checagem de nota morta LOCAL — `nfeDescartavel` e da GOOD');

  // ritmo: 3 req/s do Bling
  ok(/if \(buscadas > 0\) await new Promise/.test(rota2),
     'ha pausa entre as buscas diretas: o Bling limita a 3 req/s');
  ok(/os ultimos nem sao tentados/.test(rota2),
     '  senao o retry de cada 429 comeria o orcamento inteiro');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
