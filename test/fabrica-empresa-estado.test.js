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

// ⚠️ b330.1 (Codex, P2) - ESCOPO POR PROFUNDIDADE, NAO POR INDENTACAO.
//
// Um filtro `/^let \w+/` trata COLUNA 0 como escopo lexico, e erra dos dois
// lados: um `let` DENTRO de funcao escrito na coluna 0 seria contado (falso
// positivo), e um estado REAL do modulo indentado escaparia da conta (falso
// negativo — o perigoso, porque e o que vaza entre empresas sem o teste ver).
//
// Esta funcao acompanha a profundidade de bloco e so conta o que esta em
// profundidade 0, ignorando chaves dentro de string, template e comentario
// (a licao do `_recorte`: contador ingenuo quebra com elas). Usada tanto
// para app-AMB.js quanto para os singletons que ele requer, pra nao duplicar
// a mesma logica com regras diferentes.
function contarEstadoDoModulo(src) {
  const estado = [];
  let prof = 0;
  let emBlocoComentario = false;
  for (const linha of src.split('\n')) {
    const t = linha.trim();

    // comentário de bloco
    if (emBlocoComentario) { if (t.includes('*/')) emBlocoComentario = false; continue; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) emBlocoComentario = true; continue; }
    if (t.startsWith('//')) continue;

    // declaração de estado, só em profundidade 0
    if (prof === 0) {
      // ⚠️ b330.2 (Codex, P2) - CONTA TAMBEM ESTADO EM OBJETO.
      //
      // O PASSO 2 vai consolidar as 11 num objeto:
      //   const ESTADO = { pendentes: new Map(), cache: null };
      //
      // Isso nao caía em nenhum padrao anterior — o teste diria "0
      // variaveis de estado", VERDE, com o vazamento INTACTO. Seria inutil
      // justo no passo que ele existe pra vigiar.
      //
      // 📌 O que importa nao e a FORMA da declaracao: um `const` de objeto
      // mutavel no escopo do modulo vaza entre instancias igual a um `let`.
      // ⚠️ b343 - CONTA TAMBEM `const X = criarAlgo()`.
      //
      // A gaveta 1 virou `const NF_DEV = criarGavetaNfDev()` — uma CHAMADA
      // que devolve objeto. Nao casava em nenhum padrao: o teste contava 3
      // quando o real era 4.
      //
      // ⚠️ E esse e JUSTAMENTE o formato que o passo 3 vai usar em TODAS as
      // gavetas. O teste ficaria cego no passo que existe pra vigiar.
      const m = /^(?:let|var) (\w+)/.exec(t)
        || /^const (\w+)\s*=\s*(?:new Map\(\)|new Set\(\)|\[\]|\{)/.exec(t)
        // 📌 SO `criarGaveta*`, nao `criar*` em geral: `criarNfPessoa(...)`,
        // `criarAdminHelpers(...)` e `criarMlBuscas(...)` sao CLIENTES ja
        // parametrizados — recebem config e nao guardam estado da empresa.
        // Conta-los inflaria o placar com o que ja esta resolvido, e o numero
        // deixaria de significar "quanto falta".
        || /^const (\w+)\s*=\s*criarGaveta\w*\(/.exec(t);
      if (m) estado.push(m[1]);
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
  return estado;
}

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

  // ⚠️ (Codex, P2, 3a rodada) - CFG_EMPRESA NAO E A UNICA FONTE CRAVADA.
  //
  // `config-AMB.js` e um arquivo SO da AMB (nome e conteudo), e `FICHA_AMB`
  // vem de `obterEmpresa('ambtotal')` tambem cravado — usado direto em
  // rotas fiscais (naturezasDevolucaoIds, nfEntradaTipo) e em `envAmb()`
  // espalhado pelo arquivo. Um passo 2/3 que so trocasse CFG_EMPRESA de
  // parametro deixaria estas duas fontes ainda respondendo pela AMB.
  ok(/require\('\.\/config-AMB'\)/.test(app),
     'tambem importa config-AMB.js — arquivo SO da AMB, ja cravado no nome');
  const mFicha = /const FICHA_AMB = obterEmpresa\('(\w+)'\)/.exec(app);
  ok(mFicha && mFicha[1] === 'ambtotal',
     `⚠️ e FICHA_AMB tambem CRAVADA em '${mFicha ? mFicha[1] : '?'}' via obterEmpresa — usada em rotas fiscais e em envAmb()`);
}

// ── ⚠️ e o estado no escopo do módulo ───────────────────────────────
//
// Cada `let`/`Map` no topo é compartilhado por TODAS as instâncias. Com duas
// empresas no mesmo processo, o cache de uma responderia pela outra — e isso
// não dá erro, dá **dado errado**, que é pior.
{
  const estado = contarEstadoDoModulo(app);

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
  // ⚠️ b342 - PASSO 2, GAVETA 1 de 3: 11 -> 5.
  //
  // As 6 do indice de notas de devolucao viraram campos de `NF_DEV`, criado
  // por `criarGavetaNfDev()`. Hoje ha uma instancia so e o comportamento e
  // identico; quando o passo 3 montar a segunda empresa, cada uma tera a
  // sua.
  //
  // 📌 Este numero e o placar da obra. Restam 5 no app-AMB:
  //    usosQuerystringAMB, PENDENTES, LOGIN_FALHAS, ESPREITA_AMB_CACHE,
  //    NF_NAT_CACHE_AMB
  // ⚠️ b343 - PASSO 2 COMPLETO no app-AMB: 11 -> 3.
  //
  // As 11 variaveis soltas viraram 3 GAVETAS por assunto:
  //   NF_DEV   o indice de notas de devolucao (6 variaveis)
  //   ACESSO   chave na URL + falhas de login (2)
  //   CACHES   espreita + naturezas da NF     (2)
  //   TRIAGEM  pedidos em triagem             (1)
  //
  // 📌 SAO 4 OBJETOS, E O TESTE CONTA 3 + o NF_DEV que ja estava — todos
  // AINDA no escopo do modulo. Isso e proposital: o passo 2 AGRUPA, o passo
  // 3 e que os cria por instancia.
  //
  // ⚠️ O ganho ja e real: eram 11 pontos a mudar no passo 3, agora sao 4.
  // E cada gaveta tem um nome que diz o que vaza se for esquecida.
  ok(estado.length === 4,
     `  📌 linha de base EXATA: ${estado.length} (4 gavetas apos o passo 2)`);
  if (estado.length !== 11) {
    console.log('     -> se o passo 2 rodou, atualize o numero aqui E confirme '
      + 'que as que sobraram sao intencionais:');
    console.log('        ' + estado.join(', '));
  }
}

// ── ⚠️ e os singletons que app-AMB.js REQUER tambem guardam estado ─────
//
// ⚠️ (Codex, P2) - O TESTE SO AUDITAVA app-AMB.js, IGNORANDO OS PROPRIOS
// SINGLETONS QUE ELE REQUER.
//
// auth-AMB.js guarda o mapa de sessao (`sessoes`); shopee-AMB.js e
// magalu-AMB.js guardam cache, credenciais e token — e os tres sao
// exigidos DIRETO (sem `.criar(CFG_EMPRESA)`). Com duas empresas no
// mesmo processo, ESSE estado tambem vaza entre elas: os passos 2 e 3
// tem que converter esses modulos tambem, nao so app-AMB.js.
//
// ⚠️ (Codex, P2, 3a rodada) - OS TRES NAO ERAM EXAUSTIVOS.
//
// app-AMB.js exige 13 modulos DIRETO (sem `.criar`). Os tres acima foram
// os primeiros lidos; auditando os outros 10 um a um:
//   - ml-motivo-AMB (CTX), impressao-AMB (fila, ultimoPollEstacao),
//     nf-entrada-AMB (IDX, construindo), compat-AMB (5 caches de imagem/
//     formato/SKU/kit) e email-AMB (mailer, motivoDesligado — o
//     transportador de e-mail fica em cache OUTRA empresa herdaria)
//     guardam estado real e entram na lista abaixo.
//   - marketplace-AMB tem `NOMES`, mas e uma tabela ESTATICA de
//     rotulo (ml -> "Mercado Livre"), igual pras duas empresas — nao e
//     dado de negocio que vaza, entao fica de fora.
//   - admin-helpers-AMB, rotas-admin-AMB, identificar-AMB e
//     defeitos-ciclo-AMB sao fabricas SEM estado proprio (recebem tudo
//     por injecao): medidos, deram 0 — classifica-los como "singleton
//     perigoso" seria a mesma falsa precisao que este teste existe pra
//     evitar.
//
// 📌 Com isso os 13 modulos exigidos direto foram todos auditados; nao
// sobra mais nenhum "resto" para os passos 2/3 descobrirem depois.
{
  const SINGLETONS_REQUERIDOS = [
    'auth-AMB', 'shopee-AMB', 'magalu-AMB',
    'ml-motivo-AMB', 'impressao-AMB', 'nf-entrada-AMB', 'compat-AMB', 'email-AMB',
  ];
  let totalSingletons = 0;
  const porArquivo = [];
  for (const nome of SINGLETONS_REQUERIDOS) {
    const exigidoDireto = new RegExp(`require\\('\\./lib-AMB/${nome}'\\)(?!\\.criar)`).test(app);
    ok(exigidoDireto, `${nome} ainda e exigido direto (singleton), nao .criar(CFG_EMPRESA)`);

    const src = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', `${nome}.js`), 'utf8');
    const estadoSingleton = contarEstadoDoModulo(src);
    totalSingletons += estadoSingleton.length;
    porArquivo.push(`${nome}=${estadoSingleton.length}(${estadoSingleton.join(',')})`);
  }
  // ⚠️ b330.2: era 12 e virou 16 porque a contagem passou a incluir estado
  // em OBJETO (`const X = { ... }`) — que vaza igual a um `let`. As 4 novas
  // sempre estiveram la; eu e que nao as via.
  //
  // ⚠️ (Codex, P2, 3a rodada): 16 virou 30 porque a LISTA de modulos cresceu
  // de 3 para 8 (ver comentario acima) — nao a medida em si.
  //
  // 📌 O numero subir ao MELHORAR a medida ou a lista e o esperado: a linha
  // de base tem que refletir o que existe, nao o que eu conseguia enxergar.
  // ⚠️ b344 - 31 -> 30: o `auth-AMB` virou fabrica.
  //
  // Era o de MAIOR DANO: nao so o mapa de `sessoes` compartilhado, mas o
  // NOME DO COOKIE, o CAMINHO e as ENVS cravados na AMB. Mesmo cookie no
  // mesmo dominio = o navegador manda UM so: quem entrasse na Girassol
  // derrubaria a sessao da AMB, ou entraria com ela.
  //
  // 📌 O que sobrou (`PADRAO`) e uma TABELA DE VALORES FIXOS — provei que
  // ninguem escreve nela (0 atribuicoes). Nao vaza, como o `NOMES` do
  // marketplace-AMB.
  // ⚠️ b345 - 30 -> 26: o `magalu-AMB` agrupou em 3 gavetas.
  //
  // O caso mais grave dos 30 estava aqui: ACCESS/REFRESH/TENANT no escopo
  // do modulo. Com duas empresas, uma faria requisicao ao Magalu com a
  // CREDENCIAL DA OUTRA — e o marketplace nao tem como saber: responderia
  // com os dados da conta errada.
  //
  // ⚠️ E a renovacao piora: o refresh do Magalu e de USO UNICO. Duas
  // empresas renovando o mesmo token invalidam uma a outra em corrida.
  ok(totalSingletons === 26,
     `📌 linha de base EXATA dos singletons requeridos: ${totalSingletons} variaveis tambem vazam entre empresas — ${porArquivo.join('; ')}`);
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
  // ⚠️ (Codex, P2) - A ALTERNATIVA ANTERIOR ERRAVA PRO OUTRO LADO.
  //
  // `/\bfunction (criarApp|criarRouter|criarAppEmpresa)\s*\(/` so via se a
  // FUNCAO EXISTIA no arquivo — nao se ela era o que o modulo EXPORTA. Um
  // `function criarRouter(...)` interno, com o arquivo ainda terminando em
  // `module.exports = router` (o singleton pronto), passaria como "ja e
  // fabrica" sem ser. Agora exige que o IDENTIFICADOR seja atribuido a
  // `module.exports` (direto ou dentro do objeto acima).
  const exportaFabrica = /module\.exports\s*=\s*function/.test(app)
    || /module\.exports\.criar/.test(app)
    || /module\.exports\s*=\s*\{[^}]*\b(criar|criarApp|criarRouter|criarAppEmpresa)\b/.test(app)
    || /module\.exports\s*=\s*(criarApp|criarRouter|criarAppEmpresa)\s*;/.test(app);
  // 📌 LINHA DE BASE, como a contagem acima: hoje NAO e fabrica. Quando o
  // passo 3 rodar, esta asserção vira `ok(exportaFabrica, ...)` — e a
  // troca no diff e a prova de que o passo aconteceu.
  //
  // ⚠️ Provei que ela reage: acrescentei `function criarRouter` +
  // `module.exports = { criarRouter }` e o teste acusou na hora.
  ok(!exportaFabrica,
     '⚠️ e exporta um router PRONTO (nao uma fabrica) — o passo 3 muda isso');
}

// ── ⚠️ e o proprio `router` fica pronto no escopo do modulo ─────────
//
// ⚠️ (Codex, P2, 3a rodada) - `exportaFabrica` E SO NOME, NAO PROVA
// INDEPENDENCIA.
//
// Um passo 3 poderia trocar so o EXPORT (`function criarRouter(){ return
// router; }` + `module.exports = { criarRouter }`) sem tirar `const router
// = express.Router()` do topo do arquivo. `exportaFabrica` viraria `true`
// — mas as duas empresas ainda chamariam a "fabrica" e receberiam a MESMA
// instancia, com o MESMO estado por baixo. Isso nao apareceria em nenhuma
// asserção anterior, porque `contarEstadoDoModulo` nao reconhece
// `express.Router()`/`express()` como criação de estado (de proposito,
// pra nao mexer na linha de base de 11 ja revisada).
//
// 📌 Por isso este e um check SEPARADO: hoje `router` E de modulo (a causa
// raiz do problema todo). Quando o passo 3 mover a criação do router para
// DENTRO da fabrica, este regex para de casar e a asserção abaixo vira
// `ok(!routerNoEscopoDoModulo, ...)` — a fabrica so prova que criou
// instancias novas se este check tambem passar.
{
  const routerNoEscopoDoModulo = /^const \w+\s*=\s*express\.Router\(\)/m.test(app);
  ok(routerNoEscopoDoModulo,
     '⚠️ `router` ainda e criado UMA VEZ no escopo do modulo — o passo 3 tem que criar um por chamada da fabrica, senao duas empresas dividem a MESMA instancia mesmo com `exportaFabrica === true`');
}

// ── ⚠️ e o bootstrap em server.js so monta UMA empresa, cravada ─────
//
// ⚠️ (Codex, P2, 3a rodada) - ESTE TESTE NUNCA OLHOU PRA server.js.
//
// Os passos 2 e 3 podem converter app-AMB.js inteiro em fabrica e este
// arquivo de teste continuaria verde do mesmo jeito, porque nenhuma
// asserção acima executa ou inspeciona server.js. Mas e ELE quem decide
// quantas empresas sobem: hoje monta app-AMB.js uma unica vez, na rota
// fixa `/amb`. Ativar a Girassol so no registro (`lib/empresas.js`) nao
// exporia `/girassol` enquanto este bootstrap nao mudar tambem.
//
// 📌 LINHA DE BASE: hoje o bootstrap e fixo. Quando o passo 3 trocar isto
// por uma iteração sobre as empresas ativas do registro, este regex exato
// para de casar e a asserção evidencia que o bootstrap tambem mudou — nao
// so app-AMB.js.
{
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const montaSoAmbFixo = /app\.use\('\/amb',\s*require\('\.\/amb-devolucoes\/app-AMB'\)\)/.test(srv);
  ok(montaSoAmbFixo,
     '⚠️ server.js monta app-AMB.js uma unica vez em `/amb`, CRAVADO — nao itera as empresas ativas do registro; ativar Girassol sozinho no registro nao expoe `/girassol`');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
