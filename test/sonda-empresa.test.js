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
