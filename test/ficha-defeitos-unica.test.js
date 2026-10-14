'use strict';
// 14/10 — FICHA DE DEFEITOS UNICA na Girassol/AMB (e nas proximas empresas): a juncao das duas copias tem o que cada uma
// tinha a mais. Nivelar por cima — nenhuma loja perde nada.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
const unica = fs.readFileSync(path.join(R, 'amb-devolucoes', 'public-AMB', 'js-AMB', 'defeitos-ficha.js'), 'utf8');
// 14/10 (b623): a copia da GOOD (public/js/defeitos-ficha.js) saiu — a GOOD usa a unica. As funcoes que ela tinha ficam
// registradas aqui (foto tirada do arquivo dela no dia), pra nenhuma sumir da unica sem o teste ver.
const FUNCOES_DA_FICHA_GOOD = ["fichaAindaAberta", "registrar", "avisoEm", "capitalizar", "esc", "dataBr", "api", "caixa", "abrir", "fechar", "SUB", "topo", "buscarFotosDefeitos", "pintarAbas", "htmlHistorico", "htmlPecas", "htmlEstado", "pintaEstado", "pintaHistorico", "pintaPecas", "fecharFichaInline", "marcarCardAberto", "caixaEdicao", "linhaPedido"];
// o que a GOOD tinha a mais
for (const n of ['expandirFichaNoCard', 'fecharFichaInline', 'marcarCardAberto', 'abrirModalDefeito', '/api/produtos/buscar']) {
  ok(unica.includes(n), '⚠️ da GOOD: ' + n);
}
// o que a AMB tinha a mais
for (const n of ['abrirZoomProduto', 'verFotoDefeito', 'srcFoto', 'ultimoTermoBusca', 'naRaizBusca', 'APP_BASE', 'var(--marca)']) {
  ok(unica.includes(n), '⚠️ da AMB: ' + n);
}
ok(!/#561A9E/.test(unica), '  sem a cor fixa da GOOD (as cores vem da empresa)');
// nenhuma funcao que existia em uma das duas sumiu
const fns = (s) => new Set([...s.matchAll(/\n\s*(?:async\s+)?function\s+([a-zA-Z_]\w*)\s*\(/g)].map((m) => m[1]));
const fu = fns(unica);
const faltam = FUNCOES_DA_FICHA_GOOD.filter((n) => !fu.has(n) && n !== 'buscarFotosDefeitos');
ok(faltam.length === 0, '⚠️ nenhuma funcao da ficha da GOOD ficou de fora (' + (faltam.join(', ') || 'ok') + ')');
// o painel da Girassol/AMB carrega a ficha unica + o Lancar defeito (com o prefixo da empresa); a GOOD troca o bloco
const painel = fs.readFileSync(path.join(R, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
ok(/<!-- ficha-defeitos:inicio[\s\S]*js-AMB\/defeitos-ficha\.js\?v=b623[\s\S]*js-AMB\/lancar-defeito\.js[\s\S]*LancarDefeito\.instalar\(\{ prefixo: window\.APP_BASE \|\| '' \}\)[\s\S]*<!-- ficha-defeitos:fim -->/.test(painel), '⚠️ painel da Girassol/AMB: ficha unica + Lancar defeito com o prefixo da empresa');
const app = fs.readFileSync(path.join(R, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
ok(/router\.get\('\/js-AMB\/lancar-defeito\.js'/.test(app) && /'public', 'js', 'lancar-defeito\.js'/.test(app), '  o modulo do Lancar defeito e servido da peca da GOOD (sem copia)');
const g = require(path.join(R, 'lib', 'painel-unico.js')).montarPainelUnicoGood(painel);
ok(/\/js\/defeitos-ficha\.js/.test(g) && (g.match(/lancar-defeito\.js/g) || []).length === 1 && !/js-AMB\/defeitos-ficha|js-AMB\/lancar-defeito/.test(g), '⚠️ painel da GOOD: continua com a ficha dela e UM Lancar defeito (nao instala duas vezes)');
// Codex #493
{
  const i = unica.indexOf('async function buscarFotosDefeitosComBling(');
  const comBling = i >= 0 ? unica.slice(i, unica.indexOf('\n  }\n', i)) : '';
  ok(comBling && !/semBling/.test(comBling) && /i < 12/.test(comBling), '⚠️ fotos na Girassol/AMB: 12 por vez, sem o modo sem-Bling que a rota delas nao tem (Codex #493)');
}
ok(/var minhaVez = \+\+_geracaoFicha;[\s\S]{0,400}if \(minhaVez !== _geracaoFicha\) return;/.test(unica), '⚠️ abrir A e logo B: a resposta atrasada de A nao sobrescreve a ficha aberta');
ok(/fichaBotaoAtual = null;\s*_geracaoFicha\+\+;[\s\S]{0,200}procurando\.\.\./.test(unica), '⚠️ lista refeita (busca/aba) invalida a ficha que ainda carregava');
ok(/function fecharFichaInline\(\) \{\s*if \(fichaInlineId == null\) return;\s*_geracaoFicha\+\+;/.test(unica), '⚠️ fechar o card enquanto carrega invalida a resposta tardia');
ok(!/getElementById\('defBusca'\)/.test(unica) && /id="defBuscaLista"/.test(unica), '⚠️ a busca da ficha tem id proprio (o index-AMB ja tem #defBusca do Lancar defeito)');
const tri = fs.readFileSync(path.join(R, 'amb-devolucoes', 'public-AMB', 'index-AMB.html'), 'utf8');
ok(/function abrirModalDefeito\(skuInicial\)[\s\S]{0,1600}document\.getElementById\('defBusca'\)\.value = skuInicial;\s*buscarProdutoDefeito\(\);/.test(tri), '⚠️ triagem: o Lancar defeito chamado pela ficha ja vem com o SKU buscado');
// b623: a GOOD usa a ficha UNICA (o arquivo dela saiu) e escolhe a foto sem-Bling
ok(!fs.existsSync(path.join(R, 'public', 'js', 'defeitos-ficha.js')), '⚠️ a copia da GOOD saiu (senao o express.static a entregaria antes da rota)');
const srv = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
ok(/app\.get\('\/js\/defeitos-ficha\.js'[\s\S]{0,200}sendFile\(FICHA_DEFEITOS_UNICA\)/.test(srv) && /FICHA_DEFEITOS_UNICA = path\.join\(__dirname, 'amb-devolucoes', 'public-AMB', 'js-AMB', 'defeitos-ficha\.js'\)/.test(srv), '⚠️ a GOOD entrega a ficha unica no endereco de sempre (/js/defeitos-ficha.js)');
const idxG = fs.readFileSync(path.join(R, 'public', 'index.html'), 'utf8');
ok(/window\.FOTO_SEM_BLING = true;[\s\S]{0,200}js\/defeitos-ficha\.js/.test(idxG) && /--marca-texto: #561A9E/.test(idxG) && /--marca-claro: #7B3FC4/.test(idxG), '⚠️ triagem da GOOD: foto sem-Bling + as cores que a ficha unica usa');
ok(/window\.FOTO_SEM_BLING = true;/.test(g), '  painel da GOOD: foto sem-Bling');
ok(/function buscarFotosDefeitos\(itens, listaEl\) \{\s*return window\.FOTO_SEM_BLING \? buscarFotosDefeitosSemBling/.test(unica), '  a ficha unica escolhe a estrategia de foto pela pagina');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
