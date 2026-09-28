'use strict';
// ⚠️ OS IDS FISCAIS SE DESCOBREM SOZINHOS — o que dá.
//
// O dono, ligando a Girassol: "descobre aí pegando direto do Bling, senão vai
// me atrapalhar. tem que ter isso automatizado pra qualquer empresa nova."
//
// Ele está certo: 2 dos 3 a API entrega. Fazer a pessoa caçar no F12 o que a
// máquina sabe é trabalho inventado.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const {
  escolherDepositoGeral, escolherNaturezaDevolucao,
  idEmpresaDoDeposito, descobrirIdsFiscais,
} = require('../lib/ids-fiscais-auto');

// ── o depósito ──────────────────────────────────────────────────────
{
  ok(escolherDepositoGeral([{ id: 9, descricao: 'Geral' }, { id: 8, descricao: 'Avarias' }]).id === '9',
     'acha o deposito pelo nome "Geral"');
  ok(escolherDepositoGeral([{ id: 7, descricao: 'Matriz' }]).id === '7',
     '  e quando so ha UM, ele e o geral');

  // ⚠️ ambiguidade NÃO escolhe — é a regra da casa
  const amb = escolherDepositoGeral([{ id: 9, descricao: 'Geral' }, { id: 8, descricao: 'GERAL' }]);
  ok(amb.id === null && amb.via === 'AMBIGUO',
     '⚠️ com 2 chamados "geral", RECUSA (nao pega o primeiro)');
  ok(Array.isArray(amb.candidatos) && amb.candidatos.length === 2,
     '  e lista os candidatos pra pessoa decidir');

  const nada = escolherDepositoGeral([{ id: 1, descricao: 'A' }, { id: 2, descricao: 'B' }]);
  ok(nada.id === null && /NAO ACHEI/.test(nada.via),
     '  e sem nenhum "geral", diz que nao achou');
}

// ── ⚠️ a natureza, e a armadilha da "devolução de compra" ───────────
//
// Ela existe na lista LOGO ANTES da certa (medido na AMB em 18/08). Um
// `.find()` por "devolução" pegaria ela — e emitir com a natureza de compra é
// nota errada com cara de certa.
{
  const lista = [
    { id: 1, descricao: 'Devolução de compra' },
    { id: 2, descricao: 'Devolução de Mercadoria - Entrada' },
    { id: 3, descricao: 'Venda de mercadoria' },
  ];
  const r = escolherNaturezaDevolucao(lista);
  ok(r.id === '2', '⚠️ acha a natureza de DEVOLUCAO DE MERCADORIA - ENTRADA');
  ok(r.id !== '1', '⚠️ e PULA a "Devolucao de compra" (a armadilha)');

  // e com acento/caixa diferentes
  ok(escolherNaturezaDevolucao([{ id: 5, descricao: 'DEVOLUCAO DE MERCADORIA ENTRADA' }]).id === '5',
     '  casando sem acento e sem caixa');

  const amb2 = escolherNaturezaDevolucao([
    { id: 1, descricao: 'Devolução de Mercadoria - Entrada' },
    { id: 2, descricao: 'Devolução de mercadoria entrada (2)' },
  ]);
  ok(amb2.id === null && amb2.via === 'AMBIGUO',
     '⚠️ e com 2 candidatas, RECUSA em vez de escolher');
}

// ── ⚠️ o idEmpresaControl: a API não dá, e o código diz isso ─────────
//
// `GET /empresas` responde 404 (medido 18/08). Ele vem de
// `depositos[].idEmpresa`, que a v3 não manda. A tentativa fica aqui para o
// dia em que passar a mandar — sem ninguém lembrar de voltar.
{
  ok(idEmpresaDoDeposito([{ id: 1, idEmpresa: '999' }, { id: 2, idEmpresa: '999' }]).id === '999',
     'pega o idEmpresa do deposito SE a API mandar');
  ok(idEmpresaDoDeposito([{ id: 1 }, { id: 2 }]).id === null,
     '⚠️ e quando nao vem (o caso de hoje), devolve null — nao inventa');
  ok(idEmpresaDoDeposito([{ idEmpresa: '1' }, { idEmpresa: '2' }]).via === 'AMBIGUO',
     '  e com 2 empresas diferentes, recusa');
}

// ── sem cliente do Bling, não quebra ────────────────────────────────
{
  return descobrirIdsFiscais('girassol', null).then((r) => {
    ok(r.ok === false && /sem cliente/.test(r.erro),
       '  sem cliente do Bling, responde erro claro (nao lanca)');

    // e com um cliente falso, monta a resposta inteira
    const fake = async (url) => ({
      ok: true,
      data: { data: /depositos/.test(url)
        ? [{ id: 77, descricao: 'Geral' }]
        : [{ id: 88, descricao: 'Devolução de Mercadoria - Entrada' }] },
    });
    return descobrirIdsFiscais('girassol-teste', fake).then((d) => {
      ok(d.ok && d.depositoGeral.id === '77', '⚠️ com o Bling respondendo, acha o deposito');
      ok(d.naturezasDevolucaoIds.id === '88', '  e a natureza');
      ok(d.idEmpresaControl.id === null, '  e admite que o idEmpresaControl nao veio');

      // ⚠️ a rota entrega com o NOME DA ENV, pra copiar e colar
      const app = fs.readFileSync(
        path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
      const semCom = app.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      ok(/ids-fiscais-auto/.test(semCom), '⚠️ existe a rota /api/ids-fiscais-auto');
      ok(/para_colar_no_render/.test(semCom),
         '  e ela responde com o NOME da env + valor (copiar e colar)');
      ok(/prefixoFiscal/.test(semCom),
         '⚠️ usando o prefixo FISCAL da empresa (nao o de credencial)');

      console.log('');
      console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
      process.exit(falhas ? 1 : 0);
    });
  });
}
