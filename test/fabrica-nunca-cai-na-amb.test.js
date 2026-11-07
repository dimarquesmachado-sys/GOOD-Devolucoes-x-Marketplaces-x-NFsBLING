'use strict';
// b661 — PECA DA FABRICA CRIADA SEM A EMPRESA NUNCA CAI NA AMB.
//
// ⚠️ O QUE ESTE TESTE PROTEGE: as pecas da fabrica recebem a empresa pela config
// (CHAVE_REGISTRO / EMPRESA / CHAVE_DADOS). Quando alguem as cria SEM ela, o fallback
// era 'ambtotal'/'amb' — token (leitor), renovacao preventiva, loja da Shopee, pasta
// do checkout e a propria montagem iam parar na AMB em silencio. A b379 chamou isso de
// "vazamento com cara de seguranca" e tirou 5 fallbacks; estes 13 tinham ficado.
// Agora o fallback e o marcador SEM_EMPRESA do registro: tudo falha VISIVEL e nada
// da AMB e tocado.
//
// Roda com: node test/fabrica-nunca-cai-na-amb.test.js

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const { SEM_EMPRESA } = require('../lib/empresas');

ok(SEM_EMPRESA === 'sem-empresa', '⚠️ o registro exporta o marcador SEM_EMPRESA');

// ── 1. comportamento, com as pecas de PRODUCAO ───────────────────────
{
  const tp = require('../lib/token-preventiva');
  const antes = tp.listar().filter((x) => x.empresa === 'ambtotal').length;
  require('../amb-devolucoes/lib-AMB/ml-AMB').criar({ ml: {} });
  require('../amb-devolucoes/lib-AMB/bling-AMB').criar({ bling: {} });
  require('../amb-devolucoes/lib-AMB/magalu-AMB').criar({ magalu: {} });
  const semEmpresa = tp.listar().filter((x) => x.empresa === SEM_EMPRESA).map((x) => x.integracao).sort();
  ok(semEmpresa.join(',') === 'bling,magalu,ml', `  ml/bling/magalu criadas sem empresa registram a preventiva em '${SEM_EMPRESA}' (${semEmpresa.join(',')})`);
  ok(tp.listar().filter((x) => x.empresa === 'ambtotal').length === antes, '  e NENHUMA em ambtotal');

  const shopee = require('../amb-devolucoes/lib-AMB/shopee-AMB').criar({ PREFIXO_ENV: 'XTESTE_' });
  ok(shopee.cfg && shopee.cfg.loja === SEM_EMPRESA, `  Shopee sem empresa: loja '${shopee.cfg && shopee.cfg.loja}' (invalida no proxy), nao 'amb'`);

  const app = require('../amb-devolucoes/app-AMB');
  const guardado = process.env.DEVOLUCOES_EMPRESA;
  process.env.DEVOLUCOES_EMPRESA = '';
  let erro = null;
  try { app.criar(); } catch (e) { erro = String(e.message || e); }
  if (guardado === undefined) delete process.env.DEVOLUCOES_EMPRESA; else process.env.DEVOLUCOES_EMPRESA = guardado;
  ok(erro && /empresa desconhecida: sem-empresa/.test(erro), `⚠️ a fabrica sem empresa (sem argumento e sem DEVOLUCOES_EMPRESA) RECUSA montar: "${erro}"`);
}

// ── 2. invariante de texto: nenhum fallback de identidade pra AMB ────
{
  const arquivos = ['amb-devolucoes/app-AMB.js', ...fs.readdirSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB'))
    .filter((f) => f.endsWith('.js')).map((f) => 'amb-devolucoes/lib-AMB/' + f)];
  const ruins = [];
  for (const a of arquivos) {
    const src = fs.readFileSync(path.join(RAIZ, a), 'utf8');
    const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    // identidade da empresa caindo na AMB: `|| 'ambtotal'` ou `|| 'amb'` (loja/pasta/chave)
    const m = codigo.match(/\|\|\s*'(ambtotal|amb)'/g);
    if (m) ruins.push(a + ' (' + m.length + ')');
  }
  ok(ruins.length === 0, '⚠️ nenhuma peca da fabrica cai em ambtotal/amb por fallback' + (ruins.length ? ' — achei: ' + ruins.join(', ') : ''));
  const app = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/empresaAlvo \|\| process\.env\.DEVOLUCOES_EMPRESA \|\| SEM_EMPRESA/.test(app), '  a fabrica: argumento > env > SEM_EMPRESA (nunca ambtotal)');
  for (const a of ['ml-AMB', 'bling-AMB', 'magalu-AMB', 'shopee-AMB', 'identificar-AMB']) {
    const src = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', a + '.js'), 'utf8');
    ok(/const \{ SEM_EMPRESA \} = require\('\.\.\/\.\.\/lib\/empresas'\)/.test(src), `  ${a} importa SEM_EMPRESA do registro (uma fonte so)`);
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
