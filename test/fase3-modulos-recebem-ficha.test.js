// Roda com: node test/fase3-modulos-recebem-ficha.test.js
//
// FASE 3 do docs/PLUGAR-EMPRESA-NOVA.md: os módulos passam a RECEBER a
// empresa em vez de importar o config de uma delas.
//
// Enquanto um módulo faz `require('../config-AMB')`, ele só serve pra UMA
// empresa — e plugar a próxima exige copiar a pasta (2.996 linhas só no
// app-AMB, 170 menções literais a "AMB").
//
// São 6 módulos, ~5.600 linhas. Um PR por passo, e este teste acompanha:
// cada módulo que vira fábrica entra na lista.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// os que JÁ viraram fábrica — cresce a cada passo da Fase 3
const PRONTOS = [
  ['supabase-AMB', 'amb-devolucoes/lib-AMB/supabase-AMB.js'],
  // b246 — passo 2: estes DOIS guardam estado mutavel (tokens, cache de
  // depositos/naturezas, renovacao em voo). Com duas empresas no mesmo
  // modulo, uma usaria o token da outra — pior que o bug que a Fase 3 veio
  // evitar. A fabrica move esse estado pra dentro de cada instancia.
  ['bling-AMB', 'amb-devolucoes/lib-AMB/bling-AMB.js'],
  ['ml-AMB', 'amb-devolucoes/lib-AMB/ml-AMB.js'],
  // b248 — passo 3: o estado aqui e de CONTROLE (`construindo`,
  // `ENTREGA_RODANDO`, `NFV_RODANDO`). Compartilhado, uma empresa
  // BLOQUEARIA a construcao do indice da outra — a segunda veria a trava
  // ligada e desistiria, ficando com indice vazio pra sempre.
  ['ml-returns-AMB', 'amb-devolucoes/lib-AMB/ml-returns-AMB.js'],
  ['nf-nomes-AMB', 'amb-devolucoes/lib-AMB/nf-nomes-AMB.js'],
];

for (const [nome, rel] of PRONTOS) {
  const mod = require(path.join(RAIZ, rel));

  ok(typeof mod.criar === 'function',
     nome + ': expoe a fabrica em `.criar`');

  // ⚠️ o export padrão continua sendo o objeto pronto da AMB — é o que
  // permite fazer um módulo por PR sem mexer no app-AMB junto
  ok(typeof mod === 'object' && Object.keys(mod).length > 5,
     '  e o export padrao continua sendo o objeto pronto (compatibilidade)');
}

// ── b247 (Codex, P2 no #173): a fábrica aceita a FICHA REAL ─────────
//
// ⚠️ O APONTAMENTO ACHOU UM BURACO QUE ESTE TESTE ESCONDIA. Eu montava à
// mão um objeto no formato do `config-AMB` e passava pra fábrica — então o
// teste passava, mas o caminho documentado da Fase 3 quebrava:
//
//   criarDb(obterEmpresa('ambtotal'))  →  TypeError: ... reading 'tabelas'
//
// A ficha do registro e o config são coisas DIFERENTES: o registro diz QUEM
// é a empresa (chave, prefixo, tabelas), o config diz COM O QUE ela se
// conecta (url, token, client_id). Faltava a ponte.
//
// `lib/config-da-empresa.js` é essa ponte, e agora o teste usa o caminho
// REAL — nada de cenário fabricado por mim.
{
  const { configDaEmpresa } = require('../lib/config-da-empresa');
  const db = require(path.join(RAIZ, 'amb-devolucoes/lib-AMB/supabase-AMB.js'));

  for (const chave of ['ambtotal', 'good']) {
    let inst = null; let erro = null;
    try { inst = db.criar(configDaEmpresa(chave)); } catch (e) { erro = e; }
    ok(!erro, 'criar(configDaEmpresa(\'' + chave + '\')) monta sem erro'
       + (erro ? ' — ' + erro.message.slice(0, 60) : ''));
    if (inst) {
      ok(!!inst.tabelas && !!inst.tabelas.devolucoes,
         '  e a instancia sabe as tabelas dela (' + (inst.tabelas || {}).devolucoes + ')');
    }
  }

  // e o adaptador tem que devolver o MESMO que o config-AMB devolve hoje —
  // senao a Fase 4 mudaria comportamento sem ninguem notar
  const real = require('../amb-devolucoes/config-AMB.js');
  const pontes = configDaEmpresa('ambtotal');
  for (const campo of ['bling.chaveAccess', 'ml.janelaDias', 'supabase.tabelas.devolucoes']) {
    const ler = (o) => campo.split('.').reduce((x, k) => (x || {})[k], o);
    ok(JSON.stringify(ler(real)) === JSON.stringify(ler(pontes)),
       '  adaptador == config-AMB em `' + campo + '` (' + JSON.stringify(ler(pontes)) + ')');
  }
}

// ── a fábrica produz instâncias INDEPENDENTES ───────────────────────
//
// É o ponto todo da Fase 3: montar com outra ficha não pode contaminar a
// que já está rodando. Se compartilhassem estado, a Girassol leria as
// tabelas da AMB — e ninguém notaria até o dado sair errado na tela.
{
  const db = require(path.join(RAIZ, 'amb-devolucoes/lib-AMB/supabase-AMB.js'));
  const tabelaAmbAntes = db.tabelas.devolucoes;

  const outra = db.criar({
    supabase: { url: 'https://x.supabase.co', key: 'k',
                tabelas: { devolucoes: 'devolucoes_teste' } },
  });

  ok(outra.tabelas.devolucoes === 'devolucoes_teste',
     'a fabrica monta com a ficha que recebe');
  ok(db.tabelas.devolucoes === tabelaAmbAntes,
     '  e NAO contamina a instancia da AMB (' + tabelaAmbAntes + ')');
  ok(outra.tabelas.devolucoes !== db.tabelas.devolucoes,
     '  as duas instancias sao independentes');
}

// ── quem ainda falta (o teste conta, pra frente não se perder) ───────
{
  const faltam = [];
  for (const f of fs.readdirSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB'))) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', f), 'utf8');
    if (/require\('\.\.\/config-AMB'\)/.test(src) && !PRONTOS.some(([, r]) => r.endsWith(f))) {
      faltam.push(f);
    }
  }
  console.log('');
  console.log('    (Fase 3 — ainda importam o config direto: '
    + (faltam.length ? faltam.join(', ') : 'nenhum, fase completa') + ')');
}

// ── b246: a empresa NAO pode estar no literal ───────────────────────
//
//  fixo faria duas instancias competirem pelo MESMO
// carimbo de renovacao de token: uma renova, a outra acha que ja renovou —
// e o token da segunda morre no proximo restart.
{
  for (const arq of ['bling-AMB.js', 'ml-AMB.js']) {
    const src = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', arq), 'utf8');
    ok(/empresa: cfg\.CHAVE_REGISTRO/.test(src),
       arq + ': a empresa da renovacao sai da FICHA, nao do literal');
    ok(/\(cfg\.PREFIXO_ENV \|\| 'AMB_'\)/.test(src),
       '  e o prefixo das env vars tambem');
  }
}

// ── b249, passo 4: o app monta COM A FICHA ──────────────────────────
//
// É o objetivo da Fase 3 inteira. Se o app-AMB volta a pegar os módulos
// prontos (`require(...)` sem `.criar`), o config da AMB volta a ficar
// embutido e a Girassol precisaria de pasta própria de novo.
{
  const app = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');

  ok(/configDaEmpresa\('ambtotal'\)/.test(app),
     'app-AMB monta a partir da FICHA do registro');

  for (const mod of ['bling-AMB', 'ml-AMB', 'ml-returns-AMB', 'nf-nomes-AMB', 'supabase-AMB']) {
    const re = new RegExp("require\\('\\./lib-AMB/" + mod + "'\\)\\.criar\\(CFG_EMPRESA\\)");
    ok(re.test(app), '  ' + mod + ' montado com a ficha');
  }

  // ⚠️ e nenhum deles pode voltar a ser importado pronto
  for (const mod of ['bling-AMB', 'ml-AMB', 'supabase-AMB']) {
    const cru = new RegExp("require\\('\\./lib-AMB/" + mod + "'\\);");
    ok(!cru.test(app), '  e ' + mod + ' NAO e importado pronto (sem .criar)');
  }
}

// ── e a prova final: outra empresa monta sem pasta propria ──────────
{
  const { configDaEmpresa } = require('../lib/config-da-empresa');
  const mods = ['supabase-AMB', 'bling-AMB', 'ml-AMB', 'ml-returns-AMB', 'nf-nomes-AMB'];
  let erro = null;
  try {
    const cfg = configDaEmpresa('good');   // outra empresa, mesma lib
    for (const m of mods) require(path.join(RAIZ, 'amb-devolucoes/lib-AMB', m + '.js')).criar(cfg);
  } catch (e) { erro = e; }
  ok(!erro, 'os 5 modulos montam para OUTRA empresa, sem pasta nova'
     + (erro ? ' — ' + erro.message.slice(0, 60) : ''));
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
