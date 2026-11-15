// Roda com: node test/migracao-prefixo.test.js
//
// [stated 05/09] "na minha visão tinha q arrumar a casa toda logo, não? meu
// medo é lá na frente essa regra ser esquecida, falhar, quebrar alguma
// coisa. se todas empresas estiverem no padrão, pronto."
//
// Ele está certo: regra com exceção é regra que alguém esquece. O alvo é
// TODA empresa usar `<EMPRESA>_ALGO`.
//
// A GOOD nasceu sem prefixo (era a única empresa). A migração é em 3
// tempos, e o passo 1 é este: o código aceita OS DOIS nomes, então nada
// quebra enquanto ele cria as variáveis novas no Render.
//
// ⚠️ ESTE TESTE EXISTE POR UM BUG REAL: minha primeira edição comeu o
// `return` final do `envDaEmpresa`, e a função devolvia `undefined` em todo
// caminho que não fosse o fallback — inclusive para a AMB, que nem tem
// histórico. Só apareceu porque testei em processo limpo, com env de
// verdade. Testar só o caso que eu tinha acabado de escrever teria passado.

const { execFileSync } = require('child_process');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

/** Lê uma env pelo registro, num processo LIMPO (env controlada). */
function ler(empresa, nome, envs, tipo) {
  const codigo = `const r=require(${JSON.stringify(path.join(RAIZ, 'lib', 'empresas.js'))});`
    + `process.stdout.write(String(r.envDaEmpresa(r.obterEmpresa(${JSON.stringify(empresa)}),`
    + `${JSON.stringify(nome)}, '(vazio)'${tipo ? ', ' + JSON.stringify(tipo) : ''})));`;
  return execFileSync(process.execPath, ['-e', codigo],
    { env: { PATH: process.env.PATH, ...envs } }).toString();
}

// ── os 3 tempos da migração, na ordem em que vão acontecer ──────────
{
  ok(ler('good', 'BLING_CLIENT_ID', { BLING_CLIENT_ID: 'antigo' }) === 'antigo',
     'TEMPO 1 (hoje): so a var antiga existe -> acha pelo historico, nada quebra');

  ok(ler('good', 'BLING_CLIENT_ID', { BLING_CLIENT_ID: 'antigo', GOOD_BLING_CLIENT_ID: 'novo' }) === 'novo',
     'TEMPO 2: as duas existem -> a NOVA manda (e o que permite migrar sem pressa)');

  ok(ler('good', 'BLING_CLIENT_ID', { GOOD_BLING_CLIENT_ID: 'novo' }) === 'novo',
     'TEMPO 3: so a nova -> funciona, e o fallback pode sair do codigo');
}

// ── ⚠️ o que o bug do `return` sumido teria quebrado ────────────────
{
  ok(ler('ambtotal', 'BLING_CLIENT_ID', { AMB_BLING_CLIENT_ID: 'amb-ok' }) === 'amb-ok',
     'a AMB (ja no padrao) le normal — nao passa pelo fallback');
  ok(ler('good', 'DEPOSITO_GERAL', { GOOD_DEPOSITO_GERAL: 'dep' }, 'fiscal') === 'dep',
     'o campo FISCAL da GOOD ja era GOOD_ e nao foi tocado');
  ok(ler('good', 'BLING_CLIENT_ID', {}) === '(vazio)',
     'sem nenhuma das duas -> devolve o padrao (nao `undefined`)');
}

// ── ⚠️ b250.1 (P1): a GOOD nao le pelo registro ─────────────────────
//
// O apontamento derrubou meu passo 1: eu tinha posto o leitor de dois nomes
// no `lib/empresas.js`, mas o `server.js` usa `lib/bling.js` e `lib/ml.js`,
// que liam `process.env.BLING_*` DIRETO. Criar as vars novas no Render nao
// teria efeito nenhum — e ele acharia que tinha migrado.
{
  const fs2 = require('fs');
  for (const arq of ['lib/bling.js']) {
    const src = fs2.readFileSync(path.join(RAIZ, arq), 'utf8');
    const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

    ok(/const envGood = /.test(codigo),
       arq + ': tem o leitor de dois nomes (GOOD_ primeiro, historico depois)');
    const direto = [...codigo.matchAll(/process\.env\.((?:BLING|ML)_[A-Z_]+)/g)].map((m) => m[1]);
    ok(direto.length === 0,
       '  e NAO le nenhuma env com prefixo direto'
       + (direto.length ? ' (SOBRARAM: ' + direto.join(', ') + ')' : ''));

    // ⚠️ e a gravacao do token durante a migracao: nos DOIS nomes, senao
    // a primeira renovacao deixa o antigo velho e nao da pra voltar atras
    ok(/const chavesToken = /.test(codigo),
       '  e grava o token nos dois nomes enquanto migra');
  }
}

// ── b702: o ML da GOOD e a PECA UNICA (ml-AMB.js) — a migracao vale la, por COMPORTAMENTO ──
//
// `lib/ml.js` virou um adaptador sobre `criar(configDaEmpresa('good'))`: nao tem mais `envGood` nem `chavesToken`.
// O que o bloco acima guardava continua valendo e e exercitado aqui de verdade, num processo limpo com env
// controlada: a leitura pelo registro (GOOD_ primeiro, historico depois) e a GRAVACAO do token nos DOIS nomes enquanto
// o historico existir — senao a primeira renovacao deixa `ML_REFRESH_TOKEN` com o refresh ja consumido e nao da pra
// voltar atras. Empresa sem historico (a Girassol) grava so o nome dela.
{
  const roda = (empresa, envs) => {
    const codigo = `
      const path = require('path'); const RAIZ = ${JSON.stringify(RAIZ)};
      const abs = (p) => require.resolve(path.join(RAIZ, p));
      const gravados = [];
      require.cache[abs('lib/render-tokens.js')] = { id: abs('lib/render-tokens.js'), filename: abs('lib/render-tokens.js'), loaded: true,
        exports: { atualizarTokensNoRender: async (lista) => { gravados.push(...lista.map((x) => x.key)); return true; } } };
      console.warn = () => {}; console.log = () => {};
      const { configDaEmpresa } = require(abs('lib/config-da-empresa.js'));
      const ml = require(abs('amb-devolucoes/lib-AMB/ml-AMB.js')).criar(configDaEmpresa(${JSON.stringify(empresa)}));
      (async () => {
        await ml.definirTokens('ACESSO-NOVO', 'REFRESH-NOVO');
        process.stdout.write(JSON.stringify({ temToken: ml.temToken(), gravados: gravados.sort(), carimbo: ml.preventiva.parEnvCarimbo().key }));
      })();`;
    return JSON.parse(execFileSync(process.execPath, ['-e', codigo], { env: { PATH: process.env.PATH, ADMIN_TOKEN_LEITURA_KEY: 'k', ...envs } }).toString());
  };

  const t1 = roda('good', { ML_ACCESS_TOKEN: 'antigo', ML_REFRESH_TOKEN: 'r-antigo', ML_RENOVADO_EM: '1700000000000' });
  ok(JSON.stringify(t1.gravados) === JSON.stringify(['GOOD_ML_ACCESS_TOKEN', 'GOOD_ML_REFRESH_TOKEN', 'ML_ACCESS_TOKEN', 'ML_REFRESH_TOKEN', 'ML_RENOVADO_EM']),
     'TEMPO 1 (GOOD, so o nome antigo no Render): grava o token nos DOIS nomes — ' + t1.gravados.join(', '));
  ok(t1.carimbo === 'ML_RENOVADO_EM', '  e o carimbo da preventiva segue no nome antigo enquanto so ele existir (senao gastaria um refresh no 1o boot)');

  const t2 = roda('good', { ML_ACCESS_TOKEN: 'antigo', GOOD_ML_ACCESS_TOKEN: 'novo', GOOD_ML_REFRESH_TOKEN: 'r-novo', ML_REFRESH_TOKEN: 'r-antigo', GOOD_ML_RENOVADO_EM: '1700000000000' });
  ok(t2.gravados.includes('GOOD_ML_ACCESS_TOKEN') && t2.gravados.includes('ML_ACCESS_TOKEN') && t2.carimbo === 'GOOD_ML_RENOVADO_EM',
     'TEMPO 2 (os dois existem): grava nos dois, e o carimbo ja e o novo');

  const t3 = roda('good', { GOOD_ML_ACCESS_TOKEN: 'novo', GOOD_ML_REFRESH_TOKEN: 'r-novo' });
  ok(JSON.stringify(t3.gravados) === JSON.stringify(['GOOD_ML_ACCESS_TOKEN', 'GOOD_ML_REFRESH_TOKEN', 'GOOD_ML_RENOVADO_EM']) && t3.temToken === true,
     'TEMPO 3 (so o novo): grava so no padrao — o nome antigo nao renasce');

  const gira = roda('girassol', { GIRASSOL_ML_ACCESS_TOKEN: 'g', GIRASSOL_ML_REFRESH_TOKEN: 'rg', ML_ACCESS_TOKEN: 'da-good', ML_REFRESH_TOKEN: 'r-da-good' });
  ok(JSON.stringify(gira.gravados) === JSON.stringify(['GIRASSOL_ML_ACCESS_TOKEN', 'GIRASSOL_ML_REFRESH_TOKEN', 'GIRASSOL_ML_RENOVADO_EM']),
     '⚠️ empresa SEM historico (Girassol) grava so o nome dela — mesmo com `ML_*` da GOOD no ambiente');
}

// ── ⚠️ b250.2 (P1+P2): o SERVER tambem, nao so os modulos ───────────
//
// Eu tinha coberto `lib/bling.js` e `lib/ml.js` e esquecido o `server.js`,
// que lia `USERS` e `ML_USER_ID` direto. Quando ele apagasse as antigas:
// sem `USERS` NINGUEM LOGA, sem `ML_USER_ID` os envios ficam sem
// destinatario. Silencioso nos dois.
{
  const fs3 = require('fs');
  const src = fs3.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  ok(/const envGood = /.test(codigo), 'server.js tem o leitor de dois nomes');

  for (const v of ['USERS', 'ML_USER_ID', 'ADMIN_USER']) {
    ok(!new RegExp('process\\.env\\.' + v + '\\b').test(codigo),
       '  `' + v + '` passa pelo leitor (nao le direto)');
  }

  // ⚠️ e a declaracao vem ANTES do primeiro uso. O `node --check` NAO pega
  // isso — so o boot real: minha 1a versao punha o `envGood` na linha 99 e
  // usava na 55, e o servidor morria com "Cannot access before
  // initialization". Em producao seria o serviço inteiro fora do ar.
  const decl = codigo.indexOf('const envGood = ');
  const usos = [...codigo.matchAll(/envGood\('/g)].map((m) => m.index);
  ok(usos.length > 0 && Math.min(...usos) > decl,
     '  e a declaracao vem ANTES do 1o uso (o node --check nao pega isso)');
}

// ── ⚠️ a regra que derruba produção se for esquecida ────────────────
//
// O nome aparece em DOIS lugares: quem lê a env e quem GRAVA o token
// renovado de volta no Render. Se mudar um e esquecer o outro, o token é
// salvo num nome que ninguém lê — e a integração cai no próximo restart,
// sem erro aparente.
{
  const fs = require('fs');
  for (const arq of ['lib/bling.js', 'lib/ml.js']) {
    const src = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
    const lidas = new Set([...src.matchAll(/process\.env\.((?:BLING|ML)_[A-Z_]+)/g)].map((m) => m[1]));
    // agora a gravacao passa pelo `chavesToken(...)`, que devolve o nome
    // novo E o historico — entao conto os nomes citados la
    const gravadas = [...src.matchAll(/chavesToken\('((?:BLING|ML)_[A-Z_]+)'\)/g)].map((m) => m[1]);
    const orfas = gravadas.filter((g) => !new RegExp("envGood\\('" + g + "'\\)").test(src));
    ok(orfas.length === 0,
       arq + ': todo token GRAVADO tem o mesmo nome do que e LIDO'
       + (orfas.length ? ' (ORFAS: ' + orfas.join(', ') + ')' : ''));
  }
}

// ── b250.3: a copia das envs, sem ele digitar nada ──────────────────
//
// [stated] "eu crio só a key, e vc faz algum sisteminha que pega e já
// preenche o value lá dentro do render não?"
//
// ⚠️ Isto ESCREVE CREDENCIAL no Render. As travas importam mais que a
// funcionalidade.
{
  const { migrarEnvsDaGood, DE_PARA_GOOD } = require('../lib/migrar-envs');
  const salvos = { ...process.env };
  const limpar = () => {
    for (const k of Object.keys(process.env)) if (!(k in salvos)) delete process.env[k];
    Object.assign(process.env, salvos);
  };

  (async () => {
    // ── a simulacao NAO pode gravar ──────────────────────────────────
    process.env.BLING_CLIENT_ID = 'antigo';
    let gravou = null;
    // ⚠️ o escritor agora recebe uma FUNCAO (b250.5): a leitura tem que
    // acontecer DENTRO da fila, senao uma rotacao de token concorrente faz
    // a migracao gravar o refresh VELHO por cima do novo.
    const escritor = async (u) => { gravou = (typeof u === 'function' ? u() : u); return true; };

    const sim = await migrarEnvsDaGood(escritor, { simular: true });
    ok(sim.simulacao === true && gravou === null,
       'a simulacao mostra o plano e NAO grava nada');

    // ── nao sobrescreve o que ele ja criou a mao ─────────────────────
    process.env.GOOD_ADMIN_USER = 'feito-a-mao';
    process.env.ADMIN_USER = 'antigo';
    gravou = null;
    await migrarEnvsDaGood(escritor);
    ok(!(gravou || []).some((x) => x.key === 'GOOD_ADMIN_USER'),
       'NAO sobrescreve a var que ele ja criou');

    // ── nao inventa valor vazio ──────────────────────────────────────
    //
    // Gravar '' seria pior que nao gravar: o fallback do codigo testa
    // `!== ''`, entao a var vazia MATA o caminho de volta.
    limpar();
    gravou = null;
    await migrarEnvsDaGood(escritor);   // sem nenhuma env antiga
    ok((gravou || []).length === 0, 'sem a var antiga, nao grava nada (nem vazio)');

    // ── e so as vars DA EMPRESA entram ───────────────────────────────
    for (const infra of ['EMAIL_HOST', 'QZ_CERT', 'RENDER', 'SUPABASE_URL', 'ADMIN_KEY']) {
      ok(!DE_PARA_GOOD.includes(infra),
         '  `' + infra + '` NAO migra (e do servico, nao do CNPJ)');
    }
    ok(DE_PARA_GOOD.length === 17,
       'sao as 17 vars da empresa (Bling, ML, login, Magalu e a loja Shopee)');
    for (const v of ['MAGALU_CLIENT_ID', 'SHOPEE_LOJA_KEY']) {
      ok(DE_PARA_GOOD.includes(v), '  ' + v + ' migra (e da GOOD)');
    }
    // ⚠️ o proxy da Shopee e UM SO pras 3 empresas — nao migra
    ok(!DE_PARA_GOOD.includes('SHOPEE_PROXY_URL'),
       '  mas o PROXY da Shopee nao (e compartilhado)');

    // ── b250.4 (P1): o valor e RELIDO na hora de gravar ──────────────
    //
    // Se uma rotacao de token passar na frente da minha gravacao, eu
    // gravaria o refresh VELHO por cima do novo — e refresh consumido mata
    // a integracao no proximo restart.
    {
      const fsx = require('fs');
      const src = fsx.readFileSync(path.join(RAIZ, 'lib', 'migrar-envs.js'), 'utf8');
      // ⚠️ b250.5: releitura NAO BASTA — tem que ser DENTRO da fila. Meu
      // primeiro conserto releu, mas o `.map()` rodava ao montar o
      // argumento, antes de enfileirar. O Codex apontou duas vezes.
      ok(/atualizarTokensNoRender\(\(\) =>/.test(src),
         'a migracao passa uma FUNCAO (a leitura roda dentro da fila)');
      const fila = fsx.readFileSync(path.join(RAIZ, 'lib', 'render-tokens.js'), 'utf8');
      ok(/typeof updates === 'function' \? updates\(\) : updates/.test(fila),
         '  e a fila resolve a funcao quando chega a vez, nao antes');
    }

    // ── b250.4 (P2): a lista do historico e INVERTIDA ────────────────
    //
    // Lista fechada ("aceito BLING|ML|USERS") rejeitava MAGALU_* e
    // SHOPEE_LOJA_KEY, que a GOOD tambem tem sem prefixo — e o
    // `configDaEmpresa('good')` devolveria Magalu vazio.
    {
      const reg2 = require('../lib/empresas.js');
      const good2 = reg2.obterEmpresa('good');
      for (const daEmpresa of ['BLING_CLIENT_ID', 'MAGALU_CLIENT_ID', 'SHOPEE_LOJA_KEY', 'USERS']) {
        ok(good2.nomeHistorico(daEmpresa) === daEmpresa,
           '  `' + daEmpresa + '` herda o nome historico');
      }
      for (const doServico of ['EMAIL_HOST', 'QZ_CERT', 'SUPABASE_URL', 'ADMIN_KEY']) {
        ok(good2.nomeHistorico(doServico) === null,
           '  `' + doServico + '` NAO herda (e do servico)');
      }
    }

    // ── b250.4 (P2): GET nao muta sem pedido explicito ───────────────
    {
      const fsy = require('fs');
      const srv2 = fsy.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
      const i2 = srv2.indexOf("app.get('/api/admin/migrar-envs'");
      // ⚠️ marcadores, nao janela fixa: o bloco cresceu com o 405 e o
    // comentario, e 900 chars nao alcancavam mais. E a licao do dia (b322).
    const { entreMarcadores } = require('./_recorte');
    const rota = entreMarcadores(srv2,
      "app.get('/api/admin/migrar-envs'", 'app.get(');
      ok(/const gravar = false;/.test(rota),
         '⚠️ b326: o GET NUNCA grava (prefetch/crawler/preview disparam GET sozinhos)');
      ok(/return res\.status\(405\)/.test(rota),
         '  e avisa com 405 quem tentar `?gravar=1`, apontando o POST');
      ok(/app\.post\('\/api\/admin\/migrar-envs', requerAdmin/.test(srv2),
         '  ⚠️ e ha um POST pra gravar de verdade (nao disparado por navegacao)');
    }

    limpar();
    console.log('');
    console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
    process.exit(falhas ? 1 : 0);
  })();
}


