'use strict';
// lib/produto-por-ean-ponte.js
//
// b671 - CODIGO DE BARRAS -> PRODUTO, PELA PONTE AO MOVER-PEDIDOS (peca unica, empresa
// como parametro).
//
// ⚠️ POR QUE EXISTE
//
// No "produto errado" (divergente) o estoquista bipa o codigo de barras da caixa
// que chegou. A GOOD resolve isso pelo indice de produtos dela (b666); a
// Girassol/AMB nao tem indice nenhum — e NAO devem ter: montar um pra 9.000
// SKUs no boot foi exatamente o que estourou a cota do Bling da Girassol em
// outubro (estoque-girassol, 2h30 a 1 req/s a cada deploy). O Mover-Pedidos ja
// mantem, POR EMPRESA, um indice EAN->produto persistido em disco (lib/
// indice-ean-disco.js de la) e expoe `GET /<pasta-do-checkout>/buscar-produto?q=`
// no painel (aceita a ADMIN_KEY de la no `k=`, a mesma que a ponte do TikTok ja
// usa: MOVER_PEDIDOS_URL / MOVER_PEDIDOS_KEY). Esta peca pergunta la.
//
// Saidas (matriz):
//   { ok: true,  produto: { id, nome, codigo, gtin }, via: 'mover-pedidos' }
//   { ok: false, motivo }  — EAN invalido, empresa fora do registro, ponte nao
//                            configurada, Mover-Pedidos fora/404/timeout, nada
//                            encontrado la, resposta sem produto. NUNCA lanca.
// "nao sei" (ponte fora) e "nao existe" (nada encontrado) vem com motivos
// diferentes — o chamador mostra o motivo e cai no caminho do SKU exato.

const { obterEmpresa } = require('./empresas');
const { chamarMoverPedidos } = require('./tiktok-ponte');

function pastaDoCheckout(chaveEmpresa) {
  const ficha = obterEmpresa(chaveEmpresa);   // lanca "empresa desconhecida" fora do registro
  return ficha.pastaCheckout || ((ficha.chaveDados || ficha.chave) + '-checkout-offline');
}

async function produtoPorEanNoMoverPedidos(chaveEmpresa, ean, opts) {
  const digitos = String(ean || '').replace(/\D/g, '');
  if (digitos.length < 8 || digitos.length > 14 || digitos !== String(ean || '').trim()) {
    return { ok: false, motivo: 'codigo de barras invalido (8 a 14 digitos): ' + String(ean || '').slice(0, 24) };
  }
  let pasta;
  try { pasta = pastaDoCheckout(chaveEmpresa); } catch (e) {
    return { ok: false, motivo: 'empresa fora do registro: ' + String(chaveEmpresa) };
  }
  const r = await chamarMoverPedidos('/' + pasta + '/buscar-produto', { q: digitos }, { timeoutMs: (opts && opts.timeoutMs) || 8000 });
  if (!r.ok) {
    if (r.http === 0 && /ponte nao configurada/.test(String(r.erro || ''))) {
      return { ok: false, motivo: 'ponte com o Mover-Pedidos nao configurada (MOVER_PEDIDOS_URL/KEY)', ponte_fora: true };
    }
    if (r.corpo && r.corpo.ok === false && r.corpo.erro) {
      return { ok: false, motivo: 'Mover-Pedidos: ' + String(r.corpo.erro).slice(0, 120) };
    }
    return { ok: false, motivo: 'Mover-Pedidos nao respondeu (' + (r.http || 'sem conexao') + ')' + (r.erro ? ': ' + String(r.erro).slice(0, 120) : ''), ponte_fora: true };
  }
  const corpo = r.corpo || {};
  if (corpo.ok === false) {
    return { ok: false, motivo: 'Mover-Pedidos: ' + String(corpo.erro || 'nada encontrado').slice(0, 120) };
  }
  const p = corpo.produto || null;
  if (!p || !p.sku) {
    return { ok: false, motivo: 'Mover-Pedidos respondeu sem produto pro EAN ' + digitos };
  }
  return {
    ok: true, via: 'mover-pedidos',
    produto: { id: p.id || null, nome: p.nome || '', codigo: String(p.sku), gtin: digitos },
  };
}

module.exports = { produtoPorEanNoMoverPedidos, pastaDoCheckout };
