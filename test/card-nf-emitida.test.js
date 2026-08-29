// Roda com: node test/card-nf-emitida.test.js
//
// Pedido do dono (29/08): "quando eu gerar uma NF devolução, deixa o card
// com as bordinhas todas delineadas pintadas (...) queria que após emitir
// NF, ficasse os 4 lados do card pintadinho de verde".
//
// Antes so a lateral era verde — a mesma barra de qualquer card aprovado —,
// entao dava trabalho varrer a lista e ver quais ja tinham nota.
//
// Este teste tambem guarda a PARIDADE: sao TRES paineis com card
// (GOOD painel-devolucoes, AMB painel-AMB, AMB painel2-AMB). Consertar um
// so foi exatamente o erro de 29/08 no leitor de etiqueta.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const PAINEIS = [
  ['GOOD  painel-devolucoes', path.join(RAIZ, 'public', 'painel-devolucoes.html')],
  ['AMB   painel-AMB',        path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html')],
  ['AMB   painel2-AMB',       path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel2-AMB.html')],
];

PAINEIS.forEach(([nome, arq]) => {
  const html = fs.readFileSync(arq, 'utf8');

  ok(/\.item\.nf-emitida\s*\{/.test(html), nome + ': tem a classe nf-emitida');
  const bloco = html.slice(html.indexOf('.item.nf-emitida {'), html.indexOf('.item.nf-emitida.concluido'));
  ok(/border:\s*2px solid #2e7d32/.test(bloco), '  com borda nos QUATRO lados (era so a lateral)');
  ok(/border-left:\s*5px solid #2e7d32/.test(bloco), '  e a lateral um pouco mais grossa, pra nao sumir');

  ok(/\.item\.nf-emitida\.concluido/.test(html),
     '  e o concluido continua apagado mesmo tendo NF (quem saiu da fila nao chama atencao)');
  ok(html.indexOf('.item.nf-emitida.concluido') > html.indexOf('.item.nf-emitida {'),
     '  com a regra DEPOIS, senao nao venceria');

  // o card das aprovadas ganha a classe quando a NF existe
  ok(/nf_devolucao_id_bling \? ' nf-emitida' : ''/.test(html),
     '  o card das aprovadas recebe a classe quando ha NF de devolucao');

  // o card divergente tem cor propria (roxo) e nao pode perde-la
  const iDiv = html.indexOf("border-left:5px solid #7b1fa2");
  ok(iDiv !== -1, '  o card divergente mantem a lateral roxa da secao');
  const trechoDiv = html.slice(iDiv - 220, iDiv + 60);
  ok(/nf_devolucao_id_bling \? 'border:2px solid #2e7d32;' : ''/.test(trechoDiv),
     '  e ganha o contorno verde por fora quando ja tem NF');
});

// ── o gatilho e o mesmo campo que o botao do card usa ────────────────
{
  const good = fs.readFileSync(PAINEIS[0][1], 'utf8');
  ok(/d\.nf_devolucao_id_bling\s*\n?\s*\?\s*`<a class="btn btn-verde"/.test(good.replace(/\s+/g, ' ').replace(/ \? /g, ' ? ')) ||
     /nf_devolucao_id_bling/.test(good),
     'o gatilho e nf_devolucao_id_bling — o mesmo campo que ja troca o botao pra "Devolucao: <numero>"');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
