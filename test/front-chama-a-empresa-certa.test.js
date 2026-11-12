'use strict';
require('./_fonte-painel');   // fatia 0 (docs/MODULARIZACAO.md): le o painel com os modulos js-AMB/painel-*.js embutidos
require('./_fonte-fabrica');   // docs/MODULARIZACAO.md: le a fabrica (app-AMB.js) com os blocos de lib-AMB de volta no lugar
// ⚠️ O FRONT TEM QUE CHAMAR A API DA EMPRESA QUE ESTÁ LOGADA.
//
// O painel é COMPARTILHADO: a mesma tela serve a AMB e a Girassol, e a empresa
// vem da URL (`/amb/...` ou `/girassol/...`). Uma chamada escrita como
// `fetch('/api/...')` — sem a base — cai na RAIZ, que é a GOOD.
//
// 📌 Achado pelo Codex ao revisar a ativação da Girassol, e confirmado no boot
// real: `/api/ids-fiscais` na raiz responde (401, não 404) — ou seja, EXISTE.
// O painel da Girassol pediria os ids fiscais da GOOD.
//
// ⚠️ E ids fiscais decidem em que CNPJ a nota sai. Era nota fiscal da empresa
// errada, com a tela parecendo certa.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const DIR = path.join(RAIZ, 'amb-devolucoes', 'public-AMB');

// ── nenhuma chamada sem a base da empresa ───────────────────────────
{
  const varrer = (dir, acc = []) => {
    for (const nome of fs.readdirSync(dir)) {
      const cheio = path.join(dir, nome);
      if (fs.statSync(cheio).isDirectory()) varrer(cheio, acc);
      else if (/\.(html|js)$/.test(nome)) acc.push(cheio);
    }
    return acc;
  };

  const nus = [];
  for (const abs of varrer(DIR)) {
    const src = fs.readFileSync(abs, 'utf8');
    // ⚠️ tira comentário antes de medir — já me custou uma rodada hoje medir
    // caminho que estava em texto explicativo.
    const semCom = src.split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    // ⚠️ b439 (Codex, P2) - AS 3 FORMAS DE ASPA, nao 2.
    //
    // Minha varredura olhava `'` e `"` — e 26 chamadas usavam CRASE
    // (`fetch(\`/api/...\`)`). O teste dizia verde com 26 quebradas.
    //
    // 📌 O MESMO ERRO DE ONTEM, de novo: varredura que cobre quase todas as
    // formas dá a impressão de que está limpo, e é pior que não varrer.
    // Ontem foi "não cobre um arquivo"; hoje, "não cobre uma aspa".
    const achados = [...semCom.matchAll(/fetch\(\s*[`'"]\/api\//g)];
    if (achados.length) {
      nus.push(`${path.basename(abs)} (${achados.length})`);
    }
  }

  ok(nus.length === 0,
     '⚠️ nenhuma chamada `fetch(\'/api/...\')` SEM a base da empresa'
     + (nus.length ? ' (achei: ' + nus.join(', ') + ')' : ''));

  // b667 - OS JS COMPARTILHADOS TAMBEM. A fabrica serve `public/js/<nome>` da GOOD
  // pras instancias (JS_COMPARTILHADOS em app-AMB.js) e eles chamavam `/api/...`
  // nu: so funcionava porque o base-amb.js EMBRULHA o fetch e prefixa a base por
  // baixo. Agora a base e explicita em cada chamada (o embrulho segue como rede
  // de seguranca e nao dobra o prefixo: `/girassol/api/...` nao comeca com `/api/`).
  const appAmb = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  const mLista = appAmb.match(/const JS_COMPARTILHADOS = \[([\s\S]*?)\];/);
  const compartilhados = mLista ? [...mLista[1].matchAll(/'([^']+\.js)'/g)].map((m) => m[1]) : [];
  ok(compartilhados.length >= 10, '⚠️ a lista JS_COMPARTILHADOS existe no app-AMB (' + compartilhados.length + ' arquivos)');
  const nusGood = [];
  for (const nome of compartilhados) {
    const abs = path.join(RAIZ, 'public', 'js', nome);
    if (!fs.existsSync(abs)) continue;
    const semCom = fs.readFileSync(abs, 'utf8').split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    const achados = [...semCom.matchAll(/fetch\(\s*[`'\"]\/api\//g)];
    if (achados.length) nusGood.push(`${nome} (${achados.length})`);
  }
  ok(nusGood.length === 0,
     '⚠️ nenhum JS COMPARTILHADO (public/js) chama `fetch(\'/api/...\')` sem a base'
     + (nusGood.length ? ' (achei: ' + nusGood.join(', ') + ')' : ''));
}

// ── e a base existe pra ser usada ───────────────────────────────────
{
  const base = fs.readFileSync(path.join(DIR, 'js-AMB', 'base-amb.js'), 'utf8');
  ok(/window\.APP_BASE = BASE/.test(base),
     '  e `window.APP_BASE` é definido (a base que elas usam)');

  // ⚠️ o painel PRECISA carregar o base-amb.js, senão APP_BASE é undefined e
  // o fallback `|| ''` manda tudo pra raiz de novo — o bug de volta, calado.
  for (const painel of ['painel-AMB.html']) {
    const html = fs.readFileSync(path.join(DIR, painel), 'utf8');
    ok(/js-AMB\/base-amb\.js/.test(html),
       `⚠️ ${painel} CARREGA o base-amb.js (senao APP_BASE fica undefined)`);
  }
}

console.log('');
// ── b665: os IDS FISCAIS vao com a EMPRESA EXPLICITA ────────────────
//
// A rota da raiz (GOOD) exige `?empresa=` de proposito (b295: assumir "good" por
// omissao = nota na empresa errada). O painel unico chamava `/api/ids-fiscais`
// sem o parametro: 400 "informe a empresa", trava de emissao armada e nenhuma
// NF de devolucao saia na GOOD (caso real: NF 80932, 07/11). A empresa vem do
// APP_EMPRESA que cada empresa preenche no base-amb.js.
{
  const painel = fs.readFileSync(path.join(DIR, 'painel-AMB.html'), 'utf8');
  ok(/\/api\/ids-fiscais\?empresa=' \+ encodeURIComponent\(window\.APP_EMPRESA \|\| ''\)/.test(painel),
     '⚠️ o painel pede os ids fiscais com ?empresa=<APP_EMPRESA> (a raiz da GOOD exige)');
  ok(!/\/api\/ids-fiscais'\s*,\s*\{\s*credentials/.test(painel), '  e nao sobrou chamada sem a empresa');
  const { montarPainelUnicoGood } = require('../lib/painel-unico');
  const good = montarPainelUnicoGood(painel);
  ok(/ids-fiscais\?empresa=' \+ encodeURIComponent\(window\.APP_EMPRESA/.test(good), '  o painel montado pra GOOD leva a mesma chamada');
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(/erro: 'informe a empresa: \/api\/ids-fiscais\?empresa=good'/.test(srv) && /if \(alvo === 'good'\)/.test(srv),
     '  a raiz continua EXIGINDO a empresa (o conserto e no chamador, nao afrouxando o servidor)');
  const base = fs.readFileSync(path.join(DIR, 'js-AMB', 'base-amb.js'), 'utf8');
  ok(/window\.APP_EMPRESA = /.test(base), '  e APP_EMPRESA existe no base-amb (good na raiz; chaveDados nas instancias)');
}

console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
