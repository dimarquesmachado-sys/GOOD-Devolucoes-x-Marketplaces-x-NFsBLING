// ════════════════════════════════════════════════════════════════════
//  amb-devolucoes · lib/admin-helpers  (AMB Devol. b71)
//  Os dois ajudantes que o modulo de rotas do painel pede e que a AMB
//  nao tinha. Sao os MESMOS da GOOD (lib/ml.js e lib/bling.js),
//  recebendo por injecao o chamarBling/chamarML/sleep da AMB — que
//  ja tem a mesma assinatura e o mesmo retorno {ok, data, status}.
// ════════════════════════════════════════════════════════════════════
'use strict';

module.exports = function criar({ chamarBling, chamarML, buscarNFePorId, sleep }) {

/** A NF que o ML guarda pro envio (invoice_data). */
async function buscarNFnoML(shipmentId) {
  return chamarML(`https://api.mercadolibre.com/shipments/${shipmentId}/invoice_data?siteId=MLB`);
}

async function buscarNFBlindada(opts = {}) {
  // b203.4 (Codex): SINAL DE PARADA.
  //
  // Quem chama corre contra um prazo (`Promise.race`), mas o timeout so
  // devolve null — eu continuava varrendo paginas do Bling em segundo
  // plano, gastando o limite de 3 req/s que o proximo item vai precisar.
  //
  // `opts.parar()` e conferido entre as fases e entre as paginas: quando o
  // chamador desiste, eu desisto junto.
  const parar = typeof opts.parar === 'function' ? opts.parar : () => false;
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
  // b172 - NF cancelada (2) ou denegada (9) nao serve: chave/DANFE de nota
  // morta. Um pedido pode ter a cancelada E a substituta - entre as vivas,
  // vence a MAIS RECENTE (a ordem que o Bling devolve nao e garantida).
  const NFE_DESCARTAVEL = new Set([2, 9]);
  const nfeViva = (nf) => !NFE_DESCARTAVEL.has(Number(nf && nf.situacao));
  const maisRecenteViva = (candidatas) => {
    const vivas = (candidatas || []).filter(nfeViva);
    if (!vivas.length) return null;
    vivas.sort((x, y) => String(y.dataEmissao || '').localeCompare(String(x.dataEmissao || '')));
    return vivas[0];
  };
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
    if (parar()) { tentado.push('abortado: o chamador desistiu'); break; }
    if (i > 0) await sleep(DELAY_MS);
    const oid = orderIds[i];
    const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=1&tipo=1&numeroLoja=${encodeURIComponent(oid)}`;
    const r = await chamarBling(url);
    const lista = (r.ok && r.data?.data) ? r.data.data : [];
    trace.push({ passo: 'nfe-numeroLoja', id: oid, status: r.status || null, qtd: lista.length });
    if (!r.ok) { tentado.push(`nfe-numeroLoja(${oid}): HTTP ${r.status}`); continue; }
    if (lista.length > 0) {
      // b172 - antes: find(bateOrder) || lista[0], sem olhar situacao. Agora
      // escolhe a mais recente VIVA (entre as que batem; senao entre todas,
      // ja que o filtro numeroLoja= ja e do pedido). So morta? Segue as fases.
      const m = maisRecenteViva(lista.filter(bateOrder)) || maisRecenteViva(lista);
      if (m) {
        console.log(`[Bling/blindada] ACHOU via numeroLoja=${oid}: NF ${m.numero} (id ${m.id})`);
        return completar(m.id, 'nfe-numeroLoja');
      }
      trace.push({ passo: 'nfe-numeroLoja', id: oid, so_mortas: lista.length });
      tentado.push(`nfe-numeroLoja(${oid}): ${lista.length} NF(s) mas todas canceladas/denegadas`);
    }
    tentado.push(`nfe-numeroLoja(${oid}): 0 NFs`);
  }

  // ---- FASE 1: /nfe com janela de datas ----
  if (ini && fim) {
    console.log(`[Bling/blindada] /nfe janela ${ini}..${fim} ids=${orderIds.join(',') || '-'} numero=${numeroNF || '-'}${serieNF ? '/s' + serieNF : ''}`);
    for (let pg = 1; pg <= MAXP_JANELA; pg++) {
      if (parar()) { tentado.push('abortado: o chamador desistiu'); break; }
      if (pg > 1) await sleep(DELAY_MS);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=${LIMITE}&pagina=${pg}&tipo=1&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) { trace.push({ passo: 'nfe-janela', pg, status: r.status || null }); tentado.push(`nfe-janela pg${pg}: HTTP ${r.status}`); break; }
      const lista = r.data?.data || [];
      trace.push({ passo: 'nfe-janela', pg, status: 200, qtd: lista.length, primeira: lista[0]?.dataEmissao || null, ultima: lista[lista.length - 1]?.dataEmissao || null });
      if (lista.length === 0) { tentado.push(`nfe-janela: sem NFs na janela (pg${pg})`); break; }
      let m = maisRecenteViva(lista.filter(bateOrder));   // b172
      if (m) return completar(m.id, 'nfe-janela-orderId');
      m = maisRecenteViva(lista.filter(bateNumero));       // b172
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
      if (parar()) { tentado.push('abortado: o chamador desistiu'); break; }
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
        // b203.3 (Codex): `buscarPedidoBlingPorId` NAO EXISTE neste modulo —
        // nem definida nem injetada. E o SEGUNDO bug latente desta familia
        // (o primeiro, no b172, era o buscarNFnoBlingPorOrderId).
        //
        // Se as fases 0 e 1 falhassem e esta achasse o pedido, estourava
        // ReferenceError e derrubava a busca inteira. Chamo o Bling direto,
        // que e o que a funcao faria.
        // b203.7 (Codex): reconferir DEPOIS do sleep acima. O prazo pode ter
        // estourado durante ele — sem isto eu faria mais duas chamadas ao
        // Bling (o pedido, e o detalhe da NF dentro de `completar`) depois
        // de a resposta ja ter sido enviada, gastando o limite do proximo.
        if (parar()) { tentado.push('abortado: o chamador desistiu'); break; }
        const rPed = await chamarBling(`https://api.bling.com.br/Api/v3/pedidos/vendas/${m.id}`);
        const idNF = rPed.ok ? rPed.data?.data?.notaFiscal?.id : null;
        if (idNF) return completar(idNF, 'pedido-janela');
        tentado.push(`pedidos-janela: pedido ${m.id} achado mas SEM NF vinculada`);
        break;
      }
      if (lista.length < LIMITE) { tentado.push('pedidos-janela: pedido nao achado na janela'); break; }
    }
  }

  // ---- FASE 3: fundo (varredura limitada, ultimo recurso) ----
  // b172 - BUG LATENTE MORTO: esta fase chamava buscarNFnoBlingPorOrderId,
  // que NUNCA existiu neste modulo (nao e injetada nem definida) - se as
  // fases 0-2 falhassem, estourava ReferenceError. Agora a varredura de
  // fundo e local, com o mesmo criterio vivo+mais-recente das outras fases.
  async function varreduraFundo(oid, maxPaginas) {
    let totalScanned = 0, primeiraDataVista = null, ultimaDataVista = null;
    for (let pg = 1; pg <= maxPaginas; pg++) {
      if (parar()) { tentado.push('abortado: o chamador desistiu'); break; }
      if (pg > 1) await sleep(DELAY_MS);
      const r = await chamarBling(`https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=1`);
      if (!r.ok) return { ok: false, totalScanned, primeiraDataVista, ultimaDataVista };
      const lista = r.data?.data || [];
      if (!lista.length) break;
      if (pg === 1 && lista[0]) primeiraDataVista = lista[0].dataEmissao;
      ultimaDataVista = lista[lista.length - 1]?.dataEmissao || ultimaDataVista;
      totalScanned += lista.length;
      const m = maisRecenteViva(lista.filter(nf => String(nf.numeroPedidoLoja || '').trim() === oid));
      if (m) return { ok: true, match: m, totalScanned, primeiraDataVista, ultimaDataVista };
      if (lista.length < 100) break;
    }
    // b210.3 (Codex): esta e a varreduraFundo. Meu retorno acumulado entrou
    // aqui por engano e daria ReferenceError, derrubando a identificacao
    // inteira da AMB quando as fases 0-2 falham. Ela nao tem acumulador —
    // e o teste de escopo agora vigia isso, inclusive nos comentarios.
    return { ok: true, match: null, totalScanned, primeiraDataVista, ultimaDataVista };
  }
  for (const oid of orderIds) {
    const r = await varreduraFundo(oid, opts.maxPaginasFundo || 15);
    trace.push({ passo: 'nfe-fundo', id: oid, qtd: r.totalScanned || 0, primeira: r.primeiraDataVista || null, ultima: r.ultimaDataVista || null });
    if (r.ok && r.match) return completar(r.match.id, 'nfe-fundo-orderId');
    tentado.push(`nfe-fundo(${oid}): ${r.totalScanned || 0} NFs varridas sem match`);
  }

  console.log('[Bling/blindada] NAO ACHOU:', tentado.join(' | '));
  return { ok: false, tentado, trace };
}


// ── b71: os 2 que a rota identificar da GOOD tambem pede ──

function classificarMotivoDevolucao(order, shipment) {
  if (!order) return null;
  const tags = order.tags || [];
  const cd = order.cancel_detail || {};
  const st = String(shipment?.status || '');
  const sub = String(shipment?.substatus || '');
  const temReclamacao = Array.isArray(order.mediations) && order.mediations.length > 0;
  const fraude = tags.includes('fraud_risk_detected');

  const naoEntregue = cd.code === 'shipment_not_delivered'
    || cd.group === 'shipment'
    || st === 'not_delivered'
    || sub === 'returned'
    || (tags.includes('not_delivered') && !tags.includes('delivered'));

  if (naoEntregue) {
    // v4.16 - se o ML marcou irregularidade E o produto nao foi entregue, foi
    // ELE que bloqueou o envio no meio do caminho. O produto nem chegou perto
    // do cliente - nao faz sentido pedir "cuidado ao conferir".
    return {
      tipo: 'nao_entregue',
      titulo: '🚫 O cliente NUNCA recebeu este produto',
      detalhe: fraude
        ? 'O Mercado Livre bloqueou este envio no meio do caminho por irregularidade na operação. O produto nem chegou ao cliente — deve estar LACRADO e intacto.'
        : 'Voltou sem ser entregue (recusa, endereço não encontrado ou ausente). O produto deve estar LACRADO e intacto — confira e devolva ao estoque.',
      cor: '#1565c0',
      reclamacao_id: null,
      risco_fraude: false,          // nada a alertar: o produto nao circulou
      bloqueado_pelo_ml: fraude,
    };
  }
  if (temReclamacao || cd.group === 'mediations') {
    return {
      tipo: 'reclamacao',
      titulo: '⚠️ O cliente ABRIU RECLAMAÇÃO',
      detalhe: 'Foi entregue e o cliente reclamou. Abra e confira bem o produto antes de decidir.',
      cor: '#e65100',
      reclamacao_id: temReclamacao ? String(order.mediations[0].id) : null,
      risco_fraude: fraude,
    };
  }
  return {
    tipo: 'devolucao_simples',
    titulo: '📦 Devolução sem reclamação registrada',
    detalhe: 'Confira o produto normalmente.',
    cor: '#616161',
    reclamacao_id: null,
    risco_fraude: fraude,
  };
}

async function buscarNFnoBlingPorNumero(numeroNF, dataReferencia, opcoes = {}) {
  const numeroNFStr = String(numeroNF).trim().padStart(6, '0'); // 71932 -> 071932
  const numeroNFLimpo = String(numeroNF).trim().replace(/^0+/, ''); // remove zeros a esquerda

  // b203.1 (Codex) - FILTRO DIRETO POR NUMERO, antes de paginar.
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
      // b203.1: `nfeDescartavel` e da GOOD; aqui a regra vive dentro de
      // outra funcao (NFE_DESCARTAVEL = [2, 9]) e nao alcanca este escopo.
      // Confiro a situacao direto — quase caí no mesmo bug de funcao
      // fantasma que este repo ja teve tres vezes.
      const vivas = batem.filter((nf) => ![2, 9].includes(Number(nf && nf.situacao)))
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

  const acumuladas = [];   // b210.2: candidatas de TODAS as paginas
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    if (pagina > 1) await sleep(DELAY_MS);
    const url = `https://api.bling.com.br/Api/v3/nfe?limite=${LIMITE_PAGINA}&pagina=${pagina}&tipo=1`;
    const r = await chamarBling(url);

    if (!r.ok) {
      return { ok: false,
          // b210.4 (Codex): erro no MEIO da varredura nao pode apagar o que
          // ja achei. Entrego as candidatas juntadas ate aqui, e o `ok:false`
          // avisa que a busca ficou incompleta.
          candidatas: acumuladas.slice(), status: r.status, error: r.error, totalScanned, primeiraDataVista, ultimaDataVista };
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
    // b210.1 (Codex): a varredura devolve TODAS as vivas.
    //
    // Ela guardava so a mais recente, entao a escada de desempate recebia
    // uma lista de um item e nunca podia oferecer escolha ao dono — as
    // outras notas com o mesmo numero sumiam antes de chegar la.
    const vivasVarredura = candidatas
      .filter(nf => ![2, 9].includes(Number(nf && nf.situacao)))
      .sort((a, b) => String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));
    // b210.2 (Codex): ACUMULAR entre as paginas, nao parar na primeira.
    //
    // Notas com o mesmo numero podem estar em paginas diferentes, e retornar
    // na primeira que casa expunha uma candidata so — o chamador entao
    // vinculava por eliminacao sem saber que havia outra. Junto o que
    // aparecer e decido no fim.
    acumuladas.push(...vivasVarredura);

    const match = vivasVarredura[0];

    if (match && pagina >= MAX_PAGINAS) {
      console.log(`[Bling] NF ENCONTRADA pag ${pagina}: numero=${match.numero} id=${match.id}`);
      // b210.3 (Codex): entrego o ACUMULADO, nao so a pagina atual.
      //
      // No limite de paginas eu devolvia `vivasVarredura` — as candidatas
      // desta pagina — e jogava fora as que achei nas anteriores. O
      // chamador entao via uma so e vinculava por eliminacao, que e
      // exatamente o que este PR veio impedir.
      const todasAteAqui = acumuladas.sort((a, b) =>
        String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));
      return { ok: true, match: todasAteAqui[0] || match, candidatas: todasAteAqui,
        pagina, totalScanned, primeiraDataVista, ultimaDataVista };
    }

    if (dataLimite && lista[lista.length - 1]?.dataEmissao) {
      const dataNF = new Date(lista[lista.length - 1].dataEmissao);
      if (dataNF < dataLimite) break;
    }

    if (lista.length < LIMITE_PAGINA) break;
  }

  // b210.2: no fim, entrego tudo que juntei — a escada decide, e se houver
  // mais de uma o dono escolhe.
  const todas = acumuladas.sort((a, b) =>
    String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));
  return { ok: true, match: todas[0] || null, candidatas: todas,
    totalScanned, primeiraDataVista, ultimaDataVista };
}

return { buscarNFnoML, buscarNFBlindada, classificarMotivoDevolucao, buscarNFnoBlingPorNumero };
};
