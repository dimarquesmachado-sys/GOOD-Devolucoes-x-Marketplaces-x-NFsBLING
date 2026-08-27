// Roda com: node test/empresas.test.js
//
// O ponto NAO e "o registro funciona" — e provar que ele devolve
// EXATAMENTE o que a producao usa hoje. Se um valor divergir, o registro
// mente e nao serve de contrato pra empresa nova.

const fs = require('fs');
const path = require('path');
const {
  EMPRESAS, ENVS_OBRIGATORIAS, ENVS_BANCO,
  envDaEmpresa, obterEmpresa, listarEmpresas, conferirEmpresa, descobrirFicha,
} = require('../lib/empresas');

let falhas = 0;
const ok = (c, oque) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + oque); };

// ── 1. ligacao com a PRODUCAO, pelo padrao real e nao por substring ───
// Apontamento do Codex: `arquivo.includes('4956031259')` passava mesmo se
// o fallback mudasse, porque o id velho continua na lista de depositos
// validos e em comentarios. Agora o teste extrai a ATRIBUICAO.
function padraoDeProducao(arquivo, envName) {
  const src = fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8');
  // process.env.NOME || 'valor'   (aspas simples ou duplas)
  const re = new RegExp('process\\.env\\.' + envName + "\\s*\\|\\|\\s*['\"]([^'\"]+)['\"]");
  const m = src.match(re);
  return m ? m[1] : null;
}

// Compara o FALLBACK do registro com o FALLBACK de producao. Se a env
// estiver setada na maquina de quem roda o teste, o accessor devolveria o
// override e a comparacao falharia a toa (apontamento do Codex) — por
// isso a env e limpa durante a medicao e reposta depois.
function semEnv(nomes, fn) {
  const guarda = {};
  nomes.forEach((n) => { guarda[n] = process.env[n]; delete process.env[n]; });
  try { return fn(); }
  finally { nomes.forEach((n) => { if (guarda[n] !== undefined) process.env[n] = guarda[n]; }); }
}

const paresProducao = [
  ['lib/bling.js',                        'GOOD_ID_EMPRESA_CONTROL',      () => EMPRESAS.good.fiscal.idEmpresaControl()],
  ['server.js',                           'GOOD_DEPOSITO_GERAL',          () => EMPRESAS.good.fiscal.depositoGeral()],
  ['server.js',                           'GOOD_NF_ENTRADA_TIPO',         () => EMPRESAS.good.fiscal.nfEntradaTipo()],
  ['server.js',                           'GOOD_NATUREZAS_DEVOLUCAO_IDS', () => EMPRESAS.good.fiscal.naturezasDevolucaoIds()],
  ['amb-devolucoes/lib-AMB/bling-AMB.js', 'AMB_ID_EMPRESA_CONTROL',       () => EMPRESAS.ambtotal.fiscal.idEmpresaControl()],
];
paresProducao.forEach(([arq, env, ler]) => {
  const emProducao = padraoDeProducao(arq, env);
  // AMB_NATUREZA_DEVOLUCAO tambem entra: e o 2o || do encadeado da AMB
  const doRegistro = semEnv([env, 'AMB_NATUREZA_DEVOLUCAO'], ler);
  ok(emProducao !== null, 'achei o padrao de ' + env + ' em ' + arq);
  ok(emProducao === doRegistro,
     '  ' + env + ': producao=' + emProducao + ' registro=' + doRegistro);
});

// o da AMB tem dois || encadeados; confere o ULTIMO valor literal
(() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  const m = src.match(/process\.env\.AMB_NATUREZAS_DEVOLUCAO_IDS\s*\|\|\s*process\.env\.AMB_NATUREZA_DEVOLUCAO\s*\|\|\s*'([^']+)'/);
  ok(!!m, 'achei o padrao encadeado de AMB_NATUREZAS_DEVOLUCAO_IDS');
  const doRegistroAmb = semEnv(['AMB_NATUREZAS_DEVOLUCAO_IDS', 'AMB_NATUREZA_DEVOLUCAO'],
                               () => EMPRESAS.ambtotal.fiscal.naturezasDevolucaoIds());
  ok(m && m[1] === doRegistroAmb,
     '  naturezas AMB: producao=' + (m && m[1]) + ' registro=' + doRegistroAmb
     + '  <- so 15110882041; a segunda natureza mudaria classificacao');
})();

// ── 2. DOIS prefixos: credencial x fiscal ────────────────────────────
process.env.BLING_CLIENT_ID = 'cred-good';
process.env.AMB_BLING_CLIENT_ID = 'cred-amb';
process.env.GOOD_DEPOSITO_GERAL = 'fiscal-good';
process.env.DEPOSITO_GERAL = 'NAO-DEVE-SER-LIDO';
ok(envDaEmpresa(EMPRESAS.good, 'BLING_CLIENT_ID') === 'cred-good', 'GOOD: credencial SEM prefixo');
ok(EMPRESAS.good.fiscal.depositoGeral() === 'fiscal-good', 'GOOD: fiscal COM prefixo GOOD_');
ok(envDaEmpresa(EMPRESAS.ambtotal, 'BLING_CLIENT_ID') === 'cred-amb', 'AMB: credencial COM prefixo AMB_');
delete process.env.BLING_CLIENT_ID; delete process.env.AMB_BLING_CLIENT_ID;
delete process.env.GOOD_DEPOSITO_GERAL; delete process.env.DEPOSITO_GERAL;

// ── 3. empresa invalida LANCA (nao cai na GOOD em silencio) ──────────
let gritou = false;
try { envDaEmpresa(undefined, 'BLING_CLIENT_ID'); } catch (e) { gritou = true; }
ok(gritou, 'envDaEmpresa(undefined) LANCA — nao le a credencial da GOOD');
gritou = false;
try { envDaEmpresa({ prefixoEnv: 'X_' }, 'BLING_CLIENT_ID'); } catch (e) { gritou = true; }
ok(gritou, 'objeto malformado (sem chave) tambem LANCA');
gritou = false;
try { obterEmpresa('nao-existe'); } catch (e) { gritou = true; }
ok(gritou, 'empresa desconhecida LANCA');

// ── 4. env vazia cai no padrao (Render guarda string vazia) ──────────
process.env.AMB_DEPOSITO_GERAL = '';
ok(EMPRESAS.ambtotal.fiscal.depositoGeral() === '14888917703', 'env VAZIA cai no padrao');
delete process.env.AMB_DEPOSITO_GERAL;

// ── 5. empresas nao se misturam ──────────────────────────────────────
ok(EMPRESAS.good.tabelas.devolucoes !== EMPRESAS.ambtotal.tabelas.devolucoes, 'tabela de devolucoes separada');
['espreitaNotas', 'recados', 'pecasRetiradas', 'skuDepara'].forEach((t) => {
  ok(EMPRESAS.good.tabelas[t] && EMPRESAS.ambtotal.tabelas[t]
     && EMPRESAS.good.tabelas[t] !== EMPRESAS.ambtotal.tabelas[t],
     '  tabela ' + t + ' existe nas duas e e diferente');
});
ok(EMPRESAS.good.fiscal.depositoGeral() !== EMPRESAS.ambtotal.fiscal.depositoGeral(),
   'depositos diferentes (misturar joga estoque na empresa errada)');
const chaves = listarEmpresas().map((e) => e.chave);
ok(new Set(chaves).size === chaves.length, 'nenhuma chave repetida');

// ── 6. o banco entra na conta do "esta pronta?" ──────────────────────
const guardaUrl = process.env.SUPABASE_URL, guardaKey = process.env.SUPABASE_KEY;
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_KEY;
let rel = conferirEmpresa('ambtotal');
ok(rel.envsFaltando.some((n) => n.includes('SUPABASE_URL')),
   'sem Supabase, conferirEmpresa cobra (senao diria pronta com o banco off)');
process.env.SUPABASE_URL = 'x'; process.env.SUPABASE_KEY = 'y';
rel = conferirEmpresa('ambtotal');
ok(!rel.envsFaltando.some((n) => n.includes('SUPABASE')), 'a env COMPARTILHADA de Supabase serve');
if (guardaUrl) process.env.SUPABASE_URL = guardaUrl; else delete process.env.SUPABASE_URL;
if (guardaKey) process.env.SUPABASE_KEY = guardaKey; else delete process.env.SUPABASE_KEY;
// Esta assercao era TAUTOLOGICA (`length >= 0` sempre passa) — nao pegava
// a regressao de prefixo que ela dizia proteger. Agora limpa as envs da AMB
// e exige que TODAS as cobradas venham com o prefixo AMB_.
(() => {
  const nomes = ENVS_OBRIGATORIAS.map((n) => 'AMB_' + n);
  const guarda = {};
  nomes.forEach((n) => { guarda[n] = process.env[n]; delete process.env[n]; });
  const faltando = conferirEmpresa('ambtotal').envsFaltando;
  nomes.forEach((n) => { if (guarda[n] !== undefined) process.env[n] = guarda[n]; });

  const doPrefixo = faltando.filter((n) => n.startsWith('AMB_'));
  // as obrigatorias + as 2 do banco (que aparecem como "AMB_X (ou X)")
  const esperado = ENVS_OBRIGATORIAS.length + ENVS_BANCO.length;
  ok(doPrefixo.length === esperado,
     'cobra as ' + esperado + ' envs da AMB, banco incluso (veio ' + doPrefixo.length + ')');
  ENVS_OBRIGATORIAS.forEach((n) => {
    ok(faltando.includes('AMB_' + n), '  cobra AMB_' + n);
  });
  ok(faltando.every((n) => n.startsWith('AMB_')),
     '  e TODAS com prefixo AMB_ — nenhuma cobrada com o nome da GOOD');
  ok(faltando.includes('AMB_BLING_CLIENT_ID'),
     '  ex: AMB_BLING_CLIENT_ID (nome exato, pra colar no Render)');
})();

console.log('');
console.log(falhas === 0 ? '--- registro: ok' : '--- registro: ' + falhas + ' FALHA(S)');

// ── 7. descoberta pela API do Bling ──────────────────────────────────
// Duble com a assinatura REAL do repo: chamarBling(caminho, opcoes).
// Duble com a realidade do repo: recebe URL ABSOLUTA (o cliente da GOOD
// nao prepende a base) e o metodo dentro de opcoes. Ele EXIGE isso — se
// alguem voltar a mandar caminho relativo, o teste denuncia.
function blingFalso(respostas, opts = {}) {
  const chamadas = [];
  const fn = async (url, opcoes) => {
    chamadas.push(url);
    if (opcoes && opcoes.method !== 'GET') throw new Error('metodo inesperado: ' + (opcoes && opcoes.method));
    if (!/^https:\/\/api\.bling\.com\.br\/Api\/v3\//.test(url)) {
      throw new Error('URL nao absoluta (a GOOD nao prepende a base): ' + url);
    }
    if (!/[?&]pagina=\d+/.test(url)) throw new Error('sem paginacao: ' + url);
    const caminho = url.replace(/^https:\/\/api\.bling\.com\.br\/Api\/v3/, '').split('?')[0];
    const pagina = Number((url.match(/[?&]pagina=(\d+)/) || [])[1] || 1);
    if (opts.falha === caminho) return { ok: false, erro: 'HTTP 401 token expirado' };  // resolve, nao lanca
    const todos = respostas[caminho] || [];
    // pagina de 100 em 100, como a producao
    const fatia = todos.slice((pagina - 1) * 100, pagina * 100);
    return { data: { data: fatia } };
  };
  fn.chamadas = chamadas;
  return fn;
}
const BASE = {
  '/depositos': [
    { id: 111, descricao: 'Geral' }, { id: 222, descricao: 'DEFEITOS' },
    { id: 333, descricao: 'Shopee (Fulfillment)' },
  ],
  '/naturezas-operacoes': [
    { id: 900, descricao: 'Devolução de COMPRA - Entrada' },   // a pegadinha
    { id: 901, descricao: 'Devolução de Mercadoria - Entrada' },
    { id: 902, descricao: 'Venda de Mercadoria' },
  ],
  // ids REAIS da Girassol (medidos 21/08): diferentes da GOOD e da AMB
  '/situacoes': [{ id: 7259, nome: 'AGUARDANDO' }, { id: 743515, nome: 'DESPACHADOS' }],
  '/lojas': [{ id: 203146903, descricao: 'Mercado Livre' }],
};

(async () => {
  let f2 = 0;
  const ok2 = (c, o) => { if (!c) f2++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

  EMPRESAS.girassol = {
    chave: 'girassol', nome: 'Magazine Girassol',
    prefixoEnv: 'GIRA_', prefixoFiscal: 'GIRA_', prefixoRota: '/girassol',
    tabelas: { devolucoes: 'devolucoes_girassol' },
    fiscal: { idEmpresaControl: () => envDaEmpresa(EMPRESAS.girassol, 'ID_EMPRESA_CONTROL', undefined, 'fiscal') },
  };
  process.env.GIRA_ID_EMPRESA_CONTROL = '999';

  let r = await descobrirFicha('girassol', blingFalso(BASE));
  ok2(r.descoberto.depositoGeral && r.descoberto.depositoGeral.id === '111', 'achou o deposito Geral sozinho');
  ok2(r.descoberto.naturezaDevolucao && r.descoberto.naturezaDevolucao.id === '901',
      'achou a natureza certa e NAO caiu na "devolucao de COMPRA"');
  ok2(r.descoberto.totalSituacoes === 2 && r.descoberto.totalLojas === 1, 'trouxe situacoes e lojas');
  ok2(r.pronta === true, 'ficha completa = pronta');

  // ambiguidade NAO escolhe
  const doisGerais = JSON.parse(JSON.stringify(BASE));
  doisGerais['/depositos'].push({ id: 444, descricao: 'geral' });
  r = await descobrirFicha('girassol', blingFalso(doisGerais));
  ok2(r.descoberto.depositoGeral === null, 'DOIS depositos "Geral": recusa em vez de chutar');
  ok2(r.problemas.some((p) => p.includes('GIRA_DEPOSITO_GERAL')), '  e diz qual env resolve, com o prefixo certo');

  // ...e o override sugerido REALMENTE resolve na proxima rodada
  process.env.GIRA_DEPOSITO_GERAL = '444';
  r = await descobrirFicha('girassol', blingFalso(doisGerais));
  ok2(r.descoberto.depositoGeral && r.descoberto.depositoGeral.id === '444',
      '  definindo a env, a rodada seguinte USA ela (antes era ignorada)');
  ok2(r.pronta === true, '  e a ficha fica pronta');
  process.env.GIRA_DEPOSITO_GERAL = '77777';
  r = await descobrirFicha('girassol', blingFalso(doisGerais));
  ok2(r.problemas.some((p) => p.includes('nao existe')), '  env apontando pra deposito inexistente e denunciada');
  delete process.env.GIRA_DEPOSITO_GERAL;

  const duasNat = JSON.parse(JSON.stringify(BASE));
  duasNat['/naturezas-operacoes'].push({ id: 903, descricao: 'Devolucao  de   Mercadoria - Entrada' });
  r = await descobrirFicha('girassol', blingFalso(duasNat));
  ok2(r.descoberto.naturezaDevolucao === null, 'DUAS naturezas iguais (so espaco muda): recusa');
  process.env.GIRA_ID_NATUREZA_DEVOLUCAO_ENTRADA = '903';
  r = await descobrirFicha('girassol', blingFalso(duasNat));
  ok2(r.descoberto.naturezaDevolucao && r.descoberto.naturezaDevolucao.id === '903', '  a env de natureza tambem resolve');
  delete process.env.GIRA_ID_NATUREZA_DEVOLUCAO_ENTRADA;

  // Bling falhando: os clientes RESOLVEM {ok:false}, nao lancam
  r = await descobrirFicha('girassol', blingFalso(BASE, { falha: '/depositos' }));
  ok2(r.problemas.some((p) => p.includes('401')), 'falha que RESOLVE {ok:false} vira problema (nao "lista vazia ok")');
  ok2(r.pronta === false, '  e a ficha NAO se declara pronta com a API falhando');

  // catalogo em DUAS paginas: o "Geral" so aparece na pagina 2
  const muitos = JSON.parse(JSON.stringify(BASE));
  muitos['/depositos'] = [];
  for (let i = 0; i < 100; i++) muitos['/depositos'].push({ id: 1000 + i, descricao: 'Deposito ' + i });
  muitos['/depositos'].push({ id: 5555, descricao: 'Geral' });   // 101o item = pagina 2
  const cliente = blingFalso(muitos);
  r = await descobrirFicha('girassol', cliente);
  ok2(r.descoberto.depositoGeral && r.descoberto.depositoGeral.id === '5555',
      'acha o "Geral" que so existe na PAGINA 2 (sem paginar, diria que nao existe)');
  ok2(r.descoberto.totalDepositos === 101, '  e traz o catalogo inteiro (101), nao so a 1a pagina');
  ok2(cliente.chamadas.some((u) => /pagina=2/.test(u)), '  pediu mesmo a pagina 2');

  // catalogo VAZIO com sucesso nao pode dar ficha pronta
  r = await descobrirFicha('girassol', blingFalso({ ...BASE, '/depositos': [] }));
  ok2(r.pronta === false, 'catalogo VAZIO com sucesso NAO deixa a ficha pronta');
  ok2(r.problemas.some((p) => p.includes('NENHUM deposito')), '  e diz que o Bling nao devolveu deposito nenhum');

  delete process.env.GIRA_ID_EMPRESA_CONTROL;
  r = await descobrirFicha('girassol', blingFalso(BASE));
  ok2(r.problemas.some((p) => p.includes('404')), 'sem idEmpresaControl explica que GET /empresas da 404');

  delete EMPRESAS.girassol;
  console.log('');
  console.log((falhas + f2) === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + (falhas + f2) + ' FALHA(S)');
  process.exit((falhas + f2) ? 1 : 0);
})();
