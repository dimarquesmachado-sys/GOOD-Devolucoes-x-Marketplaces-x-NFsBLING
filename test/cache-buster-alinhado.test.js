// Roda com: node test/cache-buster-alinhado.test.js
//
// ⚠️ ARMADILHA MEDIDA (11/09): `js/defeitos-ficha.js` é carregado por DUAS
// telas — `index.html` (triagem) e `painel-devolucoes.html` (admin). Eu
// bumpei o `?v=` só no index a cada conserto, e o painel ficou em `?v=4901`
// enquanto a triagem já pedia `?v=4905`.
//
// Efeito: quem abre o painel recebe o arquivo VELHO do cache — sem nenhum
// dos consertos. E o sintoma é o pior possível: "consertei e continua
// igual", com o código certo no ar.
//
// Este teste pega a classe: arquivo compartilhado tem que pedir a MESMA
// versão em todas as telas que o carregam.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const PUB = path.join(__dirname, '..', 'public');
const TELAS = fs.readdirSync(PUB).filter((f) => f.endsWith('.html'));

// mapeia: arquivo js -> { tela: versao }
const versoes = {};
for (const tela of TELAS) {
  const s = fs.readFileSync(path.join(PUB, tela), 'utf8');
  for (const m of s.matchAll(/(js\/[\w-]+\.js)\?v=(\d+)/g)) {
    versoes[m[1]] = versoes[m[1]] || {};
    versoes[m[1]][tela] = Number(m[2]);
  }
}

const compartilhados = Object.entries(versoes).filter(([, t]) => Object.keys(t).length > 1);
ok(compartilhados.length > 0,
   'ha arquivo js carregado por mais de uma tela (' + compartilhados.length + ')');

for (const [js, porTela] of compartilhados) {
  const nums = [...new Set(Object.values(porTela))];
  ok(nums.length === 1,
     '⚠️ ' + js + ' pede a MESMA versao em todas as telas'
     + (nums.length > 1
       ? ' (DESALINHADO: ' + JSON.stringify(porTela) + ')'
       : ' (?v=' + nums[0] + ')'));
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
