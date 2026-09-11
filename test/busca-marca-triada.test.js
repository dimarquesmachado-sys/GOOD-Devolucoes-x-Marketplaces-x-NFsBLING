// Roda com: node test/busca-marca-triada.test.js
//
// ⚠️ CASO REAL (11/09): o dono buscou "charles", viu a NF 78425 na lista
// como qualquer outra — e ela JÁ TINHA SIDO TRIADA pelo Lucas no dia
// anterior, 16:21. Nada na tela dizia isso.
//
// O RISCO É TRIAR DE NOVO: o estoquista escolhe o card, refaz o trabalho, e
// pode gerar segunda entrada de estoque ou segunda NF de devolução para o
// mesmo retorno.
//
// ⚠️ E isso explica a ausência da ESTRELA sem parecer defeito: devolução
// triada sai da espreita DE PROPÓSITO. Passamos horas investigando a estrela
// de um caso onde o sistema estava certo — porque a tela não contava.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const front = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'busca.js'), 'utf8');

// ── o servidor consulta quem já foi triado ──────────────────────────
{
  ok(/const jaTriadas = new Map\(\)/.test(srv),
     'a busca por nome consulta o que ja foi triado');

  // ⚠️ os campos REAIS da tabela — eu tinha escrito `triado_em`/`triado_por`
  // de cabeça, e nenhum dos dois existe (Regra 4.12)
  ok(/select\('nf_numero, nf_serie, created_at, funcionario, status, problema_descricao'\)/.test(srv),
     '  ⚠️ com os campos REAIS (`created_at`/`funcionario`, nao inventados)');
}

// ── b232.3 (Codex): numero sozinho nao basta, e sintetico nao conta ─
{
  ok(/jaTriadas\.set\(chaveNF\(r\.nf_numero, r\.nf_serie\), r\)/.test(srv),
     'a marca de "ja triada" casa por NUMERO + SERIE, nao so numero');
  ok(/jaTriadas\.get\(chaveNF\(c\.numero, c\.serie\)\)/.test(srv),
     '  e a leitura usa a mesma chave numero+serie');

  const i = srv.indexOf('const jaTriadas = new Map()');
  const bloco = srv.slice(i, i + 1400);
  ok(/if \(String\(r\.problema_descricao \|\| ''\)\.includes\('\[ESTORNADA SEM RETORNO\]'\)\) continue;/.test(bloco),
     '  e registro SINTETICO do card de estornadas nao marca como triada');
}

// ── ⚠️ e a marca vale nos DOIS caminhos do card ─────────────────────
//
// O card com espreita e o sem espreita são dois `return` diferentes. Marcar
// só um deixaria metade dos casos sem aviso.
{
  ok(/if \(!e\) return \{ \.\.\.base, \.\.\.marcaTriada \};/.test(srv),
     'o card SEM espreita leva a marca');
  const i = srv.indexOf('na_espreita: true');
  const bloco = srv.slice(Math.max(0, i - 200), i + 50);
  ok(/\.\.\.marcaTriada,/.test(bloco),
     '  e o card COM espreita tambem');
}

// ── e a tela mostra ─────────────────────────────────────────────────
{
  ok(/JA TRIADA/.test(front), 'a tela mostra o aviso de ja triada');
  ok(/pode gerar entrada e NF duplicadas/.test(front),
     '  ⚠️ dizendo o RISCO (triar de novo duplica estoque e NF)');
  ok(/triada_por/.test(front) && /triada_em/.test(front),
     '  com quem triou e quando');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
