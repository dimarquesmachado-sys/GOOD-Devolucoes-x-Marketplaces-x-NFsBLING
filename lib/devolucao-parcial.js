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
    mapa[pedido] = (mapa[pedido] || 0) + 1;
  }
  return mapa;
}

module.exports = { chaveDoGrupo, agrupar, anotar, esperadoDeCapturadas };
