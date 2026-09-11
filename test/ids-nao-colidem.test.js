// Roda com: node test/ids-nao-colidem.test.js
//
// ⚠️ CASO REAL (11/09): o dono buscou `LV-ASH-4` no Estoque de Defeitos, no
// painel admin, e a caixa devolveu **45 peças de SKUs variados** — ignorando
// o termo digitado.
//
// A CAUSA: a caixa procura `#defBusca` para o SEU campo, e o modal injetado
// (`lancar-defeito.js`) trazia um `#defBusca` próprio. Com os dois na mesma
// página, `getElementById` devolve o PRIMEIRO — o do modal, vazio. E busca
// vazia devolve tudo.
//
// ⚠️ E isso só apareceu quando o modal virou módulo compartilhado: antes ele
// vivia inline no index, onde a ordem no DOM fazia dar certo por acaso.
// Sorte, não desenho.
//
// Este teste pega a CLASSE: peça injetada em página que já tem outra peça
// não pode repetir identificador.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// os ids que o módulo INJETA na página
const mod = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'lancar-defeito.js'), 'utf8');
const iH = mod.indexOf('var HTML_MODAL');
const html = mod.slice(iH, mod.indexOf('\n', iH));
const idsInjetados = new Set([...html.matchAll(/id=\\"([\w-]+)\\"/g)].map((m) => m[1]));
ok(idsInjetados.size > 0, 'achei os ids que o modal injeta (' + idsInjetados.size + ')');

// os ids que a OUTRA peça da mesma página procura
const caixa = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'defeitos-ficha.js'), 'utf8');
const idsCaixa = new Set([...caixa.matchAll(/getElementById\('([\w-]+)'\)/g)].map((m) => m[1]));
ok(idsCaixa.size > 0, 'e os que a caixa de Defeitos procura (' + idsCaixa.size + ')');

// ── ⚠️ e não podem colidir ──────────────────────────────────────────
{
  const colisoes = [...idsInjetados].filter((id) => idsCaixa.has(id));
  ok(colisoes.length === 0,
     '⚠️ nenhum id do modal colide com os da caixa'
     + (colisoes.length ? ' (COLIDEM: ' + colisoes.join(', ') + ')' : ''));
}

// ── e o index.html usa o MESMO nome que o módulo procura ────────────
//
// ⚠️ O index ainda tem o HTML do modal inline, mas as funções vêm do
// módulo. Se os nomes divergirem, a Triagem quebra — e ela é a tela do
// galpão.
{
  const idx = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8');
  if (idx.includes('id="modalDefeito"')) {
    const idsIdx = new Set([...idx.matchAll(/id="(def[\w-]+|lancDef[\w-]+)"/g)].map((m) => m[1]));
    const procurados = [...mod.matchAll(/getElementById\('(lancDef[\w-]+|def[\w-]+)'\)/g)]
      .map((m) => m[1]);
    const semPar = [...new Set(procurados)].filter((id) => !idsIdx.has(id));
    ok(semPar.length === 0,
       '⚠️ todo id que o modulo procura existe no HTML do index'
       + (semPar.length ? ' (FALTAM: ' + semPar.join(', ') + ')' : ''));
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
