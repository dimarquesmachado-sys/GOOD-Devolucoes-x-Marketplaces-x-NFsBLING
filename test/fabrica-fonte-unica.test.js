'use strict';
// b685 — MODULARIZACAO DA FABRICA (docs/MODULARIZACAO.md): o chao e a guarda.
//
// ⚠️ O QUE ESTE TESTE PROTEGE: a fabrica (amb-devolucoes/app-AMB.js) e UMA funcao de ~4.200 linhas
// (criarAppEmpresa). Bloco que sai dela vai pra `lib-AMB/<tema>-AMB.js` como `registrar(router, deps)`.
// Diferente do painel, aqui NAO e so mudar de arquivo: o bloco perde a closure. Os riscos, e o que
// cada parte deste teste trava:
//   1. 62 testes leem app-AMB.js como texto -> todos carregam ./_fonte-fabrica (bloco de volta no lugar);
//   2. marca, chamada e secao tem que casar um a um (senao a fonte composta mente);
//   3. dependencia que a fabrica esqueceu de passar -> estoura no BOOT (nao na 1a requisicao);
//   4. ⚠️ o pior: alguem edita o modulo e usa um nome da closure da fabrica (bling, CACHES, envAmb...)
//      que nao esta em DEPS -> ReferenceError SO quando aquela linha roda, em producao. Aqui todo nome
//      declarado no topo de criarAppEmpresa que aparecer solto no bloco tem que estar em DEPS.
//
// Roda com: node test/fabrica-fonte-unica.test.js

const fab = require('./_fonte-fabrica');
const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const lerCru = (p) => fs.__lerOriginalFontePainel.call(fs, p, 'utf8');

// ── 1. todo teste que le a fabrica usa o helper ──
const EU = path.basename(__filename);
const semHelper = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.js') && !['_fonte-fabrica.js', '_fonte-painel.js', EU].includes(f))
  .filter((f) => { const s = lerCru(path.join(__dirname, f)); return /app-AMB\.js/.test(s) && !/require\('\.\/_fonte-fabrica'\)/.test(s); });
ok(semHelper.length === 0, '⚠️ todo teste que le o app-AMB.js carrega ./_fonte-fabrica' + (semHelper.length ? ' — faltam: ' + semHelper.join(', ') : ''));

// ── 2. o compositor ──
{
  const SRC = ['const a = 1;', '// @fabrica-modulo lib-AMB/x-AMB.js#um', "require('./lib-AMB/x-AMB')(router, { a });   // @fabrica-chamada", '// @fabrica-modulo lib-AMB/x-AMB.js#nao-existe', 'const z = 9;', ''].join('\n');
  const MOD = ["'use strict';", 'module.exports = function r(router, deps) {', '  const { a } = deps;', '// @secao um', "router.get('/x', (q, s) => s.json(a));", '// @fim-secao', '};'].join('\n');
  const c = fab.comporFabrica(SRC, (arq) => (arq === 'lib-AMB/x-AMB.js' ? MOD : null));
  ok(/const a = 1;\nrouter\.get\('\/x', \(q, s\) => s\.json\(a\)\);\n/.test(c), '⚠️ o bloco volta pro LUGAR da marca, sem a casca do registrador (so o que esta entre @secao e @fim-secao)');
  ok(!/@fabrica-chamada/.test(c) && !/require\('\.\/lib-AMB\/x-AMB'\)/.test(c), '  a linha da chamada some da fonte composta');
  ok(/@fabrica-modulo lib-AMB\/x-AMB\.js#nao-existe/.test(c), '  marca de secao que nao existe FICA (o teste que depender dela acusa)');
  ok(fab.secoesDaFabrica(MOD).get('um') === "router.get('/x', (q, s) => s.json(a));", '  a secao nao leva a chave que fecha o registrador');
}

// ── 3. a fabrica de verdade: marca, chamada e secao casam ──
const cru = fab.fonteCruaFabrica();
const linhas = cru.split('\n');
const marcas = [...cru.matchAll(fab.MARCA_FABRICA)].map((m) => ({ arq: m[1], secao: m[2], linha: cru.slice(0, m.index).split('\n').length }));
const modulos = fab.modulosDaFabrica();
ok(modulos.length >= 1, 'a fabrica referencia ' + modulos.length + ' modulo(s): ' + modulos.join(', '));
const chaves = marcas.map((m) => m.arq + '#' + m.secao);
ok(chaves.length === new Set(chaves).size, '  nenhuma marca repetida');
const composta = fab.fonteFabrica();
ok(!/@fabrica-modulo|@fabrica-chamada/.test(composta), '⚠️ na fonte composta nao sobra marca nem chamada (todo bloco voltou pro lugar)');
ok(fs.readFileSync(fab.FABRICA, 'utf8') === composta, '  ler app-AMB.js pelo fs devolve a fonte composta');

// nomes declarados no TOPO de criarAppEmpresa (a closure) — pelo parser: prefixo compila = fronteira
function nomesDaClosure(src) {
  const L = src.split('\n');
  const i = L.findIndex((l) => l.startsWith('function criarAppEmpresa('));
  let j = L.findIndex((l) => l.startsWith('module.exports = {')); while (j > 0 && L[j] !== '}') j--;
  const S = L.slice(i + 1, j);
  const compila = (t) => { try { new Function(t); return true; } catch (e) { return !(e instanceof SyntaxError); } };
  const nomes = new Set(); let ini = 0;
  for (let k = 1; k <= S.length; k++) {
    const ant = S[k - 1].trim();
    if (!(ant === '' || ant.startsWith('//') || /[;})\]]$/.test(ant) || /\*\/$/.test(ant))) continue;
    if (!compila(S.slice(0, k).join('\n'))) continue;
    const trecho = S.slice(ini, k).join('\n').replace(/\/\*[\s\S]*?\*\//g, ''); ini = k;
    const p = trecho.split('\n').find((l) => !/^\s*(\/\/.*)?$/.test(l)) || '';
    let m = p.match(/^\s*(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/); if (m) { nomes.add(m[1]); continue; }
    // so vale a declaracao que ABRE a instrucao de topo (a 1a linha de codigo) — `const x` aninhada
    // dentro de um handler nao e nome da closure
    m = p.match(/^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)/); if (m) { nomes.add(m[1]); continue; }
    if (/^\s*(?:const|let|var)\s+[{[]/.test(p)) {
      m = trecho.slice(trecho.indexOf(p)).match(/^\s*(?:const|let|var)\s+[{[]([^=]*?)[}\]]\s*=/);
      if (m) for (const parte of m[1].split(',')) { const n = parte.split(':').pop().trim().replace(/\s*=.*$/, '').replace(/^\.\.\./, ''); if (/^[A-Za-z_$][\w$]*$/.test(n)) nomes.add(n); }
    }
  }
  return nomes;
}
const closure = nomesDaClosure(composta);
ok(closure.size > 100 && closure.has('router') && closure.has('db') && closure.has('bling') && closure.has('CHAVE_DADOS'), `  nomes de topo da closure da fabrica: ${closure.size} (router, db, bling, CHAVE_DADOS...)`);

const semCodigoMorto = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ')
  .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''")
  .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, (tpl) => (tpl.match(/\$\{[^}]*\}/g) || []).join(' '));

for (const arq of modulos) {
  const abs = path.join(fab.DIR_FABRICA, arq);
  ok(fs.existsSync(abs), `⚠️ ${arq}: o arquivo existe`);
  if (!fs.existsSync(abs)) continue;
  const js = lerCru(abs);
  const secoes = fab.secoesDaFabrica(js);
  const minhas = marcas.filter((m) => m.arq === arq);
  ok(secoes.size >= 1 && minhas.length === secoes.size && minhas.every((m) => secoes.has(m.secao)), `  ${arq}: ${secoes.size} secao(oes), cada uma com a sua marca em app-AMB.js`);
  ok(/^'use strict';/.test(js), `  ${arq}: modo estrito, como o corpo de criarAppEmpresa`);
  // a chamada: logo depois da marca, com as DEPS do modulo
  const reg = require(abs);
  const DEPS = reg.DEPS;
  ok(typeof reg === 'function' && Array.isArray(DEPS) && DEPS.length > 0, `  ${arq}: exporta o registrador e a lista DEPS (${(DEPS || []).length})`);
  for (const m of minhas) {
    const chamada = linhas[m.linha] || '';
    const esperado = "require('./" + arq.replace(/\.js$/, '') + "')(router, { " + DEPS.join(', ') + ' });';
    ok(chamada.startsWith(esperado) && /\/\/ @fabrica-chamada\s*$/.test(chamada), `⚠️ ${arq}#${m.secao}: a linha seguinte a marca chama o registrador com EXATAMENTE as DEPS do modulo`);
  }
  // 3b. dependencia esquecida estoura no BOOT
  const rotas = [];
  const routerFalso = new Proxy({}, { get: (t, k) => (...a) => { if (typeof a[0] === 'string') rotas.push(String(k).toUpperCase() + ' ' + a[0]); } });
  const tudo = {}; for (const d of DEPS) tudo[d] = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 'x' : tudo[d]), apply: () => tudo[d] });
  let estourou = null;
  const faltando = Object.assign({}, tudo); delete faltando[DEPS[DEPS.length - 1]];
  try { reg(routerFalso, faltando); } catch (e) { estourou = e.message; }
  ok(estourou && estourou.includes(DEPS[DEPS.length - 1]), `⚠️ ${arq}: dependencia que a fabrica nao passou estoura NO BOOT, dizendo qual (${estourou})`);
  let erroReg = null; rotas.length = 0;
  try { reg(routerFalso, tudo); } catch (e) { erroReg = e; }
  ok(!erroReg && rotas.length >= 1, `  ${arq}: com as DEPS completas registra ${rotas.length} rota(s): ${rotas.slice(0, 4).join(', ')}` + (erroReg ? ' — ' + erroReg.message : ''));

  // 4. nenhum nome da closure usado no bloco sem estar em DEPS
  const bloco = semCodigoMorto([...secoes.values()].join('\n'));
  // nomes que o PROPRIO bloco declara (sombra): const/let/var/function, parametro de catch, de funcao e de
  // arrow. E por NOME, nao por escopo: um nome declarado em qualquer ponto do bloco deixa de ser vigiado
  // nele inteiro — o preco de nao virar o detector generico cheio de `e`, `k`, `r` que ninguem le.
  const declaradosNoBloco = new Set([...bloco.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  for (const m of bloco.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) declaradosNoBloco.add(m[1]);
  for (const m of bloco.matchAll(/(?:\bfunction\b[^(]*|\basync\s*)?\(([^()]*)\)\s*(?:=>|\{)/g)) for (const parte of m[1].split(',')) { const n = parte.trim().replace(/\s*=.*$/, '').replace(/^\.\.\./, ''); if (/^[A-Za-z_$][\w$]*$/.test(n)) declaradosNoBloco.add(n); }
  for (const m of bloco.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*=>/g)) declaradosNoBloco.add(m[1]);
  for (const m of bloco.matchAll(/\b(?:const|let|var)\s+[{[]([^=]*?)[}\]]\s*=/g)) for (const parte of m[1].split(',')) { const n = parte.split(':').pop().trim().replace(/\s*=.*$/, '').replace(/^\.\.\./, ''); if (/^[A-Za-z_$][\w$]*$/.test(n)) declaradosNoBloco.add(n); }
  const permitidos = new Set(DEPS.concat(['router']));
  const vazou = [...closure].filter((n) => !permitidos.has(n) && !declaradosNoBloco.has(n) && new RegExp('(?<![.\\w$])' + n.replace(/\$/g, '\\$') + '(?![\\w$])(?!\\s*:)').test(bloco));
  ok(vazou.length === 0, `⚠️ ${arq}: nenhum nome da closure da fabrica e usado no bloco sem estar em DEPS` + (vazou.length ? ' — VAZOU: ' + vazou.join(', ') + ' (ponha em DEPS e na chamada, ou e ReferenceError em producao)' : ''));
  const sobra = DEPS.filter((d) => !new RegExp('(?<![.\\w$])' + d + '(?![\\w$])').test(bloco));
  ok(sobra.length === 0, `  ${arq}: toda DEP e usada no bloco` + (sobra.length ? ' — sobrando: ' + sobra.join(', ') : ''));
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
