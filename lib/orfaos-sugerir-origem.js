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

// ⚠️ b467 - A GIRASSOL TEM METADE DO CATALOGO EM VARIACAO/KIT. A Shopee (e o
// ML, pelo seller_sku) informam o SKU do PAI ("10-AE-8F-180mm-PAI"); o card
// orfao tem o da VARIACAO ("10-AE-8f-g80-180mm", com o grao). Exato nao casa.
// Dois casamentos a mais, mais fracos e marcados como tal:
//  - raiz do SKU: tiro os tokens de variacao (grao "g80"/"g800", "PAI",
//    cor/voltagem) e comparo o que sobra;
//  - titulo: os primeiros 40 caracteres do titulo normalizado (sem "GRAO:800"
//    no fim, sem acento, sem pontuacao).
const TOKENS_VARIACAO = /^(G\d{1,4}|PAI|P|M|G|GG|\d{3}V|110V|220V|BIVOLT|PRETO|BRANCO|AZUL|VERMELHO|AMARELO)$/;
function raizSku(s) {
  const n = normSku(s);
  if (!n) return '';
  return n.split(/[-_]/).filter((t) => t && !TOKENS_VARIACAO.test(t)).join('-');
}
function normTitulo(t) {
  return String(t || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\bGRAO\s*:?\s*\d+\b/g, '')        // "GRAO:800" / "GRAO 80"
    .replace(/[^A-Z0-9]+/g, ' ')
    // quantidade de kit ("10 X", "KIT COM 4", "12 PECAS") sai; numero solto que
    // e medida/modelo ("5 Polegadas", "Modelo 7") FICA e e comparado
    .replace(/\b\d+ X\b/g, ' ')
    .replace(/\bKIT (COM )?\d+\b/g, ' ')
    .replace(/\b\d+ (PECAS|PCS|UN|UNIDADES|PAR|PARES)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// Casamento por titulo = PALAVRAS EM COMUM (Jaccard), nao prefixo: "Par
// Laminas Faca 82mm..." e "4 x Laminas Faca 82mm..." diferem no comeco e sao
// o mesmo produto em kits diferentes. Limiar alto (0,75) pra NAO casar "10 X
// Lixas Disco Grao 7 Polegadas 180mm" (lisa) com "10 X Lixas Disco
// Anti-Empastamento 7 Polegadas 180mm" — essas dao ~0,67 e sao produtos
// diferentes. Palavras de 1-2 letras e quantidades de kit ("4 x", "KIT COM 4",
// "PAR") ficam de fora; numero solto de medida ("5 Polegadas") fica.
const PALAVRAS_DE_KIT = new Set(['X', 'PAR', 'KIT', 'PECAS', 'PCS', 'UN', 'UNIDADES']);
function palavrasTitulo(t) {
  return new Set(normTitulo(t).split(' ').filter((w) => (w.length >= 3 || /\d/.test(w)) && !PALAVRAS_DE_KIT.has(w)));
}
function tituloCasa(a, b) {
  const x = palavrasTitulo(a), y = palavrasTitulo(b);
  if (x.size < 3 || y.size < 3) return false;
  // ⚠️ MEDIDA NAO BATEU = NAO E O MESMO PRODUTO. "180MM" x "125MM", "82MM" x
  // "102MM", "M14" x "M10": toda palavra com digito (medida, modelo) que um
  // titulo tem e o outro nao, derruba — senao "7 Polegadas 180mm" casava com
  // "5 Polegadas 125mm" por ter 10 palavras iguais em 12.
  const medidas = (set) => [...set].filter((w) => /\d/.test(w));
  for (const m of medidas(x)) if (!y.has(m)) return false;
  for (const m of medidas(y)) if (!x.has(m)) return false;
  let comuns = 0;
  for (const w of x) if (y.has(w)) comuns++;
  const uniao = x.size + y.size - comuns;
  return uniao > 0 && (comuns / uniao) >= 0.75;
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
const FORCA = { sku: 0, sku_pai: 1, titulo: 2 };

function sugerirOrigem(cards, aCaminho, opcoes = {}) {
  const jaTriado = typeof opcoes.jaTriado === 'function' ? opcoes.jaTriado : () => false;
  const lista = (Array.isArray(aCaminho) ? aCaminho : []).filter(Boolean);
  const orfaos = (Array.isArray(cards) ? cards : []).filter(ehOrfao);
  const saida = orfaos.map((card) => {
    const alvo = normSku(card.produto_sku);
    const alvoRaiz = raizSku(card.produto_sku);
    const comoCasa = (it) => {
      if (alvo && skusDoItem(it).has(alvo)) return 'sku';
      if (alvoRaiz && [...skusDoItem(it)].some((k) => raizSku(k) === alvoRaiz)) return 'sku_pai';
      const titulos = [it.titulo, it.produto_titulo, it.produto, ...(Array.isArray(it.itens) ? it.itens.map((i) => i && i.titulo) : [])];
      if (card.produto_titulo && titulos.some((t) => tituloCasa(card.produto_titulo, t))) return 'titulo';
      return null;
    };
    const candidatos = (!alvo && !card.produto_titulo) ? [] : lista
      .map((it) => ({ it, via: comoCasa(it) }))
      .filter((x) => x.via)
      .map(({ it, via }) => {
        // so procura por SKU quando ha SKU (alvo vazio casaria o 1o item sem SKU)
        const itemCasado = Array.isArray(it.itens)
          ? ((alvo && it.itens.find((i) => i && normSku(i.sku) === alvo))
            || (alvoRaiz && it.itens.find((i) => i && raizSku(i.sku) === alvoRaiz))
            || (card.produto_titulo && it.itens.find((i) => i && tituloCasa(card.produto_titulo, i.titulo)))
            || null)
          : null;
        return {
          via,
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
      // os ainda NAO triados primeiro; depois a forca do casamento (sku > pai >
      // titulo); por fim, os que batem a quantidade
      .sort((a, b) => (a.ja_triado - b.ja_triado)
        || (FORCA[a.via] - FORCA[b.via])
        || ((b.qtd_bate === true) - (a.qtd_bate === true)));
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
          : 'mais de um candidato: confira cliente e data antes de escolher; depois exclua este card e tria pelo rastreio certo')
          + (candidatos.some((c) => c.via !== 'sku') ? ' (via = como casou: sku e exato; sku_pai e titulo sao aproximados — confira)' : ''),
    };
  });
  return {
    orfaos: saida,
    total_orfaos: saida.length,
    sem_candidato: saida.filter((x) => x.candidatos.length === 0).length,
  };
}

module.exports = { sugerirOrigem, ehOrfao, skusDoItem, normSku, raizSku, normTitulo, tituloCasa, palavrasTitulo, CAMPOS_ORIGEM };
