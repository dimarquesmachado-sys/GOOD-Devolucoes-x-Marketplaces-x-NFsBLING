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

module.exports = { plugar, segredoForte };

/* ── linha de comando ──────────────────────────────────────── */
if (require.main === module) {
  const chave = process.argv[2];
  if (!chave) {
    console.log('uso: node scripts/plugar-empresa.js <chave>');
    process.exit(1);
  }

  (async () => {
    const registro = require('../lib/empresas');
    let chamarBling = null;
    try {
      const cfgEmp = require('../lib/config-da-empresa').configDaEmpresa(chave);
      const bling = require('../amb-devolucoes/lib-AMB/bling-AMB').criar(cfgEmp);
      chamarBling = bling.chamarBling;
    } catch (e) { /* sem credencial ainda — segue sem descobrir */ }

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
      const dep = d.depositoGeral;
      const nat = d.naturezaDevolucao || d.natureza;
      if (dep) console.log(`   ${r.PREF}DEPOSITO_GERAL = ${dep.id}   (${dep.nome || 'achado no Bling'})`);
      if (nat) console.log(`   ${r.PREF}NATUREZAS_DEVOLUCAO_IDS = ${nat.id || nat}   (achado no Bling)`);
      if (!dep && !nat) console.log('   (o Bling respondeu, mas não deu para deduzir depósito nem natureza)');
      for (const p of (d.problemas || [])) console.log('   ⚠️ ' + p);
    } else if (r.erroDescoberta) {
      console.log('   ⚠️ não consultei o Bling: ' + String(r.erroDescoberta).slice(0, 90));
      console.log('   (normal se as credenciais dela ainda não estão no ambiente)');
    } else {
      console.log('   ⚠️ sem credencial do Bling no ambiente — o depósito e a natureza');
      console.log('   ficam para quando você puser as 3 envs de Bling e rodar de novo.');
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
