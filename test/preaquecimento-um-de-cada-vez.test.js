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
  ok(/ocupado: !!\(INDICES/.test(mag),
     '⚠️ magalu: expoe `ocupado` (nunca teve `construindo`)');

  ok(/st\.ocupado != null \? st\.ocupado : st\.construindo/.test(semCom),
     '  e a fila le `ocupado`, com `construindo` so de reserva');
}

// ── ⚠️ o OAuth no meio da espera não pode disparar duas vezes ───────
{
  // ⚠️ b417: os DOIS serviços com OAuth, não só o ML.
  //
  // Tratei o ml-returns no b415 e deixei o magalu de fora — mesmo bug, mesmo
  // arquivo, 20 linhas abaixo. Consertar um de dois é o padrão que já me
  // pegou hoje (a pasta do checkout, o prefixo fiscal): eu olho o caso que o
  // apontamento cita e não pergunto quem mais faz igual.
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
