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
      // ⚠️ (Codex, P2) - `criarEstado*` E FABRICA DE ESTADO, IGUAL A
      // `criarGaveta*`. O `magalu-AMB` criou `criarEstadoMagalu()` pra gerar
      // a instancia de `EST_MAGALU` (que guarda os TOKENS) — nome diferente,
      // mesmo formato perigoso. Sem este padrao o contador via 0 ali: a
      // gaveta mais sensivel do modulo ficava invisivel bem no passo que
      // existe pra vigia-la.
      const m = /^(?:let|var) (\w+)/.exec(t)
        || /^const (\w+)\s*=\s*(?:new Map\(\)|new Set\(\)|\[\]|\{)/.exec(t)
        // 📌 SO `criarGaveta*`/`criarEstado*`, nao `criar*` em geral:
        // `criarNfPessoa(...)`, `criarAdminHelpers(...)` e `criarMlBuscas(...)`
        // sao CLIENTES ja parametrizados — recebem config e nao guardam
        // estado da empresa. Conta-los inflaria o placar com o que ja esta
        // resolvido, e o numero deixaria de significar "quanto falta".
        || /^const (\w+)\s*=\s*(?:criarGaveta|criarEstado)\w*\(/.exec(t);
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

// ── ⚠️ PASSO 3, FATIA 4: a empresa SAIU de dentro do código ─────────
//
// Este bloco guardava que a empresa ESTAVA cravada em 'ambtotal' — era a
// linha de base do passo 1, e servia para medir o que faltava.
//
// ⚠️ Agora ela vem de env, então guardar o contrário seria PROTEGER O
// PROBLEMA: o teste ficaria vermelho justo quando o trabalho foi feito.
//
// 📌 Eram DOIS pontos cravados (o Codex apontou o segundo na 3ª rodada do
// passo 1): `CFG_EMPRESA` e `FICHA_AMB` — esta usada direto em rotas
// fiscais. Os dois saem da MESMA chave agora.
{
  ok(/empresaAlvo \|\| process\.env\.DEVOLUCOES_EMPRESA \|\| 'ambtotal'/.test(app),
     '⚠️ a empresa vem do ARGUMENTO da fabrica, com a env de padrao');
  ok(/configDaEmpresa\(EMPRESA_DESTE_APP\)/.test(app),
     '  a config usa essa chave');
  ok(/obterEmpresa\(EMPRESA_DESTE_APP\)/.test(app),
     '  ⚠️ e a FICHA tambem (era o 2o ponto, das rotas fiscais)');

  // ⚠️ sem comentários: o texto que EXPLICA a mudança cita o formato velho
  const semComent = app.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(!/configDaEmpresa\('ambtotal'\)/.test(semComent)
     && !/obterEmpresa\('ambtotal'\)/.test(semComent),
     '  e nenhum dos dois esta cravado no CODIGO');
}

// ── ⚠️ e o estado no escopo do módulo ───────────────────────────────
//
// Cada `let`/`Map` no topo é compartilhado por TODAS as instâncias. Com duas
// empresas no mesmo processo, o cache de uma responderia pela outra — e isso
// não dá erro, dá **dado errado**, que é pior.
{
  const estado = contarEstadoDoModulo(app);

  ok(estado.length === 0,
     `⚠️ ha ${estado.length} variaveis de estado no escopo do modulo (0 = passo 3 feito)`);

  // as que guardam dado de negócio são as perigosas
  // ⚠️ b353: esta checagem media quantas variaveis SOLTAS guardavam dado de
  // negocio — fazia sentido quando eram 11 com nomes como NF_DEV_INDICE_AMB.
  // Agora ha UMA (`GAVETAS`), e ela guarda TODAS. Contar por nome viraria
  // falso negativo: 0 nao significa "nao ha dado de negocio", significa que o
  // nome mudou.
  // ⚠️ b358: o `GAVETAS` esta DENTRO da fabrica agora — procura-lo aqui
  // seria guardar o estado anterior.
  ok(!estado.includes('GAVETAS'),
     '⚠️ e o GAVETAS saiu do escopo do modulo (esta dentro da fabrica)');

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
  // ⚠️ b353 - PASSO 3, FATIA 1: 4 -> 1.
  //
  // As 4 gavetas saiam de 4 declaracoes; agora vem de `criarGavetasDaEmpresa()`
  // e sobra UM ponto no escopo do modulo: o `GAVETAS`.
  //
  // 📌 E esse 1 e exatamente o que o resto do passo 3 vai mover pra dentro da
  // fabrica do router. De 41 pontos espalhados pra 1 — e ele tem nome.
  // ⚠️ b358 - PASSO 3 COMPLETO: ZERO e o OBJETIVO.
  //
  // Este numero mediu o que FALTAVA o caminho inteiro: 11 -> 4 -> 1 -> 0.
  // Todo o estado mudou pra dentro de `criarAppEmpresa`, entao nao ha mais
  // nada no escopo do modulo.
  ok(estado.length === 0,
     `⚠️ ZERO estado no escopo do modulo (achei ${estado.length}: ${estado.join(', ')})`);
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
// ⚠️ (Codex, P2) - `auth-AMB` FICOU NA LISTA DEPOIS DE JA CONVERTIDO (b360).
//
// O regex abaixo (`require('./lib-AMB/${nome}')(?!\.criar)`) roda no
// FONTE CRU, sem tirar comentario. O bloco que explica o b360 em
// app-AMB.js cita, em texto, `require('./lib-AMB/auth-AMB')` sem `.criar`
// — e isso batia no regex, mantendo `exigidoDireto` verdadeiro mesmo
// depois do require REAL (linha com `.criar(CFG_EMPRESA.AUTH)`) ter
// deixado de casar. O teste ficava verde por coincidencia de comentario,
// escondendo que auth-AMB ja tinha virado fabrica.
//
// 📌 Tirei auth-AMB da lista: ele ja usa `.criar(CFG_EMPRESA.AUTH)` (ver
// asserção especifica mais abaixo, "o AUTH e por EMPRESA"), entao nao e
// mais um singleton pendente pros passos 2/3.
{
  // ⚠️ b361 - ESTA LISTA ENCOLHE A CADA MODULO CONVERTIDO.
  //
  // Ela guarda quem AINDA e instancia unica do processo. Conforme cada um
  // vira `.criar(CFG_EMPRESA)`, sai daqui e entra na lista dos convertidos
  // abaixo — que prova o contrario.
  //
  // 📌 Quando esta lista esvaziar, o freio do server.js pode sair e 2
  // empresas podem subir juntas.
  // ⚠️ b364 - A LISTA ESVAZIOU: nenhum dos modulos de estado e mais
  // instancia unica do processo.
  //
  // 📌 Mas o freio do server.js NAO sai ainda: faltam os 5 de rotas
  // (marketplace, admin-helpers, rotas-admin, identificar, defeitos-ciclo).
  // Eles recebem `deps` em vez de guardar estado, entao o risco e menor —
  // mas "menor" nao e "nenhum", e 2 empresas so sobem quando forem zero.
  const SINGLETONS_REQUERIDOS = [];

  // ⚠️ e estes JA sao por empresa — o teste prova, senao alguem poderia
  // "converter" e o app continuar usando a instancia velha (foi o que
  // aconteceu com o auth-AMB por um dia inteiro).
  const JA_CONVERTIDOS = ['auth-AMB', 'magalu-AMB', 'shopee-AMB',
    'ml-motivo-AMB', 'impressao-AMB', 'email-AMB', 'nf-entrada-AMB', 'compat-AMB'];
  for (const nome of JA_CONVERTIDOS) {
    const usaFabrica = new RegExp(
      `require\\('\\./lib-AMB/${nome}'\\)\\.criar\\(`).test(app);
    ok(usaFabrica, `⚠️ ${nome}: o app usa .criar() (nao a instancia do processo)`);
  }
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
  // ⚠️ b347 - 26 -> 19: quatro modulos agrupados.
  //   compat      6 -> 1 (CAT)    caches de imagem, SKU, formato, kit
  //   impressao   2 -> 1 (IMPR)   fila + ultimo poll
  //   email       2 -> 1 (MAIL)   mailer + motivo
  //   nf-entrada  2 -> 2 (EST+IDX) indice + sinalizador
  //
  // 📌 O de `compat` e o que o dono sentiria primeiro: foto e SKU trocados
  // entre empresas — e foto errada ele ja chamou de pior que foto ausente.
  // ⚠️ b349 - 19 -> 16: os dois ultimos modulos.
  //   shopee     5 -> 2 (cfg + SHP)     cache + estado da chegada
  //   ml-motivo  2 -> 2 (MOT + ROTULO)  contexto da reclamacao
  //
  // 📌 O QUE SOBRA AGORA E QUASE SO FACHADA E CONSTANTE:
  //   cfg (shopee, magalu)  interface publica — renomear quebra chamador
  //   ROTULO, PADRAO        tabelas de texto fixo, zero escritas
  //   TIDX, IDX, EST, CAT…  as gavetas em si, que o passo 3 cria por empresa
  //
  // Ou seja: o estado MUTAVEL solto acabou. O que resta sao os pontos que o
  // passo 3 vai instanciar, e eles agora tem nome e limite claros.
  // ⚠️ b354 - PASSO 3, FATIA 2: 16 -> 12. O `magalu-AMB` foi de 6 pra 2.
  //
  // Mesma tecnica da fatia 1: uma fabrica (`criarEstadoMagalu`) cria as 5
  // gavetas com escrita, e a instancia de hoje (`EST_MAGALU`) vem dela.
  //
  // ⚠️ Era o de MAIOR RISCO dos que restavam: guarda os TOKENS. Duas
  // empresas dividindo `TOKENS.access` fariam requisicao ao Magalu com a
  // credencial UMA DA OUTRA — e o marketplace responde com os dados da conta
  // errada, sem erro nenhum.
  //
  // ⚠️ (Codex, P2) - `EST_MAGALU` FICOU DE FORA DO PRIMEIRO NUMERO (11).
  //
  // O detector so reconhecia `criarGaveta*`, entao `const EST_MAGALU =
  // criarEstadoMagalu()` — a instancia que guarda os TOKENS — nao casava em
  // nenhum padrao e ficava invisivel. O numero fechava em 11 escondendo
  // justo o ponto mais sensivel. Com o detector reconhecendo tambem
  // `criarEstado*`, `magalu-AMB` conta 2: `EST_MAGALU` (a fabrica de
  // estado) + `cfg` (fachada de leitura, 0 escritas, medido, no
  // `module.exports` — renomear quebraria quem le `magalu.cfg`).
  // ⚠️ b355 - O QUE IMPORTA E ESTADO SOLTO, NAO CONTAGEM DE DECLARACOES.
  //
  // O numero parou de cair (11 antes e depois) mas a NATUREZA mudou: todas
  // as gavetas dos modulos passaram a NASCER DE UMA FABRICA. Os 11 que
  // sobram sao as fabricas em si (`_EST`, `EST_MAGALU`) e as fachadas
  // (`cfg`, `ROTULO`, `PADRAO`), que nao guardam estado mutavel.
  //
  // ⚠️ Contar declaracoes viraria falso negativo: `const X = {...}` e
  // `const X = criarAlgo()` contam igual, e sao coisas OPOSTAS pro passo 3.
  //
  // 📌 Agora meco o que resta a fazer: gaveta que NAO vem de fabrica.
  //
  // ⚠️ (Codex, P2) - `deFabrica === true` NAO PROVA INSTANCIA POR EMPRESA.
  //
  // Os 8 modulos acima continuam `exigidoDireto` (require direto, sem
  // `.criar(CFG_EMPRESA)` — ver asserção logo acima). Por causa do cache de
  // `require` do Node, `const _EST = criarEstadoShopee()` ainda roda UMA VEZ
  // por processo, nao uma vez por empresa — o mesmo vazamento de hoje, so
  // que embrulhado numa funcao. "soltos === 0" prova que a gaveta esta NO
  // FORMATO que o passo 4 vai instanciar por empresa; NAO prova que o
  // vazamento acabou. Isso so acontece quando `exigidoDireto` virar falso.
  const soltos = [];
  for (const nome of SINGLETONS_REQUERIDOS) {
    const src = fs.readFileSync(
      path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', `${nome}.js`), 'utf8');
    for (const v of contarEstadoDoModulo(src)) {
      // vem de fabrica? (`const X = criarAlgo()` ou `const X = _EST.y`)
      const deFabrica = new RegExp('const ' + v + ' = (criar\\w+\\(|_EST\\.|EST_\\w+\\.)').test(src);
      // e fachada/constante? (sem escrita em campo)
      const escritas = (src.match(new RegExp('\\b' + v + '\\.\\w+\\s*=[^=]', 'g')) || []).length
        + (src.match(new RegExp('\\b' + v + '\\.\\w+\\.(set|clear|delete|push|shift)\\(', 'g')) || []).length;
      if (!deFabrica && escritas > 0) soltos.push(`${nome}.${v}`);
    }
  }
  ok(soltos.length === 0,
     '⚠️ ZERO gavetas de estado FORA DO FORMATO fabrica nos modulos (o vazamento entre'
     + ' empresas so acaba quando `exigidoDireto` virar `.criar(CFG_EMPRESA)`)'
     + (soltos.length ? ` (achei: ${soltos.join(', ')})` : ''));
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
  // ⚠️ b358 - PASSO 3 COMPLETO: AGORA **E** UMA FABRICA.
  //
  // Esta assercao guardava o contrario — que o modulo exportava um router
  // PRONTO. Era a linha de base; mantida, ficaria vermelha justo quando o
  // trabalho foi feito.
  ok(exportaFabrica,
     '⚠️ o modulo exporta uma FABRICA (era um router pronto)');
  ok(/module\.exports = \{\s*\n?\s*criar: criarAppEmpresa/.test(app),
     '  via `criar(empresa)`');
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
  // ⚠️ b358: o server agora ITERA as empresas ativas do registro.
  // ⚠️ `srv` ja existe neste escopo — reuso em vez de redeclarar
  ok(/empresasAtivasNoDevolucoes\(\)/.test(srv),
     '⚠️ o server percorre as empresas ATIVAS (nao monta /amb cravado)');
  ok(/app\.use\(emp\.rota, criarAppAMB\(emp\.chave\)\)/.test(srv),
     '  montando cada uma com a SUA chave');
}

// ── ⚠️ b367 (Codex, P1) - o freio tem que olhar a CHAVE, nao a CONTAGEM ──
//
// `ativas.length > 1` deixava passar o caso de UMA SO empresa ativa que nao
// seja a AMB (contrato com `ambtotal` desativado e `good` ativo, por
// exemplo): o app-AMB.js continua lendo `config-AMB` (so da AMB) e crava o
// callback OAuth em `/amb`, vazando nome, loja e credencial da AMB pra
// dentro da conta errada — sozinha ou acompanhada, o vazamento e o mesmo.
//
// 📌 Executa o TRECHO REAL do freio (recortado por marcadores estaveis,
// `test/_recorte.js`) com `ativas` simulado, em vez de so grepar o texto —
// prova o COMPORTAMENTO, nao a forma do codigo.
{
  const { entreMarcadores } = require('./_recorte');
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const trecho = entreMarcadores(srv,
    "const naoAMB = ativas.filter((e) => e.chave !== 'ambtotal');",
    'for (const emp of ativas) {');
  const rodarFreio = new Function('ativas', trecho);

  const naoLanca = (ativas) => { try { rodarFreio(ativas); return true; } catch (e) { return false; } };

  ok(naoLanca([{ chave: 'ambtotal', rota: '/amb' }]),
     '  so a AMB ativa: o freio NAO dispara (caso de hoje)');
  ok(!naoLanca([{ chave: 'good', rota: '/good' }]),
     '⚠️ so a GOOD ativa (AMB desligada no contrato): o freio DISPARA');
  ok(!naoLanca([{ chave: 'ambtotal', rota: '/amb' }, { chave: 'good', rota: '/good' }]),
     '  AMB + GOOD juntas: o freio continua disparando');
}

// ── ⚠️ PASSO 3, FATIA 1: as 4 gavetas vêm de UMA fábrica ────────────
//
// O passo 2 agrupou as 41 variáveis em 4 gavetas — mas elas nasciam em 4
// pontos diferentes do arquivo. O passo 3 precisa criar TODAS por empresa,
// de uma vez.
//
// 📌 Não envolvi o arquivo numa função: são 3.142 linhas (acima do teto de
// 3.000), e seria o diff mais arriscado possível. Esta fatia junta o que
// estava espalhado; quando o router virar fábrica, a linha que cria as
// gavetas da empresa já existe e está testada.
{
  ok(/function criarGavetasDaEmpresa\(\)/.test(app),
     '⚠️ ha UMA fabrica que cria as 4 gavetas');
  ok(/const GAVETAS = criarGavetasDaEmpresa\(\);/.test(app),
     '  e a instancia de hoje VEM dela (nao ha 2 fontes do mesmo estado)');

  for (const [nome, campo] of [['ACESSO', 'acesso'], ['TRIAGEM', 'triagem'],
                               ['CACHES', 'caches'], ['NF_DEV', 'nfDev']]) {
    ok(new RegExp('const ' + nome + ' = GAVETAS\\.' + campo).test(app),
       `  ${nome} sai da gaveta \`${campo}\``);
  }

  // ⚠️ e duas chamadas NÃO compartilham nada — é o ponto inteiro.
  //
  // 📌 revisao Codex #303 (P2): chamar a FABRICA REAL (exportada por
  // app-AMB.js só para este teste), em vez de um clone escrito à mão —
  // um clone passaria mesmo se a produção reaproveitasse um Map do
  // escopo do módulo entre as duas chamadas.
  process.env.AMB_SUPABASE_URL = process.env.AMB_SUPABASE_URL || 'https://teste.supabase.co';
  process.env.AMB_SUPABASE_KEY = process.env.AMB_SUPABASE_KEY || 'chave-de-teste';

  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function (pedido) {
    if (pedido === '@supabase/supabase-js') return { createClient: () => ({ from: () => ({}) }) };
    if (pedido.indexOf('auth-AMB') !== -1) {
      const real = originalLoad.apply(this, arguments);
      return Object.assign({}, real, {
        requerLogin: (req, res, next) => next(),
        requerAdmin: (req, res, next) => next(),
      });
    }
    return originalLoad.apply(this, arguments);
  };
  let routerAMB = null;
  try { routerAMB = require(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js')); }
  catch (e) { console.log('(nao consegui montar o app-AMB: ' + (e.message || e) + ')'); }
  Module._load = originalLoad;

  const fabricaDisponivel = !!routerAMB && typeof routerAMB.gavetasDaEmpresaParaTeste === 'function';
  ok(fabricaDisponivel, '  a fabrica real foi exportada e pode ser chamada aqui');

  if (fabricaDisponivel) {
    const a = routerAMB.gavetasDaEmpresaParaTeste();
    const b = routerAMB.gavetasDaEmpresaParaTeste();
    a.acesso.falhasLogin.set('ana', 3);
    a.triagem.pendentes.set('p1', {});
    a.caches.espreita = { dados: 'da A' };
    a.nfDev.indice.set('4567', { nf: '123' });

    ok(!b.acesso.falhasLogin.has('ana'),
       '⚠️ login travado numa empresa NAO trava a outra');
    ok(b.triagem.pendentes.size === 0, '  triagem nao vaza');
    ok(b.caches.espreita === null, '  espreita nao vaza');
    ok(b.nfDev.indice.size === 0, '  ⚠️ e o indice de NF nao vaza (o pior deles)');
    ok(a.nfDev.indice.size === 1, '  e a primeira manteve o que era dela');
  } else {
    ok(false, '  login travado numa empresa NAO trava a outra (pulado: fabrica indisponivel)');
    ok(false, '  triagem nao vaza (pulado: fabrica indisponivel)');
    ok(false, '  espreita nao vaza (pulado: fabrica indisponivel)');
    ok(false, '  o indice de NF nao vaza (pulado: fabrica indisponivel)');
    ok(false, '  a primeira manteve o que era dela (pulado: fabrica indisponivel)');
  }
}

// ── ⚠️ PASSO 3, FATIA 4: a empresa sai de dentro do código ──────────
//
// Era `configDaEmpresa('ambtotal')` — cravado. Trocar a string
// SUBSTITUIRIA a AMB em vez de montar as duas, que é o P0 da auditoria.
//
// 📌 Agora vem de `DEVOLUCOES_EMPRESA`, com 'ambtotal' de PADRÃO: sem declarar
// nada, o comportamento é idêntico. Quando o bootstrap montar por empresa,
// ele passa a chave em vez de alguém editar código.
{
  // ⚠️ b358: esta assercao guardava a fatia 4 (empresa vinda de env). O passo
  // 3 fez o ARGUMENTO ganhar da env — ja guardado logo acima.
  ok(/configDaEmpresa\(EMPRESA_DESTE_APP\)/.test(app),
     '  e a config usa essa chave');
  ok(/obterEmpresa\(EMPRESA_DESTE_APP\)/.test(app),
     '  ⚠️ e a FICHA tambem (era o 2o ponto cravado)');
  // (a checagem "nao esta cravado" vive no bloco acima, que ignora
  // comentarios — o texto que EXPLICA a mudanca cita o formato velho)

  // ⚠️ e a chave muda o que IMPORTA — não é cosmético
  const { obterEmpresa } = require('../lib/empresas');
  const tabAmb = (obterEmpresa('ambtotal').tabelas || {}).devolucoes;
  const tabGood = (obterEmpresa('good').tabelas || {}).devolucoes;
  ok(!!tabAmb && !!tabGood && tabAmb !== tabGood,
     `⚠️ a chave decide a TABELA (${tabAmb} x ${tabGood}) — trocar nao e cosmetico`);
}

// ── ⚠️ o AUTH e por EMPRESA, não do processo ────────────────────────
//
// Era `require('./lib-AMB/auth-AMB')` — a instância PADRÃO, uma por
// processo. A fábrica `criar(cfg)` existia desde o PR #295, mas o app nunca
// a chamou: faltava a config ter os 4 campos que ela exige.
//
// ⚠️ Era o maior risco dos 13: cookie, sessões e contagem de falhas de login
// compartilhados. Duas empresas e o login de uma valeria na outra.
{
  ok(/require\('\.\/lib-AMB\/auth-AMB'\)\.criar\(CFG_EMPRESA\.AUTH\)/.test(app),
     '⚠️ o app cria o auth POR EMPRESA (era a instancia do processo)');

  const { configDaEmpresa } = require('../lib/config-da-empresa');

  // ⚠️ a AMB não pode mudar: cookie diferente = todo mundo cai no deploy
  const authAmb = configDaEmpresa('ambtotal').AUTH;
  ok(authAmb.cookie === 'sessao_amb' && authAmb.caminhoCookie === '/amb'
     && authAmb.envUsers === 'AMB_USERS' && authAmb.envAdmins === 'AMB_ADMIN_USER',
     '⚠️ e os valores da AMB sao IDENTICOS aos de hoje (ninguem cai da sessao)');

  // ⚠️ e cookies únicos por empresa — a GOOD tem rota vazia e caía em
  // `sessao_amb` no meu 1º rascunho: as duas com o MESMO cookie, que é
  // exatamente o vazamento que este trabalho fecha.
  const cookies = ['ambtotal', 'good'].map((k) => configDaEmpresa(k).AUTH.cookie);
  ok(new Set(cookies).size === cookies.length,
     `⚠️ cookies UNICOS por empresa (${cookies.join(' x ')})`);

  // ⚠️ (Codex, P2) - regressao: a GOOD tem `prefixoRota: ''` e ainda roda em
  // producao com `USERS`/`ADMIN_USER` sem prefixo (b250). Os dois bugs
  // achados so aparecem com a GOOD, nunca com a AMB (que tem prefixoRota e
  // ja usa nomes prefixados) — por isso a asserção acima nao os pegava.
  {
    const salvos = ['GOOD_USERS', 'USERS', 'GOOD_ADMIN_USER', 'ADMIN_USER']
      .map((n) => [n, process.env[n]]);
    delete process.env.GOOD_USERS;
    delete process.env.GOOD_ADMIN_USER;
    process.env.USERS = 'diego:s1';
    process.env.ADMIN_USER = 'diego';

    const authGood = configDaEmpresa('good').AUTH;
    // ⚠️ o bootstrap (server.js/empresasAtivasNoDevolucoes) monta a GOOD em
    // `/good`, nao em `/amb` — o cookie tem que ter o MESMO path, senao o
    // navegador nao o envia de volta pras rotas da GOOD (login 200, sessao
    // seguinte 401).
    ok(authGood.caminhoCookie === '/good',
       `⚠️ caminhoCookie da GOOD acompanha a rota que o bootstrap monta (veio '${authGood.caminhoCookie}')`);
    // ⚠️ auth-AMB.js le `process.env[envUsers]` DIRETO (sem envDaEmpresa) —
    // sem o nome HISTORICO aqui, a GOOD leria `GOOD_USERS` (vazio hoje) e
    // ninguem conseguiria logar.
    ok(authGood.envUsers === 'USERS' && authGood.envAdmins === 'ADMIN_USER',
       `⚠️ sem GOOD_USERS/GOOD_ADMIN_USER no ambiente, cai no nome HISTORICO (veio '${authGood.envUsers}'/'${authGood.envAdmins}')`);

    process.env.GOOD_USERS = 'diego:s1';
    process.env.GOOD_ADMIN_USER = 'diego';
    const authGoodNovo = configDaEmpresa('good').AUTH;
    ok(authGoodNovo.envUsers === 'GOOD_USERS' && authGoodNovo.envAdmins === 'GOOD_ADMIN_USER',
       `  com GOOD_USERS/GOOD_ADMIN_USER configurados, usa o nome NOVO (veio '${authGoodNovo.envUsers}'/'${authGoodNovo.envAdmins}')`);

    for (const [n, v] of salvos) { if (v == null) delete process.env[n]; else process.env[n] = v; }
  }

  // e o isolamento de verdade, com duas instâncias
  const auth = require('../amb-devolucoes/lib-AMB/auth-AMB.js');
  process.env.AMB_USERS = 'ana:s1';
  process.env.AMB_ADMIN_USER = 'ana';
  process.env.GIRA_ISO_USERS = 'bruno:s2';
  process.env.ADMIN_SESSION_SECRET = 'segredo-fixo-de-teste-com-40-caracteres!!';

  const a = auth.criar(authAmb);
  const b = auth.criar({
    cookie: 'sessao_gira_iso', caminhoCookie: '/gira-iso',
    validadeMs: 12 * 60 * 60 * 1000,
    envUsers: 'GIRA_ISO_USERS', envAdmins: 'GIRA_ISO_ADMIN',
  });
  const tk = a.novaSessao('ana', 'admin');
  ok(!b.validarSessao(tk), '⚠️ token de uma empresa NAO vale na outra');
  ok(!a.validarSessao(b.novaSessao('bruno', 'admin')), '  nos dois sentidos');
}

// ── ⚠️ (Codex, P2, PR #317) - redirectUri e render tambem tem o bug do path vazio ──
//
// O mesmo apontamento do AUTH.caminhoCookie (GOOD tem `prefixoRota: ''`)
// existia em outros dois pontos de `configDaEmpresa`: `redirectUri()` cravava
// `ficha.prefixoRota || ''` (sem o fallback pra `/` + chave), e `render`
// prefixava as envs por empresa quando o Render e UM servico so, compartilhado
// pelas duas.
{
  const { configDaEmpresa } = require('../lib/config-da-empresa');

  const salvos = ['RENDER_EXTERNAL_URL', 'URL_BASE'].map((n) => [n, process.env[n]]);
  delete process.env.URL_BASE;
  process.env.RENDER_EXTERNAL_URL = 'https://exemplo.onrender.com';

  const urlGood = configDaEmpresa('good').redirectUri('/oauth/callback');
  ok(urlGood === 'https://exemplo.onrender.com/good/oauth/callback',
     `⚠️ redirectUri da GOOD entra na rota que o bootstrap monta (/good), nao na raiz (veio '${urlGood}')`);

  const urlAmb = configDaEmpresa('ambtotal').redirectUri('/oauth/callback');
  ok(urlAmb === 'https://exemplo.onrender.com/amb/oauth/callback',
     `  e a AMB continua igual (veio '${urlAmb}')`);

  for (const [n, v] of salvos) { if (v == null) delete process.env[n]; else process.env[n] = v; }
}

{
  const { configDaEmpresa } = require('../lib/config-da-empresa');

  const salvos = ['RENDER_API_KEY', 'RENDER_API_KEY_v2', 'RENDER_SERVICE_ID',
    'RENDER_SERVICE_ID_v2', 'AMB_RENDER_API_KEY', 'AMB_RENDER_SERVICE_ID']
    .map((n) => [n, process.env[n]]);
  delete process.env.AMB_RENDER_API_KEY;
  delete process.env.AMB_RENDER_SERVICE_ID;
  process.env.RENDER_API_KEY = 'chave-global';
  process.env.RENDER_SERVICE_ID = 'servico-global';
  delete process.env.RENDER_API_KEY_v2;
  delete process.env.RENDER_SERVICE_ID_v2;

  const render = configDaEmpresa('ambtotal').render;
  ok(render.apiKey === 'chave-global' && render.serviceId === 'servico-global',
     `⚠️ render le a GLOBAL (mesma que lib/render-tokens.js grava), nao a prefixada por empresa (veio apiKey='${render.apiKey}', serviceId='${render.serviceId}')`);

  delete process.env.RENDER_API_KEY;
  delete process.env.RENDER_SERVICE_ID;
  process.env.RENDER_API_KEY_v2 = 'chave-v2';
  process.env.RENDER_SERVICE_ID_v2 = 'servico-v2';
  const renderV2 = configDaEmpresa('ambtotal').render;
  ok(renderV2.apiKey === 'chave-v2' && renderV2.serviceId === 'servico-v2',
     `  e o fallback _v2 continua funcionando (veio apiKey='${renderV2.apiKey}', serviceId='${renderV2.serviceId}')`);

  for (const [n, v] of salvos) { if (v == null) delete process.env[n]; else process.env[n] = v; }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
