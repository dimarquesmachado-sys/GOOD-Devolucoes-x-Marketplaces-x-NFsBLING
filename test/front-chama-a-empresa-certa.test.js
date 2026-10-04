'use strict';
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
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
