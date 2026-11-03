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
const unificacoes = html.split("_x.marketplace === 'mercadolivre') _x.marketplace = 'ml'").length - 1;
confere('a unificacao mercadolivre->ml roda nas 2 cargas', unificacoes === 2);
confere("NOMES_MKT conhece o alias 'mercadolivre'", /NOMES_MKT = \{[^\n]*mercadolivre: 'Mercado Livre'/.test(html));
confere("CORES_MKT conhece o alias 'mercadolivre'", /CORES_MKT = \{[^\n]*mercadolivre: '#ffe600'/.test(html));
if (falhas) { console.error('painel-ml-rotulo-unico: ' + falhas + ' falha(s)'); process.exit(1); }
console.log('painel-ml-rotulo-unico: tudo certo');
