// Roda com: node test/config-le-do-registro.test.js
//
// FASE 1 do docs/PLUGAR-EMPRESA-NOVA.md: o código lê do REGISTRO
// (`lib/empresas.js`), não de `process.env.AMB_*` espalhado.
//
// Por que importa: hoje plugar um CNPJ = copiar pasta de 17 mil linhas e
// trocar 148 menções literais a "AMB". Com o registro, a empresa nova é uma
// entrada lá — e este arquivo não precisa ser copiado.
//
// ⚠️ E este teste garante que a troca NÃO mudou comportamento: o
// `envDaEmpresa` tem que montar exatamente o mesmo nome de variável.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const CFG = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'config-AMB.js'), 'utf8');

// ── nenhuma leitura direta com prefixo sobrou ───────────────────────
{
  const diretas = [...CFG.matchAll(/process\.env\.AMB_(\w+)/g)].map((m) => m[1]);
  ok(diretas.length === 0,
     'config-AMB nao le `process.env.AMB_*` direto'
     + (diretas.length ? ' (SOBRARAM: ' + diretas.slice(0, 5).join(', ') + ')' : ''));
  ok(/require\('\.\.\/lib\/empresas'\)/.test(CFG),
     '  e importa o registro de empresas');
}

// ── o registro resolve os DOIS prefixos ─────────────────────────────
//
// A pegadinha do P1 do Codex no PR #86: a GOOD não tem prefixo nas
// CREDENCIAIS (`BLING_CLIENT_ID`) mas TEM nos campos FISCAIS
// (`GOOD_DEPOSITO_GERAL`). Um prefixo só leria a variável errada.
{
  const reg = require('../lib/empresas.js');
  const salvos = { ...process.env };
  try {
    process.env.AMB_BLING_CLIENT_ID = 'cred-amb';
    process.env.BLING_CLIENT_ID = 'cred-good';
    process.env.GOOD_DEPOSITO_GERAL = 'fiscal-good';
    process.env.AMB_DEPOSITO_GERAL = 'fiscal-amb';

    const amb = reg.obterEmpresa('ambtotal');
    const good = reg.obterEmpresa('good');

    ok(reg.envDaEmpresa(amb, 'BLING_CLIENT_ID', '') === 'cred-amb',
       'AMB le credencial com prefixo AMB_');
    ok(reg.envDaEmpresa(good, 'BLING_CLIENT_ID', '') === 'cred-good',
       'GOOD le credencial SEM prefixo');
    ok(reg.envDaEmpresa(good, 'DEPOSITO_GERAL', '', 'fiscal') === 'fiscal-good',
       'mas GOOD le campo fiscal COM prefixo GOOD_ (a pegadinha dos 2 prefixos)');
    ok(reg.envDaEmpresa(amb, 'DEPOSITO_GERAL', '', 'fiscal') === 'fiscal-amb',
       '  e a AMB usa AMB_ nos dois');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in salvos)) delete process.env[k];
    Object.assign(process.env, salvos);
  }
}

// ── e cada empresa aponta pras SUAS tabelas ─────────────────────────
{
  const reg = require('../lib/empresas.js');
  const amb = reg.obterEmpresa('ambtotal');
  const good = reg.obterEmpresa('good');
  ok(amb.tabelas.devolucoes !== good.tabelas.devolucoes,
     'as tabelas de cada empresa sao distintas no registro');
  ok(amb.tabelas.devolucoes === 'devolucoes_amb' && good.tabelas.devolucoes === 'devolucoes',
     '  com os nomes reais (devolucoes_amb / devolucoes)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
