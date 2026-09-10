// Roda com: node test/busca-nome-teto.test.js
//
// ⚠️ RECLAMAÇÃO REAL DO DONO (10/09): buscou "charles" e passou de 3
// minutos olhando a tela. *"não posso esperar infinito pra 1 simples
// busca"*.
//
// A CONTA, medida: teto de 80 páginas × 400ms de pausa = 32s só de espera,
// mais o tempo de resposta do Bling por página (no /health: 422ms típico,
// 1481ms no pior). Dá 66s no melhor caso e 150s no pior — e isso SEM
// nenhum 429. Com retry (2+4+6s por página) explode.
//
// A busca fria varria até 8.000 notas antes de responder qualquer coisa.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
// ⚠️ as DUAS empresas — a AMB tinha o mesmo `await` sem teto na linha 366,
// e conferir o outro lado antes de subir e regra da casa.
const MODULOS = [
  ['lib/nf-nomes.js', 'GOOD'],
  ['amb-devolucoes/lib-AMB/nf-nomes-AMB.js', 'AMB'],
];
const semComent = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const lerCodigo = (p) => semComent(fs.readFileSync(path.join(RAIZ, p), 'utf8'));
const codigo = lerCodigo('lib/nf-nomes.js');

// ── ⚠️ o teto de espera é do ESTOQUISTA, não do índice ──────────────
{
  ok(/Promise\.race\(/.test(codigo),
     'a busca fria NAO espera o indice inteiro (Promise.race com teto)');
  ok(/NF_NOMES_TETO_BUSCA_MS/.test(codigo),
     '  e o teto e ajustavel por env (sem deploy)');

  const m = /NF_NOMES_TETO_BUSCA_MS \|\| (\d+)/.exec(codigo);
  ok(!!m && Number(m[1]) <= 20000,
     '  ⚠️ e o padrao e curto (' + (m ? m[1] : '?') + 'ms) — ninguem espera olhando a tela');
}

// ── ⚠️ e o PARCIAL é publicado, senão o teto devolveria vazio ───────
//
// A publicação era atômica no fim: bom desenho, mas uma busca que espera
// 12s e desiste receberia um índice VAZIO. O teto sozinho não resolveria
// nada — é a dupla que funciona.
{
  ok(/pg % 10 === 0/.test(codigo),
     'o indice parcial e publicado durante a varredura');
  ok(/IDX\.parcialAte = pg/.test(codigo),
     '  marcado como parcial');

  // ⚠️ e `ts` NÃO é carimbado no parcial: o índice está usável mas não
  // completo, e a próxima busca deve continuar reconstruindo.
  const iParcial = codigo.indexOf('pg % 10 === 0');
  const bloco = codigo.slice(iParcial, iParcial + 400);
  ok(!/IDX\.ts = /.test(bloco),
     '  ⚠️ mas NAO carimba `ts` (senao pareceria completo e pararia de reconstruir)');
}

// ── e o estado do índice fica VISÍVEL ───────────────────────────────
//
// ⚠️ Não estava exposto em lugar nenhum — e é ele que decide se a busca
// responde na hora ou leva minutos. "A busca está lenta" não tinha como
// ser diagnosticado sem ler código.
{
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  ok(/indice_nomes: \(\(\) =>/.test(srv), 'o /health mostra o estado do indice');
  ok(/nfNomes\.statusIndice\(\)/.test(srv), '  usando o statusIndice que ja existia');
}

// ── ⚠️ P1: o parcial NAO substitui um indice completo ───────────────
//
// Minha 1a versao publicava sempre — e numa reconstrucao QUENTE isso
// trocava os mapas completos de 120 dias pelas primeiras paginas, com o
// `ts` antigo mantido. As buscas passariam a NAO ACHAR notas que hoje
// acham: eu pioraria o caso que funciona.
{
  ok(/const primeiraMontagem = !IDX\.ts/.test(codigo),
     '⚠️ o parcial so e publicado na PRIMEIRA montagem');
  ok(/primeiraMontagem && \(pg === 3/.test(codigo),
     '  e o 1o checkpoint e cedo (pagina 3, nao 10 — senao nao chega nos 12s)');
}

// ── ⚠️ P1: a construcao em andamento e REUSADA ──────────────────────
//
// Depois do timeout o `ts` fica zero de propósito, e isso fazia CADA busca
// seguinte começar OUTRA varredura de 80 páginas. O estoquista que não acha
// e busca de novo — comportamento natural — dobrava o tráfego do Bling.
{
  ok(/IDX\.emConstrucao/.test(codigo),
     '⚠️ a construcao em andamento e guardada e REUSADA');
  ok(/if \(!IDX\.emConstrucao\)/.test(codigo),
     '  quem chega no meio espera a mesma, nao abre a sua');
}

// ── ⚠️ P1: quem chama sabe que o indice esta parcial ────────────────
//
// Sem isto, "nao achei" (definitivo) e "ainda nao varri essa pagina"
// (temporario) chegam iguais na tela — e o estoquista desiste de uma
// devolucao que EXISTE.
{
  ok(/parcial_ate_pagina/.test(codigo), 'o statusIndice expoe o parcial');
  ok(/indiceParcial/.test(codigo), '  e a busca marca isso no retorno');
}

// ── ⚠️ P2: o build orfao vira cancelavel ────────────────────────────
//
// Ele nasce com `deFundo = false` (ninguem tinha indice pra servir), e isso
// esta certo ENQUANTO o estoquista espera. Depois do timeout ninguem espera
// mais — e sem reclassificar, um SIGTERM nao cancelaria a varredura orfa.
{
  ok(/IDX\.viroufundo = true/.test(codigo),
     '⚠️ apos o timeout, o build e reclassificado como de fundo');
  ok(/deFundo \|\| IDX\.viroufundo/.test(codigo),
     '  e as pausas consultam isso (senao a drenagem nao cancela)');
}

// ── ⚠️ e a AMB tem o mesmo teto ─────────────────────────────────────
{
  for (const [arq, nome] of MODULOS) {
    const c = lerCodigo(arq);
    ok(/Promise\.race\(/.test(c), nome + ': a busca fria tem teto de espera');
    ok(/pg === 3 \|\| pg % 10 === 0/.test(c), '  e publica o parcial durante a varredura');
    ok(/primeiraMontagem/.test(c), '  ⚠️ so na 1a montagem (nao substitui indice completo)');
    ok(/IDX\.emConstrucao/.test(c), '  e reusa a construcao em andamento');
    ok(/viroufundo/.test(c), '  e o build orfao vira cancelavel');
  }
}

// ── ⚠️ P2 (auditoria): o `chamarBling` tambem precisa saber que virou
// fundo, nao so o `pausar` ──────────────────────────────────────────
//
// A b268.1 corrigiu a CANCELABILIDADE (drenagem.pausar considera
// `viroufundo`) mas nao a PRIORIDADE: o build orfao continuava se
// anunciando como INTERATIVO pro portao de ritmo do Bling
// (`chamarBling(url, { fundo: deFundo })`), furando a fila de trafego
// real mesmo com ninguem mais esperando por ele.
{
  ok(/fundo: deFundo \|\| IDX\.viroufundo/.test(codigo),
     'GOOD: chamarBling tambem reclassifica a prioridade apos o timeout');
}

// ── ⚠️ P1 (auditoria): quem CONSOME a busca (server.js / app-AMB.js)
// tambem precisa saber que o indice esta parcial ────────────────────
//
// A b268.1 deixou `indiceParcial`/`parcial_ate_pagina` visiveis DENTRO
// do modulo (statusIndice/buscarPorNome), mas as rotas que de fato
// respondem ao estoquista (identificar da GOOD e da AMB) nunca liam
// esses campos -- um nome cuja NF esta numa pagina ainda nao lida
// continuava virando 404 comum, indistinguivel de 'nao existe'.
{
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  // b275: o campo agora cobre VAZIO tambem (`rN.montando`), nao so parcial
  ok(/indice_incompleto: !!\(rN\.montando \|\| rN\.indiceParcial\)/.test(srv),
     'GOOD: a rota repassa o indice_incompleto (vazio OU parcial)');
  ok(/indice_nomes_vazio/.test(srv),
     '  ⚠️ e distingue VAZIO de parcial (a espera e diferente)');
  ok(/notaIndiceParcial/.test(srv),
     '  e avisa o estoquista no texto do erro (nao so no JSON cru)');

  const amb = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/indice_incompleto: porNome\.parcial_ate_pagina/.test(amb),
     'AMB: a rota de identificar (triagem) repassa o indice_incompleto');

  const ambLib = lerCodigo('amb-devolucoes/lib-AMB/nf-nomes-AMB.js');
  ok(/generica: total > 50,[\s\S]{0,300}parcial_ate_pagina: IDX\.parcialAte/.test(ambLib),
     'AMB: o buscarPorNome() tambem marca o retorno como parcial (a GOOD porta indiceParcial pro retorno; a 1a rodada do porte pra AMB parou so no statusIndice)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
