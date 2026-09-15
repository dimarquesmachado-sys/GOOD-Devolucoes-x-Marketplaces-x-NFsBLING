'use strict';
// ⚠️ O AVISO "JÁ TEM NF DE DEVOLUÇÃO" NUNCA FUNCIONOU NA GOOD.
//
// [stated 15/09] "impossível ter série 1 devolução. série 1 é sempre saída.
// o Bling monta assim. e as 0 se nao me engano, são as de entrada"
//
// O dono estava certo, e a sonda mediu: **tipo=1 é "Venda de mercadorias -
// Saída"** (200 de 200 notas) e **tipo=0 são as ENTRADAS**. O índice lia
// tipo=1 cravado, comparava nota de VENDA com pedido de devolução, e nunca
// casava nada — **178 notas de devolução ficavam invisíveis**.
//
// 📌 Este teste guarda o VALOR, não só o mapeamento: o `empresas.test.js` já
// conferia que a env existe e aponta para o campo certo, mas não que o
// padrão é `0`. Um padrão trocado traria o bug de volta calado.

const fs = require('fs');
const path = require('path');
const { entreMarcadores } = require('./_recorte');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const registro = fs.readFileSync(path.join(RAIZ, 'lib', 'empresas.js'), 'utf8');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');

// ── ⚠️ o padrão é '0' (entrada) nas duas empresas ───────────────────
{
  const linhas = registro.split('\n').filter((l) => /nfEntradaTipo:/.test(l));
  ok(linhas.length >= 2,
     'as duas empresas declaram `nfEntradaTipo` (achei ' + linhas.length + ')');

  for (const l of linhas) {
    const m = /'NF_ENTRADA_TIPO',\s*'(\d)'/.exec(l);
    ok(!!m && m[1] === '0',
       "⚠️ o padrao e '0' (ENTRADA) — tipo 1 e SAIDA, sempre"
       + (m ? ` [achei '${m[1]}']` : ' [nao achei o padrao]'));
  }
}

// ── e o índice de devolução USA a ficha, não um número cravado ──────
{
  const idx = entreMarcadores(srv,
    'const tipoEntrada = String(FICHA_GOOD.fiscal.nfEntradaTipo()', 'DESCARTAVEL');
  ok(idx.length > 0, 'o indice le o tipo pela ficha da empresa');

  // ⚠️ e TODO fallback de `nfEntradaTipo()` tem que ser '0'.
  //
  // Minha 1a versao usava `.test()`: bastava UMA ocorrencia certa pra passar.
  // Como ha duas no server.js, trocar so uma delas mantinha o teste verde —
  // falso negativo, que e pior que nao ter teste.
  //
  // Agora conto: nenhum `nfEntradaTipo() || '<algo diferente de 0>'`.
  const fallbacks = [...srv.matchAll(/nfEntradaTipo\(\)\s*\|\|\s*'(\d)'/g)]
    .map((m) => m[1]);
  ok(fallbacks.length >= 1, 'o indice tem fallback declarado');
  const ruins = fallbacks.filter((v) => v !== '0');
  ok(ruins.length === 0,
     `⚠️ TODOS os ${fallbacks.length} fallbacks sao '0'`
     + (ruins.length ? ` (achei ${ruins.length} com valor errado: ${ruins.join(',')})` : ''));
}

// ── ⚠️ e os `tipo=1` que sobraram são propositais ───────────────────
//
// Dois lugares ainda usam tipo=1, e os dois estão certos:
//   - a SONDA de diagnóstico varre os dois tipos de propósito
//   - a busca por CHAVE precisa do 1: sem ele, a chave de uma nota de
//     entrada casava e o id ia pro cache como se fosse a venda
{
  const bling = fs.readFileSync(path.join(RAIZ, 'lib', 'bling.js'), 'utf8');
  const iChave = bling.indexOf('nfe?limite=5&pagina=1&tipo=1&chave');
  ok(iChave > 0, 'a busca por CHAVE mantem tipo=1 (proposital)');
  ok(/tipo=1` = nota de SAIDA/.test(bling) || /`tipo=1` = nota de SAIDA/.test(bling),
     '  com o porque escrito ao lado');

  // a sonda é rota de admin, e varre os tipos para comparar
  ok(/app\.get\('\/api\/admin\/nfs-devolucao'/.test(srv),
     'a sonda de diagnostico existe (varre os tipos pra comparar)');
}

// ── e a natureza filtra compra de fornecedor ────────────────────────
//
// ⚠️ Tipo=0 traz TAMBÉM compra de fornecedor. Sem o filtro de natureza, uma
// entrada da Amazon com número de pedido diria "já tem NF de devolução" para
// uma venda que ainda precisa da nota.
{
  ok(/naturezasDevolucaoIds/.test(srv),
     '⚠️ o indice filtra por NATUREZA (tipo=0 traz compra de fornecedor tambem)');
  ok(/naturezas_ignoradas/.test(srv),
     '  e expoe o que ficou de fora, pra descobrir natureza nova');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
