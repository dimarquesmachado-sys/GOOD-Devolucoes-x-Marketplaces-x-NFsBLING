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
const fn = BLING.slice(i, i + 13000);  // cresceu de novo (filtro direto)

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
  const fim = new Date(ref + 30 * 864e5).toISOString().slice(0, 10);
  ok(ini === '2025-10-21' && fim === '2026-05-19',
     'pro caso de 19/04, a janela vai de 21/10 a 19/05 — cobre venda antiga E nota emitida depois');
  ok(/30 \* 864e5/.test(fn),
     '  os 30 dias pra frente cobrem NF que sai depois da data de referencia');

  // b197.2: a AMB precisa passar a data — ela nao monta `criado_em`
  const AMB = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/item\.nf_emitida_em \|\| item\.cancelado_em \|\| item\.criado_no_mkt/.test(AMB),
     'a AMB passa a data pela mesma cascata do prazo (ela nao monta `criado_em`)');
  ok(/a busca virava varredura CEGA/.test(AMB),
     '  senao ia null e a janela por data nao servia de nada');

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
  ok(/paginasNaFatia >= PAGINAS_POR_FATIA/.test(fn),
     '  com teto POR fatia: senao uma densa consumiria tudo');
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
  ok(/await sleep\(1500\);[\s\S]{0,120}chamarBling\(url\)/.test(fn),
     '  esperando e tentando a MESMA pagina de novo');
  ok(/indistinguivel de a nota nao existir/.test(fn),
     '  porque desistir ali devolvia "nao achei", que engana');
  ok(/limite_atingido: true/.test(fn),
     'e quando nem a segunda tentativa passa, a resposta DIZ que foi limite');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
