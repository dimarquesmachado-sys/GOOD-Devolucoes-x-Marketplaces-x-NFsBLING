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

// ── ⚠️ e a busca cobre a JANELA INTEIRA sem índice ──────────────────
//
// [stated 13/09] "agora tá demorando mto pra achar o produto (...) pq isso?
// que inferno."
//
// O aviso anterior só pegava `construindo: true`. Mas ENTRE o boot e o
// agendamento, `ts` é null e `construindo` é FALSE — a busca passava direto
// e ia no Bling, que é lento.
//
// ⚠️ E isso acontece depois de CADA DEPLOY.
{
  const i = srv.indexOf("app.get('/api/produtos/buscar'");
  // ⚠️ recorto ate o fim do handler contando chaves. Janela fixa quebrou
  // DE NOVO (o alvo estava em 4188, a janela era 4000) — e e a decima
  // primeira vez hoje. Ja virou regra: em teste, nunca janela fixa.
  let prof = 0;
  let fim = i;
  for (let k = srv.indexOf('{', i); k < srv.length; k++) {
    if (srv[k] === '{') prof++;
    else if (srv[k] === '}') { prof--; if (prof === 0) { fim = k; break; } }
  }
  const rota = srv.slice(i, fim);
  ok(/if \(!IDX_PROD\.ts\) \{/.test(rota),
     '⚠️ a busca cobre TODO caso sem indice (nao so o "construindo")');
  ok(/tentarConstruirIndice\('busca chegou antes do indice'\)/.test(rota),
     '  e DISPARA a construcao na hora (nao espera o agendamento)');
  ok(/Estou montando o catálogo/.test(rota),
     '  avisando por que esta lento');
}

// ── e o boot não perde tempo antes de começar ───────────────────────
{
  ok(/tentarConstruirIndice\('boot'\); \}, 5 \* 1000/.test(srv),
     '⚠️ o boot agenda em 5s (era 20s — tempo morto que criava a janela)');
  ok(/ESPACO \* 3\)/.test(srv),
     '  mantendo o espacamento que evita avalanche de chamadas');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
