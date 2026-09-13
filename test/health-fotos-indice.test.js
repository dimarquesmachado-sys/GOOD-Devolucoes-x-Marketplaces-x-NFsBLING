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

// ⚠️ b318 (Codex, P2) - RECORTO O OBJETO, e confiro DENTRO dele.
//
// Minha versao procurava os campos no /health INTEIRO. Se alguem mover
// `com_foto` pra fora do `fotos_do_indice` mas deixar noutro lugar da rota,
// o teste continuaria verde — e o diagnostico estaria quebrado.
const iObj = health.indexOf('fotos_do_indice: {');
ok(iObj >= 0, '/health expoe o diagnostico de fotos do indice');
const objeto = iObj >= 0 ? health.slice(iObj, health.indexOf('indice_produtos:', iObj)) : '';

ok(/com_foto:[\s\S]*IDX_PROD\.itens\.filter\(\(x\) => x && x\.imagem\)\.length/.test(objeto),
  'com_foto conta somente itens do indice que possuem imagem');
ok(/detalhes_feitos:[\s\S]*EAN_PROGRESSO\.feitos/.test(objeto),
  'diagnostico informa quantos detalhes foram processados');
ok(/detalhes_total:[\s\S]*EAN_PROGRESSO\.total/.test(objeto),
  'diagnostico informa o total de detalhes');
ok(/passo_concluido:[\s\S]*EAN_PROGRESSO\.concluido/.test(objeto),
  'diagnostico informa se o passo terminou');
ok(/fila_prioritaria:[\s\S]*FOTOS_PEDIDAS\.length/.test(objeto),
  'diagnostico informa o tamanho da fila prioritaria');

// ── ⚠️ b318 (Codex, P2) - o que VAZA, nao o nome do campo ────────────
//
// Minha versao proibia as CHAVES `sku:` e `nome:`. Mas o risco real e o
// VALOR sair: `pendentes: FOTOS_PEDIDAS` (o array inteiro, com os SKUs) ou
// `itens: IDX_PROD.itens` passariam batido, porque a chave tem outro nome.
//
// O /health e PUBLICO. Confiro o que SAI: nada de array de identificadores.
ok(!/:\s*FOTOS_PEDIDAS\s*[,}]/.test(objeto),
  '⚠️ nao publica a LISTA de SKUs pedidos (so `.length`)');
ok(!/:\s*IDX_PROD\.itens\s*[,}]/.test(objeto),
  '  nem o array de produtos do indice');
ok(!/\.map\(|\.slice\(0,|\.join\(/.test(objeto),
  '  e nao monta lista derivada deles');
ok(!/(sku|nome|codigo|titulo)\s*:/i.test(objeto),
  '  e nenhuma chave de identificador');

if (falhas) process.exit(1);
console.log('\n=== TODOS OS CASOS PASSARAM ===');
