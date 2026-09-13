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

ok(/fotos_do_indice\s*:\s*\{/.test(health), '/health expoe o diagnostico de fotos do indice');
ok(/com_foto:[\s\S]*IDX_PROD\.itens\.filter\(\(x\) => x && x\.imagem\)\.length/.test(health),
  'com_foto conta somente itens do indice que possuem imagem');
ok(/detalhes_feitos:[\s\S]*EAN_PROGRESSO\.feitos/.test(health),
  'diagnostico informa quantos detalhes foram processados');
ok(/detalhes_total:[\s\S]*EAN_PROGRESSO\.total/.test(health),
  'diagnostico informa o total de detalhes');
ok(/passo_concluido:[\s\S]*EAN_PROGRESSO\.concluido/.test(health),
  'diagnostico informa se o passo terminou');
ok(/fila_prioritaria:[\s\S]*FOTOS_PEDIDAS\.length/.test(health),
  'diagnostico informa o tamanho da fila prioritaria sem expor SKUs');

// ⚠️ o /health é PÚBLICO: contagens sim, identificadores não
ok(!/fotos_do_indice\s*:\s*\{[\s\S]*?(?:sku|nome)\s*:/.test(health),
  'diagnostico nao inclui SKU nem nome de produto');

if (falhas) process.exit(1);
console.log('\n=== TODOS OS CASOS PASSARAM ===');
