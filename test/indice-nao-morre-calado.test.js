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
  // revisao Codex #265 (P1): `IDX_PROD.ts` fica preenchido MESMO quando a
  // construcao falha — o gate tem que tratar erro como "sem indice", senao
  // uma falha vira "montado" e a busca volta a cair no Bling calada.
  ok(/if \(!IDX_PROD\.ts \|\| IDX_PROD\.erro\) \{/.test(rota),
     '⚠️ a busca cobre TODO caso sem indice usavel (sem ts, OU com erro)');
  ok(/tentarConstruirIndice\('busca chegou antes do indice'\)/.test(rota),
     '  e DISPARA a construcao na hora (nao espera o agendamento)');
  ok(/Estou montando o catálogo/.test(rota),
     '  avisando por que esta lento');
}

// ── e o /health nao chama uma falha de "montado" ────────────────────
//
// revisao Codex #265 (mesmo criterio do gate acima): `montado` so pode
// ser true SEM erro, senao o /health mente no campo que existe pra nao
// deixar a gente supondo (b303).
{
  ok(/montado: !!\(typeof IDX_PROD !== "undefined" && IDX_PROD\.ts && !IDX_PROD\.erro\)/.test(srv),
     '⚠️ /health so reporta "montado" quando nao ha erro');
}

// ── e o agendamento do boot bate com o que ele afirma ────────────────
//
// revisao Codex #265 (P2): o comentario e o commit diziam "agenda em 5s",
// mas com o ESPACO padrao (120000ms) o atraso EFETIVO e 5s + ESPACO*3 =
// 365000ms (6min05s) — nao 5s. Calculo o valor de verdade em vez de
// conferir os pedacos `5 * 1000` e `ESPACO * 3` isolados (foi assim que a
// conta errada passou: cada pedaco batia, a soma nao).
{
  const m = srv.match(/tentarConstruirIndice\('boot'\); \}, (\S+) \* 1000 \+ ESPACO \* (\d+)\)/);
  ok(!!m, '⚠️ acho a chamada de agendamento do boot pra conferir a conta');
  if (m) {
    const ESPACO_PADRAO = 120000;
    const atrasoMs = Number(m[1]) * 1000 + ESPACO_PADRAO * Number(m[2]);
    ok(atrasoMs === 365000,
       `  atraso efetivo com ESPACO padrao = ${atrasoMs}ms (esperado 365000ms = 6min05s, dominado pelo espacamento de b272 — nao pelos 5s)`);
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
