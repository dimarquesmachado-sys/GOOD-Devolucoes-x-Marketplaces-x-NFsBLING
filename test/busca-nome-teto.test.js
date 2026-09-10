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

// ── ⚠️ e a AMB tem o mesmo teto ─────────────────────────────────────
{
  for (const [arq, nome] of MODULOS) {
    const c = lerCodigo(arq);
    ok(/Promise\.race\(/.test(c), nome + ': a busca fria tem teto de espera');
    ok(/pg % 10 === 0/.test(c), '  e publica o parcial durante a varredura');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
