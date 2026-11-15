// ============================================================
// lib/bling.js
// ------------------------------------------------------------
// Cliente Bling ERP v3.
// - renovarTokenBling: refresh OAuth
// - chamarBling: GET/POST com retry de 401 e 429
// - buscarPedidoBlingPorNumeroLoja: paginar /pedidos/vendas
// - buscarPedidoBlingPorId: GET /pedidos/vendas/{id}
// - buscarNFePorId: GET /nfe/{id}
// - buscarProdutoBlingPorSku: produto + EAN
// - buscarNFnoBlingPorNumero: paginar /nfe por numero
// - buscarNFnoBlingPorOrderId: paginar /nfe por numeroPedidoLoja
// ============================================================

const axios = require('axios');
const ritmo = require('./ritmo-bling');   // b232.4 - ritmo global da conta

// b250.1 (Codex, P1) - MEU PASSO 1 NAO FUNCIONAVA. Eu tinha posto o leitor
// de dois nomes no REGISTRO — mas a GOOD nao le por ele: o server.js usa
// ESTE modulo, que lia `process.env.BLING_*` direto. Criar as vars novas
// no Render nao teria efeito nenhum, e ele acharia que tinha migrado.
//
// A migracao acontece AQUI. `GOOD_` primeiro, historico depois:
//   1. (agora) le os dois — nada quebra, as antigas seguem valendo
//   2. ele cria as `GOOD_*` no Render copiando os valores
//   3. quando confirmar, o fallback sai e sobra so o padrao
const envGood = (nome) => {
  const novo = process.env['GOOD_' + nome];
  if (novo != null && novo !== '') return novo;
  return process.env[nome];   // historico: a GOOD nasceu sem prefixo
};

// ⚠️ ONDE GRAVAR O TOKEN RENOVADO — a parte perigosa da migracao.
//
// O token e persistido de volta no Render a cada renovacao. Se eu gravasse
// so no nome NOVO agora, na primeira renovacao o `BLING_ACCESS_TOKEN`
// antigo ficaria velho — e voltar atras deixaria de ser possivel.
//
// Entao durante a migracao grava nos DOIS: o que o codigo le hoje continua
// certo, e o novo ja nasce atualizado. No passo 3, quando o fallback sair,
// some o antigo daqui.
const chavesToken = (nome) => (
  process.env['GOOD_' + nome] != null && process.env['GOOD_' + nome] !== ''
    ? ['GOOD_' + nome, nome]     // ja migrou: mantem os dois em dia
    : [nome]                     // ainda nao: so o historico
);
const { atualizarTokensNoRender } = require('./render-tokens');
// b252 - PASSO 2: le o token do DONO (Mover-Pedidos), com a renovacao
// local ainda de rede. Ver lib/token-leitor.js pro porque.
const tokenLeitor = require('./token-leitor');
// b253 - pra avisar o porteiro quando a CONTA levar 429
const porteiroRitmo = require('./ritmo-porteiro');
// b271 - renovacao preventiva pela lib unica
const { registrarPreventiva } = require('./token-preventiva');
let renovarTokenBling = null;   // b272 - definida abaixo, envolvida pelo lock
let ULTIMA_PERSISTENCIA_BLING = false;
let PREVENTIVA_BLING = null;

const BLING_CLIENT_ID = envGood('BLING_CLIENT_ID');
const BLING_CLIENT_SECRET = envGood('BLING_CLIENT_SECRET');
let BLING_ACCESS_TOKEN = envGood('BLING_ACCESS_TOKEN');
let BLING_REFRESH_TOKEN = envGood('BLING_REFRESH_TOKEN');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// AUTH
// ============================================================
// b257 - CONTADOR de renovacao local recusada. No estado `remoto` isto
// tem que ser ZERO — e o numero que prova que o corte funcionou, em vez de
// "ninguem reclamou".
let renovacoesRecusadas = 0;

async function renovarTokenBlingInterno() {
  // ⚠️ EM `remoto` A RENOVACAO LOCAL E RECUSADA E CONTADA.
  //
  // "Desligar" nao pode ser apagar env var nem torcer pra ninguem chamar:
  // ha renovacao por 401, batimento preventivo e rota administrativa de
  // renovacao forcada. Sem esta recusa, o corte seria invisivel — e a
  // corrida do refresh de uso unico voltaria sem aviso.
  // b258 (Codex, P1) - ⚠️ `bloqueado` TAMBEM recusa. Eu so checava `remoto`
  // — mas a rota administrativa de renovacao forcada e o timer preventivo
  // chamam esta funcao DIRETO, sem passar pelo `resolverToken`. Um eixo
  // "bloqueado" ainda mandaria o refresh OAuth pro marketplace.
  const polRenov = tokenLeitor.politicaDe('good', 'bling');
  if (polRenov === 'remoto' || polRenov === 'bloqueado') {
    renovacoesRecusadas++;
    tokenLeitor.registrarRecusa('good', 'bling');   // b258: vai pro /health
    console.warn('[bling] renovacao local RECUSADA: o eixo good/bling esta em `' + polRenov + '` '
      + '(o dono e quem renova). Total recusado: ' + renovacoesRecusadas);
    return false;
  }

  console.log('[Bling] Renovando access token...');
  try {
    const basicAuth = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64');
    const response = await axios.post(
      'https://api.bling.com.br/Api/v3/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: BLING_REFRESH_TOKEN,
      }).toString(),
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    BLING_ACCESS_TOKEN = response.data.access_token;
    if (response.data.refresh_token) BLING_REFRESH_TOKEN = response.data.refresh_token;
    // b271 - carimbo no MESMO write; intervalo sobrevive ao restart
    const gravar = [
      ...chavesToken('BLING_ACCESS_TOKEN').map(k => ({ key: k, value: BLING_ACCESS_TOKEN })),
      ...chavesToken('BLING_REFRESH_TOKEN').map(k => ({ key: k, value: BLING_REFRESH_TOKEN })),
    ];
    const carimbo = PREVENTIVA_BLING && PREVENTIVA_BLING.parEnvCarimbo();
    if (carimbo) gravar.push(carimbo);
    const persistiu = await atualizarTokensNoRender(gravar);
    if (!persistiu) console.error('[Bling] renovou mas NAO persistiu no Render — o refresh gravado esta consumido');
    if (persistiu && PREVENTIVA_BLING) PREVENTIVA_BLING.marcarRenovado();
    ULTIMA_PERSISTENCIA_BLING = !!persistiu;
    return true;
  } catch (error) {
    console.error('[Bling] ERRO renovar:', error.response?.data || error.message);
    return false;
  }
}

// ============================================================
// Reconexao: troca um authorization_code por access+refresh token
// (usado quando escopos do app mudam e precisa reautorizar)
// ============================================================
async function trocarCodePorTokenBling(code) {
  const basicAuth = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64');
  const response = await axios.post(
    'https://api.bling.com.br/Api/v3/oauth/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
    }).toString(),
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '1.0',
      },
    }
  );
  BLING_ACCESS_TOKEN = response.data.access_token;
  if (response.data.refresh_token) BLING_REFRESH_TOKEN = response.data.refresh_token;
  // b273 (review do Codex) - carimba tambem ao autorizar (ver ml.js)
  const gravarAuth = [
    ...chavesToken('BLING_ACCESS_TOKEN').map(k => ({ key: k, value: BLING_ACCESS_TOKEN })),
    ...chavesToken('BLING_REFRESH_TOKEN').map(k => ({ key: k, value: BLING_REFRESH_TOKEN })),
  ];
  const carimboAuth = PREVENTIVA_BLING && PREVENTIVA_BLING.parEnvCarimbo();
  if (carimboAuth) gravarAuth.push(carimboAuth);
  // b274 - so carimba se persistiu de fato (o helper devolve false sem lancar)
  const persistiuAuth = await atualizarTokensNoRender(gravarAuth);
  if (persistiuAuth && PREVENTIVA_BLING) PREVENTIVA_BLING.marcarRenovado();
  if (!persistiuAuth) console.warn('[Bling] tokens ativos na MEMORIA, mas nao persistidos no Render');
  return response.data; // { access_token, refresh_token, scope, expires_in, ... }
}

async function chamarBling(url, opcoes = {}) {
  let _ficha = null;   // 14/10: a ficha da ultima vez dada pelo porteiro — vai nos avisos de ok/429
  let _saiuEm = Date.now();   // 14/10: quando ESTA tentativa saiu — sucesso mais velho que um 429 nao limpa a pausa local
  // b232.4 (Codex): o PORTAO fica AQUI, nao em cada chamador.
  //
  // Eu tinha posto o ritmo so nos detalhes da busca por nome — mas o indice
  // de nomes, a espreita e as outras rotas chamam este mesmo `chamarBling`
  // direto. O portao liberava 3 POR CIMA do que os outros ja estavam
  // mandando, e a conta estourava do mesmo jeito.
  //
  // Aqui todo mundo passa, por construcao: ninguem precisa lembrar de
  // envolver a chamada. `opcoes.semRitmo` existe pro proprio refresh de
  // token, que nao pode ficar preso atras da fila que ele vai destravar.
  // 14/10 (Codex): quem ja esperou a vez por fora (semRitmo) entrega a ficha em `opcoes.ficha`.
  if (!opcoes.semRitmo) _ficha = await ritmo.aguardarVez({ fundo: !!opcoes.fundo });
  else _ficha = opcoes.ficha || null;
  _saiuEm = Date.now();
  // b252 - o token do DONO tem preferencia; o local e a REDE.
  //
  // ⚠️ Nao lanca e nao bloqueia: se o Mover-Pedidos estiver fora, `lerToken`
  // devolve null e seguimos com o `BLING_ACCESS_TOKEN` de sempre. Derrubar
  // a bipagem porque o outro servico caiu seria trocar um problema
  // invisivel (a corrida do refresh) por um visivel no galpao.
  // b255 (Codex, P0) - ⚠️ O TOKEN E RESOLVIDO A CADA TENTATIVA.
  //
  // Antes eu capturava o token UMA vez e o `fazer()` fechava sobre ele.
  // No 401 eu invalidava o cache e chamava `fazer()` de novo — COM O MESMO
  // TOKEN MORTO. A invalidacao nao tinha efeito nenhum na chamada atual;
  // so na proxima, se houvesse.
  //
  // Depois do corte isso seria pior: a renovacao local nao vai mais estar
  // la pra salvar, e o retry bateria de novo no mesmo 401.
  // b257 - a POLITICA decide, nao o "veio null".
  //
  // ⚠️ Em `remoto` NAO HA REDE: se o dono nao entrega, a chamada FALHA em
  // vez de usar o token local. Cair no local ali seria ressuscitar em
  // silencio o renovador desligado — e reabrir a corrida do refresh.
  // b693: de onde veio o token desta tentativa — se o RECUSADO era do dono, o retry vem do dono, em `sombra`
  // tambem (renovar o local nao ajuda: o retry rele o do dono). A nota longa esta em lib-AMB/ml-AMB.js.
  let tokenDoDono = false;
  const tokenAgora = async () => {
    const d = await tokenLeitor.resolverToken('good', 'bling');
    tokenDoDono = d.usar === 'remoto';
    if (d.usar === 'remoto') return d.access;
    if (d.usar === 'falhar') {
      const e = new Error('[token] ' + d.motivo);
      e.semToken = true;
      throw e;
    }
    return BLING_ACCESS_TOKEN;   // sombra ou local: a rede antiga
  };

  // b694: TODA tentativa feita com o token DO DONO avisa o leitor do resultado — aceite (2xx) ou recusa (401/403).
  // E o que separa, no veredito de corte, recusa da rota de problema de token (`anotarAceite` no leitor).
  // O envio e marcado com o token JA resolvido, logo antes de a chamada sair (Codex, #566).
  const fazer = async () => {
    const token = await tokenAgora();
    const doDono = tokenDoDono;
    const envio = tokenLeitor.marcarEnvio();
    let r;
    try {
      r = await axios({
        url,
        method: opcoes.method || 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(opcoes.headers || {}) },
        data: opcoes.data,
        // v4.71 (review do Codex) - sem timeout, uma requisicao travada ficava
        // pendurada pra sempre: o Promise.race so ignorava a resposta, o socket
        // seguia aberto. Agora o axios ABORTA de verdade. O de 30s e o mesmo
        // padrao que a AMB ja usava; quem tem prazo proprio passa opcoes.timeout.
        timeout: opcoes.timeout || 30000,
      });
    } catch (e) {
      if (doDono) tokenLeitor.anotarRecusa('good', 'bling', e.response && e.response.status);
      throw e;
    }
    if (doDono) tokenLeitor.anotarAceite('good', 'bling', envio);
    return r;
  };
  // v4.72 (review do Codex) - quem tem PRAZO proprio (as consultas do kit)
  // pede `semRetentativa`: sem isso, o 401/429 daqui dorme 1,5s e dispara
  // OUTRA requisicao depois que o chamador ja desistiu — trabalho orfao que
  // ainda atropelava a cadencia global.
  try {
    const r = await fazer();
    if (_ficha) porteiroRitmo.avisarOk(opcoes.fundo ? 'fundo' : 'operacao', _ficha, _saiuEm).catch(() => {});   // 14/10: sucesso com ficha zera o degrau
    return { ok: true, data: r.data, status: r.status };
  } catch (error) {
    const recusadoEraDoDono = tokenDoDono;   // b693: guarda ANTES do retry
    if (opcoes.semRetentativa) {
      // b259.1 (Codex, P2) - ⚠️ INVALIDA O TOKEN ANTES DE SAIR TAMBEM.
      //
      // Este retorno antecipado passava na frente da invalidacao la
      // embaixo. Em `remoto`, o token morto do dono ficava em cache por
      // ate 5 MINUTOS — e as chamadas de detalhe de produto (que sao
      // justamente as `semRetentativa`, em volume) levariam 401 uma atras
      // da outra ate o TTL vencer.
      //
      // Mesmo padrao que ja me pegou no aviso do 429: retorno antecipado
      // pula tudo que vem depois.
      if (error.response?.status === 401) {
        tokenLeitor.invalidar('good', 'bling');
        tokenLeitor.anotarInvalidacao('good', 'bling', 401);
      }

      // b253.1 (Codex, P1) - ⚠️ AVISA O PORTEIRO ANTES DE SAIR.
      //
      // Este retorno antecipado pulava o bloco do 429 la embaixo — entao um
      // 429 numa chamada `semRetentativa` NUNCA chegava ao porteiro, e os
      // outros servicos seguiam consumindo a conta ja limitada.
      //
      // Nao e caso raro: sao as chamadas de detalhe de produto do
      // server.js (linhas ~3737 e ~3964), que rodam em volume.
      if (error.response?.status === 429) {
        const ra = Number(error.response?.headers?.['retry-after']);
        // ⚠️ b416 (Codex, P2) - ESTE CAMINHO NAO REGISTRAVA NADA.
      //
      // Instrumentei so o ramo COM retentativa. Quem chama com
      // `semRetentativa` — inclusive o detalhe de produto — avisava o
      // porteiro e sumia. Se o 429 que atrapalha a emissao vier por aqui, o
      // log fica mudo e eu concluo "nao aconteceu" de um caminho que nao
      // olhei.
      console.log('[Bling] 429 (sem retentativa)'
        + ' | retry-after do Bling: '
        + (Number.isFinite(ra) && ra > 0 ? ra + 's' : 'NAO MANDOU (escada do porteiro)')
        + ' | quem: ' + (opcoes.fundo ? 'fundo' : 'operacao'));
      await porteiroRitmo.avisar429(Number.isFinite(ra) && ra > 0 ? ra : 0, opcoes.fundo ? 'fundo' : 'operacao', _ficha);   // 30/09: 0 (nao 60) sem Retry-After; e quem tomou
      }
      // b258 (Codex, P1) - ⚠️ PRESERVA O `semToken`. Sem isto, "o dono nao
    // entregou token e a politica e remoto" chegava a quem chamou como um
    // erro generico sem status — indistinguivel de falha de rede. Quem le
    // isso na tela precisa saber que e configuracao, nao o marketplace.
    return { ok: false, status: error.response?.status,
             semToken: error.semToken || undefined,
             error: error.response?.data || error.message };
    }
    if (error.response?.status === 401) {
      // b252 - ⚠️ INVALIDA O CACHE ANTES DE QUALQUER COISA.
      //
      // O 401 e o sinal combinado com o dono: `expira_em` vem null (os
      // managers de la renovam por 401 e nao expoem o instante), entao o
      // relogio nao serve. Se eu so renovasse o local e deixasse o cache
      // de pe, a proxima chamada pegaria o MESMO token morto do cache e
      // levaria outro 401 — por ate 5 minutos.
      //
      // Invalidar aqui e barato: a proxima leitura re-pede ao dono.
      tokenLeitor.invalidar('good', 'bling');
      // b259: separa 401 de 403 — o parecer pediu, e faz diferenca: 403 em
      // volume pode ser permissao faltando, nao token vencido.
      tokenLeitor.anotarInvalidacao('good', 'bling', 401);

      // ⚠️ e a renovacao local CONTINUA como rede (o corte vem depois, e o
      // Bling e o ULTIMO a sair — o ML primeiro, que e o de uso unico)
      // b258 (Codex, P1) - ⚠️ EM `remoto` O RETRY VEM DO DONO, nao daqui.
      //
      // Eu tinha feito a renovacao local devolver `false` em `remoto` — o
      // que esta certo — mas o retry so acontecia SE ela devolvesse true.
      // Resultado: em `remoto`, a chamada que detectou o token vencido
      // NUNCA era repetida, mesmo com o dono ja tendo o token novo.
      //
      // O cache ja foi invalidado acima, entao `fazer()` relê do dono.
      if (recusadoEraDoDono || tokenLeitor.politicaDe('good', 'bling') === 'remoto') {   // b693: token do dono recusado -> retry do dono
        // 14/10 (Codex): o retry e OUTRA requisicao fisica — pede a vez de novo e usa a ficha nova
        // (semRitmo: sem ficha propria, nao reaproveita a da primeira).
        _ficha = opcoes.semRitmo ? null : await ritmo.aguardarVez({ fundo: !!opcoes.fundo });
        _saiuEm = Date.now();
        try {
          const r = await fazer();
          // b259.2 (Codex, P1) - ⚠️ EU CRIEI `anotarRetry` E NUNCA CHAMEI: contava
          // a invalidacao e nunca o RESULTADO. O resultado do retry e o que prova
          // que a releitura do dono funciona — sem ele o criterio do parecer
          // ("retry aprovado") nao tinha como ser conferido.
          //
          // b267.2 (Codex) - ⚠️ ESTA CHAMADA ESTAVA DEPOIS DE UM `return`,
          // logo morta pra sempre (mesmo bug do lib/ml.js) — o teste que devia
          // acusar isso so olhava a linha ANTERIOR, e havia um bloco de
          // comentario no meio.
          tokenLeitor.anotarRetry('good', 'bling', true, 401);
          if (_ficha) porteiroRitmo.avisarOk(opcoes.fundo ? 'fundo' : 'operacao', _ficha, _saiuEm).catch(() => {});   // 14/10: sucesso com ficha zera o degrau
          return { ok: true, data: r.data, status: r.status };
        } catch (err2) {
            tokenLeitor.anotarRetry('good', 'bling', false, 401, err2.response && err2.response.status);
          return { ok: false, status: err2.response?.status,
                   error: err2.response?.data || err2.message, semToken: err2.semToken };
        }
      }

      if (await renovarTokenBling()) {
        _ficha = opcoes.semRitmo ? null : await ritmo.aguardarVez({ fundo: !!opcoes.fundo });   // 14/10 (Codex): ficha propria do retry
        _saiuEm = Date.now();
        try {
          const r = await fazer();
          tokenLeitor.anotarRetry('good', 'bling', true, 401);
          if (_ficha) porteiroRitmo.avisarOk(opcoes.fundo ? 'fundo' : 'operacao', _ficha, _saiuEm).catch(() => {});   // 14/10: sucesso com ficha zera o degrau
          return { ok: true, data: r.data, status: r.status };
        } catch (err2) {
            tokenLeitor.anotarRetry('good', 'bling', false, 401, err2.response && err2.response.status);
          return { ok: false, status: err2.response?.status, error: err2.response?.data || err2.message };
        }
      }
    }
    if (error.response?.status === 429) {
      // b234 - A RETENTATIVA TAMBEM PASSA PELO PORTAO.
      //
      // O JSON do dono mostrou dois detalhes com 429 mesmo com o ritmo
      // global ligado, gastando 1802ms e 1732ms — tempo de RETRY, nao de
      // resposta. A causa: este `fazer()` era chamado DIRETO. Cada 429
      // virava uma chamada fora do controle, atropelando a onda seguinte e
      // gerando mais 429 — bola de neve.
      //
      // E a espera cresce a cada tentativa: 1,5s fixo fazia varias
      // retentativas caírem juntas na mesma janela.
      // b253 - ⚠️ AVISA O PORTEIRO. Sem isto, os OUTROS servicos que
      // dividem a conta `good` continuam consumindo enquanto ela ja esta
      // limitada — e cada um descobre por conta propria, com o seu 429.
      //
      // ARMADILHA 4 (Codex): mando o `Retry-After` REAL quando o Bling
      // manda um. Se ele for MAIOR que a pausa que ja esta valendo, o
      // porteiro estende — senao os outros voltam com o prazo curto do
      // primeiro 429.
      const retryHeader = Number(error.response?.headers?.['retry-after']);
      await porteiroRitmo.avisar429(Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : 0, opcoes.fundo ? 'fundo' : 'operacao', _ficha);   // 30/09

      // ⚠️ b413 - REGISTRA O QUE DECIDE O CONSERTO, sem mudar comportamento.
      //
      // Emitir 2 NFs ao mesmo tempo levou 3 minutos; 1 sozinha é rápida. A
      // causa provável: alguém toma 429 e o porteiro pausa a fila INTEIRA por
      // 60s — inclusive a emissão, que tem reserva justamente pra não parar.
      //
      // ⚠️ Mas 2 coisas decidem o conserto e eu NÃO SEI nenhuma:
      //   o Bling manda `retry-after`? (se manda, os 60s quase nunca valem)
      //   quem estourou — o fundo, ou a própria emissão?
      //
      // Chutar aqui é caro: soltar a operação durante um 429 real pode
      // estender o bloqueio da conta. Então meço primeiro. Na próxima vez que
      // acontecer, o log responde e o conserto vem com dado.
      console.log('[Bling] 429 - aguardando e reentrando na fila'
        + ' | retry-after do Bling: '
        + (Number.isFinite(retryHeader) && retryHeader > 0
            ? retryHeader + 's' : 'NAO MANDOU (escada do porteiro)')
        + ' | quem: ' + (opcoes.fundo ? 'fundo' : 'operacao')
        + ' | pausa ja ativa: ' + (porteiroRitmo.diagnostico
            ? (porteiroRitmo.diagnostico().pausa_termina_em_s || 0) + 's' : '?'));
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        await sleep(1500 * tentativa);
        _ficha = opcoes.semRitmo ? null : await ritmo.aguardarVez({ fundo: !!opcoes.fundo });   // 14/10: semRitmo nao reaproveita a ficha da 1a
        _saiuEm = Date.now();
        try {
          const r = await fazer();
          if (_ficha) porteiroRitmo.avisarOk(opcoes.fundo ? 'fundo' : 'operacao', _ficha, _saiuEm).catch(() => {});   // 14/10: sucesso com ficha zera o degrau
          return { ok: true, data: r.data, status: r.status };
        } catch (err2) {
          // 30/09 (Codex, P2) - cada 429 da retentativa tambem avanca a escada
          // do porteiro; antes so o primeiro era avisado.
          if (err2.response?.status === 429) {
            const raRetry = Number(err2.response?.headers?.['retry-after']);
            await porteiroRitmo.avisar429(Number.isFinite(raRetry) && raRetry > 0 ? raRetry : 0, opcoes.fundo ? 'fundo' : 'operacao', _ficha);
          }
          if (err2.response?.status !== 429 || tentativa === 3) {
            return { ok: false, status: err2.response?.status, error: err2.response?.data || err2.message };
          }
        }
      }
    }
    // b258 (Codex, P1) - ⚠️ PRESERVA O `semToken`. Sem isto, "o dono nao
    // entregou token e a politica e remoto" chegava a quem chamou como um
    // erro generico sem status — indistinguivel de falha de rede. Quem le
    // isso na tela precisa saber que e configuracao, nao o marketplace.
    return { ok: false, status: error.response?.status,
             semToken: error.semToken || undefined,
             error: error.response?.data || error.message };
  }
}

// ============================================================
// PEDIDOS (vendas)
// ============================================================

async function buscarPedidoBlingPorId(idPedido, opcoes = {}) {
  return chamarBling(`https://api.bling.com.br/Api/v3/pedidos/vendas/${idPedido}`, opcoes);
}

// ============================================================
// NFe
// ============================================================
async function buscarNFePorId(idNFe, opcoes = {}) {
  // b232.4: repassa opcoes — quem ja esperou no portao manda semRitmo,
  // senao a chamada passaria DUAS vezes pela fila
  return chamarBling(`https://api.bling.com.br/Api/v3/nfe/${idNFe}`, opcoes);
}

/**
 * Busca NF no Bling pelo numero. Pagina /nfe ate achar.
 */
// ============================================================
// BUSCAS DE NF E PEDIDO — PECA UNICA (b703)
// ------------------------------------------------------------
// ⚠️ As ~1.000 linhas que moravam aqui (buscarNFBlindada, buscarNFPelaChave, buscarNFnoBlingPorNumero,
// buscarNFnoBlingPorOrderId, buscarPedidoBlingPorNumeroLoja) eram uma COPIA da fabrica (admin-helpers-AMB.js), e as
// duas divergiam nos dois sentidos. Agora vivem em lib/bling-buscas.js, montadas com o cliente desta empresa. O que
// a GOOD ganhou com isso: o sinal `parar()` da blindada e a NF VIVA MAIS RECENTE no filtro direto (b172 — a GOOD
// devolvia `lista[0]`, que podia ser a cancelada).
// ============================================================
const buscas = require('./bling-buscas')({
  chamarBling,
  buscarNFePorId,
  buscarPedidoPorId: buscarPedidoBlingPorId,
  sleep,
  rotulo: 'Bling',
});
const { buscarPedidoBlingPorNumeroLoja, buscarNFPelaChave, buscarNFnoBlingPorNumero, buscarNFnoBlingPorOrderId, buscarNFBlindada } = buscas;

// ============================================================
// PRODUTOS
// ============================================================

/**
 * Busca produto por SKU/codigo. Retorna detalhes completos (com EAN).
 * Licoes do projeto Localizacao Estoque GOOD: produtos com variacoes tem
 * codigo='COR:DOURADO' na listagem, EAN em varios campos diferentes.
 */
async function buscarProdutoBlingPorSku(sku) {
  const skuClean = String(sku).trim();
  if (!skuClean) return { ok: true, produto: null };

  const skuEnc = encodeURIComponent(skuClean);
  // Aumenta limite pra pegar produtos pai+filhos (variacoes)
  const url = `https://api.bling.com.br/Api/v3/produtos?codigo=${skuEnc}&limite=20`;
  const r = await chamarBling(url);
  if (!r.ok) return { ok: false, error: r.error };

  const lista = r.data?.data || [];
  if (lista.length === 0) return { ok: true, produto: null };

  // 1) Tenta match EXATO pelo codigo (case-sensitive)
  let match = lista.find(p => String(p.codigo || '').trim() === skuClean);

  // 2) Tenta match case-insensitive (estoquista pode ter mudado caixa)
  if (!match) {
    const skuUpper = skuClean.toUpperCase();
    match = lista.find(p => String(p.codigo || '').trim().toUpperCase() === skuUpper);
  }

  // 3) b666 - SEM match exato NAO e "o primeiro da lista". O `?codigo=` do
  // Bling e uma BUSCA: devolve parecidos (e, com um EAN no lugar do SKU,
  // devolve qualquer coisa). O fallback `lista[0]` carimbava um produto
  // ALEATORIO — caso real (GOOD, 07/11): no divergente da NF 080043 o codigo
  // bipado da luminaria 801s virou "Arandela KJBD-148-GOLD", o primeiro que o
  // Bling listou. A copia da fabrica (bling-AMB.buscarProdutoPorSku) ja
  // devolvia so o `exato`; a GOOD nivela por cima. Ambiguidade nao escolhe.
  if (!match) return { ok: true, produto: null, candidatos: lista.length };

  // Busca detalhes individuais (EAN so vem aqui)
  if (match.id) {
    await sleep(300); // evita rate limit
    const rDetalhe = await chamarBling(`https://api.bling.com.br/Api/v3/produtos/${match.id}`);
    if (rDetalhe.ok && rDetalhe.data?.data) {
      return { ok: true, produto: rDetalhe.data.data };
    }
  }

  return { ok: true, produto: match };
}

PREVENTIVA_BLING = registrarPreventiva({
  empresa: 'good', integracao: 'bling',
  // b258 (Codex, P2) - ⚠️ EM `remoto`/`bloqueado` O PREVENTIVO NEM TENTA.
  //
  // A recusa nao avanca o carimbo, entao o timer voltava a cada hora,
  // levava outra recusa e inflava o contador — que e justamente o numero
  // que deveria PROVAR que nada mais renova. Telemetria poluida pela
  // propria protecao.
  temRefresh: () => {
    const pol = tokenLeitor.politicaDe('good', 'bling');
    if (pol === 'remoto' || pol === 'bloqueado') return false;
    return !!BLING_REFRESH_TOKEN;
  },
  renovar: () => renovarTokenBling(),
  persistiu: () => ULTIMA_PERSISTENCIA_BLING,
  carimboEnv: 'BLING_RENOVADO_EM',
  diasEnv: 'BLING_RENOVAR_DIAS',
});
// b272 (review do Codex) - o caminho normal (401) passa a usar O MESMO lock
// da preventiva: sem isto, o batimento e um 401 podiam mandar o MESMO
// refresh de uso unico ao mesmo tempo, e um dos dois falharia.
renovarTokenBling = PREVENTIVA_BLING.guardarRenovacao(renovarTokenBlingInterno);

// ═══════════════════════════════════════════════════════════════════
// b294 - IDS FISCAIS DESTA EMPRESA (mesma peca que a AMB ganhou na b283).
//
// Motivo: a extensao Bridge tem os ids da GOOD CRAVADOS, com um comentario
// no proprio arquivo admitindo "sao especificos da GOOD. Girassol/AMB teriam
// outros" — ou seja, hoje ela so emite NF de devolucao pra uma empresa.
// Pra ela virar multi-empresa sem adivinhar nada, cada empresa precisa
// responder quais sao os SEUS ids. A AMB ja responde; esta e a vez da GOOD.
//
// A sonda da b282 mostrou que `GET /naturezas-operacoes` existe e a natureza
// da pra achar pelo NOME; o id da empresa nao tem API (`/empresas` da 404),
// entao vem de env, com o valor de hoje como padrao.
// ═══════════════════════════════════════════════════════════════════
let _natCacheGood = { ts: 0, lista: [] };

async function listarNaturezas(forcar) {
  if (!forcar && _natCacheGood.ts && (Date.now() - _natCacheGood.ts) < 30 * 60 * 1000) {
    return { ok: true, naturezas: _natCacheGood.lista, cache: true };
  }
  const r = await chamarBling('https://api.bling.com.br/Api/v3/naturezas-operacoes?limite=100&pagina=1');
  if (!r.ok) return { ok: false, status: r.status, erro: 'Bling nao devolveu as naturezas de operacao' };
  const lista = ((r.data && r.data.data) || []).map((n) => ({
    id: String(n.id),
    descricao: n.descricao || ('natureza ' + n.id),
    padrao: n.padrao != null ? n.padrao : null,
  }));
  _natCacheGood = { ts: Date.now(), lista };
  return { ok: true, naturezas: lista };
}

/** Natureza de DEVOLUCAO DE ENTRADA. Ambiguidade NAO escolhe: um unico
 *  candidato serve, mais de um recusa e pede a env (regra da b284/b285). */
async function naturezaDevolucaoEntrada() {
  const forcado = String(process.env.GOOD_ID_NATUREZA_DEVOLUCAO_ENTRADA || '').trim();
  if (forcado) return { ok: true, id: forcado, via: 'env' };
  const r = await listarNaturezas(false);
  if (!r.ok) return { ok: false, erro: r.erro || 'nao consegui listar as naturezas' };
  // b296 (review do Codex) - normaliza tambem o ESPACO. Sem isso, uma
  // duplicata que difere so por espaco (extra no meio, sobrando na ponta)
  // NAO casava como igual: `exatas` ficava com uma linha so e o retorno
  // antecipado escolhia a canonica, driblando justamente a regra de
  // "ambiguidade nao escolhe" que este trecho existe pra garantir.
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  const exatas = r.naturezas.filter((n) => norm(n.descricao) === 'devolucao de mercadoria - entrada');
  if (exatas.length === 1) return { ok: true, id: exatas[0].id, descricao: exatas[0].descricao, via: 'api_nome_exato' };
  if (exatas.length > 1) {
    return { ok: false, erro: 'ha mais de uma natureza com esse nome nesta empresa — defina GOOD_ID_NATUREZA_DEVOLUCAO_ENTRADA',
      candidatos: exatas.slice(0, 5).map((n) => ({ id: n.id, descricao: n.descricao })) };
  }
  const perto = r.naturezas.filter((n) => /devolu/.test(norm(n.descricao)) && /entrada/.test(norm(n.descricao)) && !/compra/.test(norm(n.descricao)));
  if (perto.length === 1) return { ok: true, id: perto[0].id, descricao: perto[0].descricao, via: 'api_nome_aproximado' };
  if (perto.length > 1) {
    return { ok: false, erro: 'mais de uma natureza de "devolucao ... entrada" nesta empresa — defina GOOD_ID_NATUREZA_DEVOLUCAO_ENTRADA',
      candidatos: perto.slice(0, 5).map((n) => ({ id: n.id, descricao: n.descricao })) };
  }
  return { ok: false, erro: 'nenhuma natureza de "devolucao ... entrada" encontrada nesta empresa' };
}

async function idsFiscais() {
  const empresa = String(process.env.GOOD_ID_EMPRESA_CONTROL || '4956030980').trim();
  const nat = await naturezaDevolucaoEntrada();
  return {
    ok: !!(empresa && nat.ok),
    empresa_nome: 'GOOD Import',
    idEmpresaControl: empresa || null,
    empresa_via: process.env.GOOD_ID_EMPRESA_CONTROL ? 'env' : 'padrao_do_codigo',
    idNaturezaOperacao: nat.ok ? nat.id : null,
    natureza_via: nat.via || null,
    natureza_descricao: nat.descricao || null,
    candidatos: nat.candidatos || undefined,
    erro: nat.ok ? null : nat.erro,
  };
}

module.exports = {
  preventivaBling: PREVENTIVA_BLING,   // b271
  listarNaturezas, naturezaDevolucaoEntrada, idsFiscais,   // b294

  // Auth
  chamarBling,
  renovarTokenBling,

  // Pedidos
  buscarPedidoBlingPorNumeroLoja,
  buscarPedidoBlingPorId,

  // NFe
  buscarNFePorId,
  buscarNFnoBlingPorNumero,
  buscarNFPelaChave,   // b221 - busca EXATA pela chave
  buscarNFnoBlingPorOrderId,
  buscarNFBlindada,

  // Produtos
  buscarProdutoBlingPorSku,

  // Status
  hasToken: () => !!BLING_ACCESS_TOKEN,

  // Reconexao (reautorizar apos mudar escopos)
  trocarCodePorTokenBling,
};
