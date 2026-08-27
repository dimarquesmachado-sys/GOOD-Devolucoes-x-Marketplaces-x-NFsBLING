// Roda com: node test/defeitos-coluna-data.test.js
//
// Guarda o bug de 27/08: a busca do Estoque de Defeitos da GOOD morria com
// "column devolucoes.criado_em does not exist" e a tela dizia so
// "nada encontrado" — parecia produto inexistente, era coluna errada.
//
// A tabela `devolucoes` (GOOD) usa created_at; a `devolucoes_amb` usa
// criado_em. O modulo veio portado da AMB e trouxe o nome de la.

const fs = require('fs');
const path = require('path');

const GOOD = fs.readFileSync(path.join(__dirname, '..', 'lib', 'defeitos-ciclo.js'), 'utf8');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// ── 1. a consulta na tabela devolucoes usa created_at ────────────────
// ATENCAO: usar lastIndexOf pro fim — a expressao ".limit(300)" tambem
// aparece num COMENTARIO antes do codigo, e o indexOf pegava o comentario,
// deixando o trecho vazio e os dois casos abaixo falhando a toa.
const iniL = GOOD.indexOf("let sel = dbc.from(T_DEV)");
const trechoLista = GOOD.slice(iniL, GOOD.indexOf(".limit(300);", iniL) + 12);
ok(trechoLista.includes("created_at"), 'o select da lista pede created_at');
ok(!/\.select\([^)]*\bcriado_em\b/.test(trechoLista),
   'o select da lista NAO pede criado_em (era o que quebrava)');
ok(trechoLista.includes(".order('created_at'"), 'o order da lista usa created_at');

// ── 2. as OUTRAS tabelas seguem com criado_em (nao foram tocadas) ────
// defeito_comentarios, pecas_retiradas e defeito_pedidos sao tabelas
// PROPRIAS do modulo e nasceram com criado_em nas duas empresas.
[['T_COM', 'defeito_comentarios'], ['T_PEC', 'pecas_retiradas'], ['T_PED', 'defeito_pedidos']].forEach(([c, nome]) => {
  const re = new RegExp("from\\(" + c + "\\)[^\\n]*order\\('criado_em'");
  ok(re.test(GOOD), '  ' + nome + ' continua ordenando por criado_em');
});

// ── 3. o CONTRATO com o painel nao mudou ─────────────────────────────
// O front le `.criado_em` (10 usos em public/js). A resposta tem que
// continuar chamando assim, so mudando de onde o valor vem.
ok(/criado_em:\s*x\.created_at/.test(GOOD), 'a lista devolve criado_em a partir de created_at');
ok(/criado_em:\s*item\.created_at\s*\|\|\s*item\.criado_em/.test(GOOD),
   'a ficha devolve criado_em tolerante (la e select("*"))');
const js = fs.readdirSync(path.join(__dirname, '..', 'public', 'js'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8')).join('\n');
ok(js.includes('.criado_em'), 'o painel realmente le .criado_em (por isso o nome de saida ficou)');

// ── 4. a AMB nao foi tocada ──────────────────────────────────────────
const AMB = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'defeitos-ciclo-AMB.js'), 'utf8');
ok(/\.select\([^)]*criado_em[^)]*\)/.test(AMB), 'a AMB segue com criado_em (a tabela dela e assim)');



// ── 5. seg4: "problema" na GOOD e TIPO, nao STATUS ───────────────────
// Depois de consertar a coluna de data, a busca rodava mas voltava
// SEMPRE vazia — inclusive com 9 problemas reportados na tela. Motivo:
// o filtro (tambem portado da AMB) procurava status='problema', mas a
// GOOD grava tipo:'problema' com status:'pendente' (server.js:2403-04).
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const AMB_COMPAT = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js'), 'utf8');

ok(/tipo:\s*'problema'/.test(SERVER), 'a GOOD grava tipo:"problema" (server.js)');
ok(/status:\s*'problema'/.test(AMB_COMPAT), 'a AMB grava status:"problema" (compat-AMB.js) — esquemas diferentes');

// as condicoes agora vivem nas constantes lidas por condicoesDoEstado
const condsFonte = GOOD.slice(GOOD.indexOf('const ATIVOS ='), GOOD.indexOf('const MAX_IDS_NA_URL'));
ok(condsFonte.includes('and(tipo.eq.problema,status.eq.concluido)'),
   'problema entra SO com status=concluido (a regra fiscal da v3.98)');
ok(!/(^|[,'])tipo\.eq\.problema(?!,status)/.test(condsFonte),
   '  nunca tipo.eq.problema solto — liberaria devolucao ainda pendente');
ok(!condsFonte.includes('status.eq.problema'),
   '  e NAO aceita status.eq.problema (molde da AMB driblaria a trava fiscal)');
ok(condsFonte.includes('tipo.eq.recuperado') && condsFonte.includes('tipo.eq.descartado'),
   'recuperado e descartado entram (ao autorizar, o modulo troca o tipo da linha)');
ok(condsFonte.includes('tipo.eq.defeito_estoque'), '  e segue pegando defeito_estoque');
ok(condsFonte.includes('tipo.eq.defeito_excluido'), '  e defeito_excluido (a aba Excluidos precisa)');

// a regra fiscal existe mesmo no server, nao foi invencao minha
ok(/x\.tipo === 'problema' && x\.status !== 'concluido'/.test(SERVER),
   'o server conta problema+nao-concluido como aguardandoNF (a regra que o filtro respeita)');
ok(/x\.tipo === 'defeito_estoque' \|\| x\.status === 'concluido'/.test(SERVER),
   '  e libera so defeito_estoque ou concluido');

// ── 6. restaurar excluido nao pode apagar a origem fiscal ────────────
const restaura = GOOD.slice(GOOD.indexOf('const veioDeDevolucao'), GOOD.indexOf('const camposR'));
ok(restaura.includes('nf_numero') && restaura.includes('nf_chave'),
   'a restauracao olha vestigio de NF pra saber se veio de devolucao');
ok(restaura.includes("? 'problema'"), '  com NF, volta como problema (nao vira defeito_estoque)');
ok(restaura.includes("'defeito_estoque'"), '  sem NF, volta como defeito_estoque');
ok(/select\('id, tipo, tipo_anterior, status, shipment_id[^']*nf_numero/.test(GOOD),
   '  e o select traz os campos de origem (senao a checagem seria sempre falsa)');

// o resto do server ja filtrava assim — o modulo e que estava fora do padrao
ok(/\.in\('tipo',\s*\['problema',\s*'defeito_estoque'\]\)/.test(SERVER),
   'o resto do server ja usava .in("tipo", ["problema","defeito_estoque"])');

// a classificacao em abas e por TIPO, entao os novos caem na aba certa
const clas = GOOD.slice(GOOD.indexOf('const situacaoDe'), GOOD.indexOf('const estado ='));
ok(clas.includes("x.tipo === 'defeito_excluido'"), 'a aba Excluidos separa por tipo');
ok(clas.includes("x.tipo === 'recuperado'"), 'Recuperados/Descartados por tipo');
ok(clas.includes("|| 'defeito'"), '  e o resto cai em "defeito" (a aba Com Defeito)');



// ── 7. seg4.2: a ABA entra na consulta, ANTES do limite de 300 ───────
// Antes, o .limit(300) cortava o conjunto COMBINADO (ativos + terminais +
// excluidos) e so entao a aba era aplicada em JS: com historico grande,
// defeito ativo antigo sumia da aba "Com Defeito".
const iniC = GOOD.indexOf('const ATIVOS =');
const fimC = GOOD.indexOf('async function buscar(termo, estado, porPedido)');
const trechoCond = GOOD.slice(iniC, fimC);
const condicoesDoEstado = new Function(trechoCond + '; return condicoesDoEstado;')();
const idsForaDoEstado = new Function(trechoCond + '; return idsForaDoEstado;')();
{
  const porPedido = { '10': 'recuperado', '11': 'descartado', '12': 'recuperado' };
  const c = (e, pp = porPedido) => condicoesDoEstado(e, pp);
 




ok(c('excluido')==='tipo.eq.defeito_excluido', 'aba Excluidos pede so defeito_excluido');
ok(!c('excluido').includes('defeito_estoque'), '  e nao arrasta os ativos (era o que estourava o limite)');

ok(c('defeito').includes('and(tipo.eq.problema,status.eq.concluido)'), 'aba Com Defeito: problema so concluido');
ok(c('defeito').includes('tipo.eq.defeito_estoque'), '  + defeito_estoque');
ok(!c('defeito').includes('tipo.eq.recuperado'), '  e NAO traz os terminais junto');

ok(c('recuperado').includes('tipo.eq.recuperado'), 'aba Recuperados: pelo tipo');
ok(c('recuperado').includes('id.in.(10,12)'), '  + os ids do historico antigo (classificados por PEDIDO)');
ok(!c('recuperado').includes('11'), '  e nao mistura o descartado');
ok(c('descartado').includes('id.in.(11)'), 'aba Descartados: so o id descartado');

ok(c('recuperado',{})==='tipo.eq.recuperado', 'sem historico antigo, so o tipo');

const muitos={}; for(let i=0;i<200;i++) muitos[i]='recuperado';
ok(c('recuperado',muitos).includes('defeito_excluido'), 'com 200 ids, volta ao filtro amplo (URL gigante quebraria a busca)');

ok(c('todos').includes('defeito_excluido')&&c('todos').includes('recuperado'), 'todos = tudo');
}

// e a consulta usa mesmo a condicao (nao ficou hardcoded)
// seg4.3: os terminais por PEDIDO saem da consulta ANTES do limite
{
  const pp = { '10': 'recuperado', '11': 'descartado' };
  ok(idsForaDoEstado('defeito', pp).length === 2,
     'na aba Com Defeito, os ja resolvidos por pedido sao EXCLUIDOS da consulta');
  ok(idsForaDoEstado('recuperado', pp).length === 0,
     '  nas abas terminais nao se exclui nada (eles sao o alvo)');
  const muitos = {}; for (let i = 0; i < 200; i++) muitos[i] = 'recuperado';
  ok(idsForaDoEstado('defeito', muitos).length === 0,
     '  com 200 ids, nao monta URL gigante (cai no pos-filtro JS)');
  ok(idsForaDoEstado('defeito', {}).length === 0, '  sem historico, nada a excluir');
}
ok(/if \(fora\.length\) sel = sel\.not\('id', 'in'/.test(GOOD),
   '  e a consulta aplica isso com .not(id,in) — AND com o .or()');
ok(GOOD.indexOf("if (fora.length)") < GOOD.indexOf('.limit(300);'),
   '  ANTES do .limit(300) (era o ponto do apontamento)');

ok(/\.or\(cond\)/.test(GOOD), 'a consulta usa a condicao da aba');
ok(/buscar\(q, estado, porPedido\)/.test(GOOD), 'a busca recebe a aba e o historico por pedido');
ok(/buscar\(termoContagem, 'todos', porPedido\)/.test(GOOD),
   '  e a CONTAGEM das abas pede "todos" (senao cada aba contaria so a si mesma)');
ok(GOOD.indexOf('const porPedido') < GOOD.indexOf('let linhas = await buscar'),
   'porPedido e resolvido ANTES da busca (era depois; por isso nao dava pra filtrar no banco)');

// ── 8. origem: devolucao SEM NF nao pode virar defeito de estoque ────
ok(/veioDeDevolucao = !!\(item\.shipment_id/.test(GOOD),
   'shipment_id e o sinal de origem (toda devolucao tem; defeito de estoque nao)');
ok(/select\('id, tipo, tipo_anterior, status, shipment_id/.test(GOOD),
   '  e o select traz shipment_id (senao a checagem seria sempre falsa)');
ok(/shipment_id: String\(dados\.shipment_id \|\| dados\.nf_chave \|\| dados\.magalu_protocolo/.test(SERVER),
   '  o server grava shipment_id em cascata: shipment > chave NF > protocolo Magalu');
ok(/!dados\.shipment_id && !dados\.nf_chave && !dados\.magalu_protocolo/.test(SERVER),
   '  e exige um dos tres — por isso devolucao SEM NF existe e precisa ser reconhecida');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
