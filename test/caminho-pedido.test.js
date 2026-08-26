// Roda com: node test/caminho-pedido.test.js
// Guarda os bypasses que o Codex apontou no PR #85 pra nao voltarem.
const { ehCaminhoProtegido } = require('../lib/caminho-pedido');
const GOOD = { exatos:['/painel-devolucoes.html'], prefixos:['/admin/'] };
const AMB  = { exatos:['/painel-AMB.html','/painel2-AMB.html'] };
const casos = [
  // os bypasses que o Codex apontou
  ['GOOD', GOOD, '/%70ainel-devolucoes.html',        true,  'bypass: p codificado'],
  ['GOOD', GOOD, '/painel%2Ddevolucoes.html',        true,  'bypass: hifen codificado'],
  ['GOOD', GOOD, '/%2570ainel-devolucoes.html',      true,  'bypass: dupla codificacao'],
  ['GOOD', GOOD, '/%61dmin/relatorios.html',         true,  'bypass: a codificado'],
  ['GOOD', GOOD, '/admin%2Frelatorios.html',         true,  'bypass: barra codificada'],
  ['GOOD', GOOD, '\\\\admin\\\\relatorios.html',     true,  'bypass: barra invertida'],
  ['GOOD', GOOD, '/PAINEL-DEVOLUCOES.HTML',          true,  'bypass: maiusculas'],
  ['GOOD', GOOD, '/painel-devolucoes.html%',         true,  'malformado -> barra'],
  // os normais
  ['GOOD', GOOD, '/painel-devolucoes.html',          true,  'caminho normal'],
  ['GOOD', GOOD, '/admin/relatorios.js',             true,  'asset admin'],
  ['GOOD', GOOD, '/',                                false, 'raiz publica'],
  ['GOOD', GOOD, '/index.html',                      false, 'login publico'],
  ['GOOD', GOOD, '/defeitos.html',                   false, 'publico v3.91'],
  ['GOOD', GOOD, '/admin.html',                      false, 'so redirect'],
  ['GOOD', GOOD, '/js/app.js',                       false, 'asset publico'],
  ['GOOD', GOOD, '/uploads/foto%20do%20pacote.jpg',  false, 'espaco codificado, publico'],
  ['AMB',  AMB,  '/%70ainel-AMB.html',               true,  'bypass AMB'],
  ['AMB',  AMB,  '/painel2-AMB.html',                true,  'painel2'],
  ['AMB',  AMB,  '/PAINEL-amb.html',                 true,  'maiusculas AMB'],
  ['AMB',  AMB,  '/index-AMB.html',                  false, 'login AMB'],
  ['AMB',  AMB,  '/defeitos-AMB.html',               false, 'publico AMB'],
];

// ---- seg2.2: segmentos de ponto (2o apontamento do Codex) ----
const dot = [
  ['GOOD', GOOD, '/./painel-devolucoes.html',        true,  'bypass: /./'],
  ['GOOD', GOOD, '/%2e/painel-devolucoes.html',      true,  'bypass: ponto codificado'],
  ['GOOD', GOOD, '/admin/../painel-devolucoes.html', true,  'bypass: /../'],
  ['GOOD', GOOD, '/x/../admin/relatorios.html',      true,  'bypass: /../ na pasta admin'],
  ['GOOD', GOOD, '/%2e%2e/admin/relatorios.html',    true,  'bypass: .. codificado'],
  ['GOOD', GOOD, '/./%70ainel-devolucoes.html',      true,  'bypass: ponto + %70'],
  ['GOOD', GOOD, '//admin//relatorios.html',         true,  'bypass: barra repetida'],
  ['GOOD', GOOD, '/./index.html',                    false, 'ponto num publico segue publico'],
  ['GOOD', GOOD, '/js/./app.js',                     false, 'ponto em asset publico'],
  ['GOOD', GOOD, '/uploads/nota.2026.pdf',           false, 'PONTO NO NOME do arquivo'],
  ['AMB',  AMB,  '/./painel-AMB.html',               true,  'bypass ponto AMB'],
  ['AMB',  AMB,  '/./index-AMB.html',                false, 'login AMB com ponto'],
];
casos.push(...dot);

let f=0;
for (const [emp,cfg,path,esperado,oque] of casos) {
  const r = ehCaminhoProtegido(path, cfg);
  const ok = r === esperado;
  if(!ok) f++;
  console.log((ok?'ok  ':'FALHA ')+emp.padEnd(5)+JSON.stringify(path).padEnd(34)+(r?'BARRADO':'passou').padEnd(9)+'| '+oque);
}
console.log(f===0 ? '=== '+casos.length+' CASOS, TODOS PASSARAM' : '=== '+f+' FALHA(S)');
process.exit(f?1:0);
