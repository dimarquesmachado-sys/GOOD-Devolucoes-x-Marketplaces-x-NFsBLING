require('./_fonte-painel');   // fatia 0 (docs/MODULARIZACAO.md): le o painel com os modulos js-AMB/painel-*.js embutidos
// b656 - A LISTA do painel (as 3 empresas usam o painel unico) mostrava o
// MESMO canal com dois rotulos: registros antigos gravados 'mercadolivre'
// saiam crus (badge cinza "mercadolivre", sem link de vendas, fora da aba
// "Mercado Livre"), e os novos 'ml' saiam certos. Este teste trava a
// unificacao na BORDA das DUAS cargas de /api/admin/devolucoes e o alias
// nos mapas de nome/cor.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
let falhas = 0;
function confere(nome, cond) {
  if (cond) { console.log('  ok -', nome); } else { falhas++; console.error('  FALHA -', nome); }
}
const cargas = html.split("'/api/admin/devolucoes'").length - 1;
confere('o painel tem as 2 cargas da lista', cargas === 2);
// POSICAO, nao so presenca (achado do Codex no proprio PR): a unificacao
// tem que ser a PRIMEIRA coisa apos o json de CADA carga — antes de
// qualquer `if (!d.ok)`/`if (r.status...)`. Dentro de um guard de erro ela
// nunca rodaria no caminho de sucesso.
const cargasRe = /fetch\(\(window\.APP_BASE \|\| ''\) \+ '\/api\/admin\/devolucoes'[^\n]*\);/g;
let posicionadas = 0, vistas = 0;
for (const m of html.matchAll(cargasRe)) {
  vistas++;
  const seg = html.slice(m.index + m[0].length, m.index + m[0].length + 3000);
  if (/const d = await r\.json\(\);[^\n]*\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*for \(const _v of Object\.values\(d \|\| \{\}\)\)/.test(seg)
      && /_x\.marketplace === 'mercadolivre'\) _x\.marketplace = 'ml'/.test(seg)) posicionadas++;
}
confere('a unificacao mercadolivre->ml e a 1a coisa apos o json, nas 2 cargas', vistas === 2 && posicionadas === 2);
confere("NOMES_MKT conhece o alias 'mercadolivre'", /NOMES_MKT = \{[^\n]*mercadolivre: 'Mercado Livre'/.test(html));
confere("CORES_MKT conhece o alias 'mercadolivre'", /CORES_MKT = \{[^\n]*mercadolivre: '#ffe600'/.test(html));
if (falhas) { console.error('painel-ml-rotulo-unico: ' + falhas + ' falha(s)'); process.exit(1); }
console.log('painel-ml-rotulo-unico: tudo certo');
