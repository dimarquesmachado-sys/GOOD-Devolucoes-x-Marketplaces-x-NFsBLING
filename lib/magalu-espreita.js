// ============================================================
// À ESPREITA (v3.76) - devolucoes ESPERADAS do portal Magalu Entregas
// ------------------------------------------------------------
// O BFF do portal (seller-devolution-bff.mglu.io) aceita o NOSSO token
// OAuth + header x-tenant-id (descoberto via DevTools + testado 200).
// Varre as 3 modalidades e monta o indice por PEDIDO:
//   /v1/orders/{tenant}       -> Agencias Magalu (uuid, IN_TRANSIT...)
//   /v1/post-office/{tenant}  -> Correios
//   /v1/fulfillment/{tenant}  -> Fulfillment
// Uso: o bipe cruza pelo orderId (que o fluxo Magalu ja resolve) e o
// admin ganha o painel esperadas/atrasadas ("nunca chegou").
// ============================================================

module.exports = ({ chamarMagalu }) => {
  const BFF = 'https://seller-devolution-bff.mglu.io';
  const TENANT = process.env.MAGALU_TENANT_ID || 'goodimport-magazine';
  const HDR = { headers: { 'x-tenant-id': TENANT, Origin: 'https://seller.magaluentregas.com.br', Referer: 'https://seller.magaluentregas.com.br/' } };
  const IDX = { ts: 0, porPedido: {}, lista: [], erro: null, duracaoSeg: 0 };

  async function varrer(caminho, categoria) {
    const out = [];
    for (let off = 0; off < 500; off += 50) {
      const r = await chamarMagalu(`${BFF}${caminho}/${TENANT}?limit=50&offset=${off}`, HDR);
      if (!r.ok) { IDX.erro = `${categoria} HTTP ${r.status}`; break; }
      const recs = r.data?.records || [];
      for (const d of recs) {
        out.push({
          categoria,
          chave: String(d.uuid || d.id || ''),
          pedido: String(d.orderId || ''),
          status: d.status || null,                 // IN_TRANSIT | DELIVERED | RETURNED
          tipo: d.devolutionType || null,           // CUSTOMER_RETURN | BRANCH_RETURN
          valor: d.price != null ? d.price : null,
          data_devolucao: d.devolutionDate || null, // quando a devolucao nasceu
          entregue_em: d.deliveredAt || null,       // quando chegou no galpao
          prazo: d.deadlineDate || null,
          branch: d.branchId || null,
        });
      }
      const total = r.data?.meta?.totalRecords || 0;
      if (off + recs.length >= total || recs.length === 0) break;
      await new Promise(s => setTimeout(s, 250));
    }
    return out;
  }

  async function construirIndice() {
    const t0 = Date.now();
    IDX.erro = null;
    const tudo = [];
    for (const [caminho, cat] of [['/v1/orders', 'agencia'], ['/v1/post-office', 'correios'], ['/v1/fulfillment', 'fulfillment']]) {
      try { tudo.push(...await varrer(caminho, cat)); } catch (e) { IDX.erro = `${cat}: ${e.message}`; }
      await new Promise(s => setTimeout(s, 200));
    }
    const porPedido = {};
    for (const d of tudo) if (d.pedido) porPedido[d.pedido] = d;
    IDX.ts = Date.now();
    IDX.lista = tudo;
    IDX.porPedido = porPedido;
    IDX.duracaoSeg = Math.round((Date.now() - t0) / 1000);
    console.log(`[ESPREITA] ${tudo.length} devolucoes esperadas (${Object.keys(porPedido).length} pedidos) em ${IDX.duracaoSeg}s`);
    return IDX;
  }

  const diasDesde = (iso) => iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null;

  // Resumo pro painel do admin: a espreita, atrasadas e recem-chegadas
  function resumo() {
    const emTransito = IDX.lista.filter(d => d.status === 'IN_TRANSIT')
      .map(d => ({ ...d, dias_em_transito: diasDesde(d.data_devolucao) }))
      .sort((a, b) => (b.dias_em_transito || 0) - (a.dias_em_transito || 0));
    const atrasadas = emTransito.filter(d => (d.dias_em_transito || 0) > 30);
    const chegadas30d = IDX.lista.filter(d => d.entregue_em && (diasDesde(d.entregue_em) || 99) <= 30);
    // v3.82 - entregues ao seller: candidatas ao alerta "chegou e ninguem bipou"
    const entregues = IDX.lista
      .filter(d => d.entregue_em)
      .map(d => ({ marketplace: 'magalu', pedido: d.pedido, tracking: null, dias_desde: diasDesde(d.entregue_em), entregue_em: d.entregue_em, valor: d.valor, uuid: d.chave || null, tipo: d.tipo || null, categoria: d.categoria || null }))
      .sort((a, b) => (a.dias_desde || 0) - (b.dias_desde || 0));
    return {
      quente: IDX.ts > 0,
      idade_min: IDX.ts ? Math.round((Date.now() - IDX.ts) / 60000) : null,
      total: IDX.lista.length,
      em_transito: emTransito,
      atrasadas_30d: atrasadas,
      chegadas_30d: chegadas30d.length,
      entregues,
      erro: IDX.erro,
      duracao_construcao_seg: IDX.duracaoSeg || null,
    };
  }

  // Cruzamento no bipe: esse pedido tem devolucao esperada/registrada?
  function porPedido(pedido) {
    return IDX.porPedido[String(pedido || '')] || null;
  }

  function preAquecer() {
    construirIndice().catch(e => console.error('[ESPREITA] pre-aquecimento falhou:', e.message));
  }

  return { construirIndice, resumo, porPedido, preAquecer };
};
