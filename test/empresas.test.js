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
console.log(falhas === 0 ? '--- registro: ok' : '--- registro: ' + falhas + ' FALHA(S)');

// ── 7. descobrirFicha: a ficha se levanta sozinha pelo Bling ─────────
const { descobrirFicha } = require('../lib/empresas');

// Dublê do Bling da GIRASSOL, com os dados no formato real da v3.
// As situacoes usam os ids MEDIDOS da Girassol (AGUARDANDO 7259,
// DESPACHADOS 743515) — diferentes da GOOD e da AMB, que é justamente
// o motivo de nunca cravar id no codigo.
function blingGirassolFalso(respostas) {
  return async (metodo, caminho) => {
    if (respostas[caminho] === 'ERRO') throw new Error('Bling fora do ar');
    return { data: { data: respostas[caminho] || [] } };
  };
}

const BASE = {
  '/depositos': [
    { id: 111, descricao: 'Geral' },
    { id: 222, descricao: 'DEFEITOS' },
    { id: 333, descricao: 'Shopee (Fulfillment)' },
  ],
  '/naturezas-operacoes': [
    { id: 900, descricao: 'Devolução de COMPRA - Entrada' },   // a pegadinha
    { id: 901, descricao: 'Devolução de Mercadoria - Entrada' },
    { id: 902, descricao: 'Venda de Mercadoria' },
  ],
  '/situacoes': [{ id: 7259, nome: 'AGUARDANDO' }, { id: 743515, nome: 'DESPACHADOS' }],
  '/lojas': [{ id: 203146903, descricao: 'Mercado Livre' }],
};

(async () => {
  let f2 = 0;
  const ok2 = (c, o) => { if (!c) f2++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

  // registra a Girassol so pra este teste (a ficha real esta comentada)
  EMPRESAS.girassol = {
    chave: 'girassol', nome: 'Magazine Girassol', prefixoEnv: 'GIRA_',
    prefixoRota: '/girassol', tabelaDevolucoes: 'devolucoes_girassol', fiscal: {},
  };

  process.env.GIRA_ID_EMPRESA_CONTROL = '999';
  let r = await descobrirFicha('girassol', blingGirassolFalso(BASE));
  ok2(r.descoberto.depositoGeral && r.descoberto.depositoGeral.id === '111', 'achou o deposito Geral sozinho');
  ok2(r.descoberto.naturezaDevolucao && r.descoberto.naturezaDevolucao.id === '901',
      'achou a natureza certa e NAO caiu na "devolucao de COMPRA"');
  ok2(r.descoberto.totalSituacoes === 2 && r.descoberto.totalLojas === 1, 'trouxe situacoes e lojas');
  ok2(r.pronta === true, 'ficha completa = pronta');

  // ambiguidade NAO escolhe
  const doisGerais = JSON.parse(JSON.stringify(BASE));
  doisGerais['/depositos'].push({ id: 444, descricao: 'geral' });
  r = await descobrirFicha('girassol', blingGirassolFalso(doisGerais));
  ok2(r.descoberto.depositoGeral === null, 'DOIS depositos "Geral": recusa em vez de chutar');
  ok2(r.problemas.some((p) => p.includes('GIRA_DEPOSITO_GERAL')), '  e diz qual env resolve, com o prefixo certo');

  const duasNat = JSON.parse(JSON.stringify(BASE));
  duasNat['/naturezas-operacoes'].push({ id: 903, descricao: 'Devolucao  de   Mercadoria - Entrada' });
  r = await descobrirFicha('girassol', blingGirassolFalso(duasNat));
  ok2(r.descoberto.naturezaDevolucao === null, 'DUAS naturezas iguais (so espaco muda): recusa');

  // sem o id manual, avisa que nao tem API pra isso
  delete process.env.GIRA_ID_EMPRESA_CONTROL;
  r = await descobrirFicha('girassol', blingGirassolFalso(BASE));
  ok2(r.pronta === false, 'sem idEmpresaControl a ficha NAO fica pronta');
  ok2(r.problemas.some((p) => p.includes('404')), '  e explica que GET /empresas da 404 (nao tem API)');

  // Bling fora do ar nao derruba: reporta
  r = await descobrirFicha('girassol', blingGirassolFalso({ ...BASE, '/depositos': 'ERRO' }));
  ok2(r.problemas.some((p) => p.includes('depositos')), 'Bling fora do ar vira problema reportado, nao exception');

  delete EMPRESAS.girassol;
  console.log('');
  console.log(f2 === 0 ? '=== DESCOBERTA: TODOS OS CASOS PASSARAM' : '=== DESCOBERTA: ' + f2 + ' FALHA(S)');
  process.exit((falhas + f2) ? 1 : 0);
})();
