'use strict';
// ⚠️ A SONDA CONFERE SE FUNCIONA, NÃO SE ESTÁ ESCRITO.
//
// O `conferirEmpresa` confere o que está escrito: as envs existem, os campos
// fiscais têm valor. Não confere se aquilo FUNCIONA — se o dono do token
// responde, se as tabelas existem no banco.
//
// 📌 A diferença importa no único momento que conta: `pronta: true` e a tela
// quebrando mesmo assim. Já aconteceu 2×: a rotina de tabelas era a antiga (de
// 5), e a pasta do checkout tinha outro nome.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const { sondar, CHECAGENS } = require('../scripts/sonda-empresa');

// ── a sonda cobre o que importa ─────────────────────────────────────
{
  const nomes = CHECAGENS.map((c) => c.nome).join(' | ');
  for (const esperado of ['ficha', 'token', 'dono', 'Supabase', 'desativada']) {
    ok(new RegExp(esperado, 'i').test(nomes), `  confere: ${esperado}`);
  }
}

// ── ⚠️ e é SÓ LEITURA ───────────────────────────────────────────────
//
// Uma sonda que emite, grava ou renova deixa de ser sonda. O refresh é de uso
// único: uma renovação "só pra testar" queimaria o token do dono.
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'sonda-empresa.js'), 'utf8');
  const semCom = src.split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

  ok(!/renovarToken|\/oauth\/token/.test(semCom),
     '⚠️ NAO renova token (queimaria o refresh de uso unico)');
  ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(semCom),
     '⚠️ NAO faz escrita em lugar nenhum');
  ok(/limit=0/.test(semCom),
     '⚠️ e pergunta pelas tabelas com `limit=0` (nao le dado de cliente)');
}

// ── ⚠️ as 7 tabelas, não as 5 da ficha ──────────────────────────────
//
// A ficha declara 5 — as que o app usa por nome. O ciclo de defeitos precisa
// de mais 2, que o SQL cria e a ficha não cita. Montar a lista pela ficha
// confere 5 de 7 e diz que está tudo certo.
{
  const { TABELAS_ESPERADAS } = require('../lib/provisionar-empresa');
  ok(TABELAS_ESPERADAS.length === 7, '⚠️ a lista canonica tem 7 tabelas');
  for (const t of ['defeito_comentarios', 'defeito_pedidos']) {
    ok(TABELAS_ESPERADAS.includes(t), `  inclusive \`${t}\` (fora da ficha)`);
  }

  const src2 = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'sonda-empresa.js'), 'utf8');
  const semC = src2.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(/TABELAS_ESPERADAS/.test(semC),
     '⚠️ e a sonda usa a lista canonica, nao `e.tabelas`');
  ok(!/Object\.values\(\(e && e\.tabelas\)/.test(semC),
     '  (a fonte com 5 saiu)');

  // ⚠️ e distingue "não existe" de "não consegui olhar"
  ok(/naoOlhei/.test(semC),
     '⚠️ separa tabela AUSENTE de falha de acesso (401/403/5xx)');
  ok(/r\.status === 404 \|\| r\.status === 400/.test(semC),
     '  so 404/400 contam como ausente');
}

// ── ⚠️ `bloqueado` reprova ──────────────────────────────────────────
//
// Ele não é `remoto`, então caía no ramo "nenhum remoto" e passava como OK —
// quando significa que NENHUMA chamada sai. E `politicaDe` normaliza valor
// inválido para `bloqueado`: um erro de digitação viraria aprovação.
{
  const src3 = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'sonda-empresa.js'), 'utf8');
  const semC3 = src3.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(/=== 'bloqueado'/.test(semC3), '⚠️ a sonda olha `bloqueado`');
  ok(/bloqueados\.length/.test(semC3), '  e REPROVA quando encontra');

  // e o caminho `sombra` (o padrão) também é exercitado
  ok(/sombras/.test(semC3),
     '⚠️ e o caminho `sombra` (o PADRAO) tambem consulta o dono');
}

// ── ⚠️ já ativa REPROVA ─────────────────────────────────────────────
{
  const src4 = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'sonda-empresa.js'), 'utf8');
  const semC4 = src4.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(/ok: !ativa/.test(semC4),
     '⚠️ ja ativa REPROVA (aviso nao conta no codigo de saida)');
}

// ── roda de ponta a ponta sem quebrar ───────────────────────────────
{
  return sondar('girassol').then((linhas) => {
    ok(Array.isArray(linhas) && linhas.length === CHECAGENS.length,
       'roda todas as checagens');
    ok(linhas.every((l) => typeof l.ok === 'boolean'),
       '  e cada uma responde ok true/false');

    // ⚠️ hoje a Girassol NÃO está configurada — a sonda tem que REPROVAR.
    // Uma sonda que aprova o que não está pronto é pior que não ter sonda.
    ok(linhas.some((l) => !l.ok),
       '⚠️ e REPROVA a Girassol de hoje (que nao esta configurada)');

    const ficha = linhas.find((l) => /ficha/i.test(l.nome));
    ok(ficha && !ficha.ok && /faltando/.test(ficha.detalhe || ''),
       '  dizendo o que falta, nao so "nao"');
    ok(ficha && /plugar-empresa/.test(ficha.dica || ''),
       '  e apontando o comando que resolve');

    // ⚠️ uma checagem que quebra não pode derrubar as outras
    const quebrada = { nome: 'quebra', fn: () => { throw new Error('boom'); } };
    CHECAGENS.push(quebrada);
    return sondar('girassol').then((l2) => {
      const q = l2.find((x) => x.nome === 'quebra');
      ok(q && q.ok === false && /quebrou/.test(q.detalhe),
         '⚠️ uma checagem que lanca vira REPROVADA, nao derruba a sonda');
      ok(l2.length === CHECAGENS.length, '  e as outras rodaram mesmo assim');
      CHECAGENS.pop();

      console.log('');
      console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
      process.exit(falhas ? 1 : 0);
    });
  });
}
