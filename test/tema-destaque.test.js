'use strict';
// b797 (V-16) — A COR DE DESTAQUE EM CIMA DA COR DA MARCA (lib/tema-destaque.js).
//
// O "+" do "Lançar Defeito" era ambar fixo, escolhido em cima do roxo da AMB; no cabecalho amarelo da Girassol ele
// sumia (1,1:1, medido no navegador — test/triagem-topo-celular-navegador.test.js mede a tela de verdade). A regra sai
// do `tema.sobreMarca` que a ficha de cada empresa ja declara. Este teste roda a funcao de producao e, principalmente,
// confere TODA ficha que tem tema: empresa nova com cabecalho claro nao repete o erro sem alguem perceber.
// Roda com: node test/tema-destaque.test.js
const { destaqueSobreMarca, luminancia, contraste: contrasteDaLib, AMBAR, MINIMO } = require('../lib/tema-destaque');
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

// b801 (V-17, ensaio de CNPJ novo): texto claro NAO basta — o ambar tem que dar pra ler em cima do cabecalho
console.log('\n── 1b. com as cores do cabecalho: o ambar so vale se der pra LER em cima das duas');
ok(MINIMO === 3 && Math.abs(contrasteDaLib('#fff', '#000') - 21) < 1e-9 && contrasteDaLib('#000', '#fff') === contrasteDaLib('#fff', '#000') && contrasteDaLib('#abc', '#abc') === 1,
  '  o contraste e a conta do WCAG: preto e branco 21:1, nao importa a ordem, cor igual 1:1');
ok(contrasteDaLib('#fff', 'azul') === null && contrasteDaLib(undefined, '#fff') === null, '  cor que nao sei ler: contraste "nao sei" (null), nunca um numero inventado');
ok(destaqueSobreMarca('#ffffff', ['#561A9E', '#7B3FC4']) === AMBAR, '⚠️ AMB (roxo): ambar da ' + contrasteDaLib(AMBAR, '#7B3FC4').toFixed(1) + ':1 na ponta clara — continua ambar, nao muda um pixel');
ok(destaqueSobreMarca('#ffffff', ['#2f6fb3', '#5a92cc']) === 'var(--sobre-marca)',
  '⚠️ cabecalho MEDIO com texto branco (o tema padrao do gerador): o ambar daria ' + contrasteDaLib(AMBAR, '#5a92cc').toFixed(1) + ':1 na ponta clara — usa a cor do texto');
ok(destaqueSobreMarca('#ffffff', ['#5a92cc', '#2f6fb3']) === 'var(--sobre-marca)' && destaqueSobreMarca('#ffffff', ['#2f6fb3', '#2f6fb3']) === AMBAR,
  '  basta UMA das cores reprovar (em qualquer ordem); com as duas aprovando, e ambar');
{
  // a virada e exatamente no minimo: acho por busca o cinza em que o ambar cruza 3:1
  let escuro = 0, claro = 255;
  while (claro - escuro > 1) { const m = Math.floor((escuro + claro) / 2); const hex = '#' + m.toString(16).padStart(2, '0').repeat(3); if (contrasteDaLib(AMBAR, hex) >= MINIMO) escuro = m; else claro = m; }
  const passa = '#' + escuro.toString(16).padStart(2, '0').repeat(3), reprova = '#' + claro.toString(16).padStart(2, '0').repeat(3);
  ok(destaqueSobreMarca('#ffffff', [passa]) === AMBAR && destaqueSobreMarca('#ffffff', [reprova]) === 'var(--sobre-marca)',
    '  a virada e no minimo de ' + MINIMO + ':1 (' + passa + ' = ' + contrasteDaLib(AMBAR, passa).toFixed(2) + ':1 fica ambar; ' + reprova + ' = ' + contrasteDaLib(AMBAR, reprova).toFixed(2) + ':1 nao)');
}
ok(destaqueSobreMarca('#ffffff', ['#561A9E', 'roxo']) === 'var(--sobre-marca)' && destaqueSobreMarca('#ffffff', ['#561A9E', undefined]) === 'var(--sobre-marca)',
  '  cor do cabecalho que nao sei ler: NAO da o ambar no escuro');
ok(destaqueSobreMarca('#1e1a10', ['#561A9E', '#7B3FC4']) === 'var(--sobre-marca)', '  texto escuro continua mandando: nunca ambar, com qualquer cabecalho');
ok(destaqueSobreMarca('#ffffff', []) === AMBAR && destaqueSobreMarca('#ffffff', null) === AMBAR && destaqueSobreMarca('#ffffff', 'x') === AMBAR, '  sem as cores do cabecalho (lista vazia ou ausente), vale so a regra do texto claro, como antes');

console.log('\n── 2. toda ficha que tem tema: o destaque da pra ver em cima das DUAS cores do cabecalho dela');
const comTema = listarEmpresas().filter((e) => e && e.tema && e.tema.sobreMarca);
ok(comTema.length >= 2, '  ha fichas com tema pra conferir (' + comTema.map((e) => e.chave || e.prefixoRota).join(', ') + ')');
for (const e of comTema) {
  const d = destaqueSobreMarca(e.tema.sobreMarca, [e.tema.marca, e.tema.marcaClaro]);
  const cor = d === AMBAR ? AMBAR : e.tema.sobreMarca;
  const menor = Math.min(contraste(cor, e.tema.marca), contraste(cor, e.tema.marcaClaro));
  ok(luminancia(e.tema.marca) != null && luminancia(e.tema.marcaClaro) != null && luminancia(e.tema.sobreMarca) != null && menor >= 3,
    '⚠️ ' + (e.chave || e.prefixoRota) + ': destaque ' + cor + ' sobre ' + e.tema.marca + ' / ' + e.tema.marcaClaro + ' = ' + menor.toFixed(1) + ':1 (minimo 3:1)');
}
// o que acontecia antes: o ambar fixo, em cima do cabecalho da Girassol
const gira = comTema.find((e) => /girassol/i.test(String(e.chave || e.prefixoRota)));
ok(gira && contraste(AMBAR, gira.tema.marcaClaro) < 1.5, '  (a medida do defeito: o ambar fixo sobre o amarelo da Girassol da ' + (gira ? contraste(AMBAR, gira.tema.marcaClaro).toFixed(1) : '?') + ':1 — some)');

// b801 (V-17): o tema que o GERADOR escreve tem que passar na regra da casa — senao o PR da empresa nova nasce vermelho
console.log('\n── 3. o tema padrao do gerador de empresa (scripts/nova-empresa.js)');
{
  const g = require('../scripts/nova-empresa').gerar('temanovo', 'Empresa do Tema Novo');
  const cor = (k) => (String(g.ficha || '').match(new RegExp('\\b' + k + ": '(#[0-9a-fA-F]{3,6})'")) || [])[1];
  const t = { marca: cor('marca'), marcaClaro: cor('marcaClaro'), sobreMarca: cor('sobreMarca') };
  ok(g.ok && t.marca && t.marcaClaro && t.sobreMarca, '  a ficha gerada traz marca, marcaClaro e sobreMarca (' + JSON.stringify(t) + ')');
  const d = destaqueSobreMarca(t.sobreMarca, [t.marca, t.marcaClaro]);
  const corDoDestaque = d === AMBAR ? AMBAR : t.sobreMarca;
  const menorDestaque = Math.min(contraste(corDoDestaque, t.marca), contraste(corDoDestaque, t.marcaClaro));
  const menorTexto = Math.min(contraste(t.sobreMarca, t.marca), contraste(t.sobreMarca, t.marcaClaro));
  ok(menorDestaque >= 3, '⚠️ o destaque do tema gerado da pra ver: ' + corDoDestaque + ' = ' + menorDestaque.toFixed(1) + ':1 (minimo 3:1) — antes do b801 era o ambar, a ' + contraste(AMBAR, t.marcaClaro).toFixed(1) + ':1');
  ok(menorTexto >= 3, '⚠️ e o texto do cabecalho gerado tambem: ' + t.sobreMarca + ' = ' + menorTexto.toFixed(1) + ':1');
}

console.log(falhas === 0 ? '\n=== TODOS OS CASOS PASSARAM' : '\n=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
