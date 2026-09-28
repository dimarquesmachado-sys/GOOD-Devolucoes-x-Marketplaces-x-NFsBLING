'use strict';
/* ============================================================
 * scripts/sonda-empresa.js
 * ------------------------------------------------------------
 * CONFERE, SEM ATIVAR, se a empresa está pronta de verdade.
 *
 * ⚠️ POR QUE NÃO BASTA O `conferirEmpresa`
 *
 * Ele confere o que ESTÁ ESCRITO: as envs existem, os campos fiscais têm
 * valor. Não confere se aquilo FUNCIONA — se o Bling aceita a credencial, se
 * o dono do token responde, se as tabelas existem no banco.
 *
 * 📌 A diferença importa no único momento que conta: `pronta: true` e a tela
 * quebrando mesmo assim. Foi o que aconteceu com as tabelas (a rotina
 * instalada era a antiga, de 5) e com o link do checkout (a pasta tinha outro
 * nome).
 *
 * COMO USAR
 *
 *   node scripts/sonda-empresa.js girassol
 *
 * ⚠️ SÓ LEITURA. Não emite nota, não grava, não renova token, não ativa nada.
 * Roda com a empresa ainda desativada no contrato — é esse o ponto.
 * ============================================================ */

const CHECAGENS = [];
const registrar = (nome, fn) => CHECAGENS.push({ nome, fn });

/**
 * O `role` embutido no JWT da chave Supabase ('anon' ou 'service_role').
 * Não é uma chamada de rede: é so decodificar o payload do proprio token.
 */
function papelDaChaveSupabase(key) {
  try {
    const partes = String(key || '').split('.');
    if (partes.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    return (payload && payload.role) || null;
  } catch (err) { return null; }
}

/**
 * Testa um access token com UMA chamada real, de leitura, ao endpoint que
 * `lib/empresas.js:descobrirFicha` já usa pra descobrir a ficha (mesma rota,
 * mesmo formato de URL absoluta) — provado seguro em produção.
 *
 * @returns {{aceito: true|false|null, motivo?: string}} `null` = rede/serviço
 * não confirmou nada (não é prova de token ruim, mas também não é "pode
 * ativar").
 */
async function testarTokenBling(access, apiBase) {
  try {
    const url = `${apiBase}/situacoes?limite=1&pagina=1`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 401 || r.status === 403) {
      return { aceito: false, motivo: `HTTP ${r.status} — credencial recusada` };
    }
    if (!r.ok) return { aceito: null, motivo: `HTTP ${r.status} — não deu para confirmar` };
    return { aceito: true };
  } catch (err) {
    return { aceito: null, motivo: (err && err.message) || String(err) };
  }
}

/** Mesma ideia, com `/users/me` — o mesmo endpoint já usado em lib/rotas-debug.js
 * para confirmar identidade do token do ML sem exigir escopo extra. */
async function testarTokenML(access, apiBase) {
  try {
    const r = await fetch(`${apiBase}/users/me`, {
      headers: { Authorization: `Bearer ${access}` },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 401 || r.status === 403) {
      return { aceito: false, motivo: `HTTP ${r.status} — credencial recusada` };
    }
    if (!r.ok) return { aceito: null, motivo: `HTTP ${r.status} — não deu para confirmar` };
    return { aceito: true };
  } catch (err) {
    return { aceito: null, motivo: (err && err.message) || String(err) };
  }
}

/* ── 1. a ficha existe e está completa ───────────────────────────── */
registrar('ficha e configuração', async (chave) => {
  const { obterEmpresa, conferirEmpresa } = require('../lib/empresas');
  let e = null;
  try { e = obterEmpresa(chave); } catch (err) { e = null; }
  if (!e) {
    return { ok: false, detalhe: 'empresa não está no registro — '
      + `rode antes: node scripts/nova-empresa.js ${chave} "<Nome>"` };
  }
  const c = conferirEmpresa(chave);
  const faltam = (c.envsFaltando || []).length + (c.fiscalSemValor || []).length;
  return {
    ok: faltam === 0,
    detalhe: faltam === 0
      ? 'nada faltando'
      : `${(c.envsFaltando || []).length} env(s) e `
        + `${(c.fiscalSemValor || []).length} campo(s) fiscal(is) faltando`,
    dica: faltam ? 'node scripts/plugar-empresa.js ' + chave : null,
  };
});

/* ── 2. a política de token, e o dono ────────────────────────────── */
registrar('política de token', async (chave) => {
  const tokenLeitor = require('../lib/token-leitor');
  const eixos = ['bling', 'ml'].map((i) => `${i}=${tokenLeitor.politicaDe(chave, i)}`);
  const algumRemoto = ['bling', 'ml']
    .some((i) => tokenLeitor.politicaDe(chave, i) === 'remoto');

  // ⚠️ `sombra` não é erro: é o padrão, e significa "esta empresa renova
  // sozinha". Só vira problema se ela dividir a conta com outro serviço — e aí
  // o aviso abaixo é o que importa.
  // ⚠️ b427 (Codex, P1) - `bloqueado` NÃO PODE PASSAR.
  //
  // Ele não é `remoto`, então caía no ramo "nenhum eixo remoto" e a sonda
  // dizia OK — quando `bloqueado` significa que NENHUMA chamada sai. É o
  // estado mais grave dos quatro, e era o único que passava calado.
  //
  // 📌 Pior: `politicaDe` normaliza valor inválido para `bloqueado`. Um erro
  // de digitação na env viraria aprovação.
  const bloqueados = ['bling', 'ml']
    .filter((i) => tokenLeitor.politicaDe(chave, i) === 'bloqueado');
  if (bloqueados.length) {
    return {
      ok: false,
      detalhe: eixos.join(', '),
      erro: `eixo(s) ${bloqueados.join(' e ')} em \`bloqueado\`: NENHUMA chamada `
        + 'sai. Confira se a env da política não tem erro de digitação — valor '
        + 'inválido vira `bloqueado`.',
    };
  }

  if (!algumRemoto) {
    return {
      ok: true,
      detalhe: eixos.join(', '),
      aviso: 'nenhum eixo em `remoto`: esta empresa vai RENOVAR o token ela '
        + 'mesma. Se o Mover-Pedidos também renova a mesma conta, os dois '
        + 'brigam pelo refresh de uso único.',
    };
  }
  if (!process.env.ADMIN_TOKEN_LEITURA_KEY) {
    return { ok: false, detalhe: eixos.join(', '),
      erro: 'eixo em `remoto` SEM a chave de leitura — nenhuma chamada sairia' };
  }
  return { ok: true, detalhe: eixos.join(', ') + ', chave de leitura presente' };
});

/* ── 3. o marketplace ACEITA o token que a produção vai usar ──────── */
registrar('o dono entrega o token', async (chave) => {
  const tokenLeitor = require('../lib/token-leitor');
  const { configDaEmpresa } = require('../lib/config-da-empresa');

  // ⚠️ (Codex, 3a rodada, P2) x2 — DOIS BURACOS NO MESMO LUGAR:
  //
  // 1) `d.access` NÃO PROVA que o Bling/ML aceita: só prova que ALGUÉM
  //    devolveu uma string não vazia. Token revogado, expirado ou de conta
  //    errada passava calado, e a sonda dizia "entregou".
  // 2) Eixo em `local` era EXCLUÍDO desta checagem inteira — mas em
  //    produção ele TAMBÉM faz chamada, só que sem consultar o dono. Um
  //    `local` com token morto tinha zero sonda.
  //
  // 📌 Agora todo eixo NÃO bloqueado é testado com uma chamada REAL, de
  // leitura, pelo MESMO caminho de credencial que a produção usa: se o
  // dono responde (`remoto`), o token dele; senão (`local`, ou `sombra`
  // caindo no local), o access token local da própria ficha.
  const bloqueados = ['bling', 'ml']
    .filter((i) => tokenLeitor.politicaDe(chave, i) === 'bloqueado');
  const alvos = ['bling', 'ml'].filter((i) => !bloqueados.includes(i));
  if (!alvos.length) {
    return { ok: true, detalhe: 'os dois eixos estão `bloqueado` — nada pra testar aqui' };
  }

  const cfg = configDaEmpresa(chave);
  const TESTAR = { bling: testarTokenBling, ml: testarTokenML };
  const ACCESS_LOCAL = { bling: cfg.bling.accessToken, ml: cfg.ml.accessToken };

  const partes = [];
  let tudoOk = true;
  for (const integracao of alvos) {
    const politica = tokenLeitor.politicaDe(chave, integracao);
    let access = null;
    let motivo = null;
    try {
      const d = await tokenLeitor.resolverToken(chave, integracao);
      if (d.usar === 'remoto') access = d.access;
      else if (d.usar === 'local') access = ACCESS_LOCAL[integracao] || null;
      motivo = (d && d.motivo) || null;
    } catch (err) {
      motivo = (err && err.message) || String(err);
    }

    if (!access) {
      // ⚠️ o eixo NÃO está bloqueado (senão nem entraria em `alvos`) — se
      // mesmo assim não há credencial nenhuma pra testar, é reprovação: a
      // produção também não teria o que mandar.
      tudoOk = false;
      partes.push(`${integracao} (${politica}): sem token pra testar `
        + `(${motivo || 'nenhuma fonte devolveu credencial'})`);
      continue;
    }

    const r = await TESTAR[integracao](access, cfg[integracao].apiBase);
    if (r.aceito === false) {
      tudoOk = false;
      partes.push(`${integracao} (${politica}): o marketplace RECUSOU — ${r.motivo}`);
    } else if (r.aceito === true) {
      partes.push(`${integracao} (${politica}): aceitou numa chamada real`);
    } else {
      // rede/serviço não confirmou — não é prova de token ruim, mas também
      // não é "pode ativar" (mesmo critério do `naoOlhei` da checagem de tabelas)
      tudoOk = false;
      partes.push(`${integracao} (${politica}): não consegui confirmar — ${r.motivo}`);
    }
  }
  return {
    ok: tudoOk,
    detalhe: partes.join(' | '),
    erro: tudoOk ? null : 'ao menos um eixo não teve o token confirmado por uma '
      + 'chamada real ao marketplace — a produção falharia na primeira chamada',
  };
});

/* ── 4. as tabelas existem no banco ──────────────────────────────── */
registrar('tabelas no Supabase', async (chave) => {
  const { obterEmpresa } = require('../lib/empresas');
  const { sufixoDaFicha, TABELAS_ESPERADAS } = require('../lib/provisionar-empresa');
  const e = obterEmpresa(chave);

  // ⚠️ (Codex, 2a rodada, P2) - O SUFIXO VEM DA FICHA, NÃO DE `chaveDados`.
  //
  // `chaveDados` é o valor gravado na coluna `empresa` do banco — um
  // identificador DIFERENTE do sufixo físico da tabela. A própria GOOD prova
  // a diferença: `chaveDados` é 'good', mas as tabelas dela NÃO têm sufixo.
  // Usar `chaveDados` faria `sondar('good')` procurar `devolucoes_good`
  // (que não existe) e sugerir o sufixo RESERVADO `_good`. `sufixoDaFicha`
  // (a mesma função que `provisionarEmpresa` usa) lê o nome real da tabela
  // na ficha em vez de inventar.
  const s = sufixoDaFicha(e);
  if (!s.ok) return { ok: false, detalhe: s.erro };
  const tabelas = TABELAS_ESPERADAS.map((base) => base + s.sufixo);

  const url = process.env[e.prefixoEnv + 'SUPABASE_URL'] || process.env.SUPABASE_URL;
  const key = process.env[e.prefixoEnv + 'SUPABASE_KEY'] || process.env.SUPABASE_KEY;
  if (!url || !key) return { ok: false, detalhe: 'sem credencial do Supabase no ambiente' };

  // ⚠️ (Codex, 2a rodada, P2) - CHAVE `anon` PASSA NO `limit=0` E NÃO PROVA
  // NADA. As tabelas nascem com RLS ligado e SEM policy (é assim que
  // `sql/provisionar-empresa.sql` cria): o PostgREST responde 200 com lista
  // vazia pra QUALQUER chave, porque nenhuma linha bate numa policy que não
  // existe. A aplicação usa esta MESMA chave pra ler e gravar de verdade —
  // decide pelo `role` do JWT, sem precisar de outra chamada de rede.
  const papel = papelDaChaveSupabase(key);
  if (papel !== 'service_role') {
    return {
      ok: false,
      detalhe: `a chave Supabase é \`${papel || 'formato desconhecido'}\`, não \`service_role\``,
      erro: 'com RLS ligado e sem policy, uma chave anon responde 200 vazio no '
        + '`limit=0` mesmo sem conseguir ler ou gravar nada de verdade — troque '
        + 'pela service_role no painel do Supabase (Settings > API)',
    };
  }

  const ausentes = [];
  const naoOlhei = [];
  for (const t of tabelas) {
    try {
      // ⚠️ `limit=0`: pergunta se a tabela existe sem trazer UMA linha. Uma
      // sonda não pode ler dado de cliente pra responder "existe?".
      // ⚠️ (Codex, 2a rodada, P2) - TIMEOUT em cada probe: sem isto, um
      // Supabase que aceita a conexão e trava deixa a sonda parada nas 7
      // tabelas, uma por vez, no timeout longo do runtime, em vez de virar
      // um resultado reprovado rápido.
      const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=0`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) continue;

      // ⚠️ (Codex, 2a rodada, P2) - SÓ 42P01/PGRST205 (relação inexistente)
      // PROVA AUSÊNCIA. Classificar por status (404/400) ainda confundia um
      // 400 de request malformada ou um 404 de gateway com "tabela não
      // existe". `lib/provisionar-empresa.js` já resolve isso olhando o
      // CÓDIGO do erro no corpo, não só o status HTTP — mesmo padrão aqui.
      let corpo = {};
      try { corpo = await r.json(); } catch (err) { corpo = {}; }
      const msg = String(corpo.message || '');
      const cod = String(corpo.code || '');
      if (/does not exist|could not find the table/i.test(msg) || /42P01|PGRST205/i.test(cod)) {
        ausentes.push(t);
      } else {
        naoOlhei.push(`${t}: HTTP ${r.status} ${msg || cod || 'erro desconhecido'}`);
      }
    } catch (err) {
      naoOlhei.push(`${t}: ${(err && err.message) || err}`);
    }
  }

  if (naoOlhei.length) {
    return {
      ok: false,
      detalhe: `não consegui confirmar ${naoOlhei.length} de ${tabelas.length} `
        + '(erro na sonda, não "tabela ausente")',
      erro: naoOlhei.join(' | '),
    };
  }
  return {
    ok: ausentes.length === 0,
    detalhe: ausentes.length === 0
      ? `as ${tabelas.length} respondem`
      : `faltam ${ausentes.length} de ${tabelas.length}: ${ausentes.join(', ')}`,
    dica: ausentes.length
      ? 'cole sql/provisionar-empresa.sql no SQL Editor e rode '
        + `select provisionar_empresa('${s.sufixo}');`
      : null,
  };
});

/* ── 5. a empresa está desativada (é assim que tem que estar) ────── */
registrar('ainda desativada (esperado)', async (chave) => {
  const { empresasAtivasNoDevolucoes } = require('../lib/empresas');
  const ativa = empresasAtivasNoDevolucoes().some((x) => x.chave === chave);
  // ⚠️ b427 (Codex, P2): já ativa REPROVA, não avisa.
  //
  // Antes eu devolvia `ok: true` com um aviso — e o aviso não conta pro código
  // de saída. Uma ativação prematura passava por uma sonda VERDE, que é
  // justamente o que ela existe pra impedir.
  return {
    ok: !ativa,
    detalhe: ativa ? 'JÁ ESTÁ ATIVA' : 'desativada',
    erro: ativa ? 'a empresa já está ativa — esta sonda é para ANTES disso. '
      + 'Se foi sem querer, o freio tira ela do ar sem editar o contrato.' : null,
  };
});

async function sondar(chave) {
  const linhas = [];
  for (const { nome, fn } of CHECAGENS) {
    try {
      const r = await fn(chave);
      linhas.push({ nome, ...r });
    } catch (err) {
      linhas.push({ nome, ok: false, detalhe: `a checagem quebrou: ${(err && err.message) || err}` });
    }
  }
  return linhas;
}

module.exports = { sondar, CHECAGENS };

/* ── linha de comando ──────────────────────────────────────── */
if (require.main === module) {
  const chave = process.argv[2];
  if (!chave) {
    console.log('uso: node scripts/sonda-empresa.js <chave>');
    process.exit(1);
  }
  (async () => {
    console.log('');
    console.log(`════ sonda: ${chave} ════`);
    console.log('');
    const linhas = await sondar(chave);
    let bloqueia = 0;
    for (const l of linhas) {
      console.log(`  ${l.ok ? '✅' : '❌'}  ${l.nome}`);
      if (l.detalhe) console.log(`      ${l.detalhe}`);
      if (l.erro) { console.log(`      ⚠️ ${l.erro}`); }
      if (l.aviso) console.log(`      ⚠️ ${l.aviso}`);
      if (l.dica) console.log(`      📌 ${l.dica}`);
      if (!l.ok) bloqueia++;
      console.log('');
    }
    if (bloqueia) {
      console.log(`  ❌ ${bloqueia} checagem(ns) reprovada(s) — NÃO ative ainda.`);
    } else {
      console.log('  ✅ tudo respondeu. Pode ativar `ativa_em.devolucoes`.');
      console.log('');
      console.log('  ⚠️ E deixe o freio à mão para o caso de estranhar:');
      console.log(`     DEVOLUCOES_DESATIVAR_${chave.toUpperCase()}=1`);
    }
    console.log('');
    process.exit(bloqueia ? 1 : 0);
  })().catch((e) => { console.log('❌ ' + (e && e.message)); process.exit(1); });
}
