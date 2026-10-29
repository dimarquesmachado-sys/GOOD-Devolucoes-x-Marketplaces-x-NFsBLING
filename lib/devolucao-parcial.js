// ============================================================
// lib/devolucao-parcial.js
// ------------------------------------------------------------
// Agrupa as triagens que pertencem ao MESMO pedido, pra que o admin
// saiba se ainda falta caixa antes de emitir a NF de devolucao.
//
// ------------------------------------------------------------
// O CASO QUE PEDIU ISTO (29/08)
//
// O TikTok abre UMA solicitacao de devolucao por ITEM da nota, cada
// uma com seu proprio rastreio — ou seja, o mesmo pedido volta em
// VARIAS CAIXAS, em dias diferentes.
//
// Medido no pedido 585110624384091852 da Girassol: nota com duas
// linhas de R$ 59,90 (total R$ 114,80 com desconto), duas solicitacoes
// de R$ 57,40, dois rastreios, entregues em 31/07 e 03/08.
//
// Na bancada isso ja esta resolvido (o bipe mostra "pacote 1 de 2" e
// manda nao marcar divergencia). O que falta e do lado do ADMIN:
//
//   [stated] "faz tipo um merge, ou deixa o card tipo 1o Devolucao
//    triada / AGUARDADO 2a devolucao"
//   [stated] "As 2 sendo devolvidas e triadas, mudar a condicao do
//    card, e saberei q posso emitir a NF"
//
// Sem isso, ele emite a nota vendo so a primeira caixa — e a segunda
// chega depois, sem lugar no fluxo.
//
// ------------------------------------------------------------
// O QUE ESTE MODULO NAO FAZ
//
// Nao decide nada e nao emite nota. So OLHA as triagens ja gravadas,
// junta as do mesmo pedido e diz em que pe esta cada grupo. Quem
// emite continua sendo ele, no fluxo de sempre.
// ============================================================

/** Normaliza um identificador pra comparar: so letras e numeros. */
function limpo(v) {
  return String(v == null ? '' : v).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/**
 * A chave que une as triagens irmas.
 *
 * O PEDIDO, e so ele. Nao uso shipment nem rastreio de proposito: eles
 * sao justamente o que MUDA entre as caixas (foi o que a gente mediu em
 * 29/08 com as duas etiquetas na mao — envio diferente, pedido igual).
 *
 * Sem pedido gravado nao da pra agrupar; a triagem fica sozinha, que e
 * o comportamento de hoje.
 */
function chaveDoGrupo(t) {
  if (!t) return null;
  const pedido = limpo(t.order_id || t.pedido);
  return pedido || null;
}

/**
 * Junta as triagens por pedido e diz o estado de cada grupo.
 *
 * `esperadoPorPedido` mapeia pedido -> quantas caixas o marketplace
 * disse que viriam. Vem da captura das devolucoes; quando o pedido nao
 * esta la, o grupo fica com esperado desconhecido e NAO se declara
 * completo — melhor ele conferir do que emitir cedo.
 */
function agrupar(triagens, esperadoPorPedido) {
  const esperado = esperadoPorPedido || {};
  const grupos = new Map();

  for (const t of (triagens || [])) {
    // b193.2 (Codex): registro SINTETICO nao conta como caixa recebida.
    //
    // O card de estornadas cria registros sem bipagem — ninguem conferiu
    // nada, e o produto pode nem ter voltado. Contando ele aqui, um pedido
    // que espera 2 caixas e teve 1 triada de verdade + 1 registro do card
    // apareceria como COMPLETO, e o dono emitiria a nota achando que tudo
    // chegou.
    //
    // O marcador vem do proprio registro, entao vale pros dois lados sem
    // precisar de campo novo.
    if (String(t && t.problema_descricao || '').includes('[ESTORNADA SEM RETORNO]')) continue;

    const chave = chaveDoGrupo(t);
    if (!chave) continue;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(t);
  }

  const saida = [];
  for (const [pedido, itens] of grupos) {
    const quantasVieram = itens.length;
    const quantasEsperadas = Number(esperado[pedido]) || null;

    // So considero COMPLETO quando sei quantas esperar E todas chegaram.
    // Desconhecido nao vira completo: emitir cedo e pior que esperar.
    const completo = quantasEsperadas != null && quantasVieram >= quantasEsperadas;
    const faltam = quantasEsperadas != null ? Math.max(0, quantasEsperadas - quantasVieram) : null;

    saida.push({
      pedido,
      triagens: itens,
      vieram: quantasVieram,
      esperadas: quantasEsperadas,
      faltam,
      completo,
      // uma triagem so, sem nada dizendo que ha mais: o caso normal
      parcial: quantasVieram > 1 || (quantasEsperadas != null && quantasEsperadas > 1),
      rotulo: quantasEsperadas != null
        ? (completo
            ? 'Todas as ' + quantasEsperadas + ' caixas chegaram — pode emitir a NF'
            : quantasVieram + ' de ' + quantasEsperadas + ' caixas triadas — aguardando '
              + (quantasEsperadas - quantasVieram) + ' pacote(s)')
        : (quantasVieram > 1
            ? quantasVieram + ' triagens deste pedido'
            : null),
    });
  }

  return saida;
}

/**
 * Anexa o estado do grupo em cada triagem, pra o painel exibir sem
 * precisar cruzar nada. Devolve a MESMA lista, com campos a mais.
 *
 * Feito assim de proposito: o painel ja consome a lista como esta hoje,
 * e mudar o formato quebraria a tela. Campo novo nao quebra nada.
 */
function anotar(triagens, esperadoPorPedido) {
  const grupos = agrupar(triagens, esperadoPorPedido);
  const porPedido = new Map(grupos.map((g) => [g.pedido, g]));

  return (triagens || []).map((t) => {
    const chave = chaveDoGrupo(t);
    const g = chave ? porPedido.get(chave) : null;
    if (!g || !g.parcial) return t;

    // qual das caixas esta e — ordem de chegada
    const ordenadas = g.triagens.slice().sort((a, b) =>
      String(a.created_at || a.criado_em || '').localeCompare(String(b.created_at || b.criado_em || '')));
    const qual = ordenadas.findIndex((x) => x.id === t.id) + 1;

    return {
      ...t,
      parcial: {
        pedido: g.pedido,
        esta: qual || null,
        vieram: g.vieram,
        esperadas: g.esperadas,
        faltam: g.faltam,
        completo: g.completo,
        rotulo: g.rotulo,
        // ids das irmas, pro painel poder destacar juntas
        irmas: ordenadas.map((x) => x.id).filter((id) => id !== t.id),
      },
    };
  });
}

/**
 * Monta o mapa pedido -> quantas caixas esperar, a partir das devolucoes
 * capturadas do marketplace.
 *
 * So conta as ATIVAS: cancelada nao vira pacote. E so conta as que tem
 * retorno fisico — reembolso puro nunca gera caixa (metade das
 * devolucoes do TikTok, medido nas 99 da Girassol).
 */
function esperadoDeCapturadas(capturadas) {
  const mapa = {};
  for (const d of (capturadas || [])) {
    if (!d) continue;

    const status = String(d.status || '').toUpperCase();
    if (status.indexOf('CANCEL') !== -1) continue;

    // sem retorno fisico nao ha caixa
    const tipo = String(d.tipo_tiktok || d.tipo || '').toUpperCase();
    if (tipo === 'REFUND') continue;

    const pedido = limpo(d.pedido || d.order_id);
    if (!pedido) continue;
    // b282 - ⚠️ CONTA PACOTE FISICO, NAO REGISTRO.
    //
    // CASO REAL (11/09, pedido 2000018197293466 do Charles Alexandre): o
    // cliente comprou 1 unidade de 1 produto, devolveu em 1 caixa, e o
    // card disse "1 de 2 caixas triadas — aguardando 1 pacote(s)". O
    // estoquista foi orientado a ESPERAR uma caixa que nao existe, e a NF
    // de devolucao fica travada ate alguem perceber.
    //
    // A causa: `mapa[pedido] += 1` contava UM POR REGISTRO capturado. Se o
    // ML devolve 2 registros do MESMO pedido — duas claims, ou a mesma
    // claim vista por duas rotas da coleta — vira "2 caixas".
    //
    // ⚠️ O QUE IDENTIFICA UM PACOTE E O ENVIO (shipment/tracking), nao o
    // registro. Dois registros com o mesmo shipment sao O MESMO pacote.
    //
    // Sem shipment nem tracking, caio no antigo (conta o registro): melhor
    // errar pra mais numa devolucao que REALMENTE tem 2 caixas do que
    // somar pacotes inexistentes no caso comum.
    const envio = limpo(d.shipment_devolucao || d.shipment || d.shipment_id || d.rastreio || d.tracking || '');
    if (!mapa[pedido]) mapa[pedido] = { envios: new Set(), semEnvio: 0, porClaim: {}, shopeeSn: new Set(), shopeeRastreio: new Set() };
    // 29/10 - ⚠️ SHOPEE: A CAIXA E A DEVOLUCAO (return_sn), NAO O RASTREIO.
    //
    // CASO REAL (GOOD, pedido 260929A0A15CVV, dono 29/10): card 'CAIXA 1/2 — aguardando outra caixa' numa
    // devolucao de 1 unidade e 1 pacote. Mecanismo (lido no codigo): enquanto a devolucao esta em analise, sem
    // rastreio, a espreita usa o NUMERO DA DEVOLUCAO como rastreio; a captura grava pela chave do rastreio, e quando
    // o BR... aparece grava OUTRA linha da mesma devolucao. Dois 'envios', uma caixa — o mesmo erro da etiqueta
    // trocada do ML (14/10), mas a Shopee nao tem claim pra amarrar.
    // Regra: identidade = return_sn (da linha, ou o proprio 'rastreio' quando ele tem a cara de um: AAMMDD + 9).
    // Linha antiga com rastreio real e SEM return_sn (a GOOD nao gravava): conta no maximo tantas caixas quanto o
    // MAIOR dos dois conjuntos — nunca a soma (cada devolucao aparece uma vez como numero e uma vez como BR...).
    const snShopee = limpo(d.return_sn || (d.cru && d.cru.return_sn) || '');
    const pareceSn = (v) => /^\d{6}[0-9A-Z]{9}$/i.test(v);
    if (String(d.marketplace || '').toLowerCase() === 'shopee' || snShopee || pareceSn(envio)) {
      if (snShopee) mapa[pedido].shopeeSn.add(snShopee);
      else if (envio && pareceSn(envio)) mapa[pedido].shopeeSn.add(envio);
      else if (envio) mapa[pedido].shopeeRastreio.add(envio);
      else mapa[pedido].semEnvio += 1;
      continue;
    }
    if (envio) mapa[pedido].envios.add(envio);
    else mapa[pedido].semEnvio += 1;
    // 14/10 - ⚠️ ETIQUETA TROCADA NAO E CAIXA NOVA.
    //
    // CASO REAL (Girassol, pedido 2000018478090602, dono 14/10): o card dizia
    // "CAIXA 1/2" numa devolucao de 1 pacote. A captura tinha 2 registros da
    // MESMA reclamacao do ML (claim 5581409961, mesmo produto, mesma NF): o ML
    // trocou a etiqueta de retorno no meio do caminho — a 1a (MEL...) ficou
    // parada em ready_to_ship e a 2a (E7SK...) foi a que viajou. Dois
    // rastreios, uma caixa.
    //
    // Regra: dentro da MESMA claim, o envio que ainda esta "pronto pra enviar"
    // e etiqueta SUBSTITUIDA quando (a) outro envio da claim ja saiu e (b) o
    // marketplace PAROU de devolve-lo — a captura nao o ve mais desde antes de
    // ver o que saiu. Codex (#489): so "outro ja saiu" nao basta — numa claim
    // com 2 caixas de verdade, a 1a pode sair antes da 2a; a 2a continua
    // aparecendo em toda captura, e por isso continua contando. No caso real,
    // a etiqueta velha sumiu 32 h antes (visto em 07/10 06h22 x 08/10 15h02).
    // Sem a data de "visto por ultimo", nao descarto (conta como antes).
    const claim = limpo(d.claim_id || (d.cru && d.cru.claim_id) || '');
    if (claim && envio) {
      const c = mapa[pedido].porClaim[claim] || (mapa[pedido].porClaim[claim] = {});
      const jaSaiu = !/^(|READY_TO_SHIP|PENDING|HANDLING|TO_BE_AGREED)$/.test(status);
      const visto = Date.parse(d.visto_por_ultimo || '') || 0;
      const e = c[envio] || (c[envio] = { saiu: false, visto: 0 });
      e.saiu = e.saiu || jaSaiu;
      if (visto > e.visto) e.visto = visto;
    }
  }
  const FOLGA_MS = 6 * 60 * 60 * 1000;   // capturas rodam algumas vezes por dia: 6 h de folga antes de chamar de "sumiu"
  for (const v of Object.values(mapa)) {
    for (const envs of Object.values(v.porClaim)) {
      const lista = Object.entries(envs);
      if (lista.length < 2) continue;
      const vistoDosQueSairam = Math.max(0, ...lista.filter(([, e]) => e.saiu).map(([, e]) => e.visto));
      if (!vistoDosQueSairam) continue;
      for (const [envio, e] of lista) {
        if (!e.saiu && e.visto && e.visto + FOLGA_MS < vistoDosQueSairam) v.envios.delete(envio);
      }
    }
  }
  // ⚠️ converte pro formato que o resto espera (numero por pedido):
  // pacotes distintos = envios UNICOS + os que vieram sem envio nenhum
  const contagem = {};
  for (const [ped, v] of Object.entries(mapa)) {
    contagem[ped] = v.envios.size + v.semEnvio + Math.max(v.shopeeSn.size, v.shopeeRastreio.size);   // 29/10: Shopee pela devolucao
  }
  return contagem;
}

module.exports = { chaveDoGrupo, agrupar, anotar, esperadoDeCapturadas };
