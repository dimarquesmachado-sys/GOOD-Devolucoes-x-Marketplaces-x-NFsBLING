'use strict';
// ⚠️ P1 DA AUDITORIA — PASSO 1 DE 3: A MEDIDA ANTES DA OBRA.
//
// A auditoria diz que `app-AMB.js` é um singleton preso à AMB, e que trocar
// a string para Girassol apenas **substituiria** a AMB em vez de montar as
// duas. Este teste mede isso de forma verificável, para que os passos 2 e 3
// tenham como provar que funcionaram.
//
// 📌 Por que a medida vem primeiro: refatorar 3.098 linhas sem um teste que
// diga "agora dá" é exatamente como se perde um dia inteiro. O que se mede
// aqui é o que vai ficar verde no fim.
//
// ⚠️ Este teste NÃO falha hoje — ele DOCUMENTA o estado atual. Os números
// que ele afirma são a linha de base; quando o passo 2 encapsular o estado,
// as asserções mudam junto e o diff mostra exatamente o que avançou.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');

// ── o que JÁ é fábrica (o avanço real que existe) ───────────────────
{
  const comCriar = (app.match(/\.criar\(CFG_EMPRESA\)/g) || []).length;
  ok(comCriar >= 5,
     `${comCriar} clientes ja aceitam config por instancia (bling, ml, mlReturns, nfNomes, db)`);
}

// ── ⚠️ e o que AINDA trava: a empresa cravada ───────────────────────
{
  const m = /const CFG_EMPRESA = configDaEmpresa\('(\w+)'\)/.exec(app);
  ok(!!m, 'a empresa vem de `configDaEmpresa`');
  ok(m && m[1] === 'ambtotal',
     `⚠️ mas CRAVADA em '${m ? m[1] : '?'}' — trocar a string SUBSTITUI a AMB, nao monta as duas`);
}

// ── ⚠️ e o estado no escopo do módulo ───────────────────────────────
//
// Cada `let`/`Map` no topo é compartilhado por TODAS as instâncias. Com duas
// empresas no mesmo processo, o cache de uma responderia pela outra — e isso
// não dá erro, dá **dado errado**, que é pior.
{
  const estado = app.split('\n')
    .filter((l) => /^let \w+|^const \w+ = new Map\(\)|^const \w+ = \[\]/.test(l))
    .map((l) => (/^(?:let|const) (\w+)/.exec(l) || [])[1])
    .filter(Boolean);

  ok(estado.length > 0,
     `⚠️ ha ${estado.length} variaveis de estado no escopo do modulo`);

  // as que guardam dado de negócio são as perigosas
  const deNegocio = estado.filter((n) => /CACHE|INDICE|PENDENTES|ESPREITA|NF_DEV/i.test(n));
  ok(deNegocio.length > 0,
     `  ⚠️ ${deNegocio.length} guardam DADO DE NEGOCIO: ${deNegocio.slice(0, 5).join(', ')}`);

  // 📌 LINHA DE BASE: quando o passo 2 encapsular, este número cai.
  // Se alguém encapsular e esquecer alguma, o teste mostra quantas faltam.
  ok(estado.length <= 11,
     `  📌 linha de base: ${estado.length} (o passo 2 deve derrubar isso)`);
}

// ── e o router sai pronto, não montável ─────────────────────────────
{
  ok(/module\.exports/.test(app), 'o modulo exporta algo');
  const exportaFabrica = /module\.exports\s*=\s*function|module\.exports\.criar/.test(app);
  ok(!exportaFabrica,
     '⚠️ e exporta um router PRONTO (nao uma fabrica) — o passo 3 muda isso');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
