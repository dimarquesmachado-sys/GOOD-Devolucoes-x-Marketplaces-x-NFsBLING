'use strict';
/* ============================================================
 * scripts/nova-empresa.js
 * ------------------------------------------------------------
 * GERA a ficha de uma empresa nova — em vez de escrever à mão.
 *
 * ⚠️ POR QUE ISTO EXISTE
 *
 * Uma auditoria perguntou se "amanhã dá para plugar um CNPJ novo só
 * preenchendo credenciais". A resposta é NÃO: a lista de empresas é código.
 * Para entrar, um CNPJ precisa de ficha em `lib/empresas.js`, entrada no
 * `contrato-empresas.json`, tabelas no Supabase e as envs.
 *
 * Isso é uma ESCOLHA, não esquecimento: ficha em código passa pelos testes de
 * paridade e pela revisão. Mas escrever tudo à mão convida ao erro que já nos
 * custou caro — prefixo divergindo entre o contrato e o registro, e ninguém
 * vendo até o dia de ligar.
 *
 * 📌 Então o script gera as TRÊS peças a partir de 3 respostas, todas no
 * mesmo formato das empresas que já rodam. Você revisa, cola e abre o PR.
 *
 * COMO USAR
 *
 *   node scripts/nova-empresa.js <chave> "<Nome da Empresa>" [sufixoDados]
 *
 *   node scripts/nova-empresa.js aurora "Aurora Comercio"
 *   node scripts/nova-empresa.js aurora "Aurora Comercio" aur
 *
 * O `sufixoDados` é opcional: é o que vai na coluna `empresa` do banco e no
 * fim do nome das tabelas. Sem ele, usa a própria chave.
 *
 * ⚠️ O QUE ELE NÃO FAZ, DE PROPÓSITO
 *
 * Não escreve nos arquivos. Não inventa id fiscal (número fiscal errado é
 * pior que ausente — ver `docs/ESTADO-MULTILOJA.md`). Não ativa a empresa.
 * ============================================================ */

const VALIDA_CHAVE = /^[a-z][a-z0-9]{2,14}$/;

function gerar(chave, nome, sufixoDados) {
  const erros = [];
  if (!VALIDA_CHAVE.test(String(chave || ''))) {
    erros.push(`chave "${chave}" fora do formato: minúsculas, começa por letra, 3 a 15 caracteres`);
  }
  if (!String(nome || '').trim()) erros.push('falta o nome da empresa');

  const suf = String(sufixoDados || chave || '').trim().toLowerCase();
  if (suf && !/^[a-z0-9]{2,12}$/.test(suf)) {
    erros.push(`sufixo de dados "${suf}" fora do formato: minúsculas/dígitos, 2 a 12`);
  }
  if (erros.length) return { ok: false, erros };

  const PREF = chave.toUpperCase() + '_';

  const ficha = `    ${chave}: {
      chave: '${chave}',
      // ⚠️ o valor da coluna \`empresa\` no banco e o sufixo das tabelas.
      chaveDados: '${suf}',
      nome: '${nome}',
      prefixoEnv: '${PREF}',
      prefixoFiscal: '${PREF}',
      prefixoRota: '/${chave}',
      tabelas: {
        devolucoes: 'devolucoes_${suf}',
        espreitaNotas: 'espreita_notas_${suf}',
        recados: 'recados_${suf}',
        pecasRetiradas: 'pecas_retiradas_${suf}',
        skuDepara: 'sku_depara_${suf}',
      },
      fiscal: {
        // ⚠️ TODOS sem padrão: esta empresa declara os SEUS nas envs
        // \`${PREF}*\`, ou não tem. Inventar um id aqui emitiria NF com número
        // errado — e número errado é pior que número ausente.
        idEmpresaControl:      () => fis(EMPRESAS.${chave}, 'ID_EMPRESA_CONTROL', ''),
        depositoGeral:         () => fis(EMPRESAS.${chave}, 'DEPOSITO_GERAL', ''),
        naturezaDevolucao:     () => fis(EMPRESAS.${chave}, 'ID_NATUREZA_DEVOLUCAO_ENTRADA', ''),
        naturezasDevolucaoIds: () => fis(EMPRESAS.${chave}, 'NATUREZAS_DEVOLUCAO_IDS', ''),
        nfEntradaTipo:         () => fis(EMPRESAS.${chave}, 'NF_ENTRADA_TIPO', '0'),
      },
    },`;

  const contrato = JSON.stringify({
    [chave]: {
      nome,
      prefixo_env: PREF,
      slug_http: `/${chave}`,
      chave_dados: suf,
      ativa_em: { devolucoes: false },
    },
  }, null, 2);

  const envs = [
    'BLING_CLIENT_ID', 'BLING_CLIENT_SECRET', 'BLING_REFRESH_TOKEN',
    'ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'ML_REFRESH_TOKEN',
    'USERS', 'SESSION_SECRET',
  ].map((e) => PREF + e);

  return { ok: true, chave, nome, suf, PREF, ficha, contrato, envs };
}

module.exports = { gerar, VALIDA_CHAVE };

/* ── linha de comando ──────────────────────────────────────── */
if (require.main === module) {
  const [chave, nome, suf] = process.argv.slice(2);
  if (!chave || !nome) {
    console.log('uso: node scripts/nova-empresa.js <chave> "<Nome>" [sufixoDados]');
    process.exit(1);
  }
  const r = gerar(chave, nome, suf);
  if (!r.ok) {
    console.log('❌ não dá para gerar:');
    for (const e of r.erros) console.log('   ' + e);
    process.exit(1);
  }

  console.log('');
  console.log('════ 1. a ficha — cole em `lib/empresas.js`, dentro de EMPRESAS ════');
  console.log('');
  console.log(r.ficha);
  console.log('');
  console.log('════ 2. o contrato — acrescente em `contrato-empresas.json` ════');
  console.log('');
  console.log(r.contrato);
  console.log('');
  console.log('════ 3. as tabelas no Supabase ════');
  console.log('');
  console.log('   ⚠️ A rotina instalada no seu banco pode ser a ANTIGA, de 5 tabelas.');
  console.log('   Cole `sql/provisionar-empresa.sql` no SQL Editor ANTES de provisionar —');
  console.log('   o ciclo de defeitos precisa de 7.');
  console.log('');
  console.log(`   select provisionar_empresa('_${r.suf}');`);
  console.log('');
  console.log('════ 4. as envs no Render ════');
  console.log('');
  for (const e of r.envs) console.log('   ' + e);
  console.log('');
  console.log('   ⚠️ O `' + r.PREF + 'SESSION_SECRET` DERRUBA O BOOT se faltar — é de');
  console.log('   propósito. Sem ele a sessão cairia no ADMIN_KEY, compartilhado.');
  console.log('   Mínimo de 16 caracteres.');
  console.log('');
  console.log('   📌 Supabase: NÃO precisa de par próprio — o `SUPABASE_URL`/`KEY`');
  console.log('   globais servem, e é assim que a AMB roda.');
  console.log('');
  console.log('════ 5. os 3 ids fiscais, do Bling DESTA empresa ════');
  console.log('');
  console.log(`   ${r.PREF}ID_EMPRESA_CONTROL`);
  console.log(`   ${r.PREF}DEPOSITO_GERAL`);
  console.log(`   ${r.PREF}NATUREZAS_DEVOLUCAO_IDS`);
  console.log('');
  console.log('   ⚠️ Sem padrão de propósito. Emitir com o id de outra empresa é');
  console.log('   NF errada no CNPJ errado.');
  console.log('');
  console.log('════ e por último ════');
  console.log('');
  console.log(`   node -e "console.log(require('./lib/empresas').conferirEmpresa('${r.chave}'))"`);
  console.log('');
  console.log('   Quando disser `pronta: true`, aí sim vire `ativa_em.devolucoes`');
  console.log('   para true. A ativação é o ÚLTIMO passo — nunca o primeiro.');
  console.log('');
}
