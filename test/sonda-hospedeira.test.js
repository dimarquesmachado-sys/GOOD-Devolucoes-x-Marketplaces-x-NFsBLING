'use strict';
// b699 — A SONDA NAO REPROVA A HOSPEDEIRA PELO QUE ESTA CERTO, E DIZ O NOME DO QUE FALTA.
//
// ⚠️ O CASO (GOOD, 15/11/2026): a sonda da GOOD veio com 4 linhas reprovadas e `pode_ativar: false`, com a
// empresa operando. Lendo o codigo de cada uma:
//   - "tabelas": `esta empresa usa as tabelas SEM sufixo (a GOOD) — nada a criar`. E a resposta certa pro
//     PROVISIONADOR (nao ha o que criar) e a sonda a tratava como reprovacao — sem olhar tabela nenhuma;
//   - "Magalu: FALHOU (falta GOOD_MAGALU_TENANT_ID)": a raiz usa um tenant PADRAO do codigo quando a env nao
//     existe (lib/magalu-espreita.js). A env nao e obrigatoria la;
//   - "1 env(s) faltando": sem o NOME. A dica era um comando de terminal; quem opera pelo navegador nao tinha
//     como saber qual.
// Vermelho falso ensina a ignorar o vermelho — e a sonda e quem diz `pode_ativar`.
//
// ⚠️ Roda as checagens DE PRODUCAO (scripts/sonda-empresa.js). So o Supabase e de mentira (`global.fetch`).
//
// Roda com: node test/sonda-hospedeira.test.js

const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

const { CHECAGENS } = require('../scripts/sonda-empresa');
const empresas = require('../lib/empresas');
const { sufixoDaFicha, TABELAS_ESPERADAS } = require('../lib/provisionar-empresa');
const checagem = (re) => CHECAGENS.find((c) => re.test(c.nome));

/** troca envs so durante o bloco, e devolve tudo como estava */
async function comEnv(mudancas, bloco) {
  const antes = {};
  for (const [k, v] of Object.entries(mudancas)) {
    antes[k] = process.env[k];
    if (v === null) delete process.env[k]; else process.env[k] = v;
  }
  try { return await bloco(); }
  finally { for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
function jwtDeMentira(role) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.assinatura-de-teste`;
}

(async () => {
  // ════════ A — a ficha diz o NOME do que falta (nunca o valor) ════════
  {
    const ficha = checagem(/ficha/).fn;
    const conferirReal = empresas.conferirEmpresa;
    try {
      empresas.conferirEmpresa = () => ({ envsFaltando: ['GOOD_USERS'], fiscalSemValor: [] });
      let r = await ficha('good');
      ok(r.ok === false && /1 env\(s\) e 0 campo\(s\) fiscal\(is\) faltando/.test(r.detalhe), 'A1 uma env faltando: reprova, com a contagem de sempre');
      ok(r.erro === 'falta: env GOOD_USERS', '⚠️ e agora diz QUAL (' + r.erro + ')');
      ok(/plugar-empresa\.js good/.test(r.dica || ''), '   a dica do comando continua (pra quem tem terminal)');

      empresas.conferirEmpresa = () => ({ envsFaltando: ['AMB_USERS', 'AMB_SESSION_SECRET (curto, min 16 chars)'], fiscalSemValor: ['depositoGeral', 'idEmpresaControl'] });
      r = await ficha('ambtotal');
      ok(r.erro === 'falta: env AMB_USERS · env AMB_SESSION_SECRET (curto, min 16 chars) · campo fiscal depositoGeral · campo fiscal idEmpresaControl',
         'A2 varias: envs e campos fiscais, cada um com o seu rotulo');

      empresas.conferirEmpresa = () => ({ envsFaltando: [], fiscalSemValor: [] });
      r = await ficha('good');
      ok(r.ok === true && r.detalhe === 'nada faltando' && r.erro == null && r.dica == null, 'A3 nada faltando: aprova, sem erro e sem dica');
    } finally { empresas.conferirEmpresa = conferirReal; }

    // com o conferidor DE VERDADE: a contagem e os nomes saem do mesmo lugar, e valor de env nao aparece
    await comEnv({ GIRASSOL_SESSION_SECRET: 'zz9-segredo', GIRASSOL_BLING_CLIENT_SECRET: null }, async () => {
      const r = await ficha('girassol');
      const m = /(\d+) env\(s\) e (\d+) campo\(s\)/.exec(r.detalhe || '') || [];
      const itens = String(r.erro || '').replace(/^falta: /, '').split(' · ');
      ok(r.ok === false && itens.filter((x) => x.startsWith('env ')).length === Number(m[1]) && itens.filter((x) => x.startsWith('campo fiscal ')).length === Number(m[2]),
         'A4 conferidor de producao: tantos nomes quantos a contagem diz (' + m[1] + ' env + ' + m[2] + ' fiscal)');
      ok(/env GIRASSOL_BLING_CLIENT_SECRET/.test(r.erro) && /env GIRASSOL_SESSION_SECRET \(curto/.test(r.erro), '   com o nome exato da env (e o motivo, quando e "curto")');
      ok(!/zz9-segredo/.test(JSON.stringify(r)), '⚠️ o VALOR da env nao aparece em lugar nenhum da resposta');
    });
  }

  // ════════ A' — o segredo de sessao da hospedeira e o que a RAIZ le, nao um nome que ninguem le ════════
  {
    const fs = require('fs');
    const servidor = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
    ok(/process\.env\.ADMIN_SESSION_SECRET \|\| process\.env\.SESSION_SECRET/.test(servidor) && !/GOOD_SESSION_SECRET/.test(servidor),
       "A'1 a raiz le `ADMIN_SESSION_SECRET || SESSION_SECRET` — e NAO le `GOOD_SESSION_SECRET`");
    const faltando = () => empresas.conferirEmpresa('good').envsFaltando.filter((n) => /SESSION_SECRET/.test(n));
    const limpo = { ADMIN_SESSION_SECRET: null, SESSION_SECRET: null, GOOD_SESSION_SECRET: null };
    await comEnv(Object.assign({}, limpo, { ADMIN_SESSION_SECRET: 'segredo-da-raiz-com-mais-de-16-chars' }), async () => {
      ok(faltando().length === 0, "⚠️ A'2 GOOD com `ADMIN_SESSION_SECRET` (como a producao): nada faltando — antes pedia `GOOD_SESSION_SECRET` pra sempre");
    });
    await comEnv(Object.assign({}, limpo, { SESSION_SECRET: 'segredo-antigo-da-raiz-com-16-chars' }), async () => {
      ok(faltando().length === 0, '   o nome antigo (`SESSION_SECRET`) tambem vale, como na raiz');
    });
    await comEnv(limpo, async () => {
      ok(JSON.stringify(faltando()) === JSON.stringify(['ADMIN_SESSION_SECRET']), "A'3 sem nenhum dos dois: falta, e pelo nome que a raiz le (" + faltando().join() + ')');
    });
    await comEnv(Object.assign({}, limpo, { ADMIN_SESSION_SECRET: 'curto' }), async () => {
      ok(faltando().length === 1 && /^ADMIN_SESSION_SECRET \(curto, min 16 chars\)$/.test(faltando()[0]), '   curto demais: acusa, com o mesmo minimo da raiz');
    });
    await comEnv(Object.assign({}, limpo, { ADMIN_SESSION_SECRET: 'curto', SESSION_SECRET: 'segredo-antigo-da-raiz-com-16-chars' }), async () => {
      ok(faltando().length === 1, '   `ADMIN_SESSION_SECRET` curto ganha do antigo comprido — a raiz escolhe na mesma ordem');
    });
    await comEnv(Object.assign({}, limpo, { GOOD_SESSION_SECRET: 'segredo-que-ninguem-le-com-16-chars' }), async () => {
      ok(JSON.stringify(faltando()) === JSON.stringify(['ADMIN_SESSION_SECRET']), "⚠️ A'4 so `GOOD_SESSION_SECRET`: continua faltando — criar a env que ninguem le nao deixa a GOOD pronta");
    });
    // a fabrica nao muda: cada empresa segue com o segredo dela, pelo prefixo
    await comEnv({ ADMIN_SESSION_SECRET: 'segredo-da-raiz-com-mais-de-16-chars', GIRASSOL_SESSION_SECRET: null, AMB_SESSION_SECRET: null }, async () => {
      const gira = empresas.conferirEmpresa('girassol').envsFaltando.filter((n) => /SESSION_SECRET/.test(n));
      const amb = empresas.conferirEmpresa('ambtotal').envsFaltando.filter((n) => /SESSION_SECRET/.test(n));
      ok(JSON.stringify(gira) === JSON.stringify(['GIRASSOL_SESSION_SECRET']) && JSON.stringify(amb) === JSON.stringify(['AMB_SESSION_SECRET']),
         "⚠️ A'5 empresa da FABRICA: o segredo da raiz NAO serve pra ela — segue faltando o dela (" + gira.join() + ', ' + amb.join() + ')');
    });
  }

  // ════════ B — tabelas: a hospedeira (sem sufixo) e CONFERIDA, nao reprovada ════════
  {
    ok(sufixoDaFicha({ tabelas: { devolucoes: 'devolucoes' } }).ok === false && sufixoDaFicha({ tabelas: { devolucoes: 'devolucoes' } }).semSufixo === true,
       'B1 ficha sem sufixo: continua "nada a criar" pro provisionador, e agora com o sinal `semSufixo`');
    for (const ruim of [{}, { tabelas: {} }, { tabelas: { devolucoes: 'outra_coisa' } }, { tabelas: { devolucoes: 'devolucoes_' } }]) {
      const s = sufixoDaFicha(ruim);
      ok(s.ok === false && !s.semSufixo, '   ficha errada (' + JSON.stringify(ruim) + ') NAO ganha o sinal: continua reprovando');
    }

    const tabelas = checagem(/Supabase/).fn;
    const fetchReal = global.fetch;
    const visto = { urls: [] };
    let ausente = null;
    global.fetch = async (url) => {
      const u = String(url);
      visto.urls.push(u);
      const nome = (/\/rest\/v1\/([a-z_0-9]+)\?/.exec(u) || [])[1];
      if (nome === ausente) return { ok: false, status: 404, json: async () => ({ code: 'PGRST205', message: `Could not find the table 'public.${nome}' in the schema cache` }) };
      return { ok: true, status: 200, json: async () => [] };
    };
    const banco = { SUPABASE_URL: 'http://sb.invalid', SUPABASE_KEY: jwtDeMentira('service_role'), GOOD_SUPABASE_URL: null, GOOD_SUPABASE_KEY: null, GIRASSOL_SUPABASE_URL: null, GIRASSOL_SUPABASE_KEY: null,
      AMB_SUPABASE_URL: null, AMB_SUPABASE_KEY: null };
    try {
      await comEnv(banco, async () => {
        visto.urls = []; ausente = null;
        let r = await tabelas('good');
        const nomes = visto.urls.map((u) => (/\/rest\/v1\/([a-z_0-9]+)\?/.exec(u) || [])[1]);
        ok(r.ok === true && r.detalhe === `as ${TABELAS_ESPERADAS.length} respondem`, '⚠️ B2 GOOD com as tabelas no lugar: APROVA (antes reprovava sem olhar nenhuma)');
        ok(JSON.stringify(nomes.slice().sort()) === JSON.stringify(TABELAS_ESPERADAS.slice().sort()), '   e olhou as ' + TABELAS_ESPERADAS.length + ' de verdade, SEM sufixo (' + nomes.join(', ') + ')');
        ok(visto.urls.every((u) => /[?&]limit=0(&|$)/.test(u)) && !visto.urls.some((u) => /_good/.test(u)), '   com `limit=0`, e nunca `_good` (o sufixo reservado que nao existe)');

        visto.urls = []; ausente = 'defeito_pedidos';
        r = await tabelas('good');
        ok(r.ok === false && r.detalhe === `faltam 1 de ${TABELAS_ESPERADAS.length}: defeito_pedidos`, '⚠️ B3 tabela da hospedeira faltando de verdade: REPROVA e diz qual');
        ok(!/provisionar_empresa\(/.test(r.dica || '') && /hospedeira/.test(r.dica || ''), '   sem mandar rodar o provisionador (ele so cria tabela COM sufixo)');

        visto.urls = []; ausente = 'recados_girassol';
        r = await tabelas('girassol');
        ok(r.ok === false && /faltam 1 de \d+: recados_girassol/.test(r.detalhe) && /provisionar_empresa\('_girassol'\)/.test(r.dica || ''),
           'B4 empresa com sufixo: nada muda — reprova e aponta o provisionador com o sufixo dela');
        visto.urls = []; ausente = null;
        r = await tabelas('girassol');
        ok(r.ok === true && visto.urls.length === TABELAS_ESPERADAS.length && visto.urls.every((u) => /_girassol\?/.test(u)), '   e com tudo no lugar aprova, olhando as tabelas `_girassol`');

        // b700: a AMB e o MOLDE — o provisionador RECUSA `_amb` ("sufixo reservado"). A dica nao pode mandar roda-lo.
        visto.urls = []; ausente = 'tags_amb';
        r = await tabelas('ambtotal');
        ok(r.ok === false && r.detalhe === `faltam 1 de ${TABELAS_ESPERADAS.length}: tags_amb`, "⚠️ B4' AMB sem uma tabela: REPROVA e diz qual");
        ok(!/provisionar_empresa\(/.test(r.dica || '') && /reservado/.test(r.dica || ''), '   sem mandar rodar o provisionador, que recusa o sufixo reservado `_amb`');
        const sqlDasTags = (/sql\/[0-9a-z-]+tags[0-9a-z-]*\.sql/.exec(r.dica || '') || [])[0];
        ok(!!sqlDasTags && require('fs').existsSync(path.join(RAIZ, sqlDasTags)), '   e o SQL das etiquetas que a dica aponta existe no repositorio (' + sqlDasTags + ')');
      });
      await comEnv(Object.assign({}, banco, { SUPABASE_KEY: jwtDeMentira('anon') }), async () => {
        visto.urls = [];
        const r = await tabelas('good');
        ok(r.ok === false && /anon/.test(r.detalhe) && visto.urls.length === 0, 'B5 a hospedeira passa pelas mesmas travas: chave `anon` reprova sem chamar a rede');
      });

      // ficha com nome de tabela que nao da pra entender: continua reprovando, sem olhar nada
      const obterReal = empresas.obterEmpresa;
      try {
        empresas.obterEmpresa = (c) => Object.assign({}, obterReal(c), { tabelas: { devolucoes: 'outra_coisa' } });
        await comEnv(banco, async () => {
          visto.urls = [];
          const r = await tabelas('girassol');
          ok(r.ok === false && /nao consigo deduzir o sufixo/.test(r.detalhe) && visto.urls.length === 0, 'B6 ficha com tabela fora do padrao: reprova como antes (so o "sem sufixo" deixou de ser erro)');
        });
      } finally { empresas.obterEmpresa = obterReal; }
    } finally { global.fetch = fetchReal; }
  }

  // ════════ C — Magalu: a raiz tem tenant padrao no codigo; a fabrica nao ════════
  {
    const moduloMagalu = require('../lib/magalu-espreita');
    const PADRAO = moduloMagalu.TENANT_PADRAO_DA_RAIZ;
    ok(typeof PADRAO === 'string' && PADRAO.length > 0, 'C1 o tenant padrao da raiz tem nome e sai no export (' + PADRAO + ')');

    // a producao usa esse mesmo valor: sem a env, o cabecalho e o caminho levam o padrao; com a env, a env
    const chamadas = [];
    const chamarMagalu = async (url, opts) => { chamadas.push({ url, tenant: opts && opts.headers && opts.headers['x-tenant-id'] }); return { ok: true, data: { records: [], meta: { totalRecords: 0 } } }; };
    /** monta o indice de producao em silencio (ele anuncia o total no log) — o `ok` fala depois */
    const montarCalado = async (env) => {
      const falar = console.log; console.log = () => {};
      try { await comEnv(env, async () => { await moduloMagalu({ chamarMagalu }).construirIndice(); }); }
      finally { console.log = falar; }
    };
    await montarCalado({ MAGALU_TENANT_ID: null });
    ok(chamadas.length === 3 && chamadas.every((c) => c.tenant === PADRAO && c.url.endsWith('/' + PADRAO + '?limit=50&offset=0')), '⚠️ C2 sem MAGALU_TENANT_ID a raiz consulta o Magalu com o padrao — a env NAO e obrigatoria la');
    chamadas.length = 0;
    await montarCalado({ MAGALU_TENANT_ID: 'outro-tenant' });
    ok(chamadas.length === 3 && chamadas.every((c) => c.tenant === 'outro-tenant'), '   e com a env, vale a env');

    const canais = checagem(/canais/).fn;
    const E = { MAGALU_ACCESS_TOKEN: null, MAGALU_REFRESH_TOKEN: null, MAGALU_TENANT_ID: null, GOOD_MAGALU_ACCESS_TOKEN: null, GOOD_MAGALU_REFRESH_TOKEN: null, GOOD_MAGALU_TENANT_ID: null,
      GIRASSOL_MAGALU_ACCESS_TOKEN: null, GIRASSOL_MAGALU_REFRESH_TOKEN: null, GIRASSOL_MAGALU_TENANT_ID: null, SHOPEE_PROXY_URL: 'x', SHOPEE_PROXY_KEY: 'y', MOVER_PEDIDOS_URL: 'http://m.invalid', MOVER_PEDIDOS_KEY: 'k' };
    await comEnv(Object.assign({}, E, { MAGALU_ACCESS_TOKEN: 'tok' }), async () => {
      const r = await canais('good');
      ok(new RegExp('Magalu: configurado \\(tenant padrao do codigo: ' + PADRAO + '\\)').test(r.detalhe) && !/Magalu: FALHOU/.test(r.detalhe),
         '⚠️ C3 GOOD com token e sem a env do tenant: configurado pelo padrao do codigo — nao "FALHOU (falta GOOD_MAGALU_TENANT_ID)"');
      ok(!/Magalu: NAO APLICAVEL/.test(r.detalhe) && r.ok === true, '   (o token legado sem prefixo continua sendo visto, e a checagem passa)');
    });
    await comEnv(Object.assign({}, E, { MAGALU_ACCESS_TOKEN: 'tok', GOOD_MAGALU_TENANT_ID: 'tenant-da-env' }), async () => {
      const r = await canais('good');
      ok(/Magalu: configurado ·/.test(r.detalhe) && !/padrao do codigo/.test(r.detalhe), 'C4 GOOD com a env do tenant: "configurado", sem falar em padrao');
    });
    await comEnv(Object.assign({}, E, { GIRASSOL_MAGALU_ACCESS_TOKEN: 'tok' }), async () => {
      const r = await canais('girassol');
      ok(/Magalu: FALHOU \(falta GIRASSOL_MAGALU_TENANT_ID\)/.test(r.detalhe) && r.ok === false, '⚠️ C5 empresa da FABRICA sem tenant: continua FALHOU — o padrao e so da raiz (a fabrica exige a env)');
    });
    await comEnv(E, async () => {
      const r = await canais('good');
      ok(/Magalu: NAO APLICAVEL/.test(r.detalhe), 'C6 GOOD sem token nenhum do Magalu: NAO APLICAVEL (o padrao do tenant nao inventa canal)');
    });
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + ((e && e.stack) || e)); process.exit(1); });
