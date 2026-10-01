'use strict';
// ⚠️ NOME PURO (sem digito) NAO E RASTREIO: vai direto ao indice de nomes.
//
// Girassol, 01/10, medido pelo dono: mais de 1 minuto pra achar pelo nome,
// com o indice QUENTE. O caminho: Magalu -> Shopee (e quando nao acha, de
// novo com ?refresh=1 — API da Shopee, SEM timeout) -> ponte do TikTok no
// Mover-Pedidos -> so entao o indice de nomes, que tinha a resposta.
// Um texto sem nenhum digito nunca e etiqueta de ML/Correios/Shopee/Magalu/
// TikTok nem chave/numero de NF.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const semCom = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

for (const [p, nome] of [['amb-devolucoes/lib-AMB/identificar-AMB.js', 'AMB/Girassol'], ['server.js', 'GOOD']]) {
  const s = semCom(p);
  const iDecl = s.indexOf("const ehNomePuro = !/\\d/.test(codigoOriginal)");
  ok(iDecl > 0, `⚠️ ${nome}: ehNomePuro = sem digito e >= 5 letras`);
  // TDZ: o registro em tentativas vem DEPOIS de `const resultado = {`
  const iRes = s.indexOf('const resultado = {');
  const iReg = s.indexOf("if (ehNomePuro) resultado.tentativas.push({ tipo: 'nome_puro'");
  ok(iReg > iRes && iRes > 0, `  ${nome}: o registro 'nome_puro' vem DEPOIS de resultado existir (TDZ — errei na 1a versao)`);
  ok(/if \(!ehNomePuro && await tentarDevolucaoMagalu\(\)\) return;/.test(s), `  ${nome}: Magalu pula pra nome puro`);
  ok(/if \(!ehNomePuro && !devShopee && shopee\.cfg\.ativo/.test(s), `  ${nome}: a 2a tentativa Shopee (a que forca ?refresh=1) pula pra nome puro`);
  ok(/if \(!ehNomePuro\) try \{[^\n]*\n\s*const rTk = await tiktokDev\.procurar\(/.test(s), `  ${nome}: SO o try do TikTok pula (nao o bloco inteiro)`);
  // ⚠️ o if (!devShopee) { ... } que envolve TikTok + NOME + 404 continua INTACTO —
  // na 1a versao eu pus !ehNomePuro nele e pulei a busca por nome inteira
  // (TypeError em devShopee.return_sn). Regra 4.1: ver ate onde o if vai.
  ok(!/if \(!ehNomePuro && !devShopee\) \{/.test(s), `⚠️ ${nome}: o if externo (!devShopee) NAO ganhou !ehNomePuro (ele contem a busca por nome)`);
  // e a busca por nome em si NAO e pulada
  ok(/const rN = await nfNomes\.buscarPorNome\(codigoOriginal\);/.test(s) && !/if \(!ehNomePuro[^\n]*buscarPorNome/.test(s), `  ${nome}: a busca por nome roda normalmente`);
  // b475 (Codex, P2): o else da Shopee so registra "desligada" quando ela ESTA desligada
  ok(!/\} else \{\s*\n[^\n]*\n\s*resultado\.tentativas\.push\(\{ tipo: 'shopee_return', v: '3\.34\.3', codigo: codigoOriginal, ok: false, status: 0/.test(s),
     `  ${nome}: o else da Shopee nao e incondicional (nome puro com Shopee ativa nao vira "desligada")`);
  ok(/\} else if \(!shopee\.cfg\.ativo\) \{/.test(s), `  ${nome}: ... e so quando !shopee.cfg.ativo`);
}

// a regra do "nome puro": casos
const ehNomePuro = (c) => !/\d/.test(c) && c.replace(/[^A-Za-z\u00C0-\u017F]/g, '').length >= 5;
ok(ehNomePuro('Celma Ribeiro Albeche') && ehNomePuro('RENATONEVES') && ehNomePuro('José da Silva'), '  nomes (com espaco, colado, com acento) = nome puro');
ok(!ehNomePuro('BR260329038134J') && !ehNomePuro('AP463858079BR') && !ehNomePuro('2000018588834006') && !ehNomePuro('126421'),
   '  rastreio Shopee, Correios, pedido ML e numero de NF NAO sao nome puro (tem digito)');
ok(!ehNomePuro('Jose 2') && !ehNomePuro('ANA'), '  nome com digito, ou curto demais, segue o caminho antigo');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
