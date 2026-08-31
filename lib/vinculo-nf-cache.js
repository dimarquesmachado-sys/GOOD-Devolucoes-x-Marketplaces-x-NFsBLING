// lib/vinculo-nf-cache.js
//
// PECA UNICA pro vinculo "caso -> NF no Bling".
//
// POR QUE ISTO EXISTE: a rota do card re-buscava a NF de TODOS os casos a
// cada carregamento, contra um orcamento de ~10s. Com 26 casos e o limite de
// 3 req/s do Bling, nunca dava tempo — e o painel atualiza a cada 4 minutos,
// entao o trabalho era jogado fora e refeito, sempre incompleto.
//
// Mas o vinculo e ESTAVEL: a NF de um pedido de janeiro nao muda. Guardar o
// que ja foi achado transforma o problema de "achar 26 em 10s" em "achar os
// que faltam", e em dois ou tres refreshes todos estao vinculados.
//
// Nao usa coluna nova: vive na memoria do servidor, que fica de pe entre os
// requests. Se o servico reiniciar, ele reaprende — custa alguns refreshes,
// nao correcao manual.

const CACHE = new Map();
const TTL_MS = 12 * 60 * 60 * 1000;   // 12h: a NF nao muda, mas nao guardo pra sempre
const TETO = 5000;                     // memoria limitada; o excedente sai pelo mais antigo

/** A chave do cache: o que identifica o caso de forma estavel. */
function chaveDe(item) {
  if (!item) return null;
  const chave = String(item.nf_chave || '').replace(/\D/g, '');
  if (chave.length === 44) return 'chave:' + chave;
  if (item.nf_numero) return 'num:' + String(item.nf_numero).replace(/^0+/, '');
  if (item.pedido) return 'ped:' + String(item.pedido);
  return null;
}

/** Devolve o vinculo guardado, ou null. */
function ler(item) {
  const k = chaveDe(item);
  if (!k) return null;
  const v = CACHE.get(k);
  if (!v) return null;
  if (Date.now() - v.em > TTL_MS) { CACHE.delete(k); return null; }
  return v;
}

/**
 * Guarda o vinculo achado.
 * `via` conta por qual caminho veio — a tela mostra isso pro dono conferir.
 */
function guardar(item, idBling, via, extras = {}) {
  const k = chaveDe(item);
  if (!k || !idBling) return;
  if (CACHE.size >= TETO) {
    const primeiro = CACHE.keys().next().value;
    if (primeiro) CACHE.delete(primeiro);
  }
  CACHE.set(k, { id: String(idBling), via: via || null, em: Date.now(), ...extras });
}

/**
 * Aplica o que ja foi achado antes, e devolve quem ainda falta.
 * A rota so gasta orcamento com os que faltam.
 */
function aplicar(itens) {
  const faltam = [];
  for (const item of (itens || [])) {
    if (item.nf_id_bling) continue;
    const v = ler(item);
    if (v) {
      item.nf_id_bling = v.id;
      if (!item.nf_chave && v.chave) item.nf_chave = v.chave;
      if (!item.nf_numero && v.numero) item.nf_numero = v.numero;
      item.nf_achada_por = v.via || 'cache';
    } else {
      faltam.push(item);
    }
  }
  return faltam;
}

/** Pro diagnostico: quantos vinculos estao guardados. */
function estado() {
  return { guardados: CACHE.size, ttl_horas: TTL_MS / 3600000, teto: TETO };
}

module.exports = { chaveDe, ler, guardar, aplicar, estado, _CACHE: CACHE };
