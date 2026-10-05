'use strict';
// b537 — unificacao do painel (passo de teste): a GOOD serve o painel UNICO em /painel-novo.html, com nome, cores e
// empresa dela. Roda a montagem de producao (lib/painel-unico) no painel de verdade da AMB/Girassol.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
const { montarPainelUnicoGood } = require(path.join(R, 'lib', 'painel-unico'));
const h = montarPainelUnicoGood(fs.readFileSync(path.join(R, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8'));
ok(/<title>GOOD Import \(GIMPO\) - Painel de Devoluções<\/title>/.test(h), '⚠️ titulo da GOOD');
ok(/Painel de Devoluções — GOOD Import \(GIMPO\)<\/h1>/.test(h) && !/— AMBTotal<\/h1>/.test(h), '⚠️ cabecalho da GOOD (nao "AMBTotal")');
ok(/id="tema-empresa"/.test(h) && /--marca:#561A9E/.test(h), '  paleta roxa da GOOD');
ok(/src="\/js-AMB\/base-amb\.js\?v=good537"/.test(h), '⚠️ o arquivo de empresa vem da RAIZ da GOOD');
// b538 (Codex #442) — o painel unico nao pode perder o que o painel atual da GOOD tem.
ok(/<script src="\/js\/defeitos-ficha\.js\?v=\d+"><\/script>/.test(h) && /<script src="\/js\/lancar-defeito\.js\?v=\d+"><\/script>/.test(h)
  && /LancarDefeito\.instalar\(\{ prefixo: ''/.test(h) && !/js-AMB\/defeitos-ficha/.test(h), '⚠️ defeitos da GOOD + modal "Lancar defeito" (e nao o fork da AMB)');
ok(/<div class="header-acoes">\s*<a href="\/admin\/relatorios\.html"/.test(h), '⚠️ link dos Relatorios no cabecalho');
const { entreMarcadores } = require('./_recorte');
const T = fs.readFileSync(path.join(R, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
// aviso de NF existente: executa o codigo REAL do painel
const trecho = entreMarcadores(T, 'var _NF_DEV_TTL_MS', 'function moeda(v)');
const vm = require('vm');
const ctx = { window: {}, escapeHtml: x => String(x), encodeURIComponent, Date, String, Array };
vm.createContext(ctx);
vm.runInContext(trecho, ctx);
const aviso = vm.runInContext('_nfDevAvisoHtml', ctx);
const nota = { id: 77, nf: '123', data: '2026-10-02', contato: 'Maria Souza', skus: ['SKU1'] };
const card = (id, status) => ({ id, status, produto_sku: 'SKU1', buyer_nome: 'Maria Souza', nf_data_emissao: '2026-10-01' });
ctx.window._indiceNFDev = {}; ctx.window._indiceNFDevSemPedido = [nota];
const A = card(1, 'aprovado');
const P = card(2, 'problema');
ctx.window._cardsParaNfDev = [A]; ctx.window._nfDevAvisos = null;
ok(/já tem NF de devolução/.test(aviso(A)), '  nota unica casa com o card');
ctx.window._cardsParaNfDev = [A, P]; ctx.window._nfDevAvisos = null;
ok(aviso(A) === '' && aviso(P) === '', '⚠️ nota disputada por card de PROBLEMA tambem e ambigua (nao diz "ja resolvido")');
ctx.window._cardsParaNfDev = [P]; ctx.window._nfDevAvisos = null;
ok(/já tem NF de devolução/.test(aviso(P)), '⚠️ card de problema/divergente tambem recebe o aviso');
ctx.window._cardsParaNfDev = [A]; ctx.window._nfDevAvisos = null; ctx.window._nfDevFilaTruncada = true;
ok(aviso(A) === '', '  fila no teto de 1000: nao afirma unicidade');
ok((T.match(/_nfDevAvisoHtml\(d\)/g) || []).length >= 3, '⚠️ aprovado, problema e divergente chamam o aviso');
ok(/window\._nfDevAuto = setInterval/.test(T), '⚠️ painel parado revalida o indice de NFs sozinho');
// so-rascunho: o modal tem o 11o parametro e os cards o passam
ok(/serieNFOriginal, soRascunho\) \{/.test(T) && (T.match(/serieDoRegistro\(d\)\}', \$\{!!d\.so_rascunho\}\)"/g) || []).length === 3
  && /\(ehDivergente \|\| soRascunho\) \?/.test(T), '⚠️ card so_rascunho nao oferece Gerar + Emitir');
// itens da NF alem dos 40 primeiros
ok(/const haMais = caixas\.length === 40;/.test(T) && /if \(haMais && document\.querySelector\('\.itens-nf-auto:not\(\[data-feito\]\)'\)\) autoCarregarItens\(\);/.test(T), '⚠️ autoCarregarItens faz nova passada quando ha mais de 40 caixas');
const s = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
ok(/app\.get\('\/painel-novo\.html', requerAdmin,/.test(s), '⚠️ /painel-novo.html exige o login de admin');
ok(/\.replace\('"%%APP_EMPRESA%%"', JSON\.stringify\('good'\)\)/.test(s) && /\.replace\('"%%APP_BASE%%"', JSON\.stringify\(''\)\)/.test(s), '⚠️ o base-amb da GOOD diz empresa "good" e base na raiz (nada de cair na AMB)');
ok(/app\.get\('\/painel-devolucoes\.html', requerAdmin, \(req, res\) => \{\n  if \(PAINEL_UNICO_GOOD\)/.test(s) && /app\.get\('\/painel-antigo\.html', requerAdmin,/.test(s), '⚠️ b539: o endereco oficial entrega o painel unico; o antigo fica de reserva em /painel-antigo.html');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
