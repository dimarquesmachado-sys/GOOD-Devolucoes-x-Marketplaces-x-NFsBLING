'use strict';
// b700 — A LISTA DE TABELAS TEM TRES FONTES, E ELAS TEM QUE CONCORDAR.
//
// ⚠️ O ERRO, DUAS VEZES:
//   - b426: a sonda montava a lista pela FICHA (5 tabelas) e o SQL criava 7 — conferia 5 de 7 e dizia ok;
//   - b651: as 2 do relatorio (`tags`, `devolucao_tags`) entraram no SQL e na ficha, e a lista canonica
//     (`TABELAS_ESPERADAS`) ficou nas 7 — a sonda e a conferencia depois do provisionamento nao olhavam por
//     elas. Empresa criada com a rotina antiga do banco passaria "ok" e o relatorio quebraria na 1a etiqueta.
// Apontamento que se repete vira teste: quem crescer uma fonte sem as outras fica vermelho AQUI.
//
//   1. `TABELAS_ESPERADAS` (lib/provisionar-empresa.js) — o que a sonda e o provisionador conferem;
//   2. `moldes` em sql/provisionar-empresa.sql — o que a rotina do banco CRIA pra empresa nova;
//   3. `tabelas` na ficha de cada empresa (lib/empresas.js) — o que o app usa por nome.
//
// Roda com: node test/tabelas-canonicas.test.js

const fs = require('fs');
const path = require('path');
const { entreMarcadores } = require('./_recorte');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const { TABELAS_ESPERADAS, sufixoDaFicha } = require('../lib/provisionar-empresa');
const { listarEmpresas } = require('../lib/empresas');
const igual = (a, b) => JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());

ok(new Set(TABELAS_ESPERADAS).size === TABELAS_ESPERADAS.length, '1 a lista canonica nao tem tabela repetida (' + TABELAS_ESPERADAS.length + ' tabelas)');

// ── 2. o SQL cria exatamente o que a lista confere ──
{
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'provisionar-empresa.sql'), 'utf8');
  const bloco = entreMarcadores(sql, 'moldes constant text[][] := array[', '];');
  const pares = [];
  for (const linha of bloco.split('\n')) {
    if (linha.trim().startsWith('--')) continue;
    const m = /\['([a-z_0-9]+)',\s*'([a-z_0-9]+)'\]/.exec(linha);
    if (m) pares.push([m[1], m[2]]);
  }
  ok(pares.length > 0, '2 li os moldes do SQL (' + pares.length + ' pares)');
  const bases = pares.map((p) => p[0]);
  ok(igual(bases, TABELAS_ESPERADAS),
     '⚠️ o SQL CRIA as mesmas tabelas que a lista CONFERE — so no SQL: [' + bases.filter((b) => !TABELAS_ESPERADAS.includes(b)).join(', ')
     + '] · so na lista: [' + TABELAS_ESPERADAS.filter((b) => !bases.includes(b)).join(', ') + ']');
  ok(pares.every(([base, molde]) => molde === base + '_amb'), '   e cada molde e a tabela da AMB (`<base>_amb`)');
}

// ── 3. toda tabela que uma FICHA declara esta na lista (com o sufixo daquela empresa) ──
{
  const fichas = listarEmpresas();
  ok(fichas.length >= 3, '3 as empresas do registro (' + fichas.map((e) => e.chave).join(', ') + ')');
  for (const e of fichas) {
    const s = sufixoDaFicha(e);
    const sufixo = s.ok ? s.sufixo : (s.semSufixo ? '' : null);
    ok(sufixo !== null, '   ' + e.chave + ': a ficha diz o sufixo das tabelas ("' + sufixo + '")');
    if (sufixo === null) continue;
    const conferidas = TABELAS_ESPERADAS.map((b) => b + sufixo);
    const daFicha = Object.values(e.tabelas || {});
    const fora = daFicha.filter((t) => !conferidas.includes(t));
    ok(daFicha.length > 0 && fora.length === 0,
       '⚠️ ' + e.chave + ': toda tabela da ficha e conferida pela sonda' + (fora.length ? ' — FORA: ' + fora.join(', ') : ' (' + daFicha.length + ' de ' + conferidas.length + ')'));
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
