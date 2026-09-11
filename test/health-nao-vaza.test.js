// Roda com: node test/health-nao-vaza.test.js
//
// ⚠️ O `/health` É PÚBLICO DE PROPÓSITO — qualquer um que alcance o serviço
// lê. E eu já errei DUAS VEZES hoje sobre o que cabe nele:
//
//   1. quis listar os caminhos do ML com 403 — eles carregam id de pedido,
//      envio e reclamação (peguei sozinho, virou só contagem)
//   2. listei até 60 pares número/série de NF viva, julgando inofensivo
//      ("número de NF sozinho não identifica ninguém"). O Codex apontou P1:
//      número+série permite consultar a nota em outros lugares. Não é dado
//      meu para publicar.
//
// A regra que sobra: no `/health` vão CONTAGENS e ESTADOS. Identificadores
// de documento, pedido, envio ou pessoa vão em rota AUTENTICADA.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');

// recorta o bloco do /health (do `app.get('/health'` até o fim do handler)
const iH = srv.indexOf("app.get('/health'");
ok(iH > 0, 'achei o handler do /health');
const bloco = srv.slice(iH, iH + 12000);
const semComent = bloco.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── ⚠️ nada de listas de identificadores ────────────────────────────
{
  // o padrão que me pegou: `.map(...)` produzindo strings de NF/pedido
  ok(!/nfs_no_cruzamento:/.test(semComent),
     '⚠️ o /health NAO lista numeros de NF (P1 do Codex no #225)');
  ok(!/\.map\(\(e\) => String\(e\.nf\)/.test(semComent),
     '  nem por outro caminho que produza a mesma lista');

  // contagem é o que pode
  ok(/nfs_no_cruzamento_qtd/.test(semComent),
     '  so a CONTAGEM (que ja diz se ha materia-prima)');
}

// ── e os caminhos do ML seguem fora ─────────────────────────────────
//
// ⚠️ Este já tinha sido pego antes (#198) — o teste guarda para não voltar.
{
  // ⚠️ o campo nasce em `lib/ml.js` (o /health so chama `diagnostico403()`),
  // entao confiro NA ORIGEM. Olhar so o server.js dava falso vermelho.
  const ml = fs.readFileSync(path.join(RAIZ, 'lib', 'ml.js'), 'utf8');
  const iD = ml.indexOf('function diagnostico403');
  const blocoML = ml.slice(iD, iD + 900);
  ok(/rotas_com_403_recente/.test(blocoML),
     'o 403 do ML entra como CONTAGEM');
  ok(!/caminhos:|rotas: \[|\.map\(\(r\) => r\.url/.test(blocoML),
     '  ⚠️ e nao como lista (os caminhos tem id de pedido e envio)');
}

// ── ⚠️ e a pergunta que eu precisava responder tem rota AUTENTICADA ──
//
// O diagnóstico não morreu: ele mudou de lugar. `/api/espreita/casa-nf/:nf`
// responde UMA NF por vez, com login, e diz o motivo de não casar.
{
  ok(/app\.get\('\/api\/espreita\/casa-nf\/:nf', requerLogin/.test(srv),
     'a consulta por NF existe e EXIGE login');
  ok(/o NUMERO esta na espreita, mas a SERIE divergiu/.test(srv),
     '  ⚠️ e distingue "nao esta" de "esta, mas a serie divergiu"');
}

// ⚠️ recorto ate o FIM do handler contando chaves, nao por janela fixa —
// mesmo conserto de test/cruzamento-espreita-fonte-unica.test.js. Janela
// fixa (2200/3000 chars) ja deu numero errado 7x em 10/09 (PR #231); um
// comentario a mais no handler bastava pra cortar o proprio trecho que o
// teste precisa ler, e o teste passaria vermelho sem checar nada.
const iRota2 = srv.indexOf("app.get('/api/espreita/casa-nf/:nf'");
let profR2 = 0;
let fimR2 = iRota2;
for (let k = srv.indexOf('{', iRota2); k < srv.length; k++) {
  if (srv[k] === '{') profR2++;
  else if (srv[k] === '}') { profR2--; if (profR2 === 0) { fimR2 = k; break; } }
}
const blocoRota2 = srv.slice(iRota2, fimR2);

// ── ⚠️ e a consulta nao AFIRMA sem dado ─────────────────────────────
//
// Minha 1ª versão respondia `casou: false` + "esta NF não está em nenhuma
// das 3 listas" mesmo com o cache VAZIO. O dono consultou logo após um
// deploy e levou exatamente isso — uma afirmação categórica sobre uma lista
// que não existia.
//
// ⚠️ É o MESMO erro que eu tinha acabado de consertar no índice de nomes
// (#220): confundir "não encontrei" com "ainda não sei". Repeti na rota de
// diagnóstico criada para investigar aquele.
{
  // ⚠️ b279.1 (Codex): cache VAZIO ≠ cache AUSENTE. Se a espreita montou e
  // nao ha devolucao pendente (dia tranquilo, tudo bipado), o cache esta
  // CERTO e vazio — e a resposta e "nao esta", nao "nao sei". Confundir os
  // dois manda o dono esperar um cache que ja chegou.
  ok(/if \(!ESP_CACHE\) \{/.test(blocoRota2),
     '⚠️ so o cache AUSENTE vira "nao sei"');
  ok(!/!lista\.length\)/.test(blocoRota2),
     '  e cache montado e VAZIO responde normalmente (nao esta)');
  // ⚠️ b278.2: o robo trocou meu `200 + casou: null` por **503**, e e
  // melhor: 503 diz "servico ainda nao consegue responder" no proprio
  // codigo HTTP, em vez de exigir que quem chama leia um campo pra
  // descobrir que a resposta nao vale.
  ok(/res\.status\(503\)/.test(blocoRota2),
     '  e responde 503 (nao 200 com resposta vazia)');
  ok(/casou: null|inconclusivo|ainda nao/i.test(blocoRota2),
     '  com o motivo legivel pra quem chama');
}

// ── ⚠️ e "nao esta" diz QUAL dos tres motivos ───────────────────────
//
// A resposta dizia só "não está em nenhuma das 3 listas". Mas isso pode ser:
//   (a) já foi BIPADA     → saiu de propósito, está CERTO
//   (b) a série divergiu  → bug de casamento
//   (c) nunca entrou      → bug de coleta, ou venda antiga
//
// (a) é o sistema funcionando. Sem distinguir, o próximo a investigar
// "conserta" um comportamento correto — risco real depois de um dia inteiro
// caçando esta estrela.
{
  ok(/ja_baixada: !casou && !!noCru/.test(blocoRota2),
     '⚠️ a resposta separa "ja foi bipada" de "nao esta"');
  // b281.1 (Codex, P1): o "cache CRU" nunca tinha baixada pra achar — o
  // filtro ja rodou dentro do `montarEspreita()` antes do cache ser
  // gravado. O conserto bate direto na tabela `devolucoes` (onde a
  // bipagem grava nf_numero/nf_serie), nao mais num concat das 3 listas.
  ok(/from\('devolucoes'\)/.test(blocoRota2) && /nf_numero/.test(blocoRota2),
     '  ⚠️ ja_baixada bate na fonte real da bipagem (tabela devolucoes), nao no cache ja filtrado');
  ok(!/const cru = \[\]/.test(blocoRota2),
     '  e nao mais no concat das 3 listas do cache (que nunca tem baixada)');
  ok(/Comportamento CORRETO, nao e bug/.test(blocoRota2),
     '  e diz por escrito que esse caso NAO e bug');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
