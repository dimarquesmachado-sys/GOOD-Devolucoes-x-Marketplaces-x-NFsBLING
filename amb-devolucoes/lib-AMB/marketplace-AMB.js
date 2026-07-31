// ============================================================
// amb-devolucoes/lib-AMB/marketplace-AMB.js    (AMB Devol. b8)
// ------------------------------------------------------------
// Descobre de qual canal veio a venda, sem perguntar nada.
//
// DE ONDE VEIO ISTO: ao abrir a NF do TikTok no Bling, o campo
// numeroPedidoLoja trouxe 584368688067020647 — exatamente o ID
// que o Bling mostra no pedido como "[Origem TikTok (...)]".
// Ou seja, a propria NF carrega a origem; so faltava ler.
//
// Com isso a coluna `marketplace` da tabela devolucoes_amb se
// preenche sozinha, e o estoquista nao precisa escolher nada
// numa lista (uma escolha a menos = um erro a menos).
//
// IMPORTANTE: isto e um PALPITE por formato, nao uma certeza.
// Quando nao da pra afirmar, devolve 'desconhecido' em vez de
// chutar — um marketplace errado no registro e pior do que um
// campo vazio na hora de cobrar ressarcimento.
// ============================================================

'use strict';

/**
 * @param {string} numeroPedidoLoja  campo da NF do Bling
 * @param {object} [pistas]          { tracking, temClaimML }
 * @returns {{ marketplace: string, confianca: string, motivo: string }}
 */
function detectar(numeroPedidoLoja, pistas = {}) {
  const n = String(numeroPedidoLoja || '').trim();

  // Pista mais forte de todas: se o rastreio veio do indice de
  // claims do ML, e ML e ponto final.
  if (pistas.temClaimML) {
    return { marketplace: 'ml', confianca: 'alta', motivo: 'veio do indice de devolucoes do Mercado Livre' };
  }

  const trk = String(pistas.tracking || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^MEL\d+FMDOR\d+$/.test(trk)) {
    return { marketplace: 'ml', confianca: 'alta', motivo: 'rastreio no padrao Mercado Envios' };
  }

  if (!n) {
    return { marketplace: 'desconhecido', confianca: 'nenhuma', motivo: 'NF sem numero do pedido na loja' };
  }

  // ML: 16 digitos comecando com 2000
  if (/^2000\d{12}$/.test(n)) {
    return { marketplace: 'ml', confianca: 'alta', motivo: '16 digitos iniciando em 2000' };
  }

  // TikTok Shop: 18 digitos
  if (/^\d{18}$/.test(n)) {
    return { marketplace: 'tiktok', confianca: 'alta', motivo: '18 digitos, padrao TikTok Shop' };
  }

  // Shopee: alfanumerico misturando letra e numero (ex 260701G6RJMX8Y)
  if (/^[A-Z0-9]{12,16}$/i.test(n) && /[A-Z]/i.test(n) && /\d/.test(n)) {
    return { marketplace: 'shopee', confianca: 'media', motivo: 'codigo alfanumerico no padrao Shopee' };
  }

  // Magalu: numerico mais curto
  if (/^\d{6,14}$/.test(n)) {
    return { marketplace: 'magalu', confianca: 'baixa', motivo: 'numerico curto - confira, pode ser outro canal' };
  }

  return { marketplace: 'desconhecido', confianca: 'nenhuma', motivo: 'formato nao reconhecido: ' + n.slice(0, 24) };
}

/** Nome bonito pra mostrar na tela. */
const NOMES = {
  ml: 'Mercado Livre',
  tiktok: 'TikTok Shop',
  shopee: 'Shopee',
  magalu: 'Magalu',
  amazon: 'Amazon',
  desconhecido: 'origem nao identificada',
};

function nomeBonito(chave) {
  return NOMES[chave] || chave;
}

module.exports = { detectar, nomeBonito, NOMES };
