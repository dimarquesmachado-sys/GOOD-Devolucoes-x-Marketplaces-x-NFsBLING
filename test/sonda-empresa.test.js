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
  ok(/sufixoDaFicha/.test(semC),
     '⚠️ (Codex, 2a rodada) o sufixo vem da FICHA, nao de `chaveDados`');
  ok(/AbortSignal\.timeout/.test(semC),
     '⚠️ (Codex, 2a rodada) cada sonda de tabela tem timeout');
  ok(/papelDaChaveSupabase/.test(semC),
     '⚠️ (Codex, 2a rodada) confere o `role` da chave (RLS sem policy deixa `anon` passar)');
}

// ── (Codex, 2a rodada) so 42P01/PGRST205 prova ausencia — nao o status HTTP,
// so `chaveDados` como sufixo, sem timeout e sem checar o `role` da chave ──
//
// A 1a correcao (P1) trocou "toda resposta != 2xx" por "so 404/400" — mas um
// 400 de request malformada ou um 404 de gateway ainda nao provam "tabela
// ausente". E usar `chaveDados` como sufixo confunde o valor gravado na
// coluna `empresa` do banco (GOOD: 'good') com o sufixo FISICO da tabela
// (GOOD: nenhum) — `sondar('good')` sondaria `devolucoes_good`, que nao
// existe, e sugeriria o sufixo RESERVADO `_good`.
function fakeJwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role, iss: 'supabase' })).toString('base64url');
  return `${header}.${payload}.assinatura-fake`;
}

async function testeTabelasSegundaRodada() {
  const chk = CHECAGENS.find((c) => /Supabase/i.test(c.nome));
  const urlAntes = process.env.GIRASSOL_SUPABASE_URL;
  const keyAntes = process.env.GIRASSOL_SUPABASE_KEY;
  const fetchReal = global.fetch;
  process.env.GIRASSOL_SUPABASE_URL = 'https://fake.supabase.co';

  // ⚠️ chave `anon` reprova SEM nem chamar a rede: as tabelas nascem com RLS
  // ligado e sem policy, entao uma chave anon responde 200 vazio no
  // `limit=0` mesmo sem conseguir ler ou gravar nada de verdade.
  process.env.GIRASSOL_SUPABASE_KEY = fakeJwt('anon');
  global.fetch = async () => { throw new Error('nao deveria chamar a rede com chave anon'); };
  const rAnon = await chk.fn('girassol');
  ok(rAnon.ok === false && /service_role/.test(rAnon.detalhe || ''),
     '⚠️ reprova chave `anon` (RLS sem policy deixaria passar 200 vazio, sem provar nada)');

  process.env.GIRASSOL_SUPABASE_KEY = fakeJwt('service_role');

  const existentes = new Set(['devolucoes_girassol', 'espreita_notas_girassol',
    'recados_girassol', 'pecas_retiradas_girassol', 'sku_depara_girassol']);
  global.fetch = async (url) => {
    const nome = String(url).split('/rest/v1/')[1].split('?')[0];
    if (existentes.has(nome)) return { ok: true, json: async () => ({}) };
    return { ok: false, status: 404,
      json: async () => ({ code: 'PGRST205', message: 'Could not find the table in the schema cache' }) };
  };
  const r1 = await chk.fn('girassol');
  ok(r1.ok === false && /faltam 2/.test(r1.detalhe || ''),
     '⚠️ com service_role, acusa as 2 tabelas de defeito que a ficha nem declara');
  ok(/defeito_comentarios_girassol/.test(r1.detalhe) && /defeito_pedidos_girassol/.test(r1.detalhe),
     '  nomeando exatamente as que faltam');

  // ⚠️ 401 com corpo que NAO fala de relacao ausente nao pode virar "faltam"
  global.fetch = async () => ({ ok: false, status: 401,
    json: async () => ({ code: '42501', message: 'invalid api key' }) });
  const r2 = await chk.fn('girassol');
  ok(r2.ok === false && !/faltam/.test(r2.detalhe || ''),
     '⚠️ 401 (chave invalida) nao vira "tabela faltando"');

  // ⚠️ e nem um 400/404 cujo CODIGO nao e o de relacao ausente
  global.fetch = async () => ({ ok: false, status: 400,
    json: async () => ({ code: 'PGRST100', message: 'invalid filter syntax' }) });
  const r2b = await chk.fn('girassol');
  ok(r2b.ok === false && !/faltam/.test(r2b.detalhe || ''),
     '⚠️ 400/404 sem o codigo de relacao ausente (42P01/PGRST205) tambem nao vira "faltam"');

  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  const r3 = await chk.fn('girassol');
  ok(r3.ok === true && /as 7 respondem/.test(r3.detalhe || ''),
     'com as 7 tabelas presentes (e service_role), aprova');

  global.fetch = fetchReal;
  if (urlAntes === undefined) delete process.env.GIRASSOL_SUPABASE_URL;
  else process.env.GIRASSOL_SUPABASE_URL = urlAntes;
  if (keyAntes === undefined) delete process.env.GIRASSOL_SUPABASE_KEY;
  else process.env.GIRASSOL_SUPABASE_KEY = keyAntes;
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

      return testeTabelasSegundaRodada().then(() => {
        console.log('');
        console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
        process.exit(falhas ? 1 : 0);
      });
    });
  });
}
