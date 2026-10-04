'use strict';
// b507 — auditoria multiempresa: "mandar da espreita para Aprovadas" na AMB/Girassol (antes so a GOOD).
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const app = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
const i = app.indexOf("router.post('/api/admin/espreita/lancar-nf', auth.requerAdmin,");
const rota = app.slice(i, app.indexOf('\n});\n', i) + 4);
ok(i > 0 && i > app.indexOf('const ajudantes = criarAdminHelpers('), '⚠️ a rota existe na AMB/Girassol, depois dos ajudantes, com a SESSAO admin da empresa (o painel nao manda ?k=)');
ok(/pack_id\) \{[\s\S]*?\/packs\//.test(rota) && /pk\.shipments\[0\]/.test(rota), '  venda de carrinho: o envio vem do PACK');
ok(/buscarNFPelaChave\(nf\.chave\)/.test(rota) && /mesmaChave/.test(rota) && /chave: nf\.chave/.test(rota), '⚠️ id do Bling so se a CHAVE bater (mesmo numero em series diferentes)');
ok(/LANCANDO_ESPREITA\.has\(oid\)/.test(rota) && /finally \{ if \(oid\) LANCANDO_ESPREITA\.delete/.test(rota), '  trava contra clique duplo, liberada no finally');
ok(/ORCAMENTO_LANCAR_MS\) \{ restantes\.push/.test(rota) && /falhas, restantes/.test(rota), '  orcamento de tempo: o que sobrar volta em restantes');
ok(/db\.jaTriado\(\{ orderId: oid \}\)/.test(rota) && /jaExistiam\.push/.test(rota), '  nao duplica pedido que ja tem triagem');
ok(/if \(!ja \|\| ja\.ok === false\)/.test(rota), '  banco fora do ar = falha avisada (nao grava em duplicidade)');
ok(/ml\.chamarML\('\/orders\/' \+ oid\)/.test(rota) && /invoice_data\?siteId=MLB/.test(rota), '  le a venda e a NF no ML DESTA empresa');
ok(/db\.registrarTriagem\(\{/.test(rota) && /status: 'aprovado'/.test(rota), '⚠️ grava na tabela DESTA empresa como aprovada aguardando NF');
ok(/nf_itens: itens\.map\(/.test(rota), '  Codex #418: venda com varios produtos guarda todos (nao so o 1o)');
for (const f of ['painel-AMB.html']) {
  const h = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', f), 'utf8');
  ok(!/ESTA FUNCAO NAO EXISTE NA AMB/.test(h) && !/ainda n.o existe na AMBTotal/.test(h), '⚠️ ' + f + ': o aviso "nao existe na AMB" saiu — o botao funciona');
  ok(/\(window\.APP_BASE \|\| ''\) \+ '\/api\/admin\/espreita\/lancar-nf'/.test(h), '  ' + f + ': chama a rota da propria empresa');
  ok(/e\.pedido && e\.marketplace === 'ml' \? '<input type="checkbox" class="chkAlerta"/.test(h), '  ' + f + ': so pedido ML ganha checkbox (a rota le a venda no ML)');
  ok(/d\.restantes/.test(h), '  ' + f + ': avisa o que sobrou do tempo');
}
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
