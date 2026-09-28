// Roda com: node test/imports-existem.test.js
//
// A CLASSE DE BUG QUE ISTO MATA: usar um modulo que ninguem importou.
//
// Aconteceu TRES vezes neste repo, e as tres passaram despercebidas porque
// um try/catch em volta transformava o ReferenceError em "erro do
// marketplace":
//
//   1. `buscarNFnoBlingPorOrderId` na AMB (b172 marcou como "bug latente")
//   2. `buscarPedidoBlingPorId` na AMB, fase 2 da blindada
//   3. `magaluCancelados` na GOOD — o Magalu NUNCA apareceu no card de
//      estornadas, e o erro parecia da ponte deles
//
// O terceiro so foi descoberto porque o dono abriu a rota crua e mandou o
// JSON: `"magalu_erro": "magaluCancelados is not defined"`.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// os modulos que as rotas usam, e onde cada um tem que estar importado
const ESPERADOS = [
  ['server.js', 'magaluCancelados', "require('./lib/magalu-cancelados')"],
  ['server.js', 'marcadores', "require('./lib/marcadores-estornada')"],
  ['server.js', 'devParcial', "require('./lib/devolucao-parcial')"],
  ['amb-devolucoes/app-AMB.js', 'magaluCancelados', "require('../lib/magalu-cancelados')"],
  ['amb-devolucoes/app-AMB.js', 'marcadores', "require('../lib/marcadores-estornada')"],
];

for (const [rel, nome, req] of ESPERADOS) {
  const s = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  const temRequire = s.indexOf('const ' + nome + ' = ' + req) !== -1
    || new RegExp('const ' + nome + '\\s*=\\s*require').test(s);
  ok(temRequire, rel.split('/').pop() + ': `' + nome + '` esta importado');
}

// b221.1: a GOOD reexporta do blingClient UMA A UMA — e foi por esse padrao
// que a QUARTA funcao fantasma passou: chamei `buscarNFPelaChave` no
// server.js sem a linha `const buscarNFPelaChave = blingClient.buscarNFPelaChave`.
// Este teste original so olhava `require`, entao nao pegou.
{
  const s = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const bling = require(path.join(RAIZ, 'lib', 'bling.js'));
  const declarados = new Set(
    [...s.matchAll(/(?:const|let|var|function)\s+(\w+)/g)].map((m) => m[1])
  );
  // toda funcao que o bling exporta E que o server chama, tem que estar reexportada
  const faltam = Object.keys(bling)
    .filter((f) => typeof bling[f] === 'function')
    .filter((f) => new RegExp('\\b' + f + '\\(').test(s))          // e chamada
    .filter((f) => !new RegExp('blingClient\\.' + f + '\\(').test(s)) // nao pelo objeto
    .filter((f) => !declarados.has(f));                                  // e nao esta reexportada
  ok(faltam.length === 0,
     'server.js: toda funcao do blingClient que ele chama esta reexportada'
     + (faltam.length ? ' (FALTAM: ' + faltam.join(', ') + ')' : ''));
}

// b231.1: modulos NATIVOS do Node usados sem require (fs, path, crypto,
// http, os, url). O /health do b231 usava `fs.readFileSync` sem `require('fs')`
// — o catch engolia o ReferenceError e o hash saia 'n/d' pra sempre. O
// grep de `fs` veio vazio e eu segui.
{
  for (const [nome, rel] of [['server.js', 'server.js'], ['app-AMB.js', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const faltam = [];
    for (const mod of ['fs', 'path', 'crypto', 'http', 'https', 'os', 'url', 'zlib']) {
      const usa = new RegExp('(^|[^\\w.$])' + mod + '\\.\\w+\\(', 'm').test(src);
      const tem = new RegExp('(const|let|var)\\s+' + mod + '\\s*=\\s*require\\(', 'm').test(src)
        || new RegExp('require\\([\'"]' + mod + '[\'"]\\)\\.\\w+', 'm').test(src);   // inline
      if (usa && !tem) faltam.push(mod);
    }
    ok(faltam.length === 0,
       nome + ': todo modulo nativo usado esta importado'
       + (faltam.length ? ' (FALTAM: ' + faltam.join(', ') + ')' : ''));
  }
}

// e a varredura geral: chamada de metodo tipico de modulo, sem declaracao
for (const rel of ['server.js', 'amb-devolucoes/app-AMB.js']) {
  const s = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  const declarados = new Set(
    [...s.matchAll(/(?:const|let|var|function)\s+(\w+)/g)].map((m) => m[1])
  );
  const orfaos = [...new Set(
    [...s.matchAll(/\b([a-z][a-zA-Z]{3,})\.(buscar|listar|montar|enriquecer|resumo|anotar|coletar)\b/g)]
      .map((m) => m[1])
      .filter((n) => !declarados.has(n))
  )];
  ok(orfaos.length === 0,
     rel.split('/').pop() + ': nenhum modulo usado sem import'
     + (orfaos.length ? ' (achei: ' + orfaos.join(', ') + ')' : ''));
}

// ── ⚠️ b431: TODO `require` RELATIVO TEM QUE RESOLVER ───────────────
//
// Escrevi `require('../../lib/ids-fiscais-auto')` de dentro de
// `amb-devolucoes/app-AMB.js`, quando o certo é `../lib/`. O arquivo subiu,
// o boot passou e a rota morreu em produção com "Cannot find module".
//
// 📌 POR QUE NADA PEGOU: o require estava DENTRO da função da rota. `node
// --check` só olha sintaxe; o boot real nunca executa aquela linha; e este
// teste conferia só se o módulo estava DECLARADO, não se o caminho existe.
//
// ⚠️ Require dentro de função é código que só roda quando alguém clica — e
// "só quando alguém clica" é onde o erro aparece primeiro pro dono, não pra
// mim. Agora o caminho é resolvido em disco, esteja ele onde estiver.
{
  const fs2 = require('fs');
  const path2 = require('path');
  const quebrados = [];

  // ⚠️ varre o repo INTEIRO, não só os 2 arquivos que o resto do teste olha:
  // o caminho quebrado pode estar em qualquer módulo, e foi num que o bloco
  // acima nem visitava.
  const varrer = (dir, acc = []) => {
    for (const nome of fs2.readdirSync(dir)) {
      if (nome === 'node_modules' || nome === '.git' || nome === 'data') continue;
      // ⚠️ b431 - `lib-AMB/` NA RAIZ É CÓPIA ÓRFÃ (achada por esta varredura,
      // 24/09). Ninguém a carrega: o app usa `amb-devolucoes/lib-AMB/`. Ela
      // entrou em 17/09, provavelmente por upload na pasta errada — o mesmo
      // acidente que já derrubou o serviço inteiro em 23/07.
      //
      // 📌 Pulo em vez de acusar: os caminhos dela quebram de verdade, mas
      // acusar aqui esconderia um require quebrado REAL no meio do ruído.
      // Apagar é decisão do dono — está anotado pra ele decidir.
      if (dir === RAIZ && nome === 'lib-AMB') continue;
      const cheio = path2.join(dir, nome);
      const st = fs2.statSync(cheio);
      if (st.isDirectory()) varrer(cheio, acc);
      else if (nome.endsWith('.js')) acc.push(cheio);
    }
    return acc;
  };

  for (const abs of varrer(RAIZ)) {
    const rel = path2.relative(RAIZ, abs);
    // ⚠️ os testes montam caminho relativo à RAIZ pra rodar outro processo
    // (`node ./amb-devolucoes/app-AMB`), não pra importar. Medir isso como
    // import acusaria o que está certo — e teste que acusa o certo ensina a
    // ignorar o vermelho.
    if (rel.startsWith('test/')) continue;
    let src = '';
    try { src = fs2.readFileSync(abs, 'utf8'); } catch (e) { continue; }
    // ⚠️ tira comentário ANTES de varrer: os arquivos daqui citam caminhos em
    // texto explicativo ("require('./lib-AMB/auth-AMB')" numa nota), e medir
    // em cima de comentário mede ficção — já me custou uma rodada hoje.
    src = src.split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      // ⚠️ e fora as linhas que IMPRIMEM um require (os scripts mostram ao
      // dono o comando que ele deve rodar). Ali o caminho é relativo à RAIZ,
      // não ao arquivo — medir isso como import acusa o que está certo.
      .filter((l) => !/console\.log\(/.test(l))
      .join('\n');
    const dir = path2.dirname(abs);

    for (const m of src.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const alvo = m[1];
      const base = path2.resolve(dir, alvo);
      // ⚠️ `fs.existsSync(base)` sozinho aceita um DIRETORIO sem `index.js`
      // nem `package.json` com `main` — o Node recusa esse require em
      // tempo de execucao, mas o existsSync dava "existe" so por a pasta
      // estar la. `require.resolve` usa a MESMA resolucao do Node de
      // verdade, entao pega esse caso (apontamento do Codex no #373).
      let existe = true;
      try { require.resolve(base); } catch (e) { existe = false; }
      if (!existe) quebrados.push(`${rel} -> ${alvo}`);
    }
  }

  ok(quebrados.length === 0,
     '⚠️ todo `require` relativo resolve em disco'
     + (quebrados.length ? ' (quebrados: ' + quebrados.slice(0, 4).join(' | ') + ')' : ''));
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
