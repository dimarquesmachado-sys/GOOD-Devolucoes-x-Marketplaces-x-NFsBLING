// Roda com: node test/link-marketplace.test.js
//
// [stated] "nos aprovados OK tem link pro marketplace. Já nos produtos com
// problema, não tem link. Tinha q ter em todos cards o link pros
// marketplaces."
//
// As tres secoes ja chamavam `linkPedido()` — o buraco era ELA, que so
// sabia montar link do Mercado Livre. Shopee, Amazon, Magalu e TikTok
// caiam no `<code>` sem link, e sao justamente os que aparecem nos cards
// de problema.
//
// Os ids abaixo sao REAIS, tirados da tela do dono.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// a mesma cascata que vive nos paineis
function qual(id) {
  if (/^20\d{14}$/.test(id)) return 'ml';
  if (/^\d{3}-\d{7}-\d{7}$/.test(id)) return 'amazon';
  if (/^\d{16}$/.test(id)) return 'magalu';
  if (/^\d{18,19}$/.test(id)) return 'tiktok';
  if (/^[0-9A-Z]{10,20}$/.test(id) && /[A-Z]/.test(id)) return 'shopee';
  return null;
}

// ── ids reais da tela ───────────────────────────────────────────────
{
  ok(qual('2000017952182976') === 'ml', 'Order ML (20 + 14 digitos)');
  ok(qual('702-3150581-8530640') === 'amazon', 'Amazon (3-7-7)');
  ok(qual('260805JEXB85ES') === 'shopee', 'Shopee (tem letra)');
  ok(qual('1523670104546524') === 'magalu', 'Magalu (16 digitos)');
  ok(qual('583529996785714778') === 'tiktok', 'TikTok (18 digitos)');

  // ⚠️ o caso que peguei testando: Magalu casava com a regra da Shopee
  ok(qual('1523670104546524') !== 'shopee',
     'pedido Magalu NAO cai como Shopee — 16 digitos casavam nas duas regras');

  ok(qual('') === null, 'id vazio nao vira link');
  ok(qual('abc') === null, 'formato desconhecido tambem nao — melhor sem link que errado');
}

// ── e as tres secoes usam a mesma funcao ────────────────────────────
{
  for (const [nome, rel] of [
    ['GOOD', 'public/painel-devolucoes.html'],
    ['AMB (servido)', 'amb-devolucoes/public-AMB/painel-AMB.html'],
    ['AMB (direto)', 'amb-devolucoes/public-AMB/painel2-AMB.html'],
  ]) {
    const html = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const chamadas = (html.match(/\$\{linkPedido\(d\)\}/g) || []).length;
    ok(chamadas >= 2,
       nome + ': as secoes chamam linkPedido (achei ' + chamadas + ')');
    for (const mkt of ['Pedido Amazon', 'Pedido Shopee', 'Pedido Magalu', 'Pedido TikTok']) {
      ok(html.includes(mkt), nome + ': monta link de ' + mkt.replace('Pedido ', ''));
    }
    ok(/ORDEM IMPORTA/.test(html),
       nome + ': com o aviso da ordem — Magalu casava com a regra da Shopee');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
