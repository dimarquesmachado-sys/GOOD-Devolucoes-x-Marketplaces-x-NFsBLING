'use strict';
require('./_fonte-fabrica');   // docs/MODULARIZACAO.md: le a fabrica (app-AMB.js) com os blocos de lib-AMB de volta no lugar
// b678 — FATIA 0 da modularizacao do painel (docs/MODULARIZACAO.md): o chao.
//
// ⚠️ O QUE ESTE TESTE PROTEGE: o JS do painel unico vai sair do HTML para
// `js-AMB/painel-<tema>.js`. 52 testes procuram codigo no texto do painel; se um
// deles ler o arquivo cru depois de uma fatia, ou fica vermelho, ou — pior — verde
// por nao achar mais o que procurava. Aqui se garante que:
//   1. todo teste que le o painel carrega `./_fonte-painel` (que entrega o HTML com
//      os modulos embutidos no lugar das tags);
//   2. o compositor embute o modulo NO LUGAR da tag e nao toca em mais nada;
//   3. a GOOD serve os modulos por uma rota fechada (so `painel-*.js`);
//   4. a montagem do painel da GOOD preserva as tags dos modulos;
//   5. o verifica.js compila o JS do painel com os modulos embutidos.
//
// Roda com: node test/painel-fonte-unica.test.js

const fonte = require('./_fonte-painel');
const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

// ── 1. todo teste que le o painel usa o helper ──
const EU = path.basename(__filename);
const semHelper = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.js') && f !== '_fonte-painel.js' && f !== EU)
  .filter((f) => {
    const s = fs.readFileSync(path.join(__dirname, f), 'utf8');
    return /painel-AMB\.html/.test(s) && !/require\('\.\/_fonte-painel'\)/.test(s);
  });
ok(semHelper.length === 0, '⚠️ todo teste que le o painel-AMB.html carrega ./_fonte-painel' + (semHelper.length ? ' — faltam: ' + semHelper.join(', ') : ''));

// ── 2. o compositor ──
const HTML = [
  '<html><head><script src="js-AMB/base-amb.js?v=b1"></script></head><body>',
  '<script src="js-AMB/painel-bridge.js?v=b700"></script>',
  '<script src="js-AMB/painel-sem-versao.js"></script>',
  '<script src="js-AMB/painel-nao-existe.js?v=b1"></script>',
  '<script src="js-AMB/defeitos-ficha.js?v=b623"></script>',
  '<script>function principal() { return verificarBridge(); }</script>',
  '</body></html>',
].join('\n');
const MODULOS = { 'painel-bridge.js': 'function verificarBridge() { return 1; }', 'painel-sem-versao.js': 'var X = 2;' };
const composto = fonte.compor(HTML, (nome) => (nome in MODULOS ? MODULOS[nome] : null));
ok(/<script>\/\* modulo: js-AMB\/painel-bridge\.js \*\/\nfunction verificarBridge\(\) \{ return 1; \}\n<\/script>/.test(composto),
   '⚠️ a tag do modulo vira <script> com o conteudo, NO MESMO LUGAR');
ok(composto.indexOf('function verificarBridge') < composto.indexOf('function principal'), '  e a ordem do texto e a do carregamento (modulo antes do script principal)');
ok(/var X = 2;/.test(composto) && !/painel-sem-versao\.js"/.test(composto), '  tag sem ?v= tambem e embutida');
ok(/<script src="js-AMB\/painel-nao-existe\.js\?v=b1"><\/script>/.test(composto), '  modulo que nao existe: a tag FICA (o teste que depender dele acusa)');
ok(/<script src="js-AMB\/defeitos-ficha\.js\?v=b623"><\/script>/.test(composto) && /<script src="js-AMB\/base-amb\.js\?v=b1"><\/script>/.test(composto),
   '  script que nao e modulo do painel (base-amb, defeitos-ficha) nao e tocado');
for (const m of composto.matchAll(/<script>([\s\S]*?)<\/script>/g)) { try { new Function(m[1]); } catch (e) { ok(false, '  script embutido compila: ' + e.message); } }
ok(true, '  os scripts embutidos compilam (o que o passo 2 do verifica faz)');

// ── 2b. o leitor embrulhado ──
ok(fs.readFileSync(fonte.PAINEL, 'utf8') === fonte.fontePainel(), '⚠️ ler o painel pelo fs (qualquer formato de caminho) devolve a fonte composta');
ok(fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', '..', 'public-AMB', 'painel-AMB.html'), { encoding: 'utf8' }) === fonte.fontePainel(), '  inclusive com caminho nao normalizado e { encoding }');
ok(Buffer.isBuffer(fs.readFileSync(fonte.PAINEL)), '  leitura binaria (sem utf8) segue crua');
ok(ler('amb-devolucoes/public-AMB/index-AMB.html') === fs.__lerOriginalFontePainel.call(fs, path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'index-AMB.html'), 'utf8'), '  outro arquivo nao e tocado');
const mods = fonte.modulosDoPainel();
if (mods.length === 0) {
  ok(fonte.fontePainel() === fonte.fonteCrua(), '  hoje nao ha modulo externo: a fonte composta e IDENTICA ao arquivo (fatia 0 nao muda nada)');
} else {
  for (const m of mods) {
    ok(fs.existsSync(path.join(fonte.DIR_JS, m)), `  modulo referenciado existe em js-AMB: ${m}`);
    ok(fonte.fontePainel().includes('/* modulo: js-AMB/' + m + '#'), `  e esta embutido na fonte composta, no lugar de origem: ${m}`);
  }
}

// ── 2c. b682: a fonte composta REPRODUZ A ORDEM ORIGINAL — cada secao volta pro lugar de onde saiu ──
// (um recorte de teste entre dois marcos nao pode ficar maior porque um bloco mudou de lugar no texto)
{
  const HTML2 = [
    '<script src="js-AMB/painel-a.js?v=b1"></script>',
    '<script src="js-AMB/painel-solto.js?v=b1"></script>',
    '<script>',
    '    function antes() {}',
    '    // @painel-modulo js-AMB/painel-a.js#um',
    '    function meio() {}',
    '    // @painel-modulo js-AMB/painel-a.js#dois',
    '    // @painel-modulo js-AMB/painel-a.js#nao-existe',
    '    function depois() {}',
    '</script>',
  ].join('\n');
  const MODS = {
    'painel-a.js': '// cabecalho\n\n// @secao um\n    function bloco1() {}\n\n// @secao dois\n    function bloco2() {}\n',
    'painel-solto.js': 'function semMarca() {}',
  };
  const c = fonte.compor(HTML2, (n) => (n in MODS ? MODS[n] : null));
  const ordem = ['function antes', 'function bloco1', 'function meio', 'function bloco2', 'function depois'].map((t) => c.indexOf(t));
  ok(ordem.every((i) => i >= 0) && ordem.join(',') === ordem.slice().sort((a, b) => a - b).join(','),
     '⚠️ cada secao volta pro LUGAR da marca: a ordem do texto e a do painel antes das fatias');
  ok(!/<script src="js-AMB\/painel-a\.js/.test(c), '  a tag do modulo que voltou pro lugar some da fonte composta');
  ok(/@painel-modulo js-AMB\/painel-a\.js#nao-existe/.test(c), '  marca de secao que nao existe FICA (o teste que depender dela acusa)');
  ok(/<script>\/\* modulo: js-AMB\/painel-solto\.js \*\/\nfunction semMarca/.test(c), '  modulo com tag e SEM marca ainda e embutido no lugar da tag (nada some)');
  ok(fonte.secoesDoModulo(MODS['painel-a.js']).size === 2 && fonte.secoesDoModulo(MODS['painel-a.js']).get('um') === '    function bloco1() {}', '  secoesDoModulo separa pelo `// @secao` e tira o branco do fim');

  // o painel de verdade: toda secao de todo modulo tem UMA marca, toda marca resolve, nada sobra
  const cru = fonte.fonteCrua();
  const marcas = [...cru.matchAll(fonte.MARCA_MODULO)].map((m) => m[1] + '#' + m[2]);
  const secoesReais = [];
  for (const m of fonte.modulosDoPainel()) {
    const secs = fonte.secoesDoModulo(fs.__lerOriginalFontePainel.call(fs, path.join(fonte.DIR_JS, m), 'utf8'));
    ok(secs.size >= 1, `  ${m}: tem ${secs.size} secao(oes) marcada(s) com // @secao`);
    for (const nome of secs.keys()) secoesReais.push(m + '#' + nome);
  }
  ok(marcas.length === new Set(marcas).size && marcas.slice().sort().join('|') === secoesReais.slice().sort().join('|'),
     '⚠️ toda secao de todo modulo tem exatamente UMA marca no script principal, e toda marca aponta pra secao que existe (' + marcas.length + ')');
  const composta = fonte.fontePainel();
  ok(!/<script src="js-AMB\/painel-/.test(composta) && !/@painel-modulo/.test(composta), '  na fonte composta nao sobra tag de modulo nem marca');
  const mainCru = (cru.match(/\n  <script>\n([\s\S]*?)\n  <\/script>/) || [])[1] || '';
  ok([...mainCru.matchAll(fonte.MARCA_MODULO)].length === marcas.length, '  as marcas moram DENTRO do script principal (e la que o codigo estava)');
}

// ── 3. a GOOD serve os modulos por rota fechada ──
const srv = ler('server.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
ok(/app\.get\(\/\^\\\/js-AMB\\\/\(painel-\[a-z0-9-\]\+\\\.js\)\$\/,/.test(srv), '⚠️ GOOD: rota /js-AMB/painel-<nome>.js com nome FECHADO (letras, numeros, hifen)');
const rxRota = /^\/js-AMB\/(painel-[a-z0-9-]+\.js)$/;
ok(rxRota.test('/js-AMB/painel-bridge.js') && !rxRota.test('/js-AMB/painel-../server.js') && !rxRota.test('/js-AMB/outro.js') && !rxRota.test('/js-AMB/painel-x.js/..'),
   '  a expressao aceita so o nome do modulo — nada de caminho');
ok(/no-cache, must-revalidate/.test(srv.slice(srv.indexOf('painel-[a-z0-9-]'), srv.indexOf('painel-[a-z0-9-]') + 600)), '  servido sem cache');
const app = ler('amb-devolucoes/app-AMB.js');
ok(/router\.use\(express\.static\(path\.join\(__dirname, 'public-AMB'\)/.test(app), '  instancias: o estatico da fabrica serve public-AMB (js-AMB incluso)');

// ── 4. a montagem do painel da GOOD preserva as tags dos modulos ──
const { montarPainelUnicoGood } = require('../lib/painel-unico');
const good = montarPainelUnicoGood(HTML);
ok(/<script src="js-AMB\/painel-bridge\.js\?v=b700"><\/script>/.test(good), '⚠️ montarPainelUnicoGood nao mexe na tag do modulo (a GOOD pede /js-AMB/painel-bridge.js)');
ok(/src="\/js-AMB\/base-amb\.js\?v=good537"/.test(good), '  e segue trocando so o base-amb');

// ── 5. o verifica.js compila o painel com os modulos ──
ok(/require\('\.\/test\/_fonte-painel'\)/.test(ler('verifica.js')), '⚠️ verifica.js carrega o helper (o passo 2 compila o JS do painel com os modulos embutidos)');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
