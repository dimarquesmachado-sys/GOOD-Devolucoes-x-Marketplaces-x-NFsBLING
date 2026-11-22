'use strict';
require('./_fonte-fabrica');   // docs/MODULARIZACAO.md: le a fabrica (app-AMB.js) com os blocos de lib-AMB de volta no lugar
// 14/10 — logo e icone POR EMPRESA (a Girassol mostrava o logo e o icone da AMB na triagem e na aba do navegador).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const { criarMarca } = require('../lib/marca-empresa.js');
const { obterEmpresa } = require('../lib/empresas.js');
const PUB = path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB');
const triagem = fs.readFileSync(path.join(PUB, 'index-AMB.html'), 'utf8');
const gi = criarMarca(obterEmpresa('girassol'));
const tg = gi.aplicar(triagem);
ok(!/logo-AMB\.png|icone-AMB\.png/.test(tg.replace(/manifest-AMB\.json/g, '')), '⚠️ triagem da Girassol: nenhum logo/icone da AMB sobra');
ok((tg.match(/src="marcas\/girassol\/icone-192\.png"/g) || []).length === 2, '  os 2 logos da triagem (topo e faixa baixa) sao os da Girassol');
ok(/<link rel="icon" type="image\/png" href="marcas\/girassol\/icone-192\.png">/.test(tg) && /<link rel="apple-touch-icon" href="marcas\/girassol\/apple-touch-icon\.png">/.test(tg), '⚠️ icone da aba e do atalho do celular = Girassol');
for (const f of [gi.logo, gi.icone, gi.iconeToque]) ok(fs.existsSync(path.join(PUB, f)), '  arquivo existe: ' + f);
const ic = gi.iconesDoManifesto([{ src: 'icone-AMB.png', sizes: '192x192', type: 'image/png' }, { src: 'icone-AMB.png', sizes: '512x512', type: 'image/png' }]);
ok(ic.length === 1 && ic[0].src === 'marcas/girassol/icone-192.png' && ic[0].sizes === '192x192', '⚠️ manifesto da Girassol: so declara o tamanho que o arquivo tem (sem 512x512 falso)');
ok(criarMarca({ marca: { icone: 'a.png', icone512: 'b.png' } }).iconesDoManifesto([{ sizes: '192x192' }]).map((i) => i.src + i.sizes).join() === 'a.png192x192,b.png512x512', '  com icone512 real, o 512 e declarado');
ok(criarMarca(obterEmpresa('ambtotal')).iconesDoManifesto([{ src: 'icone-AMB.png', sizes: '192x192' }, { src: 'icone-AMB.png', sizes: '512x512' }]).length === 2, '  AMB: manifesto igual a antes (2 registros)');
const am = criarMarca(obterEmpresa('ambtotal'));
ok(am.aplicar(triagem) === triagem && am.logo === 'logo-AMB.png' && am.icone === 'icone-AMB.png', '⚠️ AMB (sem marca na ficha): a tela sai igual a antes');
ok(criarMarca(null).icone === 'icone-AMB.png', '  ficha sem marca nenhuma: cai nos arquivos de sempre, sem quebrar');
// b800 (V-17, ensaio de CNPJ novo) — ARQUIVO DA MARCA QUE AINDA NAO FOI SUBIDO vale como parte ausente da ficha: a ficha
// que o gerador escreve ja aponta pra marcas/<chave>/..., e ate o dono subir o logo a triagem mostrava imagem quebrada.
{
  const { gerar } = require('../scripts/nova-empresa.js');
  const g = gerar('serrana', 'Comercial Serrana');
  const daFicha = (k) => (g.ficha.match(new RegExp(k + ": '([^']+)'")) || [])[1];
  const marcaGerada = { logo: daFicha('logo'), icone: daFicha('icone'), iconeToque: daFicha('iconeToque') };
  ok(g.ok && marcaGerada.logo === 'marcas/serrana/icone-192.png' && marcaGerada.iconeToque === 'marcas/serrana/apple-touch-icon.png', '  a ficha gerada aponta pros arquivos da marca da empresa nova');
  const noDisco = (arq) => fs.existsSync(path.join(PUB, arq));
  const nova = criarMarca({ marca: marcaGerada }, undefined, { existe: noDisco });
  ok(nova.logo === 'logo-AMB.png' && nova.icone === 'icone-AMB.png' && nova.iconeToque === 'icone-AMB.png', '⚠️ empresa nova SEM os arquivos: logo e icones caem no padrao (' + [nova.logo, nova.icone, nova.iconeToque].join(', ') + ')');
  ok(nova.aplicar(triagem) === triagem, '⚠️ e a triagem dela nao aponta pra arquivo que nao existe (era imagem quebrada)');
  ok(nova.faltando.join() === 'marcas/serrana/icone-192.png,marcas/serrana/apple-touch-icon.png', '  `faltando` diz o que falta subir, cada arquivo uma vez (' + nova.faltando.join(', ') + ')');
  const lista = [{ src: 'icone-AMB.png', sizes: '192x192', type: 'image/png' }, { src: 'icone-AMB.png', sizes: '512x512', type: 'image/png' }];
  ok(JSON.stringify(nova.iconesDoManifesto(lista)) === JSON.stringify(lista), '⚠️ o atalho do celular dela fica com os icones que existem (o manifesto de sempre)');
  // so o icone do atalho falta: o resto da marca dela continua valendo
  const parcial = criarMarca({ marca: { logo: 'marcas/girassol/icone-192.png', icone: 'marcas/girassol/icone-192.png', iconeToque: 'marcas/girassol/nao-existe.png' } }, undefined, { existe: noDisco });
  ok(parcial.logo === 'marcas/girassol/icone-192.png' && parcial.iconeToque === 'marcas/girassol/icone-192.png' && parcial.faltando.join() === 'marcas/girassol/nao-existe.png', '  faltando SO o icone do atalho: ele cai no icone da empresa, e o logo dela fica');
  ok(parcial.iconesDoManifesto(lista).map((i) => i.src + i.sizes).join() === 'marcas/girassol/icone-192.png192x192', '  e o manifesto continua o da empresa');
  // com os arquivos no lugar (a Girassol de verdade), conferir a existencia nao muda nada
  const giConferida = criarMarca(obterEmpresa('girassol'), undefined, { existe: noDisco });
  ok(giConferida.faltando.length === 0 && giConferida.aplicar(triagem) === tg && JSON.stringify(giConferida.iconesDoManifesto(lista)) === JSON.stringify(gi.iconesDoManifesto(lista)), '⚠️ Girassol (arquivos no lugar): tela e manifesto identicos com e sem a conferencia');
  const amConferida = criarMarca(obterEmpresa('ambtotal'), { logo: 'logo-AMB.png', icone: 'icone-AMB.png' }, { existe: noDisco });
  ok(amConferida.faltando.length === 0 && amConferida.aplicar(triagem) === triagem && amConferida.iconesDoManifesto(lista).length === 2, '⚠️ AMB: nada muda');
  ok(criarMarca({ marca: marcaGerada }).logo === marcaGerada.logo && criarMarca({ marca: marcaGerada }).faltando.length === 0, '  sem `existe`, a peca nao confere nada (quem chama sem saber onde os arquivos moram fica como antes)');
}
const app = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
ok(/const INDEX_AMB_HTML = comMarca\(comTema\(/.test(app) && /<link rel=\\?"icon\\?" type=\\?"image\/png\\?" href=\\?"\$\{ICONE_EMPRESA\}\\?">/.test(app) && /icons: MARCA\.iconesDoManifesto\(MANIFEST_AMB\.icons\)/.test(app), '⚠️ o app aplica a marca na triagem, poe o icone da empresa na aba do painel e no manifesto');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
