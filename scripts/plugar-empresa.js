'use strict';
/* ============================================================
 * scripts/plugar-empresa.js
 * ------------------------------------------------------------
 * REDUZ O TRABALHO MANUAL de ligar uma empresa.
 *
 * ⚠️ O DONO PERGUNTOU: "caraca, quanta coisa... não tem um jeito de facilitar
 * essa parte manual?"
 *
 * Tem — para a maior parte. Este script separa o que a MÁQUINA descobre do
 * que só a PESSOA tem:
 *
 *   descobre no Bling      depósito geral, natureza de devolução
 *   gera aqui              o segredo da sessão
 *   monta                  o comando do Supabase, com o sufixo certo
 *   ⚠️ só a pessoa tem     as 6 credenciais (Bling e ML), os usuários,
 *                          e o `ID_EMPRESA_CONTROL`
 *
 * 📌 Por que o `ID_EMPRESA_CONTROL` não dá: a API do Bling NÃO o devolve —
 * está registrado em `lib/empresas.js` como `manual`. Ele aparece na URL do
 * painel quando você abre a empresa.
 *
 * COMO USAR
 *
 *   node scripts/plugar-empresa.js <chave>
 *
 * Com as credenciais do Bling dela já no ambiente, ele consulta e preenche o
 * que der. Sem elas, ainda assim gera o segredo, o SQL e a lista do que falta.
 *
 * ⚠️ NÃO escreve em lugar nenhum, não ativa nada, e não inventa id fiscal.
 * ============================================================ */

const crypto = require('crypto');

function segredoForte() {
  // 32 bytes em base64url — bem acima do mínimo de 16 caracteres que o
  // auth exige, e sem caracteres que atrapalhem no painel do Render.
  return crypto.randomBytes(32).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function plugar(chave, deps) {
  const { obterEmpresa, conferirEmpresa, descobrirFicha } = deps.registro;
  // ⚠️ `obterEmpresa` LANÇA quando não conhece a chave — não devolve null.
  // Descobri no teste: sem o try, o script morria com stack em vez de dizer o
  // que fazer.
  let e = null;
  try { e = obterEmpresa(chave); } catch (err) { e = null; }
  if (!e) {
    return { ok: false, erro: `empresa "${chave}" não está no registro — `
      + `rode antes: node scripts/nova-empresa.js ${chave} "<Nome>"` };
  }

  const conf = conferirEmpresa(chave);
  const PREF = e.prefixoEnv;
  // ⚠️ b410 (Codex, P2) - O FISCAL TEM PREFIXO PROPRIO.
  //
  // O registro guarda `prefixoEnv` e `prefixoFiscal` SEPARADOS de proposito —
  // uma empresa pode ter credencial com um prefixo e fiscal com outro. Hoje
  // as 3 coincidem, entao imprimir tudo com o de credencial "funciona" e
  // esconde o erro ate a primeira que divergir.
  //
  // 📌 Justamente o tipo de coincidencia que me enganou no b405 (a pasta do
  // checkout seguia a chave em 2 de 3 empresas).
  // ⚠️ nullish, nao `||`: empresa com fiscal INTENCIONALMENTE sem prefixo
  // (`prefixoFiscal: ''`) e credencial com prefixo cairia no `PREF` errado
  // com `||`, porque '' e falsy. Mesmo criterio de `envDaEmpresa` (lib/empresas.js).
  const PREF_FISCAL = (e.prefixoFiscal != null) ? e.prefixoFiscal : e.prefixoEnv;
  const suf = e.chaveDados || chave;

  // ── o que a máquina descobre ────────────────────────────────────
  let descoberto = null;
  let erroDescoberta = null;
  if (deps.chamarBling) {
    try {
      descoberto = await descobrirFicha(chave, deps.chamarBling);
    } catch (err) {
      erroDescoberta = err && err.message ? err.message : String(err);
    }
  }

  // ⚠️ `conferirEmpresa` NAO acusa `naturezaDevolucao` vazia de proposito (ela
  // pode vir da API por nome) — entao `conf.fiscalSemValor` nunca diz se ja
  // esta configurada. Quem decide isso e o CLI, e precisa do valor real.
  const natFn = e.fiscal && e.fiscal.naturezaDevolucao;
  const naturezaJaConfigurada = !!(typeof natFn === 'function' ? natFn() : natFn);

  return {
    ok: true,
    chave, nome: e.nome, PREF, PREF_FISCAL, suf,
    conf,
    descoberto,
    erroDescoberta,
    naturezaJaConfigurada,
    segredo: segredoForte(),
    sqlProvisionar: `select provisionar_empresa('_${suf}');`,
  };
}

// ⚠️ b407 - A LEITURA SAI PRA CA, pra o teste exercitar a DE PRODUÇÃO.
//
// Meu primeiro teste conferia o que `plugar()` devolve — e o erro estava na
// LEITURA, dentro do bloco de impressão, que o teste não tocava. Ele passava
// verde com o script sem servir para nada.
//
// 📌 Regra da casa: o teste exercita a função de produção, nunca uma cópia
// da lógica nem um pedaço vizinho.
function lerDescoberta(d) {
  const achados = (d && d.descoberto) || {};
  return {
    deposito: achados.depositoGeral || null,
    natureza: achados.naturezaDevolucao || null,
    problemas: (d && d.problemas) || [],
  };
}

module.exports = { plugar, segredoForte, lerDescoberta };

/* ── linha de comando ──────────────────────────────────────── */
if (require.main === module) {
  const chave = process.argv[2];
  if (!chave) {
    console.log('uso: node scripts/plugar-empresa.js <chave>');
    process.exit(1);
  }

  (async () => {
    const registro = require('../lib/empresas');
    // ⚠️ b407 (Codex, P1) - NÃO USO O CLIENTE DE PRODUÇÃO AQUI.
    //
    // Ele renova o token sozinho ao tomar 401 — e o Bling INVALIDA o refresh
    // antigo quando emite o novo. Num script de LEITURA, isso queimaria o
    // refresh que está no Render: o serviço no ar perderia acesso ao Bling
    // daquela empresa, por causa de um comando que só ia consultar.
    //
    // 📌 Então só consulto se já houver um ACCESS TOKEN pronto no ambiente, e
    // com um cliente mínimo, que nunca renova nada. Sem ele, o script segue e
    // diz o que falta — que é melhor que quebrar o que está funcionando.
    let chamarBling = null;
    try {
      const reg0 = require('../lib/empresas');
      const ficha = reg0.obterEmpresa(chave);
      const pref = (ficha && ficha.prefixoEnv) || '';
      const access = process.env[pref + 'BLING_ACCESS_TOKEN'];
      if (access) {
        chamarBling = async (caminho) => {
          // ⚠️ b408 (Codex, P1): o `descobrirFicha` monta a URL COMPLETA
          // (`BASE_BLING + caminho + '?limite=...'`) antes de chamar. Eu
          // concatenava a base OUTRA VEZ, gerando
          // `/Api/v3https://api.bling.com.br/Api/v3/depositos` — 404 em toda
          // consulta, e o script diria "nao descobri" achando que era falta
          // de permissao.
          //
          // 📌 Aceito os dois formatos: se vier absoluta, uso como está.
          const alvo = /^https?:\/\//.test(String(caminho))
            ? caminho
            : 'https://api.bling.com.br/Api/v3' + caminho;
          const r = await fetch(alvo, {
            headers: { Authorization: 'Bearer ' + access, Accept: 'application/json' },
          });
          const data = await r.json().catch(() => null);
          return { ok: r.ok, status: r.status, data };
        };
      }
    } catch (e) { /* sem ficha ou sem token — segue sem descobrir */ }

    const r = await plugar(chave, { registro, chamarBling });
    if (!r.ok) { console.log('❌ ' + r.erro); process.exit(1); }

    console.log('');
    console.log(`════ plugar a ${r.nome} ════`);
    console.log('');

    // 1. o que a máquina já resolveu
    console.log('── o que eu já resolvi ──');
    console.log('');
    console.log(`   ${r.PREF}SESSION_SECRET`);
    console.log(`   ${r.segredo}`);
    console.log('');
    console.log('   ⚠️ gerado agora, 32 bytes. Cole no Render e não reaproveite');
    console.log('   de outra empresa — cookie com segredo compartilhado vale nas duas.');
    console.log('');

    const d = r.descoberto;
    if (d && d.ok !== false) {
      // ⚠️ b407 (Codex, P1): os valores vêm ANINHADOS em `d.descoberto`.
      const { deposito: dep, natureza: nat } = lerDescoberta(d);
      if (dep) console.log(`   ${r.PREF_FISCAL}DEPOSITO_GERAL = ${dep.id}   (${dep.nome || 'achado no Bling'})`);
      // ⚠️ b408 (Codex, P1) - O CAMPO E `ID_NATUREZA_DEVOLUCAO_ENTRADA`.
      //
      // O `descobrirFicha` resolve a natureza de ENTRADA (a de emitir). Eu
      // rotulava como `NATUREZAS_DEVOLUCAO_IDS`, que e a de BUSCAR — outro
      // campo, outra finalidade.
      //
      // ⚠️ E EU JA ERREI ESSES DOIS HOJE, no b402: peguei o de emitir quando
      // precisava do de buscar. Agora ao contrario. Sao parecidos no nome e
      // diferentes no uso — quem colar no lugar errado emite NF com a
      // natureza de busca.
      if (nat) console.log(`   ${r.PREF_FISCAL}ID_NATUREZA_DEVOLUCAO_ENTRADA = ${nat.id || nat}   (achado no Bling)`);
      if (!dep && !nat) console.log('   (o Bling respondeu, mas não deu para deduzir depósito nem natureza)');
      for (const p of lerDescoberta(d).problemas) console.log('   ⚠️ ' + p);
    } else if (r.erroDescoberta) {
      console.log('   ⚠️ não consultei o Bling: ' + String(r.erroDescoberta).slice(0, 90));
      console.log('   (normal se as credenciais dela ainda não estão no ambiente)');
    } else {
      console.log(`   ⚠️ sem ${r.PREF}BLING_ACCESS_TOKEN no ambiente — o depósito e a`);
      console.log('   natureza ficam para quando você tiver um access token válido.');
      console.log('');
      console.log('   📌 De propósito NÃO uso o refresh token aqui: o cliente de');
      console.log('   produção renova sozinho no 401, e o Bling invalida o refresh');
      console.log('   antigo — um comando de leitura derrubaria o serviço no ar.');
    }

    console.log('');
    console.log('── o banco ──');
    console.log('');
    console.log('   1. cole `sql/provisionar-empresa.sql` no SQL Editor do Supabase');
    console.log('      ⚠️ a rotina instalada pode ser a ANTIGA, de 5 tabelas — o ciclo');
    console.log('      de defeitos precisa de 7');
    console.log('   2. depois rode:');
    console.log('');
    console.log('      ' + r.sqlProvisionar);
    console.log('');

    // 2. o que só a pessoa tem
    console.log('── o que só você tem ──');
    console.log('');
    const faltam = (r.conf.envsFaltando || [])
      .filter((x) => !/SESSION_SECRET|SUPABASE/.test(x));
    for (const x of faltam) console.log('   ' + x);
    console.log('');
    console.log('   As 6 de Bling e ML saem do painel de cada um (aplicativo/');
    console.log('   integração). Os usuários você define.');
    console.log('');

    // ⚠️ b409 (Codex, P2) - OS CAMPOS FISCAIS TAMBEM, nao so as envs.
    //
    // Eu imprimia so `envsFaltando`. Os 3 fiscais vivem em `fiscalSemValor` e
    // NUNCA apareciam — quem seguisse a lista acharia que tinha terminado e
    // o `conferirEmpresa` continuaria dizendo `pronta: false`, sem a pessoa
    // saber por quê.
    //
    // ⚠️ E na rodada anterior eu troquei o rotulo da natureza de busca pela de
    // entrada. Com isso o campo de BUSCA sumiu da tela de vez: nao estava nas
    // envs, e o rotulo que o citava virou outro.
    const NOME_ENV_FISCAL = {
      idEmpresaControl: 'ID_EMPRESA_CONTROL',
      depositoGeral: 'DEPOSITO_GERAL',
      naturezaDevolucao: 'ID_NATUREZA_DEVOLUCAO_ENTRADA',
      naturezasDevolucaoIds: 'NATUREZAS_DEVOLUCAO_IDS',
      nfEntradaTipo: 'NF_ENTRADA_TIPO',
    };
    // ⚠️ b410 (Codex, P2) - A NATUREZA DE EMISSAO NAO ESTA NO `fiscalSemValor`.
    //
    // O `conferirEmpresa` NAO a exige (de proposito: a rota descobre pelo
    // nome se faltar). Entao, quando nao ha access token e a descoberta e
    // pulada, ela nao aparece em lugar NENHUM — nem no bloco descoberto, nem
    // nesta lista.
    //
    // 📌 Acrescento pra quem esta plugando saber que ela existe, marcada como
    // opcional — o oposto de escondê-la.
    const fiscaisFaltando = (r.conf.fiscalSemValor || []).slice();
    const jaDescobriu = !!(r.descoberto && r.descoberto.descoberto
      && r.descoberto.descoberto.naturezaDevolucao);
    // ⚠️ (Codex, P2) - NAO acusar quem ja configurou a env, so porque esta
    // rodada nao tinha access token pra descobrir de novo. `jaDescobriu` so
    // enxerga o achado DESTA execucao; `naturezaJaConfigurada` olha a ficha.
    if (!jaDescobriu && !r.naturezaJaConfigurada
        && !fiscaisFaltando.includes('naturezaDevolucao')) {
      fiscaisFaltando.push('naturezaDevolucao');
    }
    if (fiscaisFaltando.length) {
      console.log('   e os campos fiscais, do Bling DESTA empresa:');
      console.log('');
      for (const f of fiscaisFaltando) {
        const opcional = (f === 'naturezaDevolucao')
          ? '   (opcional — sem ela a rota descobre pelo nome)' : '';
        console.log('   ' + r.PREF_FISCAL + (NOME_ENV_FISCAL[f] || f) + opcional);
      }
      console.log('');
    }

    console.log(`   ⚠️ O ${r.PREF_FISCAL}ID_EMPRESA_CONTROL a API do Bling NÃO devolve —`);
    console.log('   o `GET /empresas` dá 404. Ele aparece na URL quando você abre');
    console.log('   a empresa no painel.');
    console.log('');
    // ⚠️ b412 - JUNTA OS DOIS: o texto sem "acima" (do #354) e o
    // `PREF_FISCAL` (da main). A versao do #354 usava `r.PREF`, que e o de
    // CREDENCIAL — e o prefixo fiscal e separado. Pegar so um dos dois
    // desfaria o conserto do outro.
    // ⚠️ b410 (Codex, P2) - NÃO DIGA "acima": quando não há access token (ou a
    // descoberta falha), nada sobre a natureza de EMITIR aparece acima disto
    // — e esta nota citava um valor que nunca foi mostrado. Agora ela nomeia
    // os dois campos direto, sem depender do que rolou lá em cima.
    console.log(`   📌 O ${r.PREF_FISCAL}ID_NATUREZA_DEVOLUCAO_ENTRADA é a natureza de EMITIR,`);
    console.log(`   diferente do ${r.PREF_FISCAL}NATUREZAS_DEVOLUCAO_IDS, que é a de BUSCAR.`);
    console.log('   Nomes parecidos, usos diferentes: trocar os dois faz a NF sair');
    console.log('   com a natureza errada.');
    console.log('');

    console.log('── e por último ──');
    console.log('');
    console.log(`   node -e "console.log(require('./lib/empresas').conferirEmpresa('${r.chave}'))"`);
    console.log('');
    console.log('   Quando disser `pronta: true`, aí vire `ativa_em.devolucoes`.');
    console.log('   A ativação é o ÚLTIMO passo.');
    console.log('');
  })().catch((e) => { console.log('❌ ' + (e && e.message)); process.exit(1); });
}
