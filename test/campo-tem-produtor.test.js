// Roda com: node test/campo-tem-produtor.test.js
//
// A CLASSE DE BUG: ler um campo que NINGUÉM produz.
//
// É o erro que mais repeti — umas dez vezes só em 03-04/09:
//   `ESP_CACHE.itens`      → o produtor devolve `em_transito`/`nunca_bipadas`
//   `nfNomes.estado()`     → o módulo exporta `statusIndice`
//   `achado.order_id`      → null quando o claim é de pack
//   `r.entregues` na AMB   → `atrasadas_30d` é número, não lista
//
// Todos passam no `node --check` e no boot: o campo vira `undefined` e o
// código segue em silêncio. Só aparece na tela do estoquista, vazia.
//
// Este teste pega o caso concreto e verificável: campo lido do resultado de
// uma função conhecida, sem que essa função o produza.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');

/** O corpo de uma função declarada no topo do arquivo. */
function corpoDaFuncao(src, nome) {
  const linhas = src.split('\n');
  const i = linhas.findIndex((l) => new RegExp('^(async )?function ' + nome + '\\b').test(l));
  if (i < 0) return null;
  let fim = linhas.length;
  for (let k = i + 1; k < linhas.length; k++) {
    if (/^(async )?function |^module\.exports|^const [A-Z_]+ =/.test(linhas[k])) { fim = k; break; }
  }
  return linhas.slice(i, fim).join('\n');
}

// ── o enriquecimento da espreita: quem lê `en.X` precisa de `out.X` ──
{
  const enr = corpoDaFuncao(SRC, 'enriquecerItemEspreita');
  ok(!!enr, 'achei enriquecerItemEspreita');

  // idem: `out` tambem e montado como objeto literal no inicio da funcao,
  // entao os campos declarados la nao aparecem como `out.X =`
  const produz = new Set([...enr.matchAll(/out\.(\w+)\s*=/g)].map((m) => m[1]));
  const decl = /const out = \{([\s\S]*?)\};/.exec(enr);
  if (decl) {
    for (const peca of decl[1].split(',')) {
      const nome = peca.split(':')[0].trim();
      if (/^\w+$/.test(nome)) produz.add(nome);
    }
  }
  const resto = SRC.replace(enr, '');
  const lidos = new Set([...resto.matchAll(/\ben\??\.(\w+)/g)].map((m) => m[1]));

  const orfaos = [...lidos].filter((c) => !produz.has(c));
  ok(orfaos.length === 0,
     'todo campo lido de `en.` é produzido pelo enriquecedor'
     + (orfaos.length ? ' (INEXISTENTES: ' + orfaos.join(', ') + ')' : ' (' + lidos.size + ' conferidos)'));
}

// ── o cache da espreita: os campos que o server lê dele ──────────────
{
  const monta = corpoDaFuncao(SRC, 'montarEspreita');
  ok(!!monta, 'achei montarEspreita');

  // o que montarEspreita devolve no objeto final
  const iRet = monta.lastIndexOf('return ({');
  const retorno = monta.slice(iRet, monta.indexOf('});', iRet));
  const devolve = new Set([...retorno.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]));

  // o que alguém lê de ESP_CACHE / cacheEsp
  const lidosCache = new Set(
    [...SRC.matchAll(/(?:ESP_CACHE|cacheEsp)\??\.(\w+)/g)].map((m) => m[1])
  );

  const naoDevolvidos = [...lidosCache].filter((c) => !devolve.has(c));
  ok(naoDevolvidos.length === 0,
     'todo campo lido do cache da espreita é devolvido por montarEspreita'
     + (naoDevolvidos.length ? ' (INEXISTENTES: ' + naoDevolvidos.join(', ') + ')' : ''));
}

// ── funções chamadas em módulos: existem no que o módulo exporta? ────
{
  const modulos = [
    ['nfNomes', 'lib/nf-nomes.js'],
    ['mlReturns', 'lib/ml-returns.js'],
    ['vinculoCache', 'lib/vinculo-nf-cache.js'],
    ['ritmoBling', 'lib/ritmo-bling.js'],
  ];
  for (const [alias, rel] of modulos) {
    const caminho = path.join(RAIZ, rel);
    if (!fs.existsSync(caminho)) continue;
    const mod = fs.readFileSync(caminho, 'utf8');

    // o que o módulo exporta (objeto literal no return ou no module.exports)
    const exporta = new Set();
    // ⚠️ o ULTIMO item do objeto nao tem virgula depois — meu detector
    // pedia `[,:}\n]` e perdia `colapsar` e `resumoEspreita`, acusando
    // funcoes que EXISTEM. Falso positivo e pior que nenhum teste: ensina
    // a ignorar o vermelho. Agora separo por virgula e limpo cada peca.
    for (const m of mod.matchAll(/(?:module\.exports\s*=\s*\{|return\s*\{)([^}]*)\}/g)) {
      for (const peca of m[1].split(',')) {
        const nome = peca.split(':')[0].trim().replace(/\/\/.*$/, '').trim();
        if (/^\w+$/.test(nome)) exporta.add(nome);
      }
    }
    for (const m of mod.matchAll(/module\.exports\.(\w+)\s*=/g)) exporta.add(m[1]);

    const usados = new Set([...SRC.matchAll(new RegExp('\\b' + alias + '\\.(\\w+)\\s*\\(', 'g'))].map((m) => m[1]));
    const fantasmas = [...usados].filter((f) => !exporta.has(f));
    ok(fantasmas.length === 0,
       alias + ': toda função chamada existe no módulo'
       + (fantasmas.length ? ' (FANTASMAS: ' + fantasmas.join(', ') + ')' : ' (' + usados.size + ' conferidas)'));
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
