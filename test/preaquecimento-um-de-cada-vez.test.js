'use strict';
// ⚠️ O PRÉ-AQUECIMENTO SATUROU A COTA E ATRASOU A EMISSÃO DE NF.
//
// O dono emitiu 2 NFs juntas e levou 3 minutos. O log mostrou o serviço
// recém-reiniciado, com três varreduras competindo: o índice de devoluções do
// ML (195s), o de nomes (148s, 6.231 NFs) e o de notas de entrada.
//
// A intenção antiga ("1 minuto depois do outro pra não empilhar") não se
// cumpria: o atraso era fixo e a DURAÇÃO não. O ml-returns começava aos 180s
// e terminava aos 375s — o nf-nomes entrava em cima, aos 240s.

const fs = require('fs');
const path = require('path');
const { entreMarcadores } = require('./_recorte');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
const semCom = APP.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── a fila existe e espera de verdade ───────────────────────────────
{
  ok(/async function esperarTerminar/.test(semCom),
     '⚠️ existe a espera entre as rotinas');
  ok(/await esperarTerminar\('ml-returns'/.test(semCom)
     && /await esperarTerminar\('nf-nomes'/.test(semCom),
     '  e as pesadas esperam a anterior');
  ok(/PREAQ_TETO_MS/.test(semCom),
     '⚠️ com TETO — se uma travar, as seguintes rodam');
}

// ── ⚠️ e os módulos aceitam atraso 0 ────────────────────────────────
//
// Sem isso, o encadeamento não vale nada: cada um esperaria o próprio minuto
// e voltariam a se atropelar — parecendo consertado.
{
  for (const m of ['nf-entrada', 'magalu', 'ml-returns', 'nf-nomes']) {
    const src = fs.readFileSync(
      path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', `${m}-AMB.js`), 'utf8');
    ok(/function preAquecer\(atrasoMs/.test(src),
       `  ${m}: preAquecer aceita o atraso`);
    ok(/atrasoMs != null/.test(src),
       `  ⚠️ ${m}: usa \`!= null\` (com \`||\` o 0 viraria o padrao)`);
  }
}

// ── ⚠️ a fresta entre FALHAR e TENTAR DE NOVO ───────────────────────
//
// Quando a construção falha (429!), `construindo` vira false e só DEPOIS o
// `catch` agenda a próxima tentativa. Nessa fresta a fila achava que a rotina
// tinha terminado e soltava a seguinte — e 30s depois as duas rodavam juntas.
//
// 📌 Justo no cenário que a fila existe pra evitar.
{
  for (const m of ['nf-nomes', 'ml-returns']) {
    const src = fs.readFileSync(
      path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', `${m}-AMB.js`), 'utf8');
    // ⚠️ b416: NAO basta o texto existir — tem que estar na RETENTATIVA.
    //
    // No b415 marquei no `preAquecer` (o disparo inicial) e o teste passou,
    // porque so procurava o texto no arquivo. A retentativa usa
    // `drenagem.daquiA`, e a fresta continuou aberta.
    // mede por ORDEM, não por distância: o comentário que explica o erro é
    // longo, e uma janela fixa de caracteres não alcançaria.
    // ⚠️ tira os comentários ANTES de medir: o comentário que explica este
    // próprio erro menciona `drenagem.daquiA`, e a primeira ocorrência caía
    // no texto, não no código. Medir em cima de comentário mede ficção.
    const semCom2 = src.split('\n')
      .filter((l) => !l.trim().startsWith('//')).join('\n');
    const iRetry = semCom2.indexOf('drenagem.daquiA');
    const iMarca = semCom2.lastIndexOf('reagendado = true', iRetry);
    const iTentar = semCom2.indexOf('function tentar');
    ok(iRetry > 0 && iMarca > iTentar && iMarca < iRetry,
       `⚠️ ${m}: marca DENTRO de tentar(), antes da retentativa`);
    ok(/ocupado: construindo \|\| reagendado/.test(src),
       `  ${m}: e o status expoe os dois juntos`);
  }

  // ⚠️ o magalu NEM TINHA `construindo` — a espera lia undefined e voltava na
  // hora, deixando ele fora da fila enquanto a fila parecia completa.
  const mag = fs.readFileSync(
    path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'magalu-AMB.js'), 'utf8');
  ok(/ocupado: !!\(INDICES && \(INDICES\.agendado/.test(mag),
     '⚠️ magalu: `ocupado` cobre AGENDADO + rodando');

  // ⚠️ b418: e a varredura dos 5 módulos da fila achou o nf-entrada com o
  // mesmo buraco — sem apontamento nenhum. É o que eu devia ter feito nas 4
  // vezes anteriores, em vez de olhar só o módulo citado.
  const ent = fs.readFileSync(
    path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'nf-entrada-AMB.js'), 'utf8');
  ok(/ocupado: !!\(agendado \|\| EST\.construindo\)/.test(ent),
     '⚠️ nf-entrada tambem (achado varrendo, nao apontado)');

  // e os dois marcam ANTES do setTimeout
  for (const [nome, src] of [['magalu', mag], ['nf-entrada', ent]]) {
    const semC = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    // ⚠️ mede dentro do `preAquecer`, não no 1º setTimeout do arquivo —
    // há outros timers antes dele, e comparar com o primeiro media outra
    // coisa (foi o que quebrou este teste na primeira escrita).
    const iPre = semC.indexOf('function preAquecer');
    const iTimer = semC.indexOf('setTimeout', iPre);
    const iMarca = semC.indexOf('agendado = true', iPre);
    ok(iPre > 0 && iMarca > 0 && iMarca < iTimer,
       `  ${nome}: marca ANTES de agendar, dentro do preAquecer`);
  }

  ok(/st\.ocupado != null \? st\.ocupado : st\.construindo/.test(semCom),
     '  e a fila le `ocupado`, com `construindo` so de reserva');
}

// ── ⚠️ b419 (Codex, P2) - `agendado` era do MODULO, nao da EMPRESA ──
//
// `let agendado` vivia fora da fabrica `criar()`. Com duas empresas no
// mesmo processo (o bootstrap monta todas as ativas), o timer da empresa B
// zerava o flag da empresa A: `statusIndice()` da A dizia livre com o
// timer dela ainda por disparar. Prova executando DUAS instancias, nao lendo
// o texto — e' exatamente o cenario que o texto sozinho nao pega.
{
  const magaluAMB = require(
    path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'magalu-AMB.js'));
  process.env.ZTESTA_MAGALU_ACCESS_TOKEN = 'fake-a';
  process.env.ZTESTB_MAGALU_ACCESS_TOKEN = 'fake-b';
  const a = magaluAMB.criar({ PREFIXO_ENV: 'ZTESTA_', CHAVE_REGISTRO: 'ztesta' });
  const b = magaluAMB.criar({ PREFIXO_ENV: 'ZTESTB_', CHAVE_REGISTRO: 'ztestb' });

  ok(a.statusIndice().ocupado === false && b.statusIndice().ocupado === false,
     '  as duas comecam livres');

  // atraso bem longo: so importa o `agendado = true` imediato: o
  // setTimeout NAO pode disparar durante o teste (chamaria a API de
  // verdade). unref() garante que ele nao prende o processo.
  a.preAquecer(10 * 60 * 1000);
  ok(a.statusIndice().ocupado === true,
     '  A fica ocupada assim que agenda');
  ok(b.statusIndice().ocupado === false,
     '⚠️ B NAO pode ficar ocupada so porque A agendou (o vazamento do b419)');

  delete process.env.ZTESTA_MAGALU_ACCESS_TOKEN;
  delete process.env.ZTESTB_MAGALU_ACCESS_TOKEN;
}

// ── ⚠️ o OAuth no meio da espera não pode disparar duas vezes ───────
{
  // ⚠️ b417: os DOIS serviços com OAuth, não só o ML.
  //
  // Tratei o ml-returns no b415 e deixei o magalu de fora — mesmo bug, mesmo
  // arquivo, 20 linhas abaixo. Consertar um de dois é o padrão que já me
  // pegou hoje (a pasta do checkout, o prefixo fiscal): eu olho o caso que o
  // apontamento cita e não pergunto quem mais faz igual.
  // ⚠️ b420: e o callback do OAuth dispara com atraso CURTO.
  //
  // O do magalu chamava `preAquecer()` sem argumento — 3 minutos. Antes do
  // b418 isso não aparecia, porque `agendado` não contava como ocupado e a
  // fila passava direto. Ao fechar aquela fresta, eu criei esta espera: a
  // fila ficava 3 minutos parada esperando o magalu COMEÇAR.
  //
  // 📌 Conserto de um buraco que abre outro — vale conferir o efeito do
  // conserto, não só o buraco.
  ok(/magalu\.preAquecer\(5000\)/.test(semCom),
     '⚠️ o OAuth do magalu dispara com atraso curto (nao os 3 min padrao)');
  ok(/mlReturns\.preAquecer\(5000\)/.test(semCom),
     '  e o do ML tambem');

  for (const svc of ['ml', 'magalu']) {
    ok(new RegExp(`jaPreAquecidoPeloOAuth\\.${svc} = true`).test(semCom),
       `⚠️ o OAuth do ${svc} marca que ja disparou`);
    ok(new RegExp(`jaPreAquecidoPeloOAuth\\.${svc}\\)`).test(semCom),
       `  e a fila consulta antes de disparar o ${svc}`);
  }

  // e a declaração vem ANTES de quem usa — `const` não sobe (TDZ)
  const linhas = APP.split('\n');
  const iDecl = linhas.findIndex((l) => /const jaPreAquecidoPeloOAuth/.test(l));
  const iMarca = linhas.findIndex((l) => /jaPreAquecidoPeloOAuth\.ml = true/.test(l));
  ok(iDecl >= 0 && iMarca >= 0 && iDecl < iMarca,
     '⚠️ e e declarada ANTES do callback que a marca (TDZ)');
}

// ── ⚠️ o OAuth do magalu tinha que disparar RAPIDO, como o do ML ────
//
// b418 (Codex, apontamento no PR #361 ja merged): o callback marcava
// `jaPreAquecidoPeloOAuth.magalu` (b417 corrigiu isso), mas chamava
// `magalu.preAquecer()` SEM atraso — e o `preAquecer(atrasoMs)` do magalu
// usa o padrao de 3 MINUTOS pros tickets quando `atrasoMs` e `null`. A fila
// so olha `statusIndice().ocupado`, que so vira `true` quando a construcao
// COMECA. Com 3 minutos de atraso, a 1ª conferencia da fila (5s depois)
// achava `ocupado: false` e seguia pro Shopee — a mesma fresta que o b415
// fechou pro ML com `mlReturns.preAquecer(5000)`, so que o magalu ficou de
// fora (mesmo bug do b417, agora num ponto diferente do mesmo callback).
{
  const blocoMagalu = entreMarcadores(semCom,
    "if (reg.servico === 'magalu')",
    "res.status(400).json({ ok: false, erro: 'servico desconhecido no state' });");
  ok(/magalu\.preAquecer\(5000\)/.test(blocoMagalu),
     '⚠️ o callback do magalu dispara com o MESMO atraso curto do ML (5000ms)');
  ok(!/magalu\.preAquecer\(\);/.test(blocoMagalu),
     '  e nao sobrou a chamada sem atraso (3min por padrao)');
}

// ── os dois caminhos da espera, exercitados ─────────────────────────
{
  const TETO = 900;
  const esperar = async (status) => {
    const ate = Date.now() + TETO;
    while (Date.now() < ate) {
      await new Promise((r) => setTimeout(r, 100));
      let st; try { st = status(); } catch (e) { return 'sem-status'; }
      if (!st || !st.construindo) return 'terminou';
    }
    return 'teto';
  };

  return (async () => {
    let fim = Date.now() + 300;
    ok(await esperar(() => ({ construindo: Date.now() < fim })) === 'terminou',
       '  espera ate a rotina terminar');
    ok(await esperar(() => ({ construindo: true })) === 'teto',
       '⚠️ e desiste no teto (rotina travada nao prende a fila)');
    ok(await esperar(() => { throw new Error('sem status'); }) === 'sem-status',
       '  e segue se o status nem responder');

    console.log('');
    console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
    process.exit(falhas ? 1 : 0);
  })();
}
