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
 * Testa um access token com UMA chamada real, de leitura, a um endpoint que
 * existe em toda conta do Bling v3 (`/situacoes/modulos`; o antigo `/situacoes`
 * dava 404 e invalidava a prova).
 *
 * @returns {{aceito: true|false|null, motivo?: string}} `null` = rede/serviço
 * não confirmou nada (não é prova de token ruim, mas também não é "pode
 * ativar").
 */
async function testarTokenBling(access, apiBase) {
  try {
    // b674 - `GET /situacoes` NAO existe na v3 (404 em producao, 09/11: a sonda dizia "nao consegui
    // confirmar" e reprovava empresas que emitem NF todo dia). O que existe e barato e de leitura e
    // `/situacoes/modulos` (lista os modulos que tem situacao; nenhum parametro; igual em toda conta).
    const url = `${apiBase}/situacoes/modulos`;
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
    // b525 - AUDITORIA (Codex, 04/10): token ACEITO nao prova que e da conta CERTA (um token de outra conta passava).
    // Devolve quem e a conta, pra checagem comparar com <PREFIXO>ML_USER_ID.
    let conta = null;
    try { const j = await r.json(); conta = j && j.id != null ? { id: String(j.id), apelido: j.nickname || null } : null; } catch (e) { conta = null; }
    return { aceito: true, conta };
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
// b677 r2 - toda prova pelo cliente VIVO tem PRAZO (o do bot cobria so a Shopee; o Bling e o mesmo
// risco: a sonda roda em sequencia e a rota espera o fim). O prazo nao aborta a chamada por baixo
// (a funcao registrada nao recebe sinal), mas devolve o veredito no tempo da sonda.
const PRAZO_PROVA_MS = 8000;
function comPrazo(promessa, rotulo, ms) {
  const prazo = ms || PRAZO_PROVA_MS;
  let timer = null;
  const estouro = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${rotulo} nao respondeu em ${Math.round(prazo / 1000)} s`)), prazo); });
  return Promise.race([Promise.resolve().then(() => promessa()), estouro]).finally(() => clearTimeout(timer));
}

// b675 - classifica a resposta do cliente VIVO da empresa ({ ok, status, error }) no mesmo
// vocabulario da prova por token cru: aceito / recusado / nao confirmou.
function classificarProvaBling(r) {
  if (r && r.ok) return { aceito: true };
  const st = Number(r && r.status) || 0;
  if (st === 401 || st === 403) return { aceito: false, motivo: `HTTP ${st} — recusado mesmo pelo cliente vivo (renovacao da propria cadeia incluida)` };
  return { aceito: null, motivo: (r && (r.error || r.erro)) ? String(r.error || r.erro).slice(0, 120) : (st ? `HTTP ${st} — nao deu para confirmar` : 'sem resposta') };
}

registrar('o dono entrega o token', async (chave, ctx) => {
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
  //
  // ⚠️ b430 (Codex, PR #368, P2) - RODANDO NA ROTA, ESTA SONDA COMPARTILHA O
  // CACHE DE 5 MIN DE `lib/token-leitor` COM A PRODUÇÃO. Por linha de
  // comando cada chamada nasce num processo novo (cache sempre vazio), mas
  // pela rota (`server.js`, processo de vida longa) uma leitura anterior —
  // da própria produção ou de uma sonda anterior — pode estar cacheada. Sem
  // invalidar antes, `resolverToken` devolveria o token GUARDADO e a sonda
  // aprovaria mesmo que o dono tenha ficado indisponível depois daquele
  // cache. Invalidar aqui é seguro: a chave do cache é por (empresa,
  // integração), então só afeta ESTA empresa/eixo, e uma leitura a mais no
  // dono é exatamente o preço de uma sonda que prova de verdade.
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
      tokenLeitor.invalidar(chave, integracao);
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

    // b675 - BLING: dentro do servidor, a prova e pelo cliente VIVO da empresa (a mesma cadeia de
    // renovacao da producao). O access da sombra vence em 6 h e dava "401 — RECUSADO" em empresa
    // parada, com a producao renovando normalmente no primeiro 401; e a sonda nao pode renovar
    // sozinha (refresh de uso unico). Sem cliente vivo (linha de comando), fica a prova crua — e um
    // 401 nela vira "nao confirmou", nao "recusado".
    let r;
    const empresaDados = String((cfg && cfg.EMPRESA) || chave).toLowerCase();
    const provaViva = (integracao === 'bling' && ctx && typeof ctx.provaBling === 'function') ? ctx.provaBling(empresaDados) : null;
    if (provaViva) {
      let resp = null;
      try { resp = await comPrazo(provaViva, 'o cliente Bling da empresa', ctx && ctx.prazoProvaMs); } catch (err) { resp = { ok: false, error: (err && err.message) || String(err) }; }
      r = classificarProvaBling(resp);
      if (r.aceito === true) { partes.push(`bling (${politica}): aceitou numa chamada real pelo cliente vivo da empresa`); continue; }
    } else {
      r = await TESTAR[integracao](access, cfg[integracao].apiBase);
      if (integracao === 'bling' && r.aceito === false && /HTTP 401/.test(String(r.motivo || ''))) {
        r = { aceito: null, motivo: 'HTTP 401 com o access da sombra (vence em 6 h) — a producao renova no primeiro 401; confirme pela rota /api/admin/sonda-empresa/' + chave };
      }
    }
    if (r.aceito === false) {
      tudoOk = false;
      partes.push(`${integracao} (${politica}): o marketplace RECUSOU — ${r.motivo}`);
    } else if (r.aceito === true) {
      // b525 - AUDITORIA: no ML, o token tem de ser da CONTA DESTA empresa. `cfg.ml.userId` ja resolve o
      // prefixo E o fallback legado (GOOD usa ML_USER_ID sem prefixo). Sem identidade dos dois lados, reprova.
      if (integracao === 'ml') {
        const esperado = String(cfg.ml.userId || '').trim();
        if (!esperado) {
          tudoOk = false;
          partes.push(`ml (${politica}): conta NAO VERIFICADA — falta ${cfg.ml.chaveUserId} no ambiente`);
          continue;
        }
        if (!r.conta) {
          tudoOk = false;
          partes.push(`ml (${politica}): conta NAO VERIFICADA — /users/me respondeu sem o id do dono do token`);
          continue;
        }
        if (r.conta.id !== esperado) {
          tudoOk = false;
          partes.push(`ml (${politica}): ⚠️ token de OUTRA conta — respondeu ${r.conta.id}${r.conta.apelido ? ' (' + r.conta.apelido + ')' : ''}, esperado ${esperado}`);
          continue;
        }
        partes.push(`ml (${politica}): aceitou numa chamada real — conta ${r.conta.id} CONFIRMADA`);
        continue;
      }
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
/* -- b525 - AUDITORIA (Codex, 04/10): CAPTURA RECENTE ---------------------------------------
   A captura persistente e o que o bipe consulta quando o marketplace para de listar (#432). Sonda verde sem
   captura recente era meia verdade. Le a ultima linha DESTA empresa em devolucoes_capturadas. */
registrar('captura recente', async (chave, ctx) => {
  const e = require('../lib/empresas').obterEmpresa(chave);
  const emp = String((e && e.chaveDados) || chave).toLowerCase();
  // ⚠️ (Codex #433, P2) A IDADE DA ULTIMA LINHA NAO PROVA A CAPTURA: num periodo sem devolucao listada o
  // `guardar` recebe lista vazia e nao toca em linha nenhuma, com a captura saudavel. Quem prova que o ciclo
  // roda e o BATIMENTO em memoria do servidor (`ultima`, atualizado ate com lista vazia), que a rota repassa
  // em `ctx.capturaEstado`. Por linha de comando nao ha servidor: fica NAO VERIFICADO, sem decidir pela idade.
  const estado = ctx && typeof ctx.capturaEstado === 'function' ? ctx.capturaEstado(emp) : null;
  if (estado) {
    if (estado.erro) return { ok: false, detalhe: 'FALHOU — ' + estado.erro, erro: 'o ultimo ciclo da captura falhou (veja /<empresa>/status -> captura)' };
    if (!estado.ultima) {
      // b675 - a captura roda junto com a espreita (1x/hora, a primeira minutos depois do boot).
      // Logo depois de um deploy "ainda nao rodou" e NAO SEI, nao FALHOU (regra: nao sei != nao
      // funciona) — vira aviso com a idade do processo; so reprova se o servidor ja esta de pe ha
      // mais de 2 h sem nenhum ciclo.
      const up = ctx && Number.isFinite(ctx.uptimeMin) ? ctx.uptimeMin : null;
      if (up != null && up < 120) {
        return { ok: true, detalhe: `NAO VERIFICADO — servidor subiu ha ${Math.round(up)} min e a captura ainda nao rodou neste boot`,
          aviso: 'a captura roda junto com a espreita (1x/hora); rode a sonda de novo em 1 h — se seguir sem ciclo, ai e falha' };
      }
      return { ok: false, detalhe: 'NAO VERIFICADO — a captura ainda nao rodou neste boot' + (up != null ? ` (servidor de pe ha ${Math.round(up)} min)` : ''), erro: 'sem ciclo concluido desde o boot do servidor' };
    }
    const horas = (Date.now() - new Date(estado.ultima).getTime()) / 3600e3;
    if (horas > 6) return { ok: false, detalhe: 'FALHOU — ultimo ciclo ha ' + Math.round(horas) + ' h', erro: 'a captura roda 1x/hora: mais de 6 h sem ciclo e falha' };
    return { ok: true, detalhe: 'CONFIRMADO — ultimo ciclo ha ' + Math.round(horas * 60) + ' min (' + (estado.gravadas || 0) + ' gravada(s))' };
  }
  const url = process.env[(e && e.prefixoEnv || '') + 'SUPABASE_URL'] || process.env.SUPABASE_URL;
  const key = process.env[(e && e.prefixoEnv || '') + 'SUPABASE_KEY'] || process.env.SUPABASE_KEY;
  if (!url || !key) return { ok: false, detalhe: 'NAO VERIFICADO — sem as envs do Supabase', erro: 'sem SUPABASE_URL/KEY' };
  try {
    // fetch com timeout (como as outras sondas): o builder do supabase-js nao tem timeout e travaria a sonda
    const r = await fetch(`${url}/rest/v1/devolucoes_capturadas?select=visto_por_ultimo&empresa=eq.${encodeURIComponent(emp)}&order=visto_por_ultimo.desc&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { ok: false, detalhe: 'FALHOU — HTTP ' + r.status + ' ao ler devolucoes_capturadas', erro: 'tabela devolucoes_capturadas ilegivel' };
    const dados = await r.json();
    const l = Array.isArray(dados) ? dados[0] : null;
    const aviso = 'sem batimento do servidor (linha de comando): idade de linha nao prova a captura — rode pela rota /api/admin/sonda-empresa/' + chave;
    if (!l) return { ok: true, detalhe: 'NAO VERIFICADO — nenhuma linha gravada ainda pra ' + emp, aviso };
    return { ok: true, detalhe: 'NAO VERIFICADO — ultima linha gravada em ' + l.visto_por_ultimo, aviso };
  } catch (err) { return { ok: false, detalhe: 'NAO VERIFICADO — ' + ((err && err.message) || err), erro: 'leitura da captura falhou ou estourou o tempo' }; }
});


/* -- b525 - AUDITORIA: CANAIS (confirmado / falhou / nao aplicavel / nao verificado) ------------
   A sonda so testava Bling e ML. Aqui o estado de configuracao dos outros canais, sem chamar a API deles
   (Shopee vai pelo proxy; TikTok pela ponte com mapa FECHADO de lojas no Mover-Pedidos). */
registrar('canais (Magalu, Shopee, TikTok)', async (chave, ctx) => {
  const e = require('../lib/empresas').obterEmpresa(chave) || {};
  // mesma resolucao da producao (prefixo + fallback legado), nao nomes de env montados a mao
  const mg = require('../lib/config-da-empresa').configDaEmpresa(chave).magalu;
  const tem = (v) => !!String(v || '').trim();
  const partes = [];
  // Magalu: token + tenant da empresa; credencial propria ou a da GOOD
  if (tem(mg.accessToken) || tem(mg.refreshToken)) {
    partes.push('Magalu: ' + (tem(mg.tenantId) ? 'configurado' : 'FALHOU (falta ' + (e.prefixoEnv || '') + 'MAGALU_TENANT_ID)')
      + (tem(mg.clientId) ? ' · credencial propria' : ' · usa a credencial da GOOD'));
  } else partes.push('Magalu: NAO APLICAVEL (sem token da empresa)');
  // Shopee: proxy compartilhado (o servico multi-loja)
  // b676 - dentro do servidor a Shopee e PROVADA pelo cliente vivo da empresa (lista do proxy, cache
  // de 5 min, loja da ficha + chave interna): URL, chave e loja cadastrada no shopee-nf-sync. Fora do
  // servidor (linha de comando) fica como antes: configurado, nao verificado.
  const proxyCfg = !!(process.env.SHOPEE_PROXY_URL && process.env.SHOPEE_PROXY_KEY);
  const empresaDados = String(e.chaveDados || chave).toLowerCase();
  const prazoMs = (ctx && ctx.prazoShopeeMs) || 8000;
  const provaShp = (ctx && typeof ctx.provaShopee === 'function') ? ctx.provaShopee(empresaDados) : null;
  if (!proxyCfg) {
    partes.push('Shopee: FALHOU (proxy sem SHOPEE_PROXY_URL/KEY)');
  } else if (provaShp) {
    try {
      // b677 - prazo proprio: o fetch do proxy nao tem abort, entao uma Shopee parada travaria a sonda inteira
      const lista = await comPrazo(provaShp, 'proxy', prazoMs);
      partes.push('Shopee: proxy respondeu pelo cliente vivo da empresa (' + (Array.isArray(lista) ? lista.length + ' devolucao(oes) na lista' : 'resposta sem lista') + ')');
    } catch (err) {
      partes.push('Shopee: FALHOU (' + String((err && err.message) || err).slice(0, 140) + ')');
    }
  } else {
    partes.push('Shopee: NAO VERIFICADO (proxy configurado; a loja e conferida no /' + chave + '/status)');
  }
  // TikTok: a ponte tem mapa fechado de lojas E precisa de URL/KEY, senao toda chamada falha
  let tiktok = 'NAO VERIFICADO';
  try {
    const ponte = require('../lib/tiktok-ponte');
    if (!ponte.lojaDaEmpresa(e.chaveDados || chave)) tiktok = 'NAO APLICAVEL (loja nao mapeada na ponte do Mover-Pedidos)';
    else if (!ponte.configPonte().ok) tiktok = 'FALHOU (ponte sem MOVER_PEDIDOS_URL/KEY)';
    else tiktok = 'mapeado na ponte';
  } catch (err) { tiktok = 'NAO VERIFICADO'; }
  partes.push('TikTok: ' + tiktok);
  const falhou = partes.some((x) => /FALHOU/.test(x));
  return { ok: !falhou, detalhe: partes.join(' | '), erro: falhou ? 'algum canal configurado pela metade' : null };
});

// b673 - A PONTE EAN COM O MOVER-PEDIDOS (divergente: codigo de barras -> produto, b671).
// Uma empresa nova so resolve codigo de barras no "produto errado" se o Mover-Pedidos
// tiver o painel dela (a pasta da ficha: pastaCheckout) e a chave da ponte bater. Esta
// checagem pergunta de verdade, com um EAN que nao existe: a resposta certa e "nada
// encontrado" (prova rota + chave); 404 do guard, servico fora ou ponte sem env vira
// AVISO (nao bloqueia ativar: a empresa opera; so o codigo de barras do divergente cai no SKU).
registrar('ponte EAN com o Mover-Pedidos', async (chave) => {
  // b674 - PING, nao busca: um EAN inexistente mandava o Mover-Pedidos varrer o Bling (~25 chamadas
  // na cota da empresa) e estourava 8 s — a sonda reprovava uma ponte que funciona. O ping prova rota
  // + chave sem consulta nenhuma; ponte fora e AVISO (nao bloqueia ativar), com o efeito dito.
  const { pingPonte } = require('../lib/produto-por-ean-ponte');
  const r = await pingPonte(chave, { timeoutMs: 8000 });
  if (r.ok) return { ok: true, detalhe: `/${r.pasta}/buscar-produto: ${r.detalhe}` };
  if (!r.pasta) return { ok: false, detalhe: 'sem pasta', erro: r.motivo };
  return { ok: true, detalhe: `/${r.pasta}/buscar-produto NAO respondeu direito`, aviso: r.motivo + ' — ate resolver, o divergente nao resolve codigo de barras nesta empresa (cai no SKU)' };
});

registrar('estado no contrato', async (chave) => {
  // 30/09 (Codex): esta checagem REPROVAVA a empresa ja ativa (b427), porque a
  // sonda nasceu pra PRE-ativacao. A Girassol esta no ar e a sonda virou
  // conferencia de saude. Agora e informativa sobre o CONTRATO, e a frase
  // final se adapta.
  //
  // ⚠️ 30/09 r2 (Codex, P2): "ativa no contrato" NAO e "no ar". Uma empresa
  // freada por DEVOLUCOES_DESATIVAR_<X>=1, ou que falhou no boot, esta ativa
  // no contrato e FORA do ar — e a sonda dizia "ativa e saudavel". Quando a
  // sonda roda DENTRO do servidor (a rota), o `diagnostico()` da montagem tem
  // o estado real: montada / falhou / desativada_por_env. Cruzo os dois. Por
  // linha de comando (sem servidor) nao ha montagem, e fico so no contrato —
  // e digo isso.
  const { empresasAtivasNoDevolucoes, obterEmpresa } = require('../lib/empresas');
  let montagem = [];
  try { montagem = require('../lib/montagem-empresas').diagnostico(); } catch (e) { montagem = []; }
  const m = montagem.find((x) => x.chave === chave);
  // b663 - A HOSPEDEIRA (a empresa da raiz, prefixoRota '') nao entra em
  // `empresasAtivasNoDevolucoes` — ela e o servidor que monta as outras, nao
  // uma instancia ativada pelo contrato. A sonda dizia "ainda desativada -
  // ative ativa_em.devolucoes" pra GOOD, que esta no ar desde sempre. O estado
  // dela vem da montagem (b659 registra a hospedeira no mesmo diagnostico):
  // montada, ou desativada_por_env (DEVOLUCOES_DESATIVAR_<X>=1).
  let hospedeira = false;
  try { hospedeira = obterEmpresa(chave).prefixoRota === ''; } catch (e) { hospedeira = false; }
  if (hospedeira) {
    if (!m) return { ok: true, detalhe: 'hospedeira (raiz) — ativa por construcao; sem servidor pra conferir se esta no ar' };
    if (m.estado === 'montada') return { ok: true, detalhe: 'hospedeira (raiz), no ar' };
    if (m.estado === 'desativada_por_env') {
      return { ok: false, detalhe: 'hospedeira (raiz) FREADA por env',
        erro: `${require('../lib/montagem-empresas').nomeFreio(chave)}=1 esta ligada: a empresa NAO esta no ar (rotinas paradas, raiz em 503). Remova a env pra voltar.` };
    }
    return { ok: false, detalhe: 'hospedeira (raiz) em estado inesperado: ' + m.estado, erro: 'veja /health -> montagem_empresas e o log do boot' };
  }
  const ativaNoContrato = empresasAtivasNoDevolucoes().some((x) => x.chave === chave);
  if (!ativaNoContrato) {
    return {
      ok: true, detalhe: 'desativada',
      aviso: 'ainda desativada - ative `ativa_em.devolucoes` quando as outras checagens ficarem verdes',
    };
  }
  if (!m) {
    // sem montagem = rodando fora do servidor (linha de comando)
    return { ok: true, detalhe: 'ativa (no contrato; sem servidor pra conferir se montou)' };
  }
  if (m.estado === 'montada') return { ok: true, detalhe: 'ativa e montada' };
  if (m.estado === 'desativada_por_env') {
    return { ok: false, detalhe: 'ativa no contrato mas FREADA por env',
      erro: `${require('../lib/montagem-empresas').nomeFreio(chave)}=1 esta ligada: a empresa NAO esta no ar. Remova a env pra voltar.` };
  }
  return { ok: false, detalhe: 'ativa no contrato mas FALHOU no boot',
    erro: 'a montagem falhou: veja /health -> montagem_empresas e o log do boot' };
});

async function sondar(chave, ctx) {
  const linhas = [];
  for (const { nome, fn } of CHECAGENS) {
    try {
      const r = await fn(chave, ctx);
      linhas.push({ nome, ...r });
    } catch (err) {
      linhas.push({ nome, ok: false, detalhe: `a checagem quebrou: ${(err && err.message) || err}` });
    }
  }
  return linhas;
}

module.exports = { sondar, CHECAGENS, classificarProvaBling, comPrazo };

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
    const jaAtiva = linhas.some((l) => l.nome === 'estado no contrato' && /^ativa/.test(String(l.detalhe || '')));
    if (bloqueia) {
      console.log(jaAtiva
        ? `  ❌ ${bloqueia} checagem(ns) reprovada(s) numa empresa JÁ ATIVA — conferir o que quebrou.`
        : `  ❌ ${bloqueia} checagem(ns) reprovada(s) — NÃO ative ainda.`);
    } else {
      console.log(jaAtiva
        ? '  ✅ tudo respondeu. A empresa está ativa e saudável.'
        : '  ✅ tudo respondeu. Pode ativar `ativa_em.devolucoes`.');
      console.log('');
      console.log('  ⚠️ E deixe o freio à mão para o caso de estranhar:');
      console.log(`     DEVOLUCOES_DESATIVAR_${chave.toUpperCase()}=1`);
    }
    console.log('');
    process.exit(bloqueia ? 1 : 0);
  })().catch((e) => { console.log('❌ ' + (e && e.message)); process.exit(1); });
}
