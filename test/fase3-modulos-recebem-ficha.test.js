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

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
