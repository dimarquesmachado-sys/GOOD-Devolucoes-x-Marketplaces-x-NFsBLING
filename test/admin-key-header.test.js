// Roda com: node test/admin-key-header.test.js
//
// P0 nº3 da auditoria de 26/08, que o parecer de 09/09 pôs em PRIMEIRO
// lugar — e com razão: é o único risco de vazamento ativo hoje.
//
// ⚠️ Credencial em querystring fica em: log de acesso do Render, log do
// proxy, histórico do navegador, e em toda URL copiada. O Mover-Pedidos
// baniu isso na rota de token deles.
//
// ⚠️ MAS BANIR AQUI HOJE QUEBRARIA O ACESSO DO DONO. Ele opera por links
// salvos e URLs que recebeu ao longo de meses. Então: o header passa a
// valer, a querystring CONTINUA valendo, e cada uso dela é CONTADO — para
// a remoção ser decidida por dado, não por palpite.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const amb = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');

// ── o header passa a valer, nos dois ─────────────────────────────────
{
  ok(/req\.get\('x-admin-key'\)/.test(srv), 'server.js aceita o header `x-admin-key`');
  ok(/req\.get\('x-admin-key'\)/.test(amb), 'app-AMB.js tambem');
}

// ── ⚠️ e a querystring CONTINUA valendo (por enquanto) ───────────────
//
// Cortar hoje quebraria o acesso dele sem aviso. A transição é medida,
// não adivinhada.
{
  ok(/req\.query\.k/.test(srv) && /req\.query\.k/.test(amb),
     'a querystring AINDA vale — cortar hoje quebraria os links salvos dele');
}

// ── o uso do caminho velho é CONTADO ─────────────────────────────────
//
// É o que permite decidir a remoção por dado: quando o contador ficar em
// zero por um período, a querystring sai.
{
  ok(/usosPorQuerystring\+\+/.test(srv), 'cada uso da querystring e contado (server)');
  ok(/usosQuerystringAMB\+\+/.test(amb), '  e no app-AMB');
  ok(/usos_por_querystring/.test(srv), 'e o /health mostra o contador');
  ok(/ROTACIONADA|rotacionada/.test(srv),
     '  com a nota de que a chave precisa ser ROTACIONADA depois (a antiga vazou em logs)');
}

// ── ⚠️ o header NÃO pode ser burlado por chave vazia ─────────────────
//
// Se `ADMIN_KEY` não estiver configurada, nenhuma requisição pode passar —
// nem com header vazio batendo com env vazia.
{
  ok(/!!ADMIN_KEY && valor === ADMIN_KEY/.test(srv),
     'sem ADMIN_KEY configurada, NADA passa (nem header vazio)');
  ok(/!chave \|\| recebida !== chave/.test(amb),
     '  e no app-AMB tambem');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
