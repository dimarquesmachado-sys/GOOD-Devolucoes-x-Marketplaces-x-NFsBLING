'use strict';
// 30/10 — tira da espreita o que JA FOI TRIADO no galpao (peca unica; a GOOD ja fazia isso no server.js desde a v3.79
// e no alerta b236.1 — a fabrica Girassol/AMB nunca fez). Dono, 29/10: triou a tosquiadeira 2609069UWS4UFX e ela
// continuou no bloco 'chegou e ninguem bipou'; os cards 117 e 129 (triados, vinculo conferido) tambem estavam la.
// Regra da GOOD: sai o card cujo PEDIDO esta numa triagem (order_id) OU cujo RASTREIO esta numa triagem
// (shipment_id). Aqui tambem o pack (carrinho do ML) e o numero do envio de devolucao do ML. Registro de 'caso' das
// estornadas sem retorno ([caso:X] na descricao) nao e bipe fisico e nao conta.
// Falha na consulta = NAO esconde nada (melhor mostrar um ja triado do que sumir com um pendente).

async function chavesTriadas(sb, tabela, lista) {
  const pedidos = new Set(), envios = new Set();
  for (const d of (lista || [])) {
    if (!d) continue;
    for (const v of [d.pedido, d.pack_id]) if (v) pedidos.add(String(v));
    for (const v of [d.tracking, d.shipment_devolucao]) if (v) envios.add(String(v));
  }
  const achados = new Set();
  if (!sb || typeof sb.from !== 'function' || !tabela) return { ok: false, achados, erro: 'sem banco' };
  try {
    for (const [col, vals] of [['order_id', [...pedidos]], ['shipment_id', [...envios]]]) {
      for (let i = 0; i < vals.length; i += 200) {
        const { data, error } = await sb.from(tabela).select('order_id, shipment_id, problema_descricao').in(col, vals.slice(i, i + 200));
        if (error) return { ok: false, achados: new Set(), erro: error.message || String(error) };
        for (const r of (data || [])) {
          if (/\[caso:/.test(String(r.problema_descricao || ''))) continue;
          const v = r[col];
          if (v != null && v !== '') achados.add(String(v));
        }
      }
    }
    return { ok: true, achados };
  } catch (e) {
    return { ok: false, achados: new Set(), erro: e.message };
  }
}

function semTriadas(lista, achados, { soShopee = false } = {}) {
  if (!Array.isArray(lista)) return [];
  if (!achados || !achados.size) return lista;
  return lista.filter((d) => {
    if (!d) return false;
    if (soShopee && d.marketplace !== 'shopee') return true;
    return ![d.pedido, d.pack_id, d.tracking, d.shipment_devolucao].filter(Boolean).map(String).some((k) => achados.has(k));
  });
}

module.exports = { chavesTriadas, semTriadas };
