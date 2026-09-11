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
  const i = srv.indexOf("app.get('/api/espreita/casa-nf/:nf'");
  const bloco2 = srv.slice(i, i + 2200);
  ok(/if \(!ESP_CACHE \|\| !lista\.length\)/.test(bloco2),
     '⚠️ a consulta trata o cache VAZIO antes de responder');
  ok(/casou: null/.test(bloco2),
     '  e devolve `null` (nao sei), nao `false` (nao esta)');
  ok(/ainda nao montou/.test(bloco2),
     '  com o motivo certo pra quem le');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
