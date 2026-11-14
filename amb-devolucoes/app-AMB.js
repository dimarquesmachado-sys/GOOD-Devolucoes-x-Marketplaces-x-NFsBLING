// ============================================================
// amb-devolucoes/app-AMB.js                    (AMB Devol. b22)
// ------------------------------------------------------------
// Router Express do Devolucoes da AMBTotal.
//
// b11 — FORCA MAXIMA (paridade com a GOOD):
//   SHOPEE no bipe e no a espreita (proxy do shopee-nf-sync,
//   loja 'amb'); MAGALU com OAuth proprio da conta AMB + as 3
//   modalidades (agencia, correios, FULFILLMENT); MOTIVO da
//   devolucao em linguagem de galpao (arrependeu x defeito x
//   nunca recebeu); RECLAMACAO em 2 cliques; cruzamento com as
//   NFs de DEVOLUCAO do Bling ("ja emitida ✓"); e-mail quando
//   o galpao reporta problema; etiqueta ZPL de defeito na Zebra
//   via QZ Tray (mesmo certificado da GOOD, fila remota).
//
// b10 trouxe o PAINEL: a espreita (o que esta vindo), triagens,
// defeitos agrupados por local, e recados pro estoquista.
//
// b8 trouxe A TELA de bipe. Ate agora tudo era API: so funcionava por URL
// com a chave de admin. Agora o galpao abre /amb/ no celular,
// loga e bipa. Ver public-AMB/index-AMB.html.
//
// b6 trouxe LOGIN e TRIAGEM: o galpao passa a ter como entrar e o
// que for bipado passa a ser GRAVADO no Supabase (tabelas _amb).
// O cookie de sessao e "sessao_amb", isolado do da GOOD, que
// roda no mesmo dominio — ver lib-AMB/auth-AMB.js.
//
// b5 consertou a busca por nome: PAGINACAO de verdade (total real
// + "tem mais") e uma rota que abre os ITENS de uma NF sob
// demanda, pra desempatar quando o mesmo cliente tem varias
// compras e o nome nao distingue.
//
// b4 trouxe a BUSCA POR NOME DO REMETENTE — o pega-tudo que cobre
// os canais SEM integracao. A AMBTotal vende no TikTok Shop (e a
// Amazon comeca em breve): dessas origens a caixa chega so com o
// nome do cliente na etiqueta, e nenhum indice de marketplace
// resolve. Ver lib-AMB/nf-nomes-AMB.js.
//
// b3 trouxe o INDICE claims->returns do ML — a peca que faz o bipe
// da etiqueta dos Correios reconhecer de que venda e a caixa.
//
// CORRECAO DA b3: a tela /amb/conectar mostrava "falta autorizar"
// mesmo depois de conectar. Causa: ela lia o config, que e uma
// FOTO das env vars tirada quando o servico subiu. Como o token
// e gravado depois, a foto ficava velha ate o proximo restart.
// Agora a tela pergunta aos proprios modulos (bling.temToken(),
// ml.temToken()), que sabem o estado de agora.
//
// Toda rota administrativa exige ?k=ADMIN_KEY e responde 404
// quando a chave falta. A unica publica alem do /status e o
// /oauth/callback, protegido por state de uso unico.
// ============================================================

// ⚠️ b358 - PASSO 3, FATIA FINAL: O MODULO VIRA FABRICA.
//
// Era `module.exports = router` — um router PRONTO, um por processo. Montar
// `/girassol` sobre ele faria a Girassol operar com as tabelas, credenciais
// e caches da AMB. E o P0 da auditoria do Codex.
//
// 📌 ENVOLVO SEM REINDENTAR, de proposito: o JavaScript nao liga pra
// indentacao, e reindentar 3.200 linhas produziria um diff ilegivel onde
// ninguem acharia um erro real. Assim o diff sao ~6 linhas.
//
// ⚠️ O QUE MUDA DE COMPORTAMENTO: os `require` do topo passam a rodar dentro
// da funcao. Isso e seguro — o `require` do Node e cacheado, entao a 2a
// chamada nao relê arquivo — e `__dirname` continua valendo (e do MODULO,
// nao do escopo).
//
// 📌 `criarAppEmpresa()` sem argumento usa `DEVOLUCOES_EMPRESA` (padrao
// 'ambtotal'), entao o server.js de hoje continua funcionando igual.

// ⚠️ revisao Codex no PR #308 (P2) - `criarGavetaNfDev` e `criarGavetasDaEmpresa`
// vivem NO ESCOPO DO MODULO (fora de `criarAppEmpresa`), de proposito: nenhuma
// das duas depende de CFG_EMPRESA ou de qualquer variavel da fabrica, entao
// `module.exports.gavetasDaEmpresaParaTeste` pode apontar pra FUNCAO REAL em
// vez de duplicar a forma do objeto a mao. Um clone passaria mesmo se a
// producao mudasse o formato ou passasse a reaproveitar um Map — exatamente a
// regressao que o teste de isolamento existe pra pegar. `criarAppEmpresa`
// continua chamando estas fabricas a CADA execucao, entao GAVETAS continua
// uma instancia por empresa.
//
// ⚠️ b342 - GAVETA 1 de 3: O INDICE DE NOTAS DE DEVOLUCAO.
//
// [stated 15/09] "isso, uma gaveta pra cada. se for o melhor pro futuro,
// segue nisso, independente do trabalho q isso resulte"
//
// Estas 6 variaveis existiam UMA VEZ no processo. Enquanto so a AMB roda
// aqui, funciona. Mas quando a Girassol subir no mesmo servico, as duas
// dividiriam a MESMA gaveta: a Girassol pediria o indice dela e receberia o
// da AMB.
//
// ⚠️ E ISSO NAO DA ERRO — da DADO ERRADO com cara de certo. "Numero errado
// e pior que numero ausente".
//
// 📌 Agora sao campos de um objeto CRIADO POR INSTANCIA. Hoje ha uma so, e
// o comportamento e identico; quando o passo 3 montar a segunda empresa,
// cada uma tera a sua.
function criarGavetaNfDev() {
  return {
    indice: new Map(),      // pedido -> { nf, data, contato }
    semPedido: [],          // b335 - notas SEM pedido (caso Full)
    ignoradas: {},          // b335 r2 - naturezas que ficaram de fora
    cacheOk: false,         // b335 r2 - build valido, mesmo que vazio
    ts: 0,
    carregando: null,
  };
}

// ⚠️ b353 - PASSO 3, FATIA 1: UMA FABRICA PARA AS 4 GAVETAS.
//
// O passo 2 agrupou as 41 variaveis soltas em 4 gavetas. Mas elas ainda
// nascem em 4 PONTOS DIFERENTES do arquivo (linhas 229, 255, 1356, 2135) —
// e o passo 3 precisa criar TODAS por empresa, de uma vez.
//
// ⚠️ NAO envolvo o arquivo inteiro numa funcao: sao 3.142 linhas (ja acima
// do teto de 3.000 do dono), e seria o diff mais arriscado possivel — o
// tipo de mudanca em que um `}` fora do lugar passa no `node --check` e
// quebra no ar.
//
// 📌 Esta fatia junta o que ESTAVA espalhado num lugar so. Comportamento
// IDENTICO hoje (uma instancia); e quando o router virar fabrica, a linha
// que cria as gavetas da empresa ja existe e esta testada.
function criarGavetasDaEmpresa() {
  return {
    // chave na URL + tentativas de login
    acesso: { usosQuerystring: 0, falhasLogin: new Map() },
    // pedidos em triagem
    triagem: { pendentes: new Map() },
    // espreita + naturezas da NF
    caches: { espreita: null, naturezasNf: new Map() },
    // o indice de notas de devolucao
    nfDev: criarGavetaNfDev(),
  };
}

function criarAppEmpresa(empresaAlvo) {
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const MANIFEST_AMB = require('./public-AMB/manifest-AMB.json');
// b249 - FASE 3, passo 4: os modulos que ja sao FABRICA sao montados COM A
// FICHA, em vez de vir prontos com o config da AMB embutido.
//
// ⚠️ NAO REINDENTEI AS 2.800 LINHAS DE ROTA. Envolver o arquivo inteiro
// numa funcao seria um diff ilegivel e arriscado — e as rotas nao precisam
// mudar: elas usam `bling`, `ml`, `db`... e o que muda e de onde ESSES
// vem. O ponto de montagem e aqui, em 6 linhas.
//
// Quando a Girassol entrar (Fase 4), o unico passo aqui e trocar a chave.
const { configDaEmpresa } = require('../lib/config-da-empresa');
const { SEM_EMPRESA, PREFIXO_SEM_EMPRESA } = require('../lib/empresas');   // b661 - nunca cair na AMB (declarado ANTES do 1o uso, logo abaixo)
// ⚠️ b356 - PASSO 3, FATIA 4: A EMPRESA SAI DE DENTRO DO CODIGO.
//
// Era `configDaEmpresa('ambtotal')` — cravado. Trocar a string SUBSTITUIRIA
// a AMB em vez de montar as duas, que e exatamente o que a auditoria do
// Codex marcou como P0.
//
// 📌 Agora vem de `DEVOLUCOES_EMPRESA`, com 'ambtotal' de PADRAO: sem declarar
// nada, o comportamento e IDENTICO ao de hoje. E quando o bootstrap montar
// por empresa, ele passa a chave em vez de editar codigo.
//
// ⚠️ NAO transformei o modulo inteiro em fabrica: sao 3.142 linhas, acima do
// teto de 3.000, e envolver tudo numa funcao e o diff mais arriscado
// possivel. Esta fatia tira a EMPRESA do caminho critico; o router ainda e
// um por processo, e o teste continua acusando isso.
// ⚠️ O NOME NAO PODE TER PREFIXO DE EMPRESA.
//
// Eu tinha chamado de `AMB_APP_EMPRESA` — e o teste `config-le-do-registro`
// acusou: a regra da casa e que nada leia `process.env.AMB_*` direto, tudo
// passa por `envDaEmpresa` pra empresa nova entrar so com configuracao.
//
// 📌 E ele esta certo por um motivo ainda melhor: ESTA variavel DECIDE qual
// empresa o app e. Chama-la de `AMB_*` e contraditorio — seria a variavel da
// AMB dizendo que o app e da Girassol.
//
// ⚠️ E ela e a UNICA que nao pode passar por `envDaEmpresa`: ovo e galinha —
// pra saber a env da empresa, preciso saber qual e a empresa.
// ⚠️ b358: o ARGUMENTO ganha da env. Assim o bootstrap passa a empresa ao
// montar cada uma, e a env continua servindo pra quem monta so uma.
const EMPRESA_DESTE_APP = String(
  empresaAlvo || process.env.DEVOLUCOES_EMPRESA || SEM_EMPRESA).trim();   // b661: sem empresa a fabrica recusa (configDaEmpresa lanca), nao monta a AMB
const CFG_EMPRESA = configDaEmpresa(EMPRESA_DESTE_APP);

// ⚠️ b367 - O APP LARGA O `config-AMB` FIXO.
//
// Era `require('./config-AMB')` — arquivo SO DA AMB, lido 22 vezes
// (NOME_EMPRESA, loja, bling, supabase, urlBase, PREFIXO). Com 2 empresas,
// TODAS essas leituras seriam da AMB — e era por isso que o freio do
// server.js existia.
//
// 📌 PROVEI A EQUIVALENCIA CAMPO A CAMPO antes de trocar, e achei 2 que
// quebrariam producao:
//   EMPRESA      'amb' x 'ambtotal'  -> orfanaria os dados
//   shopee.loja  'amb' x 'ambtotal'  -> o PROXY so conhece 'amb': a Shopee
//                                        cairia
// Os dois passaram a usar `chaveDados`, e agora batem.
//
// ⚠️ A UNICA diferenca que SOBROU e intencional: o `redirectUri` agora leva
// o prefixo da empresa. Era `/callback` pra todas; com 2, a Girassol
// mandaria o marketplace devolver o codigo na rota da AMB — e o token dela
// seria gravado na conta da AMBTotal.
const cfg = CFG_EMPRESA;

// ⚠️ b368 - A BASE DAS ROTAS SAI DA FICHA, nao cravada.
//
// Havia 48 links `/amb/...` escritos a mao no HTML e nos redirects. Com a
// Girassol montada em `/girassol`, todos eles levariam o usuario dela pra
// dentro da AMB — e como a sessao e por empresa, ele cairia numa tela de
// login que nao e a dele.
//
// 📌 `BASE` e o prefixo da propria instancia: '/amb' hoje, '/girassol'
// quando ela subir.
//
// ⚠️ b368.1 (Codex, P2) - `CFG_EMPRESA.PREFIXO || ''` CAIA NA RAIZ PRA GOOD.
//
// `PREFIXO` e `ficha.prefixoRota` cru, e a GOOD tem `prefixoRota: ''` DE
// PROPOSITO — mas ela NAO e montada na raiz: o bootstrap (server.js,
// `empresasAtivasNoDevolucoes`) monta `criarAppEmpresa('good')` em `/good`
// (mesmo fallback usado no cookie de sessao e no redirectUri, ver
// lib/config-da-empresa.js). Cair em '' geraria links pra raiz do servico,
// fora do router da GOOD.
//
// 📌 Uso `PREFIXO_ROTA`, que ja sai da config com esse fallback aplicado.
const BASE = CFG_EMPRESA.PREFIXO_ROTA;

// ⚠️ b360 - O AUTH PASSA A SER POR EMPRESA.
//
// Era `require('./lib-AMB/auth-AMB')` — a instancia PADRAO do modulo, UMA
// por processo. A fabrica `criar(cfg)` existe desde o PR #295, mas o app
// nunca a chamou: faltava a config ter os campos que ela exige.
//
// ⚠️ ERA O MAIOR RISCO DOS 13: cookie, sessoes e contagem de falhas de login
// compartilhados. Duas empresas no mesmo processo e o login de uma valeria na
// outra — e travar a conta de um usuario travaria nas duas.
//
// 📌 Os valores da AMB batem EXATAMENTE com os padroes de hoje (conferido
// contra `PADRAO` no auth-AMB): mesmo cookie `sessao_amb`, mesmo caminho,
// mesmas envs. Ninguem cai da sessao no deploy.
//
// ⚠️ b422 (Codex, P1) - VALIDA ANTES DE CRIAR O BLING/ML, nao depois.
//
// Este `criar()` e quem falha o boot da empresa quando falta o
// `<PREFIXO>SESSION_SECRET` em producao (auth-AMB.js:159). Ele morava
// DEPOIS de `bling.criar()`/`ml.criar()` — e os dois JA REGISTRAM a
// renovacao preventiva (`registrarPreventiva`, com `autoLigar: true`) so
// de serem criados, o que AGENDA um `setTimeout`/`setInterval` de verdade
// no processo. O `throw` do auth acontecia tarde demais: o try/catch do
// bootstrap (server.js) pega a excecao e poe a rota em 503, mas os timers
// da empresa "que nao subiu" continuavam vivos e, horas depois, renovariam
// o refresh token de USO UNICO do Bling/ML e gravariam o novo no Render —
// de uma empresa fora do ar, sem ninguem notar.
//
// 📌 Validar aqui, ANTES de qualquer `.criar()` que registre timer, faz o
// `throw` acontecer cedo: nenhum cliente chega a ser construido e nenhuma
// renovacao preventiva chega a ser agendada.
// ⚠️ b422 (Codex, P1) - A FICHA INTEIRA E VALIDADA ANTES DOS CLIENTES.
//
// No b421 eu subi a validacao do SESSION_SECRET pra antes dos `.criar()` que
// registram timer — e parei ali. Mas o `chaveDados` continuava sendo validado
// DEPOIS, ja com os timers agendados.
//
// 📌 O EFEITO ERA IDENTICO AO QUE EU TINHA ACABADO DE CONSERTAR: uma empresa
// com segredo valido e ficha incompleta agendava a renovacao preventiva,
// tomava o `throw` depois, virava 503 — e horas depois os timers renovavam de
// verdade o refresh de USO UNICO, queimando o token do Mover-Pedidos pra uma
// empresa que nunca subiu.
//
// ⚠️ Consertei UMA porta e deixei a do lado aberta.
//
// 📌 `obterEmpresa` nao depende de nada que nasca depois, entao a ficha e
// buscada AQUI. O `FICHA_AMB` la embaixo continua onde estava — esta
// validacao so adianta a conferencia, nao move a declaracao.
const CHAVE_DADOS = (() => {
  // ⚠️ `require` direto: o `obterEmpresa` do topo so nasce mais abaixo, e
  // usa-lo aqui dava "Cannot access before initialization". Errei isto 2x
  // hoje — `const` nao sobe, e a ordem do arquivo manda.
  const ficha = require("../lib/empresas").obterEmpresa(EMPRESA_DESTE_APP);
  const v = ficha && ficha.chaveDados;
  if (!v) {
    throw new Error(`[devolucoes] a ficha de "${EMPRESA_DESTE_APP}" nao declara `
      + '`chaveDados` — e o valor da coluna `empresa` no banco. Sem ele eu '
      + 'gravaria dado com a chave errada.');
  }
  return v;
})();

// ⚠️ (Codex, P1, revisao desta mesma peca) - `chaveDados` fechou UMA porta;
// `tabelas` e OUTRA do mesmo tipo.
//
// `db.tabelas.devolucoes` e lido mais abaixo (`registrarRotasAdminNF`) na
// CONSTRUCAO da app — nao dentro de uma rota — e `db` so nasce DEPOIS de
// bling/ml/mlReturns (que ja registram timer de renovacao preventiva ao
// serem criados). Se a ficha nao declarar `tabelas` (ou faltar uma das 5),
// isso e um TypeError, nao um `throw new Error` — o mesmo furo do b422,
// so que sem a palavra que o sweep de `test/amb-nao-registra-timer-sem-montar
// .test.js` procura.
//
// 📌 Valido aqui, no mesmo ponto que valida `chaveDados`, ANTES de qualquer
// `.criar()` que registre timer.
(() => {
  const ficha = require("../lib/empresas").obterEmpresa(EMPRESA_DESTE_APP);
  const CHAVES_TABELA = ['devolucoes', 'espreitaNotas', 'recados', 'pecasRetiradas', 'skuDepara'];
  const faltando = CHAVES_TABELA.filter((k) => !(ficha && ficha.tabelas && ficha.tabelas[k]));
  if (faltando.length) {
    throw new Error(`[devolucoes] a ficha de "${EMPRESA_DESTE_APP}" nao declara `
      + `tabelas.${faltando.join(', tabelas.')} — sem elas eu leria/gravaria numa tabela errada.`);
  }
})();

const auth = require('./lib-AMB/auth-AMB').criar(CFG_EMPRESA.AUTH);

// ⚠️ b377 - CADA CLIENTE ENTRA NA CONFIG LOGO DEPOIS DE NASCER.
//
// Minha 1a versao juntava as 3 atribuicoes no fim — mas o `mlReturns` e
// criado na linha seguinte ao `ml` e JA PRECISA dele. Quebrou o boot.
//
// 📌 Sem isso o modulo usaria a instancia PADRAO (config-AMB fixo): a
// empresa nova consultaria a conta da AMBTotal no ML.
const bling = require('./lib-AMB/bling-AMB').criar(CFG_EMPRESA);
CFG_EMPRESA.clienteBling = bling;   // b377
const ml = require('./lib-AMB/ml-AMB').criar(CFG_EMPRESA);
CFG_EMPRESA.clienteMl = ml;   // b377 — o mlReturns (abaixo) ja precisa dele
const mlReturns = require('./lib-AMB/ml-returns-AMB').criar(CFG_EMPRESA);
// b580 - indice de nomes salvo no armazem PRIVADO desta empresa (o `db` e criado logo abaixo; so e usado depois do boot)
CFG_EMPRESA.armazemNfNomes = require('../lib/armazem-indices').criarArmazem({ obterSupabase: () => db.conectar(), chave: CFG_EMPRESA.CHAVE_REGISTRO || SEM_EMPRESA });   // b661
const nfNomes = require('./lib-AMB/nf-nomes-AMB').criar(CFG_EMPRESA);
const tokens = require('../lib/render-tokens');
const drenagem = require('../lib/drenagem');   // b477: timers que param no SIGTERM
const tiktokPonte = require('../lib/tiktok-ponte');
const devCapturadas = require('../lib/devolucoes-capturadas');   // b455: a captura persistente, que so a GOOD chamava
const registrarRotasRelatorios = require('../lib/rotas-relatorios');   // b651 - relatorio de devolucoes (peca multiempresa do b650)
const tiktokDevCaptura = require('../lib/tiktok-devolucoes');     // b455: normaliza o TikTok pra captura (o mesmo modulo que o identificar recebe por deps)
const erroCodigo = require('../lib/erro-de-codigo');   // b205 - bug meu nao e falha do marketplace
const confrontar = require('../lib/confrontar-nf');   // b208 - escada de desempate da NF
const vinculoCache = require('../lib/vinculo-nf-cache');   // b204 - vinculo NF ja achado
const espreitaTriadas = require('../lib/espreita-ja-triadas');   // 30/10 - espreita sem o que ja foi triado
// 29/10: vinculo pela chave e PERMANENTE e mora no armazem privado da empresa — deploy nao apaga mais
setTimeout(() => { vinculoCache.ligarArmazem(CHAVE_DADOS, CFG_EMPRESA.armazemNfNomes)
  .then((r) => console.log(`[VINCULO-NF] ${CHAVE_DADOS}: vinculos pela chave carregados do armazem:`, r && r.carregados))
  .catch((e) => console.error(`[VINCULO-NF] ${CHAVE_DADOS}: armazem`, e.message)); }, 8000).unref();
const marcadores = require('../lib/marcadores-estornada');   // b200 - peca unica dos marcadores
const magaluCancelados = require('../lib/magalu-cancelados');  // b191 - peca UNICA, empresa por parametro // b334 - ponte TikTok via Mover-Pedidos (peca unica, empresa como parametro)
const db = require('./lib-AMB/supabase-AMB').criar(CFG_EMPRESA);
const mkt = require('./lib-AMB/marketplace-AMB');
// ⚠️ b362: o shopee passa a ser POR EMPRESA — o cache de devolucoes e o
// estado da chegada eram compartilhados.
const shopee = require('./lib-AMB/shopee-AMB').criar(CFG_EMPRESA);
// ⚠️ b361: o magalu passa a ser POR EMPRESA — guarda os TOKENS, e duas
// empresas dividindo credencial falariam com a conta errada do marketplace.
const magalu = require('./lib-AMB/magalu-AMB').criar(CFG_EMPRESA);
const mlMotivo = require('./lib-AMB/ml-motivo-AMB').criar(CFG_EMPRESA);   // b364
const impressao = require('./lib-AMB/impressao-AMB').criar(CFG_EMPRESA);   // b364
const emailAMB = require('./lib-AMB/email-AMB').criar(CFG_EMPRESA);   // b364
CFG_EMPRESA.clienteEmail = emailAMB;   // b377
const nfEntrada = require('./lib-AMB/nf-entrada-AMB').criar(CFG_EMPRESA);   // b364
const multer = require('multer');
const compat = require('./lib-AMB/compat-AMB').criar(CFG_EMPRESA);   // b364
const criarAdminHelpers = require('./lib-AMB/admin-helpers-AMB');
// b240 - UNIFICADO com a GOOD. A versao comum e a que estava aqui (a mais
// completa: tinha 2 funcoes e 3 consertos de bug que a GOOD nao tinha).
const criarNfPessoa = require('../lib/nf-pessoa');
// b243 - FASE 1 (continuacao): os campos FISCAIS saem do registro.
// O `lib/empresas.js` ja tinha a ficha da AMB com os ids reais
// (idEmpresaControl, depositoGeral, naturezasDevolucaoIds, nfEntradaTipo) e
// os MESMOS padroes que rodam hoje. Aqui eles eram lidos do ambiente em 9
// pontos — cada um com sua propria cadeia de fallback escrita a mao.
const { obterEmpresa, envDaEmpresa } = require('../lib/empresas');
// ⚠️ b356: idem — mesma chave, um lugar so decide qual empresa este app e.
const FICHA_AMB = obterEmpresa(EMPRESA_DESTE_APP);



// ⚠️ b394 (Codex, P1) - O NOME DA EMPRESA NAS TELAS SAI DA FICHA.
//
// As telas de conexao e os avisos de OAuth diziam "AMBTotal" em 12 lugares.
// Montada a Girassol, o usuario dela leria "Bling da AMBTotal conectado" e
// "confira que o navegador esteja logado na conta da AMBTotal" — instrucao
// ERRADA, e justo na tela onde errar grava o token na conta errada.
const NOME_EMPRESA = (FICHA_AMB && FICHA_AMB.nome) || 'AMBTotal';

// ⚠️ b395 - a chave que o OUTRO servico usa nos caminhos dele.
//
// La o checkout mora em `/<chave>-checkout-offline` e o Magalu em
// `/magalu/ir/<chave>`. Uso `chaveDados` (a AMB e 'amb', nao 'ambtotal'),
// que e a mesma chave curta que o proxy da Shopee ja conhece.
// ⚠️ b401 - a etiqueta do log, tambem aqui no app.
//
// O teste do b400 varria so os modulos de `lib-AMB` — estes 3 no app
// ficaram de fora e continuavam dizendo `[AMB/...]` pra toda empresa.
// Varredura que nao cobre um arquivo da a impressao de que ele esta limpo.
const TAG_APP = String((CFG_EMPRESA && CFG_EMPRESA.PREFIXO_ENV) || PREFIXO_SEM_EMPRESA)
  .replace(/_$/, '');

// ⚠️ b403 (Codex) - O NOME DA ENV NOS TEXTOS DA TELA.
//
// O b394 trocou "AMBTotal" pelo nome da ficha, mas deixou os NOMES DAS
// VARIAVEIS: a tela ainda manda conferir `AMB_BLING_CLIENT_ID` e
// `AMB_MAGALU_TENANT_ID`.
//
// ⚠️ Quem estiver configurando a Girassol seguiria a instrucao e mexeria na
// variavel DA AMB — quebrando a empresa que esta no ar pra tentar ligar a
// nova. Nao mistura dado, mas manda a pessoa pro lugar errado.
const PREFIXO_ENV_EMPRESA = String((CFG_EMPRESA && CFG_EMPRESA.PREFIXO_ENV) || PREFIXO_SEM_EMPRESA);

// ⚠️ b405 - A PASTA DO CHECKOUT VEM DA FICHA, nao da chave.
//
// Eu montava `/<chave>-checkout-offline`. Vale pra AMB e GOOD — mas a
// Girassol no Mover-Pedidos e `girassol-BACKUP-offline`, nome historico.
//
// ⚠️ E eu escrevi no PR e no documento que "a pasta da Girassol nao existe
// la, o link dara 404". ERRADO: existe, com outro nome. O 404 seria culpa do
// meu caminho, nao falta de rota — e eu ia mandar alguem criar uma pasta que
// ja existia.
const PASTA_CHECKOUT = (FICHA_AMB && FICHA_AMB.pastaCheckout)
  || ((FICHA_AMB && FICHA_AMB.chaveDados) || SEM_EMPRESA) + '-checkout-offline';   // b661

// Codex (P2, PR #327) - o manifest-AMB.json ja saia com nome por empresa
// (rota abaixo), mas o titulo do atalho no iOS/Safari vinha DESTE HTML
// estatico, cravado "Devolucoes AMB" — quem instalasse pela Girassol via
// Safari via o atalho com o nome da AMB. O HTML e lido uma vez aqui (a
// empresa deste processo nao muda em runtime) e o titulo do iOS troca por
// cima, do mesmo jeito que a rota do manifest ja faz com os campos dela.
// ⚠️ Codex (revisão do PR #370, P2) - MESMO FURO, no título e nos <h1> da
// tela de login/app. So o atalho do iOS (acima) tinha sido trocado; quem
// só olhasse a tela (sem instalar) continuava lendo "AMBTotal" logada na
// Girassol. Mesmo padrão: troca o texto ESTÁTICO pelo nome da ficha.
// ⚠️ b447 - O TEMA DA EMPRESA, injetado no <head> de cada tela.
//
// O painel e compartilhado entre AMB e Girassol, e ate aqui era roxo pra
// todas. Cada ficha declara a paleta dela (`tema`), e este <style> redefine
// as variaveis do :root DEPOIS do styles.css — entao vence. A AMB declara
// exatamente os valores que ja estavam cravados: nao muda um pixel.
//
// 📌 Sem `tema` na ficha (empresa nova que nao declarou), fica o padrao do
// styles.css — o roxo. Melhor herdar que quebrar.
const TEMA = (FICHA_AMB && FICHA_AMB.tema) || null;
const STYLE_TEMA = TEMA ? `<style id="tema-empresa">
  :root {
    --roxo:${TEMA.marca}; --roxo-claro:${TEMA.marcaClaro};
    --marca:${TEMA.marca}; --marca-claro:${TEMA.marcaClaro};
    --sobre-marca:${TEMA.sobreMarca}; --marca-texto:${TEMA.marcaTexto};
    --marca-texto-2:${TEMA.marcaTexto2 || TEMA.marcaTexto};
    --escuro:${TEMA.escuro};
    --fundo:${TEMA.fundo}; --borda:${TEMA.borda};
    --texto:${TEMA.texto}; --apagado:${TEMA.apagado};
  }
</style>` : '';
const META_THEME = TEMA ? `<meta name="theme-color" content="${TEMA.themeColor}">` : null;

// aplica o tema num HTML: poe o <style> logo apos o styles.css e troca o
// theme-color. Uma funcao so, usada nas 4 telas.
function comTema(html) {
  if (!TEMA) return html;
  let out = html;
  // depois do styles.css, pra vencer na cascata. (O regex e a string ficam
  // em linhas separadas de proposito: aspas dentro do regex + `${}` na mesma
  // linha confundem o teste `duas-empresas-juntas`, que e textual.)
  const RE_LINK_CSS = /(<link rel=.stylesheet. href=.styles\.css[^>]*>)/;
  const injecao = '$1\n  ' + STYLE_TEMA;
  out = out.replace(RE_LINK_CSS, injecao);
  // se a tela nao tem styles.css, poe antes do primeiro <style>
  if (!out.includes('id="tema-empresa"')) out = out.replace(/<style>/, STYLE_TEMA + '\n  <style>');
  // (sem aspas dentro do regex — o teste textual as le como strings)
  if (META_THEME) out = out.replace(/<meta name=.theme-color. content=.[^>]*>/, META_THEME);
  return out;
}

// 14/10 - a MARCA (logo e icone) vem da ficha: sem isso a Girassol mostrava o logo e o icone da AMB na triagem e na aba
// do navegador. Sem `marca` na ficha, fica o da AMB (os arquivos de sempre).
const MARCA = require('../lib/marca-empresa').criarMarca(FICHA_AMB, { logo: 'logo-AMB.png', icone: 'icone-AMB.png' });   // peca multiloja em /lib
const ICONE_EMPRESA = MARCA.icone;
const comMarca = MARCA.aplicar;
const INDEX_AMB_HTML = comMarca(comTema(fs.readFileSync(
  path.join(__dirname, 'public-AMB', 'index-AMB.html'), 'utf8'
).replace(
  '<meta name="apple-mobile-web-app-title" content="Devolucoes AMB">',
  `<meta name="apple-mobile-web-app-title" content="Devolucoes ${((FICHA_AMB && FICHA_AMB.nome) || 'AMBTotal').split(' ')[0]}">`
).replace(
  '<title>AMBTotal - Devoluções Marketplaces</title>',
  `<title>${NOME_EMPRESA} - Devoluções Marketplaces</title>`
).replace(
  '<h1 style="display:inline-block;vertical-align:middle;">AMBTotal Devoluções</h1>',
  `<h1 style="display:inline-block;vertical-align:middle;">${NOME_EMPRESA} Devoluções</h1>`
).replace(
  '<h1>AMBTotal Devoluções</h1>',
  `<h1>${NOME_EMPRESA} Devoluções</h1>`
)));   // b447: fecha o comTema( — 14/10: e o comMarca(

// ⚠️ b406 (Codex, PR #345, P2) - A PASTA DO CHECKOUT no base-amb.js vinha de
// um 2o mapa de excecao cravado no front (so cobria a Girassol). Uma 4a
// empresa fora do padrao entraria na ficha (PASTA_CHECKOUT, acima) e nao
// nesse mapa, e o link desta tela divergiria do que o backend monta.
//
// 📌 Mesmo padrao do INDEX_AMB_HTML: le o arquivo uma vez (a empresa deste
// processo nao muda em runtime) e troca o marcador pelo valor da ficha.
const BASE_AMB_JS = fs.readFileSync(
  path.join(__dirname, 'public-AMB', 'js-AMB', 'base-amb.js'), 'utf8'
)
  // b513 (desenho do Codex, auditoria de 03/10): o SERVIDOR, que sabe qual empresa montou, entrega a rota e a
  // CHAVE DE DADOS da ficha — a chave nem sempre e a rota sem a barra. O navegador nao deduz nem cai na AMB/GOOD.
  .replace('"%%APP_BASE%%"', JSON.stringify(BASE))
  .replace('"%%APP_EMPRESA%%"', JSON.stringify(CHAVE_DADOS))
  .replace('"%%PASTA_CHECKOUT%%"', JSON.stringify(PASTA_CHECKOUT));

// ⚠️ Codex (revisão do PR #370, P2) - MESMO FURO do INDEX_AMB_HTML, agora no
// painel: título e <h1> diziam "AMBTotal" pra Girassol tambem.
const PAINEL_AMB_HTML = comTema(fs.readFileSync(
  path.join(__dirname, 'public-AMB', 'painel-AMB.html'), 'utf8'
).replace(
  '<title>AMBTotal - Painel de Devoluções</title>',
  `<title>${NOME_EMPRESA} - Painel de Devoluções</title>\n  <link rel="icon" type="image/png" href="${ICONE_EMPRESA}">`   // 14/10: o icone da aba e o da empresa
).replace(
  '<h1>👑 Painel de Devoluções — AMBTotal</h1>',
  `<h1>👑 Painel de Devoluções — ${NOME_EMPRESA}</h1>`
));   // b447: com o tema da empresa

// ⚠️ b359 - O VALOR DA COLUNA `empresa` NO BANCO, vindo da FICHA.
//
// Era o literal `'amb'` em 28 lugares. NAO e a `chave` ('ambtotal') nem o
// `prefixoRota` ('/amb') — e um terceiro identificador, e trocar pelo errado
// ORFANARIA todos os dados existentes da AMB.
//
// 📌 Com a ficha decidindo, a Girassol declara o dela e nao ha literal aqui.
//
// ⚠️ Sem `chaveDados` na ficha eu NAO adivinho: derrubo o boot. Silenciar
// com um padrao escreveria dado com a chave errada — e isso o dono so
// descobriria quando a tela viesse vazia.
// ⚠️ b422: o CHAVE_DADOS subiu — ver a validacao da ficha, antes dos clientes.
const envAmb = (nome, padrao) => envDaEmpresa(FICHA_AMB, nome, padrao);
const registrarRotasAdminNF = require('./lib-AMB/rotas-admin-AMB');
// b238 - UNIFICADO: era copia BYTE A BYTE da /lib. Medi os 9 modulos
// duplicados e este era 100% identico — ganho imediato, risco zero.
// [stated] "tá tudo em lib? se conectar mais outra empresa, ja ta tudo no
// esquema?" — nao estava: 9 modulos em copia, a AMB importava so 2 da /lib.
const criarMlBuscas = require('../lib/ml-buscas');
const registrarIdentificar = require('./lib-AMB/identificar-AMB');
const registrarCicloDefeitos = require('../lib/defeitos-ciclo');

// b310 - continuacao da revisao Codex #252, ainda so do lado GOOD: la, o
// defeito de estoque manual passou a gravar `tipo: 'problema'` (a tabela da
// GOOD nunca aceitou 'defeito_estoque'), e 2 dos 3 consumidores corrigidos
// (server.js /api/defeitos e /api/defeitos/por-sku) tinham um SELECT que
// nao trazia `shipment_id` - o novo reconhecedor (ehDefeitoDeEstoqueManual)
// sempre dava falso e a tela nunca mostrava o rotulo ESTOQUE. Aqui na AMB o
// defeito de estoque grava `tipo: 'defeito_estoque'` DIRETO (app-AMB.js:1481)
// e a tabela dela aceita esse valor de verdade - nao ha shipment_id sintetico
// nem SELECT faltando pra espelhar aqui.
// b312 - revisao Codex #265 foi so do lado GOOD (server.js): o gate da
// busca de produtos tratava indice com falha (`IDX_PROD.ts` preenchido +
// `erro`) como "montado" - a AMB nao tem catalogo de produtos nem rota
// /produtos/buscar (confirmado: sem IDX_PROD aqui) - nada a espelhar.
// b313 - as duas mudancas de hoje foram SO do lado GOOD; a AMB nao muda.
//
// ⚠️ Anoto as duas juntas porque cada uma veio de um PR diferente e o
// merge as colocou na mesma linha — perder uma apagaria o registro de
// por que a AMB ficou de fora.
//
// b313 - revisao Codex #269 tambem foi so do lado GOOD (lib/defeitos-
// ciclo.js): o fallback que marca a exclusao SO no `estado_atual` (b310)
// existe porque a tabela `devolucoes` da GOOD recusa `tipo:
// 'defeito_excluido'` no check constraint. Conferido: o
// defeitos-ciclo-AMB.js NAO tem esse fallback (so o /excluir "normal",
// que grava `tipo: 'defeito_excluido'` direto) - a tabela da AMB aceita
// esse valor, entao os bugs do fallback (filtro NOT ILIKE derrubando
// quem tem estado_atual NULL, classificacao que so olhava um status
// especifico, /restaurar e /estado sem reconhecer a marca) nao existem
// aqui - nada a espelhar.
//
// b313 - revisao Codex #268 (card do defeito aberto ganha borda inteira,
// e o fix seguinte que fecha o destaque + escopa a #caixaDefeitos) foi so
// em public/js/defeitos-ficha.js (GOOD). A AMB usa sua PROPRIA copia
// (js-AMB/defeitos-ficha.js, ainda em b291) e ela nao tem `marcarCardAberto`
// nem a classe `cardDefeito.aberto` (confirmado por grep) - o recurso nunca
// chegou aqui, entao nao ha nada a espelhar.
// b314 - revisao Codex #269 (rodada 2, 6 apontamentos novos sobre o fallback
// que marca a exclusao SO no `estado_atual`, GOOD): guarda atomica no PUT
// /estado, idempotencia no /excluir, ficha e relatorios reconhecendo a
// marca, filtro de estoque antes do .limit(), regex case-insensitive numa
// fonte unica (lib/defeito-excluido.js). Tudo dentro de lib/defeitos-ciclo.js
// e server.js (GOOD) - a tabela da AMB aceita `tipo: 'defeito_excluido'` de
// verdade (confirmado no #269 original), entao o fallback e os bugs dele
// nao existem aqui. Nada a espelhar.
// b315 - revisao Codex #270 (GOOD): excluir de dentro da lista chama
// buscarDefeitos() em vez de reabrir abrirBuscaDefeitos() (perdia a busca
// digitada e a rolagem), e a contagem por aba usa count exato no banco em
// vez do .limit(300/1000) da tela de itens. A AMB nunca ganhou o recurso
// "excluir fica na mesma aba" do #270 (js-AMB/defeitos-ciclo-AMB.js ainda
// conta com um unico buscar() sem aba nem paginacao, confirmado por grep) -
// nada a espelhar.
// b316 - revisao Codex #270 (rodada 2, GOOD): o count exato de contarAba()
// quebrava quando porPedido passa de MAX_IDS_NA_URL (a mesma condicao
// alargada "volta ao amplo" que ja existia antes deste PR, so que agora
// virando um head-count sem o filtro de JS por cima). A AMB nunca teve
// MAX_IDS_NA_URL nem contarAba() (mesmo grep do b315) - nada a espelhar.
// b317 - revisao Codex #272 (GOOD): fila do enriquecimento de fotos passa
// a reagir a pedido chegado NO MEIO da varredura, e a rota espera uma
// chance curta do passo priorizado antes de cair no Bling. A AMB nunca
// teve FOTOS_PEDIDAS/fotoDoIndice/enriquecerEansEmBackground (mesmo grep
// do b316) - nada a espelhar.
// b319 - revisao Codex #278, 2a rodada (GOOD): o corte `semBling` na rota
// de foto tinha que vir ANTES de anotarFotoPedida (que fura a fila de
// background do Bling), nao depois. A AMB nunca teve a tela de 46 cards
// nem o parametro semBling (mesmo grep do b317/b318) - nada a espelhar.
// b321 - revisao Codex #279 (GOOD): as rodadas de foto da tela de defeitos
// cancelam ao fechar a caixa/comecar outra busca, e a tela para de insistir
// numa variacao orfa que nunca vai ganhar foto. A AMB nunca ganhou o loop de
// rodadas (`buscarFotosDefeitos` de js-AMB/defeitos-ficha.js ainda faz uma
// passada so, confirmado por grep) - nada a espelhar.
// b322 - revisao Codex #279, 2a rodada (GOOD): pedido explicito de foto que
// falha por transitorio agora recoloca na fila do enriquecimento (com teto
// de tentativas), em vez de esperar a varredura inteira do catalogo
// terminar. A AMB nunca teve FOTOS_PEDIDAS/enriquecerEansEmBackground
// (mesmo grep do b317) - nada a espelhar.
// b323 - revisao Codex #290 (GOOD): o saldo de 401/403 no veredito de corte
// do token agora e por STATUS (um 401 ja resolvido por retry nao esconde
// mais um 403 pendente, e vice-versa). A AMB nunca consultou
// lib/token-leitor.js (os modulos lib-AMB/* nao honram essa politica,
// confirmado por grep) - nada a espelhar.
// b375 - revisao Codex no PR #323, 2a rodada: o `auth-AMB` tambem tira o
// fallback pro `ADMIN_KEY` (a 1a correcao do b374 tinha mantido -- o proprio
// apontamento do Codex citava os dois como fracos). Sem
// `<PREFIXO>SESSION_SECRET` proprio, o boot da empresa falha em producao,
// em vez de assinar sessao de admin com uma chave que ja vazou em logs.
// b378 - revisao Codex no PR #323, 3a rodada: `RENDER` tambem conta como
// producao pra exigir o segredo (nao so `NODE_ENV`); a instancia PADRAO do
// `auth-AMB` (a da AMB) deixa de ser validada so por o modulo ser
// `require`ido -- so quando alguem de fato usa os campos reexportados dela;
// e a sonda pos-RPC do provisionamento (lib/provisionar-empresa.js) passa a
// derrubar a chamada quando o erro na tabela NAO for "tabela ausente" (antes
// um erro de permissao, por exemplo, passava batido e a empresa saia
// "pronta" sem a tabela confirmada).
// b427/b428 - revisao Codex no PR #367 (2 rodadas): `scripts/sonda-empresa.js`
// (a sonda de pre-ativacao, GOOD/CLI) passou a conferir as 7 tabelas do
// provisionador com o sufixo da FICHA (nao de `chaveDados`), a reprovar eixo
// de token BLOQUEADO e chave Supabase que nao seja `service_role`, a
// exercitar o eixo `sombra`, a classificar "tabela ausente" so por
// 42P01/PGRST205 (nao por status HTTP cru), a por timeout em cada sonda de
// tabela e a reprovar empresa ja ativa. A AMB nunca chamou este script nem
// `lib/provisionar-empresa.js` (confirmado por grep) - nada a espelhar.
// b429 - revisao Codex no PR #367 (3a rodada): a mesma sonda passou a
// testar o token com uma chamada REAL de leitura ao Bling/ML (nao so
// olhar se veio string nao vazia), inclusive no eixo `local` (antes
// excluido da checagem). Continua GOOD/CLI-only - a AMB nao chama este
// script.
// b431 (Codex, PR #372) - corrige 5 apontamentos na rota
// `/api/ids-fiscais-auto` e no helper `lib/ids-fiscais-auto.js`: require
// que saia do repo, natureza de SAIDA aceita por engano, paginacao do
// catalogo do Bling, cache de leitura que falhou e rotulo de env trocado
// (a natureza descoberta e a de EMITIR, `ID_NATUREZA_DEVOLUCAO_ENTRADA`,
// nao a de BUSCAR, `NATUREZAS_DEVOLUCAO_IDS`).
// b444 - o b443 so passou `fundo` nas 2 chamadas de `/nfe` do laco do
// indice de nomes; a de `/pedidos/vendas`, tambem citada no apontamento
// original, ficou de fora. Ver nf-nomes-AMB.js.
// b445 (Codex, revisao do #379) - tres furos que sobraram do ritmo por
// empresa: 429 sem `semRetentativa` avisava o ritmo 2x (dobrava o backoff
// sozinho); o pre-aquecimento do boot nao se declarava `fundo` (e ignorava
// `IDX.viroufundo`); e o cancelamento por timeout no identificar so era
// checado ANTES de entrar na fila da empresa — nao antes de sair, entao um
// candidato ja desistido ainda batia no Bling depois de esperar numa pausa
// de 429. Ver bling-AMB.js, nf-nomes-AMB.js e identificar-AMB.js.
// 29/10: sem o 'AMB' na frente — a mesma peca serve Girassol, AMB e as proximas; a empresa vai no campo `empresa`
const VERSAO = 'Devolucoes b691';
const SUBIU_EM = new Date().toISOString();

const router = express.Router();

// b55 - LEVA 1a do porte GOOD -> AMB: rotas que a tela de bipe da GOOD usa
// e que a AMB nao tinha (busca de produto, EAN por SKU, foto de evidencia,
// status de triagem). As demais a AMB ja tem com outro nome — sao apontadas
// no proprio front quando os modulos JS forem portados (leva 2).


// ── AUTOSSUFICIENCIA DE PARSERS (b15) ────────────────────────
// BUG REAL pego em producao: no server.js da GOOD o
// cookieParser() esta na linha 148, e o /amb foi montado logo
// apos a 147 — ou seja, ANTES do leitor de cookies. Resultado:
// dentro deste router req.cookies vinha undefined e TODA rota
// com sessao respondia "sessao invalida", mesmo logado (o login
// em si funcionava porque criar cookie nao exige ler cookie).
// Agora o modulo le os proprios cookies e body — os dois
// middlewares abaixo pulam sozinhos quando o server ja fez o
// trabalho, entao nao ha custo em duplicar.
const cookieParser = require('cookie-parser');
router.use(express.json({ limit: '12mb' }));
router.use(cookieParser());

// ── Trava de admin ───────────────────────────────────────────
// ⚠️ b343 - GAVETA 2 de 3: ACESSO (chave na URL + falhas de login).
//
// Mesmo motivo da gaveta 1: com duas empresas no processo, o contador de
// uma somaria o da outra, e o bloqueio por tentativas erradas da Girassol
// travaria quem errou a senha na AMB.
//
// ⚠️ O de ACESSO.falhasLogin e o pior dos dois: nao e so numero errado, e
// USUARIO BLOQUEADO por erro de outra empresa.
// ⚠️ b353 - PASSO 3, FATIA 1: UMA FABRICA PARA AS 4 GAVETAS.
//
// `criarGavetasDaEmpresa` (e `criarGavetaNfDev`, que ela usa) agora vivem no
// escopo do MODULO, perto do topo do arquivo — ver comentario junto delas.
// Isso nao muda o comportamento aqui: cada chamada de `criarAppEmpresa`
// continua criando uma instancia nova de GAVETAS.
//
// ⚠️ A instancia de HOJE vem da fabrica — nao ha duas fontes do mesmo
// estado. Sem isto, a AMB usaria as gavetas soltas e quem chamasse a
// fabrica usaria outras, sem nada avisando (foi o erro que quase cometi no
// auth-AMB hoje).
const GAVETAS = criarGavetasDaEmpresa();


const ACESSO = GAVETAS.acesso;

function admin(req, res, next) {
  // b256 - ACEITA HEADER (ver a nota longa no server.js). A querystring
  // continua valendo durante a transicao: ele opera por links salvos, e
  // corta-la hoje quebraria o acesso dele sem aviso.
  const chave = process.env.ADMIN_KEY;
  const doHeader = req.get('x-admin-key');
  const recebida = doHeader || req.query.k;
  if (doHeader) {
    // marca que veio pelo caminho novo
  } else if (req.query.k) {
    ACESSO.usosQuerystring++;
  }
  if (!chave || recebida !== chave) {
    return res.status(404).json({ error: 'not found' });
  }
  next();
}

// ── State de uso unico pro OAuth ─────────────────────────────
// ⚠️ b343 - a ultima do app-AMB: os pedidos em triagem.
//
// Junto com ACESSO e CACHES, formam as 3 gavetas que o passo 3 vai criar
// POR EMPRESA. Hoje sao 3 objetos no escopo do modulo — que ainda vazariam
// se houvesse duas empresas, mas agora sao 3 pontos a mudar em vez de 11.
const TRIAGEM = GAVETAS.triagem;   // b353
const VALIDADE_MS = 10 * 60 * 1000;

function novoState(servico) {
  const s = crypto.randomBytes(24).toString('hex');
  TRIAGEM.pendentes.set(s, { servico, criado_em: Date.now() });
  for (const [k, v] of TRIAGEM.pendentes) {
    if (Date.now() - v.criado_em > VALIDADE_MS) TRIAGEM.pendentes.delete(k);
  }
  return s;
}

function consumirState(s) {
  const reg = TRIAGEM.pendentes.get(s);
  if (!reg) return null;
  TRIAGEM.pendentes.delete(s);
  if (Date.now() - reg.criado_em > VALIDADE_MS) return null;
  return reg;
}

/** Reclamacao em 2 cliques: o link certo por marketplace. */
function linksReclamacao(marketplace, d = {}) {
  if (marketplace === 'ml') {
    const alvo = d.pack_id || d.order_id;
    return alvo ? {
      rotulo: 'Abrir a venda no Mercado Livre',
      url: `https://www.mercadolivre.com.br/vendas/${alvo}/detalhe`,
    } : null;
  }
  if (marketplace === 'shopee') {
    return {
      rotulo: 'Abrir devolucoes na Shopee' + (d.return_sn ? ` (procure ${d.return_sn})` : ''),
      url: 'https://seller.shopee.com.br/portal/sale/return',
      copiar: d.return_sn || d.pedido || null,
    };
  }
  if (marketplace === 'magalu') {
    return { rotulo: 'Abrir devolucoes no Magalu Entregas', url: 'https://seller.magaluentregas.com.br/', copiar: d.pedido || null };
  }
  return null;
}

function redirectOAuth() {
  return cfg.redirectUri('/oauth/callback');
}

// ── Paginas ──────────────────────────────────────────────────
function pagina(titulo, corpo, cor) {
  return `<!DOCTYPE html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1419;color:#e6edf3;
margin:0;padding:24px;display:flex;justify-content:center}
.caixa{max-width:640px;width:100%}
h1{font-size:20px;margin:0 0 4px}
.sub{color:#8b949e;font-size:14px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:18px;margin-bottom:14px}
.btn{display:block;background:${cor || '#238636'};color:#fff;text-decoration:none;padding:14px 18px;
border-radius:8px;font-weight:600;text-align:center;margin-top:10px;font-size:16px}
.btn.cinza{background:#30363d}
.ok{color:#3fb950;font-weight:600}.erro{color:#f85149;font-weight:600}
code{background:#0d1117;padding:2px 6px;border-radius:4px;font-size:13px;word-break:break-all}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:6px 0;border-bottom:1px solid #21262d}
td:last-child{text-align:right;color:#8b949e}
.aviso{font-size:13px;color:#8b949e;margin-top:16px;line-height:1.5}
</style></head><body><div class="caixa">${corpo}</div></body></html>`;
}

// @fabrica-modulo lib-AMB/oauth-paginas-AMB.js#oauth-paginas
require('./lib-AMB/oauth-paginas-AMB')(router, { cfg, BASE, bling, ml, mlReturns, nfNomes, shopee, magalu, NOME_EMPRESA, PREFIXO_ENV_EMPRESA, envAmb, VERSAO, admin, novoState, redirectOAuth, pagina });   // @fabrica-chamada

// ⚠️ b415 - DECLARADA AQUI, ANTES DE QUEM USA.
//
// Eu tinha posto junto da fila, la embaixo (L3509) — e o callback do OAuth
// que a marca esta na L759. `const` nao sobe: se o dono concluisse o OAuth
// antes do boot terminar de ler o arquivo, daria ReferenceError por TDZ.
//
// 📌 `node --check` NAO pega isso. So percebi conferindo a ordem na mao.
const jaPreAquecidoPeloOAuth = { ml: false, magalu: false };

// @fabrica-modulo lib-AMB/oauth-callback-AMB.js#oauth-callback
require('./lib-AMB/oauth-callback-AMB')(router, { BASE, bling, ml, mlReturns, magalu, NOME_EMPRESA, PREFIXO_ENV_EMPRESA, consumirState, redirectOAuth, pagina, jaPreAquecidoPeloOAuth });   // @fabrica-chamada

// ── Status e config ──────────────────────────────────────────
router.get('/status', (req, res) => {
  const idx = mlReturns.statusIndice();
  res.json({
    ok: true,
    modulo: 'amb-devolucoes',
    empresa: cfg.NOME_EMPRESA,
    versao: VERSAO,
    subiu_em: SUBIU_EM,
    uptime_s: Math.round(process.uptime()),
    memoria_mb: Math.round(process.memoryUsage().rss / 1048576),
    // b442 - como conferir se o ritmo esta segurando: `pausas429` cresce
    // devagar (ou para) e `na_fila` mostra quem espera. Antes deste build
    // nao havia fila — o cliente martelava.
    ritmo_bling: (typeof bling.estadoRitmo === 'function') ? bling.estadoRitmo() : null,
    captura: (typeof CAPTURA !== 'undefined') ? CAPTURA.estado : null,   // b455: ultima gravacao em devolucoes_capturadas
    conectado: { bling: bling.temToken(), ml: ml.temToken(), ml_user: ml.userId() || null },
    indice_ml: { quente: idx.quente, construindo: idx.construindo, rastreios: idx.com_tracking, idade_min: idx.idade_min },
    indice_nomes: { quente: nfNomes.statusIndice().quente, nfs: nfNomes.statusIndice().total_nfs },
    login_configurado: auth.temUsuarios(),
    banco_ligado: db.ligado(),
  });
});

// @fabrica-modulo lib-AMB/diagnostico-AMB.js#diagnostico
require('./lib-AMB/diagnostico-AMB')(router, { cfg, BASE, bling, ml, mlReturns, nfNomes, tokens, shopee, emailAMB, NOME_EMPRESA, VERSAO, admin, TRIAGEM, redirectOAuth });   // @fabrica-chamada

// ── A TELA DO GALPAO ─────────────────────────────────────────
// O arquivo se chama index-AMB.html (e nao index.html) porque no
// mesmo repo ja existe o index.html da GOOD, e os dois se
// confundiam na pasta de Downloads. Como o nome nao e index, o
// express.static nao serve sozinho na raiz — por isso a rota
// explicita abaixo.
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.type('html').send(INDEX_AMB_HTML);
});

router.get('/painel', auth.requerLogin, (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');   // b19: tela nunca presa
  res.type('html').send(PAINEL_AMB_HTML);
});

// ── seg2 - MESMO FURO NA AMB, POR OUTRO CAMINHO ──────────────────────
// Aqui a rota /amb/painel ja passa por auth.requerLogin (logo acima), mas
// o express.static abaixo serve a pasta public-AMB INTEIRA — entao
// /amb/painel-AMB.html (e /amb/painel2-AMB.html) entregavam a mesma tela
// sem login nenhum, driblando a rota protegida.
//
// index-AMB.html continua publico (e a tela de login) e defeitos-AMB.html
// tambem, pelo mesmo criterio da GOOD: quem protege ali e a API.
// seg2.1 - mesma correcao da GOOD: decodificar antes de comparar (peca unica).
const { ehCaminhoProtegido: ehProtegidoAMB } = require('../lib/caminho-pedido');
function exigirLoginNoPainelHtml(req, res, next) {
  const ehPainel = ehProtegidoAMB(req.path, {
    exatos: ['/painel-AMB.html', '/painel2-AMB.html'],
  });
  if (ehPainel) return auth.requerLogin(req, res, next);
  return next();
}
router.use(exigirLoginNoPainelHtml);

// ═══════════════════════════════════════════════════════════════════
//  MODULOS COMPARTILHADOS COM A GOOD  (unificacao, 29/08)
//  ---------------------------------------------------------------
//  O base-amb.js sempre disse a intencao: "os modulos desta pasta sao
//  os arquivos da GOOD, SEM UMA LINHA ALTERADA" — ele so poe o prefixo
//  /amb em tempo de execucao. A copia era o MECANISMO de atualizacao,
//  e dependia de alguem lembrar de copiar.
//
//  Ninguem lembrou. Em 29/08 o leitor de etiqueta foi consertado so na
//  GOOD e a AMB — onde o problema tinha sido relatado — ficou pra tras.
//  Antes disso, a mesma coisa com o filtro de defeitos e a coluna de
//  data. O padrao se repete porque depende de memoria humana.
//
//  Agora os arquivos IDENTICOS sao servidos da pasta da GOOD. Some a
//  copia, some a chance de divergirem. Os que ainda diferem de verdade
//  (auth, busca, defeitos-ficha) continuam vindo de public-AMB, que e
//  montada logo abaixo e tem prioridade pra qualquer nome repetido.
//
//  Nada muda no HTML: ele continua pedindo js-AMB/<arquivo>.
// ═══════════════════════════════════════════════════════════════════
const JS_COMPARTILHADOS = [
  'app.js', 'bipagem.js', 'camera.js', 'colar-imagem.js',
  'etiqueta.js', 'helpers.js', 'ocr.js', 'scanner.js', 'triagem.js',
  'busca.js',   // b516: tela de bipe UNICA (era copia por empresa)
];

router.use('/js-AMB', (req, res, next) => {
  const nome = String(req.path || '').replace(/^\//, '');
  if (JS_COMPARTILHADOS.indexOf(nome) === -1) return next();   // vai pro static da AMB
  res.sendFile(path.join(__dirname, '..', 'public', 'js', nome), (err) => {
    if (err) next();   // sumiu da GOOD? cai pra copia local, se houver
  });
});

// Codex (PR #319, P2) - manifest-AMB.json tinha `start_url`/`scope` CRAVADOS
// em `/amb/`. Instalado como PWA sob `/girassol`, o atalho abriria a AMB (e
// o documento ficaria fora do `scope` declarado). O JSON estatico nao tem
// como saber sob qual prefixo esta instancia foi montada — so o router sabe
// (`BASE`, acima) — entao serve o arquivo aqui, com os 2 campos por cima.
router.get('/manifest-AMB.json', (req, res) => {
  // ⚠️ b382 - O NOME TAMBEM E POR EMPRESA, nao so o escopo.
  //
  // `start_url` e `scope` ja saiam da BASE. Mas o NOME continuava "AMBTotal
  // - Devolucoes" pra todas — e e o nome que o celular usa pra decidir se e
  // o mesmo app. Duas empresas com o mesmo nome se instalam como UM so, e a
  // segunda sobrescreve o atalho da primeira.
  //
  // 📌 O `id` fixa isso de vez: e o campo que a PWA usa pra identidade, e
  // sem ele o navegador cai no `start_url` — que ja diferia, mas nem todo
  // navegador respeita.
  const nomeEmpresa = NOME_EMPRESA;
  res.json(Object.assign({}, MANIFEST_AMB, {
    id: BASE + '/',
    name: nomeEmpresa + ' - Devolucoes',
    short_name: 'Devolucoes ' + nomeEmpresa.split(' ')[0],
    description: 'Triagem de devolucoes do galpao da ' + nomeEmpresa,
    start_url: BASE + '/',
    scope: BASE + '/',
    // 14/10: o icone do atalho instalado tambem e o da empresa
    icons: MARCA.iconesDoManifesto(MANIFEST_AMB.icons),
  }));
});

// b406 - serve o base-amb.js JA COM a pasta do checkout desta empresa (ficha
// resolvida no boot). Registrada antes do static abaixo pra ter prioridade
// no mesmo nome de arquivo.
// 14/10 - o modal Lancar defeito do PAINEL e o mesmo modulo da GOOD (public/js/lancar-defeito.js), servido daqui pra
// Girassol/AMB sem copia: o painel instala com o prefixo da empresa (APP_BASE). A ficha unica oferece o botao quando o
// modulo esta instalado.
const LANCAR_DEFEITO_JS = path.join(__dirname, '..', 'public', 'js', 'lancar-defeito.js');
router.get('/js-AMB/lancar-defeito.js', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.type('application/javascript').sendFile(LANCAR_DEFEITO_JS);
});
router.get('/js-AMB/base-amb.js', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');   // mesma licao do b19
  res.type('application/javascript').send(BASE_AMB_JS);
});

// Codex (revisão do PR #370, P2) - o seg2 (acima, exigirLoginNoPainelHtml)
// ja cobre o acesso direto a /painel-AMB.html pelo static; esta rota so
// garante que ESSE caminho tambem sirva a versao com o nome da empresa
// certo, e nao o arquivo cru (que o static abaixo serviria sem template).
router.get('/painel-AMB.html', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');   // mesma licao do b19
  res.type('html').send(PAINEL_AMB_HTML);
});

// ⚠️ b447 - painel2 e defeitos TAMBEM ganham o tema. Eles iam pelo
// express.static, cru — a Girassol abria essas duas roxas mesmo com o index
// e o painel ja amarelos. Tela compartilhada tem que receber o tema em TODA
// rota que a entrega, nao so nas que ja tinham substituicao.
const DEFEITOS_AMB_HTML = comTema(fs.readFileSync(
  path.join(__dirname, 'public-AMB', 'defeitos-AMB.html'), 'utf8'));
// b532 - UNIFICACAO DO PAINEL, passo 1 (dono, 04/10: "so usa o triagem e o painel admin"): o painel2 era uma copia
// mais antiga do painel-AMB (nenhuma funcao so dele, 19 a menos), que nenhuma tela linkava — cada ajuste de tela
// era feito nele tambem a toa. Aposentado: quem tiver o endereco salvo cai no painel de verdade.
router.get('/painel2-AMB.html', (req, res) => res.redirect(302, (req.baseUrl || '') + '/painel'));
router.get('/defeitos-AMB.html', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.type('html').send(DEFEITOS_AMB_HTML);
});

router.use(express.static(path.join(__dirname, 'public-AMB'), {
  // b19 - HTML sempre revalida (mesma licao da v3.64 da GOOD: o
  // navegador segurava a tela velha e o Diego via "tela b17" com
  // "servidor b18"). Imagens continuam com cache normal.
  //
  // 29/08 - havia DUAS chaves setHeaders neste objeto. Em JavaScript a
  // segunda apaga a primeira sem avisar, entao quem editasse a de cima
  // nao mudava nada. Ficou uma so.
  setHeaders: (res, caminho) => {
    if (String(caminho).endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// ── LOGIN DO GALPAO ──────────────────────────────────────────
// Estas rotas usam COOKIE, nao a ADMIN_KEY: quem usa e o
// estoquista no celular, que nao tem (nem deve ter) a chave.


// ── seg1.2 - FREIO DE FORCA-BRUTA NO LOGIN (2a rodada da review) ──────
// Historia: seg1 usava usuario+X-Forwarded-For (o cliente escolhe o header
// = furava); seg1.1 passou a usar so o usuario (= um estranho conseguia
// TRANCAR a conta de todo mundo, ainda mais com os nomes vazando no
// /health). Agora sao DOIS baldes, e nenhum deles pode ser fechado por
// terceiros:
//   1) usuario + cliente -> 8 falhas em 10 min = 429 por 5 min
//   2) cliente (IP)      -> 30 falhas em 10 min = 429 por 5 min (spray)
// O IP vem de req.ip com "trust proxy" ligado, ou seja, o endereco que o
// proxy do Render carimba - nao o primeiro valor que o cliente mandou.
// Quem esta de castigo NUNCA e despejado pelo teto (senao bastava encher
// o mapa pra zerar a punicao); com o mapa cheio, chave nova nao entra.
// (ACESSO.falhasLogin movido pra ACESSO.falhasLogin — b343)
const LOGIN_MAX_USUARIO = 8;
const LOGIN_MAX_CLIENTE = 30;
const LOGIN_JANELA_MS = 10 * 60 * 1000;
const LOGIN_CASTIGO_MS = 5 * 60 * 1000;
const LOGIN_TETO_CHAVES = 1000;

// seg1.3 (P2 da 3a rodada) - loginNome e a identidade COMPLETA (sem corte):
// e ela que resolve a conta e decide privilegio. O corte de 60 chars vive
// so na CHAVE do freio, senao duas contas com os mesmos 60 primeiros
// caracteres virariam a mesma identidade - e uma delas podia herdar admin.
function loginNome(usuario) {
  return String(usuario || '').trim().toLowerCase();
}
function loginIdent(usuario) {
  return loginNome(usuario).slice(0, 60);
}
const LOGIN_NOME_MAX = 100;   // seg1.4 - nome absurdo nem chega a ser processado
function loginIp(req) {
  return String((req && (req.ip || (req.socket && req.socket.remoteAddress))) || '').slice(0, 45);
}
function loginChaves(req, usuario) {
  const ip = loginIp(req);
  return { doUsuario: 'u:' + loginIdent(usuario) + '|' + ip, doCliente: 'c:' + ip };
}
function castigoRestante(chave, agora) {
  const reg = ACESSO.falhasLogin.get(chave);
  if (!reg || !reg.ate) return 0;
  if (agora < reg.ate) return Math.ceil((reg.ate - agora) / 1000);
  // seg1.5 (P2 da 5a rodada) - castigo cumprido zerava o balde INTEIRO, e
  // dentro da mesma janela de 10 min dava pra gastar 8 tentativas, esperar
  // os 5 min e gastar mais 8 (o dobro do limite anunciado). Agora so a
  // PUNICAO e liberada; a contagem sobrevive ate a janela fechar, entao o
  // proximo erro dentro dela volta a bloquear na hora. O acerto continua
  // limpando o balde do usuario naquele cliente.
  if (agora - reg.desde > LOGIN_JANELA_MS) { ACESSO.falhasLogin.delete(chave); return 0; }
  reg.ate = 0;
  ACESSO.falhasLogin.set(chave, reg);
  return 0;
}
function loginBloqueado(chaves) {
  const agora = Date.now();
  return Math.max(castigoRestante(chaves.doUsuario, agora), castigoRestante(chaves.doCliente, agora));
}
function podarFalhas(agora) {
  for (const [k, v] of ACESSO.falhasLogin) {
    if (agora - v.desde > LOGIN_JANELA_MS && (!v.ate || agora > v.ate)) ACESSO.falhasLogin.delete(k);
  }
  if (ACESSO.falhasLogin.size <= LOGIN_TETO_CHAVES) return;
  const descartaveis = [...ACESSO.falhasLogin.entries()]
    .filter(([, v]) => !(v.ate && agora < v.ate))     // em castigo fica
    .sort((a, b) => a[1].desde - b[1].desde);          // mais antigos primeiro
  let sobrando = ACESSO.falhasLogin.size - LOGIN_TETO_CHAVES;
  for (const [k] of descartaveis) {
    if (sobrando <= 0) break;
    ACESSO.falhasLogin.delete(k);
    sobrando -= 1;
  }
}
function marcarFalha(chave, limite, agora) {
  const existente = ACESSO.falhasLogin.get(chave);
  if (!existente && ACESSO.falhasLogin.size >= LOGIN_TETO_CHAVES) return;   // cheio de castigos: nao cria chave nova
  const reg = existente || { n: 0, desde: agora, ate: 0 };
  if (agora - reg.desde > LOGIN_JANELA_MS) { reg.n = 0; reg.desde = agora; reg.ate = 0; }
  reg.n += 1;
  if (reg.n >= limite) reg.ate = agora + LOGIN_CASTIGO_MS;
  ACESSO.falhasLogin.set(chave, reg);
}
// seg1.3 (P1 da 3a rodada) - com o mapa cheio, marcarFalha simplesmente
// nao registrava: um cliente novo ganhava tentativas ilimitadas (fail-OPEN).
// Agora, se nao ha capacidade nem chave existente, a tentativa e RECUSADA
// antes de olhar a senha - o limitador degrada FECHANDO, nao abrindo.
function loginSemCapacidade(chaves) {
  if (ACESSO.falhasLogin.size < LOGIN_TETO_CHAVES) return false;
  podarFalhas(Date.now());
  if (ACESSO.falhasLogin.size < LOGIN_TETO_CHAVES) return false;
  return !ACESSO.falhasLogin.has(chaves.doUsuario) && !ACESSO.falhasLogin.has(chaves.doCliente);
}
function loginErrou(chaves) {
  const agora = Date.now();
  podarFalhas(agora);
  marcarFalha(chaves.doUsuario, LOGIN_MAX_USUARIO, agora);
  marcarFalha(chaves.doCliente, LOGIN_MAX_CLIENTE, agora);
}
function loginAcertou(chaves) {
  // limpa so o balde do usuario naquele cliente; o do cliente segue
  // contando, senao um acerto no meio zeraria a varredura
  ACESSO.falhasLogin.delete(chaves.doUsuario);
}

router.post('/api/auth/login', (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) {
    return res.status(400).json({ ok: false, erro: 'informe usuario e senha' });
  }
  if (String(usuario).length > LOGIN_NOME_MAX) {
    return res.status(401).json({ ok: false, erro: 'usuario ou senha invalidos' });
  }
  const chavesFreio = loginChaves(req, usuario);
  const esperar = loginBloqueado(chavesFreio);
  if (esperar) {
    return res.status(429).json({ ok: false, erro: `muitas tentativas — tente de novo em ${Math.ceil(esperar / 60)} min` });
  }
  if (loginSemCapacidade(chavesFreio)) {
    return res.status(429).json({ ok: false, erro: 'sistema recebendo muitas tentativas de login — tente de novo em alguns minutos' });
  }
  const conta = auth.autenticar(String(usuario), String(senha));
  if (!conta) {
    loginErrou(chavesFreio);
    // Mensagem generica de proposito: nao dizer se o usuario
    // existe evita descobrir nomes validos por tentativa.
    return res.status(401).json({ ok: false, erro: 'usuario ou senha invalidos' });
  }
  loginAcertou(chavesFreio);
  // Guarda o nome na grafia CADASTRADA, nao como foi digitado —
  // assim o registro da triagem sai sempre igual no banco.
  const token = auth.novaSessao(conta.nome, conta.tipo);
  res.cookie(auth.COOKIE, token, auth.opcoesCookie());
  console.log(`[${TAG_APP}/LOGIN] ${conta.nome} (${conta.tipo})`);
  res.json({ ok: true, usuario: conta.nome, tipo: conta.tipo });
});

router.post('/api/auth/logout', (req, res) => {
  const t = auth.tokenDaRequisicao(req);
  if (t) auth.sair(t);
  res.clearCookie(auth.COOKIE, { path: auth.CAMINHO_COOKIE });
  res.json({ ok: true });
});

router.get('/api/auth/me', (req, res) => {
  const s = auth.validarSessao(auth.tokenDaRequisicao(req));
  if (!s) return res.json({ ok: false });
  res.json({ ok: true, usuario: s.usuario, tipo: s.tipo });
});

// Diagnostico do login (admin) - nunca devolve senha
router.get('/auth/diag', admin, (req, res) => {
  res.json({ ok: true, versao: VERSAO, login: auth.diagnostico() });
});

// ── TRIAGEM (o que o estoquista faz) ─────────────────────────

// @fabrica-modulo lib-AMB/triagem-api-AMB.js#triagem-api
require('./lib-AMB/triagem-api-AMB')(router, { auth, bling, mlReturns, nfNomes, marcadores, db, mkt, shopee, mlMotivo, emailAMB, nfEntrada, VERSAO, admin, linksReclamacao });   // @fabrica-chamada

// ── DEPOSITOS (a lista viva do Bling da AMB) ─────────────────
// b283 - os ids fiscais desta empresa, pro painel parar de te-los cravados.
// A natureza vem da API (achada pelo nome); o id da empresa nao tem API na
// v3 do Bling (GET /empresas da 404), entao vem de env por empresa.
// ⚠️ b430 - OS IDS FISCAIS, DESCOBERTOS E PRONTOS PRA COLAR.
//
// O dono, ligando a Girassol: "descobre ai pegando direto do Bling, senao vai
// me atrapalhar. tem que ter isso automatizado pra qualquer empresa nova."
//
// Ele esta certo. Ate aqui, ligar uma empresa exigia cacar 3 numeros no painel
// com o F12 — e 2 dos 3 a API entrega. Fazer a pessoa cacar o que a maquina
// sabe e trabalho inventado.
//
//   GET <base>/api/ids-fiscais-auto?k=ADMIN_KEY
//
// 📌 Responde o nome EXATO da env e o valor, pra copiar e colar no Render.
// ⚠️ E diz o que NAO deu, com os candidatos — nunca escolhe no empate.
router.get('/api/ids-fiscais-auto', admin, async (req, res) => {
  try {
    const { descobrirIdsFiscais } = require('../lib/ids-fiscais-auto');
    const d = await descobrirIdsFiscais(
      EMPRESA_DESTE_APP, bling.chamarBling, { semCache: req.query.refresh === '1' });
    if (!d.ok) return res.status(502).json(d);

    const pref = (FICHA_AMB && FICHA_AMB.prefixoFiscal) || '';
    const linha = (envSufixo, achado) => ({
      env: pref + envSufixo,
      valor: achado.id,
      via: achado.via,
      candidatos: achado.candidatos || undefined,
    });

    const paraColar = [
      linha('DEPOSITO_GERAL', d.depositoGeral),
      // ⚠️ (Codex, P1) - ID_NATUREZA_DEVOLUCAO_ENTRADA e a de EMITIR (a que
      // este modulo descobre); NATUREZAS_DEVOLUCAO_IDS e a de BUSCAR nota ja
      // emitida (outro campo, outro uso — scripts/plugar-empresa.js:262-263).
      linha('ID_NATUREZA_DEVOLUCAO_ENTRADA', d.naturezasDevolucaoIds),
      linha('ID_EMPRESA_CONTROL', d.idEmpresaControl),
    ];
    const faltam = paraColar.filter((x) => !x.valor);

    // ⚠️ b440 - OS ERROS DAS LISTAS APARECEM. Na Girassol o Bling devolveu 5
    // depositos e ZERO naturezas — e a rota dizia "NAO ACHEI natureza", como
    // se a lista tivesse vindo e nao tivesse a certa. Mas o modulo guarda
    // `erros` (HTTP 403, por exemplo), e eu nao mostrava.
    //
    // 📌 "Nao achei" e "nao consegui olhar" sao diagnosticos OPOSTOS: um manda
    // o dono cadastrar natureza no Bling; o outro manda marcar escopo no app.
    // Esconder o erro mandaria ele consertar a coisa errada.
    //
    // ⚠️ (Codex, PR #377, b441) - o aviso de "cheira a escopo" NAO pode
    // disparar so por `naturezas === 0`: uma empresa nova sem nenhuma
    // natureza cadastrada tambem le 0 (sem erro nenhum), e o aviso mandaria
    // ela mexer no escopo do app — o problema errado. So dispara quando a
    // LEITURA de naturezas falhou de verdade (`d.erros` com `lista ===
    // 'naturezas'`); lista vazia sem erro segue como "NAO ACHEI" (cadastrar).
    const erroNaturezas = d.erros && d.erros.find((e) => e.lista === 'naturezas');
    return res.json({
      ok: faltam.length === 0,
      empresa: d.empresa,
      lidos: d.lidos,
      erros_nas_listas: d.erros && d.erros.length ? d.erros : undefined,
      aviso: erroNaturezas
        ? `naturezas NAO deu pra ler (${erroNaturezas.erro}): cheira a ESCOPO `
          + 'faltando no app do Bling (Naturezas de operacao — leitura), nao '
          + 'a lista vazia'
        : undefined,
      para_colar_no_render: paraColar.filter((x) => x.valor),
      ainda_falta: faltam.length ? faltam : undefined,
      // ⚠️ o idEmpresaControl costuma cair aqui: o `GET /empresas` do Bling da
      // 404 e a v3 nao manda `idEmpresa` no /depositos. Esse sai do F12 mesmo.
      nota: faltam.some((x) => /ID_EMPRESA_CONTROL/.test(x.env))
        ? 'o ID_EMPRESA_CONTROL a API do Bling nao entrega: abra a empresa no '
          + 'painel e pegue o id da URL'
        : undefined,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String((e && e.message) || e).slice(0, 300) });
  }
});

router.get('/api/ids-fiscais', auth.requerLogin, async (req, res) => {
  res.json({ ok: true, ...(await bling.idsFiscais()) });
});

router.get('/api/depositos', auth.requerLogin, async (req, res) => {
  res.json({ ok: true, ...(await bling.listarDepositos(req.query.refresh === '1')) });
});

// diagnostico com 1 clique: quais depositos existem no Bling da AMB
router.get('/depositos', admin, async (req, res) => {
  res.json({ ok: true, versao: VERSAO, ...(await bling.listarDepositos(true)) });
});

/**
 * Lanca a ENTRADA de estoque da NF de devolucao no deposito
 * escolhido (mesma chamada da GOOD: POST /nfe/{id}/lancar-estoque/{dep}).
 * Exige o card com a devolucao VINCULADA (nf_devolucao_id_bling) —
 * sem o id, o Bling nao tem em qual nota lancar.
 */
router.post('/api/triagem/:id/lancar-estoque', auth.requerAdmin, async (req, res) => {
  const reg = await db.obterTriagem(req.params.id);
  if (!reg.ok) return res.status(404).json(reg);
  const t = reg.registro;
  if (!t.nf_devolucao_id_bling) {
    return res.status(400).json({ ok: false,
      erro: 'este card ainda nao tem a NF de devolucao VINCULADA - registre pela caixinha colando o LINK do Bling (o link traz o id)' });
  }
  // deposito precisa existir no Bling da AMB (whitelist viva)
  const deps = await bling.listarDepositos(false);
  const idDep = String((req.body || {}).deposito_id || '').trim();
  const dep = deps.ok ? (deps.depositos || []).find(d => d.id === idDep) : null;
  if (!dep) {
    return res.status(400).json({ ok: false, erro: 'deposito invalido ou lista indisponivel',
      depositos_validos: deps.ok ? deps.depositos : null });
  }

  const r = await bling.lancarEstoqueNf(t.nf_devolucao_id_bling, dep.id);
  if (!r.ok) return res.status(502).json(r);

  // marca no card; se as colunas nao existirem no banco, segue ok
  const upd = await db.atualizarTriagem(t.id, {
    estoque_lancado_em: new Date().toISOString(),
    estoque_deposito: dep.descricao,
  });
  res.json({ ok: true, deposito: dep.descricao,
    persistiu: upd.ok, aviso: upd.ok ? null : ('lancou no Bling, mas nao gravou no card: ' + upd.erro) });
});

/** NF de devolucao gerada no Bling -> registra o numero no card. */
router.put('/api/triagem/:id/nf-devolucao', auth.requerAdmin, async (req, res) => {
  let { numero, id_bling, texto } = req.body || {};
  // b20 - aceita o LINK do Bling colado inteiro: extrai o id do #edit/{id}
  if (!id_bling && texto) {
    const m = String(texto).match(/#edit\/(\d{6,})/) || String(texto).match(/\b(\d{9,})\b/);
    if (m) id_bling = m[1];
    if (!numero) { const mn = String(texto).match(/\b(\d{3,8})\b/); if (mn && mn[1] !== id_bling) numero = mn[1]; }
  }
  if (!numero && id_bling) {
    // completa o numero direto do Bling
    const rNf = await bling.chamarBling(`/nfe/${id_bling}`);
    const nf = rNf.ok && rNf.data && rNf.data.data;
    if (nf && nf.numero) numero = String(nf.numero);
  }
  if (!numero && !id_bling) {
    return res.status(400).json({ ok: false, erro: 'cole o numero OU o link da NF de devolucao no Bling' });
  }
  res.json(await db.atualizarTriagem(req.params.id, {
    nf_devolucao_numero: numero ? String(numero) : '(ver Bling)',
    nf_devolucao_id_bling: id_bling ? String(id_bling) : null,
  }));
});

/** Concluida: some das filas. */
router.post('/api/triagem/:id/concluir', auth.requerAdmin, async (req, res) => {
  res.json(await db.atualizarTriagem(req.params.id, { status: 'finalizado' }));
});

/** A Bridge da AMB grava aqui o resultado da NF gerada (mesmo
 *  contrato da GOOD: PUT registrar-devolucao-gerada/:id). */
router.put('/api/admin/registrar-devolucao-gerada/:id', auth.requerAdmin, async (req, res) => {
  const { nf_devolucao_id_bling, nf_devolucao_numero } = req.body || {};
  if (!nf_devolucao_id_bling && !nf_devolucao_numero) {
    return res.status(400).json({ ok: false, erro: 'sem dados da NF gerada' });
  }
  res.json(await db.atualizarTriagem(req.params.id, {
    nf_devolucao_id_bling: nf_devolucao_id_bling ? String(nf_devolucao_id_bling) : null,
    nf_devolucao_numero: nf_devolucao_numero ? String(nf_devolucao_numero) : null,
  }));
});

/** Debug com 1 clique: o que cada card da espreita esta recebendo
 *  de verdade + a saude dos indices e do enriquecimento. */
router.get('/debug/espreita', admin, async (req, res) => {
  const base = mlReturns.resumoEspreita();
  const um = (base.em_transito || [])[0] || (base.entregues || [])[0] || null;
  res.json({ ok: true, versao: VERSAO,
    indice_ml: mlReturns.statusIndice(),
    indice_nomes: nfNomes.statusIndice(),
    primeiro_item_cru: um,
    entregues_amostra: (base.entregues || []).slice(0, 2) });
});

// ── b334 — SONDA TikTok (frente devolucoes TikTok) ───────────
// Igual a da GOOD (lib/rotas-debug.js): puxa via ponte o que o
// Mover-Pedidos guarda das devolucoes TikTok. ?coletar=1&dias=60
// coleta antes; ?limite=N. Publico: /amb/api/debug/tiktok-devolucoes
//
// ⚠️ apontamento do Codex no PR #325 (P1): a empresa vinha CRAVADA
// ('ambtotal'), entao uma 2a empresa montada aqui consultaria a loja
// TikTok da AMB. Mesmo padrao ja usado em bling-AMB/ml-AMB/magalu-AMB:
// sai da ficha, com o mesmo literal so como fallback defensivo.
/* b502 - LER O ML na conta DESTA empresa (AMB/Girassol), como a GOOD ja tem em /api/debug/ml-get.
   Pra mapear com dado real a devolucao do FULL que volta pelo RETIRO (02/10, Marcos Vieira Lima:
   "revisado — solicite a retirada"; etiqueta da retirada sem NF, Ref. ID + codigo de barras) antes
   de programar o "vem pelo RETIRO" na fila e o bipe da etiqueta. So GET, so api.mercadolibre.com, admin. */
router.get('/api/debug/ml-get', admin, async (req, res) => {
  const p = String(req.query.path || '').trim();
  if (!p.startsWith('/') || p.startsWith('//')) return res.status(400).json({ ok: false, erro: 'informe ?path=/... (ex.: /orders/2000017621674072)' });
  try {
    const r = await ml.chamarML('https://api.mercadolibre.com' + p);
    return res.status(r.ok ? 200 : (r.status || 502)).json({ ok: !!r.ok, status: r.status, data: r.ok ? r.data : r.error });
  } catch (e) { return res.status(502).json({ ok: false, erro: String((e && e.message) || e) }); }
});

router.get('/api/debug/tiktok-devolucoes', admin, async (req, res) => {
  try {
    const r = await tiktokPonte.sondaDevolucoes(CFG_EMPRESA.CHAVE_REGISTRO || SEM_EMPRESA, req.query);   // b661
    res.status(r.ok ? 200 : 502).json(r);
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 200) });
  }
});

// b229 - a ultima espreita montada, pra busca por nome cruzar. Nivel do
// modulo, declarada ANTES de quem usa (o erro de escopo de ontem, 3x).
// ⚠️ b343 - GAVETA 3 de 3: CACHES DE LEITURA.
//
// A espreita (o que esta em transito / entregue) e as naturezas das notas.
// Com duas empresas, a Girassol veria os pacotes da AMB na tela de
// conferencia — e agiria em cima deles.
const CACHES = GAVETAS.caches;   // b353

// ── A ESPREITA (o que esta vindo pro galpao) ─────────────────
// ⚠️ b455 - A CAPTURA PERSISTENTE, que so a GOOD tinha (auditoria do Codex,
// 01/10). A GOOD grava o "a espreita" em `devolucoes_capturadas` uma vez por
// hora — assim o dado esta no banco quando o pacote chega, mesmo que o
// servidor reinicie ou o marketplace suma com a devolucao da API. A AMB e a
// Girassol so LIAM essa tabela (relatorio de refunds TikTok): nunca gravaram.
// "Portar tudo, sempre" — ficou pra tras aqui.
//
// 📌 Mesma lib da GOOD (`lib/devolucoes-capturadas`, que ja recebe a empresa
// como parametro), mesmo limite de 1x/hora. Liga na rota que monta o
// agregado — e a mesma lista que a tela mostra. Sem timer novo: o painel e
// aberto varias vezes por dia, e o throttle garante que nao grava a toa.
const CAPTURA = { ultima: 0, rodando: false, estado: { ultima: null, gravadas: 0, erro: null } };
// b674 - a sonda da empresa le este batimento pela chaveDados (lib/batimento-captura); mesma forma da GOOD
require('../lib/batimento-captura').registrarBatimento(CHAVE_DADOS, () => CAPTURA.estado);
// b675 - prova viva do Bling desta empresa: uma leitura pelo cliente vivo da instancia (renova pela cadeia dela se precisar)
require('../lib/batimento-captura').registrarProvaBling(CHAVE_DADOS, () => bling.chamarBling('/situacoes/modulos'));
// b676 - prova viva da Shopee desta empresa: a lista do proxy (cache 5 min) com a loja da ficha e a chave interna
require('../lib/batimento-captura').registrarProvaShopee(CHAVE_DADOS, () => shopee.buscarDevolucoesProxy(false));
const CAPTURA_INTERVALO_MS = 60 * 60 * 1000;
const CAPTURA_LIMITE_TIKTOK = 300;
function capturarDevolucoesEmpresa(emTransito, forcar) {
  const sb = db.cliente();
  if (!sb) { CAPTURA.estado.erro = 'Supabase nao configurado'; return; }
  if (CAPTURA.rodando) return;
  // b518 - AUDITORIA (Codex, 04/10): a janela de 1 h contava a TENTATIVA — banco falhou, ninguem tentava de
  // novo por 1 h. Agora: 1 h desde a ultima GRAVACAO BEM-SUCEDIDA; depois de falha, nova tentativa em 5 min.
  const _desde = CAPTURA.falhou ? (5 * 60 * 1000) : CAPTURA_INTERVALO_MS;
  if (!forcar && Date.now() - CAPTURA.ultima < _desde) return;
  CAPTURA.rodando = true;
  CAPTURA.ultima = Date.now();
  const linhas = (emTransito || []).map((d) => devCapturadas.traduzir(d, CHAVE_DADOS)).filter(Boolean);
  // o TikTok entra pela ponte, como na GOOD — e um erro la nao derruba o resto
  let erroTikTok = null;
  const comTikTok = tiktokPonte.sondaDevolucoes(CHAVE_DADOS, { limite: CAPTURA_LIMITE_TIKTOK })
    // b518 - AUDITORIA (Codex, 04/10, ALTA): lia `r.devolucoes`, mas a ponte entrega a lista em `r.cru.devolucoes`
    // (a GOOD ja lia certo) — o TikTok da AMB/Girassol NUNCA era capturado, e com `erro: null`. E a ponte devolve
    // ok:false (nao rejeita): sem este ramo, a falha virava lista vazia sem `tiktok_erro`.
    .then((r) => {
      if (!r || !r.ok) { erroTikTok = (r && r.erro) || 'ponte indisponivel'; return []; }
      if (!r.cru || !Array.isArray(r.cru.devolucoes)) { erroTikTok = 'a ponte respondeu sem a lista de devolucoes'; return []; }
      return r.cru.devolucoes
        .map((d) => devCapturadas.traduzir(tiktokDevCaptura.normalizar(d, CHAVE_DADOS), CHAVE_DADOS))
        .filter(Boolean);
    })
    .catch((e) => { erroTikTok = e.message; return []; });
  return comTikTok.then((extras) => devCapturadas.guardar(sb, linhas.concat(extras)))
    .then((r) => {
      CAPTURA.estado = {
        ultima: new Date().toISOString(),
        gravadas: (r && r.gravadas) || 0,
        tiktok_erro: erroTikTok || undefined,
        erro: (r && r.ok) ? null : ((r && r.erros) || ['falha desconhecida']).join(' | '),
      };
      // b528 - AUDITORIA (Codex, b520): TikTok com falha PASSAGEIRA (banco OK) tambem tenta de novo em 5 min; falta de
      // configuracao (loja nao mapeada, sem token) e permanente e segue a janela de 1 h.
      CAPTURA.falhou = !(r && r.ok) || !!(erroTikTok && !/mapead|configur|deslig|sem token|nao tem/i.test(String(erroTikTok)));   // b518/b528
      if (r && r.ok) console.log(`[${TAG_APP}/CAPTURA] ${r.gravadas} devolucoes guardadas`);
      else console.error(`[${TAG_APP}/CAPTURA] falhou: ${CAPTURA.estado.erro}`);
    })
    .catch((e) => { CAPTURA.falhou = true; CAPTURA.estado = { ...CAPTURA.estado, erro: e.message }; })
    .finally(() => { CAPTURA.rodando = false; });
}

// ⚠️ b476 - A ESPREITA MONTA SOZINHA (como na GOOD). Antes, o painel so montava
// quando alguem abria /api/espreita: a captura persistente (b455) ficava
// `ultima: null` por 8 horas se ninguem abrisse a tela, e as rotas que dependem
// do "a espreita montado" (/api/admin/orfaos, b465) exigiam abrir outra URL
// antes. Agora o miolo e uma funcao, a rota so a chama, e um relogio (90s apos
// o boot, depois a cada 3 min — o mesmo da GOOD) a mantem quente. A captura
// (1x/hora) e o indice de nomes (que ela dispara se frio) vem de brinde.
// b609 (Codex, #485): pack do ML com VARIOS pedidos. O indice de devolucoes so guarda `order_id` quando a reclamacao e de
// ORDER; de PACK traz so o resource_id, e o card nascia vazio. Resolve pack -> pedidos como a GOOD (server.js,
// resolverIdentidadeEspreita): 1 pedido = preenche; varios = `pack_varios_pedidos` (o painel avisa em vez de chutar).
// Cache por rastreio so de resultado conclusivo (falha passageira refaz) e teto de consultas novas por montagem.
const ESP_PACK_AMB = new Map();
async function resolverPacksEspreitaAMB(itens, orcamento = { novas: 0, limite: 20 }) {
  const saida = [];
  for (const x of (itens || [])) {
    if (!x || x.pedido || x.marketplace !== 'ml' || !x.tracking) { saida.push(x); continue; }
    let r = ESP_PACK_AMB.get(x.tracking);
    if (r === undefined && orcamento.novas < orcamento.limite) {
      orcamento.novas++;
      try {
        const achado = await mlReturns.acharPorTracking(x.tracking);
        if (achado && achado.order_id) {
          r = { pedido: String(achado.order_id) };
          ESP_PACK_AMB.set(x.tracking, r);
        } else if (achado && achado.resource === 'pack' && achado.resource_id) {
          const rPk = await ml.chamarML('/packs/' + achado.resource_id);
          if (rPk && rPk.ok) {
            const ordens = (rPk.data && Array.isArray(rPk.data.orders)) ? rPk.data.orders : [];
            r = { pack_id: String(achado.resource_id) };
            if (ordens.length === 1) r.pedido = String(ordens[0].id);
            else if (ordens.length > 1) { r.pack_varios_pedidos = ordens.length; r.pedidos_do_pack = ordens.map((o) => String(o.id)).slice(0, 10); }
            ESP_PACK_AMB.set(x.tracking, r);
          }
        }
      } catch (e) { /* sem identidade: o card segue como estava */ }
    }
    // b610 (Codex, #485): o item do indice nasce com order_id nulo, entao o resumo nao achou o PEDIDOS dele; com o
    // pedido resolvido, junta o que o enriquecimento (comprador/itens/NF) ja guardou — a cada montagem, sem cachear.
    saida.push(r ? { ...x, ...(r.pedido ? (mlReturns.infoPedido(r.pedido) || {}) : {}), ...r } : x);
  }
  return saida;
}

async function montarEspreitaAMB({ fundo = false } = {}) {
  // b29 - cada fonte com a propria rede de protecao: uma quebrar
  // NUNCA derruba as outras, e o erro vai ESCRITO pro painel.
  const vazio = { quente: false, em_transito: [], entregues: [], aguardando_postagem: 0 };
  let baseML = vazio, baseShopee = vazio, baseMagalu = vazio;
  let erroML = null, erroShopee = null, erroMagalu = null;
  try {
    baseML = mlReturns.resumoEspreita();
    const orcPacks = { novas: 0, limite: 20 };   // b610: UM teto por montagem, dividido entre as duas listas
    baseML = { ...baseML, em_transito: await resolverPacksEspreitaAMB(baseML.em_transito, orcPacks), entregues: await resolverPacksEspreitaAMB(baseML.entregues, orcPacks) };
  } catch (e) { erroML = e.message; }
  try { baseShopee = await shopee.resumoEspreita(); } catch (e) { erroShopee = e.message; }
  try { baseMagalu = magalu.resumoEspreita(); } catch (e) { erroMagalu = e.message; }
  if (!erroMagalu && baseMagalu && baseMagalu.erro) erroMagalu = baseMagalu.erro;   // b521: a falha do Magalu aparece (nao vira 'sem devolucoes')
  const stML = mlReturns.statusIndice();
  const stNomes = nfNomes.statusIndice() || {};
  // b36 - AUTOCURA do índice de NOMES (espelho da b29 pro ML): é ele
  // que dá cliente/NF/valor pra Shopee — frio = tela seca sem aviso.
  // b477 (Codex, P2): o relogio (`fundo`) NAO dispara a construcao — o indice
  // frio entra pela fila do pre-aquecimento (ML -> nomes -> NF entrada), que
  // existe pra nao competir por cota no boot. So a rota interativa autocura.
  if (!fundo && !stNomes.quente && !stNomes.construindo) {
    try { nfNomes.construirIndice().catch(() => {}); } catch (e) {}
  }
  const notas = await db.notasEspreita();
  const mapa = notas.ok ? notas.notas : {};

  // Junta a anotacao manual, o "NF de devolucao ja emitida ✓" e
  // esconde o que ja foi baixado.
  const idsPraNF = [];   // b35 - vendas cuja NF vamos buscar em background
  const enriquecer = (lista) => (lista || []).map(x => {
    const n = mapa[x.tracking] || mapa[x.pedido] || null;
    const nf = nfEntrada.jaEmitida({ pedido: x.pedido });
    // b17 - cliente e NF DA VENDA vem do indice de nomes (numeroLoja
    // do Bling = numero do pedido no marketplace, pros 3 canais)
    // b27 - venda de CARRINHO: o Bling grava o numero do PACK no
    // numeroLoja, nao o do pedido — cobrimos os dois + o numero da NF
    const venda = nfNomes.acharPorPedido(x.pedido)
      || nfNomes.acharPorPedido(x.pack_id)
      || nfNomes.acharPorNumero(x.nf_ml_numero);
    // b34 - Shopee/TikTok/Amazon: sem NF casada, a VENDA do Bling
    // (numeroLoja garantido) entrega cliente e valor mesmo assim.
    // b38 - vendaLoja tambem pelo PACK (ML de carrinho grava numeroLoja
    // = pack_id, nao order_id) — sem isso a NF-pela-venda nunca
    // disparava pros cards ML de carrinho, e por isso a 🧾 sumia deles.
    const vendaLoja = venda ? null
      : (nfNomes.acharVendaPorLoja(x.pedido) || nfNomes.acharVendaPorLoja(x.pack_id));
    // id da venda pra buscar a NF vinculada — de qualquer fonte que tenha
    const idVendaNF = (venda && venda.id_venda) || (vendaLoja && vendaLoja.id_venda) || null;
    // b39 - a NF-pela-venda agora e lida por numeroLoja (a chave que o
    // card SEMPRE tem: x.pedido ou x.pack_id), nao por id_venda (que
    // dependia do vendaLoja resolver). A busca em background preenche.
    const chaveLoja = x.pedido || x.pack_id || null;
    const nfv = (!x.nf_ml_numero && !(venda && venda.numero))
      ? (nfNomes.nfDaLoja(x.pedido) || nfNomes.nfDaLoja(x.pack_id) ||
         (idVendaNF ? nfNomes.nfDaVenda(idVendaNF) : null)) : null;
    // enfileira {id, loja} pro disparo indexar nos dois mapas
    if (!x.nf_ml_numero && !(venda && venda.numero) && idVendaNF && !nfv) {
      idsPraNF.push({ id: idVendaNF, loja: chaveLoja });
    }
    // b47 - FULL: a NF do Full (Shopee serie 5, ML/Magalu Full serie 2/3/4)
    // entra por XML SEM numeroPedidoLoja, entao nao casa por pedido nem tem
    // venda-mae. Mas o NOME do cliente casa. Se nenhuma via achou a NF ainda,
    // busca por nome no indice em memoria (sincrono). O cliente vem da venda,
    // vendaLoja ou do proprio marketplace.
    const jaTemNf = !!(x.nf_ml_numero || (venda && venda.numero) || (nfv && nfv.numero));
    const nomeCli = (venda && venda.nome) || (vendaLoja && vendaLoja.nome) || x.cliente_ml || x.cliente || null;
    const nfNome = (!jaTemNf && nomeCli) ? nfNomes.acharNfPorNomeIndice(nomeCli) : null;
    // b18 - link direto pro marketplace, pedido do Diego no painel
    let link = null;
    if (x.marketplace === 'ml' && x.pedido) {
      link = `https://www.mercadolivre.com.br/vendas/${x.pedido}/detalhe`;
    } else if (x.marketplace === 'shopee' && x.pedido) {
      // b29 - a rota do Mover-Pedidos faz o de-para order_sn -> id
      // interno e cai DENTRO do pedido (mesma solucao dos checkouts;
      // exige a conta Shopee da AMB logada no navegador de destino)
      // ⚠️ b395 (Codex, P1) - O LINK CITA A EMPRESA, e era 'amb' cravado.
      //
      // Montada a Girassol, a seta ↗ do card dela abriria o pedido no
      // checkout DA AMBTOTAL — a tela mostraria a venda de outra empresa,
      // sem nada avisar.
      //
      // 📌 Conferi no outro repo: o prefixo la segue `/<empresa>-checkout-
      // offline` (existem `amb-` e `good-`). Entao monto pela ficha.
      //
      // ⚠️ A pasta da Girassol ainda NAO existe la: o link dela dara 404 ate
      // alguem criar. E o certo — 404 e erro visivel; abrir o pedido da AMB
      // e numero errado, que e pior.
      link = 'https://mover-pedidos-aguardando-x-atendido.onrender.com/'
        + PASTA_CHECKOUT + '/ir-shopee?sn=' +
        encodeURIComponent(x.pedido);
    } else if (x.marketplace === 'magalu' && x.pedido) {
      // b29 - modulo magalu-oauth (API oficial): resolve o UUID do
      // pacote e abre a tela exata do pedido no portal
      // ⚠️ b395: idem. E aqui a rota de la JA aceita a empresa no path
      // (`/magalu/ir/<empresa>`), conferido no repo Mover-Pedidos — nao
      // depende de mudanca nenhuma fora daqui.
      // ⚠️ o Magalu segue a CHAVE (a rota la e `/magalu/ir/<empresa>`), nao a
      // pasta — sao dois identificadores diferentes no mesmo servico.
      link = 'https://mover-pedidos-aguardando-x-atendido.onrender.com/magalu/ir/'
        + ((FICHA_AMB && FICHA_AMB.chaveDados) || SEM_EMPRESA) + '?n=' +   // b661
        encodeURIComponent(x.pedido);
    }
    // 29/10: a NF de devolucao tambem e reconhecida pela NF DE VENDA que ela referencia no XML (vale pra nota feita
    // a mao no Bling). So fonte FIRME da NF de venda (ML, pedido, loja) — o palpite pelo nome fica de fora: marca
    // errada esconderia uma devolucao pendente (e o botao de baixa em massa usa esta marca).
    const nfVendaFirme = x.nf_ml_numero ? { n: x.nf_ml_numero, s: x.nf_ml_serie }
      : (venda && venda.numero) ? { n: venda.numero, s: venda.serie }
      : (nfv && nfv.numero) ? { n: nfv.numero, s: nfv.serie } : null;
    // marca SEPARADA, so quando veio da prova do XML (o indice por pedido nao filtra cancelada nem natureza)
    const nfXml = nfVendaFirme ? nfEntrada.jaEmitida({ nfVenda: nfVendaFirme.n, serieVenda: nfVendaFirme.s }) : null;
    const nfDev = (nf && nf.emitida === true) ? nf : (nfXml && nfXml.emitida === true ? nfXml : nf);
    return {
      ...x,
      link_marketplace: link,
      cliente: (venda && venda.nome) || (vendaLoja && vendaLoja.nome) || x.cliente_ml || null,
      // 29/10 (dono: a tosquiadeira 2609069UWS4UFX, venda NF 126747, apareceu com 'NF 126807' depois de um deploy).
      // Com os mapas venda->NF ainda enchendo, o card caia no PALPITE PELO NOME — e cliente que comprou mais de uma vez
      // pegava a NF de OUTRA compra, mostrada como certa. A captura guardada grava este campo como a NF da venda
      // (devolucoes-capturadas: nf_numero), entao o palpite virava dado. Agora: nf_venda/nf_serie/link so de fonte
      // FIRME (ML, venda pelo pedido, loja) — como a GOOD, que usa a busca blindada pelo pedido. O palpite vai pra
      // nf_venda_provavel, marcado, e nunca e salvo como NF. Numero ausente e melhor que numero errado.
      nf_venda: x.nf_ml_numero || (venda && venda.numero) || (nfv && nfv.numero) || null,
      // b38 - serie da NF, da mesma fonte que deu o numero
      nf_serie: x.nf_ml_serie || (venda && venda.serie) || (nfv && nfv.serie) || null,
      nf_venda_provavel: (!jaTemNf && nfNome && nfNome.numero)
        ? { numero: nfNome.numero, serie: nfNome.serie || null, id_bling: nfNome.id || null, via: 'nome do cliente' } : null,
      nf_valor: (venda && venda.valor != null) ? venda.valor
        : (vendaLoja && vendaLoja.valor != null) ? vendaLoja.valor
        : (x.valor_venda != null ? x.valor_venda : null),
      link_nf_bling: (venda && venda.id) ? ('https://www.bling.com.br/notas.fiscais.php#edit/' + venda.id) : null,
      comentario: n && n.comentario, ticket: n && n.ticket,
      baixado: !!(n && n.baixado),
      nf_devolucao_xml: !!(nfXml && nfXml.emitida === true && nfXml.via === 'xml'),
      nf_devolucao_emitida: nfDev.emitida === true ? (nfDev.nf && nfDev.nf.numero) || true : false,
    };
  }).filter(x => !x.baixado);

  const emTransito = [
    ...enriquecer(baseML.em_transito),
    ...enriquecer(baseShopee.em_transito),
    ...enriquecer(baseMagalu.em_transito),
  ].sort((a, b) => (a.dias_em_transito ?? 9999) - (b.dias_em_transito ?? 9999));
  // b31 - pedido do Diego: TUDO junto (ML + Shopee + Magalu misturados)
  // e sempre o MAIS RECENTE em cima, o mais antigo embaixo.

  // b19 - pedidos ML que ainda estao sem itens/apelido: dispara o
  // enriquecimento agora, em background; a proxima atualizacao da
  // tela (4 min) ja vem preenchida.
  const pendentes = emTransito
    .concat(enriquecer(baseML.entregues))
    .filter(x => x.marketplace === 'ml' && !x.itens && x.pedido)
    .map(x => String(x.pedido)).slice(0, 60);
  // b36 - só dispara com o índice QUENTE: a busca de NF não pode
  // concorrer no Bling com a CONSTRUÇÃO (429 abortaria o build).
  if (stNomes.quente) nfNomes.dispararNfPorVenda(idsPraNF);
  if (pendentes.length) mlReturns.enriquecerLista(pendentes).catch(() => {});

  // b229 (Codex): guardo o resultado pra busca por nome cruzar com a MESMA
  // lista que a tela mostra — ML + Shopee + Magalu, enriquecida, sem os
  // baixados e sem os que vao pro CD do ML. Reimplementar a agregacao no
  // identificar-AMB (como eu tinha feito, lendo so o mlReturns cru) perdia
  // dois canais e mostrava estrela em pacote ja processado.
  // 30/10: tira o que JA FOI TRIADO (lib/espreita-ja-triadas — a regra que a GOOD ja tinha). A captura acima segue
  // recebendo a lista inteira (e o registro do que o marketplace diz); a TELA e a busca nao mostram o que ja foi bipado.
  const entreguesBrutas = [...enriquecer(baseML.entregues), ...enriquecer(baseShopee.entregues || [])];
  const triadas = await espreitaTriadas.chavesTriadas(db.cliente(), db.tabelas && db.tabelas.devolucoes, entreguesBrutas.concat(emTransito));
  if (!triadas.ok) console.error(`[ESPREITA ${CHAVE_DADOS}] triagens nao conferidas (lista vai inteira):`, triadas.erro);
  const entreguesFinal = espreitaTriadas.semTriadas(entreguesBrutas, triadas.achados)
    .sort((x, y) => (x.dias_desde ?? 9999) - (y.dias_desde ?? 9999));
  const emTransitoFinal = espreitaTriadas.semTriadas(emTransito, triadas.achados, { soShopee: true });   // como a GOOD (v3.79)
  CACHES.espreita = {
    em_transito: emTransitoFinal.filter((x) => !x.no_cd_ml),
    entregues: entreguesFinal,
    ts: Date.now(),
  };
  // b477 (Codex, P2): a montagem do relogio, com fonte ainda fria, NAO gasta a
  // vaga de 1h da captura (voltaria vazia e as de 3 min seriam barradas).
  const fonteFria = fundo && ((ml.temToken() && !baseML.quente)
    || (!baseMagalu.desligada && !baseMagalu.quente));
  // b521 - AUDITORIA (Codex, 04/10): o corte de 60 da Shopee e da TELA; a captura recebe tambem as que passaram dele
  const extrasShopee = (baseShopee && Array.isArray(baseShopee.em_transito_todas)) ? baseShopee.em_transito_todas.slice((baseShopee.em_transito || []).length) : [];
  if (!fonteFria) capturarDevolucoesEmpresa(emTransito.concat(extrasShopee));   // b455: guarda no banco, 1x/hora (nao bloqueia a resposta)
  return ({
    ok: true,
    versao: VERSAO,
    // b293 (teste dele, 19/08: "espreita nao trouxe resultado (...) Mercado
    // Livre: pronta · Shopee: pronta · Magalu: pronta · Índice de nomes:
    // pronta") - ESTE CAMPO NUNCA FOI PORTADO DA GOOD. O painel testa
    // `if (!d.ok || !d.quente)` e cai no aviso "ainda nao da pra montar a
    // lista"; sem `quente` no topo, `undefined` e sempre falso, entao a tela
    // ficava presa no aviso **mesmo com as quatro fontes prontas e a lista
    // pronta logo abaixo, no mesmo JSON**. Na GOOD a linha existe desde
    // sempre (server.js: `quente: magaluR.quente || mlR.quente || shopeeR.quente`).
    // Basta UMA fonte quente pra ter o que mostrar; as outras aparecem
    // quando aquecerem, e o bloco de fontes segue dizendo o estado de cada uma.
    quente: !!(baseML.quente || baseShopee.quente || baseMagalu.quente),
    fontes: {
      ml: { quente: baseML.quente, construindo: !!stML.construindo,
            erro: erroML || stML.erro || null, total_claims: stML.total_claims || 0 },
      shopee: { quente: baseShopee.quente, desligada: !!baseShopee.desligada, erro: erroShopee || baseShopee.erro || null,
                chegadas: baseShopee.chegadas || null },
      // b521 - AUDITORIA: o Magalu mostra o ERRO e a idade da lista (falha nao parece 'sem devolucoes')
      magalu: { quente: baseMagalu.quente, desligada: !!baseMagalu.desligada, falta: baseMagalu.falta || null,
                erro: erroMagalu || null, idade_min: (baseMagalu.idade_min != null ? baseMagalu.idade_min : null) },
      nf_entrada: nfEntrada.statusIndice(),
      nomes: { quente: !!stNomes.quente, construindo: !!stNomes.construindo,
               erro: stNomes.erro || stNomes.erro_busca || stNomes.erro_vendas || null,
               nfs: (stNomes.total_nfs != null ? stNomes.total_nfs : null),
               vendas: (stNomes.vendas_com_loja != null ? stNomes.vendas_com_loja : null) },
    },
    em_transito: emTransitoFinal,
    atrasadas_30d: emTransitoFinal.filter(x => (x.dias_em_transito || 0) > 30).length,
    triadas_ocultas: triadas.ok ? (entreguesBrutas.length - entreguesFinal.length) + (emTransito.length - emTransitoFinal.length) : null,
    aguardando_postagem: baseML.aguardando_postagem,
    entregues: entreguesFinal,
  });
}

// b477 (Codex, P2): UMA montagem por vez — rota e relogio dividem a mesma promise.
let ESP_AMB_MONTANDO = null;
function montarEspreitaAMBUnica(opcoes) {
  if (ESP_AMB_MONTANDO) return ESP_AMB_MONTANDO;
  ESP_AMB_MONTANDO = montarEspreitaAMB(opcoes).finally(() => { ESP_AMB_MONTANDO = null; });
  return ESP_AMB_MONTANDO;
}

router.get('/api/espreita', auth.requerLogin, async (req, res) => {
  res.json(await montarEspreitaAMBUnica());
});

/* b504 - pedido do dono (02/10): o bipe da ETIQUETA DE RETIRADA do Full nao acha nada (o codigo dela nao
   existe na API do ML — provado com os dados do caso Marcos). Esta rota leve, pra tela do galpao (login de
   funcionario), lista SO as pecas que a espreita marcou "vem pelo RETIRO" (#414): o bipe mostra essas pra
   escolher quando o codigo nao e encontrado. */
router.get('/api/espreita/retiro', auth.requerLogin, (req, res) => {
  try {
    const base = mlReturns.resumoEspreita() || {};
    const itens = (base.em_transito || []).filter((x) => x && x.vem_pelo_retiro)
      .map((x) => ({ pedido: x.pedido, status: x.status, tracking: x.tracking || null, dias: x.dias_em_transito || null }));
    return res.json({ ok: true, itens });
  } catch (e) { return res.json({ ok: false, itens: [], erro: String((e && e.message) || e) }); }
});


function preAquecerEspreitaAMB(motivo) {
  return montarEspreitaAMBUnica({ fundo: true })
    .then((r) => { console.log(`[${TAG_APP}/ESPREITA] pre-aquecida (${motivo}): ${(r && r.em_transito && r.em_transito.length) || 0} a caminho, ${(r && r.entregues && r.entregues.length) || 0} entregues`); })
    .catch((e) => { console.warn(`[${TAG_APP}/ESPREITA] pre-aquecimento falhou (${motivo}):`, e && e.message); });
}
// b477 (Codex, P2): timers da drenagem — o processo velho do deploy para de trabalhar
drenagem.daquiA(() => preAquecerEspreitaAMB('boot'), 90 * 1000);
drenagem.intervalo(() => preAquecerEspreitaAMB('relogio'), 3 * 60 * 1000);

router.post('/api/espreita/nota', auth.requerLogin, async (req, res) => {
  const { chave, marketplace, comentario, ticket, baixado } = req.body || {};
  if (!chave) return res.status(400).json({ ok: false, erro: 'falta a chave' });
  res.json(await db.notaEspreita({ chave, marketplace, comentario, ticket, baixado }));
});

// ── RECADOS PRO ESTOQUISTA ───────────────────────────────────
router.get('/api/recados', auth.requerLogin, async (req, res) => {
  res.json(await db.listarRecados({ resolvidos: req.query.resolvidos === '1' }));
});

router.post('/api/recados', auth.requerLogin, async (req, res) => {
  const { identificador, texto } = req.body || {};
  if (!identificador || !texto) {
    return res.status(400).json({ ok: false, erro: 'informe identificador e texto' });
  }
  res.json(await db.criarRecado({ identificador, texto, criadoPor: req.usuario }));
});

router.post('/api/recados/:id/ciente', auth.requerLogin, async (req, res) => {
  res.json(await db.marcarCiente(req.params.id, req.usuario));
});

router.post('/api/recados/:id/resolver', auth.requerLogin, async (req, res) => {
  res.json(await db.resolverRecado(req.params.id));
});

// ── DEFEITOS ─────────────────────────────────────────────────
router.get('/api/defeitos', auth.requerLogin, async (req, res) => {
  res.json(await db.listarDefeitos({ busca: req.query.q }));
});

/** Lancar produto que JA esta quebrado no galpao (nao veio de devolucao). */
router.post('/api/defeitos/lancar', auth.requerLogin, async (req, res) => {
  const { sku, descricao, localizacao, quantidade } = req.body || {};
  if (!sku || !localizacao) {
    return res.status(400).json({ ok: false, erro: 'informe ao menos sku e localizacao' });
  }
// b258 (regra dele: "é esse o SKU que vai comandar") - o de-para vale
  // TAMBEM na hora de GRAVAR. Sem isto, a peca entrava no estoque de
  // defeitos com o codigo aposentado do anuncio Full: o alerta de
  // canibalizacao nao casaria com as unidades do codigo atual, e a NF
  // de devolucao sairia com um SKU que nao existe mais no cadastro.
  let skuUsar = String(sku);
  let skuOriginal = null;
  if (db && typeof db.resolverSku === 'function') {
    try {
      const dp = await db.resolverSku(skuUsar);
      if (dp && dp.trocado && dp.sku) { skuOriginal = skuUsar; skuUsar = dp.sku; }
    } catch (e) { /* de-para e ajuda, nunca trava o registro */ }
  }
  // Valida o SKU no Bling antes de gravar: evita defeito fantasma
  // por causa de um codigo digitado errado.
  const prod = await bling.buscarProdutoPorSku(skuUsar);
  const exato = prod.ok ? prod.exato : null;

  const r = await db.registrarTriagem({
    tipo: 'defeito_estoque',
    status: 'concluido',
    produto_sku: exato ? exato.codigo : skuUsar,   // b258 - SKU atual manda
    produto_titulo: exato ? exato.nome : null,
    problema_descricao: descricao || null,
    localizacao,
    defeito_qtd: Number(quantidade || 1),
    funcionario: req.usuario,
  });
  res.json({ ...r, sku_validado_no_bling: !!exato });
});

/** Ha o mesmo SKU guardado em defeito? (canibalizacao) */
router.get('/api/defeitos/sku', auth.requerLogin, async (req, res) => {
  res.json(await db.defeitosDoSku(req.query.sku));
});

router.post('/api/defeitos/peca', auth.requerLogin, async (req, res) => {
  const { defeito_id, peca, usada_em } = req.body || {};
  res.json(await db.registrarPecaRetirada({ defeitoId: defeito_id, peca, usadaEm: usada_em, quem: req.usuario }));
});

// ── SHOPEE / MAGALU / NF-ENTRADA (diagnostico e indices) ─────
router.get('/shopee/teste', admin, async (req, res) => {
  try {
    const lista = await shopee.buscarDevolucoesProxy(req.query.refresh === '1');
    res.json({ ok: true, versao: VERSAO, loja: shopee.cfg.loja, ativo: shopee.cfg.ativo,
      total: Array.isArray(lista) ? lista.length : null,
      amostra: Array.isArray(lista) ? lista.slice(0, 2) : null });
  } catch (e) {
    res.json({ ok: false, loja: shopee.cfg.loja, erro: e.message,
      dica: 'se o erro for loja desconhecida, o shopee-nf-sync nao tem a loja amb cadastrada' });
  }
});

router.get('/magalu/status', admin, (req, res) => {
  res.json({ ok: true, versao: VERSAO, magalu: magalu.statusIndice() });
});

router.get('/magalu/indice/construir', admin, (req, res) => {
  magalu.construirIndice().catch(e => console.error(`[${TAG_APP}/MAGALU]`, e.message));
  res.json({ ok: true, iniciado: true });
});

// b152 - sonda do bipe Magalu: testa o acharDevolucao por dentro, sem a
// tela. Ex: /amb/magalu/achar?codigo=2026062600477033&k=ADMIN_KEY
router.get('/magalu/achar', admin, async (req, res) => {
  const codigo = String(req.query.codigo || '').trim();
  if (!codigo) return res.status(400).json({ ok: false, erro: 'passe ?codigo=' });
  try {
    const dev = await magalu.acharDevolucao(codigo);
    res.json({
      ok: true, versao: VERSAO, codigo,
      achou: !!dev, devolucao: dev,
      tickets: magalu.statusIndice().tickets,
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

// b155 - RAIO-X da remessa reversa: devolve o JSON CRU do
// /seller/v0/tickets/{id}/returns, campo a campo, direto da API oficial.
// Motivo: a doc publica esconde o schema, e a fase 2 do indice so varria
// tickets ABERTOS - mas os dados reais da AMB (06/08) mostraram que o
// Magalu FECHA o ticket com o pacote ainda viajando. Esta rota constata
// o que a API expoe pra qualquer ticket, aberto ou fechado.
// Ex: /amb/magalu/ticket/UUID-DO-TICKET/returns?k=ADMIN_KEY
router.get('/magalu/ticket/:id/returns', admin, async (req, res) => {
  try {
    const r = await magalu.remessasReversasDoTicket(String(req.params.id || ''));
    res.json({ ok: true, versao: VERSAO, ticket_id: req.params.id, http: r.status, cru: r.data });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

router.get('/nf/entrada/indice', admin, (req, res) => {
  res.json({ ok: true, versao: VERSAO, indice: nfEntrada.statusIndice() });
});

router.get('/nf/entrada/indice/construir', admin, (req, res) => {
  nfEntrada.construirIndice().catch(e => console.error(`[${TAG_APP}/NF-ENTRADA]`, e.message));
  res.json({ ok: true, iniciado: true });
});

/** Um clique e o Diego descobre qual tipo lista as devolucoes. */
router.get('/nf/entrada/sonda', admin, async (req, res) => {
  res.json({ ok: true, versao: VERSAO,
    procure: 'o tipo cuja natureza diga Devolucao de venda',
    depois: `grave o numero em ${PREFIXO_ENV_EMPRESA}NF_ENTRADA_TIPO no Render (padrao atual: ${envAmb('NF_ENTRADA_TIPO') || '0'})`,
    tipos: await nfEntrada.sondarTipos() });
});

/** b336 - Calibragem do aviso "ja tem NF de devolucao": QUAIS naturezas
 *  aparecem nas notas de ENTRADA e quais delas o aviso aceita hoje.
 *  Diferente de /api/admin/indice-nf-devolucao (que abre nota por nota e leva
 *  minutos), esta so LISTA — responde em segundos e nao precisa de login.
 *  A descricao da natureza nao vem na listagem do Bling, entao detalhamos UMA
 *  nota por natureza (punhado de chamadas) so pra dar nome ao id. */
/** b336 r5 - o que ja foi descoberto sobre a natureza de uma nota fica aqui,
 *  pra que rodadas seguintes da calibragem SOMEM em vez de recomecar. Teto
 *  simples: passou do limite, esquece as mais antigas (Map guarda a ordem de
 *  insercao).
 *  b336 r6 (Codex #79): eu tinha escrito "natureza de nota emitida nao muda" e
 *  dispensado validade — mas esta rota so descarta cancelada/denegada, entao
 *  RASCUNHO entra, e nele a natureza ainda pode ser preenchida ou trocada no
 *  Bling depois. Duas defesas: valor nao resolvido (null) nao e guardado, e o
 *  que fica guardado vence em 6h, revalidando sozinho. */
// (CACHES.naturezasNf movido pra CACHES.naturezasNf — b343)
const NF_NAT_CACHE_MAX = 3000;
const NF_NAT_CACHE_TTL = 6 * 60 * 60 * 1000;
function guardarNaturezaAMB(idNota, natId, natDesc) {
  if (!natId) return;   // b336 r6 - nao resolvida: nao vira cache
  CACHES.naturezasNf.set(String(idNota), { id: natId, descricao: natDesc, em: Date.now() });
  while (CACHES.naturezasNf.size > NF_NAT_CACHE_MAX) {
    CACHES.naturezasNf.delete(CACHES.naturezasNf.keys().next().value);
  }
}
function naturezaDoCacheAMB(idNota) {
  const at = CACHES.naturezasNf.get(String(idNota));
  if (!at) return null;
  if ((Date.now() - at.em) > NF_NAT_CACHE_TTL) { CACHES.naturezasNf.delete(String(idNota)); return null; }
  return at;
}

// @fabrica-modulo lib-AMB/nf-entrada-naturezas-AMB.js#nf-entrada-naturezas
require('./lib-AMB/nf-entrada-naturezas-AMB')(router, { bling, FICHA_AMB, PREFIXO_ENV_EMPRESA, envAmb, VERSAO, admin, guardarNaturezaAMB, naturezaDoCacheAMB });   // @fabrica-chamada

// ── Testes ───────────────────────────────────────────────────
router.get('/bling/teste', admin, async (req, res) => {
  res.json({ ok: true, versao: VERSAO, resultado: await bling.testeDeVida() });
});

router.get('/bling/produto', admin, async (req, res) => {
  const sku = req.query.sku;
  if (!sku) return res.status(400).json({ ok: false, erro: 'falta o sku' });
  res.json(await bling.buscarProdutoPorSku(String(sku)));
});

router.get('/ml/teste', admin, async (req, res) => {
  res.json({ ok: true, versao: VERSAO, resultado: await ml.testeDeVida() });
});

// b271 - liga as preventivas das SEIS integracoes (AMB e GOOD), escalonadas
// pra nao disputarem a escrita das env vars nem o aquecimento dos indices.
// Empresa nova entra so registrando na lib — este bloco nao muda.
// b271 - liga as preventivas de TODAS as integracoes registradas, de todas
// as empresas, escalonando o primeiro disparo (pra nao disputarem a escrita
// das env vars nem o aquecimento dos indices). Empresa ou integracao nova
// entra so registrando na lib — este bloco NAO muda.
// b272 - o REGISTRO ja se agenda sozinho (lib/token-preventiva). Aqui so
// carregamos os modulos da GOOD, que se registram ao serem exigidos, e
// deixamos uma varredura de seguranca pra qualquer registro que tenha vindo
// com autoLigar:false.
(function carregarPreventivas() {
  try { require('../lib/ml'); } catch (e) { /* ausente = segue */ }
  try { require('../lib/bling'); } catch (e) { /* ausente = segue */ }
  try {
    const { ligarPendentes, listar } = require('../lib/token-preventiva');
    const n = ligarPendentes({ inicioMinutos: 2, passoMinutos: 6 });
    console.log(`[tokens] ${listar().length} integracao(oes) registrada(s)` + (n ? ` · ${n} agendada(s) pela varredura` : ''));
  } catch (e) { /* renovacao nunca pode impedir o modulo de subir */ }
})();

// b264 - conferir/forcar na hora, sem esperar o timer
router.get('/ml/token/preventiva', admin, async (req, res) => {
  res.json({ ok: true, versao: VERSAO, resultado: await ml.renovacaoPreventiva({ forcar: req.query.forcar === '1' }) });
});

// b271 - relatorio de TODAS as integracoes registradas, de TODAS as empresas
// (a lib e quem sabe quem existe). Empresa nova aparece aqui sozinha, sem
// mexer nesta rota.
router.get('/tokens/preventiva', admin, async (req, res) => {
  const { relatorio, listar } = require('../lib/token-preventiva');
  // b272 (review do Codex) - RENOVAR PRIMEIRO, listar DEPOIS. Em objeto
  // literal o `listar()` era avaliado ANTES do `await`, então com ?forcar=1 a
  // resposta trazia a data ANTIGA em `registradas` ao lado do "renovado
  // agora" em `empresas` — dois carimbos contraditórios no mesmo JSON.
  const empresas = await relatorio({ forcar: req.query.forcar === '1' });
  res.json({ ok: true, versao: VERSAO, registradas: listar(), empresas });
});

router.get('/ml/eu', admin, async (req, res) => {
  res.json(await ml.quemSouEu());
});

// Etiqueta de defeito (QZ Tray + fila remota) — registrada ANTES
// do 404: o Express casa rotas na ordem em que foram declaradas,
// e o pega-tudo engoliria qualquer coisa registrada depois dele.
impressao.registrarRotas(router, auth.requerLogin);

// ── 404 do modulo ────────────────────────────────────────────
// b55 - LEVA 1a do porte GOOD -> AMB: rotas que a tela de bipe da GOOD usa e
// que a AMB nao tinha (busca de produto, EAN por SKU, foto de evidencia,
// status de triagem). Tem que ser montado ANTES do catch-all 404 abaixo.
// b74 - passa a VERSAO pro compat: o /health mostrava um numero fixo
// ('AMB b68') e a tela imprimia ele no topo, desencontrado do servidor.
// b466 - o compat precisa de espreitaMontada e chaveDados (a rota /api/admin/orfaos,
// b465, lia deps.espreitaMontada — que so era passada pro OUTRO objeto de deps,
// la embaixo; aqui chegava undefined e a rota dizia "nao montado" pra sempre).
compat.montar(router, { auth, db, bling, cfg, multer, versao: VERSAO,
  chaveDados: CHAVE_DADOS, espreitaMontada: () => CACHES.espreita });

// b61 - LEVA 4a do porte GOOD -> AMB: as 13 rotas /api/admin/* que o
// painel usa (fotos, itens da NF, vincular/lancar Full, lancar por NF,
// preparar e registrar a devolucao gerada, concluir...). O modulo e o
// MESMO da GOOD, sem edicao: ele recebe tudo por injecao, e um Router
// do express tem .get/.post/.put igual ao app.
const dorme = (ms) => new Promise(r => setTimeout(r, ms));
// ══════════════════════════════════════════════════════════════════════
// b73 - A DIFERENCA QUE QUEBRAVA A NF EM TODOS OS CANAIS
// O codigo copiado da GOOD faz: rFull.data.data  (o envelope CRU do Bling).
// Mas o buscarNFePorId da AMB devolve {ok, nfe:{...}} — ja desembrulhado e
// com OUTRA CHAVE. Resultado: a busca achava o id da NF e o detalhe vinha
// null, entao numero e serie saiam vazios e a tela dizia "NF nao achada"
// mesmo com a nota existindo (id 26351839464 = NF 2228, caso real).
// Aqui passamos o CRU, no formato que o codigo da GOOD espera.
// ══════════════════════════════════════════════════════════════════════
// ⚠️ b445 (Codex, P1) - `opcoes` PRECISA CHEGAR NO `chamarBling`. Era
// `(id) => bling.chamarBling(...)`, um adaptador de 1 argumento so — quem
// chamava `buscarNFePorId(c.id, { semRitmo: true })` (identificar-AMB.js)
// tinha o 2o argumento DESCARTADO aqui, silenciosamente, e o `semRitmo`
// nunca chegava no cliente Bling.
const nfePorIdCru = (id, opcoes) => bling.chamarBling(`/nfe/${id}`, opcoes);
const nfp = criarNfPessoa({ chamarBling: bling.chamarBling, sleep: dorme });
const ajudantes = criarAdminHelpers({
  chamarBling: bling.chamarBling,
  chamarML: ml.chamarML,
  buscarNFePorId: nfePorIdCru,   // b73 - formato cru, como a GOOD espera
  sleep: dorme,
});
// b71 - a rota /api/devolucao/identificar da GOOD, que a tela de bipe
// espera. Os ajudantes: 5 de claim/return do ML vem do ml-buscas (copia
// da GOOD), 2 do admin-helpers, 2 do nf-pessoa, e o resto dos modulos
// que a AMB ja tinha (ml, bling, magalu, shopee, nf-nomes).
const mlBuscas = criarMlBuscas(ml.chamarML);
// b95 - ciclo do estoque de defeitos (ficha, comentarios, pedidos)
registrarCicloDefeitos(router, {
  supabase: () => db.conectar(),
  requerLogin: auth.requerLogin,
  chamarBling: (...args) => bling.chamarBling(...args),
  DEPOSITO_GERAL: cfg.fiscal.depositoGeral(),
  resolverSku: (sku) => db.resolverSku(sku),
  modelo: { ...cfg.defeitos, tabelas: cfg.supabase.tabelas },
  rotulo: cfg.NOME_EMPRESA,
});

registrarIdentificar(router, {
  // ⚠️ b359: o valor da coluna `empresa` no banco — o modulo derruba sem ele
  chaveDados: CHAVE_DADOS,
  pastaCheckout: PASTA_CHECKOUT,   // b405 — a pasta no Mover-Pedidos
  // b229 - a espreita ja montada, por FUNCAO (o comentario abaixo avisa:
  // passar pelo escopo derrubou o boot 2x). O getter le o cache na hora.
  espreitaMontada: () => CACHES.espreita,
  // ⚠️ b445 (Codex, P1) - NAO E MAIS o singleton da GOOD (`lib/ritmo-bling`,
  // conta cravada em 'good'; o b443 ja tinha tirado o uso dele aqui dentro).
  // O que a rota precisa e a VEZ na fila DESTA empresa, pra poder checar
  // cancelamento ANTES de disparar a chamada — `bling.aguardarVez` e a fila
  // por empresa (b442) exposta pra isso.
  aguardarVezBling: bling.aguardarVez,
  // b180 - TikTok na cascata da AMB (paridade com a GOOD). Passar por
  // parametro, nao pelo escopo: usar o escopo ja derrubou o boot 2x neste
  // projeto (b300 e b302 no lado da GOOD).
  tiktokPonte: require('../lib/tiktok-ponte'),
  tiktokDev: require('../lib/tiktok-devolucoes'),
  buscarNFsPorNumero: nfp.buscarNFsPorNumero,   // b237 - faltava (NF nao localizada)
  db,   // b213 - pro recado do estoquista aparecer na triagem
  supabase: db.conectar(),   // ev2 - registro do checkout offline
  requerLogin: auth.requerLogin,
  sleep: dorme,
  chamarML: ml.chamarML,
  chamarBling: bling.chamarBling,
  chamarMagalu: magalu.chamarMagalu,
  buscarNFnoML: ajudantes.buscarNFnoML,
  buscarNFePorId: nfePorIdCru,   // b73 - formato cru, como a GOOD espera
  buscarNFBlindada: ajudantes.buscarNFBlindada,
  buscarNFnoBlingPorNumero: ajudantes.buscarNFnoBlingPorNumero,
  mapItensNF: nfp.mapItensNF,
  resolverIdNFPorChave: nfp.resolverIdNFPorChave,
  buscarClaimsPorShipment: mlBuscas.buscarClaimsPorShipment,
  buscarClaimDetalhada: mlBuscas.buscarClaimDetalhada,
  buscarReturnPorClaim: mlBuscas.buscarReturnPorClaim,
  buscarOrderViaShipmentReturn: mlBuscas.buscarOrderViaShipmentReturn,
  buscarOrdersPorComprador: mlBuscas.buscarOrdersPorComprador,
  classificarMotivoDevolucao: ajudantes.classificarMotivoDevolucao,
  acharDevolucao: shopee.acharDevolucao,
  buscarPorNome: nfNomes.buscarPorNome,
  shopee, nfNomes,         // a rota usa shopee.cfg.ativo e nfNomes.colapsar
  // ═══════════════════════════════════════════════════════════════════
  // b142 - mlReturns FALTAVA AQUI, e era a causa do bipe de etiqueta
  // Correios reverso nunca funcionar na AMB. A rota chama
  // mlReturns.acharPorTracking() dentro de um try/catch; sem a injecao
  // dava ReferenceError, o catch engolia e devolvia null - entao o
  // sintoma aparecia como "rastreio nao encontrado", nunca como erro.
  // ═══════════════════════════════════════════════════════════════════
  mlReturns,
  // b71 - RAMO DO MAGALU DESLIGADO POR ORA: a rota da GOOD espera um
  // cliente com .cfg.ativo/.cfg.autorizado e .acharDevolucao(); o
  // magalu-AMB tem outra interface (temCredenciais/temToken/porPedido).
  // Em vez de adivinhar o de-para, deixo o ramo inerte — devolucao do
  // Magalu cai no "nao encontrado" ate eu portar isso direito. ML,
  // Shopee, NF, chave e nome funcionam normalmente.
  // ═══════════════════════════════════════════════════════════════════
  // b152 - RAMO DO MAGALU RELIGADO: o magalu-AMB agora tem a interface
  // que a rota da GOOD espera (cfg{ativo,autorizado} + acharDevolucao
  // pelos tickets P:protocolo/R:reverse_code/O:pedido, com fallback pela
  // espreita do BFF) e o chamarMagalu aceita caminho relativo. O objeto
  // inerte da b71 sai; devolucao do Magalu passa a identificar no bipe.
  // ═══════════════════════════════════════════════════════════════════
  magalu,
});

registrarRotasAdminNF(router, {
  tabelaDevolucoes: db.tabelas.devolucoes,   // b144 - devolucoes_amb
  chamarMagalu: magalu.chamarMagalu,   // b595 - anuncio do pedido do Magalu (card de varios produtos)
  shopeeProxy: { url: shopee.cfg.url, loja: shopee.cfg.loja, key: process.env.SHOPEE_PROXY_KEY || '' },   // b597 - anuncio da Shopee
  tiktokPonte, tiktokLoja: tiktokPonte.lojaDaEmpresa(CFG_EMPRESA.CHAVE_REGISTRO || SEM_EMPRESA),   // b598 - anuncio do TikTok; b661: nunca a AMB
  supabase: db.conectar(),
  requerAdmin: auth.requerAdmin,
  // usado nas fotos: aceita sessao de admin OU a chave ?k=ADMIN_KEY
  adminOk: (req) => !!auth.validarSessao(auth.tokenDaRequisicao(req), 'admin')
    || !!(process.env.ADMIN_KEY && req.query.k === process.env.ADMIN_KEY),
  sleep: dorme,
  chamarBling: bling.chamarBling,
  chamarML: ml.chamarML,
  buscarNFnoML: ajudantes.buscarNFnoML,
  // b159 - dep que FALTAVA. rotas-admin-AMB (copia do modulo da GOOD) usa
  // buscarNFnoBlingPorNumero em 2 rotas, mas ela nunca foi injetada AQUI:
  // na GOOD ela e global no server.js. Resultado: /api/admin/resolver-id-nf
  // e a busca por numero respondiam 500 "buscarNFnoBlingPorNumero is not
  // defined" toda vez que a NF precisava ser achada pelo NUMERO (card sem
  // o id do Bling). O registrarIdentificar logo acima ja passava certo.
  buscarNFnoBlingPorNumero: ajudantes.buscarNFnoBlingPorNumero,
  buscarNFePorId: nfePorIdCru,   // b73 - formato cru, como a GOOD espera
  buscarNFBlindada: ajudantes.buscarNFBlindada,
  resolverIdNFPorChave: nfp.resolverIdNFPorChave,
  mapItensNF: nfp.mapItensNF,
  buscarNFsPorNumero: nfp.buscarNFsPorNumero,   // b212 - raio-x da busca por numero
  buscarNfDevolucaoBling: nfp.acharNfDevolucaoBling,   // b255

  // ⚠️ b402 - A NATUREZA DA NF VEM DA FICHA, nao do padrao do lib/nf-pessoa.
  //
  // La dentro havia `process.env.AMB_NATUREZA_DEVOLUCAO || '15110882041'` —
  // o id da AMBTotal CRAVADO. E os 2 chamadores (rotas-admin-AMB) nao
  // passavam natureza nenhuma, entao TODOS caiam nesse padrao.
  //
  // ⚠️ A Girassol buscaria a NF de devolucao pela natureza da AMBTotal: nao
  // acharia as dela, e poderia achar as da AMB.
  // ⚠️ E O CAMPO E `naturezasDevolucaoIds`, NAO `naturezaDevolucao`.
  //
  // A ficha tem DOIS, e eu peguei o errado na 1a versao:
  //   naturezaDevolucao      -> a natureza de EMITIR (vazia na AMB hoje)
  //   naturezasDevolucaoIds  -> a(s) natureza(s) de BUSCAR  ← esta
  //
  // Com o errado a busca da AMB receberia vazio e RECUSARIA — um conserto
  // que quebra o que estava funcionando. Conferi o valor antes: o campo de
  // busca entrega '15110882041', exatamente o padrao que saiu do nf-pessoa.
  naturezaDevolucaoDaEmpresa: (CFG_EMPRESA && CFG_EMPRESA.fiscal
    && typeof CFG_EMPRESA.fiscal.naturezasDevolucaoIds === 'function')
    ? CFG_EMPRESA.fiscal.naturezasDevolucaoIds() : null,
  nomesBatemNf: nfp.nomesBatem,   // b316 - MESMO comparador do casamento
  listarDepositos: bling.listarDepositos,   // b276
});

// ═══════════════════════════════════════════════════════════════════
// b651 - RELATORIO DE DEVOLUCOES NAS 3 (fatia 2 do porte; a peca virou
// multiempresa no b650). E o MESMO relatorio da GOOD, lendo as tabelas
// DESTA empresa (vem da ficha). Enquanto as tabelas de tags da empresa
// nao existirem no Supabase (sql/2026-11-01-tags-relatorio-amb-girassol.sql),
// o relatorio responde o erro do banco NOMEANDO a tabela que falta — nunca
// cai no dado de outra empresa (a peca derruba o registro sem os nomes).
// A busca textual de produtos e indice proprio da GOOD: aqui declara null,
// e a rota responde 501 explicando, em vez de fingir resultado vazio.
// ═══════════════════════════════════════════════════════════════════
registrarRotasRelatorios(router, {
  supabase: db.conectar(),
  requerAdmin: auth.requerAdmin,
  tabelas: {
    devolucoes: db.tabelas.devolucoes,
    tags: db.tabelas.tags,
    devolucaoTags: db.tabelas.devolucaoTags,
  },
  buscarProdutos: null,
  // b652 (Codex #522) - vocabulario da tabela da AMB/Girassol
  colunaData: 'criado_em',
  tipoNoStatus: true,
});

// b651 - a pagina e o js do relatorio sao os MESMOS arquivos da GOOD,
// servidos sob o prefixo da empresa (o js deriva a base da API do caminho
// da propria pagina). Mesma protecao da GOOD: a pagina exige admin.
// b652 (Codex #522) - o "Voltar ao Admin" da pagina e ../admin.html (redirect so
// existe na raiz da GOOD): sob o prefixo da empresa aponta pro /painel dela.
const RELATORIOS_HTML_EMPRESA = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'relatorios.html'), 'utf8')
  .replace('href="../admin.html"', 'href="../painel"');
router.get('/admin/relatorios.html', auth.requerAdmin, (req, res) => {
  res.type('html').send(RELATORIOS_HTML_EMPRESA);
});
router.get('/admin/relatorios.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'relatorios.js'));
});


// ═══════════════════════════════════════════════════════════════════
// b328 - INDICE DE NFs DE DEVOLUCAO **DA AMB**.
//
// Achado ao portar o aviso do card (b326/b327): os dois paineis da AMB ja
// chamavam `/api/admin/indice-nf-devolucao` — que e a rota **DA GOOD**, na
// raiz. Ou seja, o botao de cruzamento na AMB vinha lendo as notas de
// entrada da GOOD e cruzando com pedidos da AMB: nunca casaria nada, e se
// casasse por coincidencia de numero de pedido seria pior ainda.
//
// Mesmo erro de familia que a b324 (a AMB usando dado da GOOD), agora numa
// rota de leitura. Cada empresa consulta o PROPRIO Bling.
// ═══════════════════════════════════════════════════════════════════
const NF_DEV_TTL_AMB = 15 * 60 * 1000;
// ⚠️ b342 - GAVETA 1 de 3: O INDICE DE NOTAS DE DEVOLUCAO.
//
// A fabrica (`criarGavetaNfDev`) vive no escopo do modulo, perto do topo do
// arquivo (mesmo comentario de `criarGavetasDaEmpresa`) — aqui so pega a
// instancia desta empresa.
const NF_DEV = GAVETAS.nfDev;   // b353

async function montarIndiceNFDevolucaoAMB(maxPaginas) {
  // b335 r2 (Codex #78): o guard usava NF_DEV.indice.size — se as entradas
  // recentes fossem TODAS do Full (sem pedido), o mapa ficava vazio e CADA
  // request reconstruia os ~600 detalhes de novo, com 120ms de pausa cada,
  // ignorando o TTL. A flag diz "o build terminou", independente do formato.
  if ((Date.now() - NF_DEV.ts) < NF_DEV_TTL_AMB && NF_DEV.cacheOk) return;
  if (NF_DEV.carregando) return NF_DEV.carregando;
  NF_DEV.carregando = (async () => {
    const novo = new Map();
    const semPedido = [];
    try {
      const paginas = Math.min(maxPaginas || 5, 15);
      // b335 - o TIPO vem da MESMA env do indice da espreita (AMB_NF_ENTRADA_TIPO,
      // padrao '0'). A sonda /amb/nf/entrada/sonda de 20/08 provou nesta conta:
      // tipo=0 lista as ENTRADAS (devolucoes, inclusive as da MAGALU LOG do Full)
      // e tipo=1 lista as VENDAS — ate a b334 este indice usava tipo=1 cravado,
      // ou seja, indexava VENDA achando que era devolucao (o aviso nunca casava).
      const tipoEntrada = String(FICHA_AMB.fiscal.nfEntradaTipo() || '0');
      // b335 r2 (Codex #78): tipo=0 traz TODAS as entradas — compra de
      // fornecedor, transferencia, conserto... Pro casamento cliente+SKU so
      // entram notas cuja natureza seja RECONHECIVEL como devolucao: id na
      // lista da env AMB_NATUREZAS_DEVOLUCAO_IDS (padrao: a mesma
      // AMB_NATUREZA_DEVOLUCAO da busca acharNfDevolucaoBling) OU descricao
      // contendo "devolu". O que ficar de fora e contado por natureza em
      // `naturezas_ignoradas` — e por ali que se descobre um id novo (ex.: o
      // das notas da MAGALU LOG do Full, se a descricao nao vier) pra por na env.
      // b391 (P1 Codex #326): mesmo motivo da /nf/entrada/naturezas acima —
      // sem literal da AMB aqui, senao uma empresa sem env propria herdaria
      // a natureza da AMB em silencio.
      const idsDevolucao = String(FICHA_AMB.fiscal.naturezasDevolucaoIds() || envAmb('NATUREZA_DEVOLUCAO') || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const ignoradas = {};
      // b335 r3 (Codex #78): NF CANCELADA (2) e DENEGADA (9) nao valem como
      // "ja tem nota" — o admin-helpers-AMB ja trata as duas como descartaveis
      // (nfeViva). Se entrassem, o operador leria "nao precisa gerar de novo"
      // e o cliente ficaria sem a nota valida.
      const NFE_DESCARTAVEL = new Set([2, 9]);
      const nfeViva = (n) => !NFE_DESCARTAVEL.has(Number(n && n.situacao));
      let falhaLista = false;
      let falhasDetalhe = 0;
      // 1) lista as notas de entrada (so id + numero, rapido)
      const ids = [];
      for (let p = 1; p <= paginas; p++) {
        const r = await bling.chamarBling(`/nfe?tipo=${tipoEntrada}&pagina=${p}&limite=100`);
        // b335 r3 (Codex #78): o chamarBling NAO joga excecao — devolve
        // {ok:false}. Sem esta checagem uma queda do Bling virava "lista vazia"
        // e o build seguia como se tivesse dado certo.
        if (!r.ok) { falhaLista = true; break; }
        const lista = r.data?.data || [];
        if (!lista.length) break;
        for (const n of lista) {
          if (!nfeViva(n)) continue;   // b335 r3 - cancelada/denegada nem detalha
          ids.push({ id: n.id, numero: n.numero, serie: n.serie != null ? n.serie : null, dataEmissao: n.dataEmissao, contato: n.contato?.nome || null, situacao: n.situacao });
        }
        if (lista.length < 100) break;
      }
      // b335 r3 - queda na listagem: mantem o indice anterior e NAO marca cache
      // valido, pra proxima chamada tentar de novo em vez de servir vazio por 15min.
      if (falhaLista && !ids.length) return;
      // 2) detalha cada nota pra pegar o numeroPedidoLoja (em lotes, com pausa)
      for (const it of ids) {
        try {
          const rD = await bling.chamarBling(`/nfe/${it.id}`);
          // b335 r3 (Codex #78): detalhe que falhou nao pode virar nota "sem
          // pedido" — sem o numeroPedidoLoja ela cairia no casamento por
          // cliente+SKU sem nunca ter sido lida. Pula e conta a falha.
          if (!rD.ok) { falhasDetalhe++; await new Promise(r => setTimeout(r, 120)); continue; }
          const d = rD.data?.data || {};
          if (!nfeViva({ situacao: d.situacao != null ? d.situacao : it.situacao })) { await new Promise(r => setTimeout(r, 120)); continue; }
          const pedido = String(d.numeroPedidoLoja || '').replace(/\s/g, '');
          // b335 - a base carrega TUDO que o aviso precisa: id (link pro Bling),
          // serie, os SKUs de todos os itens e a natureza — de graca, o detalhe
          // ja estava na mao (era jogado fora quando o pedido vinha vazio).
          const nat = d.naturezaOperacao || null;
          const base = {
            nf: it.numero, id: String(it.id),
            serie: it.serie != null ? it.serie : (d.serie != null ? d.serie : null),
            data: (it.dataEmissao || '').slice(0, 10),
            contato: it.contato,
            sku: (Array.isArray(d.itens) && d.itens[0]) ? d.itens[0].codigo : null,
            skus: (Array.isArray(d.itens) ? d.itens : []).map(i => String((i && i.codigo) || '').trim()).filter(Boolean),
            chave: d.chaveAcesso || null,
            natureza: nat ? { id: nat.id != null ? nat.id : null, descricao: nat.descricao || null } : null,
          };
          // b335 r4 (Codex #78): o filtro de natureza vale pros DOIS ramos. Ter
          // numeroPedidoLoja nao prova que a nota e devolucao — tipo=0 traz
          // entrada comum tambem, e uma delas com pedido preenchido disparava o
          // "nao precisa gerar de novo" sem passar por filtro nenhum.
          const natId = String((nat && nat.id) || '');
          const ehDevolucao = (natId && idsDevolucao.indexOf(natId) >= 0) || /devolu/i.test(String((nat && nat.descricao) || ''));
          if (!ehDevolucao) {
            ignoradas[natId || 'sem_natureza'] = (ignoradas[natId || 'sem_natureza'] || 0) + 1;
          } else if (pedido) {
            novo.set(pedido, base);
          } else {
            // b335 - nota SEM pedido (caso Full: o Bling importa a NF-e sem o
            // vinculo — campos de referencia vem nulos desde julho). E daqui
            // que o painel casa por cliente+SKU.
            semPedido.push(base);
          }
        } catch (e) { /* pula essa nota */ }
        await new Promise(r => setTimeout(r, 120));
      }
      NF_DEV.indice.clear();
      for (const [k, v] of novo) NF_DEV.indice.set(k, v);
      NF_DEV.semPedido = semPedido;   // b335
      NF_DEV.ignoradas = ignoradas;    // b335 r2
      NF_DEV.cacheOk = true;          // b335 r2 - build terminou (vazio de verdade tambem vale)
      // b335 r3 (Codex #78): build INCOMPLETO (Bling caiu no meio) vale, mas
      // com validade curta — 2 min em vez de 15. Nem serve resultado furado
      // por 15 minutos, nem remonta 600 notas a cada request.
      const parcial = falhaLista || falhasDetalhe > 0;
      NF_DEV.ts = parcial ? (Date.now() - NF_DEV_TTL_AMB + 2 * 60 * 1000) : Date.now();
    } catch (e) { /* mantem o indice anterior */ }
    finally { NF_DEV.carregando = null; }
  })();
  return NF_DEV.carregando;
}

// rota: dispara/consulta o indice. O front chama e depois cruza com o a espreita.

// b328 - rota da AMB, espelhando a da GOOD. O painel da AMB passa a chamar
// ESTA, e nao mais a da raiz (que le o Bling da GOOD).
// ============================================================
// b191 - VENDAS ESTORNADAS SEM RETORNO (porte da GOOD)
// ------------------------------------------------------------
// Mesma frente que subiu na GOOD hoje: vendas que o marketplace
// reembolsou sem devolucao fisica. A NF de venda continua emitida,
// gerando imposto sobre receita que nao existiu.
//
// [stated] Pedido dele: "tinha q ser lib, pra nao precisar portar né.
// pra sempre 1 ajuste pegar todas empresas."
//
// E e o que acontece aqui: TODA a logica vive em ../lib/ e recebe a
// empresa por parametro. Este bloco e so FIACAO — passa 'amb' onde a
// GOOD passa 'good'. Ajuste na lib pega as duas.
//
// A empresa e FIXA de proposito (nao vem da querystring): este servidor
// E o da AMB, e aceitar ?empresa=good deixaria o admin de uma ver os
// dados da outra.
// ============================================================
// b203 - a rota de DIAGNOSTICO da busca de NF, que so existia na GOOD.
//
// O dono tentou usar na AMB e levou "rota nao existe neste modulo". Sem
// ela, pra descobrir por que uma NF nao e achada aqui eu so chutaria — e
// foi exatamente o diagnostico que resolveu o caso do TikTok na GOOD.
//
// GET /amb/api/debug/achar-nf?pedido=1535470109716311&data=2026-05-10&k=ADMIN_KEY
// b199.1 (Codex) - REGISTRAR o caso, que so existia na GOOD.
//
// Os paineis da AMB chamam POST /amb/api/admin/sem-retorno/registrar desde
// que ganharam o botao — e a rota nao existia aqui. Todo clique dava 404.
//
// Mesma logica da GOOD, com a tabela e a empresa da AMB.
/* b507 - AUDITORIA MULTIEMPRESA (02/10): "mandar da espreita para Aprovadas" so existia na GOOD (o painel daqui
   mostrava que a acao nao existia nesta empresa). Porte da rota da GOOD com o banco, o ML e o Bling DESTA empresa:
   pra cada pedido marcado, pula se ja tem triagem (jaTriado), le a venda no ML, acha a NF pela chave do envio
   (invoice_data), tenta o id no Bling pelo numero e grava como APROVADA aguardando NF. Mesmo formato de
   resposta da GOOD (criados / sem_nf / ja_existiam / falhas); ate 40 pedidos por vez, com pausa.
   b508 (Codex #418): sessao de admin DA EMPRESA (o painel nao manda ?k=), pack como fallback do envio, NF do Bling
   conferida pela CHAVE (mesmo numero em series diferentes), so pedido ML, orcamento de tempo e trava contra clique duplo.
   NAO grava itens_devolvidos: o doc ITENS-DEVOLVIDOS.md reserva a coluna ao que foi BIPADO, e aqui nada voltou ainda. */
const LANCANDO_ESPREITA = new Set();       // pedidos em andamento (clique duplo / retry na mesma instancia)
const ORCAMENTO_LANCAR_MS = 20000;         // abaixo da janela de ~25s do Render; o resto volta em `restantes`
router.post('/api/admin/espreita/lancar-nf', auth.requerAdmin, async (req, res) => {
  const pedidos = Array.isArray(req.body && req.body.pedidos) ? req.body.pedidos : [];
  if (!pedidos.length) return res.status(400).json({ ok: false, erro: 'nenhum pedido selecionado' });
  const criados = [], semNf = [], jaExistiam = [], falhas = [], restantes = [];
  const inicioLote = Date.now();
  for (const orderId of pedidos.slice(0, 40)) {
    const oid = String(orderId || '').trim();
    if (oid && Date.now() - inicioLote > ORCAMENTO_LANCAR_MS) { restantes.push(oid); continue; }
    if (oid && LANCANDO_ESPREITA.has(oid)) { falhas.push({ pedido: oid, erro: 'ja esta sendo lancado — aguarde' }); continue; }
    if (oid) LANCANDO_ESPREITA.add(oid);
    try {
      if (!oid) continue;
      const ja = await db.jaTriado({ orderId: oid });
      if (!ja || ja.ok === false) { falhas.push({ pedido: oid, erro: 'nao consegui conferir se ja existe (banco) — tente de novo' }); continue; }
      if (ja.triado || (Array.isArray(ja.registros) && ja.registros.length)) { jaExistiam.push(oid); continue; }
      const rO = await ml.chamarML('/orders/' + oid);
      if (!rO || !rO.ok || !rO.data) { falhas.push({ pedido: oid, erro: 'nao achei a venda no ML' }); continue; }
      const od = rO.data;
      let shipIda = od.shipping && od.shipping.id;
      // venda de carrinho: o envio mora no PACK (mesmo fallback do ml-returns-AMB.enriquecerPedido)
      if (!shipIda && od.pack_id) {
        const rP = await ml.chamarML('/packs/' + od.pack_id);
        const pk = rP && rP.ok && rP.data;
        shipIda = (pk && pk.shipment && pk.shipment.id) || (pk && Array.isArray(pk.shipments) && pk.shipments[0] && pk.shipments[0].id) || null;
      }
      let nf = null;
      if (shipIda) {
        const rN = await ml.chamarML('/shipments/' + shipIda + '/invoice_data?siteId=MLB');
        const ch = rN && rN.ok && rN.data && rN.data.fiscal_key ? String(rN.data.fiscal_key) : '';
        if (/^\d{44}$/.test(ch)) nf = { chave: ch, numero: ch.slice(25, 34).replace(/^0+/, ''), serie: ch.slice(22, 25).replace(/^0+/, '') || '1' };
      }
      if (!nf) { semNf.push(oid); continue; }
      try {
        // so aceita a nota cuja CHAVE bate: o mesmo numero existe em series diferentes e o id errado
        // faria a devolucao ser gerada contra outra venda (o gerador prioriza nf_id_bling)
        const mesmaChave = (x) => !!x && String(x.chaveAcesso || '').replace(/\D/g, '') === nf.chave;
        let m = null;
        const rC = await ajudantes.buscarNFPelaChave(nf.chave);
        if (rC && rC.ok && rC.match && mesmaChave(rC.match)) m = rC.match;
        if (!m) {
          const rB = await ajudantes.buscarNFnoBlingPorNumero(nf.numero, null, { maxPaginas: 30, chave: nf.chave });
          m = (rB && rB.ok && (rB.candidatas || []).find(mesmaChave)) || null;
        }
        if (m && m.id) { nf.id_bling = String(m.id); nf.valor = m.valorNota || null; nf.data_emissao = m.dataEmissao || null; }
      } catch (e) { /* segue sem o id; o gerador ainda tenta pela chave */ }
      const b = od.buyer || {};
      const itens = od.order_items || [];
      const qtdTotal = itens.reduce((a, x) => a + (x.quantity || 0), 0);
      const primeiro = itens[0] || {};
      const resumoItens = itens.map((x) => (x.quantity || 1) + 'x ' + ((x.item && (x.item.seller_sku || x.item.seller_custom_field)) || '?') + ' - ' + ((x.item && x.item.title) || '')).join(' | ');
      const r = await db.registrarTriagem({
        marketplace: 'ml', order_id: oid, pack_id: od.pack_id ? String(od.pack_id) : null, shipment_id: String(shipIda || oid),
        buyer_nome: [b.first_name, b.last_name].filter(Boolean).join(' ') || b.nickname || null,
        produto_titulo: (primeiro.item && primeiro.item.title) || null,
        produto_sku: (primeiro.item && (primeiro.item.seller_sku || primeiro.item.seller_custom_field)) || null,
        produto_qtd: qtdTotal || 1,
        // Codex #418 (P2): a venda com VARIOS produtos guarda TODOS (o card mostra item por item em 'itens da NF'),
        // em vez de so o 1o com a quantidade somada. Nao vira 'itens_devolvidos': a espreita nao sabe o que voltou.
        nf_itens: itens.map((x) => ({ sku: (x.item && (x.item.seller_sku || x.item.seller_custom_field)) || null, titulo: (x.item && x.item.title) || null, quantidade: x.quantity || 1, valor: x.unit_price != null ? x.unit_price : null })),
        nf_numero: nf.numero, nf_serie: nf.serie, nf_chave: nf.chave, nf_id_bling: nf.id_bling || null,
        nf_valor: nf.valor || null, nf_data_emissao: nf.data_emissao || null,
        status: 'aprovado', funcionario: req.usuario || 'admin',
        problema_descricao: '[LANCADO DO PAINEL A ESPREITA por ' + (req.usuario || 'admin') + '] itens da venda: ' + resumoItens,
      });
      if (!r || !r.ok || !r.registro) { falhas.push({ pedido: oid, erro: (r && r.erro) || 'falha ao gravar' }); continue; }
      criados.push({ pedido: oid, id: r.registro.id, nf: nf.numero, id_bling: nf.id_bling || null, itens: itens.length, qtd: qtdTotal });
      await new Promise((ok) => setTimeout(ok, 250));
    } catch (e) { falhas.push({ pedido: oid, erro: String((e && e.message) || e) }); }
    finally { if (oid) LANCANDO_ESPREITA.delete(oid); }
  }
  return res.json({ ok: true, criados: criados.length, detalhe_criados: criados, sem_nf: semNf, ja_existiam: jaExistiam, falhas, restantes,
    aviso: semNf.length ? 'Estas vendas nao tem NF identificada no app - confira no Bling antes de emitir' : null });
});

/* b506 - AUDITORIA MULTIEMPRESA (02/10): o botao "buscar a NF no Bling" da tela de bipe da AMB/Girassol
   chamava esta rota SEM o prefixo da empresa — caia na rota da GOOD (raiz): 401 sem a sessao da GOOD ou,
   com a GOOD logada no mesmo navegador, procurava no BLING DA GOOD. Agora a rota existe aqui, com o Bling
   DESTA empresa, e a tela chama com o prefixo. Busca pelo NUMERO da NF (o ajudante desta empresa); sem o
   numero, responde claro em vez de chutar (a busca por pedido da GOOD nao existe nos ajudantes daqui). */
router.get('/api/nf/buscar-links-bling/:orderId', auth.requerLogin, async (req, res) => {
  const numeroNF = String(req.query.numeroNF || '').replace(/\D/g, '');
  const dataRef = req.query.data || null;
  if (!numeroNF) {
    return res.json({ ok: false, estrategia: 'numero', erro: 'Nesta empresa a busca no Bling e pelo NUMERO da NF — este pedido ainda nao tem a NF identificada. Bipe de novo daqui a pouco ou abra pelo card.' });
  }
  try {
    const rBusca = await ajudantes.buscarNFnoBlingPorNumero(numeroNF, dataRef, { maxPaginas: 50 });
    if (!rBusca || !rBusca.ok) return res.json({ ok: false, estrategia: 'numero', erro: 'Erro ao buscar NF no Bling (tente de novo)', detalhes: rBusca || null });
    if (!rBusca.match) return res.json({ ok: false, estrategia: 'numero', erro: 'NF ' + numeroNF + ' nao encontrada no Bling desta empresa', detalhes: rBusca });
    const rCompleta = await bling.buscarNFePorId(String(rBusca.match.id));
    const nf = (rCompleta && rCompleta.ok && rCompleta.data && rCompleta.data.data) ? rCompleta.data.data : rBusca.match;
    const itensBling = Array.isArray(nf.itens) ? nf.itens.map((it) => ({ titulo: it.descricao || null, sku: it.codigo || null, ean: it.gtin || null, quantidade: it.quantidade || null, valor: it.valor || null, unidade: it.unidade || null })) : [];
    return res.json({
      ok: true, estrategia: 'numero', paginas_verificadas: rBusca.pagina, total_scanned: rBusca.totalScanned,
      nf: { fonte: 'bling', numero: nf.numero, serie: nf.serie, chaveAcesso: nf.chaveAcesso, valor: nf.valorNota, dataEmissao: nf.dataEmissao,
        linkDanfe: nf.linkDanfe, linkPdf: nf.linkPDF, linkXml: nf.xml, idBling: nf.id, numeroPedidoLoja: nf.numeroPedidoLoja, itens: itensBling },
    });
  } catch (e) {
    return res.json({ ok: false, estrategia: 'numero', erro: 'Erro ao buscar NF no Bling: ' + String((e && e.message) || e) });
  }
});

// @fabrica-modulo lib-AMB/sem-retorno-AMB.js#sem-retorno
require('./lib-AMB/sem-retorno-AMB')(router, { CHAVE_DADOS, auth, erroCodigo, confrontar, vinculoCache, marcadores, magaluCancelados, db, nfp, ajudantes });   // @fabrica-chamada

router.get('/api/admin/indice-nf-devolucao', auth.requerLogin, async (req, res) => {
  try {
    await montarIndiceNFDevolucaoAMB(Number(req.query.paginas || 5));
    const mapa = {};
    for (const [ped, info] of NF_DEV.indice) mapa[ped] = info;
    return res.json({ ok: true, total: NF_DEV.indice.size, atualizado_em: NF_DEV.ts,
      tipo_usado: String(FICHA_AMB.fiscal.nfEntradaTipo() || '0'),   // b335
      pedidos: mapa,
      sem_pedido: NF_DEV.semPedido,   // b335 - notas sem vinculo (Full): o painel casa por cliente+SKU
      naturezas_ignoradas: NF_DEV.ignoradas,   // b335 r2 - entradas fora do casamento, contadas por natureza
      cache_ok: NF_DEV.cacheOk,   // b335 r3 - false = o Bling falhou e nao ha indice confiavel ainda
      // b335 r4 (Codex #78): idade medida no relogio do SERVIDOR. O painel
      // calcula a validade a partir dela (e nao de Date.now() na chegada),
      // senao o TTL curto de um build parcial virava 15 min no navegador.
      idade_ms: Math.max(0, Date.now() - NF_DEV.ts) });
  } catch (e) { return res.status(500).json({ ok: false, erro: e.message }); }
});

router.use((req, res) => {
  res.status(404).json({
    ok: false,
    erro: 'rota nao existe neste modulo',
    modulo: 'amb-devolucoes',
    versao: VERSAO,
    rotas: [
      '/conectar', '/status', '/config',
      '/ml/indice', '/ml/indice/construir', '/ml/rastreio', '/ml/espreita',
      '/identificar', '/nf/nome', '/nf/itens', '/nf/indice', '/nf/indice/construir',
      '/api/auth/login', '/api/auth/me', '/api/triagem/identificar', '/api/triagem/registrar',
      '/auth/diag', '/db/teste', '/api/nf/itens', '/api/triagem/recentes',
      '/painel', '/api/espreita', '/api/recados', '/api/defeitos',
      '/shopee/teste', '/magalu/status', '/nf/entrada/sonda', '/nf/entrada/naturezas', '/api/etiqueta/fila',
      '/ml/teste', '/ml/eu', '/bling/teste', '/bling/produto',
    ].map(r => BASE + r),
  });
});

// ── Pré-aquecimento: UM DE CADA VEZ ──────────────────────────────────
//
// ⚠️ b414 - ELES SE ATROPELAVAM, e o dono sentiu na emissão de NF.
//
// A intenção original ("1 minuto depois do outro pra não empilhar") não se
// cumpria, porque o atraso era fixo e a DURAÇÃO não. Com os números do log
// de hoje:
//
//   180s  ml-returns começa — leva 195s, termina só aos 375s
//   180s  magalu começa JUNTO com ele
//   240s  nf-nomes começa — o ml-returns ainda está rodando
//   360s  nf-entrada começa — idem
//
// Três varreduras competindo pela mesma cota. O log encheu de `429`, o
// porteiro pausou a fila, e a emissão de NF do dono — que tem reserva
// justamente pra não parar — ficou 3 minutos esperando.
//
// 📌 Agora cada um espera o anterior TERMINAR. Isso vale independente da
// duração, que cresce com o volume: hoje são 6.231 NFs, amanhã mais.
//
// ⚠️ Com TETO por rotina: se uma travar, as seguintes rodam mesmo assim.
// Encadear sem teto trocaria "se atropelam" por "uma trava e nenhuma roda".
const PREAQ_TETO_MS = Number(envAmb('PREAQUECER_TETO_MS') || 8 * 60 * 1000);


async function esperarTerminar(nome, status, tetoMs = PREAQ_TETO_MS) {
  const ate = Date.now() + tetoMs;
  while (Date.now() < ate) {
    await new Promise((r) => setTimeout(r, 5000));
    let st = null;
    try { st = status(); } catch (e) { return; }   // sem status: segue
    // ⚠️ b415: `ocupado` cobre "rodando OU vai tentar de novo". O
    // `construindo` sozinho abria a fresta entre a falha e a retentativa —
    // e o magalu nem tinha esse campo.
    const aindaVem = st && (st.ocupado != null ? st.ocupado : st.construindo);
    if (!aindaVem) return;
  }
  console.log(`[${TAG_APP}/PREAQUECER] ${nome} passou do teto de `
    + `${Math.round(tetoMs / 1000)}s — sigo pro proximo`);
}

(async () => {
  // o 1º atraso continua existindo: não competir com o boot da GOOD
  await new Promise((r) => setTimeout(r, Number(envAmb('PREAQUECER_MS') || 180000)));

  if (ml.temToken()) {
    // ⚠️ b415 (Codex, P2): se o dono concluir o OAuth do ML DURANTE os 3
    // minutos de espera, o callback ja chama `preAquecer(5000)` — e esta fila
    // chamaria de novo ao acordar. Duas construcoes do mesmo indice, na mesma
    // cota, que e exatamente o que a fila existe pra impedir.
    if (jaPreAquecidoPeloOAuth.ml) {
      console.log(`[${TAG_APP}/PREAQUECER] ml-returns ja foi disparado pelo OAuth`);
      await esperarTerminar('ml-returns', () => mlReturns.statusIndice());
    } else {
      mlReturns.preAquecer(0);
      await esperarTerminar('ml-returns', () => mlReturns.statusIndice());
    }
  } else {
    console.log('[amb-devolucoes] ML sem token - indice de devolucoes so apos conectar');
  }

  if (bling.temToken()) {
    nfNomes.preAquecer(0);
    // Codex #470: a montagem do nf-nomes pode durar ate o proprio teto de construcao (15-30 min com 300 paginas);
    // com o teto padrao de 8 min a fila soltava o nf-entrada com o nf-nomes ainda varrendo o Bling.
    await esperarTerminar('nf-nomes', () => nfNomes.statusIndice(), Math.max(PREAQ_TETO_MS, nfNomes.tetoAbsolutoConstrucaoMs() + 30000));
    nfEntrada.preAquecer(0);
    await esperarTerminar('nf-entrada', () => nfEntrada.statusIndice());
  } else {
    console.log('[amb-devolucoes] Bling sem token - indices de nomes/entrada so apos conectar');
  }

  if (jaPreAquecidoPeloOAuth.magalu) {
    console.log(`[${TAG_APP}/PREAQUECER] magalu ja foi disparado pelo OAuth`);
  } else {
    magalu.preAquecer(0);
  }
  await esperarTerminar('magalu', () => magalu.statusIndice());

  // ⚠️ a Shopee não expõe `construindo` — vai por último, sem espera.
  shopee.preAquecer();

  console.log(`[${TAG_APP}/PREAQUECER] fila concluida`);
})().catch((e) => console.error(`[${TAG_APP}/PREAQUECER]`, e && e.message));


if (!auth.temUsuarios()) {
  console.log(`[amb-devolucoes] ${PREFIXO_ENV_EMPRESA}USERS vazio - ninguem consegue logar ainda`);
}

console.log(`[amb-devolucoes] ${VERSAO} carregado - prefixo ${BASE}`);


// ⚠️ b367 (Codex, P2) - o teste de isolamento chamava a FABRICA solta
// (`gavetasDaEmpresaParaTeste()`) pra pegar "as gavetas de cada instancia",
// mas essa chamada nao tem nenhum vinculo com `umaEmpresa`/`outra`: cria um
// par de gavetas NOVO e vazio, desligado do router. Mutar um lado nunca
// alcancaria o outro nem que o router de verdade compartilhasse tudo —
// o teste passava sem provar isolamento nenhum.
//
// 📌 Agora a PROPRIA instancia das gavetas usada por este router vai junto
// no objeto devolvido, pra quem testa ler o estado real em vez de um clone.
router.gavetasParaTeste = GAVETAS;

// ⚠️ o `return` fica DENTRO da funcao, no lugar do antigo
// `module.exports = router`.
  return router;
}

// ⚠️ COMPATIBILIDADE: o server.js de hoje faz
//   app.use('/amb', require('./amb-devolucoes/app-AMB'))
// e isso continua valendo — o export e a FUNCAO, e o Express aceita funcao
// como middleware... mas NAO e isso que queremos: seria o app inteiro virando
// um handler.
//
// 📌 Entao exporto um OBJETO com a fabrica, e o server passa a chamar
// `.criar()`. O teste guarda os dois lados.
module.exports = {
  criar: criarAppEmpresa,
  // ⚠️ revisao Codex no PR #308 (P2) - ISTO CHAMAVA UM CLONE ESCRITO A MAO,
  // nao `criarGavetasDaEmpresa`. Um clone passa mesmo se a fabrica real
  // mudar de formato ou passar a reaproveitar um Map entre chamadas —
  // exatamente a regressao que o teste de isolamento existe pra pegar.
  //
  // 📌 Agora que `criarGavetasDaEmpresa` vive no escopo do MODULO (perto do
  // topo do arquivo, fora de `criarAppEmpresa`), este export e a PROPRIA
  // funcao — nao ha mais duas fontes do mesmo formato. Ela ja cria uma
  // instancia nova a cada chamada (o teste chama duas vezes e compara).
  //
  // ⚠️ nome de propriedade escolhido a dedo: o mesmo teste tambem mede, pelo
  // texto do arquivo, se o passo 3 trocou o export de router pronto por uma
  // fabrica de verdade. Um nome comecando com o verbo que aquela outra
  // asseracao procura acionaria o alarme errado.
  gavetasDaEmpresaParaTeste: criarGavetasDaEmpresa,
};
