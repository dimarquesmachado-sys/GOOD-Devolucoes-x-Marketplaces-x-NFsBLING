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
//
// ⚠️ revisão Codex (PR #289): os 6 apontamentos eram a mesma causa — checar
// se uma frase existe "em algum lugar do arquivo" em vez de checar a peça
// que realmente alimenta o comportamento (identidade da empresa, a variável
// usada na URL, o predicado que filtra, o campo que a rota devolve). Os
// blocos abaixo recortam o trecho certo com `entreMarcadores` pra isso.

const fs = require('fs');
const path = require('path');
const { entreMarcadores } = require('./_recorte');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const registro = fs.readFileSync(path.join(RAIZ, 'lib', 'empresas.js'), 'utf8');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');

// ── ⚠️ o padrão é '0' (entrada) nas duas empresas ───────────────────
//
// Codex: contar linhas que batem `/nfEntradaTipo:/` não provava QUAL
// empresa tinha o padrão certo — duas declarações boas da GOOD (e nenhuma
// da AMBTOTAL) também batiam na contagem `>= 2`. Agora cada empresa é
// checada pelo próprio nome dentro do `fis(EMPRESAS.<empresa>, ...)`.
{
  ok(registro.includes("fis(EMPRESAS.good, 'NF_ENTRADA_TIPO', '0')"),
     "⚠️ GOOD: nfEntradaTipo() usa EMPRESAS.good com padrao '0' (ENTRADA) — tipo 1 e SAIDA, sempre");
  ok(registro.includes("fis(EMPRESAS.ambtotal, 'NF_ENTRADA_TIPO', '0')"),
     "⚠️ AMBTOTAL: nfEntradaTipo() usa EMPRESAS.ambtotal com padrao '0' (ENTRADA)");
}

// ── e o índice de devolução USA a ficha, não um número cravado ──────
//
// Codex: a versão anterior só provava que a variável `tipoEntrada` foi
// DECLARADA — nunca que ela chega na URL do Bling. Um `?tipo=1` cravado ao
// lado de uma declaração morta passaria limpo. Agora o recorte vai até a
// chamada e confere a interpolação na URL.
{
  const bloco = entreMarcadores(srv,
    "const tipoEntrada = String(FICHA_GOOD.fiscal.nfEntradaTipo() || '0');",
    'if (!r.ok) { falhaLista = true;');
  ok(bloco.includes('nfe?tipo=${tipoEntrada}&pagina=${p}'),
     'a listagem do Bling usa a variavel tipoEntrada na URL (nao um tipo cravado)');

  // ⚠️ e o filtro de NATUREZA realmente decide o que conta como devolucao —
  // Codex: `naturezasDevolucaoIds` tambem aparece no comentario da funcao,
  // entao so achar a palavra no arquivo nao provava que o predicado
  // `ehDevolucao` usa a lista pra filtrar.
  const bloco2 = entreMarcadores(srv,
    'const idsDevolucao = String(FICHA_GOOD.fiscal.naturezasDevolucaoIds()',
    "ignoradas[natId || 'sem_natureza']");
  ok(/idsDevolucao\.indexOf\(natId\)\s*>=\s*0/.test(bloco2),
     '⚠️ o indice filtra por NATUREZA (natId precisa estar em naturezasDevolucaoIds)');
  ok(/if \(!ehDevolucao\) \{/.test(bloco2),
     '  e o que nao bate vira ignorada, nao "ja tem NF"');
}

// ── ⚠️ e os `tipo=1` que sobraram são propositais ───────────────────
//
// Dois lugares ainda usam tipo=1, e os dois estão certos:
//   - /api/admin/nfs-devolucao crava tipo=1 de proposito, pra listar as
//     notas de VENDA e cruzar com devolucao ja resolvida
//   - a busca por CHAVE (lib/bling.js) precisa do 1: sem ele, a chave de
//     uma nota de entrada casava e o id ia pro cache como se fosse a venda
//
// Codex: a checagem antiga chamava /api/admin/nfs-devolucao de "a sonda que
// varre os tipos pra comparar" — mas essa rota crava tipo=1 (nao varre
// nada), e a sonda que REALMENTE varre 0-3 e outra rota,
// /api/nf/entrada/sonda. A descricao errada fazia o teste "provar" um
// comportamento que a rota apontada nem tem.
{
  const bling = fs.readFileSync(path.join(RAIZ, 'lib', 'bling.js'), 'utf8');
  const iChave = bling.indexOf('nfe?limite=5&pagina=1&tipo=1&chave');
  ok(iChave > 0, 'a busca por CHAVE mantem tipo=1 (proposital)');
  ok(/tipo=1` = nota de SAIDA/.test(bling) || /`tipo=1` = nota de SAIDA/.test(bling),
     '  com o porque escrito ao lado');

  const nfsDevolucao = entreMarcadores(srv,
    "app.get('/api/admin/nfs-devolucao'", 'if (!lista.length) break;');
  ok(/nfe\?tipo=1&pagina=\$\{p\}&limite=100/.test(nfsDevolucao),
     '/api/admin/nfs-devolucao mantem tipo=1 cravado (proposital: lista notas de VENDA)');

  const sonda = entreMarcadores(srv,
    "app.get('/api/nf/entrada/sonda'", 'Inventario das naturezas das notas de entrada');
  ok(/for \(const t of \[0, 1, 2, 3\]\)/.test(sonda),
     'a sonda de diagnostico real (/api/nf/entrada/sonda) varre os tipos 0-3 pra comparar');
}

// ── e a natureza filtra compra de fornecedor ────────────────────────
//
// ⚠️ Tipo=0 traz TAMBÉM compra de fornecedor. Sem o filtro de natureza, uma
// entrada da Amazon com número de pedido diria "já tem NF de devolução" para
// uma venda que ainda precisa da nota.
//
// Codex: procurar `naturezas_ignoradas` em QUALQUER lugar do arquivo batia
// no comentario explicativo da funcao, nao na resposta HTTP de verdade.
// Agora o recorte e o corpo da rota, e confere o campo que ela devolve.
{
  const rota = entreMarcadores(srv,
    "app.get('/api/admin/indice-nf-devolucao'", "app.get('/api/admin/nfs-devolucao'");
  ok(/naturezas_ignoradas:\s*NF_DEV_IGNORADAS/.test(rota),
     '⚠️ /api/admin/indice-nf-devolucao expoe naturezas_ignoradas (calibragem da env)');
  ok(/tipo_usado:\s*String\(FICHA_GOOD\.fiscal\.nfEntradaTipo\(\) \|\| '0'\)/.test(rota),
     "  e devolve tipo_usado com o mesmo padrao '0'");
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
