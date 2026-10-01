'use strict';
// ⚠️ TRIAGEM SEM ORIGEM (pedido/rastreio/NF) NÃO APROVA — nas 3 empresas.
//
// 30/09, Girassol: o estoquista bipou o código de barras do PRODUTO em vez do
// rastreio. Nasceram 3 cards só com SKU e quantidade — sem NF, sem cliente,
// sem pedido. O dono viu no painel e não tinha como emitir a devolução.
// "Aprovado" quer dizer "confere com a NF"; sem NF não há o que conferir.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const { conferirOrigem, CAMPOS_ORIGEM } = require('../lib/triagem-tem-origem');

// ── a função ────────────────────────────────────────────────────────
ok(conferirOrigem({ produto_sku: '10-AE-8f-g80-180mm', produto_qtd: 5 }).ok === false,
   '⚠️ so produto e quantidade (o caso real): RECUSA');
for (const k of CAMPOS_ORIGEM) {
  ok(conferirOrigem({ [k]: 'x' }).ok === true, `  com ${k}: passa`);
}
ok(conferirOrigem({ nf_numero: '-' }).ok === false, '  nf_numero "-" (como o painel mostra vazio): RECUSA');
ok(conferirOrigem({ nf_numero: '  ' }).ok === false, '  nf_numero em branco: RECUSA');
ok(conferirOrigem(null).ok === false, '  payload nulo: RECUSA (nao lanca)');
const r = conferirOrigem({});
ok(r.status === 422 && /CODIGO DE BARRAS DO PRODUTO/.test(r.erro) && /RASTREIO/.test(r.erro),
   '⚠️ a mensagem ENSINA: nomeia o erro provavel e o que bipar');
ok(/PROBLEMA/.test(r.erro), '  e da a saida pra pacote sem etiqueta (registrar como PROBLEMA)');

// ── e as 3 empresas usam ────────────────────────────────────────────
const amb = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js'), 'utf8');
const good = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const semCom = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const iAmb = semCom(amb).indexOf("router.post('/api/triagem/aprovar'");
const blocoAmb = semCom(amb).slice(iAmb, iAmb + 900);
ok(/triagem-tem-origem/.test(blocoAmb) && /sem_origem: true/.test(blocoAmb),
   '⚠️ a rota de aprovar da AMB/Girassol usa a trava');
ok(blocoAmb.indexOf('conferirOrigem') < blocoAmb.indexOf('registrarTriagem'),
   '  e ANTES de gravar (nao depois)');
const iGood = semCom(good).indexOf("app.post('/api/triagem/aprovar'");
const blocoGood = semCom(good).slice(iGood, iGood + 1200);
ok(/triagem-tem-origem/.test(blocoGood) && /sem_origem: true/.test(blocoGood),
   '⚠️ a rota de aprovar da GOOD usa a trava (portar tudo, sempre)');

// ── e o front mostra de um jeito que fica na tela ───────────────────
const front = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'triagem.js'), 'utf8');
ok(/r\.status === 422 && d\.sem_origem/.test(front) && /alert\('⚠️ NAO DA PRA APROVAR/.test(front),
   '  e o front (compartilhado pelas 3) mostra em alert, nao em toast que some');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
