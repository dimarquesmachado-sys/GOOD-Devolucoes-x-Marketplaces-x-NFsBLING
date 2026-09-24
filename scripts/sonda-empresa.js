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

/* ── 3. o dono responde? (só se algum eixo estiver remoto) ───────── */
registrar('o dono entrega o token', async (chave) => {
  const tokenLeitor = require('../lib/token-leitor');
  const remotos = ['bling', 'ml']
    .filter((i) => tokenLeitor.politicaDe(chave, i) === 'remoto');
  // ⚠️ b427 (Codex, P2) - EM `sombra` TAMBÉM VALE PERGUNTAR.
  //
  // Antes eu pulava a checagem quando nada estava em `remoto` — mas `sombra` é
  // o PADRÃO, e em produção ela CHAMA o dono do mesmo jeito (lê, mede, e usa o
  // local). Pular aqui deixava o caminho mais usado sem nenhuma sonda.
  //
  // 📌 A diferença é o peso: em `sombra` o dono não responder é AVISO (a
  // empresa segue com o token local); em `remoto` é ERRO (nada sai).
  const sombras = ['bling', 'ml']
    .filter((i) => tokenLeitor.politicaDe(chave, i) === 'sombra');
  if (!remotos.length && !sombras.length) {
    return { ok: true, detalhe: 'nenhum eixo consulta o dono' };
  }

  const partes = [];
  let tudoOk = true;
  for (const integracao of [...remotos, ...sombras]) {
    const ehRemoto = remotos.includes(integracao);
    try {
      const d = await tokenLeitor.resolverToken(chave, integracao);
      // ⚠️ `usar: 'remoto'` é o único que prova que o dono respondeu COM token.
      const bom = d && !!d.access && (d.usar === 'remoto' || d.estado === 'ok');
      // ⚠️ só o eixo em `remoto` REPROVA: em `sombra` o token local salva.
      if (!bom && ehRemoto) tudoOk = false;
      partes.push(`${integracao}${ehRemoto ? '' : ' (sombra)'}: `
        + `${bom ? 'entregou' : (d && d.motivo) || 'sem token'}`);
    } catch (err) {
      if (ehRemoto) tudoOk = false;
      partes.push(`${integracao}: erro — ${(err && err.message) || err}`);
    }
  }
  return {
    ok: tudoOk,
    detalhe: partes.join(' | '),
    erro: tudoOk ? null : 'o dono não entregou o token — em `remoto` isso '
      + 'derruba TODA chamada ao marketplace desta empresa',
  };
});

/* ── 4. as tabelas existem no banco ──────────────────────────────── */
registrar('tabelas no Supabase', async (chave) => {
  const { obterEmpresa } = require('../lib/empresas');
  const { TABELAS_ESPERADAS } = require('../lib/provisionar-empresa');
  const e = obterEmpresa(chave);
  const suf = e && e.chaveDados;
  if (!suf) return { ok: false, detalhe: 'a ficha não declara `chaveDados`' };

  // ⚠️ b427 (Codex, P1) - AS 7, NÃO AS 5 DA FICHA.
  //
  // A ficha declara 5 — as que o app usa por nome. O ciclo de defeitos precisa
  // de mais 2, que o SQL cria e a ficha não cita. Montar a lista pela ficha
  // confere 5 de 7 e diz que está tudo certo.
  //
  // 📌 E o documento que EU escrevi já dizia "são 7". Li a fonte errada tendo
  // a certa na mão.
  const tabelas = TABELAS_ESPERADAS.map((b) => `${b}_${suf}`);

  const url = process.env[e.prefixoEnv + 'SUPABASE_URL'] || process.env.SUPABASE_URL;
  const key = process.env[e.prefixoEnv + 'SUPABASE_KEY'] || process.env.SUPABASE_KEY;
  if (!url || !key) return { ok: false, detalhe: 'sem credencial do Supabase no ambiente' };

  // ⚠️ b427 (Codex, P2) - "NÃO EXISTE" É DIFERENTE DE "NÃO CONSEGUI OLHAR".
  //
  // Antes, TODA resposta não-2xx virava "tabela faltando". Uma chave inválida
  // (401/403) ou o PostgREST fora do ar mandaria o dono rodar o provisionador
  // — que não resolveria nada, porque as tabelas podem estar lá.
  const ausentes = [];
  const naoOlhei = [];
  for (const t of tabelas) {
    try {
      // `limit=0`: pergunta se existe sem trazer UMA linha. Sonda não lê dado
      // de cliente pra responder "existe?".
      const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=0`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (r.ok) continue;
      // 404 (e o 400 do PostgREST pra relação inexistente) = não existe.
      // 401/403/5xx = problema de acesso ou do serviço, não da tabela.
      if (r.status === 404 || r.status === 400) ausentes.push(t);
      else naoOlhei.push(`${t} (HTTP ${r.status})`);
    } catch (err) {
      naoOlhei.push(`${t} (${(err && err.message) || 'sem resposta'})`);
    }
  }

  if (naoOlhei.length) {
    return {
      ok: false,
      detalhe: `não consegui conferir ${naoOlhei.length} de ${tabelas.length}`,
      erro: `${naoOlhei.slice(0, 2).join(', ')} — isto NÃO quer dizer que a `
        + 'tabela falta: pode ser chave inválida ou o Supabase fora',
    };
  }
  return {
    ok: ausentes.length === 0,
    detalhe: ausentes.length === 0
      ? `as ${tabelas.length} respondem`
      : `faltam ${ausentes.length} de ${tabelas.length}: ${ausentes.join(', ')}`,
    dica: ausentes.length
      ? 'cole sql/provisionar-empresa.sql no SQL Editor e rode '
        + `select provisionar_empresa('_${suf}');`
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
