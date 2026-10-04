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

    const r = await TESTAR[integracao](access, cfg[integracao].apiBase);
    if (r.aceito === false) {
      tudoOk = false;
      partes.push(`${integracao} (${politica}): o marketplace RECUSOU — ${r.motivo}`);
    } else if (r.aceito === true) {
      // b525 - AUDITORIA: no ML, confere se o token e da CONTA DESTA empresa (<PREFIXO>ML_USER_ID)
      const esperado = integracao === 'ml' ? String(process.env[(require('../lib/empresas').obterEmpresa(chave) || {}).prefixoEnv + 'ML_USER_ID'] || '').trim() : '';
      if (integracao === 'ml' && r.conta && esperado && r.conta.id !== esperado) {
        tudoOk = false;
        partes.push(`ml (${politica}): ⚠️ token de OUTRA conta — respondeu ${r.conta.id}${r.conta.apelido ? ' (' + r.conta.apelido + ')' : ''}, esperado ${esperado}`);
        continue;
      }
      partes.push(`${integracao} (${politica}): aceitou numa chamada real`
        + (integracao === 'ml' && r.conta ? (esperado ? ` — conta ${r.conta.id} CONFIRMADA` : ` — conta ${r.conta.id} (NAO VERIFICADA: falta ML_USER_ID da empresa)`) : ''));
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
registrar('captura recente', async (chave) => {
  const e = require('../lib/empresas').obterEmpresa(chave);
  const url = process.env[(e && e.prefixoEnv || '') + 'SUPABASE_URL'] || process.env.SUPABASE_URL;
  const key = process.env[(e && e.prefixoEnv || '') + 'SUPABASE_KEY'] || process.env.SUPABASE_KEY;
  if (!url || !key) return { ok: false, detalhe: 'NAO VERIFICADO — sem as envs do Supabase', erro: 'sem SUPABASE_URL/KEY' };
  try {
    const sb = require('@supabase/supabase-js').createClient(url, key);
    const emp = String((e && e.chaveDados) || chave).toLowerCase();
    const r = await sb.from('devolucoes_capturadas').select('*').eq('empresa', emp).order('visto_por_ultimo', { ascending: false }).limit(1);   // coluna que a captura renova a cada gravacao
    if (r.error) return { ok: false, detalhe: 'FALHOU — ' + r.error.message, erro: r.error.message };
    const l = (r.data || [])[0];
    if (!l) return { ok: true, detalhe: 'NAO VERIFICADO — nenhuma captura gravada ainda pra ' + emp, aviso: 'sem linha nenhuma: a captura nunca gravou nesta empresa (ou ela e nova)' };
    const quando = l.visto_por_ultimo || l.capturado_em;
    const horas = quando ? (Date.now() - new Date(quando).getTime()) / 3600e3 : null;
    if (horas == null) return { ok: true, detalhe: 'NAO VERIFICADO — a linha nao tem data' };
    if (horas > 6) return { ok: false, detalhe: 'FALHOU — ultima captura ha ' + Math.round(horas) + ' h', erro: 'a captura grava 1x/hora: mais de 6 h sem gravar e falha (veja /<empresa>/status -> captura)' };
    return { ok: true, detalhe: 'CONFIRMADO — ultima captura ha ' + Math.round(horas * 60) + ' min' };
  } catch (err) { return { ok: false, detalhe: 'NAO VERIFICADO — ' + ((err && err.message) || err) }; }
});

/* -- b525 - AUDITORIA: CANAIS (confirmado / falhou / nao aplicavel / nao verificado) ------------
   A sonda so testava Bling e ML. Aqui o estado de configuracao dos outros canais, sem chamar a API deles
   (Shopee vai pelo proxy; TikTok pela ponte com mapa FECHADO de lojas no Mover-Pedidos). */
registrar('canais (Magalu, Shopee, TikTok)', async (chave) => {
  const e = require('../lib/empresas').obterEmpresa(chave) || {};
  const pre = e.prefixoEnv || '';
  const tem = (n) => !!String(process.env[pre + n] || '').trim();
  const partes = [];
  // Magalu: token + tenant da empresa; credencial propria ou a da GOOD
  if (tem('MAGALU_ACCESS_TOKEN') || tem('MAGALU_REFRESH_TOKEN')) {
    partes.push('Magalu: ' + (tem('MAGALU_TENANT_ID') ? 'configurado' : 'FALHOU (falta ' + pre + 'MAGALU_TENANT_ID)')
      + (tem('MAGALU_CLIENT_ID') ? ' · credencial propria' : ' · usa a credencial da GOOD'));
  } else partes.push('Magalu: NAO APLICAVEL (sem token da empresa)');
  // Shopee: proxy compartilhado (o servico multi-loja)
  partes.push('Shopee: ' + ((process.env.SHOPEE_PROXY_URL && process.env.SHOPEE_PROXY_KEY) ? 'NAO VERIFICADO (proxy configurado; a loja e conferida no /' + chave + '/status)' : 'FALHOU (proxy sem SHOPEE_PROXY_URL/KEY)'));
  // TikTok: a ponte tem mapa fechado de lojas
  let tiktok = 'NAO VERIFICADO';
  try { const ponte = require('../lib/tiktok-ponte'); if (typeof ponte.lojaDaEmpresa === 'function') tiktok = ponte.lojaDaEmpresa(e.chaveDados || chave) ? 'mapeado na ponte' : 'NAO APLICAVEL (loja nao mapeada na ponte do Mover-Pedidos)'; } catch (err) { tiktok = 'NAO VERIFICADO'; }
  partes.push('TikTok: ' + tiktok);
  const falhou = partes.some((x) => /FALHOU/.test(x));
  return { ok: !falhou, detalhe: partes.join(' | '), erro: falhou ? 'algum canal configurado pela metade' : null };
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
  const { empresasAtivasNoDevolucoes } = require('../lib/empresas');
  const ativaNoContrato = empresasAtivasNoDevolucoes().some((x) => x.chave === chave);
  if (!ativaNoContrato) {
    return {
      ok: true, detalhe: 'desativada',
      aviso: 'ainda desativada - ative `ativa_em.devolucoes` quando as outras checagens ficarem verdes',
    };
  }
  let montagem = [];
  try { montagem = require('../lib/montagem-empresas').diagnostico(); } catch (e) { montagem = []; }
  const m = montagem.find((x) => x.chave === chave);
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
