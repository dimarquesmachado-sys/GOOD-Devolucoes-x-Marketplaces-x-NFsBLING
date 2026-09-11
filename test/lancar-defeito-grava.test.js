// Roda com: node test/lancar-defeito-grava.test.js
//
// ⚠️ CASO REAL (11/09): o dono preencheu o defeito, clicou em lançar e levou
// a mensagem crua do Postgres na cara:
//
//   Could not find the 'produto_ean' column of 'devolucoes' in the schema cache
//
// O insert gravava uma coluna que NÃO EXISTE na tabela. Acrescentada sem a
// migração correspondente, e o erro só aparece na hora de GRAVAR — depois de
// o dono preencher tudo.
//
// ⚠️ E a coluna era escrita e NUNCA LIDA: varri o repo e nenhum lugar
// consulta. O EAN já vai na resposta, que é o que a tela usa.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const semComent = srv.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── ⚠️ a coluna inexistente saiu do insert ──────────────────────────
{
  ok(!/produto_ean:/.test(semComent),
     '⚠️ `produto_ean` nao e mais gravado (a coluna nao existe na tabela)');
  ok(/ean: prod\.gtin \|\| prod\.ean/.test(semComent),
     '  mas o EAN continua na RESPOSTA (a tela usa pra etiqueta)');
}

// ── e as colunas que SOBRARAM no insert são as que a leitura conhece ─
//
// ⚠️ O insert e o select da listagem têm que falar da mesma tabela. Se o
// insert grava campo que o select nunca lê, ou é coluna fantasma (este bug)
// ou é dado morto.
{
  const iIns = semComent.indexOf("from('devolucoes').insert([{");
  const bloco = semComent.slice(iIns, semComent.indexOf('}])', iIns));
  const gravadas = [...bloco.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  ok(gravadas.length > 0, 'achei as colunas do insert (' + gravadas.length + ')');

  // o select da listagem de devoluções
  const mSel = /\.select\('id, created_at, tipo, status[^']*'\)/.exec(semComent);
  if (mSel) {
    const lidas = new Set(mSel[0].replace(/\.select\('|'\)/g, '').split(',').map((x) => x.trim()));
    const fantasmas = gravadas.filter((c) => !lidas.has(c));
    // ⚠️ nem toda coluna gravada precisa ser lida NESTE select — mas
    // `produto_ean` especificamente não existe em lugar nenhum
    ok(!fantasmas.includes('produto_ean'),
       '⚠️ e `produto_ean` nao esta entre as gravadas');
  }
}

// ── ⚠️ e a mensagem de fotos diz a verdade ──────────────────────────
//
// [stated] "apareceu a mensagem Subindo fotos (embora eu não tenha subido
// foto alguma)". Era texto fixo, antes de conferir se há arquivo.
{
  const mod = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'lancar-defeito.js'), 'utf8');
  ok(/var qtdFotos = /.test(mod),
     '⚠️ a mensagem confere QUANTAS fotos ha antes de falar');
  ok(/gravando o defeito\.\.\./.test(mod),
     '  e diz "gravando o defeito" quando nao ha foto nenhuma');
  ok(!/innerHTML = '<span style="color:#555;">subindo fotos\.\.\./.test(mod),
     '  (o texto fixo antigo saiu)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
