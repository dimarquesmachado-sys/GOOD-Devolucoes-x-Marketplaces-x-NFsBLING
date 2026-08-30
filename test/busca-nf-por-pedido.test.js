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
const fn = BLING.slice(i, i + 5000);

// ── a janela agora comeca na data certa ──────────────────────────────
{
  ok(/dataEmissaoInicial/.test(fn) && /dataEmissaoFinal/.test(fn),
     'a consulta FILTRA por data em vez de paginar de hoje pra tras');
  ok(/400 notas cobriram 9 DIAS/.test(fn),
     '  com a medicao registrada: 400 notas cobriam 9 dias, e a venda era de abril');
  ok(/60 \* 24 \* 60 \* 60 \* 1000/.test(fn),
     '  e a janela vai ate 60 dias DEPOIS da venda (a NF pode sair atrasada)');

  // a janela calculada pro caso real
  const ref = new Date('2026-04-19');
  const ini = new Date(ref.getTime() - 5 * 864e5).toISOString().slice(0, 10);
  const fim = new Date(ref.getTime() + 60 * 864e5).toISOString().slice(0, 10);
  ok(ini === '2026-04-14' && fim === '2026-06-18',
     'pro caso de 19/04, a janela vai de 14/04 a 18/06 — cobre a venda');
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
