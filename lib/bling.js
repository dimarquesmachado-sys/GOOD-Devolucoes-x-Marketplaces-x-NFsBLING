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
const { atualizarTokensNoRender } = require('./render-tokens');
// b271 - renovacao preventiva pela lib unica
const { registrarPreventiva } = require('./token-preventiva');
let renovarTokenBling = null;   // b272 - definida abaixo, envolvida pelo lock
let ULTIMA_PERSISTENCIA_BLING = false;
let PREVENTIVA_BLING = null;

const BLING_CLIENT_ID = process.env.BLING_CLIENT_ID;
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET;
let BLING_ACCESS_TOKEN = process.env.BLING_ACCESS_TOKEN;
let BLING_REFRESH_TOKEN = process.env.BLING_REFRESH_TOKEN;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// AUTH
// ============================================================
async function renovarTokenBlingInterno() {
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
      { key: 'BLING_ACCESS_TOKEN', value: BLING_ACCESS_TOKEN },
      { key: 'BLING_REFRESH_TOKEN', value: BLING_REFRESH_TOKEN },
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
    { key: 'BLING_ACCESS_TOKEN', value: BLING_ACCESS_TOKEN },
    { key: 'BLING_REFRESH_TOKEN', value: BLING_REFRESH_TOKEN },
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
  const fazer = () => axios({
    url,
    method: opcoes.method || 'GET',
    headers: { Authorization: `Bearer ${BLING_ACCESS_TOKEN}`, ...(opcoes.headers || {}) },
    data: opcoes.data,
    // v4.71 (review do Codex) - sem timeout, uma requisicao travada ficava
    // pendurada pra sempre: o Promise.race so ignorava a resposta, o socket
    // seguia aberto. Agora o axios ABORTA de verdade. O de 30s e o mesmo
    // padrao que a AMB ja usava; quem tem prazo proprio passa opcoes.timeout.
    timeout: opcoes.timeout || 30000,
  });
  // v4.72 (review do Codex) - quem tem PRAZO proprio (as consultas do kit)
  // pede `semRetentativa`: sem isso, o 401/429 daqui dorme 1,5s e dispara
  // OUTRA requisicao depois que o chamador ja desistiu — trabalho orfao que
  // ainda atropelava a cadencia global.
  try {
    const r = await fazer();
    return { ok: true, data: r.data, status: r.status };
  } catch (error) {
    if (opcoes.semRetentativa) {
      return { ok: false, status: error.response?.status, error: error.response?.data || error.message };
    }
    if (error.response?.status === 401) {
      if (await renovarTokenBling()) {
        try {
          const r = await fazer();
          return { ok: true, data: r.data, status: r.status };
        } catch (err2) {
          return { ok: false, status: err2.response?.status, error: err2.response?.data || err2.message };
        }
      }
    }
    if (error.response?.status === 429) {
      console.log('[Bling] 429 - aguardando 1.5s');
      await sleep(1500);
      try {
        const r = await fazer();
        return { ok: true, data: r.data, status: r.status };
      } catch (err2) {
        return { ok: false, status: err2.response?.status, error: err2.response?.data || err2.message };
      }
    }
    return { ok: false, status: error.response?.status, error: error.response?.data || error.message };
  }
}

// ============================================================
// PEDIDOS (vendas)
// ============================================================

/**
 * Busca pedido por numeroLoja (= order_id ML). Pagina ate achar ou estourar limite.
 * @param {string|number} numeroLoja  order_id ML
 * @param {string|Date} [dataReferencia]  data pra cortar busca depois de DIAS_FOLGA dias antes dela
 * @param {{maxPaginas?:number}} [opcoes]
 * @returns {Promise<{ok:boolean, match:object|null, pagina?:number, totalScanned:number, primeiraDataVista:string|null, ultimaDataVista:string|null, status?:number, error?:any}>}
 */
async function buscarPedidoBlingPorNumeroLoja(numeroLoja, dataReferencia, opcoes = {}) {
  // v3.37 - 3 fases (mata o "salvando infinito" do aprovar):
  //   A) filtro DIRETO numerosLojas[] (1 chamada - mesmo espirito do
  //      numeroLoja do /nfe que salvou a busca blindada)
  //   B) janela por data da NF (dataInicial/Final, ate 4 paginas)
  //   C) varredura curta do presente pro passado (fallback, cap baixo)
  const numeroLojaStr = String(numeroLoja).trim();
  const LIMITE_PAGINA = 100;
  const DELAY_MS = 400;
  const DIAS_FOLGA = 7;
  const bate = (p) => String(p.numeroLoja || '').trim() === numeroLojaStr;

  // ---- FASE A: filtro direto ----
  try {
    const urlA = `https://api.bling.com.br/Api/v3/pedidos/vendas?limite=20&pagina=1&numerosLojas[]=${encodeURIComponent(numeroLojaStr)}`;
    const rA = await chamarBling(urlA);
    if (rA.ok) {
      const m = (rA.data?.data || []).find(bate);
      if (m) {
        console.log(`[Bling] Pedido numeroLoja=${numeroLojaStr}: achou pelo FILTRO direto (id=${m.id})`);
        return { ok: true, match: m, via: 'filtro-numerosLojas', totalScanned: (rA.data?.data || []).length };
      }
    }
  } catch (e) { /* segue pras outras fases */ }

  // ---- FASE B: janela pela data de referencia ----
  let refValida = null;
  if (dataReferencia) {
    const ref = new Date(dataReferencia);
    if (!isNaN(ref.getTime())) refValida = ref;
  }
  if (refValida) {
    const f = (t) => new Date(t).toISOString().slice(0, 10);
    const ini = f(refValida.getTime() - DIAS_FOLGA * 864e5);
    const fimJ = f(refValida.getTime() + DIAS_FOLGA * 864e5);
    for (let pg = 1; pg <= 4; pg++) {
      await sleep(DELAY_MS);
      const url = `https://api.bling.com.br/Api/v3/pedidos/vendas?limite=${LIMITE_PAGINA}&pagina=${pg}&dataInicial=${ini}&dataFinal=${fimJ}`;
      const r = await chamarBling(url);
      if (!r.ok) break;
      const lista = r.data?.data || [];
      if (lista.length === 0) break;
      const m = lista.find(bate);
      if (m) {
        console.log(`[Bling] Pedido numeroLoja=${numeroLojaStr}: achou pela JANELA ${ini}..${fimJ} (pg${pg})`);
        return { ok: true, match: m, via: 'janela-data', pagina: pg };
      }
      if (lista.length < LIMITE_PAGINA) break;
    }
  }

  // ---- FASE C: varredura curta (fallback) ----
  const MAX_PAGINAS = Math.min(opcoes.maxPaginas || 12, 15);
  let dataLimite = refValida ? new Date(refValida.getTime() - DIAS_FOLGA * 864e5) : null;
  console.log(`[Bling] Pedido numeroLoja=${numeroLojaStr}: varredura curta (max ${MAX_PAGINAS}pgs)`);
  let totalScanned = 0;
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    if (pagina > 1) await sleep(DELAY_MS);
    const url = `https://api.bling.com.br/Api/v3/pedidos/vendas?limite=${LIMITE_PAGINA}&pagina=${pagina}`;
    const r = await chamarBling(url);
    if (!r.ok) {
      return { ok: false, status: r.status, error: r.error, totalScanned };
    }
    const lista = r.data?.data || [];
    if (lista.length === 0) break;
    totalScanned += lista.length;
    const match = lista.find(bate);
    if (match) {
      console.log(`[Bling] Encontrado pag ${pagina}: id=${match.id}`);
      return { ok: true, match, via: 'varredura', pagina, totalScanned };
    }
    if (dataLimite && lista[lista.length - 1]?.data) {
      const dataPedido = new Date(lista[lista.length - 1].data);
      if (dataPedido < dataLimite) break;
    }
    if (lista.length < LIMITE_PAGINA) break;
  }
  return { ok: true, match: null, totalScanned };
}
async function buscarPedidoBlingPorId(idPedido) {
  return chamarBling(`https://api.bling.com.br/Api/v3/pedidos/vendas/${idPedido}`);
}

// ============================================================
// NFe
// ============================================================
async function buscarNFePorId(idNFe) {
  return chamarBling(`https://api.bling.com.br/Api/v3/nfe/${idNFe}`);
}

/**
 * Busca NF no Bling pelo numero. Pagina /nfe ate achar.
 */
async function buscarNFnoBlingPorNumero(numeroNF, dataReferencia, opcoes = {}) {
  const numeroNFStr = String(numeroNF).trim().padStart(6, '0'); // 71932 -> 071932
  const numeroNFLimpo = String(numeroNF).trim().replace(/^0+/, ''); // remove zeros a esquerda

  // b203 - FILTRO DIRETO POR NUMERO, antes de paginar.
  //
  // [stated] "pq vc fica indo atrás de pedido. pode ser q algum pedido esteja
  // com erro, não tenha, por ter sido importado XML do full. vc tinha q tá
  // pegando nota fiscal. nf sim sempre terá."
  //
  // Ele esta certo: o PEDIDO pode nao existir (XML do Full importado nao
  // cria pedido no Bling), mas a NOTA sempre existe — e nesses casos eu ja
  // tenho o numero e a chave. Eu procurava pela ponta fragil tendo a firme.
  //
  // O /nfe aceita `numero` como filtro: UMA chamada, sem paginar.
  try {
    // b204.3 (Codex): RITMO DENTRO da helper tambem.
    //
    // Uma chamada dela pode disparar 3 requests: numero com padding, sem
    // padding, e a pagina 1 da varredura. A pausa de 350ms entre ITENS nao
    // cobre isso — os 3 saem juntos e estouram os 3 req/s do Bling.
    let feitas = 0;
    // b204.6 (Codex): sem repetir a MESMA grafia. Numero com 6+ digitos e
    // sem zeros a esquerda tem `numeroNFStr === numeroNFLimpo` — eu fazia a
    // mesma chamada duas vezes, gastando 350ms e um request por item.
    for (const alvo of [...new Set([numeroNFStr, numeroNFLimpo])]) {
      if (!alvo) continue;
      if (feitas > 0) await sleep(350);
      feitas++;
      // b207 - A SERIE VEM NA CHAVE, entao filtro por ela tambem.
      //
      // O dono achou o caso: NF 637 serie 001 (a dele, de maio) e NF 637
      // serie 003 (de agosto) sao notas DIFERENTES com o mesmo numero. A
      // busca so por numero devolvia a mais recente — a errada — e minha
      // checagem de chave recusava, deixando o caso sem vinculo.
      //
      // Com a serie no filtro, a busca ja vem certa. E se a nota da serie
      // certa nao existir, o resultado vazio DIZ isso, em vez de trazer a
      // outra e ser recusada depois.
      const serieDaChave = String(opcoes.chave || '').replace(/\D/g, '').length === 44
        ? String(String(opcoes.chave).replace(/\D/g, '').slice(22, 25)).replace(/^0+/, '')
        : null;
      const urlDireta = 'https://api.bling.com.br/Api/v3/nfe?limite=20&pagina=1&tipo=1'
        + '&numero=' + encodeURIComponent(alvo)
        + (serieDaChave ? '&serie=' + encodeURIComponent(serieDaChave) : '');
      const rd = await chamarBling(urlDireta);
      const lista = (rd.ok && rd.data?.data) ? rd.data.data : [];
      const batem = lista.filter((nf) => {
        const n = String(nf.numero || '').replace(/^0+/, '');
        return n === numeroNFLimpo;
      });
      const vivas = batem.filter((nf) => !nfeDescartavel(nf))
        .sort((a, b) => String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));
      if (vivas.length) {
        console.log(`[Bling] NF ${alvo} achada pelo FILTRO DIRETO (id=${vivas[0].id})`);
        // b208 - devolve TODAS as vivas, nao so a primeira.
        //
        // Quem chama precisa das candidatas pra confrontar (serie,
        // marketplace, cliente) — e, se nada desempatar, mostrar a lista
        // pro dono escolher. [stated] "deixa as NFs iguais q eu seleciono."
        return { ok: true, match: vivas[0], candidatas: vivas, via: 'filtro_direto_numero',
          totalScanned: lista.length, primeiraDataVista: null, ultimaDataVista: null };
      }
      // b204.8 (Codex): NAO desisto aqui.
      //
      // Se cheguei ate aqui, `vivas` esta vazio — ou o numero nao casou, ou
      // casou so com nota MORTA. Nos dois casos a grafia alternativa ainda
      // pode achar a viva, e sao no maximo 2 tentativas (deduplicadas), com
      // pausa entre elas. Parar aqui era desistir cedo demais.
    }
  } catch (e) { /* segue pra varredura */ }

  // b204.4 (Codex): pausa ANTES de entrar na varredura tambem. Sem ela, a
  // pagina 1 saia colada na 2a tentativa direta — 4 requests numa janela de
  // 1s, com os 3 req/s do Bling ja no limite.
  await sleep(350);
  const MAX_PAGINAS = opcoes.maxPaginas || 50;
  const LIMITE_PAGINA = 100;
  const DELAY_MS = 400;
  const DIAS_FOLGA = 5;

  let dataLimite = null;
  if (dataReferencia) {
    const ref = new Date(dataReferencia);
    if (!isNaN(ref.getTime())) {
      dataLimite = new Date(ref.getTime() - DIAS_FOLGA * 24 * 60 * 60 * 1000);
    }
  }

  console.log(`[Bling] BUSCA NF por numero=${numeroNFStr} (alt: ${numeroNFLimpo}) max ${MAX_PAGINAS}pgs`);

  let totalScanned = 0;
  let primeiraDataVista = null;
  let ultimaDataVista = null;

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    if (pagina > 1) await sleep(DELAY_MS);
    const url = `https://api.bling.com.br/Api/v3/nfe?limite=${LIMITE_PAGINA}&pagina=${pagina}&tipo=1`;
    const r = await chamarBling(url);

    if (!r.ok) {
      return { ok: false, status: r.status, error: r.error, totalScanned, primeiraDataVista, ultimaDataVista };
    }

    const lista = r.data?.data || [];
    if (lista.length === 0) break;

    if (pagina === 1 && lista[0]) primeiraDataVista = lista[0].dataEmissao;
    if (lista[lista.length - 1]) ultimaDataVista = lista[lista.length - 1].dataEmissao;

    totalScanned += lista.length;

    // Match por numero - tenta varias formas
    // b204.7 (Codex): a varredura tambem descarta nota MORTA.
    //
    // O filtro direto acima ja recusava cancelada/denegada, mas aqui o
    // `find` aceitava qualquer uma com o numero — entao o caminho de
    // reserva devolvia justamente a nota que o principal tinha recusado, e
    // o dono geraria a devolucao contra uma nota que nao existe mais.
    //
    // Entre as vivas, a mais recente (o Bling nao garante a ordem).
    const candidatas = lista.filter(nf => {
      const numeroBling = String(nf.numero || '').trim();
      const numeroBlingLimpo = numeroBling.replace(/^0+/, '');
      return numeroBling === numeroNFStr ||
             numeroBlingLimpo === numeroNFLimpo ||
             numeroBling === String(numeroNF);
    });
    const match = candidatas
      .filter(nf => !nfeDescartavel(nf))
      .sort((a, b) => String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')))[0];

    if (match) {
      console.log(`[Bling] NF ENCONTRADA pag ${pagina}: numero=${match.numero} id=${match.id}`);
      return { ok: true, match, pagina, totalScanned, primeiraDataVista, ultimaDataVista };
    }

    if (dataLimite && lista[lista.length - 1]?.dataEmissao) {
      const dataNF = new Date(lista[lista.length - 1].dataEmissao);
      if (dataNF < dataLimite) break;
    }

    if (lista.length < LIMITE_PAGINA) break;
  }

  return { ok: true, match: null, totalScanned, primeiraDataVista, ultimaDataVista };
}

/**
 * Pagina /nfe procurando por numeroPedidoLoja=order_id ML.
 * Vantagem: NFs nao somem mesmo se o pedido for cancelado depois.
 * E se acharmos a NF aqui, ja temos linkDanfe direto sem precisar buscar pedido.
 */
// v3.73 - situacoes da NF-e no Bling v3 (constatado: o filtro ?situacao=5
// do F3 em producao so acha AUTORIZADAS -> tabela oficial 1-11 vale:
// 1 Pendente, 2 CANCELADA, 3 Aguardando recibo, 4 Rejeitada, 5 Autorizada,
// 6 Emitida DANFE, 7 Registrada, 8 Aguardando protocolo, 9 DENEGADA).
// Cancelada/denegada NAO servem: chave/DANFE/valor de nota morta.
const NFE_DESCARTAVEL = new Set([2, 9]);
const nfeDescartavel = (nf) => NFE_DESCARTAVEL.has(Number(nf && nf.situacao));

async function buscarNFnoBlingPorOrderId(orderIdML, dataReferencia, opcoes = {}) {
  const orderIdStr = String(orderIdML).trim();

  // b197.6 (Codex): FILTRO DIRETO antes de varrer.
  //
  // A varredura em fatias nunca fecha a conta: com 44 notas/dia, 2 paginas
  // cobrem 4,5 dias — pra cobrir uma fatia de 20 sem buracos eu teria 24
  // dias de alcance total, e a venda que motivou tudo isto e de 4 meses
  // atras. Escolher entre "cobre perto" e "olha longe" e escolher errado
  // nos dois casos.
  //
  // O /nfe do Bling aceita `numeroLoja` como filtro — UMA chamada, sem
  // paginar. E o mesmo caminho que `buscarPedidoBlingPorNumeroLoja` ja usa
  // na fase A dela. A varredura vira so o plano B, pra quando o filtro nao
  // devolver nada.
  try {
    const urlDireta = 'https://api.bling.com.br/Api/v3/nfe?limite=20&pagina=1&tipo=1'
      + '&numeroLoja=' + encodeURIComponent(orderIdStr);
    const rd = await chamarBling(urlDireta);
    const achadas = (rd.ok && rd.data?.data) ? rd.data.data : [];
    // b198 - O PEDIDO MORA EM VARIOS CAMPOS.
    //
    // O dono abriu a NF no Bling e mostrou: o pedido do TikTok esta em
    // "Numero loja virtual", nao no `numeroPedidoLoja` que eu exigia. Por
    // isso o filtro achava a nota e eu a descartava logo depois.
    //
    // A `buscarNFBlindada` deste mesmo arquivo ja lida com isso na FASE 0:
    // ela aceita o que o filtro devolveu. Faco o mesmo, mas conferindo os
    // campos conhecidos primeiro — e so caindo na primeira quando nenhum
    // bate, porque o Bling ja filtrou por numeroLoja e nao devolveria nota
    // de outro pedido.
    const bateAlgum = (nf) => [nf.numeroPedidoLoja, nf.numeroLoja, nf.numeroPedido]
      .some((v) => String(v || '').trim() === orderIdStr);
    const batem = achadas.some(bateAlgum)
      ? achadas.filter(bateAlgum)
      : achadas;
    // b197.7 (Codex): ORDENAR antes de escolher. A ordem que o Bling
    // devolve nao e garantida — o proprio fallback abaixo ja ordena por
    // `dataEmissao` por isso. Pegando a primeira crua, um pedido com mais
    // de uma nota viva podia devolver a ANTIGA, e o dono geraria a
    // devolucao contra a nota errada.
    const vivasD = batem.filter((nf) => !nfeDescartavel(nf))
      .sort((a, b) => String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));
    if (vivasD.length) {
      console.log(`[Bling] NF achada pelo FILTRO DIRETO numeroLoja=${orderIdStr} (id=${vivasD[0].id})`
        + (vivasD.length > 1 ? ` — ${vivasD.length} vivas, peguei a mais recente` : ''));
      return { ok: true, match: vivasD[0], totalScanned: achadas.length, via: 'filtro_direto',
        vivas_no_pedido: vivasD.length > 1 ? vivasD.length : undefined,
        primeiraDataVista: null, ultimaDataVista: null };
    }
  } catch (e) { /* segue pra varredura */ }
  const MAX_PAGINAS = opcoes.maxPaginas || 50;
  const LIMITE_PAGINA = 100;
  // b197 - o Bling limita a 3 req/s e a busca batia nisso: o diagnostico
  // voltou TOO_MANY_REQUESTS depois de 400 notas. 700ms fica com folga.
  const DELAY_MS = opcoes.delayMs || 700;
  const DIAS_FOLGA = 5;

  let dataLimite = null;
  if (dataReferencia) {
    const ref = new Date(dataReferencia);
    if (!isNaN(ref.getTime())) {
      dataLimite = new Date(ref.getTime() - DIAS_FOLGA * 24 * 60 * 60 * 1000);
    }
  }

  console.log(`[Bling] BUSCA NFs por numeroPedidoLoja=${orderIdStr} max ${MAX_PAGINAS}pgs`);

  let totalScanned = 0;
  let primeiraDataVista = null;
  let ultimaDataVista = null;
  let primeiraNumero = null;
  let ultimaNumero = null;

  // b197.4 - com fatias, MAX_PAGINAS conta o TOTAL de chamadas, nao as
  // paginas de uma fatia so. Sem um teto proprio, uma fatia densa consumiria
  // tudo e as anteriores nunca seriam vistas.
  const PAGINAS_POR_FATIA = opcoes.paginasPorFatia || 3;
  let paginasNaFatia = 0;

  // b197.5 (Codex): PAGINA e CHAMADA sao contadores diferentes.
  //
  // Eu usava o `pagina` do for pros dois: ao trocar de fatia ele continuava
  // subindo, entao a fatia nova comecava na pagina 4, 7, 10... e as
  // primeiras notas dela — as mais recentes, onde a nota costuma estar —
  // nunca eram lidas.
  //
  // Agora `pagina` reinicia em 1 a cada fatia, e `chamadas` guarda o teto
  // global.
  let pagina = 1;
  for (let chamadas = 0; chamadas < MAX_PAGINAS; chamadas++) {
    if (chamadas > 0) await sleep(DELAY_MS);
    // b197 - FILTRAR POR DATA na propria consulta.
    //
    // Antes eu paginava do MAIS RECENTE pra tras ate esbarrar na data. O
    // diagnostico mostrou o custo: 400 notas cobriram 9 DIAS (30/08 ate
    // 21/08), e a venda era de ABRIL. Nunca chegaria la, e ainda batia no
    // limite de requisicoes no caminho.
    // b197.1 (Codex): a JANELA e ANTES do evento, nao depois.
    //
    // Dois erros no meu filtro anterior:
    //
    // 1. A data que o chamador passa e a da DEVOLUCAO, nao a da venda. Uma
    //    devolucao de abril pode ser de uma venda de FEVEREIRO — e minha
    //    janela comecava 5 dias antes da devolucao, ou seja, DEPOIS da nota.
    //
    // 2. O Bling devolve do MAIS RECENTE primeiro. Terminando a janela 60
    //    dias DEPOIS do evento, a nota que eu quero fica no FIM da lista —
    //    e o chamador so pede 12 paginas.
    //
    // Agora a janela vai de `diasAntes` (padrao 180) ANTES do evento ate o
    // proprio evento: a venda sempre precede a devolucao, e a nota mais
    // recente da janela e a mais provavel.
    // b197.4 (Codex): a JANELA tem que caber nas paginas que eu leio.
    //
    // Medido com a densidade real da GOOD (o diagnostico do dono deu 400
    // notas em 9 dias = ~44/dia): 6 paginas sao 600 notas, ou ~14 DIAS. Com
    // a janela de 210 dias, a busca cobria so os 14 mais recentes dela — uma
    // venda de 4 meses atras ficava de fora, mesmo com a janela "certa".
    //
    // Entao varro em FATIAS, indo pra tras. Cada fatia e pequena o bastante
    // pras paginas alcancarem o inicio dela.
    const DIAS_ANTES = opcoes.diasAntes || 180;
    const DIAS_FATIA = opcoes.diasFatia || 20;
    const refT = dataReferencia ? new Date(dataReferencia).getTime() : NaN;
    const usaFatias = Number.isFinite(refT);

    // a fatia comeca 30 dias DEPOIS da referencia (a NF pode sair atrasada)
    // e recua de DIAS_FATIA em DIAS_FATIA
    // b198 - a NF pode sair MUITO depois. Caso real: a devolucao consta de
    // 19/04 e a nota foi emitida em 14/05 — quase um mes. Os 30 dias
    // cobriam por pouco; 60 dao folga sem custar nada, porque a busca vai
    // do mais recente pra tras de qualquer forma.
    const fimJanela = usaFatias ? refT + 60 * 864e5 : Date.now();
    const iniJanela = usaFatias ? refT - DIAS_ANTES * 864e5 : null;
    let fatiaAtual = 0;
    const fatiaFim = () => fimJanela - fatiaAtual * DIAS_FATIA * 864e5;
    const fatiaIni = () => fatiaFim() - DIAS_FATIA * 864e5;
    const acabaramFatias = () => iniJanela != null && fatiaFim() < iniJanela;

    // recalculado a CADA volta: `fatiaAtual` muda quando a fatia acaba
    const filtroData = usaFatias
      ? '&dataEmissaoInicial=' + new Date(fatiaIni()).toISOString().slice(0, 10)
        + '&dataEmissaoFinal=' + new Date(fatiaFim()).toISOString().slice(0, 10)
      : '';
    const url = `https://api.bling.com.br/Api/v3/nfe?limite=${LIMITE_PAGINA}&pagina=${pagina}&tipo=1${filtroData}`;
    const r = await chamarBling(url);

    if (!r.ok) {
      // b197 - LIMITE DE REQUISICOES nao e falha, e "espera um pouco". O
      // diagnostico voltou TOO_MANY_REQUESTS no meio e eu desistia ali,
      // devolvendo "nao achei" — indistinguivel de a nota nao existir.
      const ehLimite = r.status === 429
        || /TOO_MANY_REQUESTS/i.test(JSON.stringify(r.error || ''));
      if (!ehLimite) {
        return { ok: false, status: r.status, error: r.error, totalScanned, primeiraDataVista, ultimaDataVista };
      }
      // b197.2 (Codex): UMA tentativa extra por pagina, e so. Se o Bling
      // continuar limitando, insistir empilha chamadas e piora o proprio
      // limite — melhor devolver dizendo que foi limite.
      await sleep(1500);
      const r2 = await chamarBling(url);
      if (!r2.ok) {
        return { ok: false, status: r2.status, error: r2.error, limite_atingido: true,
          totalScanned, primeiraDataVista, ultimaDataVista };
      }
      r.ok = true; r.data = r2.data;
    }

    const lista = r.data?.data || [];
    // b197.5 (Codex): fatia VAZIA nao encerra a busca — avanca pra proxima.
    // Um periodo sem notas (feriado, mes fraco) nao diz nada sobre as
    // fatias anteriores, que e justamente onde a venda antiga esta.
    if (lista.length === 0) {
      if (!usaFatias) break;
      fatiaAtual++;
      paginasNaFatia = 0;
      pagina = 1;
      if (acabaramFatias()) break;
      continue;
    }

    if (chamadas === 0 && lista[0]) {
      primeiraDataVista = lista[0].dataEmissao;
      primeiraNumero = lista[0].numero;
    }
    if (lista[lista.length - 1]) {
      ultimaDataVista = lista[lista.length - 1].dataEmissao;
      ultimaNumero = lista[lista.length - 1].numero;
    }

    totalScanned += lista.length;

    // Match por numeroPedidoLoja (order_id ML)
    // v3.73 - um pedido pode ter DUAS notas (a cancelada e a substituta) e
    // a ordem dentro da pagina nao e garantida. Regra nova, em dupla camada:
    // (1) cancelada/denegada NUNCA e escolhida; (2) entre as vivas, vence a
    // MAIS RECENTE por dataEmissao. Aconteceu 2x na semana de pegar a morta.
    const matches = lista.filter(nf =>
      String(nf.numeroPedidoLoja || '').trim() === orderIdStr
    );
    if (matches.length) {
      const vivas = matches.filter(nf => !nfeDescartavel(nf));
      if (vivas.length) {
        vivas.sort((x, y) => String(y.dataEmissao || '').localeCompare(String(x.dataEmissao || '')));
        const match = vivas[0];
        const descartadas = matches.length - vivas.length;
        console.log(`[Bling] NF ENCONTRADA pag ${pagina}: numero=${match.numero} id=${match.id}`
          + (descartadas ? ` (descartei ${descartadas} cancelada/denegada do mesmo pedido)` : ''));
        return { ok: true, match, pagina, totalScanned, descartadas_mortas: descartadas, primeiraDataVista, ultimaDataVista, primeiraNumero, ultimaNumero };
      }
      // so achou nota morta: registra e SEGUE as paginas - a substituta
      // pode estar mais adiante (ou nao existir ainda)
      console.log(`[Bling] pag ${pagina}: ${matches.length} NF(s) do pedido ${orderIdStr} mas TODAS canceladas/denegadas - sigo procurando`);
    }

    // Parada por data
    // b197.3 (Codex): o corte de 5 dias era do tempo em que a varredura
    // comecava de HOJE — existia pra nao ler o historico inteiro.
    //
    // Com a janela por data (180 dias pra tras), ele ATRAPALHA: a consulta
    // abre no periodo certo e este break interrompia depois de 5 dias,
    // antes de chegar na nota. A janela ja limita o alcance.
    if (!filtroData && dataLimite && lista[lista.length - 1]?.dataEmissao) {
      const dataNF = new Date(lista[lista.length - 1].dataEmissao);
      if (dataNF < dataLimite) {
        console.log(`[Bling] Passou data limite, encerrando`);
        break;
      }
    }

    // b197.4 - acabou a fatia: avanca pra ANTERIOR em vez de encerrar.
    //
    // Sem isto, a busca parava na primeira fatia e nao alcancaria uma venda
    // de meses atras — que e o caso que motivou tudo isto.
    paginasNaFatia++;
    // acabou a fatia (poucos resultados) OU gastei o teto dela: vai pra
    // anterior. Isso inclui a fatia VAZIA — um periodo sem notas nao pode
    // encerrar a busca, so passar pra proxima.
    // b197.8 (Codex): o teto POR FATIA so vale QUANDO ha fatias.
    //
    // Sem `dataReferencia` nao ha fatia nenhuma — a varredura e linear, do
    // presente pro passado. Mas `paginasNaFatia` continuava contando e
    // encerrava na 2a pagina, ignorando as 12 que o chamador pediu.
    if (lista.length < LIMITE_PAGINA
        || (usaFatias && paginasNaFatia >= PAGINAS_POR_FATIA)) {
      if (!usaFatias) break;
      fatiaAtual++;
      paginasNaFatia = 0;
      pagina = 1;              // b197.5 - a fatia nova comeca do inicio
      if (acabaramFatias()) break;
      continue;
    }
    pagina++;
  }

  return {
    ok: true,
    match: null,
    totalScanned,
    primeiraDataVista,
    ultimaDataVista,
    primeiraNumero,
    ultimaNumero,
  };
}

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

  // 3) Ultima tentativa: pega o primeiro
  if (!match) match = lista[0];

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

/**
 * v3.19 - BUSCA BLINDADA DE NF (janela de datas)
 * ------------------------------------------------------------
 * Em vez de varrer /nfe ou /pedidos do presente pro passado (que
 * estoura o limite de paginas quando a venda e antiga), consulta
 * DIRETO a janela de datas da venda (dataEmissaoInicial/Final).
 * Ordem de tentativas:
 *  1. /nfe na janela, match por numeroPedidoLoja=orderId (a prova
 *     de serie 1 vs 2) e, em falta, por numero(+serie) da NF.
 *  2. /pedidos/vendas na janela, match numeroLoja -> notaFiscal.id.
 *  3. Fundo: varredura antiga por orderId (limitada) - ultimo recurso.
 * Retorna { ok, via, nf (objeto completo), idNF } ou { ok:false, tentado[] }.
 */
async function buscarNFBlindada(opts = {}) {
  // Aceita orderId (string) e/ou orderIds (array) - em vendas de CARRINHO
  // o Bling pode registrar o numeroLoja como o PACK, nao a order.
  const brutos = [];
  if (Array.isArray(opts.orderIds)) {
    for (const v of opts.orderIds) {
      if (v != null && String(v).trim() !== '') brutos.push(String(v).trim());
    }
  }
  if (opts.orderId != null && String(opts.orderId).trim() !== '') {
    brutos.push(String(opts.orderId).trim());
  }
  const orderIds = [...new Set(brutos)];
  const numeroNF = opts.numeroNF != null ? String(opts.numeroNF).trim() : null;
  const serieNF = opts.serieNF != null && String(opts.serieNF).trim() !== '' ? String(opts.serieNF).trim() : null;
  const LIMITE = 100;
  const DELAY_MS = 400;
  const MAXP_JANELA = opts.maxPaginasJanela || 6;
  const tentado = [];
  const trace = []; // raio-x de cada passo (pro debug se explicar sozinho)

  // Janela: 2 dias antes da venda ate N dias depois (NF sai perto da venda)
  let ini = null, fim = null;
  if (opts.dataReferencia) {
    const ref = new Date(opts.dataReferencia);
    if (!isNaN(ref.getTime())) {
      const DIAS_ANTES = 2;
      const DIAS_DEPOIS = opts.janelaDias || 12;
      const f = (d) => d.toISOString().slice(0, 10);
      ini = f(new Date(ref.getTime() - DIAS_ANTES * 864e5));
      fim = f(new Date(ref.getTime() + DIAS_DEPOIS * 864e5));
    }
  }

  const bateOrder = (nf) => orderIds.length > 0 && orderIds.includes(String(nf.numeroPedidoLoja || '').trim());
  const bateNumero = (nf) => {
    if (!numeroNF) return false;
    const a = String(nf.numero || '').trim().replace(/^0+/, '');
    const b = numeroNF.replace(/^0+/, '');
    if (!a || a !== b) return false;
    if (serieNF && nf.serie != null && String(nf.serie).trim() !== serieNF) return false;
    return true;
  };

  async function completar(idNF, via) {
    await sleep(DELAY_MS);
    const rFull = await buscarNFePorId(idNF);
    const nf = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
    return { ok: true, via, nf, idNF: String(idNF), trace };
  }

  // ---- FASE 0: filtro DIRETO numeroLoja no /nfe (1 chamada por id!) ----
  // Descoberta na doc oficial: /nfe aceita ?numeroLoja= - dispensa varredura.
  for (let i = 0; i < orderIds.length; i++) {
    if (i > 0) await sleep(DELAY_MS);
    const oid = orderIds[i];
    const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=1&tipo=1&numeroLoja=${encodeURIComponent(oid)}`;
    const r = await chamarBling(url);
    const lista = (r.ok && r.data?.data) ? r.data.data : [];
    trace.push({ passo: 'nfe-numeroLoja', id: oid, status: r.status || null, qtd: lista.length });
    if (!r.ok) { tentado.push(`nfe-numeroLoja(${oid}): HTTP ${r.status}`); continue; }
    if (lista.length > 0) {
      const m = lista.find(bateOrder) || lista[0];
      console.log(`[Bling/blindada] ACHOU via numeroLoja=${oid}: NF ${m.numero} (id ${m.id})`);
      return completar(m.id, 'nfe-numeroLoja');
    }
    tentado.push(`nfe-numeroLoja(${oid}): 0 NFs`);
  }

  // ---- FASE 1: /nfe com janela de datas ----
  if (ini && fim) {
    console.log(`[Bling/blindada] /nfe janela ${ini}..${fim} ids=${orderIds.join(',') || '-'} numero=${numeroNF || '-'}${serieNF ? '/s' + serieNF : ''}`);
    for (let pg = 1; pg <= MAXP_JANELA; pg++) {
      if (pg > 1) await sleep(DELAY_MS);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=${LIMITE}&pagina=${pg}&tipo=1&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) { trace.push({ passo: 'nfe-janela', pg, status: r.status || null }); tentado.push(`nfe-janela pg${pg}: HTTP ${r.status}`); break; }
      const lista = r.data?.data || [];
      trace.push({ passo: 'nfe-janela', pg, status: 200, qtd: lista.length, primeira: lista[0]?.dataEmissao || null, ultima: lista[lista.length - 1]?.dataEmissao || null });
      if (lista.length === 0) { tentado.push(`nfe-janela: sem NFs na janela (pg${pg})`); break; }
      let m = lista.find(bateOrder);
      if (m) return completar(m.id, 'nfe-janela-orderId');
      m = lista.find(bateNumero);
      if (m) return completar(m.id, 'nfe-janela-numero');
      if (lista.length < LIMITE) { tentado.push(`nfe-janela: ${(pg - 1) * LIMITE + lista.length} NFs sem match`); break; }
      if (pg === MAXP_JANELA) tentado.push(`nfe-janela: ${pg * LIMITE}+ NFs sem match (limite de paginas)`);
    }
  } else {
    tentado.push('nfe-janela: sem data de referencia da venda');
  }

  // ---- FASE 2: /pedidos/vendas com janela -> NF vinculada ----
  if (orderIds.length > 0 && ini && fim) {
    for (let pg = 1; pg <= MAXP_JANELA; pg++) {
      await sleep(DELAY_MS);
      const url = `https://api.bling.com.br/Api/v3/pedidos/vendas?limite=${LIMITE}&pagina=${pg}&dataInicial=${ini}&dataFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) { trace.push({ passo: 'pedidos-janela', pg, status: r.status || null }); tentado.push(`pedidos-janela pg${pg}: HTTP ${r.status}`); break; }
      const lista = r.data?.data || [];
      trace.push({ passo: 'pedidos-janela', pg, status: 200, qtd: lista.length, primeira: lista[0]?.data || null, ultima: lista[lista.length - 1]?.data || null });
      if (lista.length === 0) { tentado.push(`pedidos-janela: vazio (pg${pg})`); break; }
      const m = lista.find(p => orderIds.includes(String(p.numeroLoja || '').trim()));
      if (m) {
        await sleep(DELAY_MS);
        const rPed = await buscarPedidoBlingPorId(m.id);
        const idNF = rPed.ok ? rPed.data?.data?.notaFiscal?.id : null;
        if (idNF) return completar(idNF, 'pedido-janela');
        tentado.push(`pedidos-janela: pedido ${m.id} achado mas SEM NF vinculada`);
        break;
      }
      if (lista.length < LIMITE) { tentado.push('pedidos-janela: pedido nao achado na janela'); break; }
    }
  }

  // ---- FASE 3: fundo (varredura limitada, ultimo recurso) ----
  for (const oid of orderIds) {
    const r = await buscarNFnoBlingPorOrderId(oid, opts.dataReferencia || null, { maxPaginas: opts.maxPaginasFundo || 15 });
    trace.push({ passo: 'nfe-fundo', id: oid, qtd: r.totalScanned || 0, primeira: r.primeiraDataVista || null, ultima: r.ultimaDataVista || null });
    if (r.ok && r.match) return completar(r.match.id, 'nfe-fundo-orderId');
    tentado.push(`nfe-fundo(${oid}): ${r.totalScanned || 0} NFs varridas sem match`);
  }

  console.log('[Bling/blindada] NAO ACHOU:', tentado.join(' | '));
  return { ok: false, tentado, trace };
}

PREVENTIVA_BLING = registrarPreventiva({
  empresa: 'good', integracao: 'bling',
  temRefresh: () => !!BLING_REFRESH_TOKEN,
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
  buscarNFnoBlingPorOrderId,
  buscarNFBlindada,

  // Produtos
  buscarProdutoBlingPorSku,

  // Status
  hasToken: () => !!BLING_ACCESS_TOKEN,

  // Reconexao (reautorizar apos mudar escopos)
  trocarCodePorTokenBling,
};
