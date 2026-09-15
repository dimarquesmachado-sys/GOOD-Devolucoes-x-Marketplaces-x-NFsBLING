'use strict';
// ⚠️ P1 DA AUDITORIA — PASSO 1 DE 3: A MEDIDA ANTES DA OBRA.
//
// A auditoria diz que `app-AMB.js` é um singleton preso à AMB, e que trocar
// a string para Girassol apenas **substituiria** a AMB em vez de montar as
// duas. Este teste mede isso de forma verificável, para que os passos 2 e 3
// tenham como provar que funcionaram.
//
// 📌 Por que a medida vem primeiro: refatorar 3.098 linhas sem um teste que
// diga "agora dá" é exatamente como se perde um dia inteiro. O que se mede
// aqui é o que vai ficar verde no fim.
//
// ⚠️ Este teste NÃO falha hoje — ele DOCUMENTA o estado atual. Os números
// que ele afirma são a linha de base; quando o passo 2 encapsular o estado,
// as asserções mudam junto e o diff mostra exatamente o que avançou.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');

// ── o que JÁ é fábrica (o avanço real que existe) ───────────────────
{
  // ⚠️ (Codex, P2) - CONTAR OCORRENCIAS AGREGADAS NAO PROVA QUAIS CLIENTES.
  //
  // `comCriar >= 5` so conta quantas vezes `.criar(CFG_EMPRESA)` aparece no
  // arquivo. Se um cliente regredir pra singleton e outro for chamado 2x (ou
  // sobrar um `.criar(CFG_EMPRESA)` esquecido num comentario), a contagem
  // continua >= 5 e o teste nao percebe. Verifica os 5 clientes NOMEADOS.
  const CLIENTES_ESPERADOS = ['bling-AMB', 'ml-AMB', 'ml-returns-AMB', 'nf-nomes-AMB', 'supabase-AMB'];
  const faltando = CLIENTES_ESPERADOS.filter(
    (nome) => !new RegExp(`require\\('\\./lib-AMB/${nome}'\\)\\.criar\\(CFG_EMPRESA\\)`).test(app)
  );
  ok(faltando.length === 0,
     faltando.length === 0
       ? `5 clientes ja aceitam config por instancia (${CLIENTES_ESPERADOS.join(', ')})`
       : `⚠️ estes clientes NAO aceitam config por instancia: ${faltando.join(', ')}`);
}

// ── ⚠️ e o que AINDA trava: a empresa cravada ───────────────────────
{
  const m = /const CFG_EMPRESA = configDaEmpresa\('(\w+)'\)/.exec(app);
  ok(!!m, 'a empresa vem de `configDaEmpresa`');
  ok(m && m[1] === 'ambtotal',
     `⚠️ mas CRAVADA em '${m ? m[1] : '?'}' — trocar a string SUBSTITUI a AMB, nao monta as duas`);
}

// ── ⚠️ e o estado no escopo do módulo ───────────────────────────────
//
// Cada `let`/`Map` no topo é compartilhado por TODAS as instâncias. Com duas
// empresas no mesmo processo, o cache de uma responderia pela outra — e isso
// não dá erro, dá **dado errado**, que é pior.
{
  // ⚠️ b330.1 (Codex, P2) - ESCOPO POR PROFUNDIDADE, NAO POR INDENTACAO.
  //
  // Minha versao filtrava `/^let \w+/` — so linha na COLUNA 0. Isso trata
  // formatacao como escopo lexico, e erra dos dois lados:
  //   - um `let` DENTRO de funcao escrito na coluna 0 seria contado (falso
  //     positivo)
  //   - um estado REAL do modulo indentado escaparia da conta (falso
  //     negativo — o perigoso, porque e o que vaza entre empresas)
  //
  // Agora acompanho a profundidade de bloco e so conto o que esta em
  // profundidade 0. Ignoro chaves dentro de string, template, regex e
  // comentario (a licao do `_recorte`: contador ingenuo quebra com elas).
  const estado = [];
  {
    let prof = 0;
    let emBlocoComentario = false;
    for (const linha of app.split('\n')) {
      const t = linha.trim();

      // comentário de bloco
      if (emBlocoComentario) { if (t.includes('*/')) emBlocoComentario = false; continue; }
      if (t.startsWith('/*')) { if (!t.includes('*/')) emBlocoComentario = true; continue; }
      if (t.startsWith('//')) continue;

      // declaração de estado, só em profundidade 0
      if (prof === 0) {
        const m = /^(?:let|var) (\w+)|^const (\w+)\s*=\s*(?:new Map\(\)|new Set\(\)|\[\])/.exec(t);
        if (m) estado.push(m[1] || m[2]);
      }

      // conta chaves IGNORANDO string/template/regex/comentário de linha
      let emStr = null;
      for (let k = 0; k < linha.length; k++) {
        const c = linha[k];
        if (emStr) {
          if (c === '\\') { k++; continue; }
          if (c === emStr) emStr = null;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') { emStr = c; continue; }
        if (c === '/' && linha[k + 1] === '/') break;      // resto é comentário
        if (c === '{') prof++;
        else if (c === '}') prof--;
      }
    }
  }

  ok(estado.length > 0,
     `⚠️ ha ${estado.length} variaveis de estado no escopo do modulo`);

  // as que guardam dado de negócio são as perigosas
  const deNegocio = estado.filter((n) => /CACHE|INDICE|PENDENTES|ESPREITA|NF_DEV/i.test(n));
  ok(deNegocio.length > 0,
     `  ⚠️ ${deNegocio.length} guardam DADO DE NEGOCIO: ${deNegocio.slice(0, 5).join(', ')}`);

  // ⚠️ b330 (Codex, P2) - A LINHA DE BASE TEM QUE SER EXATA.
  //
  // Minha versao era `<= 11`, que aceita QUALQUER numero de 0 a 11 — entao
  // uma refatoracao PELA METADE (encapsular 6 das 11 e esquecer 5) passaria
  // VERDE. E meia refatoracao aqui e pior que nenhuma: as 5 que sobrassem
  // continuariam vazando entre empresas, agora sem ninguem olhando.
  //
  // 📌 Numero EXATO: qualquer mudanca — pra mais ou pra menos — faz o teste
  // falar, e quem mexeu confirma o novo valor de propósito.
  ok(estado.length === 11,
     `  📌 linha de base EXATA: ${estado.length} (esperado 11 ate o passo 2)`);
  if (estado.length !== 11) {
    console.log('     -> se o passo 2 rodou, atualize o numero aqui E confirme '
      + 'que as que sobraram sao intencionais:');
    console.log('        ' + estado.join(', '));
  }
}

// ── e o router sai pronto, não montável ─────────────────────────────
{
  ok(/module\.exports/.test(app), 'o modulo exporta algo');
  // ⚠️ b330 (Codex, P2) - RECONHECE O PADRAO DE EXPORT NOMEADO DO REPO.
  //
  // Minha versao so via `module.exports = function` e `module.exports.criar`.
  // Mas o repo usa tambem `function criarRouter(...)` + `module.exports =
  // { criarRouter }` — e com esse padrao o teste diria "ainda e router
  // pronto" DEPOIS do passo 3 ter funcionado. Falso alarme no exato momento
  // em que eu preciso confiar no teste.
  const exportaFabrica = /module\.exports\s*=\s*function/.test(app)
    || /module\.exports\.criar/.test(app)
    || /module\.exports\s*=\s*\{[^}]*\b(criar|criarApp|criarRouter|criarAppEmpresa)\b/.test(app)
    || /\bfunction (criarApp|criarRouter|criarAppEmpresa)\s*\(/.test(app);
  // 📌 LINHA DE BASE, como a contagem acima: hoje NAO e fabrica. Quando o
  // passo 3 rodar, esta asserção vira `ok(exportaFabrica, ...)` — e a
  // troca no diff e a prova de que o passo aconteceu.
  //
  // ⚠️ Provei que ela reage: acrescentei `function criarRouter` +
  // `module.exports = { criarRouter }` e o teste acusou na hora.
  ok(!exportaFabrica,
     '⚠️ e exporta um router PRONTO (nao uma fabrica) — o passo 3 muda isso');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
