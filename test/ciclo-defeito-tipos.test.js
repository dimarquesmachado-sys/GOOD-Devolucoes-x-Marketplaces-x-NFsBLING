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
//
// revisao Codex #264 (P1): o fallback gravava `status: 'concluido'` — mas a
// peça ATIVA já está com status='concluido' (é o par que /api/defeitos e
// /api/defeitos/por-sku tratam como disponível pra canibalização). Gravar o
// mesmo valor de novo era NO-OP: a peça autorizada continuava aparecendo
// como se ainda estivesse lá, liberada pra retirar peça de novo.
{
  ok(/decisao gravada via status/.test(src),
     '⚠️ recuperar/descartar tambem tem fallback');
  const bloco = src.slice(src.indexOf('decisao gravada via status') - 400,
                           src.indexOf('decisao gravada via status'));
  ok(/status: 'delivered'/.test(bloco),
     "  com um status que NAO seja 'concluido' (senao e no-op) nem 'cancelled' (senao vira exclusao)");
  ok(!/status: 'concluido'/.test(bloco),
     '  ⚠️ nao pode ser concluido: a peca ativa ja esta assim, ficaria disponivel de novo');
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

// ── ⚠️ e a exclusao-por-status continua visivel e reversivel ────────
//
// revisao Codex #264 (P1): quando o fallback grava so o `status`, a linha
// mantem tipo='problema'. Se a aba Excluidos, o classificador situacaoDe()
// e o /restaurar so souberem olhar tipo='defeito_excluido', o registro some
// da tela assim que ela navega pra aba Excluidos e nunca mais pode ser
// restaurado.
{
  const m = /const EXCLUIDOS = "([^"]+)"/.exec(src);
  ok(!!m, 'achei a definicao dos EXCLUIDOS (aba)');
  if (m) {
    ok(/tipo\.eq\.defeito_excluido/.test(m[1]) && /status\.eq\.cancelled/.test(m[1]),
       '⚠️ a aba Excluidos busca os dois formatos (tipo OU status)');
  }
  ok(/situacaoDe[\s\S]{0,400}status === 'cancelled'/.test(src),
     '⚠️ situacaoDe() tambem reconhece a exclusao-por-status');
  ok(/excluidoPorStatus/.test(src),
     '⚠️ /restaurar reconhece a exclusao-por-status (nao so o tipo)');
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

// ── ⚠️ e a exclusão NÃO depende de coluna com lista fechada ─────────
//
// [stated 13/09] TRÊS erros seguidos de check, e todos meus:
//   defeito_excluido (tipo)  → tipo_check recusou
//   cancelled (status)       → status_check recusou
//   pendente (status)        → status_check recusou
//
// ⚠️ Eu estava ADIVINHANDO valores de lista fechada, um por vez, e cada
// tentativa custou uma rodada do dono.
//
// O `estado_atual` é TEXTO LIVRE — não tem check. A marca vai lá, e a lista
// filtra por ela.
{
  // ⚠️ o que importa e nao GRAVAR: as LEITURAS de `cancelled` continuam,
  // porque registros antigos podem ter sido marcados assim antes de eu
  // descobrir que o check recusa. Tirar a leitura sumiria com eles.
  const iUpd = src.indexOf("if (rU.error && /check constraint/");
  const bloco = src.slice(iUpd, iUpd + 900);
  ok(!/status: 'cancelled'/.test(bloco),
     '⚠️ o fallback nao GRAVA mais `cancelled` (o check recusa)');
  ok(/x\.status === 'cancelled'\) return 'excluido'/.test(src),
     '  mas a LEITURA fica (registros antigos podem ter a marca velha)');
  ok(!/status: 'pendente',\n\s*estado_atual: camposExc/.test(src),
     '  nem `pendente`');
  ok(/estado_atual: camposExc\.estado_atual,/.test(src),
     '  grava a marca no `estado_atual` (texto livre)');
}

// ── e a lista filtra pela marca ─────────────────────────────────────
//
// revisao Codex #269 (P1): `.not('estado_atual','ilike',...)` sozinho
// derruba quem tem `estado_atual` NULL (NOT NULL = NULL em SQL, e
// PostgREST trata como falso) — ou seja, esvaziava as proprias abas
// ativas, porque quase nenhuma linha ativa tem a coluna preenchida.
{
  ok(/estado_atual\.is\.null/.test(src) && /estado_atual\.not\.ilike\.%REGISTRO EXCLUIDO%/.test(src),
     '⚠️ o filtro das abas ativas/terminais inclui quem tem estado_atual NULL');
  ok(/if \(estado !== 'excluido' && estado !== 'todos'\)/.test(src),
     "  so fora das abas Excluidos e Todos (Todos precisa trazer TUDO)");
  ok(!/sel\.ilike\('estado_atual', '%REGISTRO EXCLUIDO%'\)/.test(src),
     '  ⚠️ e a aba Excluidos NAO usa um ilike proprio (isso e AND com o `cond` da aba e perderia excluido antigo sem a marca)');
}

// ── e a aba Excluidos acha o formato so-marca DENTRO do proprio OR ──
//
// revisao Codex #269 (P1): o `ilike` de cima era um segundo `.and()` sobre
// o `cond` (EXCLUIDOS) que so aceita tipo=defeito_excluido OU
// status=cancelled — um problema/concluido marcado so no estado_atual (o
// formato que o b310 realmente grava) nunca casava com nenhum dos dois e
// sumia da aba Excluidos.
{
  const m = /const EXCLUIDOS = "([^"]+)"/.exec(src);
  ok(!!m, 'achei a definicao dos EXCLUIDOS (aba) — agora como string dupla, por causa do % dentro');
  if (m) {
    ok(/estado_atual\.ilike\.%REGISTRO EXCLUIDO%/.test(m[1]),
       '⚠️ a marca faz parte do proprio OR da aba Excluidos, nao de um filtro extra em AND');
  }
}

// ── e situacaoDe() reconhece a marca em QUALQUER tipo/status ────────
//
// revisao Codex #269 (P1): o formato so-marca (b310) preserva tipo/status
// como estavam (ex.: problema/concluido, o par de peca ATIVA) — exigir um
// status especifico (como 'pendente') pra reconhecer a marca deixava esse
// formato invisivel pro classificador.
{
  ok(/if \(\/REGISTRO EXCLUIDO\/\.test\(String\(x\.estado_atual \|\| ''\)\)\) return 'excluido';/.test(src),
     '⚠️ situacaoDe() aceita a marca sozinha, sem exigir tipo/status especificos');
}

// ── e o SELECT traz a coluna que o classificador precisa ────────────
{
  const m = /\.select\('id, produto_sku[^']*'\)/.exec(src);
  ok(!!m && /estado_atual/.test(m[0]),
     '⚠️ buscar() seleciona `estado_atual` (senao situacaoDe() nunca ve a marca)');
}

// ── e /restaurar aceita o formato so-marca sem inventar mudanca de tipo ──
{
  ok(/excluidoPorMarca/.test(src),
     '⚠️ /restaurar reconhece a exclusao-so-por-estado_atual (b310)');
  const iRestaurar = src.indexOf("app.post('/api/defeitos/:id/restaurar'");
  const iExcluir = src.indexOf("app.post('/api/defeitos/:id/excluir'");
  const blocoRestaurar = src.slice(iRestaurar, iExcluir);
  ok(/else if \(excluidoPorMarca\)[\s\S]{0,500}update\(\{ estado_atual: null \}\)/.test(blocoRestaurar),
     '  ⚠️ e so apaga a marca — nao mexe em tipo/status, que nunca mudaram de verdade nesse formato');
}

// ── e /estado (edicao livre) nao pode desfazer a exclusao por baixo ──
{
  ok(/PUT '\+ '\/api\/defeitos\/:id\/estado'|put\('\/api\/defeitos\/:id\/estado'/.test(src),
     'achei a rota de edicao livre do estado');
  const iEstado = src.indexOf("app.put('/api/defeitos/:id/estado'");
  const iPedido = src.indexOf("app.post('/api/defeitos/pedido'");
  const blocoEstado = src.slice(iEstado, iPedido > iEstado ? iPedido : undefined);
  ok(/REGISTRO EXCLUIDO/.test(blocoEstado) && /res\.status\(400\)/.test(blocoEstado),
     '⚠️ um usuario comum nao consegue limpar/trocar o estado de um registro excluido por esta rota (so o /restaurar, admin-only)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
