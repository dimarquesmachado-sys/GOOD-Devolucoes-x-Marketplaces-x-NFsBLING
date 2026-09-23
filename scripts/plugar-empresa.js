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

  return {
    ok: true,
    chave, nome: e.nome, PREF, suf,
    conf,
    descoberto,
    erroDescoberta,
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
          const r = await fetch('https://api.bling.com.br/Api/v3' + caminho, {
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
      if (dep) console.log(`   ${r.PREF}DEPOSITO_GERAL = ${dep.id}   (${dep.nome || 'achado no Bling'})`);
      if (nat) console.log(`   ${r.PREF}NATUREZAS_DEVOLUCAO_IDS = ${nat.id || nat}   (achado no Bling)`);
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
    console.log(`   ⚠️ E o ${r.PREF}ID_EMPRESA_CONTROL: a API do Bling NÃO devolve`);
    console.log('   esse id. Ele aparece na URL quando você abre a empresa no painel.');
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
