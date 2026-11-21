'use strict';
// b797 (V-16) — A COR DE DESTAQUE EM CIMA DA COR DA MARCA (lib/tema-destaque.js).
//
// O "+" do "Lançar Defeito" era ambar fixo, escolhido em cima do roxo da AMB; no cabecalho amarelo da Girassol ele
// sumia (1,1:1, medido no navegador — test/triagem-topo-celular-navegador.test.js mede a tela de verdade). A regra sai
// do `tema.sobreMarca` que a ficha de cada empresa ja declara. Este teste roda a funcao de producao e, principalmente,
// confere TODA ficha que tem tema: empresa nova com cabecalho claro nao repete o erro sem alguem perceber.
// Roda com: node test/tema-destaque.test.js
const { destaqueSobreMarca, luminancia, AMBAR } = require('../lib/tema-destaque');
const { listarEmpresas } = require('../lib/empresas');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

console.log('── 1. a regra');
ok(AMBAR === '#FFD54F' && destaqueSobreMarca('#ffffff') === AMBAR && destaqueSobreMarca('#FFF') === AMBAR && destaqueSobreMarca('  #FFFFFF ') === AMBAR,
  '⚠️ texto CLARO sobre a marca (cabecalho escuro, a AMB): o ambar de sempre — a AMB nao muda um pixel');
ok(destaqueSobreMarca('#1e1a10') === 'var(--sobre-marca)' && destaqueSobreMarca('#000') === 'var(--sobre-marca)',
  '⚠️ texto ESCURO sobre a marca (cabecalho claro, a Girassol): o destaque e a propria cor do texto do cabecalho');
for (const [nome, v] of [['nome de cor', 'white'], ['rgb()', 'rgb(255, 255, 255)'], ['vazio', ''], ['ausente', undefined], ['nulo', null], ['objeto', {}], ['hex torto', '#12'], ['hex com letra de fora', '#ggg']]) {
  ok(destaqueSobreMarca(v) === 'var(--sobre-marca)', '  cor que nao sei ler (' + nome + '): NAO chuta o ambar — usa a cor do texto do cabecalho, a unica que a ficha garante legivel');
}
ok(destaqueSobreMarca('#bbbbbb') === 'var(--sobre-marca)' && destaqueSobreMarca('#c0c0c0') === AMBAR, '  a virada e na metade da luminancia (#bbb = ' + luminancia('#bbbbbb').toFixed(2) + ' fica com o texto; #c0c0c0 = ' + luminancia('#c0c0c0').toFixed(2) + ' ja e claro)');
ok(Math.abs(luminancia('#fff') - 1) < 1e-9 && luminancia('#000') === 0 && Math.abs(luminancia('#abc') - luminancia('#aabbcc')) < 1e-12, '  a luminancia: branco 1, preto 0, e #abc = #aabbcc');
ok(Math.abs(luminancia('#f00') - 0.2126) < 1e-9 && Math.abs(luminancia('#0f0') - 0.7152) < 1e-9 && Math.abs(luminancia('#00f') - 0.0722) < 1e-9, '  cada canal com o peso dele (vermelho 0,2126 · verde 0,7152 · azul 0,0722)');

console.log('\n── 2. toda ficha que tem tema: o destaque da pra ver em cima das DUAS cores do cabecalho dela');
const comTema = listarEmpresas().filter((e) => e && e.tema && e.tema.sobreMarca);
ok(comTema.length >= 2, '  ha fichas com tema pra conferir (' + comTema.map((e) => e.chave || e.prefixoRota).join(', ') + ')');
for (const e of comTema) {
  const d = destaqueSobreMarca(e.tema.sobreMarca);
  const cor = d === AMBAR ? AMBAR : e.tema.sobreMarca;
  const menor = Math.min(contraste(cor, e.tema.marca), contraste(cor, e.tema.marcaClaro));
  ok(luminancia(e.tema.marca) != null && luminancia(e.tema.marcaClaro) != null && luminancia(e.tema.sobreMarca) != null && menor >= 3,
    '⚠️ ' + (e.chave || e.prefixoRota) + ': destaque ' + cor + ' sobre ' + e.tema.marca + ' / ' + e.tema.marcaClaro + ' = ' + menor.toFixed(1) + ':1 (minimo 3:1)');
}
// o que acontecia antes: o ambar fixo, em cima do cabecalho da Girassol
const gira = comTema.find((e) => /girassol/i.test(String(e.chave || e.prefixoRota)));
ok(gira && contraste(AMBAR, gira.tema.marcaClaro) < 1.5, '  (a medida do defeito: o ambar fixo sobre o amarelo da Girassol da ' + (gira ? contraste(AMBAR, gira.tema.marcaClaro).toFixed(1) : '?') + ':1 — some)');

console.log(falhas === 0 ? '\n=== TODOS OS CASOS PASSARAM' : '\n=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
