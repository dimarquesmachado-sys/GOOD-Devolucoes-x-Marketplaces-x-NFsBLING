'use strict';
// ⚠️ O GERADOR DE FICHA PRECISA GERAR ALGO QUE O REGISTRO ACEITA.
//
// Uma auditoria perguntou se um CNPJ novo entra só por configuração. Não
// entra: a lista de empresas é código. Isso é escolha (ficha em código passa
// pelos testes de paridade), mas escrever à mão convida ao erro que já custou
// caro aqui — prefixo divergindo entre contrato e registro, sem ninguém ver
// até o dia de ligar.
//
// 📌 Este teste prova que o que o gerador escreve é aceito de verdade, em vez
// de "parecer certo".

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const { gerar } = require('../scripts/nova-empresa');

// ── recusa o que não pode virar empresa ─────────────────────────────
{
  ok(!gerar('', 'X').ok, '  recusa chave vazia');
  ok(!gerar('Aurora', 'X').ok, '  recusa maiuscula');
  ok(!gerar('a', 'X').ok, '  recusa chave curta demais');
  ok(!gerar('aurora', '').ok, '  recusa sem nome');
  ok(!gerar('aurora', 'X', 'SUF-INVALIDO').ok, '  recusa sufixo fora do formato');
}

// ── o que gera bate com o formato das que já rodam ──────────────────
{
  const r = gerar('aurora', 'Aurora Comercio');
  ok(r.ok, 'gera a ficha');
  ok(/chaveDados: 'aurora'/.test(r.ficha), '  com a chave de dados');
  ok(/devolucoes: 'devolucoes_aurora'/.test(r.ficha), '  e as 5 tabelas com sufixo');
  ok(/prefixoRota: '\/aurora'/.test(r.ficha), '  e a rota');

  // ⚠️ o fiscal NUNCA pode nascer com padrão
  ok(/'ID_EMPRESA_CONTROL', ''\)/.test(r.ficha),
     '⚠️ e os ids fiscais SEM padrao (numero errado e pior que ausente)');
  ok(!/\d{8,}/.test(r.ficha),
     '  nenhum id numerico inventado na ficha');

  // e o contrato nasce INATIVO
  ok(/"devolucoes": false/.test(r.contrato),
     '⚠️ o contrato nasce com a empresa INATIVA');
}

// ── ⚠️ e a prova que importa: colada, o registro ACEITA ─────────────
//
// Gerar texto bonito não serve de nada se o registro recusar. Este bloco cola
// a ficha num arquivo temporário e carrega o registro de verdade.
{
  const r = gerar('aurora', 'Aurora Comercio');
  const p = path.join(RAIZ, 'lib', 'empresas.js');
  const antes = fs.readFileSync(p, 'utf8');
  const i = antes.indexOf('    girassol: {');
  const fim = antes.indexOf('\n  },\n', i) + 6;
  const comNova = antes.slice(0, fim) + '\n' + r.ficha + '\n' + antes.slice(fim);

  try {
    fs.writeFileSync(p, comNova);
    delete require.cache[require.resolve('../lib/empresas')];
    const reg = require('../lib/empresas');
    const e = reg.obterEmpresa('aurora');
    ok(!!e, '⚠️ a ficha GERADA e aceita pelo registro');
    ok(e && e.tabelas.devolucoes === 'devolucoes_aurora', '  com as tabelas certas');

    const c = reg.conferirEmpresa('aurora');
    ok(c && c.pronta === false, '  e `conferirEmpresa` a reconhece (pronta: false)');
    ok(c && (c.fiscalSemValor || []).length === 3,
       '  apontando os 3 campos fiscais que faltam');

    ok(!reg.empresasAtivasNoDevolucoes().some((x) => x.chave === 'aurora'),
       '⚠️ e ela NAO monta — a ficha sozinha nao liga empresa');
  } finally {
    fs.writeFileSync(p, antes);
    delete require.cache[require.resolve('../lib/empresas')];
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
