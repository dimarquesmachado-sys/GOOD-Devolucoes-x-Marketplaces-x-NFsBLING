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

/**
 * A chave do cache.
 *
 * b204.1 (Codex): DUAS correcoes que vieram juntas.
 *
 * 1. NAMESPACE POR EMPRESA. O server da GOOD monta o router da AMB no mesmo
 *    processo, entao os dois compartilham este Map — mas autenticam em
 *    CONTAS BLING diferentes. Sem o prefixo, um `num:65999` da AMB seria
 *    servido pra GOOD, e o dono geraria devolucao contra a nota de outra
 *    empresa.
 *
 * 2. IDENTIDADE ESTAVEL. A chave tem que ser a mesma na hora de GUARDAR e
 *    na de LER. Se eu guardasse por `chave:` depois de enriquecer o item, o
 *    refresh seguinte — que le a linha crua do banco, ainda sem chave —
 *    procuraria por `num:` ou `ped:` e nunca acharia. Por isso a identidade
 *    e calculada ANTES do enriquecimento e viaja junto.
 */
function chaveDe(item, empresa) {
  if (!item) return null;
  const emp = String(empresa || item.empresa || 'x').toLowerCase();
  const chave = String(item.nf_chave || '').replace(/\D/g, '');
  if (chave.length === 44) return emp + '|chave:' + chave;
  if (item.nf_numero) return emp + '|num:' + String(item.nf_numero).replace(/^0+/, '');
  if (item.pedido) return emp + '|ped:' + String(item.pedido);
  return null;
}

/** Devolve o vinculo guardado, ou null. */
function ler(item, empresa) {
  const k = chaveDe(item, empresa);
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
function guardar(item, idBling, via, extras = {}, empresa, chaveOriginal) {
  // b204.1: a identidade de ANTES do enriquecimento, quando fornecida
  const k = chaveOriginal || chaveDe(item, empresa);
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
function aplicar(itens, empresa) {
  const faltam = [];
  for (const item of (itens || [])) {
    if (item.nf_id_bling) continue;
    const v = ler(item, empresa);
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

// ── b204.4 (Codex): RODIZIO pros que nao resolvem ───────────────────
//
// Sem isto, um caso que falha SEMPRE (nota cancelada, serie divergente,
// pedido que nao existe) ocupa uma das 25 vagas em todo refresh — e os
// casos depois da posicao 25 nunca sao tentados. O painel fica preso nos
// mesmos primeiros pra sempre.
//
// Guardo a tentativa que falhou com um prazo curto: ela sai da frente por
// uns minutos e deixa outros passarem, mas volta a ser tentada depois —
// nao e desistencia, e revezamento.
const FALHAS = new Map();
const ESPERA_FALHA_MS = 20 * 60 * 1000;   // 20 min ate tentar de novo

function marcarFalha(item, empresa) {
  const k = chaveDe(item, empresa);
  if (!k) return;
  if (FALHAS.size >= TETO) {
    const primeiro = FALHAS.keys().next().value;
    if (primeiro) FALHAS.delete(primeiro);
  }
  FALHAS.set(k, Date.now());
}

/** true = tentou ha pouco e falhou; deixa outro passar nesta rodada. */
function esperando(item, empresa) {
  const k = chaveDe(item, empresa);
  if (!k) return false;
  const em = FALHAS.get(k);
  if (!em) return false;
  if (Date.now() - em > ESPERA_FALHA_MS) { FALHAS.delete(k); return false; }
  return true;
}

/**
 * A fila da vez: tira o que ja resolveu, adia o que falhou ha pouco.
 * O `teto` continua valendo — o que muda e QUEM ocupa as vagas.
 */
function fila(itens, empresa, teto, filtro) {
  return (itens || [])
    .filter((x) => !x.nf_id_bling && (!filtro || filtro(x)) && !esperando(x, empresa))
    .slice(0, teto);
}

module.exports = { chaveDe, ler, guardar, aplicar, estado, fila, marcarFalha, esperando, _CACHE: CACHE };
