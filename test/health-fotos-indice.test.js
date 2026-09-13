'use strict';
// Teste escrito pelo Codex na revisão do #273, com o recorte por marcadores
// (a alternativa segura ao contador de chaves que eu tinha proposto).

const fs = require('fs');
const path = require('path');
const { entreMarcadores } = require('./_recorte');

let falhas = 0;
function ok(condicao, mensagem) {
  if (condicao) console.log(`ok  ${mensagem}`);
  else { console.error(`FALHOU  ${mensagem}`); falhas++; }
}

const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// ⚠️ marcadores estáveis, e falha dizendo QUAL faltou
let health = '';
try {
  health = entreMarcadores(srv, "app.get('/health'", "app.get('/api/keepalive'");
  ok(true, 'localiza o handler completo do /health por marcadores estaveis');
} catch (e) {
  ok(false, 'localiza o handler do /health: ' + e.message);
}

// apontamento Codex #275: as asserções abaixo checavam o handler /health
// inteiro, entao um `com_foto` movido pra fora de `fotos_do_indice` (mas
// ainda presente em algum lugar da rota) passava sem acusar a regressao de
// forma. Recorta so o objeto do diagnostico e valida a forma aninhada nele.
let diagnostico = '';
try {
  diagnostico = entreMarcadores(health, 'fotos_do_indice: {', 'indice_produtos: {');
  ok(true, 'localiza o objeto fotos_do_indice por marcadores estaveis');
} catch (e) {
  ok(false, 'localiza o objeto fotos_do_indice: ' + e.message);
}

// apontamento Codex #275 (rodada 2): os regexes abaixo leem o TEXTO fonte, e
// um campo comentado (`// detalhes_feitos: ...`) continua tendo esse texto —
// entao um campo removido via comentario passava como se ainda existisse.
// Tira comentario de linha antes de checar presenca/ausencia de campos.
const semComentarios = diagnostico.replace(/\/\/.*$/gm, '');

ok(/com_foto:[\s\S]*IDX_PROD\.itens\.filter\(\(x\) => x && x\.imagem\)\.length/.test(semComentarios),
  'com_foto conta somente itens do indice que possuem imagem');
ok(/detalhes_feitos:[\s\S]*EAN_PROGRESSO\.feitos/.test(semComentarios),
  'diagnostico informa quantos detalhes foram processados');
ok(/detalhes_total:[\s\S]*EAN_PROGRESSO\.total/.test(semComentarios),
  'diagnostico informa o total de detalhes');
ok(/passo_concluido:[\s\S]*EAN_PROGRESSO\.concluido/.test(semComentarios),
  'diagnostico informa se o passo terminou');
ok(/fila_prioritaria:[\s\S]*FOTOS_PEDIDAS\.length/.test(semComentarios),
  'diagnostico informa o tamanho da fila prioritaria sem expor SKUs');

// ⚠️ o /health é PÚBLICO: contagens sim, identificadores não.
//
// apontamento Codex #275: checar so os NOMES das chaves (`sku`, `nome`) nao
// pega um campo novo que reexponha o VALOR do array/identificador por outro
// nome, tipo `pendentes: FOTOS_PEDIDAS`. Por isso, alem do nome das chaves,
// exigimos que toda referencia aos arrays com identificadores
// (FOTOS_PEDIDAS guarda SKU cru; IDX_PROD.itens guarda sku/nome) so apareca
// reduzida a `.length`/`.filter(...).length`, nunca como valor bruto.
//
// apontamento Codex #275 (rodada 2): a checagem de IDX_PROD.itens exigia so
// que um `.filter(` viesse depois — um campo tipo
// `itens_expostos: IDX_PROD.itens.filter((x) => x && x.imagem)` (sem
// `.length`) passava e vazava os itens crus filtrados. Agora a lookahead
// exige a cadeia inteira `.filter(...).length`, igual ja fazia a checagem
// da FOTOS_PEDIDAS.
ok(!/(?:sku|nome)\s*:/.test(semComentarios),
  'diagnostico nao inclui chave SKU nem nome de produto');
ok(!/(?<!typeof\s)FOTOS_PEDIDAS(?!\.length\b)/.test(semComentarios),
  'toda referencia a FOTOS_PEDIDAS no diagnostico usa .length (nunca expoe os SKUs da fila)');
ok(!/(?<!Array\.isArray\()IDX_PROD\.itens(?!\.filter\([^,}]*?\)\.length)/.test(semComentarios),
  'toda referencia a IDX_PROD.itens no diagnostico usa .filter(...).length (nunca expoe os itens crus)');

if (falhas) process.exit(1);
console.log('\n=== TODOS OS CASOS PASSARAM ===');
