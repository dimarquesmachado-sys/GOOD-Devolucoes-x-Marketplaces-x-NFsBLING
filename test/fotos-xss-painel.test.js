'use strict';
require('./_fonte-painel');   // fatia 0 (docs/MODULARIZACAO.md): le o painel com os modulos js-AMB/painel-*.js embutidos
// b706 — P1-01 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): FOTO NAO VIRA SCRIPT NO PAINEL.
//
// O painel (unico pras 3 empresas) montava `<img src="${url}" onclick="abrirFoto('${url}')">` e
// `onclick='baixarTodasFotos(${JSON.stringify(fotos)}, ...)'` — a URL da foto, que vem do banco, entrava CRUA
// em atributo HTML e em codigo JavaScript. E o servidor gravava qualquer string no array de fotos. Uma foto
// `x" onerror="..."` executava na sessao de quem abrisse o painel.
//
// Duas pontas, provadas aqui exercitando o codigo de producao:
//   1. servidor: `lib/fotos-referencia.js` — so passa URL publica do bucket de fotos deste Supabase; as 5 rotas
//      de escrita da GOOD e as 5 da fabrica recusam (400) qualquer outra coisa, nos 4 nomes que a tela usa
//   2. painel: `blocoFotosHtml` monta as fotos SEM onclick e com tudo escapado; o clique e por delegacao
//      (`data-foto`), entao a URL continua sendo DADO ao renderizar e ao clicar
//
// Roda com: node test/fotos-xss-painel.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// 1. SERVIDOR — a referencia de foto
// ─────────────────────────────────────────────────────────────────────────────
process.env.SUPABASE_URL = 'https://sldnteste.supabase.co';
const ref = require(path.join(RAIZ, 'lib', 'fotos-referencia.js'));

const BOA = 'https://sldnteste.supabase.co/storage/v1/object/public/fotos-problema/amb/diego/1763200000000-ab12cd34.jpg';
const BOA_GOOD = 'https://sldnteste.supabase.co/storage/v1/object/public/fotos-problema/diego/1763200000000-ab12cd34.jpeg';
ok(ref.ehReferenciaDeFoto(BOA) === true, 'URL publica do bucket (fabrica, prefixo amb/) passa');
ok(ref.ehReferenciaDeFoto(BOA_GOOD) === true, 'URL publica do bucket (GOOD, sem prefixo) passa');
ok(ref.ehReferenciaDeFoto('https://sldnteste.supabase.co/storage/v1/object/public/fotos-problema/amb/jo%C3%A3o/1.jpg') === true,
   '  nome de usuario percent-encoded passa (e o que o Storage devolve)');

const RUINS = {
  'atributo injetado': BOA + '" onerror="alert(1)',
  'fecha a string JS': BOA + "') ; alert(1) ; ('",
  'javascript:': 'javascript:alert(1)',
  'data:': 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'http sem TLS': BOA.replace('https://', 'http://'),
  'outro host': 'https://atacante.example/storage/v1/object/public/fotos-problema/a.jpg',
  'outro bucket': BOA.replace('fotos-problema', 'outro-bucket'),
  'fora do /public': BOA.replace('/object/public/', '/object/sign/'),
  'query string': BOA + '?x=1',
  'fragmento': BOA + '#x',
  'travessia': 'https://sldnteste.supabase.co/storage/v1/object/public/fotos-problema/../../x.jpg',
  'tag': '<img src=x onerror=alert(1)>',
  'nao e string': 12345,
  'vazia': '',
  'gigante': BOA + 'a'.repeat(2000),
};
for (const [nome, v] of Object.entries(RUINS)) ok(ref.ehReferenciaDeFoto(v) === false, `  recusa: ${nome}`);

// Codex #577 (P2): o nome do usuario e PASTA do upload; `getPublicUrl` nao codifica `+` nem `'`. A pasta sai saneada
// nas duas pontas, entao a URL que o upload devolve e sempre aceita pelo validador.
ok(ref.nomeDePastaSeguro('ana+estoque') === 'ana_estoque' && ref.nomeDePastaSeguro("d'avila") === 'd_avila' && ref.nomeDePastaSeguro('Diego.M@x-1') === 'Diego.M@x-1',
   'nomeDePastaSeguro: troca o que nao e caractere de URL por _ e preserva . @ - _');
ok(ref.nomeDePastaSeguro('') === 'usuario' && ref.nomeDePastaSeguro(null) === 'usuario' && ref.nomeDePastaSeguro('..') === '_', '  vazio/nulo vira "usuario"; ".." nao vira travessia');
ok(ref.ehReferenciaDeFoto('https://sldnteste.supabase.co/storage/v1/object/public/fotos-problema/amb/' + ref.nomeDePastaSeguro("ana+d'avila") + '/1763200000000-ab12cd34.jpg') === true,
   '  a URL de upload de um usuario com + e aspa passa no validador');
// b710 (P1-09): na fabrica a pasta antes do usuario e a DA EMPRESA, nao mais `amb/` fixo — ancora no trecho estavel
for (const [arq, trecho] of [['server.js', 'const filename = `${nomeDePastaSeguro(req.usuario)}/'], ['amb-devolucoes/lib-AMB/compat-AMB.js', '/${nomeDePastaSeguro(req.usuario)}/${Date.now()}']]) {
  ok(fs.readFileSync(path.join(RAIZ, arq), 'utf8').includes(trecho), `  ${arq}: o upload usa nomeDePastaSeguro(req.usuario)`);
}

// o middleware, com req/res simulados, nos 4 nomes que a tela usa e no envelope `dados`
function rodar(body) {
  const req = { body };
  let status = 200, json = null, passou = false;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; } };
  ref.exigirFotosValidas(req, res, () => { passou = true; });
  return { status, json, passou };
}
ok(rodar({ fotos: [BOA, BOA_GOOD] }).passou === true, 'middleware: lista boa segue');
ok(rodar({ fotos: [] }).passou === true && rodar({}).passou === true && rodar({ fotos: 'nao-lista' }).passou === true,
   '  sem fotos, lista vazia ou campo que nao e lista: segue (quem trata e a rota, como antes)');
for (const campo of ['fotos', 'fotos_parcial', 'problema_fotos', 'problemaFotos']) {
  const r = rodar({ [campo]: [BOA, RUINS['atributo injetado']] });
  ok(r.passou === false && r.status === 400 && r.json && r.json.ok === false && r.json.campo === campo && r.json.posicao === 1,
     `  ⚠️ \`${campo}\` com uma referencia ruim: 400 e diz o campo e a posicao (${r.status})`);
}
{
  const r = rodar({ dados: { fotos_parcial: [RUINS['javascript:']] } });
  ok(r.passou === false && r.status === 400, '  ⚠️ dentro do envelope `dados` (formato da tela) tambem recusa');
  const txt = JSON.stringify(r.json);
  ok(!/javascript:/.test(txt), '  e a resposta NAO devolve o payload (nao vira reflexo)');
}

// as 10 rotas de escrita (5 da GOOD, 5 da fabrica) passam pelo middleware — provado no fonte, com marcador exclusivo
const SRV = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const COMPAT = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js'), 'utf8');
for (const rota of ['/api/triagem/aprovar', '/api/triagem/problema', '/api/triagem/divergente', '/api/triagem/consertado', '/api/defeitos/adicionar']) {
  const g = SRV.indexOf(`app.post('${rota}', `);
  const a = COMPAT.indexOf(`router.post('${rota}', `);
  ok(g >= 0 && /^app\.post\('[^']+', requerEstoquista, exigirFotosValidas, /.test(SRV.slice(g, SRV.indexOf('\n', g))),
     `GOOD ${rota}: requerEstoquista → exigirFotosValidas → rota`);
  ok(a >= 0 && /^router\.post\('[^']+', auth\.requerLogin, exigirFotosValidas, /.test(COMPAT.slice(a, COMPAT.indexOf('\n', a))),
     `fabrica ${rota}: requerLogin → exigirFotosValidas → rota (vale AMB e Girassol)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PAINEL — a foto renderizada continua dado
// ─────────────────────────────────────────────────────────────────────────────
const HTML = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
function fonte(html, nome) {
  const i = html.search(new RegExp('function ' + nome + '\\s*\\('));
  if (i < 0) return '';
  let j = html.indexOf('{', i), prof = 0, k = j;
  for (; k < html.length; k++) { if (html[k] === '{') prof++; else if (html[k] === '}') { prof--; if (prof === 0) break; } }
  return html.slice(i, k + 1);
}
const ctx = { window: { APP_BASE: '/girassol' }, encodeURIComponent, String, Array, JSON };
vm.createContext(ctx);
for (const f of ['escapeHtml', 'srcFoto', 'blocoFotosHtml']) {
  const src = fonte(HTML, f);
  ok(src.length > 0, `painel tem function ${f}`);
  if (src) vm.runInContext(src, ctx);
}
if (typeof ctx.blocoFotosHtml === 'function') {
  const payloads = [RUINS['atributo injetado'], RUINS['fecha a string JS'], RUINS['tag']];
  const html = ctx.blocoFotosHtml([BOA, ...payloads], 'NF 123" onclick="alert(1)');
  // os ATRIBUTOS de verdade: tira os valores (="...") e olha o que sobrou — e la que um on*= executaria
  const soAtributos = html.replace(/="[^"]*"/g, '=""');
  ok(!/\son\w+=/i.test(soAtributos), '⚠️ o bloco de fotos NAO tem nenhum atributo on*= (nem onclick, nem onerror)');
  ok(!/alert|onerror|<img src=x/.test(soAtributos), '  o payload nao abriu atributo nem tag nova: fora dos valores escapados ele nao existe');
  const srcs = [...html.matchAll(/<img src="([^"]*)"/g)].map((m) => m[1]);
  ok(srcs.length === 4 && srcs.every((v) => v === '' || (/^\/girassol\/api\/admin\/foto\//.test(v) && !/["'<>\s]|javascript:/i.test(v))),
     '  todo src e vazio ou a rota /api/admin/foto/ da empresa, sem aspas/espaco/tag (' + srcs.filter((v) => v === '').length + ' vazio(s))');
  ok(/data-foto="[^"]*&quot; onerror=&quot;alert\(1\)"/.test(html) && !/data-foto="[^"]*" onerror="/.test(html),
     '  o payload aparece SO como entidade dentro do data-foto (dado), nunca como atributo');
  ok((html.match(/<img/g) || []).length === 4 && (html.match(/data-foto="/g) || []).length === 4,
     '  4 fotos → 4 <img> com data-foto (a URL vai como DADO, lida por dataset no clique)');
  ok(/class="btn btn-baixar-fotos"/.test(html) && /data-ident="NF 123&quot; onclick=&quot;alert\(1\)"/.test(html),
     '  o botao "Baixar todas" leva o identificador escapado em data-ident, sem onclick');
  ok(/Baixar todas/.test(html) && /\(4\)/.test(html), '  e continua dizendo quantas sao');
  ok(ctx.srcFoto(RUINS['javascript:']) === '' && ctx.srcFoto(RUINS['tag']) === '' && ctx.srcFoto('') === '' && ctx.srcFoto(RUINS['http sem TLS']) === '',
     '⚠️ srcFoto: o que nao tem a forma https://…/fotos-problema/… vira src VAZIO (antes devolvia a string crua; o host quem confere e o servidor — P1-09)');
  ok(ctx.srcFoto(BOA) === '/girassol/api/admin/foto/amb/diego/1763200000000-ab12cd34.jpg', '  srcFoto da foto boa segue pelo proxy da empresa');
  // Codex #577 (P2): bucket configurado por *_FOTOS_BUCKET nao passa pelo proxy (que le so o fotos-problema) — vai direto, como antes
  const OUTRO = 'https://sldnteste.supabase.co/storage/v1/object/public/fotos-amb/amb/diego/1.jpg';
  ok(ctx.srcFoto(OUTRO) === OUTRO, '  bucket configurado (outro nome): a URL publica vai como esta, nao vira vazio');
  ok(ctx.srcFoto(OUTRO + '" onerror="x') === '' && ctx.srcFoto("https://s.supabase.co/storage/v1/object/public/b/a'b.jpg") === '',
     '  mas com aspa, espaco ou tag no meio continua vazio');
}
// os 3 renderizadores usam o bloco; o padrao antigo sumiu do painel inteiro
for (const r of ['itemHtmlAprovado', 'itemHtmlProblema', 'itemHtmlDivergente']) {
  ok(/blocoFotosHtml\(/.test(fonte(HTML, r)), `${r} monta as fotos pelo blocoFotosHtml`);
}
ok(!/onclick="abrirFoto\(/.test(HTML) && !/onclick='baixarTodasFotos\(/.test(HTML), '⚠️ nenhum onclick="abrirFoto(…)" nem onclick=\'baixarTodasFotos(…)\' sobrou no painel');
ok(/closest\('\.fotos-mini img\[data-foto\]'\)/.test(HTML) && /closest\('\.btn-baixar-fotos'\)/.test(HTML),
   '  o clique e por delegacao (addEventListener), lendo data-foto/data-ident');

// ─────────────────────────────────────────────────────────────────────────────
// 3. FICHA DE DEFEITOS (abre dentro do painel, nas 3) — mesma causa, mesmo conserto
// ─────────────────────────────────────────────────────────────────────────────
// A miniatura saia com onclick chamando verFotoDefeito('<url passada pelo esc()>'): o esc() troca ' por &#39;, mas o
// parser HTML DESFAZ isso antes de entregar ao JS — a aspa volta e fecha a string. E a foto grande abria com
// window.open(this.src), que executa `javascript:`.
const FICHA = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'js-AMB', 'defeitos-ficha.js'), 'utf8');
ok(!/onclick="[^"]*verFotoDefeito\(/.test(FICHA) && !/onclick="window\.open\(this\.src/.test(FICHA),
   '⚠️ ficha de defeitos: nenhuma miniatura com onclick montado como texto (verFotoDefeito / window.open(this.src))');
ok((FICHA.match(/data-foto-defeito="' \+ esc\(/g) || []).length === 2 && /closest\('img\[data-foto-defeito\]'\)/.test(FICHA),
   '  as 2 galerias levam a URL em data-foto-defeito (escapada) e o clique e por delegacao');
ok(/if \(\/\^https:\\\/\\\/\/\.test\(String\(url \|\| ''\)\)\) window\.open\(url, '_blank', 'noopener'\);/.test(FICHA),
   '  verFotoDefeito so abre https (nao executa javascript: gravado no banco)');
{
  // srcSeguro, executado: com srcFoto do painel vai pelo proxy; sem, so https
  function fonteVar(nome) { const i = FICHA.search(new RegExp('function ' + nome + '\\s*\\(')); let j = FICHA.indexOf('{', i), p = 0, k = j; for (; k < FICHA.length; k++) { if (FICHA[k] === '{') p++; else if (FICHA[k] === '}') { p--; if (p === 0) break; } } return FICHA.slice(i, k + 1); }
  const c1 = { window: {}, String }; vm.createContext(c1); vm.runInContext(fonteVar('srcSeguro'), c1);
  ok(c1.srcSeguro('javascript:alert(1)') === '' && c1.srcSeguro(BOA) === BOA, '  srcSeguro fora do painel: https passa, javascript: vira vazio');
  const c2 = { window: { srcFoto: (u) => '/proxy/' + u.length }, String }; vm.createContext(c2); vm.runInContext(fonteVar('srcSeguro'), c2);
  ok(c2.srcSeguro(BOA) === '/proxy/' + BOA.length, '  srcSeguro dentro do painel: delega ao srcFoto da empresa');
}
for (const arq of ['amb-devolucoes/public-AMB/index-AMB.html', 'amb-devolucoes/public-AMB/painel-AMB.html', 'public/index.html', 'lib/painel-unico.js']) {
  const t = arq.endsWith('painel-AMB.html') ? require('./_fonte-painel').fonteCrua() : fs.readFileSync(path.join(RAIZ, arq), 'utf8');
  ok(/defeitos-ficha\.js\?v=b(70[6-9]|7[1-9]\d|[89]\d\d)/.test(t), `  ${arq}: ?v= da ficha subiu (celular recarrega o JS)`);
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
