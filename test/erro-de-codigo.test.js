// Roda com: node test/erro-de-codigo.test.js
//
// A HISTORIA: tres bugs identicos passaram despercebidos neste repo, e os
// tres pelo mesmo motivo — um try/catch em volta transformava
// ReferenceError em "erro da integracao".
//
//   1. `buscarNFnoBlingPorOrderId` na AMB, que nunca existiu no modulo
//   2. `buscarPedidoBlingPorId` na AMB, idem
//   3. `magaluCancelados` na GOOD, nunca importado
//
// O terceiro so foi achado porque o dono abriu a rota crua e mandou o JSON.
// Ate ali a tela dizia "falha do Magalu" e o Magalu simplesmente NAO
// aparecia no card da GOOD.

const fs = require('fs');
const path = require('path');
const E = require('../lib/erro-de-codigo');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// ── separa bug de falha ─────────────────────────────────────────────
{
  ok(E.ehBugNosso(new ReferenceError('magaluCancelados is not defined')) === true,
     'o erro REAL que escondeu o Magalu e reconhecido como bug nosso');
  ok(E.ehBugNosso(new TypeError('x.buscar is not a function')) === true,
     'funcao inexistente tambem');
  ok(E.ehBugNosso(new Error('TOO_MANY_REQUESTS')) === false,
     'limite do Bling NAO e bug nosso — e falha legitima da integracao');
  ok(E.ehBugNosso(new Error('timeout')) === false, 'lentidao do marketplace tambem nao');
  ok(E.ehBugNosso(null) === false, 'e nada nao quebra');

  // erro que veio serializado de outro processo perde o `name`
  ok(E.ehBugNosso({ message: 'foo is not defined' }) === true,
     'erro serializado (sem `name`) ainda e reconhecido pelo texto');
}

// ── a mensagem diz o que fazer ──────────────────────────────────────
{
  const m = E.paraTela(new ReferenceError('magaluCancelados is not defined'), 'magalu');
  ok(/ERRO NO NOSSO CODIGO/.test(m), 'a mensagem de bug se identifica como tal');
  ok(/Esperar nao resolve/.test(m),
     '  e diz o que fazer: esperar nao adianta, precisa de correcao');
  ok(E.paraTela(new Error('TOO_MANY_REQUESTS')) === 'TOO_MANY_REQUESTS',
     'falha de integracao passa limpa, sem alarme falso');
}

// ── e esta ligado onde os tres bugs se esconderam ───────────────────
{
  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/erroCodigo\.paraTela\(e, 'magalu'\)/.test(src),
       nome + ': o catch do Magalu marca bug nosso (foi ali que escondeu)');
    ok(/erroCodigo\.registrar\(e, 'sem-retorno'\)/.test(src),
       nome + ': e o catch final da rota tambem');
  }

  for (const [nome, rel] of [
    ['GOOD', 'public/painel-devolucoes.html'],
    ['AMB (servido)', 'amb-devolucoes/public-AMB/painel-AMB.html'],
    ['AMB (direto)', 'amb-devolucoes/public-AMB/painel2-AMB.html'],
  ]) {
    const html = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/BUG NO SISTEMA — recarregar não resolve/.test(html),
       nome + ': a TELA distingue bug de falha do marketplace');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
