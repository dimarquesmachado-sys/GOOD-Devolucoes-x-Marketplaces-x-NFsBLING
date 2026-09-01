// lib/confrontar-nf.js
//
// DECIDE se uma NF do Bling e mesmo a do caso — e, quando nao da pra
// decidir sozinho, entrega as candidatas pro dono escolher.
//
// [stated] "tipo uma 2a verificação o nome do cliente? se não, deixa as NFs
// iguais q eu seleciono. ou checar ainda, de qual marketplace tá vindo a
// venda, e confrontar isso tb."
//
// As tres ideias dele viraram uma escada, da mais forte pra mais fraca:
//
//   1. CHAVE completa — exata, nao ha o que discutir
//   2. SERIE + numero — a serie ja vem na chave (o caso da NF 637: serie 001
//      no card, serie 003 no Bling, notas diferentes com o mesmo numero)
//   3. MARKETPLACE de origem — a NF do Bling traz "Origem loja virtual"
//      (TikTok, MagaluOpenApi). Desempate forte e quase sempre presente
//   4. CLIENTE — util quando ha, mas vem null em muito caso capturado,
//      entao nao serve como chave principal
//
// Se nada decide, NAO CHUTO: devolvo as candidatas com o que cada uma tem,
// e o card deixa o dono escolher. Chutar aqui significa gerar devolucao
// contra a venda errada.

/** A serie mora nas posicoes 22-24 da chave de 44 digitos. */
function serieDaChave(chave) {
  const d = String(chave || '').replace(/\D/g, '');
  return d.length === 44 ? d.slice(22, 25) : null;
}

function normalizar(txt) {
  return String(txt || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // tira acento
    .replace(/[^a-z0-9]/g, '');
}

/** O marketplace que a NF do Bling declara, normalizado pro nosso vocabulario. */
function marketplaceDaNF(nf) {
  const bruto = normalizar((nf && (nf.loja || nf.nomeLoja || nf.origemLojaVirtual
    || (nf.lojaVirtual && nf.lojaVirtual.nome))) || '');
  if (!bruto) return null;
  if (bruto.includes('tiktok')) return 'tiktok';
  if (bruto.includes('magalu') || bruto.includes('magazine')) return 'magalu';
  if (bruto.includes('shopee')) return 'shopee';
  if (bruto.includes('mercado') || bruto.includes('meli')) return 'mercadolivre';
  if (bruto.includes('amazon')) return 'amazon';
  return bruto.slice(0, 20);
}

/**
 * Avalia UMA candidata contra o caso.
 * Devolve o que bateu, o que divergiu, e se isso basta pra decidir.
 */
function avaliar(item, nf) {
  const bate = [];
  const diverge = [];

  const chaveItem = String((item && item.nf_chave) || '').replace(/\D/g, '');
  const chaveNF = String((nf && nf.chaveAcesso) || '').replace(/\D/g, '');
  if (chaveItem.length === 44 && chaveNF.length === 44) {
    (chaveItem === chaveNF ? bate : diverge).push('chave');
  } else if (chaveItem.length === 44 && chaveNF.length !== 44) {
    // a listagem pode omitir a chave; nao conta nem a favor nem contra
  }

  const sItem = serieDaChave(chaveItem);
  const sNF = serieDaChave(chaveNF) || (nf && nf.serie != null
    ? String(nf.serie).padStart(3, '0') : null);
  if (sItem && sNF) (sItem === sNF ? bate : diverge).push('serie');

  const mItem = normalizar(item && item.marketplace);
  const mNF = marketplaceDaNF(nf);
  if (mItem && mNF) (mItem === normalizar(mNF) ? bate : diverge).push('marketplace');

  const cItem = normalizar(item && item.cliente);
  const cNF = normalizar((nf && (nf.contato && nf.contato.nome)) || (nf && nf.cliente));
  if (cItem && cNF) {
    // nome de marketplace vem truncado e com variacao; comparo por prefixo
    const menor = Math.min(cItem.length, cNF.length);
    const igual = menor >= 6 && cItem.slice(0, menor) === cNF.slice(0, menor);
    (igual ? bate : diverge).push('cliente');
  }

  return {
    bate,
    diverge,
    // chave batendo decide sozinha; senao preciso de 2 sinais e nenhum contra
    decide: bate.includes('chave') || (bate.length >= 2 && diverge.length === 0),
    recusa: diverge.includes('chave') || diverge.includes('serie'),
  };
}

/**
 * Escolhe entre as candidatas.
 *  - uma decide  -> { escolhida }
 *  - nenhuma decide, mas sobram viaveis -> { candidatas } pro dono escolher
 *  - todas recusadas -> { nenhuma: true }
 */
function escolher(item, candidatas) {
  const avaliadas = (candidatas || [])
    .map((nf) => ({ nf, ...avaliar(item, nf) }))
    .filter((a) => !a.recusa);

  if (!avaliadas.length) return { nenhuma: true, candidatas: [] };

  const decisivas = avaliadas.filter((a) => a.decide);
  if (decisivas.length === 1) return { escolhida: decisivas[0].nf, por: decisivas[0].bate };

  // uma so viavel, mesmo sem 2 sinais: melhor que nada, mas marco como fraca
  if (avaliadas.length === 1) {
    return { escolhida: avaliadas[0].nf, por: avaliadas[0].bate, fraca: true };
  }

  // ambiguo de verdade — o dono decide
  return {
    candidatas: avaliadas.map((a) => ({
      id: a.nf.id,
      numero: a.nf.numero,
      serie: serieDaChave(a.nf.chaveAcesso) || (a.nf.serie != null ? String(a.nf.serie) : null),
      data: a.nf.dataEmissao || a.nf.data || null,
      cliente: (a.nf.contato && a.nf.contato.nome) || a.nf.cliente || null,
      marketplace: marketplaceDaNF(a.nf),
      bate: a.bate,
    })),
  };
}

// ── b209: a SERIE diz se a nota e nossa ou do FULL ──────────────────
//
// [stated] "na good vai ter série 2 pra MercadoLivre Full. tb tem amazon
// FULL, e Magalu FULL em outras series"
//
// Serie 1 = emissao propria. Cada fulfillment tem a sua. Isso explica o
// caso da NF 637 da AMB: serie 001 (mai/26, nossa) e serie 003 (ago/26,
// Full) sao notas DISTINTAS — a numeracao reinicia por serie.
//
// ⚠️ E tem peso fiscal: nota de serie Full foi emitida pelo MARKETPLACE,
// nao por nos. A devolucao contra ela nao e a mesma coisa.
//
// O mapa fica aqui pra ser completado quando ele passar os numeros de cada
// Full. Ate la, a regra generica ja serve: serie != 1 e fulfillment.
const SERIE_CANAL = {
  good: { 1: 'propria', 2: 'mercadolivre-full' },
  amb: { 1: 'propria', 3: 'full' },
  // girassol: quando plugar, medir antes de escrever
};

/** O canal que a serie indica; null quando nao sabemos. */
function canalDaSerie(serie, empresa) {
  const n = parseInt(String(serie || '').replace(/^0+/, ''), 10);
  if (!Number.isFinite(n)) return null;
  const mapa = SERIE_CANAL[String(empresa || '').toLowerCase()];
  if (mapa && mapa[n]) return mapa[n];
  return n === 1 ? 'propria' : 'full-desconhecido';
}

/** true = a nota foi emitida pelo marketplace no fulfillment, nao por nos. */
function ehDoFull(serie, empresa) {
  const c = canalDaSerie(serie, empresa);
  return !!c && c !== 'propria';
}

module.exports = { serieDaChave, marketplaceDaNF, avaliar, escolher, normalizar,
  canalDaSerie, ehDoFull, SERIE_CANAL };
