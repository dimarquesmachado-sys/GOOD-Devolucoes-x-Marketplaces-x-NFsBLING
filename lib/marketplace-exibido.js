'use strict';
// ============================================================
// lib/marketplace-exibido.js
// ------------------------------------------------------------
// Canal (marketplace) de uma triagem PELO NUMERO DO PEDIDO e a correcao
// dos registros antigos NA HORA DE MOSTRAR — sem mexer no banco.
//
// Por que existe: ate o b647, a triagem bipada pela CHAVE DA NF gravava o
// padrao 'mercadolivre' mesmo com pedido Amazon (702-...), Magalu (15...) ou
// TikTok (58...). O #519 (b648) passou a gravar o canal certo e a corrigir a
// LISTA na exibicao; esta peca leva a MESMA correcao ao RELATORIO (b649).
// As funcoes moravam no server.js — vieram para ca sem mudar uma linha da
// logica, para lista e relatorio usarem a mesma regra.
//
// Regra: so afirma canal com confianca ALTA ou MEDIA do detector da casa —
// marketplace errado e pior que vazio. Pedido de ML, ou formato que o
// detector nao afirma (ex.: numerico curto), fica como esta.
// ============================================================

const mktDetector = require('../amb-devolucoes/lib-AMB/marketplace-AMB');

function marketplacePeloPedido(pedido) {
  try {
    const r = mktDetector.detectar(pedido, {});
    return (r && r.marketplace && r.marketplace !== 'desconhecido' && (r.confianca === 'alta' || r.confianca === 'media')) ? r.marketplace : null;
  } catch (e) { return null; }
}

// Registro antigo com o padrao 'mercadolivre' (ou vazio) mas pedido de OUTRO canal: corrige NA HORA DE MOSTRAR
// (sem mexer no banco). Pedido de ML, ou formato que o detector nao afirma, fica como esta.
function corrigirMarketplaceExibido(d) {
  if (!d || (d.marketplace && d.marketplace !== 'mercadolivre')) return d;
  const certo = marketplacePeloPedido(d.order_id);
  return (certo && certo !== 'ml') ? { ...d, marketplace: certo, marketplace_corrigido: true } : d;
}

// ------------------------------------------------------------
// Relatorio (b649): o banco tem DOIS rotulos para o Mercado Livre — 'ml'
// (triagem pela etiqueta do ML e, desde o b648, pela chave da NF) e
// 'mercadolivre' (o padrao antigo). Somados em separado, o relatorio partia o
// ML em dois e a planilha exportada trazia os dois nomes. Aqui viram UM so,
// 'mercadolivre' — o mesmo que o relatorio ja usa para registro sem canal.
// ------------------------------------------------------------
const ROTULO_ML_RELATORIO = 'mercadolivre';

function ehRotuloMl(m) {
  const s = String(m == null ? '' : m).trim().toLowerCase();
  return s === 'ml' || s === 'mercadolivre';
}

// Canal da triagem como o relatorio deve contar: corrige o padrao antigo pelo
// numero do pedido e junta os dois rotulos do ML. Registro sem canal continua
// sem canal (o relatorio ja o conta como 'mercadolivre').
function marketplaceNoRelatorio(d) {
  const c = corrigirMarketplaceExibido(d);
  if (!c || !c.marketplace || !ehRotuloMl(c.marketplace) || c.marketplace === ROTULO_ML_RELATORIO) return c;
  return { ...c, marketplace: ROTULO_ML_RELATORIO };
}

// Filtro ?marketplace= do relatorio, comparado DEPOIS da correcao: 'ml' e
// 'mercadolivre' pedem o mesmo canal. Vazio = sem filtro (null).
function filtroMarketplaceRelatorio(param) {
  const s = String(param == null ? '' : param).trim().toLowerCase();
  if (!s) return null;
  return ehRotuloMl(s) ? ROTULO_ML_RELATORIO : s;
}

module.exports = {
  marketplacePeloPedido,
  corrigirMarketplaceExibido,
  marketplaceNoRelatorio,
  filtroMarketplaceRelatorio,
  ROTULO_ML_RELATORIO,
};
