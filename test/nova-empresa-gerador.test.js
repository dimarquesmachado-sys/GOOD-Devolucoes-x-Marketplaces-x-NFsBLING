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
const { execFileSync } = require('child_process');

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

  // ⚠️ (Codex, PR #344, P1) — um sufixo que ja pertence a outra empresa nao
  // dava erro nenhum: a provisao e idempotente (so avisa "ja existe") e
  // `conferirEmpresa` nao confere colisao. A ficha gerada apontaria pras
  // MESMAS tabelas da empresa dona, e ativar leria/gravaria dado dela.
  const comSufixoDaAmb = gerar('novaempresa', 'Nova Empresa', 'amb');
  ok(!comSufixoDaAmb.ok, '  recusa sufixo que ja pertence a outra empresa (contrato: _amb)');
  const comSufixoReservadoNoSql = gerar('outraempresa', 'Outra Empresa', 'good');
  ok(!comSufixoReservadoNoSql.ok,
     '  recusa sufixo reservado pelo SQL mesmo sem estar em nenhum contrato (_good)');
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

  // ⚠️ (Codex, PR #344, P1) — o contrato gerado nao tinha `aliases` nem
  // `dono_hoje`, e usava `chave_dados` em vez de `sufixo_tabelas`. O teste de
  // contrato itera esses campos em TODA empresa do arquivo: sem eles, colar a
  // ficha derrubava `node verifica.js` com TypeError, nao com aviso.
  const contratoObj = JSON.parse(r.contrato).aurora;
  ok(Array.isArray(contratoObj.aliases) && contratoObj.aliases.includes('aurora'),
     '  o contrato declara `aliases`');
  ok(!!contratoObj.dono_hoje && !!contratoObj.dono_alvo,
     '  e `dono_hoje`/`dono_alvo`');
  ok(contratoObj.sufixo_tabelas === '_aurora' && contratoObj.chave_dados === undefined,
     '  com `sufixo_tabelas` (nao `chave_dados`)');
  // a eleicao do passo 2 exige bling/bling_nfe em `dono_alvo` de QUALQUER
  // empresa, independente de capacidade declarada (teste em
  // fontes-de-verdade.test.js) — sem isso o contrato validaria sozinho mas
  // quebraria junto com a eleicao ja registrada.
  ok(contratoObj.dono_alvo.bling === 'mover-pedidos' && contratoObj.dono_alvo.bling_nfe === 'mover-pedidos',
     '  e `dono_alvo` cobre bling/bling_nfe, exigidos pela eleicao do passo 2');
}

// ── ⚠️ (Codex, PR #344, P2) — nome com aspa nao pode quebrar a ficha ──
{
  const r = gerar('aurora', "D'Ávila Comércio");
  ok(r.ok, 'aceita nome com apostrofo');
  // o trecho `nome: ...` da ficha tem que ser um literal JS valido —
  // interpolado cru em aspas simples, `nome: 'D'Ávila...'` quebra a sintaxe
  // de quem colar em lib/empresas.js.
  const m = /nome: (.+),\n/.exec(r.ficha);
  ok(!!m, '  a ficha tem a linha do nome');
  if (m) {
    let valor;
    let lancou = false;
    try { valor = new Function(`"use strict"; return (${m[1]});`)(); }
    catch (err) { lancou = true; }
    ok(!lancou && valor === "D'Ávila Comércio",
       '  e o literal do nome e sintaxe JS valida, com o nome intacto');
  }
}

// ── ⚠️ (Codex, PR #344, P2) — a lista de envs tem que ter ADMIN_USER ──
{
  const r = gerar('aurora', 'Aurora Comercio');
  ok(r.envs.includes('AURORA_ADMIN_USER'),
     '⚠️ a lista de envs do Render inclui ADMIN_USER (sem ele, ninguem faz acao de admin)');
}

// ── ⚠️ e a prova mais forte: o teste de contrato inteiro aceita a ficha ──
//
// Reproduz exatamente o que o Codex apontou: colar a ficha gerada no
// contrato e rodar os testes que `node verifica.js` roda. Antes da correção
// isto quebrava com TypeError (aliases/dono_hoje ausentes).
{
  const contratoPath = path.join(RAIZ, 'contrato-empresas.json');
  const antesContrato = fs.readFileSync(contratoPath, 'utf8');
  const r = gerar('aurora', 'Aurora Comercio', 'aur');
  const contratoObj = JSON.parse(antesContrato);
  Object.assign(contratoObj.empresas, JSON.parse(r.contrato));

  const rodar = (arquivo) => {
    try {
      execFileSync(process.execPath, [path.join(RAIZ, 'test', arquivo)], { stdio: 'pipe' });
      return { ok: true };
    } catch (err) {
      return { ok: false, saida: String((err.stdout || '') + (err.stderr || '')) };
    }
  };

  try {
    fs.writeFileSync(contratoPath, JSON.stringify(contratoObj, null, 2));
    const c1 = rodar('contrato-empresas.test.js');
    ok(c1.ok, '⚠️ com a ficha colada, `test/contrato-empresas.test.js` passa'
       + (c1.ok ? '' : ('\n' + c1.saida.split('\n').filter((l) => /FALHA/.test(l)).join('\n'))));
    const c2 = rodar('fontes-de-verdade.test.js');
    ok(c2.ok, '  e `test/fontes-de-verdade.test.js` tambem passa'
       + (c2.ok ? '' : ('\n' + c2.saida.split('\n').filter((l) => /FALHA/.test(l)).join('\n'))));
  } finally {
    fs.writeFileSync(contratoPath, antesContrato);
  }
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
