'use strict';
// ⚠️ A FICHA DA GIRASSOL EXISTE, MAS A EMPRESA NÃO MONTA.
//
// Enquanto ela estava COMENTADA, o prefixo aqui divergia do contrato
// (`GIRA_` × `GIRASSOL_`) e ninguém via — comentário não é testado. No dia
// de plugar, o código procuraria `GIRA_BLING_CLIENT_ID` e o Render teria
// `GIRASSOL_BLING_CLIENT_ID`: a empresa não acharia credencial nenhuma, e o
// erro ("token ausente") não diria que o problema é o NOME.
//
// 📌 Escrita, ela entra nos testes — e a divergência aparece HOJE.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const { obterEmpresa, empresasAtivasNoDevolucoes, conferirEmpresa } = require('../lib/empresas');
const contrato = JSON.parse(
  fs.readFileSync(path.join(RAIZ, 'contrato-empresas.json'), 'utf8'));

// ── a ficha existe e bate com o contrato ────────────────────────────
{
  const g = obterEmpresa('girassol');
  ok(!!g, 'a ficha da Girassol existe no registro');

  const doContrato = (contrato.empresas || {}).girassol || {};
  ok(g.prefixoEnv === doContrato.prefixo_env,
     `⚠️ o prefixo bate com o contrato (${g.prefixoEnv} x ${doContrato.prefixo_env})`);
  ok(g.chaveDados === 'girassol', '  e declara a chave de dados');
  ok(g.tabelas && g.tabelas.devolucoes === 'devolucoes_girassol',
     '  e as tabelas tem o sufixo dela');
}

// ── ⚠️ mas ela NÃO monta: quem decide é o contrato ──────────────────
{
  const ativas = empresasAtivasNoDevolucoes().map((e) => e.chave);
  ok(!ativas.includes('girassol'),
     '⚠️ a Girassol NAO monta (o contrato diz `ativa_em.devolucoes: false`)');
  ok(ativas.includes('ambtotal'), '  e a AMB continua montando');

  const ativaNoContrato = ((contrato.empresas || {}).girassol || {}).ativa_em || {};
  ok(ativaNoContrato.devolucoes !== true,
     '  ⚠️ e o contrato confirma: ela nao esta ativa aqui');
}

// ── e o verificador DIZ o que falta, antes de alguém tentar ─────────
//
// ⚠️ O deploy da AMB falhou 3× por falta de `AMB_SESSION_SECRET` — o auth
// passou a exigi-lo em produção e ninguém criou a env. O `conferirEmpresa`
// não pedia essa env, então dizia "só faltam credenciais" enquanto o boot
// morria. Agora ela entra na conta.
{
  const r = conferirEmpresa('girassol');
  ok(r.pronta === false, '⚠️ `conferirEmpresa` diz que NAO esta pronta');
  ok(Array.isArray(r.envsFaltando) && r.envsFaltando.length > 0,
     `  e LISTA o que falta (${(r.envsFaltando || []).length} envs)`);
  ok((r.envsFaltando || []).some((e) => /SESSION_SECRET/.test(e)),
     '⚠️ inclusive o SESSION_SECRET, que DERRUBA o boot em producao');
  ok((r.fiscalSemValor || []).length > 0,
     `  e os campos fiscais sem valor (${(r.fiscalSemValor || []).length})`);
}

// ── ⚠️ e o fiscal dela NÃO tem padrão cravado ───────────────────────
//
// Os ids da AMB têm padrão porque são os que rodam hoje. Inventar um para a
// Girassol emitiria NF com número errado — e número errado é pior que
// número ausente.
{
  const src = fs.readFileSync(path.join(RAIZ, 'lib', 'empresas.js'), 'utf8');
  const i = src.indexOf('girassol: {');
  const bloco = src.slice(i, src.indexOf('\n  },', i));
  ok(!/ID_EMPRESA_CONTROL',\s*'\d/.test(bloco),
     '⚠️ nenhum id fiscal cravado na ficha da Girassol');
  ok(/'ID_EMPRESA_CONTROL',\s*''\)/.test(bloco),
     '  os padroes sao vazios (ela declara os dela, ou nao tem)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
