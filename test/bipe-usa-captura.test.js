'use strict';
// b523/b524 — auditoria (Codex, 04/10): antes de todo "nao encontrado" o bipe consulta a captura persistente.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..'); const rd = (a) => fs.readFileSync(path.join(R, a), 'utf8');
const cap = require('../lib/devolucoes-capturadas');

// supabase falso: devolve as linhas dadas e registra o filtro de empresa
function falso(linhas, espera) {
  const reg = { empresa: null, or: null };
  const q = {
    select() { return q; }, or(f) { reg.or = f; return q; }, order() { return q; }, limit() { return q; },
    eq(c, v) { if (c === 'empresa') reg.empresa = v; return q; },
    then(res) { return (espera ? new Promise((r) => setTimeout(r, espera)) : Promise.resolve()).then(() => res({ data: linhas, error: null })); },
  };
  return { reg, from() { return q; } };
}

(async () => {
  // 1) comportamento: REFUND do TikTok fica de fora; so a empresa pedida; ids compactados entram no filtro
  const sb = falso([
    { marketplace: 'tiktok', pedido: 'T1', tipo_tiktok: 'REFUND', nf_numero: '9' },
    { marketplace: 'shopee', pedido: 'S1', rastreio: 'BR1', nf_numero: null },
    { marketplace: 'ml', pedido: 'M1', nf_numero: '123' },
  ]);
  const l = await cap.sugestoesParaBipe(sb, 'amb', [' br 123456789 br ', null], 500);
  ok(l.length === 2 && !l.some((x) => x.pedido === 'T1'), '⚠️ reembolso puro do TikTok nao vira sugestao de pacote');
  ok(sb.reg.empresa === 'amb', '  consulta so a empresa pedida');
  ok(/BR123456789BR/.test(sb.reg.or), '  tambem procura o codigo normalizado (sem espacos, maiusculo)');
  // 2) lentidao/erro nao derruba nem trava o bipe
  const t0 = Date.now();
  const lento = await cap.sugestoesParaBipe(falso([{ pedido: 'X' }], 1500), 'good', ['abc'], 100);
  ok(Array.isArray(lento) && lento.length === 0 && Date.now() - t0 < 1000, '  passou de 100 ms: lista vazia, sem esperar');
  ok((await cap.sugestoesParaBipe({ from() { throw new Error('boom'); } }, 'good', ['abc'], 100)).length === 0, '  erro do banco = lista vazia');
  ok((await cap.sugestoesParaBipe(null, 'good', ['abc'], 100)).length === 0, '  sem supabase = lista vazia');

  // 3) as duas rotas chamam antes de TODO 404 de "nao encontrado" (Correios, QR ML, NF nao localizada, final)
  const g = rd('server.js'); const a = rd('amb-devolucoes/lib-AMB/identificar-AMB.js');
  const conta = (s, re) => (s.match(re) || []).length;
  ok(conta(g, /return res\.status\(404\)\.json\(await anexarCapturadas\(/g) === 4, '⚠️ GOOD: 4 saidas "nao encontrado" consultam a captura');
  ok(conta(a, /comRecados\(await anexarCapturadas\(/g) === 4, '⚠️ AMB/Girassol: idem');
  ok(/sugestoesParaBipe\(supabase, 'good'/.test(g), '  GOOD: empresa good');
  ok(/sugestoesParaBipe\(supabase, CHAVE_DADOS/.test(a), '  AMB/Girassol: a chave DESTA empresa (CHAVE_DADOS)');

  // 4) front: sem NF guardada o card nao vira toque (nao repete a consulta que falhou)
  const b = rd('public/js/busca.js');
  ok(/mostrarCapturadas\(data\.capturadas\);   \/\/ b523/.test(b) && /function mostrarCapturadas\(lista\)/.test(b), '  tela mostra o que foi guardado');
  ok(/const alvo = c\.nf_numero \|\| '';/.test(b) && !/c\.nf_numero \|\| c\.pedido/.test(b), '⚠️ so busca por NF; pedido sozinho nao entra em loop');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
