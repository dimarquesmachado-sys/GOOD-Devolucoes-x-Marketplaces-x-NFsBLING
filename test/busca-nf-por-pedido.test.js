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
const fn = BLING.slice(i, i + 9000);   // a funcao cresceu com os consertos

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
  ok(/maxPaginas: 6/.test(SERVER),
     'o chamador pede 6 paginas: com 700ms entre elas, 12 nao caberiam no prazo');
  ok(/setTimeout\(\(\) => ok\(null\), 8000\)/.test(SERVER),
     '  e o prazo subiu pra 8s, coerente com o ritmo mais lento');
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
