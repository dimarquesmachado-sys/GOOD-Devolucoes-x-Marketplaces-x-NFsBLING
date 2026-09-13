// Roda com: node test/indice-nao-morre-calado.test.js
//
// ⚠️ DIAGNÓSTICO REAL (13/09), pelo /health que passamos a expor:
//
//   indice_produtos: montado=false, construindo=false, qtd=0, erro=null
//   uptime_min: 2              (o índice é agendado para 20s após o boot)
//   ritmo_compartilhado: pausa_ativa=true
//
// NEM MONTADO NEM CONSTRUINDO com 2 min de vida = ele TENTOU e FALHOU. E o
// porquê estava no mesmo /health: **a conta em pausa**. O índice tenta
// montar, o porteiro segura, a construção falha — e os três
// `.catch(() => {})` ENGOLIAM o erro.
//
// ⚠️ Resultado: o índice ficava morto para sempre, TODA busca caía no Bling,
// e o dono via "Buscando no Bling..." por minutos.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// ── ⚠️ nenhum catch vazio engolindo a falha ─────────────────────────
{
  ok(!/construirIndiceProdutos\(\)\.catch\(\(\) => \{\}\)/.test(srv),
     '⚠️ nao ha mais `.catch(() => {})` engolindo a falha do indice');
  ok(/function tentarConstruirIndice/.test(srv),
     '  ha uma funcao unica que trata a tentativa');
}

// ── e a falha fica VISÍVEL ──────────────────────────────────────────
//
// ⚠️ Foi a falta disso que me deixou supondo por rodadas: o /health dizia
// `erro: null` porque ninguém escrevia nele.
{
  ok(/IDX_PROD\.erro = String\(\(e && e\.message\) \|\| e\)/.test(srv),
     '⚠️ a falha vai pro `IDX_PROD.erro` (que o /health mostra)');
  ok(/\[IDX_PROD\] falhou/.test(srv),
     '  e pro log, com o motivo');
  ok(/indice_produtos:/.test(srv),
     '  e o /health expoe o estado');
}

// ── ⚠️ e REAGENDA, porque a pausa do porteiro passa ─────────────────
{
  ok(/setTimeout\(\(\) => tentarConstruirIndice\('nova tentativa'\)/.test(srv),
     '⚠️ reagenda quando falha (a pausa do porteiro passa)');
  ok(/Math\.min\(30 \* Math\.pow\(2, _tentativasIndice - 1\), 300\)/.test(srv),
     '  com espera crescente ate 5 min');

  // a espera cresce como esperado
  const espera = (n) => Math.min(30 * Math.pow(2, n - 1), 300);
  ok(espera(1) === 30, '  1a tentativa: 30s (a pausa dura pouco)');
  ok(espera(4) === 240, '  4a: 240s');
  ok(espera(5) === 300 && espera(9) === 300,
     '  ⚠️ e o teto segura em 5 min (nao martela conta castigada)');
}

// ── e zera o contador quando dá certo ───────────────────────────────
{
  ok(/_tentativasIndice = 0;/.test(srv),
     'zera o contador ao montar (senao a proxima falha ja comeca no teto)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
