'use strict';
// ⚠️ OS CLIENTES DA AMB PRECISAM HONRAR O LEITOR DE TOKEN REMOTO.
//
// O refresh do Bling e do ML é de USO ÚNICO: quando dois serviços renovam a
// mesma conta, o segundo invalida o que o primeiro acabou de gravar. Já nos
// mordeu: o log do dono tinha `403 ... o do ML é de uso único`.
//
// 📌 O desenho eleito no contrato é UM dono (o Mover-Pedidos) e os outros
// LEEM. A GOOD já fazia; a AMB — que é o molde da Girassol — não.
//
// ⚠️ Sem isto, ativar a Girassol faria ela renovar por conta própria e
// queimar o token do dono. É o bloqueador da ativação.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const semComentario = (s) => s.split('\n')
  .filter((l) => !l.trim().startsWith('//')).join('\n');

// ── as 4 peças, nos 2 clientes ──────────────────────────────────────
for (const [nome, arq, eixo] of [
  ['bling', 'bling-AMB.js', 'bling'],
  ['ml', 'ml-AMB.js', 'ml'],
]) {
  const src = semComentario(
    fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', arq), 'utf8'));

  ok(/require\('\.\.\/\.\.\/lib\/token-leitor'\)/.test(src),
     `⚠️ ${nome}: usa o leitor de token`);

  // 1. a renovação local é recusada em `remoto`
  ok(new RegExp(`politicaDe\\(CHAVE_TOKEN, '${eixo}'\\)`).test(src),
     `  ${nome}: consulta a politica antes de renovar`);
  ok(/polRenov === 'remoto' \|\| polRenov === 'bloqueado'/.test(src),
     `⚠️ ${nome}: RECUSA a renovacao local em remoto/bloqueado`);
  ok(new RegExp(`registrarRecusa\\(CHAVE_TOKEN, '${eixo}'\\)`).test(src),
     `  ${nome}: e a recusa aparece no /health`);

  // 2. o token da chamada vem do leitor
  ok(new RegExp(`resolverToken\\(CHAVE_TOKEN, '${eixo}'\\)`).test(src),
     `⚠️ ${nome}: o token da chamada vem do leitor`);
  ok(/Bearer \$\{await tokenAgora\(\)\}/.test(src),
     `  ${nome}: e o header usa esse token (nao o local direto)`);
  ok(/e\.semToken = true/.test(src),
     `⚠️ ${nome}: em 'falhar' a chamada MORRE (nao cai no local escondido)`);

  // 3. o 401 invalida o cache
  ok(new RegExp(`invalidar\\(CHAVE_TOKEN, '${eixo}'\\)`).test(src),
     `⚠️ ${nome}: o 401 invalida o cache do leitor`);

  // 4. ⚠️ a chave é a CANÔNICA do contrato
  //
  // O leitor aceita qualquer string sem reclamar: `amb` em vez de `ambtotal`
  // daria `sombra` para sempre, calado — e só apareceria no dia em que a
  // Girassol renovasse por conta própria.
  ok(/CHAVE_TOKEN = \(cfg && cfg\.CHAVE_REGISTRO\)/.test(src),
     `⚠️ ${nome}: a chave e a CANONICA (CHAVE_REGISTRO), nao a curta`);
  ok(!new RegExp(`(politicaDe|resolverToken)\\('`).test(src),
     `  ${nome}: nenhuma chave de empresa cravada em literal`);
}

// ── ⚠️ e a AMB NÃO muda de comportamento ────────────────────────────
//
// O padrão é `sombra`: lê o dono e mede, mas usa o token local. Ligar isto
// não pode alterar nada para quem está no ar.
{
  const tl = require('../lib/token-leitor');
  ok(tl.politicaDe('ambtotal', 'bling') === 'sombra',
     '⚠️ a AMB continua em `sombra` — nada muda pra ela');
  ok(tl.politicaDe('ambtotal', 'ml') === 'sombra', '  nos 2 eixos');

  // e a política é por empresa: só quem receber a env vira remoto
  const antes = process.env.TOKEN_POLITICA_GIRASSOL_BLING;
  process.env.TOKEN_POLITICA_GIRASSOL_BLING = 'remoto';
  delete require.cache[require.resolve('../lib/token-leitor')];
  const tl2 = require('../lib/token-leitor');
  ok(tl2.politicaDe('girassol', 'bling') === 'remoto',
     '⚠️ e a Girassol vira `remoto` so com a env dela');
  ok(tl2.politicaDe('ambtotal', 'bling') === 'sombra',
     '  sem arrastar a AMB junto');
  if (antes === undefined) delete process.env.TOKEN_POLITICA_GIRASSOL_BLING;
  else process.env.TOKEN_POLITICA_GIRASSOL_BLING = antes;
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
