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

const fs = require('fs');
const path = require('path');
const { ENVS_OBRIGATORIAS } = require('../lib/empresas.js');

const VALIDA_CHAVE = /^[a-z][a-z0-9]{2,14}$/;

// ⚠️ a trava do banco (sql/provisionar-empresa.sql) recusa estes dois sufixos
// mesmo fora do contrato — a GOOD usa sufixo VAZIO, entao `_good` nunca
// aparece numa ficha, mas a funcao do banco recusa do mesmo jeito.
const SUFIXOS_RESERVADOS_SQL = ['_amb', '_good'];

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

  const sufixoTabelas = suf ? `_${suf}` : '';

  // ⚠️ (Codex, P1) — um sufixo que ja pertence a outra empresa nao dispara
  // erro nenhum na hora de provisionar (a rotina e idempotente: so avisa que
  // a tabela "ja existe"), e `conferirEmpresa` nao confere colisao. Ativar
  // essa ficha leria/gravaria dado da empresa dona de verdade.
  if (suf && /^[a-z0-9]{2,12}$/.test(suf)) {
    let contratoAtual = { empresas: {} };
    try {
      contratoAtual = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'contrato-empresas.json'), 'utf8')
      );
    } catch (err) { /* sem o contrato pra ler, so a trava do SQL protege */ }

    const usados = new Set(SUFIXOS_RESERVADOS_SQL);
    for (const e of Object.values(contratoAtual.empresas || {})) {
      if (e && e.sufixo_tabelas) usados.add(e.sufixo_tabelas);
    }
    if (usados.has(sufixoTabelas)) {
      erros.push(`sufixo de dados "${suf}" ja pertence a outra empresa (tabelas ${sufixoTabelas}*) — escolha outro`);
    }
  }

  if (erros.length) return { ok: false, erros };

  const PREF = chave.toUpperCase() + '_';
  // ⚠️ (Codex, P2) — nome com aspa ou quebra de linha quebraria a sintaxe se
  // fosse interpolado dentro de aspas simples (`nome: 'D'Ávila'`). Serializado
  // como literal JS, qualquer nome cola sem erro.
  const nomeLiteral = JSON.stringify(nome);

  const ficha = `    ${chave}: {
      chave: '${chave}',
      // ⚠️ o valor da coluna \`empresa\` no banco e o sufixo das tabelas.
      chaveDados: '${suf}',
      nome: ${nomeLiteral},
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

  // ⚠️ (Codex, P1) — o teste de contrato (`test/contrato-empresas.test.js`)
  // itera `e.aliases` e `e.dono_hoje` de TODA empresa do arquivo, e confere
  // `sufixo_tabelas` (nao `chave_dados`). Uma ficha sem esses campos derrubava
  // `node verifica.js` pra qualquer empresa gerada — nao era so incompleta,
  // quebrava o teste com TypeError.
  //
  // `capacidades`/`conta_marketplace`/`dono_alvo` abaixo saem com a linha de
  // base COMUM as 3 empresas que ja rodam (fiscal/checkout/ml/ml-full/shopee/
  // magalu, contas propria/propria/propria/compartilhada) — confira contra o
  // Bling desta empresa antes de ativar; tiktok/madeira-madeira/expedicao
  // variam por empresa e ficam de fora ate confirmar.
  const contratoEmpresa = {
    id_canonico: chave,
    nome,
    aliases: [chave],
    slug_http: `/${chave}`,
    prefixo_env: PREF,
    prefixo_env_historico: { devolucoes: PREF, 'mover-pedidos': PREF },
    prefixo_fiscal: PREF,
    sufixo_tabelas: sufixoTabelas,
    conta_marketplace: {
      bling: 'propria', ml: 'propria', shopee: 'propria',
      magalu: 'compartilhada', tiktok: 'nao_se_aplica',
    },
    dono_hoje: {
      _nota: 'so bling/ml: e o que este repo MEDE (lib/bling.js e lib/ml.js renovam qualquer empresa configurada aqui). magalu/bling_nfe/tiktok so tem dono quando o Mover-Pedidos plugar esta empresa.',
      bling: ['devolucoes'],
      ml: ['devolucoes'],
    },
    dono_alvo: {
      bling: 'mover-pedidos', ml: 'mover-pedidos',
      magalu: 'mover-pedidos', bling_nfe: 'mover-pedidos',
    },
    capacidades: ['fiscal', 'checkout', 'ml', 'ml-full', 'shopee', 'magalu'],
    ativa_em: { devolucoes: false },
  };
  const contrato = JSON.stringify({ [chave]: contratoEmpresa }, null, 2);

  // ⚠️ (Codex, P2) — a lista vinha duplicada aqui e em `lib/empresas.js`
  // (`ENVS_OBRIGATORIAS`); foi assim que o `ADMIN_USER` saiu de uma sem sair
  // da outra. Lendo do registro, as duas nunca mais divergem.
  const envs = ENVS_OBRIGATORIAS.map((e) => PREF + e);

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
