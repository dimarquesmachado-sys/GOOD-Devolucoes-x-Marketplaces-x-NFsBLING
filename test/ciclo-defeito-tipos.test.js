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
const srcServer = fs.readFileSync(
  path.join(__dirname, '..', 'server.js'), 'utf8');
const srcRelatorios = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'rotas-relatorios.js'), 'utf8');
const srcHelper = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'defeito-excluido.js'), 'utf8');
const { marcadoExcluido } = require('../lib/defeito-excluido');

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
  // b312 (revisao Codex #269, rodada 2) - essa checagem morou dentro de
  // situacaoDe() ate virar a fonte unica marcadoExcluido() (lib/defeito-
  // excluido.js), usada por situacaoDe(), ficha, /excluir e o relatorio.
  ok(/status === 'cancelled'/.test(srcHelper),
     '⚠️ a fonte unica de exclusao (usada por situacaoDe) reconhece a exclusao-por-status');
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
  ok(/item\.tipo === 'problema' && item\.status === 'cancelled'\) return true/.test(srcHelper),
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
//
// b312 (revisao Codex #269, rodada 2, P2) - os tres formatos agora moram
// numa fonte unica (lib/defeito-excluido.js): antes situacaoDe() tinha seu
// PROPRIO regex, case-sensitive, enquanto o filtro de banco (linha ~570)
// usa ILIKE (case-insensitive) - uma marca gravada com case diferente do
// usual passava pelo SQL mas continuava "ativa" na classificacao.
{
  ok(/situacaoDe = \(x\) => \{[\s\S]{0,80}if \(marcadoExcluido\(x\)\) return 'excluido';/.test(src),
     '⚠️ situacaoDe() usa a fonte unica marcadoExcluido() (case-insensitive)');
}

// ── e a fonte unica e case-insensitive, igual o ILIKE do banco ─────
{
  ok(/require\('\.\/defeito-excluido'\)/.test(src),
     '⚠️ defeitos-ciclo.js importa a fonte unica de exclusao');
  ok(/MARCA_EXCLUIDO = \/REGISTRO EXCLUIDO\/i/.test(srcHelper),
     '  ⚠️ e o regex da fonte unica e case-insensitive, igual o ILIKE');
  ok(marcadoExcluido({ tipo: 'problema', status: 'concluido', estado_atual: 'registro excluido por engano' })
     && marcadoExcluido({ tipo: 'problema', status: 'concluido', estado_atual: '🗑️ REGISTRO EXCLUIDO por fulano' })
     && !marcadoExcluido({ tipo: 'problema', status: 'concluido', estado_atual: null }),
     '  ⚠️ marcadoExcluido() reconhece a marca em qualquer case e ignora estado_atual null/ausente');
}

// ── e a ficha classifica a exclusao-so-por-marca tambem ─────────────
//
// revisao Codex #269 (rodada 2, P1): a ficha (GET /api/defeitos/ficha/:id)
// so olhava tipo==='defeito_excluido' pra decidir `situacao` - um registro
// excluido pelo fallback do estado_atual chegava como se estivesse ativo,
// escondendo o botao Restaurar (admin-only) e liberando retirar
// peca/pedido num registro ja excluido.
{
  const iFicha = src.indexOf("app.get('/api/defeitos/ficha/:id'");
  const iComentario = src.indexOf("app.post('/api/defeitos/:id/comentario'");
  const blocoFicha = src.slice(iFicha, iComentario > iFicha ? iComentario : undefined);
  ok(/situacao: marcadoExcluido\(item\) \? 'excluido'/.test(blocoFicha),
     '⚠️ a ficha usa marcadoExcluido() pra decidir a situacao (nao so tipo===defeito_excluido)');
}

// ── e /excluir e idempotente pros tres formatos (retry nao duplica) ─
//
// revisao Codex #269 (rodada 2, P2): o retry (resposta perdida, duplo
// clique) so era pego se tipo==='defeito_excluido' - um registro ja
// excluido pelo fallback do estado_atual seria excluido DE NOVO, trocando
// o motivo/quem-excluiu original e duplicando a entrada no historico.
{
  const iExcluirIdem = src.indexOf("app.post('/api/defeitos/:id/excluir'");
  const iLista = src.indexOf("app.get('/api/defeitos/lista'");
  const blocoExcluirIdem = src.slice(iExcluirIdem, iLista > iExcluirIdem ? iLista : undefined);
  ok(/select\('id, tipo, status, estado_atual, produto_sku'\)/.test(blocoExcluirIdem),
     '⚠️ /excluir le status e estado_atual antes de decidir se ja esta excluido');
  ok(/if \(marcadoExcluido\(item\)\) return res\.json\(\{ ok: true, ja_excluido: true \}\);/.test(blocoExcluirIdem),
     '  ⚠️ e usa a fonte unica pra checar isso (pega os tres formatos)');
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

  // b312 (revisao Codex #269, rodada 2, P2) - a trava era um SELECT
  // separado do UPDATE: entre os dois, um admin podia excluir o registro
  // e este UPDATE (que ja tinha passado no cheque) sobrescrevia a marca
  // sem saber que ela tinha acabado de chegar. A checagem precisa estar no
  // WHERE do proprio UPDATE, nao num SELECT antes dele.
  ok(!/const atual = await cli\(\)\.from\(T_DEV\)\.select\('estado_atual'\)/.test(blocoEstado),
     '  ⚠️ nao faz mais um SELECT separado so pra checar a marca (era a race condition)');
  ok(/\.update\(\{ estado_atual: texto \|\| null \}\)\.eq\('id', req\.params\.id\)\s*\n\s*\.or\('estado_atual\.is\.null,estado_atual\.not\.ilike\.%REGISTRO EXCLUIDO%'\)/.test(blocoEstado),
     "  ⚠️ a condicao 'nao esta excluido' entra no proprio UPDATE (atomico)");
}

// ── e o estoque (server.js) filtra a marca ANTES do .limit() ────────
//
// revisao Codex #269 (rodada 2, P2): o filtro rodava em JS DEPOIS do
// .limit(50)/.limit(1000) - um SKU (ou uma pagina) com muitas linhas
// excluidas entre as mais recentes ocupava a janela toda, e peca ativa
// mais antiga nem chegava a ser buscada. O filtro tem que entrar no
// banco, antes do .limit.
{
  const marcaAntesDoLimite = (ini, fimStr) => {
    const iFim = srcServer.indexOf(fimStr, ini);
    const bloco = srcServer.slice(ini, iFim);
    const iOr = bloco.indexOf("estado_atual.is.null,estado_atual.not.ilike.%REGISTRO EXCLUIDO%");
    // lastIndexOf: o COMENTARIO acima do .or() cita ".limit(50)"/".limit(1000)"
    // a titulo de exemplo - a chamada de verdade e a ULTIMA ocorrencia do bloco.
    const iLimit = bloco.lastIndexOf('.limit(');
    return iOr !== -1 && iLimit !== -1 && iOr < iLimit;
  };
  const iPorSku = srcServer.indexOf("app.get('/api/defeitos/por-sku'");
  ok(marcaAntesDoLimite(iPorSku, "if (error) return res.status(500)"),
     '⚠️ /api/defeitos/por-sku filtra a marca no banco, antes do .limit(50)');
  ok(!/\.filter\(d => !\/REGISTRO EXCLUIDO\/\.test\(String\(d\.estado_atual/.test(srcServer),
     '  ⚠️ e nao repete o filtro em JS depois (o de banco ja cobre)');

  const iDefeitos = srcServer.indexOf("app.get('/api/defeitos', requerEstoquista");
  ok(marcaAntesDoLimite(iDefeitos, 'if (error) {'),
     '⚠️ /api/defeitos filtra a marca no banco, antes do .limit(1000)');
}

// ── e o relatorio de devolucoes nao conta quem foi excluido ─────────
//
// revisao Codex #269 (rodada 2, P1): /api/admin/relatorios/devolucoes nao
// selecionava nem filtrava `estado_atual` - um registro excluido
// continuava inflando totalProblema, o percentual de problema e o
// ranking de SKU problematico.
{
  ok(/estado_atual/.test(srcRelatorios) && /require\('\.\/defeito-excluido'\)/.test(srcRelatorios),
     '⚠️ o relatorio seleciona estado_atual e usa a fonte unica de exclusao');
  ok(/listaFinal = listaFinal\.filter\(d => !marcadoExcluido\(d\)\)/.test(srcRelatorios),
     '  ⚠️ e tira quem foi excluido ANTES de qualquer agregacao (cards/rankings)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
