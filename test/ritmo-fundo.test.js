// Roda com: node test/ritmo-fundo.test.js
//
// O portao de ritmo do Bling tem DUAS filas: interativa (o estoquista
// esperando com a caixa na mao) e de fundo (espreita, indice de nomes,
// pre-aquecimento). Quem e de fundo tem que DIZER que e.
//
// ⚠️ Este teste existe porque eu escrevi num commit que "o `fundo` desce
// ate a blindada" — e nao descia: minha substituicao nao pegou nenhuma
// chamada e eu nao conferi. O Codex achou. Agora a checagem e automatica.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const BLING = fs.readFileSync(path.join(RAIZ, 'lib', 'bling.js'), 'utf8');
const NOMES = fs.readFileSync(path.join(RAIZ, 'lib', 'nf-nomes.js'), 'utf8');

// ── a prioridade funciona de verdade ────────────────────────────────
{
  const ritmo = require('../lib/ritmo-bling.js');
  const ordem = [];
  const fundo = Array.from({ length: 6 }, () =>
    ritmo.comRitmo(async () => ordem.push('fundo'), { fundo: true }));

  setTimeout(async () => {
    const inter = Array.from({ length: 2 }, () =>
      ritmo.comRitmo(async () => ordem.push('INTERATIVA')));
    await Promise.all([...fundo, ...inter]);

    const pos = ordem.indexOf('INTERATIVA');
    ok(pos >= 0 && pos <= 3,
       'a chamada INTERATIVA fura a fila das de fundo (passou na posicao ' + pos + ')');

    // e a taxa continua respeitada
    const marcas = [];
    await Promise.all(Array.from({ length: 9 }, () =>
      ritmo.comRitmo(async () => marcas.push(Date.now()))));
    let pior = 0;
    for (const t of marcas) pior = Math.max(pior, marcas.filter((x) => x >= t && x < t + 1000).length);
    // b253 - ⚠️ O TETO VIROU 2,5/s (a conta e dividida com o Mover-Pedidos),
    // e janela de 1s so contem numero INTEIRO de chamadas: com 400ms entre
    // elas, o pior caso legitimo e 3 (em t=0, 400 e 800ms).
    //
    // E exatamente o que a Expedicao mediu ao adotar o mesmo numero: "pior
    // caso 3 chamadas, no teto". Comparar com 2,5 cru acusaria o
    // comportamento CERTO.
    const tetoDaJanela = Math.ceil(ritmo.LIMITE_POR_SEGUNDO);
    ok(pior <= tetoDaJanela,
       'a prioridade NAO afrouxa a taxa (pior janela de 1s: ' + pior
       + ', teto ' + tetoDaJanela + ')');

    conferirCodigo();
  }, 30);
}

// ── e toda chamada de rotina de fundo REALMENTE marca `fundo` ───────
function conferirCodigo() {
  // buscarNFBlindada: usada no enriquecimento da espreita (Shopee)
  const iB = BLING.indexOf('async function buscarNFBlindada');
  const linhas = BLING.split('\n');
  const nB = BLING.slice(0, iB).split('\n').length - 1;
  const fim = linhas.findIndex((l, i) => i > nB
    && (l.startsWith('async function') || l.startsWith('function') || l.startsWith('module.exports')));
  const corpo = linhas.slice(nB, fim);
  const semFundo = corpo
    .map((l, i) => [nB + i + 1, l])
    .filter(([, l]) => /await (chamarBling|buscarNFnoBlingPorNumero)\(/.test(l) && !/fundo/.test(l));
  ok(semFundo.length === 0,
     'buscarNFBlindada repassa `fundo` em TODAS as chamadas ao Bling'
     + (semFundo.length ? ' (SEM fundo nas linhas: ' + semFundo.map((x) => x[0]).join(', ') + ')' : ''));

  ok(/buscarNFePorId\(idNF, \{ fundo/.test(BLING),
     '  incluindo a busca do detalhe da NF');

  // b237.5: VARREDURA GERAL — toda funcao do bling.js que aceita `opcoes`
  // e chama o Bling tem que repassar o `fundo`. Foi assim que achei
  // `buscarNFnoBlingPorNumero` e `buscarPedidoBlingPorNumeroLoja`, que
  // nenhum apontamento tinha citado: eu vinha consertando uma funcao por
  // rodada, e a cadeia tem 5 niveis.
  {
    const linhasB = BLING.split('\n');
    const orfas = [];
    linhasB.forEach((linha, i) => {
      const m = /^async function (\w+)\(.*opcoes = \{\}/.exec(linha);
      if (!m) return;
      let fim = linhasB.length;
      for (let k = i + 1; k < linhasB.length; k++) {
        if (/^(async )?function |^module\.exports/.test(linhasB[k])) { fim = k; break; }
      }
      for (let k = i; k < fim; k++) {
        const l = linhasB[k];
        if (/await (chamarBling|buscarNFePorId)\(/.test(l) && !/fundo/.test(l) && !/semRitmo/.test(l)) {
          orfas.push(m[1] + ':' + (k + 1));
        }
      }
    });
    ok(orfas.length === 0,
       'TODA funcao do bling.js que aceita `opcoes` repassa o `fundo`'
       + (orfas.length ? ' (ORFAS: ' + orfas.join(', ') + ')' : ''));
  }

  // o portao le a opcao
  ok(/aguardarVez\(\{ fundo: !!opcoes\.fundo \}\)/.test(BLING),
     'chamarBling entrega a opcao ao portao');
  ok((BLING.match(/aguardarVez\(\{ fundo/g) || []).length >= 2,
     '  na entrada E na retentativa do 429');

  // indice de nomes
  // b272: o preAquecer passou a aceitar opcoes (`{ fundo: true, ...opcoes }`)
  // pro boot poder fazer um passe curto de 3 paginas. O que importa e o
  // `fundo: true` continuar la, nao o formato exato do objeto.
  ok(/construirIndice\(\{ fundo: true[,}]/.test(NOMES),
     'o pre-aquecimento do boot se declara FUNDO (ninguem espera por ele)');
  ok(/const deFundo = opts\.fundo !== undefined \? !!opts\.fundo : !!IDX\.ts/.test(NOMES),
     'e a construcao sob demanda so e fundo se ja houver indice velho pra servir');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
}

// ── b253.1 (Codex, P1): ESPAÇAMENTO, não contagem ────────────────────
//
// ⚠️ `liberadas.length < 2.5` deixa passar 3 chamadas NA HORA (0, 1 e 2
// são todos < 2.5). Eu escrevi no commit "400 ms entre chamadas" e
// entreguei RAJADA DE 3 — o fallback nunca teve o freio prometido.
//
// O espaçamento é o que a conta sente: 3 chamadas juntas estouram o limite
// do Bling no instante, mesmo que a média do segundo feche.
(async () => {
  const ritmo = require('../lib/ritmo-bling.js');
  const marcas = [];
  await Promise.all(Array.from({ length: 5 }, () =>
    ritmo.comRitmo(async () => marcas.push(Date.now()))));
  marcas.sort((a, b) => a - b);

  const intervalos = marcas.slice(1).map((t, i) => t - marcas[i]);
  const menor = Math.min(...intervalos);
  const esperado = Math.round(1000 / ritmo.LIMITE_POR_SEGUNDO);

  const bom = menor >= esperado - 20;
  console.log((bom ? 'ok  ' : 'FALHA ')
    + 'as chamadas sao ESPACADAS de verdade (menor intervalo: ' + menor
    + 'ms, esperado ~' + esperado + 'ms)');
  if (!bom) process.exitCode = 1;
})();
