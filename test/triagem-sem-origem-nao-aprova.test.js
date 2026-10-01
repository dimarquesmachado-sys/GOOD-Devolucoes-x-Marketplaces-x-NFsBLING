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

// ⚠️ b461 (Codex, P1): a lista e a UNIAO do que cada rota ja aceitava. A GOOD
// validava shipment_id || nf_chave || magalu_protocolo, e a trava rodava
// ANTES sem os dois ultimos: bipe por chave DANFE ou protocolo Magalu era
// recusado. Ficou 1 dia no ar.
ok(conferirOrigem({ nf_chave: '35260827548456000147550010001252171293866102' }).ok === true,
   '⚠️ chave DANFE (nf_chave) e origem valida');
ok(conferirOrigem({ magalu_protocolo: 'MGL-1' }).ok === true,
   '⚠️ protocolo Magalu (magalu_protocolo) e origem valida');
{
  // a trava nunca pode ser mais estreita que a validacao original da GOOD
  const good = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const m = good.match(/if \(!dados\.shipment_id && !dados\.nf_chave && !dados\.magalu_protocolo\)/);
  ok(!!m && ['shipment_id', 'nf_chave', 'magalu_protocolo'].every((k) => CAMPOS_ORIGEM.includes(k)),
     '  e TODO identificador que a validacao original da GOOD aceita esta na lista');
}

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

// b461 (Codex, P2): o "Consertei" da AMB grava aprovado pelo mesmo caminho
const iCons = semCom(amb).indexOf("router.post('/api/triagem/consertado'");
const blocoCons = semCom(amb).slice(iCons, iCons + 1800);
ok(/triagem-tem-origem/.test(blocoCons) && blocoCons.indexOf('conferirOrigem') < blocoCons.indexOf('registrarTriagem'),
   '⚠️ a rota /api/triagem/consertado da AMB/Girassol tambem tem a trava, antes de gravar');

// ── e o front mostra de um jeito que fica na tela ───────────────────
const front = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'triagem.js'), 'utf8');
ok(/r\.status === 422 && d\.sem_origem/.test(front) && /alert\('⚠️ NAO DA PRA APROVAR/.test(front),
   '  e o front (compartilhado pelas 3) mostra em alert, nao em toast que some');
// b461 (Codex, P2 x3): o ramo 422 restaura o botao, devolve o foco ao campo de
// bipagem, e existe TAMBEM na parcial (que posta no mesmo endpoint)
const ramos = front.split('r.status === 422 && d.sem_origem').length - 1;
ok(ramos === 2, `  o ramo 422 existe nas 2 funcoes que postam em /aprovar (achei ${ramos})`);
{
  const iA = front.indexOf('async function confirmarAprovar()');
  const bA = front.slice(front.indexOf('r.status === 422 && d.sem_origem', iA), front.indexOf('r.status === 409', iA));
  ok(/btn\.disabled = false/.test(bA) && /btn\.innerHTML = '✅ Confirmar'/.test(bA),
     '  confirmarAprovar: restaura o botao (nao fica "Salvando..." travado)');
  ok(/inputCodigo\.focus\(\)/.test(bA), '  confirmarAprovar: devolve o foco ao campo de bipagem');
  const iP = front.indexOf('async function encerrarParcial()');
  const bP = front.slice(front.indexOf('r.status === 422 && d.sem_origem', iP), front.indexOf('r.status === 409', iP));
  ok(/btn\.disabled = false/.test(bP) && /inputCodigo\.focus\(\)/.test(bP),
     '  encerrarParcial: idem (botao e foco)');
  // b462 (Codex): a parcial fecha o modal e restaura o rotulo; o Consertei
  // trata o 422 sem toast, fechando modalProblema e devolvendo o foco
  ok(/fecharModal\('modalConfirmacaoParcial'\)/.test(bP) && /btn\.innerHTML = '✅ Sim, Encerrar'/.test(bP),
     '  encerrarParcial: fecha a confirmacao e restaura "Sim, Encerrar"');
  const iC = front.indexOf("fetch('/api/triagem/consertado'");
  const bC = front.slice(iC, front.indexOf("toast('🔧 Consertado!", iC));
  ok(iC >= 0 && /rc\.status === 422 && dc\.sem_origem/.test(bC) && /fecharModal\('modalProblema'\)/.test(bC) &&
     /alert\('⚠️ NAO DA PRA APROVAR/.test(bC) && /inputCodigo\.focus\(\)/.test(bC),
     '  Consertei: 422 sem_origem fecha o modal, mostra alert e devolve o foco');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
