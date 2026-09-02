// Roda com: node test/testar-chave.test.js
//
// A ROTA `/api/debug/testar-chave` decide se vale reescrever a busca de NF
// inteira — trocar numero (ambiguo entre series) por chave (unica).
//
// Ela levou 6 rodadas de revisao do Codex, e cada correcao virou mais um
// ternario aninhado. Reescrevi com o veredito em funcao nomeada; este teste
// fixa as 6 licoes pra nao se perderem de novo:
//
//   1. lista pode OMITIR a chave -> conferir no detalhe da nota
//   2. varias linhas ja provam que o filtro foi ignorado (chave e unica)
//   3. o CONTROLE (busca por numero) pode ter varias linhas legitimamente
//   4. FUNCIONA do controle nao prova nada sobre chave
//   5. 4xx e recusa; 429/408/5xx sao passageiros
//   6. excecao tambem conta como sonda que falhou

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RAIZ, 'lib', 'rotas-debug.js'), 'utf8');

// as mesmas regras que vivem na rota
function veredito({ ehControle, httpOk, lista, bateu, detalheFalhou }) {
  if (!httpOk) return 'erro';
  if (ehControle) {
    if (bateu) return 'FUNCIONA';
    if (detalheFalhou) return 'erro (detalhe da NF falhou)';
    return lista ? 'achou outras, nao a certa' : 'vazio';
  }
  if (lista > 1) return 'ignorou o filtro (varias)';
  if (bateu) return 'FUNCIONA';
  if (detalheFalhou) return 'erro (detalhe da NF falhou)';
  return lista ? 'ignorou o filtro' : 'vazio';
}
function passageiro(x) {
  if (!String(x.veredito || '').startsWith('erro') && !x.erro) return false;
  const st = Number(x.status) || 0;
  if (st === 429 || st === 408) return true;
  return !(st >= 400 && st < 500);
}

// ── o veredito de cada sonda ────────────────────────────────────────
{
  ok(veredito({ httpOk: true, lista: 1, bateu: true }) === 'FUNCIONA',
     'uma linha e ela e a certa -> FUNCIONA');
  ok(veredito({ httpOk: true, lista: 5, bateu: true }).startsWith('ignorou'),
     'a nota veio, mas com outras 4: o filtro foi ignorado (veio por acaso)');
  ok(veredito({ httpOk: true, lista: 5, bateu: false }).startsWith('ignorou'),
     'cinco linhas e nenhuma certa: ignorou');
  ok(veredito({ httpOk: true, lista: 0, bateu: false }) === 'vazio',
     'nenhuma linha: vazio');
  ok(veredito({ httpOk: false }) === 'erro', 'sem resposta HTTP: erro');
  ok(veredito({ httpOk: true, lista: 1, bateu: false, detalheFalhou: true })
       .startsWith('erro'),
     'uma linha, sem chave na lista, e o detalhe falhou: erro, nao "ignorou"');

  // o CONTROLE tem regra propria
  ok(veredito({ ehControle: true, httpOk: true, lista: 5, bateu: true }) === 'FUNCIONA',
     'controle com 5 linhas e a certa entre elas: FUNCIONA (numero se repete)');
  ok(veredito({ ehControle: true, httpOk: true, lista: 3, bateu: false })
       === 'achou outras, nao a certa',
     'controle sem a nota: nao e "ignorou o filtro" — ele nem filtra por chave');
}

// ── o que e falha passageira ────────────────────────────────────────
{
  ok(passageiro({ veredito: 'erro', status: 400 }) === false,
     '400 = o parametro nao existe: e RESPOSTA, nao falha');
  ok(passageiro({ veredito: 'erro', status: 429 }) === true,
     '429 = fila do Bling: passageiro');
  ok(passageiro({ veredito: 'erro', status: 408 }) === true, '408 = timeout: passageiro');
  ok(passageiro({ veredito: 'erro', status: 500 }) === true, '500 = servidor: passageiro');
  ok(passageiro({ veredito: 'erro (excecao)' }) === true, 'excecao: passageiro');
  ok(passageiro({ veredito: 'FUNCIONA' }) === false, 'sucesso nao e falha');
}

// ── e a rota tem os tetos que faltavam ──────────────────────────────
{
  ok(/const TETO_MS = 20000/.test(SRC), 'ha teto de tempo (a rota nao pendura)');
  ok(/MAX_DETALHES_POR_SONDA = 2/.test(SRC),
     'e teto de detalhes por sonda — eram ate 24 chamadas ao Bling');
  ok(/veredito: 'erro \(nao deu tempo\)'/.test(SRC),
     'sonda que nao coube no teto se declara, em vez de sumir');
  ok(/function vereditoDaSonda/.test(SRC),
     'o veredito e funcao nomeada, nao ternario de 6 niveis');
  ok(/Array\.isArray\(r\.data\?\.data\)/.test(SRC),
     'e a lista so e usada se for array mesmo');
  ok(/levou_ms:/.test(SRC), 'a resposta diz quanto levou');

  // b220.1: o teto tem que CORTAR, nao so ser consultado antes
  ok(/Promise\.race\(\[\s*\n\s*chamarBling/.test(SRC),
     'o teto corta a chamada em andamento (chamarBling tem timeout de 30s e retenta)');
  ok(/Promise\.race\(\[\s*\n\s*buscarNFePorId/.test(SRC),
     '  e a busca de detalhe tambem');
  ok(/const valeODetalhe = f\.controle \|\| lista\.length === 1/.test(SRC),
     'e nao busca detalhe quando o veredito ja esta dado (varias linhas = ignorou)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
