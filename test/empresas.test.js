// Roda com: node test/empresas.test.js
//
// O ponto deste teste NAO e "o registro funciona" — e provar que ele
// devolve EXATAMENTE o que o codigo ja usa hoje. Se um numero aqui
// divergir do que esta em lib/bling.js ou lib/rotas-admin-nf.js, o
// registro esta mentindo e nao serve de contrato pra empresa nova.

const fs = require('fs');
const path = require('path');
const { EMPRESAS, envDaEmpresa, obterEmpresa, listarEmpresas, conferirEmpresa } = require('../lib/empresas');

let falhas = 0;
function ok(cond, oque) {
  if (!cond) falhas++;
  console.log((cond ? 'ok  ' : 'FALHA ') + oque);
}

// ── 1. os ids batem com os que estao no codigo de producao ───────────
const bling = fs.readFileSync(path.join(__dirname, '..', 'lib', 'bling.js'), 'utf8');
const rotasNf = fs.readFileSync(path.join(__dirname, '..', 'lib', 'rotas-admin-nf.js'), 'utf8');

ok(bling.includes(EMPRESAS.good.fiscal.idEmpresaControl()),
   'empresa GOOD ' + EMPRESAS.good.fiscal.idEmpresaControl() + ' confere com lib/bling.js');
ok(rotasNf.includes(EMPRESAS.good.fiscal.depositoGeral()),
   'deposito geral GOOD ' + EMPRESAS.good.fiscal.depositoGeral() + ' confere com lib/rotas-admin-nf.js');
EMPRESAS.good.fiscal.depositosValidos.forEach((d) => {
  ok(rotasNf.includes(d), '  deposito GOOD ' + d + ' existe na lista de validos do codigo');
});

// ── 2. o prefixo de env faz o que promete ────────────────────────────
process.env.BLING_CLIENT_ID = 'valor-da-good';
process.env.AMB_BLING_CLIENT_ID = 'valor-da-amb';
ok(envDaEmpresa(EMPRESAS.good, 'BLING_CLIENT_ID') === 'valor-da-good', 'GOOD le SEM prefixo');
ok(envDaEmpresa(EMPRESAS.ambtotal, 'BLING_CLIENT_ID') === 'valor-da-amb', 'AMB le COM prefixo AMB_');
ok(envDaEmpresa(EMPRESAS.good, 'NAO_EXISTE', 'padrao') === 'padrao', 'usa o padrao quando a env falta');
delete process.env.BLING_CLIENT_ID;
delete process.env.AMB_BLING_CLIENT_ID;

// ── 3. env vazia conta como ausente (Render deixa string vazia) ──────
process.env.AMB_DEPOSITO_GERAL = '';
ok(EMPRESAS.ambtotal.fiscal.depositoGeral() === '14888917703',
   'env VAZIA cai no padrao (Render guarda string vazia, nao undefined)');
delete process.env.AMB_DEPOSITO_GERAL;

// ── 4. duas empresas nao se misturam ─────────────────────────────────
ok(EMPRESAS.good.tabelaDevolucoes !== EMPRESAS.ambtotal.tabelaDevolucoes, 'tabelas do Supabase separadas');
ok(EMPRESAS.good.prefixoRota !== EMPRESAS.ambtotal.prefixoRota, 'prefixos de rota separados');
ok(EMPRESAS.good.fiscal.depositoGeral() !== EMPRESAS.ambtotal.fiscal.depositoGeral(),
   'depositos diferentes (misturar aqui joga estoque na empresa errada)');
const chaves = listarEmpresas().map((e) => e.chave);
ok(new Set(chaves).size === chaves.length, 'nenhuma chave de empresa repetida');

// ── 5. empresa desconhecida falha alto, nao silenciosa ───────────────
let gritou = false;
try { obterEmpresa('nao-existe'); } catch (e) { gritou = true; }
ok(gritou, 'empresa desconhecida lanca erro (em vez de devolver undefined)');

// ── 6. o conferidor aponta o que falta, sem chutar ───────────────────
const rel = conferirEmpresa('ambtotal');
ok(Array.isArray(rel.envsFaltando), 'conferirEmpresa lista envs faltando');
ok(typeof rel.pronta === 'boolean', 'conferirEmpresa diz se a empresa esta pronta');
ok(rel.envsFaltando.every((n) => n.startsWith('AMB_')),
   'as envs cobradas da AMB vem com o prefixo certo (util pra colar no Render)');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
