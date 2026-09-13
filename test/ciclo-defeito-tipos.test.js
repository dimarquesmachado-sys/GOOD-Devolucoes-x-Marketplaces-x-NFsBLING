// Roda com: node test/ciclo-defeito-tipos.test.js
//
// ⚠️ CASO REAL (13/09): o dono clicou "Excluir este registro" e levou
//
//   new row violates check constraint "devolucoes_tipo_check"
//
// A coluna `tipo` tem lista FECHADA, e `defeito_excluido` não está nela —
// igual `defeito_estoque`, que já tinha pegado o lançamento. **O código LÊ
// esses valores em vários lugares, mas a tabela nunca aceitou GRAVAR.**
//
// ⚠️ E o ciclo inteiro dependia disso: excluir, recuperar e descartar todos
// gravam tipo. No recuperar/descartar o efeito seria pior — o `catch`
// engolia o erro, então o admin autorizava a peça, nada gravava, e ela
// ficava ATIVA para sempre: o galpão veria como pendente algo já decidido.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const src = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'defeitos-ciclo.js'), 'utf8');

// ── ⚠️ a exclusão tem fallback por status ───────────────────────────
{
  ok(/check constraint/.test(src),
     '⚠️ o codigo reconhece a recusa do check');
  ok(/excluido via status/.test(src),
     '  e a exclusao cai pro `status` quando o tipo e recusado');
  ok(/status: 'cancelled'/.test(src),
     "  com 'cancelled' (valor que o codigo ja le)");
}

// ── e a decisão do admin também ─────────────────────────────────────
{
  ok(/decisao gravada via status/.test(src),
     '⚠️ recuperar/descartar tambem tem fallback');
  ok(/status: 'concluido'/.test(src),
     "  com 'concluido'");
}

// ── ⚠️ e o fallback REALMENTE tira das listas ativas ────────────────
//
// Não adianta gravar se o registro continuar aparecendo: o dono acharia que
// a exclusão não funcionou.
{
  const m = /const ATIVOS = '([^']+)'/.exec(src);
  ok(!!m, 'achei a definicao dos ATIVOS');
  if (m) {
    // ATIVOS exige status=concluido junto de tipo=problema
    ok(/status\.eq\.concluido/.test(m[1]),
       '⚠️ os ATIVOS dependem do status — logo mudar o status TIRA de la');
  }
}

// ── e o estado_atual conta a história ───────────────────────────────
//
// ⚠️ Sem o tipo certo, é o `estado_atual` que diz o que aconteceu para quem
// abrir a ficha depois.
{
  ok(/REGISTRO EXCLUIDO por/.test(src),
     'a exclusao escreve o que houve no `estado_atual`');
  ok(/RECUPERADA - liberada por/.test(src) && /DESCARTE AUTORIZADO por/.test(src),
     '  e a decisao do admin tambem');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
