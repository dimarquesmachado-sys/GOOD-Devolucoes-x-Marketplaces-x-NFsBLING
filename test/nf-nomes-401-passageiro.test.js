'use strict';
// ⚠️ O ÍNDICE DE NOMES DA AMB MORRIA NUM 401 PASSAGEIRO.
//
// [stated 15/09] o dono buscou "Lyvia", levou 404, e a nota estava no Bling.
// O `/amb/nf/indice` mostrava `total_nfs: 0` e `erro: nfe pagina 1 HTTP 401`
// — e o token estava BOM (`/amb/bling/teste` respondeu na hora).
//
// ⚠️ E O MEU 1º CONSERTO FOI MEIO CONSERTO, do pior tipo: acrescentei 401 ao
// laço de retry, mas o `if` que ENVOLVE o laço só deixava passar 429. O
// código novo existia, parecia certo na revisão, e **não era alcançado**.
//
// 📌 Só um teste que EXERCITA o caminho pega isso. É o que falta aqui.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const src = fs.readFileSync(
  path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'), 'utf8');

// ── ⚠️ o PORTÃO aceita 401, não só o laço de dentro ─────────────────
{
  ok(/if \(!r\.ok && \(r\.status === 429 \|\| r\.status === 401\)\) \{/.test(src),
     '⚠️ o portao das NOTAS aceita 401 (era so 429 — o retry nunca rodava)');
  ok(/r\.status === 429 \|\| r\.status === 503 \|\| r\.status === 401/.test(src),
     '  e o das VENDAS tambem');
}

// ── a simulação: um 401 na 1ª página não pode matar o índice ────────
{
  // reproduz a lógica das duas camadas (portão + laço)
  const simular = (respostas, portaoAceita, lacoAceita) => {
    let i = 0;
    let r = respostas[i++];
    if (!r.ok && portaoAceita.includes(r.status)) {
      for (let t = 1; t <= 3 && !r.ok && lacoAceita.includes(r.status); t++) {
        r = respostas[i++] || r;
      }
    }
    return r.ok;
  };

  // o caso real: 401 passageiro, depois o Bling responde
  const caso = [{ ok: false, status: 401 }, { ok: true, status: 200 }];

  ok(simular(caso, [429], [429, 401]) === false,
     '⚠️ com o portao SO em 429: o 401 mata o indice (o bug)');
  ok(simular(caso, [429, 401], [429, 401]) === true,
     '  ⚠️ com o portao aceitando 401: recupera na 2a chamada');

  // e um 401 permanente ainda desiste, em vez de girar para sempre
  const permanente = [{ ok: false, status: 401 }, { ok: false, status: 401 },
                      { ok: false, status: 401 }, { ok: false, status: 401 }];
  ok(simular(permanente, [429, 401], [429, 401]) === false,
     '  e 401 PERMANENTE desiste (nao gira pra sempre)');
}

// ── e a busca avisa quando o índice está cego ───────────────────────
//
// ⚠️ "não há NF com esse nome" e "o índice nunca montou" chegavam IGUAIS na
// tela. O dono conclui que o pedido sumiu.
{
  ok(/indice_vazio: !IDX\.ts \|\| Object\.keys\(IDX\.mapa \|\| \{\}\)\.length === 0/.test(src),
     'a resposta diz se o indice esta vazio');
  ok(/erro_indice: IDX\.erro \|\| null/.test(src),
     '  e qual foi o erro');

  const ident = fs.readFileSync(
    path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8');
  ok(/rN\.candidatos\.length === 0 && rN\.indice_vazio/.test(ident),
     '⚠️ e a busca trata esse caso separado do "nao achei"');
  ok(/res\.status\(503\)/.test(ident),
     '  respondendo 503 (indisponivel), nao 404 (nao existe)');

  // ⚠️ e o código bipado chega nos recados — era `req.para`, que não existe
  // ⚠️ minha 1a regex (`req\.para\b`) pegava `req.params` tambem — falso
  // positivo. O `\b` casa entre `para` e `.`, nao so no fim da palavra.
  ok(!/req\.para\s*\|\|/.test(ident) && !/comRecados\([^)]*req\.para[^m]/.test(ident),
     '  ⚠️ e usa `req.params.codigo` (nao o `req.para` que eu inventei)');
  ok((ident.match(/comRecados\(resultado, req\.params\.codigo\)/g) || []).length >= 4,
     '  em TODOS os retornos, inclusive o 503 novo');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
