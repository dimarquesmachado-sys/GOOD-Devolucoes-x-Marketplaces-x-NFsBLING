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

// b220.2 (Codex): as funcoes DE PRODUCAO, nao copias.
//
// Meu teste anterior reimplementava a logica aqui — passaria verde mesmo
// se a rota quebrasse, que e o oposto do que um teste serve. Agora a rota
// exporta as duas e o teste exercita elas.
const { vereditoDaSonda: veredito, sondaFalhouPorAcaso: passageiro } =
  require('../lib/rotas-debug.js');

// ── o veredito de cada sonda ────────────────────────────────────────
{
  // b220.3: agora exige saber a base — uma linha so nao prova filtro se a
  // consulta sem filtro tambem devolvesse uma
  ok(veredito({ httpOk: true, lista: 1, bateu: true, totalDaConta: 40 }) === 'FUNCIONA',
     'uma linha, ela e a certa, e a base tem 40 -> FUNCIONA');
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

  // b220.2: uma linha so nao PROVA que filtrou
  ok(veredito({ httpOk: true, lista: 1, bateu: true, totalDaConta: 40 }) === 'FUNCIONA',
     'conta cheia e veio 1: o filtro funcionou mesmo');
  ok(veredito({ httpOk: true, lista: 1, bateu: true, totalDaConta: 1 }).startsWith('PROVAVEL'),
     'se a consulta BASE tambem devolve 1, nao da pra afirmar — vira PROVAVEL');
  ok(veredito({ httpOk: true, lista: 1, bateu: true }).startsWith('PROVAVEL'),
     'e base AUSENTE tambem e duvida — nao sei se a base devolveria 1 tambem');

  // b220.3: PROVAVEL nao e sucesso, mas tambem NAO e recusa
  const SRC_ROTA = fs.readFileSync(path.join(RAIZ, 'lib', 'rotas-debug.js'), 'utf8');
  ok(/const provaveis = deChave\.filter/.test(SRC_ROTA),
     'a conclusao separa os PROVAVEL dos demais');
  ok(/achou a nota, mas nao da pra \'\s*\n?\s*\+ \'provar que foi o filtro/.test(SRC_ROTA)
     || /nao da pra /.test(SRC_ROTA),
     '  e nao diz "NAO da pra filtrar" tendo uma sonda que achou a nota');
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
  ok(/module\.exports\.vereditoDaSonda/.test(SRC),
     'e exportada — este teste usa a DE PRODUCAO, nao uma copia');
  ok(/const restante = \(\) => TETO_MS - \(Date\.now\(\) - INICIO\)/.test(SRC),
     'o prazo restante nao tem piso: passar do teto anunciado seria mentira');
  ok(/base_sem_filtro:/.test(SRC),
     'a resposta diz quantas notas a consulta SEM filtro devolve');
  ok(/veredito: 'erro \(resposta sem lista\)'/.test(SRC),
     '200 com corpo estranho vira ERRO, nao "vazio" — vazio seria uma conclusao');
  ok(passageiro({ veredito: 'erro (resposta sem lista)' }) === true,
     '  e entra como inconclusivo, nao como recusa');

  // b220.5: a base tem que COMBINAR com a sonda (com ou sem tipo=1)
  ok(/const base = \{\};/.test(SRC) && /\['semTipo', ''\], \['comTipo', '&tipo=1'\]/.test(SRC),
     'ha DUAS bases: com e sem tipo=1, porque as sondas diferem nisso');
  ok(/totalDaConta: f\.url\.includes\('tipo=1'\) \? base\.comTipo : base\.semTipo/.test(SRC),
     '  e cada sonda compara com a base que combina com ela');
  ok(/typeof det\.data\.data === 'object'/.test(SRC),
     'detalhe com 200 mas sem corpo usavel conta como FALHA, nao como "ignorou"');
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
