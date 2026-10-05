'use strict';
// b542 — dono, 05/10, no celular: na triagem o "anexar etiqueta" saia da tela; no painel os blocos de emitir NF
// tinham tamanhos diferentes e precisava de zoom. Confere as regras nos arquivos UNICOS (valem pras 3 empresas).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
const ci = fs.readFileSync(path.join(R, 'public', 'js', 'colar-imagem.js'), 'utf8');
ok(/linha\.style\.flexWrap = 'wrap';\n\s+btn\.style\.maxWidth = '100%';\n\s+linha\.appendChild\(btn\);/.test(ci), '⚠️ triagem: a linha do anexar etiqueta quebra no celular (botao nao sai da tela)');
const h = fs.readFileSync(path.join(R, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
const media = h.slice(h.indexOf('@media (max-width: 600px) {'), h.indexOf('@media (max-width: 600px) {') + 2600);
ok(/html, body \{ max-width: 100%; overflow-x: hidden; \}/.test(media), '⚠️ painel: a pagina nunca fica mais larga que a tela (sem zoom)');
ok(/\.secoes \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(media) && /\.secao \{ overflow-x: auto; \}/.test(media), '  painel: blocos com a largura da tela; o que for mais largo rola dentro do bloco');
for (const [arq, re] of [['public/index.html', /js\/colar-imagem\.js\?v=4631/], ['amb-devolucoes/public-AMB/index-AMB.html', /js-AMB\/colar-imagem\.js\?v=b542/]]) {
  ok(re.test(fs.readFileSync(path.join(R, arq), 'utf8')), '  ' + arq + ': ?v= bumpado (celular pega o arquivo novo)');
}
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
