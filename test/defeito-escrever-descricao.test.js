'use strict';
// b549 — dono, 05/10: no estoque de defeitos, peca sem descricao (ex.: #113) — escrever direto da lista.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
for (const arq of ['amb-devolucoes/public-AMB/js-AMB/defeitos-ficha.js', 'public/js/defeitos-ficha.js']) {
  const s = fs.readFileSync(path.join(R, arq), 'utf8');
  ok(/✏️ escrever a descrição<\/a>/.test(s) && /escreverLaudoDireto\(/.test(s), '⚠️ ' + arq + ': peca sem descricao tem o "escrever a descricao" na lista');
  ok(/window\.escreverLaudoDireto = async function \(id\) \{\n\s+try \{ await window\.abrirFichaDefeito\(id\); \} catch \(e\) \{ return; \}\n\s+if \(typeof window\.editarLaudo === 'function'\) window\.editarLaudo\(\);/.test(s), '  ' + arq + ': abre a ficha e ja abre a edicao da descricao (rota PUT /laudo que ja existia)');
}
for (const [arq, v] of [['amb-devolucoes/public-AMB/index-AMB.html', 'b549'], ['amb-devolucoes/public-AMB/painel-AMB.html', 'b549'], ['public/index.html', '4923'], ['public/painel-devolucoes.html', '4923'], ['lib/painel-unico.js', '4923']]) {
  ok(fs.readFileSync(path.join(R, arq), 'utf8').includes('defeitos-ficha.js?v=' + v), '  ' + arq + ': ?v= novo');
}
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
