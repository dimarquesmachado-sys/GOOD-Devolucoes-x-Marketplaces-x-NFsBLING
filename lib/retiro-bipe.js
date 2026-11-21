'use strict';
// b780 — pedido do dono (21/11, AMB): o bipe da etiqueta de RETIRADA do Full mostrava 23 pecas "vem pelo RETIRO"
// so com o NUMERO DO PEDIDO — "como sei agora qual e?!". A etiqueta da retirada nao traz cliente nem produto, entao
// quem identifica a caixa e o PRODUTO (e a data). Esta peca, comum as 3 empresas (as duas rotas
// /api/espreita/retiro — GOOD no server.js e AMB/Girassol na fabrica — usam a mesma), monta a linha da lista com o
// que a espreita ja tem do pedido: produto(s) com SKU, cliente, data da devolucao e a linha do tempo da retirada.

/** a condicao que o CD do ML deu na revisao, em portugues (valor desconhecido sai como veio, nunca some) */
const CONDICAO = { saleable: 'vendável', unsaleable: 'inservível' };
function condicaoML(c) {
  if (!c) return null;
  return CONDICAO[String(c).toLowerCase()] || String(c);
}

/** item da espreita (em_transito, marcado vem_pelo_retiro) → linha da lista do bipe. Com o `codigo` bipado, marca
 *  `casa_etiqueta` quando ele aparece num numero deste pedido (ver casaComEtiqueta). */
function itemDoRetiro(x, codigo) {
  const r = (x && x.retiro) || {};
  const produtos = (Array.isArray(x && x.itens) ? x.itens : [])
    .map((it) => ({ titulo: (it && it.titulo) || null, sku: (it && it.sku) || null, qtd: (it && it.qtd) || 1 }))
    .filter((p) => p.titulo || p.sku);
  const linha = {
    pedido: x.pedido,
    pack_id: x.pack_id || null,
    status: x.status,
    tracking: x.tracking || null,
    dias: x.dias_em_transito || null,
    produtos,
    cliente: x.cliente_ml || null,
    apelido: x.nickname || null,
    nf_numero: x.nf_ml_numero || null,
    nf_serie: x.nf_ml_serie || null,
    devolucao_em: x.desde || null,
    reservada_em: r.reservada_em || null,
    saiu_cd_em: r.saiu_cd_em || null,
    condicao: condicaoML(r.condicao),
    embalagem_danificada: r.motivo === 'damaged',
    // os numeros das operacoes de retirada (pra casar com o codigo bipado) e o que a linha do tempo conseguiu.
    // ⚠️ Codex #632: as operacoes sao lidas por ANUNCIO (inventario do Full), nao por pedido — dois pedidos do mesmo
    // anuncio trazem as MESMAS retiradas. Por isso o inventario vai junto e o casamento por esses numeros e nivel 'anuncio'.
    numeros_retirada: Array.isArray(r.numeros) ? r.numeros : [],
    inventario: r.inventario || null,
    linha_do_tempo: r.linha_do_tempo || null,
  };
  linha.casa_etiqueta = casaComEtiqueta(linha, codigo);
  return linha;
}

/**
 * A etiqueta bipada (codigo de barras ou Ref. ID) casa com esta linha? So igualdade exata. Devolve o NIVEL da prova:
 *  - 'pedido': e o numero do proprio pedido, pack ou rastreio da devolucao — identifica o pedido;
 *  - 'anuncio': aparece numa operacao de RETIRADA do Full do anuncio deste pedido, depois desta devolucao. Isso prova o
 *    PRODUTO (inventario), NAO o pedido: outro pedido do mesmo anuncio traz a mesma retirada, e uma retirada de estoque
 *    comum tambem (Codex #632). A tela mostra como pista e manda conferir; nunca afirma "e deste pedido".
 * @returns {{nivel:'pedido'|'anuncio', via:string}|null}
 */
function casaComEtiqueta(item, codigo) {
  const c = String(codigo || '').replace(/\D/g, '');
  if (c.length < 6 || !item) return null;
  for (const k of ['pedido', 'pack_id', 'tracking']) if (item[k] && String(item[k]) === c) return { nivel: 'pedido', via: k };
  const ach = (item.numeros_retirada || []).find((n) => n && String(n.valor) === c);
  if (ach) return { nivel: 'anuncio', via: 'retirada: ' + ach.campo };
  return null;
}

module.exports = { itemDoRetiro, condicaoML, casaComEtiqueta };
