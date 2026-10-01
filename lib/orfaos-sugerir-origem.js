'use strict';
/* ============================================================
 * lib/orfaos-sugerir-origem.js
 * ------------------------------------------------------------
 * CARD ORFAO (so produto e quantidade, sem pedido/rastreio/NF) x
 * DEVOLUCOES A CAMINHO (o "a espreita", que ja conhece as devolucoes
 * antes de chegarem): sugere de onde o pacote provavelmente veio,
 * casando pelo SKU.
 *
 * ⚠️ O CASO (Girassol, 30/09): o estoquista bipou o codigo de barras
 * do PRODUTO em vez do rastreio em 3 pacotes. Os cards nasceram so com
 * SKU e quantidade. A trava (b459) impede que isso se repita — mas os 3
 * ja existem, e a informacao "de onde veio" nunca entrou neles. O que
 * o sistema TEM e a lista das devolucoes que ele esperava: se um desses
 * SKUs esta numa devolucao conhecida e ainda nao triada, e dali que o
 * pacote veio.
 *
 * E SUGESTAO, nao conserto automatico: dois pedidos do mesmo SKU sao
 * dois candidatos, e quem decide e o dono, vendo cliente e data. A saida
 * certa e: excluir o orfao e triar de novo pelo rastreio do candidato.
 *
 * Funcao PURA (listas entram, sugestoes saem) — a mesma pras 3 empresas;
 * cada rota passa os seus cards e o seu "a espreita".
 * ============================================================ */

const CAMPOS_ORIGEM = ['order_id', 'pack_id', 'shipment_id', 'tracking', 'nf_numero', 'pedido_bling_numero', 'nf_chave', 'magalu_protocolo'];

function vazio(v) {
  return v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '-';
}

/** Card sem NENHUM identificador de origem. */
function ehOrfao(card) {
  return !!card && CAMPOS_ORIGEM.every((k) => vazio(card[k]));
}

function normSku(s) {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Os SKUs que um item do "a espreita" carrega (o proprio e os dos itens). */
function skusDoItem(it) {
  const out = new Set();
  if (!it) return out;
  if (!vazio(it.sku)) out.add(normSku(it.sku));
  if (!vazio(it.produto_sku)) String(it.produto_sku).split(',').forEach((s) => { if (!vazio(s)) out.add(normSku(s)); });
  if (Array.isArray(it.itens)) it.itens.forEach((i) => { if (i && !vazio(i.sku)) out.add(normSku(i.sku)); });
  return out;
}

/**
 * @param {object[]} cards      - registros da fila (o que listarFila devolve)
 * @param {object[]} aCaminho   - itens do "a espreita" (em_transito + entregues)
 * @param {object}   [opcoes]   - { jaTriado: (it) => boolean }  marca candidato que ja tem card
 * @returns {{ orfaos: Array<{orfao, candidatos}>, total_orfaos: number, sem_candidato: number }}
 */
function sugerirOrigem(cards, aCaminho, opcoes = {}) {
  const jaTriado = typeof opcoes.jaTriado === 'function' ? opcoes.jaTriado : () => false;
  const lista = (Array.isArray(aCaminho) ? aCaminho : []).filter(Boolean);
  const orfaos = (Array.isArray(cards) ? cards : []).filter(ehOrfao);
  const saida = orfaos.map((card) => {
    const alvo = normSku(card.produto_sku);
    const candidatos = !alvo ? [] : lista
      .filter((it) => skusDoItem(it).has(alvo))
      .map((it) => {
        const itemCasado = Array.isArray(it.itens) ? it.itens.find((i) => i && normSku(i.sku) === alvo) : null;
        return {
          marketplace: it.marketplace || null,
          pedido: it.pedido || it.order_id || null,
          tracking: it.tracking || null,
          cliente: it.cliente || it.cliente_ml || it.nome_cliente || null,
          qtd_no_pedido: itemCasado ? (Number(itemCasado.qtd) || null) : (it.qtd != null ? Number(it.qtd) : null),
          dias: it.dias_em_transito != null ? it.dias_em_transito : (it.dias_desde != null ? it.dias_desde : null),
          situacao: it.status || null,
          ja_triado: !!jaTriado(it),
          // quando a quantidade bate, e mais provavel
          qtd_bate: itemCasado ? Number(itemCasado.qtd) === Number(card.produto_qtd) : null,
        };
      })
      // os ainda NAO triados primeiro; dentro deles, os que batem a quantidade
      .sort((a, b) => (a.ja_triado - b.ja_triado) || ((b.qtd_bate === true) - (a.qtd_bate === true)));
    return {
      orfao: {
        id: card.id, criado_em: card.criado_em || card.created_at || null,
        produto_sku: card.produto_sku || null, produto_titulo: card.produto_titulo || null,
        produto_qtd: card.produto_qtd != null ? Number(card.produto_qtd) : null,
        funcionario: card.funcionario || null,
      },
      candidatos,
      dica: candidatos.length === 0
        ? 'nenhuma devolucao a caminho com este SKU: procure no Bling pelas vendas recentes do produto, ou pergunte ao estoquista'
        : (candidatos.filter((c) => !c.ja_triado).length === 1
          ? 'um unico candidato nao triado: exclua este card e tria de novo bipando o rastreio dele'
          : 'mais de um candidato: confira cliente e data antes de escolher; depois exclua este card e tria pelo rastreio certo'),
    };
  });
  return {
    orfaos: saida,
    total_orfaos: saida.length,
    sem_candidato: saida.filter((x) => x.candidatos.length === 0).length,
  };
}

module.exports = { sugerirOrigem, ehOrfao, skusDoItem, normSku, CAMPOS_ORIGEM };
