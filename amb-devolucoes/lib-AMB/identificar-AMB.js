// ════════════════════════════════════════════════════════════════════════
//  amb-devolucoes · lib/identificar  (AMB Devol. b153)
//  A rota /api/devolucao/identificar da GOOD, PORTADA SEM EDICAO.
//
//  Por que ela existe aqui: a tela de bipe (os modulos js-AMB) le do
//  retorno os campos data.order, data.nf, data.metodo, data.eh_devolucao.
//  A rota /api/triagem/identificar da AMB devolve outro formato — por isso
//  o card vinha com tudo "-". Em vez de remendar a tela, trouxe a rota que
//  ela espera.
//
//  Sao 937 linhas COPIADAS da GOOD, sem uma alteracao: tudo que ela usa
//  chega por injecao, e um Router do express tem .get igual ao app.
// ════════════════════════════════════════════════════════════════════════
'use strict';

module.exports = function registrarIdentificar(app, deps) {
  const {
    requerLogin, sleep,
    chamarML, chamarBling, chamarMagalu,
    buscarNFnoML, buscarNFePorId, buscarNFBlindada, buscarNFnoBlingPorNumero,
    // b217 (review do Codex — A CAUSA RAIZ do 404 da NF 2447): esta rota
    // CHAMA buscarNFsPorNumero, mas nunca a recebeu nas deps. O identificador
    // era `undefined`, a chamada lancava ReferenceError, o catch engolia e a
    // tela dizia "NF nao localizada". O raio-x achava porque usa a funcao
    // direto do modulo — por isso os dois caminhos discordavam.
    buscarNFsPorNumero,
    mapItensNF, resolverIdNFPorChave,
    buscarClaimsPorShipment, buscarClaimDetalhada, buscarReturnPorClaim,
    buscarOrderViaShipmentReturn, buscarOrdersPorComprador,
    classificarMotivoDevolucao,
    acharDevolucao, buscarPorNome,
    shopee, magalu, nfNomes, // b71 - a rota usa os modulos inteiros
    mlReturns,               // b142 - indice claims->returns do ML (faltava)
    supabase,                // ev2 - pro registro do checkout offline
    db,                      // b213 - pra buscar o RECADO desta devolucao
  } = deps;

  // ═══════════════════════════════════════════════════════════════════
  // b213 (bug que o Diego viu: criou recado e "o estoquista nunca soube")
  // Esta e a rota que a TELA DO GALPAO usa (/api/devolucao/identificar).
  // Ela nunca devolveu `recados` — e o front le exatamente `data.recados`.
  // Ou seja, o aviso NUNCA aparecia aqui, com qualquer identificador.
  // Agora, antes de responder, procuramos o recado por TODOS os numeros
  // que essa mesma devolucao atende (o recado pode ter sido preso a
  // qualquer um deles: venda, pack, rastreio, NF, chave).
  // ═══════════════════════════════════════════════════════════════════
  async function comRecados(resultado, codigoBipado) {
    try {
      if (!db || typeof db.recadoDeQualquer !== 'function') return resultado;
      const o = resultado || {};
      const ids = [
        codigoBipado,
        o.order && (o.order.id || o.order.order_id),
        o.pack && (o.pack.id || o.pack.pack_id),
        // b215 (review do Codex) - os DOIS: com `||`, recado preso ao rastreio
        // sumia quando o galpao bipava o pedido/pack
        o.shipment && o.shipment.id,
        o.shipment && o.shipment.tracking_number,
        o.claim && o.claim.id,
        o.return && o.return.id,
        // b214 (review do Codex) - numero E chave: com `||` o recado preso a
        // chave de 44 digitos nunca casava quando o galpao bipava outra coisa
        o.nf && o.nf.numero,
        o.nf && o.nf.chaveAcesso,
        o.nf && o.nf.chave,
        o.devolucao && o.devolucao.order_id,
        o.devolucao && o.devolucao.tracking,
        o.devolucao_shopee && o.devolucao_shopee.pedido,
        o.devolucao_shopee && o.devolucao_shopee.tracking,
      ];
      const r = await db.recadoDeQualquer(ids);
      // b214 - a lista INTEIRA: o front trava a triagem enquanto houver
      // recado sem ciencia, entao esconder os demais destravaria cedo.
      resultado.recados = (r && r.ok)
        ? (Array.isArray(r.recados) ? r.recados : (r.recado ? [r.recado] : []))
        : [];
    } catch (e) {
      resultado.recados = [];   // recado e ajuda, nunca trava o bipe
    }
    return resultado;
  }

  // ev2 - eventos do CHECKOUT OFFLINE que casam com o codigo bipado
  async function buscarEventosCheckout(codigo) {
    try {
      if (!supabase) return [];
      const q = String(codigo || '').trim();
      if (!/^[A-Za-z0-9_-]{5,60}$/.test(q)) return [];
      const { data } = await supabase.from('eventos_checkout')
        .select('tipo, codigo, quem, criado_em, extra')
        .eq('empresa', 'amb')
        .or('codigo.eq.' + q + ',codigo.ilike.%' + q + '%')
        .order('criado_em', { ascending: false })
        .limit(3);
      return data || [];
    } catch (e) { return []; }
  }                  //       (shopee.cfg.ativo, shopee.acharDevolucao...)

app.get('/api/devolucao/identificar/:codigo', requerLogin, async (req, res) => {
  const codigoOriginal = String(req.params.codigo || '').trim();
  // ══════════════════════════════════════════════════════════════════
  // b89 - RELOGIO DA BUSCA
  // A rota faz ate 18 chamadas de rede EM SEQUENCIA. Sem medir, apertar
  // uma etapa e chute. Envelopo o res.json (em vez de mexer em cada
  // saida) pra TODA resposta trazer _ms (tempo total) e _marcos (quanto
  // custou cada fase). Assim da pra ver onde o tempo vai de verdade.
  // ══════════════════════════════════════════════════════════════════
  const _t0 = Date.now();
  const _marcos = [];
  const marcar = (fase) => { _marcos.push({ fase, ms: Date.now() - _t0 }); };
  const _jsonOriginal = res.json.bind(res);
  res.json = function (obj) {
    if (obj && typeof obj === 'object') {
      delete obj._shopeeJaTentado;
      obj._ms = Date.now() - _t0;
      obj._marcos = _marcos;
    }
    return _jsonOriginal(obj);
  };

  // ev2 - segundo envelope (async): antes de QUALQUER resposta sair,
  // consulta o registro do checkout offline e anexa se casar. Falha ou
  // demora nunca segura a resposta alem do try (catch devolve sem extra).
  const _jsonComRelogio = res.json.bind(res);
  res.json = function (obj) {
    if (!obj || typeof obj !== 'object') return _jsonComRelogio(obj);
    buscarEventosCheckout(codigoOriginal)
      .then((evs) => { if (evs.length) obj.eventos_checkout = evs; _jsonComRelogio(obj); })
      .catch(() => _jsonComRelogio(obj));
    return res;
  };

  if (!codigoOriginal) {
    return res.status(400).json({ ok: false, erro: 'Codigo nao informado' });
  }

  console.log(`\n========== NOVA BUSCA: ${codigoOriginal} ==========`);

  // v3.62 - QR da etiqueta MAGALU: um JSON com external_grouper_code (= o
  // PROTOCOLO do ticket, que o indice Magalu ja resolve na hora), alem de
  // external_code e tag_code (o codigo de barras 196634440-01). Formato
  // decodificado de etiqueta real. Detecta e extrai o protocolo ANTES de
  // qualquer outra coisa - o bipe do QR vira busca instantanea.
  let origemQrMagalu = false;
  let codigoLimpo = codigoOriginal.replace(/[^0-9]/g, '');
  if (/external_grouper_code|tag_code|logistical_flow/i.test(codigoOriginal)) {
    let proto = null;
    try {
      const j = JSON.parse(codigoOriginal);
      proto = String(j.external_grouper_code || '').replace(/\D/g, '');
    } catch (e) {
      // leitor USB pode mutilar o JSON (layout de teclado): o protocolo e o
      // unico numerao de 16 digitos comecando com o ano (20...)
      const m = codigoOriginal.match(/20\d{14}/);
      if (m) proto = m[0];
    }
    if (proto) {
      codigoLimpo = proto;
      origemQrMagalu = true;
      console.log(`[BUSCA] QR MAGALU detectado → protocolo ${proto}`);
    }
  }

  // v3.39 - QR das etiquetas ML vem como {"id":"47416667668","t":"lm"}
  // (leitor USB cospe o JSON cru no campo). Extrai o id e ja sabemos
  // que e ML - se o shipment nao existir, falha RAPIDO com orientacao
  // (padrao de devolucao FULL) em vez de vagar pela cascata.
  let origemQrML = false;
  let mQrML = origemQrMagalu ? null : codigoOriginal.match(/["']?[ïi]d["']?\s*[:=]\s*["']?(\d{8,20})/i);
  if (!origemQrMagalu && !mQrML && /^\{|"?t"?\s*[:=]\s*"?lm/i.test(codigoOriginal)) {
    // leitor mutilou o "id" (layout de teclado): pesca o unico numerao
    const runs = codigoOriginal.match(/\d{8,20}/g) || [];
    if (runs.length === 1) mQrML = [null, runs[0]];
  }
  if (mQrML) {
    codigoLimpo = mQrML[1];
    origemQrML = true;
    console.log(`[BUSCA] QR do ML detectado → shipment ${codigoLimpo}`);
  }

  const resultado = {
    codigo_buscado: codigoOriginal,
    codigo_limpo: codigoLimpo,
    tentativas: [],
    encontrado: false,
    avisos: [],
  };

  let shipment = null;
  let order = null;
  let pack = null;
  let claim = null;
  let returnData = null;
  let metodoUsado = null;

  // v3.47.2 - PISTA SPX (nao atalho destrutivo!): codigo BR + 12+ digitos +
  // 1 letra final e o padrao da etiqueta Shopee SPX. Correios tb comeca com
  // BR mas TERMINA em "BR" (2 letras) - e ML usa Correios. Entao aqui a
  // regra e CONSERVADORA: se parece SPX, a Shopee e tentada PRIMEIRO (mais
  // abaixo). Mas o ML NUNCA e eliminado - se a Shopee nao achar, a cascata
  // ML roda igual. Nenhum caminho e perdido (insucesso ML existe!).
  const pistaSPX = /^BR\d{11,}[A-Z]$/i.test(codigoOriginal.trim());

  // v3.47.2 - Quando o codigo tem PISTA de SPX (BR+12dig+1letra), tenta a
  // Shopee JA AQUI (antes da cascata ML), pra o bipe de insucesso Shopee
  // responder rapido sem os 404 de shipment/pack. MAS se a Shopee nao achar,
  // NAO retorna - deixa a cascata ML rodar normal logo abaixo (insucesso ML
  // usa etiqueta Correios, que tb comeca com BR). Nenhum caminho e perdido.
  if (pistaSPX && shopee.cfg.ativo) {
    try {
      marcar('shopee-spx:inicio');
      const infoSPX = await shopee.acharDevolucao(codigoOriginal);
      marcar('shopee-spx:fim');
      if (infoSPX && infoSPX.hit) {
        resultado.tentativas.push({ tipo: 'shopee_return', v: 'spx-first', codigo: codigoOriginal, ok: true, status: 200, lista_qtd: infoSPX.qtd });
        const dev = infoSPX.hit;
        // reaproveita o MESMO tratamento shopee da cascata (montagem + NF)
        returnData = dev;
        metodoUsado = 'shopee_return';
        resultado._shopeeDev = dev; // sinaliza pro bloco shopee abaixo pular a re-busca
      } else {
        resultado._shopeeJaTentado = true;
        resultado.tentativas.push({ tipo: 'shopee_return', v: 'spx-first', codigo: codigoOriginal, ok: false, status: 404, lista_qtd: infoSPX ? infoSPX.qtd : null, nota: 'nao achou na Shopee - seguindo cascata ML (pode ser insucesso ML/Correios)' });
      }
    } catch (e) {
      resultado.tentativas.push({ tipo: 'shopee_return', v: 'spx-first', codigo: codigoOriginal, ok: false, status: 500, erro: e.message || String(e) });
    }
  }

  // MAGALU-FIRST (v3.63): QR da etiqueta ou protocolo digitado (16 digitos
  // comecando com o ano) vao DIRETO pro Magalu - sem gastar tempo na
  // cascata ML (16 digitos caia como "pack ML" e esperava 404s a toa).
  const pistaMagalu = origemQrMagalu || /^20\d{14}$/.test(codigoLimpo);
  if (pistaMagalu) {
    if (await tentarDevolucaoMagalu()) return;
  }

  // CORREIOS REVERSO (v3.65): AD/AP...BR = devolucao por agencia. O codigo
  // e o rastreio da VOLTA (nao e shipment ML). O indice claims->returns
  // resolve tracking -> order -> preenche o shipment de IDA e o fluxo ML
  // existente faz o resto (buyer, NF, triagem, duplicata por shipment).
  const mCorreios = String(codigoOriginal || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{2}\d{9}BR)$/);
  if (!shipment && !pack && mCorreios) {
    const trk = mCorreios[1];
    let devML = null;
    // b142 - o catch mudo aqui escondeu por semanas um ReferenceError:
    // qualquer falha virava "nao encontrado". Agora o motivo vai junto.
    let erroTrk = null;
    try {
      devML = mlReturns && typeof mlReturns.acharPorTracking === 'function'
        ? await mlReturns.acharPorTracking(trk)
        : null;
      if (!mlReturns) erroTrk = 'modulo ml-returns nao injetado nesta rota';
    } catch (e) { devML = null; erroTrk = String(e.message || e); }
    // b139 - quando nao acha, mostra o ESTADO DO INDICE junto: quantos
    // rastreios ele tem, de quando e, e se a montagem deu erro. Sem isso o
    // 404 nao diz se o indice estava vazio ou se o rastreio nao esta nele.
    const diagTrk = (!devML && mlReturns && typeof mlReturns.ultimaBuscaTracking === 'function')
      ? mlReturns.ultimaBuscaTracking() : null;
    resultado.tentativas.push({
      tipo: 'correios_reverso_ml', codigo: trk,
      ok: !!(devML && devML.order_id), status: devML ? 200 : 404,
      erro_interno: erroTrk || undefined,
      indice: diagTrk ? {
        rastreios: diagTrk.no_indice,
        montado_em: diagTrk.indice_em,
        erro: diagTrk.erro_indice,
      } : undefined,
    });

    if (devML && devML.order_id) {
      console.log(`[BUSCA] CORREIOS ${trk} -> claim ${devML.claim_id} -> order ${devML.order_id}`);
      const rO = await chamarML(`https://api.mercadolibre.com/orders/${devML.order_id}`);
      const shipIdIda = rO.ok ? rO.data?.shipping?.id : null;
      // v3.70 - o order do claim JA veio completo (comprador, itens): entrega
      // ao fluxo em vez de deixar o downstream refazer a busca (e falhar).
      if (rO.ok && rO.data?.id) order = rO.data;
      if (shipIdIda) {
        const rS = await chamarML(`https://api.mercadolibre.com/shipments/${shipIdIda}`, { 'x-format-new': 'true' });
        if (rS.ok && rS.data?.id) { shipment = rS.data; metodoUsado = 'correios_reverso_ml'; }
      }
      resultado.ml_return = {
        tracking: trk, claim_id: devML.claim_id,
        shipment_devolucao: devML.shipment_devolucao, status_devolucao: devML.status_devolucao,
      };
      resultado.eh_devolucao = true;
      resultado.avisos.push({ tipo: 'correios_ml', mensagem: `Devolucao ML via CORREIOS (${trk}) - claim ${devML.claim_id}${devML.status_devolucao ? ' (' + devML.status_devolucao + ')' : ''}` });
      if (!shipment) {
        resultado.erro = `Rastreio ${trk} achou a devolucao ML (claim ${devML.claim_id}, pedido ${devML.order_id}) mas falhou ao carregar o pedido. Tente digitar o pedido, ou identifique pela NF.`;
        return res.status(404).json(await comRecados(resultado, req.params.codigo));
      }
    } else {
      // Sem match: orientacao clara (nao vaga pela cascata - 9 digitos
      // limpos cairiam na bissecao de NF e perderiam tempo a toa).
      resultado.erro = `Rastreio CORREIOS ${trk} nao encontrado nas devolucoes ML recentes${devML && devML.claim_id ? ` (claim ${devML.claim_id} sem pedido vinculado)` : ''}. Pode ser devolucao de OUTRO marketplace orientada pelos Correios (Shopee, TikTok...) - confira o REMETENTE na etiqueta, ou bipe a chave da DANFE se a nota vier na caixa.`;
      return res.status(404).json(await comRecados(resultado, req.params.codigo));
    }
  }

  // ML T1: shipment_id
  if (!returnData && codigoLimpo.length >= 10 && codigoLimpo.length <= 13) {
    const r = await chamarML(
      `https://api.mercadolibre.com/shipments/${codigoLimpo}`,
      { 'x-format-new': 'true' }
    );
    resultado.tentativas.push({
      tipo: 'shipment_id', codigo: codigoLimpo,
      ok: r.ok, status: r.status, erro: r.ok ? null : r.error,
    });
    if (r.ok && r.data?.id) {
      shipment = r.data;
      metodoUsado = 'shipment_id';
    }
  }

  // ML T2: pack_id
  if (!returnData && !shipment) {
    const possiveis = [];
    if (codigoLimpo.length >= 15) possiveis.push(codigoLimpo);
    if (codigoLimpo.length === 11) possiveis.push('20000' + codigoLimpo);

    for (const packId of possiveis) {
      const r = await chamarML(`https://api.mercadolibre.com/packs/${packId}`);
      resultado.tentativas.push({
        tipo: 'pack_id', codigo: packId,
        ok: r.ok, status: r.status, erro: r.ok ? null : r.error,
      });
      if (r.ok && r.data?.id) {
        pack = r.data;
        metodoUsado = 'pack_id';
        if (pack.shipment?.id) {
          const rShip = await chamarML(
            `https://api.mercadolibre.com/shipments/${pack.shipment.id}`,
            { 'x-format-new': 'true' }
          );
          if (rShip.ok) shipment = rShip.data;
        }
        break;
      }
    }
  }

  // ML T2b (v4.14): ORDER ID. Faltava esta porta - o numero da venda que
  // aparece no painel do ML (2000...) e o que o Diego tem na mao quando
  // esta olhando o pedido. Antes so tentavamos pack_id, que devolve 400
  // porque o formato e parecido mas o recurso e outro.
  if (!returnData && !shipment && !pack && codigoLimpo.length >= 15 && /^\d+$/.test(codigoLimpo)) {
    const rOrd = await chamarML(`https://api.mercadolibre.com/orders/${codigoLimpo}`);
    resultado.tentativas.push({
      tipo: 'order_id', codigo: codigoLimpo,
      ok: rOrd.ok, status: rOrd.status, erro: rOrd.ok ? null : rOrd.error,
    });
    if (rOrd.ok && rOrd.data?.id) {
      order = rOrd.data;
      metodoUsado = 'order_id';
      // do pedido chegamos no envio (e dali segue o fluxo normal)
      const shipDoPedido = rOrd.data.shipping?.id;
      if (shipDoPedido) {
        const rShip = await chamarML(
          `https://api.mercadolibre.com/shipments/${shipDoPedido}`,
          { 'x-format-new': 'true' }
        );
        if (rShip.ok) shipment = rShip.data;
      }
      // e no pack, quando a venda faz parte de um
      if (!pack && rOrd.data.pack_id) {
        const rPk = await chamarML(`https://api.mercadolibre.com/packs/${rOrd.data.pack_id}`);
        if (rPk.ok && rPk.data?.id) pack = rPk.data;
      }
    }
  }

  // ===== QR-ML sem shipment (v3.39): falha RAPIDA com orientacao =====
  // Etiqueta era do ML (QR) mas a API nao achou o envio por esse id.
  // Nao adianta vagar por chave/Shopee: responde em segundos com os
  // caminhos certos (a etiqueta fisica tem barras E Pack ID impressos).
  if (!shipment && !pack && origemQrML) {
    const stShip = (resultado.tentativas.find(t => t.tipo === 'shipment_id') || {}).status;
    if (stShip === 403) {
      resultado.erro = `QR do ML lido (shipment ${codigoLimpo}) mas a API RECUSOU o acesso (403). Duas causas possíveis: token do ML expirado (teste com um shipment antigo — se também der 403, avise o Diego) OU devolução recém-criada que o ML ainda não liberou (tente de novo em algumas horas). Enquanto isso: digite o Pack ID impresso na etiqueta (2000...).`;
    } else {
      resultado.erro = `QR do ML lido (shipment ${codigoLimpo}) mas a API não achou esse envio. Na MESMA etiqueta: (1) bipe o CÓDIGO DE BARRAS grande, ou (2) digite o Pack ID impresso (2000...). Se for devolução FULL (endereçada ao CD do ML), use a chave da DANFE ou ➕ Lançar por NF.`;
    }
    resultado.qr_ml_sem_shipment = true;
    return res.status(404).json(await comRecados(resultado, req.params.codigo));
  }

  // ===== CHAVE NF-e (v3.34): bipou a chave de 44 digitos da DANFE =====
  // Cobre devolucao com a embalagem original (qualquer marketplace) e o
  // caso Shopee "recusa/insucesso" que volta com a etiqueta de IDA.
  // v3.50 - NF por CHAVE (44 digitos) OU por NUMERO (4-9 digitos, ex: 75053).
  // O numero da NF cai num vao livre da cascata: ML shipment usa 10-13,
  // pack usa 15+, chave usa 44. Aceita tambem "75053/2" ou "75053-2" pra
  // escolher a serie (default: serie 1, o padrao da casa).
  const ehChaveNFe = codigoLimpo.length === 44;
  const mNumSerie = String(codigoOriginal || '').trim().match(/^(\d{4,9})\s*[\/\-]\s*(\d{1,3})$/);
  const ehNumeroNF = !ehChaveNFe && (mNumSerie || /^\d{4,9}$/.test(codigoLimpo));

  if (!shipment && !pack && (ehChaveNFe || ehNumeroNF)) {
    let numeroDaChave, serieDaChave, idNF = null, tipoTentativa;

    if (ehChaveNFe) {
      const modelo = codigoLimpo.substr(20, 2);
      if (modelo !== '55') {
        // DACE/DC-e do transporte (modelo 99) e afins: nao e a NF do produto
        resultado.erro = `Isso e uma chave de documento de TRANSPORTE (modelo ${modelo}), nao a NF do produto. Bipe a chave da DANFE do produto ou o codigo de rastreio.`;
        resultado.tentativas.push({ tipo: 'chave_danfe', codigo: codigoLimpo, ok: false, status: 422 });
        return res.status(404).json(await comRecados(resultado, req.params.codigo));
      }
      numeroDaChave = String(parseInt(codigoLimpo.substr(25, 9), 10));
      serieDaChave = String(parseInt(codigoLimpo.substr(22, 3), 10));
      tipoTentativa = 'chave_danfe';
      console.log(`[BUSCA] CHAVE DANFE: serie=${serieDaChave} numero=${numeroDaChave}`);
      // b219 - "nao consegui cravar" != "essa NF nao existe": se o Bling
      // recusou parte da consulta, a tela precisa dizer isso em vez de
      // afirmar que a nota nao esta la.
      let recusaChave = false;
      try { idNF = await resolverIdNFPorChave(numeroDaChave, codigoLimpo); }
      catch (e) { idNF = null; recusaChave = !!(e && (e.blingRecusou || e.ambiguoSemChave)); if (recusaChave) resultado.erro_consulta = e.message; }
      if (!idNF && recusaChave) {
        resultado.tentativas.push({ tipo: 'chave_danfe', codigo: String(codigoOriginal || '').trim(), ok: false, status: 503, erro: resultado.erro_consulta });
        resultado.erro = resultado.erro_consulta;
        return res.status(503).json(await comRecados(resultado, req.params.codigo));
      }
    } else {
      // Numero da NF digitado. MULTI-SERIE: a casa emite em varias series
      // (1=normal, 2=ML FULL, outras p/ Magalu/Amazon FULL) e o MESMO numero
      // pode existir em mais de uma. Nunca escolhemos sozinhos: se der
      // ambiguidade, devolvemos as opcoes pro estoquista decidir.
      numeroDaChave = mNumSerie ? mNumSerie[1] : codigoLimpo;
      serieDaChave = mNumSerie ? String(parseInt(mNumSerie[2], 10)) : null;
      tipoTentativa = 'numero_nf';
      console.log(`[BUSCA] NUMERO NF: numero=${numeroDaChave} serie=${serieDaChave || '(todas)'}`);
      let achadas = [];
      // b216 - o Bling RECUSAR a consulta nao e o mesmo que a NF nao existir.
      // Antes tudo caia no mesmo `achadas = []` e a tela afirmava "NF nao
      // localizada (procurei em todas as series, ultimos 18 meses)" — foi o
      // que o Diego viu com a NF 2447, que existe.
      let blingRecusou = false;
      try { achadas = await buscarNFsPorNumero(numeroDaChave, serieDaChave); }
      catch (e) { achadas = []; blingRecusou = !!(e && e.blingRecusou); }
      if (blingRecusou) {
        resultado.tentativas.push({ tipo: 'numero_nf', codigo: String(codigoOriginal || '').trim(), ok: false, status: 503, erro: 'Bling recusou a consulta' });
        resultado.erro = `Nao consegui consultar a NF ${numeroDaChave} agora: o Bling recusou a consulta (limite ou instabilidade). Tente de novo em instantes — NAO quer dizer que a nota nao existe.`;
        return res.status(503).json(await comRecados(resultado, req.params.codigo));
      }

      if (achadas.length > 1) {
        // AMBIGUIDADE: mesma numeracao em series diferentes. Carrega o basico
        // de cada uma (data, valor, produto) pro estoquista bater com a caixa.
        const opcoes = [];
        for (const a of achadas) {
          const rr = await buscarNFePorId(a.id);
          const n = (rr.ok && rr.data?.data) ? rr.data.data : null;
          if (!n) continue;
          const it0 = Array.isArray(n.itens) && n.itens.length ? n.itens[0] : null;
          opcoes.push({
            idBling: String(n.id),
            numero: n.numero,
            serie: n.serie,
            chave: n.chaveAcesso || null,
            dataEmissao: n.dataEmissao,
            valor: n.valorNota,
            cliente: (n.contato && n.contato.nome) ? n.contato.nome : null,
            produto: it0 ? (it0.descricao || null) : null,
            sku: it0 ? (it0.codigo || null) : null,
            numeroPedidoLoja: n.numeroPedidoLoja || null,
          });
        }
        resultado.tentativas.push({ tipo: 'numero_nf', codigo: String(codigoOriginal || '').trim(), ok: false, status: 300, erro: 'ambiguo (varias series)' });
        resultado.ambiguidade_nf = { numero: numeroDaChave, opcoes };
        resultado.erro = `Existem ${opcoes.length} NFs com o numero ${numeroDaChave}, em series diferentes. Escolha a que bate com o pacote (ou bipe a chave da DANFE).`;
        console.log(`[BUSCA] NUMERO NF ${numeroDaChave}: AMBIGUO em ${opcoes.length} series`);
        return res.status(409).json(await comRecados(resultado, req.params.codigo));
      }
      idNF = achadas.length === 1 ? achadas[0].id : null;
      if (achadas.length === 1) serieDaChave = achadas[0].serie;
    }

    resultado.tentativas.push({
      tipo: tipoTentativa,
      codigo: ehChaveNFe ? codigoLimpo : String(codigoOriginal || '').trim(),
      ok: !!idNF, status: idNF ? 200 : 404,
    });
    if (!idNF) {
      resultado.erro = ehChaveNFe
        ? `Chave lida, mas a NF ${numeroDaChave} (serie ${serieDaChave}) nao foi localizada no Bling.`
        : `NF ${numeroDaChave} nao localizada no Bling (procurei em todas as series, ultimos 18 meses). Confira o numero, ou bipe a chave da DANFE.`;
      return res.status(404).json(await comRecados(resultado, req.params.codigo));
    }
    const rFullNF = await buscarNFePorId(idNF);
    const nfCh = (rFullNF.ok && rFullNF.data?.data) ? rFullNF.data.data : null;
    if (!nfCh) {
      resultado.erro = `NF ${numeroDaChave} achada (id ${idNF}) mas falhou ao carregar do Bling.`;
      return res.status(404).json(await comRecados(resultado, req.params.codigo));
    }
    const itensCh = Array.isArray(nfCh.itens) ? nfCh.itens.map(it => ({
      titulo: it.descricao || null,
      sku: it.codigo || null,
      ean: it.gtin || null,
      quantidade: it.quantidade || null,
      valor: it.valor || null,
      unidade: it.unidade || null,
    })) : [];
    resultado.nf = {
      fonte: 'bling',
      numero: nfCh.numero,
      serie: nfCh.serie,
      chaveAcesso: nfCh.chaveAcesso || (ehChaveNFe ? codigoLimpo : null),
      valor: nfCh.valorNota,
      dataEmissao: nfCh.dataEmissao,
      linkDanfe: nfCh.linkDanfe,
      linkPdf: nfCh.linkPDF,
      linkXml: nfCh.xml,
      idBling: nfCh.id,
      numeroPedidoLoja: nfCh.numeroPedidoLoja,
      situacao: nfCh.situacao,
      itens: itensCh,
    };
    const nomeClienteCh = (nfCh.contato && nfCh.contato.nome) ? nfCh.contato.nome : null;
    const primeiroCh = itensCh.length ? itensCh[0] : null;
    resultado.order = {
      id: nfCh.numeroPedidoLoja || null,
      pack_id: null,
      buyer: { id: null, first_name: nomeClienteCh, last_name: '', nickname: null },
      order_items: primeiroCh
        ? [{ unit_price: Number(primeiroCh.valor) || null, quantity: null, item: { id: null, title: null, seller_sku: null } }]
        : [],
    };
    resultado.shipment = { id: null };
    resultado.encontrado = true;
    resultado.metodo = ehChaveNFe ? 'chave_danfe' : 'numero_nf';
    resultado.eh_devolucao = true;
    resultado.avisos.push({
      tipo: ehChaveNFe ? 'nf_via_chave' : 'nf_via_numero',
      mensagem: ehChaveNFe
        ? `NF ${nfCh.numero} localizada pela chave da DANFE (bissecao)`
        : `NF ${nfCh.numero} (serie ${nfCh.serie}) localizada pelo numero digitado`,
    });
    console.log(`[BUSCA] OK (${ehChaveNFe ? 'CHAVE' : 'NUMERO'}) | NF=${nfCh.numero} pedido=${nfCh.numeroPedidoLoja || '-'}`);
    return res.json(await comRecados(resultado, req.params.codigo));
  }

  // ===== MAGALU: protocolo da etiqueta, reverse_code ou pedido =====
  // A etiqueta Magalu imprime "Protocolo: 2026062600477033" - e ele bate
  // exatamente com o ticket.protocol da API (confirmado com dado real).
  // Do ticket sai o PEDIDO, e do pedido sai a NF no Bling (numeroLoja).
  // v3.63 - extraido em funcao pra rodar em DOIS pontos: magalu-first
  // (antes do ML, quando o codigo tem cara de protocolo/QR Magalu) e
  // fallback tardio (depois do ML, pra reverse_code/pedido).
  async function tentarDevolucaoMagalu() {
    if (!magalu.cfg.ativo || !magalu.cfg.autorizado) return false;
    let devMag = null;
    try { devMag = await magalu.acharDevolucao(codigoLimpo); } catch (e) { devMag = null; }
    resultado.tentativas.push({
      tipo: 'magalu_devolucao', codigo: codigoLimpo,
      ok: !!devMag, status: devMag ? 200 : 404,
    });

    if (devMag) {
      console.log(`[BUSCA] MAGALU: protocolo=${devMag.protocolo} pedido=${devMag.pedido} status=${devMag.status}`);
      // v3.63.1 - A NF vinha VAZIA (e o CONFIRMAR barrava sem nf_chave):
      // a janela usava a data do TICKET, que abre semanas DEPOIS da venda -
      // a NF, emitida NA venda, ficava fora da janela (pra tras).
      // Cura definitiva: a propria API Magalu entrega a CHAVE da NF no
      // pedido (invoices[].key - confirmado em JSON real). Pegamos a chave
      // la e resolvemos no Bling pela chave (caminho ja provado). Fallbacks:
      // janela pela data da COMPRA (purchased_at) e, no pior caso, a chave
      // da Magalu sozinha ja destrava a triagem (nf_chave no payload).
      let nfMag = null;
      let chaveMagalu = null;
      let compradoEm = null;
      if (devMag.pedido) {
        try {
          const rPed = await magalu.chamarMagalu(`/seller/v1/orders/${encodeURIComponent(devMag.pedido)}`);
          if (rPed.ok && rPed.data) {
            // v3.64 - CONFIRMADO em JSON real: no /orders/{code} os invoices
            // vem DENTRO de deliveries[] (nao na raiz). Varre raiz + entregas.
            const colecoesInv = [rPed.data.invoices, ...((rPed.data.deliveries || []).map(d => d && d.invoices))];
            for (const arr of colecoesInv) {
              const k = (arr || []).map(i => i && i.key).find(kk => /^\d{44}$/.test(String(kk || '')));
              if (k) { chaveMagalu = String(k); break; }
            }
            compradoEm = rPed.data.purchased_at || null;
          }
        } catch (e) { /* segue pros fallbacks */ }
        if (chaveMagalu) {
          try {
            const numeroDaChaveMag = String(parseInt(chaveMagalu.substr(25, 9), 10));
            const idNFMag = await resolverIdNFPorChave(numeroDaChaveMag, chaveMagalu);
            if (idNFMag) {
              const rFullMag = await buscarNFePorId(idNFMag);
              nfMag = (rFullMag.ok && rFullMag.data?.data) ? rFullMag.data.data : null;
            }
          } catch (e) { nfMag = null; }
        }
        if (!nfMag) {
          try {
            const rB = await buscarNFBlindada({ orderId: devMag.pedido, dataReferencia: compradoEm || null, janelaDias: 45 });
            if (rB.ok && rB.nf) nfMag = rB.nf;
          } catch (e) { /* segue sem NF do Bling */ }
        }
      }

      const itensMag = (devMag.itens || []).map(it => ({
        titulo: it.titulo, sku: it.sku, ean: null,
        quantidade: it.quantidade, valor: null, unidade: null,
      }));

      if (nfMag) {
        resultado.nf = {
          fonte: 'bling',
          numero: nfMag.numero,
          serie: nfMag.serie,
          chaveAcesso: nfMag.chaveAcesso || chaveMagalu || null,
          valor: nfMag.valorNota,
          dataEmissao: nfMag.dataEmissao,
          linkDanfe: nfMag.linkDanfe,
          linkPdf: nfMag.linkPDF,
          linkXml: nfMag.xml,
          idBling: nfMag.id,
          numeroPedidoLoja: nfMag.numeroPedidoLoja,
          situacao: nfMag.situacao,
          itens: mapItensNF(nfMag),
        };
      } else if (chaveMagalu) {
        // Bling nao achou, mas a Magalu deu a chave: NF minima ja permite
        // triar (nf_chave vai no payload) e o card mostra numero/serie.
        resultado.nf = {
          fonte: 'magalu',
          numero: String(parseInt(chaveMagalu.substr(25, 9), 10)),
          serie: String(parseInt(chaveMagalu.substr(22, 3), 10)),
          chaveAcesso: chaveMagalu,
          valor: null, dataEmissao: compradoEm || null,
          linkDanfe: null, linkPdf: null, linkXml: null,
          idBling: null, numeroPedidoLoja: devMag.pedido || null,
          situacao: null, itens: [],
        };
      }

      const prim = itensMag.length ? itensMag[0] : null;
      resultado.order = {
        id: devMag.pedido || null,
        pack_id: null,
        buyer: {
          id: null,
          first_name: (nfMag && nfMag.contato && nfMag.contato.nome) ? nfMag.contato.nome : null,
          last_name: '', nickname: null,
        },
        order_items: prim
          ? [{ unit_price: null, quantity: prim.quantidade, item: { id: null, title: prim.titulo, seller_sku: prim.sku } }]
          : [],
      };
      resultado.shipment = { id: null };
      resultado.itens_devolucao = itensMag;
      resultado.encontrado = true;
      resultado.metodo = 'magalu_devolucao';
      resultado.eh_devolucao = true;
      // ═══════════════════════════════════════════════════════════════
      // b153 - CRASH NO PRIMEIRO BIPE MAGALU QUE ACHAVA (06/08). Esta
      // linha veio da GOOD referenciando `espreita` e `devolucao`, que
      // NAO existem neste escopo (aqui o modulo e `magalu` e a variavel
      // e `devMag`). Com o ramo desligado (b71) nunca rodava; a b152
      // religou e o ReferenceError estourava FORA de try/catch ->
      // unhandledRejection -> o Node mata o processo (Exited 1) e a
      // tela mostra "JSON.parse: unexpected character". A sonda
      // /magalu/achar passava porque nao passa por esta linha.
      // ═══════════════════════════════════════════════════════════════
      let esp = null;
      try { esp = magalu.porPedido(devMag.pedido); } catch (e) { esp = null; }
      if (esp) {
        resultado.avisos.push({ tipo: 'espreita', mensagem: `📮 Devolucao REGISTRADA no portal Magalu Entregas (${esp.categoria}${esp.status ? ' - ' + esp.status : ''}${esp.entregue_em ? ' - entregue ' + String(esp.entregue_em).slice(0, 10) : ''})` });
      }
      resultado.magalu = {
        protocolo: devMag.protocolo,
        reverse_code: devMag.reverse_code,
        tipo: devMag.tipo,
        motivo: devMag.motivo,
        status: devMag.status,
        fechado: devMag.fechado,
      };
      resultado.avisos.push({
        tipo: 'magalu',
        mensagem: `Devolucao MAGALU - protocolo ${devMag.protocolo}${devMag.status ? ' (' + devMag.status + ')' : ''}${nfMag ? ' - NF ' + nfMag.numero : ' - NF nao localizada no Bling'}`,
      });
      console.log(`[BUSCA] OK (MAGALU) | protocolo=${devMag.protocolo} pedido=${devMag.pedido} NF=${nfMag ? nfMag.numero : '-'}`);
      res.json(await comRecados(resultado, req.params.codigo));
      return true;
    }
    return false;
  }

  // MAGALU fallback tardio: reverse_code (10 dig) ou pedido (16 dig sem cara
  // de protocolo) - so tenta se nada acima resolveu e nao tentou ainda.
  if (!shipment && !pack && !pistaMagalu) {
    if (await tentarDevolucaoMagalu()) return;
  }

  // ===== SHOPEE (v3.33): tenta casar como etiqueta de devolucao Shopee =====
  if (!shipment && !pack) {
    let devShopee = resultado._shopeeDev || null; // v3.47.2: reusa o spx-first
    delete resultado._shopeeDev; // campo interno - nao vaza no JSON
    let infoShopee = null;
    // b89 - o spx-first ja consultou a Shopee com ESTE codigo e nao achou:
    // repetir a consulta so dobra o tempo (o proxy varre a lista de
    // devolucoes em janelas de 15 dias) pra dar o mesmo resultado.
    if (!devShopee && shopee.cfg.ativo && !resultado._shopeeJaTentado) {
      try {
        marcar('shopee-2a-vez:inicio');
        infoShopee = await shopee.acharDevolucao(codigoOriginal);
        marcar('shopee-2a-vez:fim');
        devShopee = infoShopee.hit;
        resultado.tentativas.push({
          tipo: 'shopee_return', v: '3.34.3', codigo: codigoOriginal,
          ok: !!devShopee, status: devShopee ? 200 : 404,
          lista_qtd: infoShopee.qtd, exemplo_tracking: infoShopee.exemplo,
        });
      } catch (e) {
        resultado.tentativas.push({ tipo: 'shopee_return', v: '3.34.3', codigo: codigoOriginal, ok: false, status: 500, erro: e.message || String(e) });
        console.error('[BUSCA][shopee] proxy falhou:', e.message || e);
      }
    } else if (!shopee.cfg.ativo) {
      // v3.34.3: mesmo desligada, a tentativa aparece e se explica.
      // b74 - so entra aqui quando a integracao esta DESLIGADA. Antes
      // este else tambem pegava o caso "ja achei pelo SPX", e a tela
      // mostrava um ❌ shopee_return fantasma ao lado do ✅ que deu certo.
      resultado.tentativas.push({ tipo: 'shopee_return', v: '3.34.3', codigo: codigoOriginal, ok: false, status: 0, erro: 'SHOPEE_PROXY_URL/SHOPEE_PROXY_KEY ausentes no Render deste servico' });
    }
    if (!devShopee) {
      // v3.71 - ULTIMO RECURSO: o texto tem cara de NOME? (>=5 letras apos
      // colapsar). Casos: remetente da etiqueta Correios digitado/colado
      // ("RENATONEVES", "Renato Neves"). Devolve CANDIDATOS - o estoquista
      // confere com a caixa e escolhe (nada de casamento automatico).
      const alvoNome = nfNomes.colapsar(codigoOriginal);
      if (alvoNome.length >= 5 && !/^\d+$/.test(String(codigoOriginal).trim())) {
        try {
          const rN = await nfNomes.buscarPorNome(codigoOriginal);
          resultado.tentativas.push({ tipo: 'nf_por_nome', codigo: alvoNome, ok: rN.candidatos.length > 0, status: rN.candidatos.length ? 200 : 404, qtd: rN.candidatos.length });
          if (rN.candidatos.length > 0) {
            resultado.candidatos_nome = rN.candidatos;
            resultado.erro = `Achei ${rN.candidatos.length} NF(s) recente(s) com esse nome. Confere com a CAIXA e escolhe abaixo:`;
            return res.status(300).json(await comRecados(resultado, req.params.codigo)); // 300 Multiple Choices
          }
        } catch (e) { resultado.tentativas.push({ tipo: 'nf_por_nome', codigo: alvoNome, ok: false, status: 500, erro: e.message }); }
      }
      const pareceSPX = /^BR[A-Z0-9]{8,}$/i.test(String(codigoOriginal).trim());
      const houve403 = resultado.tentativas.some(t => t.status === 403);
      const diag = infoShopee
        ? ` [diag: lista com ${infoShopee.qtd} devolucoes; exemplo de tracking: ${infoShopee.exemplo || '-'}]`
        : (shopee.cfg.ativo ? '' : ' [diag: integracao Shopee SEM as variaveis no Render!]');
      const nota403 = houve403 ? ' ⚠️ O ML respondeu 403 (acesso recusado): token expirado ou devolução recém-criada ainda embargada — tente o Pack ID impresso ou aguarde algumas horas.' : '';
      resultado.erro = (pareceSPX
        ? 'Etiqueta Shopee (SPX) nao casou com as devolucoes. Se ela diz "SPX INSUCESSO": o QR/barras so contem o rastreio (a Shopee nao indexa esse codigo) — DIGITE o "Pedido" impresso na etiqueta (ex: 260623TX31XFMT) que o sistema busca o pedido cancelado. Devolucao normal: tente o "Pedido" ou a chave da DANFE.'
        : 'Codigo nao encontrado em shipments/packs do ML nem nas devolucoes Shopee.') + diag + nota403;
      return res.status(404).json(await comRecados(resultado, req.params.codigo));
    }

    console.log(`[BUSCA] SHOPEE: return_sn=${devShopee.return_sn} order_sn=${devShopee.order_sn} tracking=${devShopee.tracking_number}`);

    // NF pela blindada: order_sn da Shopee = numeroLoja da NF serie 1 (Fase 0 direto)
    let nfData = null;
    let nomeCliente = null;
    marcar('nf-blindada:inicio');
    const rBlind = await buscarNFBlindada({
      orderIds: [devShopee.order_sn],
      dataReferencia: devShopee.create_time
        ? new Date(devShopee.create_time * 1000).toISOString().slice(0, 10)
        : null,
      janelaDias: 60,
    });
    marcar('nf-blindada:fim');
    if (rBlind.ok && rBlind.nf) {
      const nf = rBlind.nf;
      const itensBling = Array.isArray(nf.itens) ? nf.itens.map(it => ({
        titulo: it.descricao || null,
        sku: it.codigo || null,
        ean: it.gtin || null,
        quantidade: it.quantidade || null,
        valor: it.valor || null,
        unidade: it.unidade || null,
      })) : [];
      nfData = {
        fonte: 'bling',
        numero: nf.numero,
        serie: nf.serie,
        chaveAcesso: nf.chaveAcesso,
        valor: nf.valorNota,
        dataEmissao: nf.dataEmissao,
        linkDanfe: nf.linkDanfe,
        linkPdf: nf.linkPDF,
        linkXml: nf.xml,
        idBling: nf.id,
        numeroPedidoLoja: nf.numeroPedidoLoja,
        situacao: nf.situacao,
        itens: itensBling,
      };
      nomeCliente = (nf.contato && nf.contato.nome) ? nf.contato.nome : null;
      resultado.avisos.push({
        tipo: 'nf_via_blindada',
        mensagem: `NF ${nf.numero} achada via busca blindada (${rBlind.via})`,
      });
      console.log(`[BUSCA][shopee] BLINDADA SUCESSO: NF=${nf.numero} via=${rBlind.via}`);
    } else {
      // ══════════════════════════════════════════════════════════════
      // b72 - CAMINHO DA AMB (a busca blindada da GOOD e cega aqui)
      // A blindada procura /nfe?numeroLoja=... . No Bling da AMBTOTAL
      // esse filtro e IGNORADO e a listagem /nfe nem traz o campo
      // numeroLoja (foi o com_pedido:0 que medimos). Entao ela nunca
      // acha, por mais que a NF exista — e TODO PEDIDO TEM NF.
      // O caminho que funciona aqui e o indice da propria AMB:
      //   1) pela venda (em /pedidos/vendas o numeroLoja SEMPRE vem)
      //   2) pelo NOME do comprador (pega ate a NF do Full, que entra
      //      como XML avulso sem numeroPedidoLoja)
      // ══════════════════════════════════════════════════════════════
      const nomeCompradorShopee = (devShopee.user && (devShopee.user.username || devShopee.user.nome))
        || devShopee.buyer_nome || devShopee.comprador || null;
      let achadaAMB = null;
      try {
        achadaAMB = nfNomes.nfDaLoja(String(devShopee.order_sn || ''))
          || (nomeCompradorShopee ? nfNomes.acharNfPorNomeIndice(nomeCompradorShopee) : null);
      } catch (e) { achadaAMB = null; }

      if (achadaAMB && achadaAMB.id) {
        const rDet = await buscarNFePorId(achadaAMB.id);
        const nf = (rDet && rDet.ok && rDet.data && (rDet.data.data || rDet.data)) || null;
        if (nf && nf.numero) {
          nfData = {
            fonte: 'bling-indice-amb',
            numero: nf.numero,
            serie: nf.serie,
            chaveAcesso: nf.chaveAcesso,
            valor: nf.valorNota,
            dataEmissao: nf.dataEmissao,
            linkDanfe: nf.linkDanfe,
            linkPdf: nf.linkPDF,
            linkXml: nf.xml,
            idBling: nf.id,
            numeroPedidoLoja: nf.numeroPedidoLoja,
            situacao: nf.situacao,
            itens: Array.isArray(nf.itens) ? nf.itens.map(it => ({
              titulo: it.descricao || null, sku: it.codigo || null, ean: it.gtin || null,
              quantidade: it.quantidade || null, valor: it.valor || null, unidade: it.unidade || null,
            })) : [],
          };
          nomeCliente = (nf.contato && nf.contato.nome) ? nf.contato.nome : nomeCliente;
          resultado.avisos.push({
            tipo: 'nf_via_indice_amb',
            mensagem: `NF ${nf.numero}${nf.serie ? ' serie ' + nf.serie : ''} achada pelo indice da AMB`,
          });
          console.log(`[BUSCA][shopee] INDICE AMB: NF=${nf.numero} pedido=${devShopee.order_sn}`);
        }
      }

      if (!nfData) {
        resultado.avisos.push({
          tipo: 'sem_nf',
          mensagem: `Pedido ${devShopee.order_sn} localizado, mas a NF ainda nao entrou no indice. `
            + `Se o indice acabou de reiniciar (todo deploy esfria), espere 1-2 min e bipe de novo.`,
        });
      }
    }

    // order/shipment "minimos" no formato que o frontend ja entende
    // (NF-first cobre titulo/SKU/EAN/qtd; aqui vai cliente + valor + ids)
    const primeiroItem = nfData && nfData.itens.length ? nfData.itens[0] : null;
    // b75 - PREENCHER O QUE A SHOPEE DA. O bloco vinha quase todo "-"
    // porque este formato foi escrito pro pedido do ML. A Shopee nao
    // manda os mesmos campos, mas manda equivalentes: data e status do
    // pedido, motivo, valor e o comprador. O que ela realmente nao tem
    // (id do comprador, status de pagamento, custo do frete) segue "-",
    // que e honesto — melhor vazio do que inventado.
    const _quando = devShopee.create_time
      ? new Date(devShopee.create_time * 1000).toISOString()
      : (nfData && nfData.dataEmissao) || null;
    resultado.order = {
      id: devShopee.order_sn,
      pack_id: null,
      date_created: _quando,
      status: devShopee.status || null,
      total_amount: nfData ? nfData.valor : null,
      buyer: {
        id: (devShopee.user && (devShopee.user.username || devShopee.user.email)) || null,
        first_name: nomeCliente, last_name: '', nickname: 'SHOPEE',
      },
      order_items: primeiroItem
        ? [{ unit_price: Number(primeiroItem.valor) || null, quantity: null, item: { id: null, title: null, seller_sku: null } }]
        : [],
    };
    resultado.shipment = {
      id: devShopee.tracking_number || devShopee.return_sn || null,
      status: devShopee.reason || devShopee.status || null,
    };
    // link pro painel da Shopee: passa pelo de-para do checkout, que
    // resolve o order_sn no id interno (senao cai na busca geral)
    resultado.link_marketplace = {
      nome: 'Shopee',
      url: 'https://mover-pedidos-aguardando-x-atendido.onrender.com/amb-checkout-offline/ir-shopee?sn='
        + encodeURIComponent(devShopee.order_sn),
    };
    resultado.encontrado = true;
    resultado.metodo = 'shopee_return';
    resultado.marketplace = 'shopee';
    resultado.eh_devolucao = true;
    resultado.shopee = devShopee;
    resultado.nf = nfData;
    console.log(`[BUSCA] OK (SHOPEE) | NF=${nfData ? nfData.numero : 'nao'}`);
    return res.json(await comRecados(resultado, req.params.codigo));
  }

  // ML: ORDER (3 caminhos)
  let orderId = shipment?.order_id || pack?.orders?.[0]?.id;
  if (orderId) {
    const r = await chamarML(`https://api.mercadolibre.com/orders/${orderId}`);
    resultado.tentativas.push({
      tipo: 'order_direto', codigo: orderId,
      ok: r.ok, status: r.status, erro: r.ok ? null : r.error,
    });
    if (r.ok) order = r.data;
  }

  const ehDevolucao = shipment?.type === 'return' || shipment?.tags?.includes('claims_return');

  // NOVO v3.13: pra shipment de devolucao SEM order_id direto
  // Tenta buscar order via /shipments/{id}/orders ou /items
  if (!order && ehDevolucao && shipment?.id) {
    const rRetOrder = await buscarOrderViaShipmentReturn(shipment.id);
    resultado.tentativas.push({
      tipo: 'shipment_orders_return',
      codigo: shipment.id,
      ok: rRetOrder.ok, status: rRetOrder.ok ? 200 : 404,
      url_que_funcionou: rRetOrder.url || null,
    });
    if (rRetOrder.ok && rRetOrder.orderId) {
      const rOrder = await chamarML(`https://api.mercadolibre.com/orders/${rRetOrder.orderId}`);
      if (rOrder.ok) {
        order = rOrder.data;
        resultado.avisos.push({
          tipo: 'order_via_shipment_return',
          mensagem: `Order ${rRetOrder.orderId} achada via shipment de devolucao`,
        });
      }
    }
  }

  if (!order && ehDevolucao && shipment?.id) {
    const rClaims = await buscarClaimsPorShipment(shipment.id);
    resultado.tentativas.push({
      tipo: 'claims_search', codigo: shipment.id,
      ok: rClaims.ok, status: rClaims.ok ? 200 : 404,
      claims_encontradas: rClaims.claims?.length || 0,
    });

    if (rClaims.ok && rClaims.claims.length > 0) {
      const claimResumo = rClaims.claims[0];
      const rDetalhada = await buscarClaimDetalhada(claimResumo.id);
      claim = rDetalhada.ok ? rDetalhada.data : claimResumo;

      const rRet = await buscarReturnPorClaim(claimResumo.id);
      if (rRet.ok) returnData = rRet.data;

      const possibleOrderId = claim.resource_id || claimResumo.resource_id;
      if (possibleOrderId) {
        const rOrder = await chamarML(`https://api.mercadolibre.com/orders/${possibleOrderId}`);
        if (rOrder.ok) order = rOrder.data;
      }
    }
  }

  if (!order && shipment) {
    const buyerId = shipment.origin?.sender_id || shipment.sender_id;
    const sellerId = shipment.destination?.receiver_id || shipment.receiver_id || ML_USER_ID;

    if (buyerId && sellerId) {
      const rSearch = await buscarOrdersPorComprador(buyerId, sellerId);
      resultado.tentativas.push({
        tipo: 'orders_por_comprador',
        codigo: `buyer=${buyerId}, seller=${sellerId}`,
        ok: rSearch.ok, status: rSearch.status, erro: rSearch.ok ? null : rSearch.error,
        encontradas: rSearch.data?.results?.length || 0,
      });

      if (rSearch.ok && rSearch.data?.results?.length > 0) {
        const orders = rSearch.data.results;
        let bestMatch = null;

        // 1) Match exato por shipment.id (se a venda tem o mesmo shipment ASSOCIADO)
        if (shipment?.id) {
          bestMatch = orders.find(o => String(o.shipping?.id) === String(shipment.id));
        }

        // 2) NOVO v3.13: Match por valor declarado E que tenha mediação/devolução em curso
        // (devoluções aparecem com mediations não vazio)
        if (!bestMatch && shipment?.declared_value) {
          bestMatch = orders.find(o =>
            Math.abs((o.total_amount || 0) - shipment.declared_value) < 0.01 &&
            (o.mediations?.length > 0 || o.tags?.includes('claims_with_resolution'))
          );
        }

        // 3) Match por valor declarado simples
        if (!bestMatch && shipment?.declared_value) {
          bestMatch = orders.find(o => Math.abs((o.total_amount || 0) - shipment.declared_value) < 0.01);
        }

        // 4) Order com mediação/cancelamento (sinal de devolução)
        if (!bestMatch) {
          bestMatch = orders.find(o => o.status === 'cancelled' || o.tags?.includes('not_paid') || o.mediations?.length > 0);
        }

        // 5) Ultima opção - primeira venda do array (mais recente)
        if (!bestMatch) bestMatch = orders[0];

        if (bestMatch?.id) {
          const rFull = await chamarML(`https://api.mercadolibre.com/orders/${bestMatch.id}`);
          if (rFull.ok) {
            order = rFull.data;
            resultado.avisos.push({
              tipo: 'order_via_fallback',
              mensagem: `Order encontrada via busca por comprador (${orders.length} candidatos, valor=${shipment?.declared_value || '?'})`,
            });
          }
        }
      }
    }
  }

  if (!pack && order?.pack_id) {
    const r = await chamarML(`https://api.mercadolibre.com/packs/${order.pack_id}`);
    if (r.ok) pack = r.data;
  }

  // ============================================================
  // NF: APENAS via ML (rapido, ~1seg)
  // Se falhar, frontend mostra botao "Buscar links Bling" sob demanda
  // ============================================================
  let nfData = null;
  let mlInvoice = null; // v3.19: guarda numero/serie do ML mesmo sem fiscal_key

  const shipmentOriginalId = order?.shipping?.id || (!ehDevolucao ? shipment?.id : null);

  if (shipmentOriginalId) {
    const rNFML = await buscarNFnoML(shipmentOriginalId);
    if (rNFML.ok && rNFML.data) mlInvoice = rNFML.data;
    resultado.tentativas.push({
      tipo: 'ml_invoice_data',
      codigo: shipmentOriginalId,
      ok: rNFML.ok,
      status: rNFML.status,
      erro: rNFML.ok ? null : rNFML.error,
      tem_fiscal_key: !!rNFML.data?.fiscal_key,
    });

    if (rNFML.ok && rNFML.data?.fiscal_key) {
      nfData = {
        fonte: 'ml',
        numero: rNFML.data.invoice_number,
        serie: rNFML.data.invoice_serie,
        chaveAcesso: rNFML.data.fiscal_key,
        valor: rNFML.data.invoice_amount,
        dataEmissao: rNFML.data.invoice_date,
        peso: rNFML.data.weight,
        linkConsulta: `https://meudanfe.com.br/consulta/${rNFML.data.fiscal_key}`,
        idMLInvoice: rNFML.data.id,
      };

      // v3.14.8: enriquecer com itens do Bling (titulo limpo + EAN) quando ML achou NF
      // Adiciona ~1s a busca mas evita clique manual em "Buscar links Bling" e da EAN no card
      if (order?.id && rNFML.data.invoice_number) {
        try {
          const rEnriq = await buscarNFnoBlingPorNumero(rNFML.data.invoice_number, order.date_created, { maxPaginas: 30 });
          if (rEnriq.ok && rEnriq.match?.id) {
            await sleep(400);
            const rCompleta = await buscarNFePorId(rEnriq.match.id);
            if (rCompleta.ok && rCompleta.data?.data) {
              const nfBling = rCompleta.data.data;
              const itensBling = Array.isArray(nfBling.itens) ? nfBling.itens.map(it => ({
                titulo: it.descricao || null,
                sku: it.codigo || null,
                ean: it.gtin || null,
                quantidade: it.quantidade || null,
                valor: it.valor || null,
                unidade: it.unidade || null,
              })) : [];
              nfData.itens = itensBling;
              nfData.idBling = nfBling.id;
              nfData.linkDanfe = nfBling.linkDanfe || nfData.linkConsulta;
              nfData.linkPdf = nfBling.linkPDF;
              nfData.linkXml = nfBling.xml;
              resultado.avisos.push({
                tipo: 'enriquecido_bling',
                mensagem: `Itens e links Bling carregados automaticamente`,
              });
            }
          }
        } catch (e) {
          console.warn('[ENRIQ] Erro ao enriquecer NF ML com itens Bling:', e.message);
        }
      }
    }
  }

  if (!nfData) {
    // v3.19 BLINDADA: busca por JANELA DE DATAS da venda (rapida e a prova
    // de serie 1/2). Substitui a varredura antiga de 50 paginas sem filtro.
    if (order?.id) {
      console.log(`[BUSCA] ML sem NF, acionando busca BLINDADA pra order=${order.id}`);
      marcar('nf-blindada:inicio');
    const rBlind = await buscarNFBlindada({
        orderIds: [order.id, order.pack_id || pack?.id || null],
        numeroNF: mlInvoice?.invoice_number || null,
        serieNF: mlInvoice?.invoice_serie || null,
        dataReferencia: order.date_created || null,
      });

      resultado.tentativas.push({
        tipo: 'bling_blindada',
        codigo: order.id,
        ok: rBlind.ok,
        via: rBlind.via || null,
        tentado: rBlind.tentado || null,
      });

      marcar('nf-blindada:fim');
    if (rBlind.ok && rBlind.nf) {
        const nf = rBlind.nf;
        const itensBling = Array.isArray(nf.itens) ? nf.itens.map(it => ({
          titulo: it.descricao || null,
          sku: it.codigo || null,
          ean: it.gtin || null,
          quantidade: it.quantidade || null,
          valor: it.valor || null,
          unidade: it.unidade || null,
        })) : [];

        nfData = {
          fonte: 'bling',
          numero: nf.numero,
          serie: nf.serie,
          chaveAcesso: nf.chaveAcesso,
          valor: nf.valorNota,
          dataEmissao: nf.dataEmissao,
          linkDanfe: nf.linkDanfe,
          linkPdf: nf.linkPDF,
          linkXml: nf.xml,
          idBling: nf.id,
          numeroPedidoLoja: nf.numeroPedidoLoja,
          situacao: nf.situacao,
          itens: itensBling,
        };

        resultado.avisos.push({
          tipo: 'nf_via_blindada',
          mensagem: `NF ${nf.numero} achada via busca blindada (${rBlind.via})`,
        });
        console.log(`[BUSCA] BLINDADA SUCESSO: NF=${nf.numero} via=${rBlind.via}`);
      } else {
        resultado.avisos.push({
          tipo: 'sem_nf',
          mensagem: `NF-e nao localizada nem pela busca blindada (${(rBlind.tentado || []).join(' | ')})`,
        });
      }
    } else {
      resultado.avisos.push({
        tipo: 'sem_nf_ml',
        mensagem: 'NF-e nao localizada via ML. Use o botao "Buscar links Bling" pra tentar via Bling.',
      });
    }
  }

  if (!order) {
    resultado.avisos.push({
      tipo: 'sem_order',
      mensagem: 'Nao foi possivel obter detalhes da venda no ML',
    });
  }

  resultado.encontrado = true;
  resultado.metodo = metodoUsado;
  resultado.eh_devolucao = ehDevolucao;
  resultado.shipment = shipment;
  resultado.order = order;
  // v4.13 - POR QUE voltou + o resumo do caso (o ML explica em portugues)
  try {
    const mot = classificarMotivoDevolucao(order, shipment);
    if (mot) {
      if (mot.reclamacao_id) {
        const ctx = await contextoDaReclamacao(mot.reclamacao_id);
        if (ctx) {
          mot.contexto = ctx;
          const rot = { arrependimento: 'Cliente se ARREPENDEU da compra', defeito: 'Cliente relatou DEFEITO no produto', item_errado: 'Cliente diz que veio o produto ERRADO', incompleto: 'Cliente diz que veio INCOMPLETO', devolvido: 'Produto devolvido' };
          if (ctx.motivo && rot[ctx.motivo]) mot.titulo = '⚠️ ' + rot[ctx.motivo];
          if (ctx.motivo === 'arrependimento') mot.detalhe = 'Não é defeito: o cliente só desistiu. O produto tende a estar em bom estado — confira e, se estiver ok, inclua no estoque.';
          else if (ctx.motivo === 'defeito') mot.detalhe = 'O cliente relatou defeito. Abra e procure o problema com atenção.';
        }
      }
      resultado.motivo_devolucao = mot;
    }
  } catch (e) { /* opcional: nunca atrapalha o bipe */ }
  resultado.pack = pack;
  resultado.claim = claim;
  resultado.return = returnData;
  resultado.nf = nfData;

  console.log(`[BUSCA] OK | Order=${!!order} | NF=${nfData ? 'sim' : 'nao'}`);
  return res.json(await comRecados(resultado, req.params.codigo));
});

// ============================================================
// NOVO v3.5: Buscar links Bling sob demanda - PAGINANDO NFs
// Estrategia rapida: usa invoice_number do ML (que vem rapido) e busca por NUMERO da NF.
// Fallback: se nao tem numero, busca por numeroPedidoLoja (mais lento).
// Funciona pra TUDO (canceladas, ativas, etc) - NFs nunca somem do Bling.
// ============================================================
};
