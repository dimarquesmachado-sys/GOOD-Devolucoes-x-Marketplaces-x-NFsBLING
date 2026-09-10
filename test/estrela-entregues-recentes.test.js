// Roda com: node test/estrela-entregues-recentes.test.js
//
// ⚠️ O CASO REAL: o dono buscou "charles", achou 5 NFs, e o card do Charles
// Alexandre veio SEM ESTRELA — mesmo com a devolução dele a caminho.
//
// A CAUSA, achada com o /health: a espreita tinha 40 devoluções com NF, e o
// índice estava completo. A matéria-prima existia. Mas a devolução dele foi
// ENTREGUE ONTEM, e o cruzamento só olhava `em_transito` e `nunca_bipadas`.
//
// ⚠️ E `nunca_bipadas` JÁ É a lista de entregues — com PISO DE 5 DIAS. O
// piso existe por bom motivo (recém-entregue pode estar só na fila de
// recebimento, e alertar seria falso alarme), mas ele serve ao ALERTA, não
// à BUSCA: a caixa entregue ontem é exatamente a que o estoquista tem na
// mão agora.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const codigo = srv.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── ⚠️ o campo existe no PRODUTOR ───────────────────────────────────
//
// Minha primeira tentativa consumia `cacheEsp.entregues`, que NÃO EXISTE —
// o teste `campo-tem-produtor` acusou. É a Regra 4.12 (ler o produtor antes
// de escrever o consumidor), e foi a segunda vez que ela me pegou hoje.
{
  ok(/entregues_recentes: entreguesRecentes/.test(codigo),
     'o cache EXPÕE `entregues_recentes` (o produtor existe)');
  ok(/let entreguesRecentes = \[\]/.test(codigo),
     '  declarada FORA do try (o `baseAlerta` nao alcanca o retorno)');
  ok(/entreguesRecentes = \(baseAlerta \|\| \[\]\)/.test(codigo),
     '  e preenchida DENTRO, onde o baseAlerta existe');
}

// ── ⚠️ e o piso de 5 dias não é mexido ──────────────────────────────
//
// O alerta continua igual. A lista nova é separada, mesma origem, sem o
// piso — em vez de afrouxar o alerta e criar falso alarme.
{
  ok(/d\.dias_desde >= 5/.test(codigo),
     '⚠️ o PISO do alerta continua em 5 dias (nao afrouxei o alerta)');
  ok(/d\.dias_desde < 5/.test(codigo),
     '  e a lista nova pega justamente quem esta ABAIXO dele');
}

// ── e o cruzamento consome ──────────────────────────────────────────
{
  const i = codigo.indexOf('const espreita = []');
  const bloco = codigo.slice(i, i + 600);
  ok(/cacheEsp\.entregues_recentes/.test(bloco),
     'o cruzamento da busca por nome inclui as entregues recentes');
  ok(/\.filter\(\(e\) => !e\.baixado\)/.test(bloco),
     '  ⚠️ e o filtro `!baixado` continua — o que ja foi bipado sai');
}

// ── e o /health mostra ──────────────────────────────────────────────
{
  ok(/entregues_recentes: cont\('entregues_recentes'\)/.test(codigo),
     'o /health mostra a contagem (pra diagnosticar sem ler codigo)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
