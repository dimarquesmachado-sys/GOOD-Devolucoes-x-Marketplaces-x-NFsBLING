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
//   { ok: false, motivo, nao_encontrado: true }  — o Mover-Pedidos olhou e NAO TEM
//   { ok: false, motivo, ponte_fora: true }      — ponte nao configurada, servico fora,
//                            404 do guard, HTTP de erro, 2xx sem JSON, JSON sem produto
//   { ok: false, motivo }                        — EAN invalido / empresa fora do registro
// NUNCA lanca. "nao sei" (ponte_fora) e "nao existe" (nao_encontrado) sao
// distinguiveis — o chamador mostra o motivo e cai no caminho do SKU exato.

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
  // b674 - `so_indice=1`: pede ao Mover-Pedidos que responda SO pelo indice EAN dele (cache reverso +
  // indice em disco), sem o ultimo recurso de varrer o Bling (4 filtros x 5 detalhes + 3 caixas de SKU:
  // ~25 chamadas na cota da empresa por codigo desconhecido, e mais de 8 s). Ate o Mover-Pedidos
  // entender o flag ele e ignorado — sem efeito colateral.
  const r = await chamarMoverPedidos('/' + pasta + '/buscar-produto', { q: digitos, so_indice: '1' }, { timeoutMs: (opts && opts.timeoutMs) || 8000 });
  // r2 (Codex #544) - so uma resposta 2xx com JSON { ok:false, erro: "nada encontrado..." } e
  // "o Mover-Pedidos olhou e NAO TEM" (nao_encontrado). Qualquer outra coisa — HTTP de erro
  // mesmo com JSON, 2xx sem JSON (HTML de erro/login), JSON sem produto — e a PONTE que nao
  // esta respondendo direito (ponte_fora): o chamador trata como "nao sei", nunca "nao existe".
  if (!r.ok) {
    if (r.http === 0 && /ponte nao configurada/.test(String(r.erro || ''))) {
      return { ok: false, motivo: 'ponte com o Mover-Pedidos nao configurada (MOVER_PEDIDOS_URL/KEY)', ponte_fora: true };
    }
    const detalheHttp = (r.corpo && r.corpo.ok === false && r.corpo.erro) ? ': ' + String(r.corpo.erro).slice(0, 120) : (r.erro ? ': ' + String(r.erro).slice(0, 120) : '');
    return { ok: false, motivo: 'Mover-Pedidos nao respondeu (' + (r.http || 'sem conexao') + ')' + detalheHttp, ponte_fora: true };
  }
  const corpo = (r.corpo && typeof r.corpo === 'object') ? r.corpo : null;
  if (!corpo) {
    return { ok: false, motivo: 'Mover-Pedidos respondeu sem JSON (' + String(r.cru || '').slice(0, 60).replace(/\s+/g, ' ') + ')', ponte_fora: true };
  }
  if (corpo.ok === false) {
    const erro = String(corpo.erro || '');
    if (/nada encontrado/i.test(erro)) return { ok: false, motivo: 'Mover-Pedidos: ' + erro.slice(0, 120), nao_encontrado: true };
    return { ok: false, motivo: 'Mover-Pedidos recusou: ' + (erro || 'sem motivo').slice(0, 120), ponte_fora: true };
  }
  const p = corpo.produto || null;
  if (!p || !p.sku) {
    return { ok: false, motivo: 'Mover-Pedidos respondeu sem produto pro EAN ' + digitos, ponte_fora: true };
  }
  return {
    ok: true, via: 'mover-pedidos',
    produto: { id: p.id || null, nome: p.nome || '', codigo: String(p.sku), gtin: digitos },
  };
}

// b674 - PING DA PONTE, SEM GASTAR COTA: a sonda da empresa precisa provar "rota + chave" sem
// disparar a busca de verdade (um EAN inexistente mandava o Mover-Pedidos varrer o Bling — ~25
// chamadas na cota da empresa e estouro dos 8 s, visto em producao em 09/11). `q` vazio faz o
// Mover-Pedidos responder 200 { ok:false, erro:'busca vazia' } antes de qualquer consulta: isso e
// a prova. 404 = guard (chave/rota); fora/timeout = fora; qualquer outra coisa = inesperado.
async function pingPonte(chaveEmpresa, opts) {
  let pasta;
  try { pasta = pastaDoCheckout(chaveEmpresa); } catch (e) {
    return { ok: false, motivo: 'empresa fora do registro: ' + String(chaveEmpresa) };
  }
  const r = await chamarMoverPedidos('/' + pasta + '/buscar-produto', { q: '' }, { timeoutMs: (opts && opts.timeoutMs) || 8000 });
  if (!r.ok) {
    if (r.http === 0 && /ponte nao configurada/.test(String(r.erro || ''))) {
      return { ok: false, pasta, motivo: 'ponte com o Mover-Pedidos nao configurada (MOVER_PEDIDOS_URL/KEY)', ponte_fora: true };
    }
    return { ok: false, pasta, motivo: 'Mover-Pedidos nao respondeu (' + (r.http || 'sem conexao') + ')' + (r.erro ? ': ' + String(r.erro).slice(0, 120) : ''), ponte_fora: true };
  }
  const corpo = (r.corpo && typeof r.corpo === 'object') ? r.corpo : null;
  if (corpo && corpo.ok === false && /busca vazia/i.test(String(corpo.erro || ''))) {
    return { ok: true, pasta, detalhe: 'rota e chave conferidas (respondeu "busca vazia" ao ping)' };
  }
  return { ok: false, pasta, motivo: 'resposta inesperada ao ping: ' + (corpo ? JSON.stringify(corpo).slice(0, 100) : String(r.cru || '').slice(0, 60).replace(/\s+/g, ' ')), ponte_fora: true };
}

module.exports = { produtoPorEanNoMoverPedidos, pastaDoCheckout, pingPonte };
