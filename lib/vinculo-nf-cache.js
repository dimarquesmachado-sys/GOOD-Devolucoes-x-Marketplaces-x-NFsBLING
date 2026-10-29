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

  // b204.8 (Codex): o NUMERO sozinho nao identifica — ele se repete entre
  // series dentro da MESMA conta Bling. Dois casos com o mesmo numero e
  // pedidos diferentes compartilhariam o vinculo, e o segundo herdaria a
  // nota do primeiro. Quando ha pedido, ele entra na chave.
  if (item.nf_numero) {
    const num = String(item.nf_numero).replace(/^0+/, '');
    return emp + '|num:' + num + (item.pedido ? '@' + String(item.pedido) : '');
  }
  if (item.pedido) return emp + '|ped:' + String(item.pedido);
  return null;
}

/** Devolve o vinculo guardado, ou null. */
function ler(item, empresa) {
  const k = chaveDe(item, empresa);
  if (!k) return null;
  const v = CACHE.get(k);
  if (!v) return null;
  if (!v.permanente && Date.now() - v.em > TTL_MS) { CACHE.delete(k); return null; }   // 29/10: pela chave nao expira
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
  const permanente = via === 'chave' && /\|chave:\d{44}$/.test(k);
  CACHE.set(k, { id: String(idBling), via: via || null, em: Date.now(), ...extras, ...(permanente ? { permanente: true } : {}) });
  if (permanente) agendarSalvar(k.split('|')[0]);
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
      // b221.3 (Codex): so SOBRESCREVE quando o numero veio da NOTA, nao do
      // item. A fase da chave grava o numero que o Bling devolveu (autoridade);
      // as outras gravam `item.nf_numero`, que pode ser o capturado errado —
      // e ai sobrescrever perpetuaria o erro em vez de corrigir.
      if (v.numero && v.via === 'chave') item.nf_numero = v.numero;
      else if (v.numero && !item.nf_numero) item.nf_numero = v.numero;
      // b216 (Codex): a SERIE volta junto. Sem ela, no refresh seguinte o
      // aviso de Full sumia — a chave continua vazia e nao da pra deduzir.
      if (!item.nf_serie && v.serie) item.nf_serie = v.serie;
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

/**
 * b204.6 (Codex): so o "procurei e NAO EXISTE" adia o item.
 *
 * Erro do Bling (429, 500) ou prazo estourado nao sao resposta — sao
 * ausencia de resposta. Tratar como miss poe o caso na geladeira por 20
 * min por causa de uma instabilidade de segundos, e o dono fica sem o
 * botao esse tempo todo sem entender por que.
 */
/**
 * b221.3 (Codex): adia POUCO uma falha transitoria.
 *
 * Erro do Bling e prazo estourado NAO entram no `marcarFalha` (esfriar 20min
 * por instabilidade seria injusto). Mas sem marca nenhuma, a fila pega os
 * MESMOS primeiros itens em todo refresh — e se eles estao lentos, gastam o
 * orcamento inteiro e o resto nunca e tentado. Um timeout custa 4s; com 6s
 * de teto, so 1 ou 2 itens por rodada, sempre os mesmos.
 *
 * Aqui e 2 min: tempo de dar a vez a outro, sem punir o item.
 */
function adiarPouco(item, empresa, fase) {
  const base = chaveDe(item, empresa);
  if (!base) return;
  const k = (fase ? fase + '|' : '') + base;
  if (FALHAS.size >= TETO) {
    const primeiro = FALHAS.keys().next().value;
    if (primeiro) FALHAS.delete(primeiro);
  }
  // guardo um "em" no FUTURO-negativo: vence em 2 min em vez de 20
  FALHAS.set(k, Date.now() - ESPERA_FALHA_MS + 2 * 60 * 1000);
}

function marcarFalha(item, empresa, fase) {
  // b204.7 (Codex): a marca e POR FASE.
  //
  // Sem isso, um numero velho que nunca acha bloqueava tambem a busca por
  // PEDIDO do mesmo item — e o pedido era justamente a saida que restava.
  // Cada caminho registra a sua tentativa; falhar num nao fecha o outro.
  const k = (fase ? fase + '|' : '') + chaveDe(item, empresa);
  if (!chaveDe(item, empresa)) return;
  if (FALHAS.size >= TETO) {
    const primeiro = FALHAS.keys().next().value;
    if (primeiro) FALHAS.delete(primeiro);
  }
  FALHAS.set(k, Date.now());
}

/** true = tentou ha pouco e falhou; deixa outro passar nesta rodada. */
function esperando(item, empresa, fase) {
  const base = chaveDe(item, empresa);
  if (!base) return false;
  const k = (fase ? fase + '|' : '') + base;
  const em = FALHAS.get(k);
  if (!em) return false;
  if (Date.now() - em > ESPERA_FALHA_MS) { FALHAS.delete(k); return false; }
  return true;
}

/**
 * A fila da vez: tira o que ja resolveu, adia o que falhou ha pouco.
 * O `teto` continua valendo — o que muda e QUEM ocupa as vagas.
 */
function fila(itens, empresa, teto, filtro, fase) {
  return (itens || [])
    .filter((x) => !x.nf_id_bling && (!filtro || filtro(x)) && !esperando(x, empresa, fase))
    .slice(0, teto);
}

// ===== 29/10 — VINCULO PELA CHAVE: PERMANENTE E COMPLETADO EM SEGUNDO PLANO =====
// Dono, 29/10: nas estornadas da GOOD, 16 das 25 notas da Magalu apareciam 'NF ... nao localizada no Bling' — e a
// nota EXISTE (serie 001, emitida pela propria GOOD; a busca direta pela chave acha em 1 chamada). Causa: o vinculo
// era feito NA ABERTURA do painel, com teto de 6s (uns 3 cards por abertura, do mais antigo ao mais novo), e o que
// era achado ficava so na MEMORIA por 12h — todo deploy apagava e recomecava do zero.
// (1) PERMANENTE: a nota de uma chave nunca muda. Vinculo pela chave nao expira e vai pro ARMAZEM PRIVADO dos
//     indices (Supabase Storage, um arquivo por empresa) — deploy nao apaga. Os outros caminhos seguem como antes.
// (2) SEGUNDO PLANO: o que a abertura nao alcancou entra numa fila que continua DEPOIS da resposta, um por vez,
//     com pausa — a proxima abertura ja vem vinculada. Uma fila por empresa por vez.
// (3) O card na fila leva nf_vinculo_pendente: a tela diz 'procurando', nao 'nao localizada'.
const NOME_ARQ_VINCULOS = 'vinculos-nf-chave';
const ARMAZENS = new Map();   // empresa -> { armazem, carregado, timer }
async function ligarArmazem(empresa, armazem) {
  const emp = String(empresa || '').toLowerCase();
  if (!emp || !armazem || typeof armazem.carregar !== 'function') return { ok: false };
  const st = { armazem, carregado: false, timer: null };
  ARMAZENS.set(emp, st);
  let n = 0;
  try {
    const obj = await armazem.carregar(NOME_ARQ_VINCULOS);
    const v = (obj && typeof obj === 'object' && obj.v && typeof obj.v === 'object') ? obj.v : {};
    for (const [k, x] of Object.entries(v)) {
      if (!k.startsWith(emp + '|chave:') || !x || !x.id || CACHE.has(k)) continue;
      CACHE.set(k, { id: String(x.id), via: 'chave', em: Date.now(), numero: x.numero || null, serie: x.serie || null, chave: x.chave || null, permanente: true });
      n++;
    }
  } catch (e) { /* sem armazem: segue so com a memoria, como antes */ }
  st.carregado = true;
  return { ok: true, carregados: n };
}
function agendarSalvar(emp) {
  const st = ARMAZENS.get(emp);
  if (!st || !st.carregado || st.timer) return;   // antes de carregar, salvar apagaria o que ja estava guardado
  st.timer = setTimeout(async () => {
    st.timer = null;
    try {
      // soma com o que esta no armazem (outra subida pode ter gravado) — nunca encolhe por engano
      const atual = await st.armazem.carregar(NOME_ARQ_VINCULOS).catch(() => null);
      const v = (atual && atual.v && typeof atual.v === 'object') ? { ...atual.v } : {};
      for (const [k, x] of CACHE) {
        if (k.startsWith(emp + '|chave:') && x.permanente) v[k] = { id: x.id, numero: x.numero || null, serie: x.serie || null, chave: x.chave || null };
      }
      await st.armazem.salvar(NOME_ARQ_VINCULOS, { v, salvo_em: new Date().toISOString() });
    } catch (e) { /* tenta na proxima gravacao */ }
  }, 5000);
  if (st.timer && st.timer.unref) st.timer.unref();
}
const FUNDO = new Map();   // empresa -> promessa da fila em andamento
// buscar(chave, { cancelar }) -> { match: { id, numero } } | { ok, via: 'chave-nao-achou' | 'chave-nota-morta' } | outro
function completarChaveEmFundo(itens, empresa, buscar, opcoes = {}) {
  const emp = String(empresa || '').toLowerCase();
  if (!emp || typeof buscar !== 'function') return { iniciada: false, pendentes: 0 };
  const temChave = (x) => String((x && x.nf_chave) || '').replace(/\D/g, '').length === 44;
  const pend = (itens || []).filter((x) => x && !x.nf_id_bling && temChave(x) && !ler(x, empresa) && !esperando(x, empresa, 'chave'))
    .slice(0, opcoes.teto || 80);
  for (const x of pend) x.nf_vinculo_pendente = true;   // a resposta desta abertura ja diz 'procurando'
  if (!pend.length || FUNDO.has(emp)) return { iniciada: false, pendentes: pend.length };
  const tempoMs = opcoes.tempoMs || 20000, pausaMs = opcoes.pausaMs || 600;
  const p = (async () => {
    for (const item of pend) {
      if (ler(item, empresa) || esperando(item, empresa, 'chave')) continue;
      const idCache = chaveDe(item, empresa);
      try {
        const cancelar = {};
        const r = await Promise.race([
          buscar(item.nf_chave, { cancelar }),
          new Promise((ok) => { const t = setTimeout(() => { cancelar.agora = true; ok(null); }, tempoMs); if (t.unref) t.unref(); }),
        ]);
        if (r && r.match && r.match.id) {
          guardar(item, String(r.match.id), 'chave', {
            chave: String(item.nf_chave).replace(/\D/g, ''),
            numero: r.match.numero ? String(r.match.numero) : (item.nf_numero || null),
            serie: item.nf_serie || null,
          }, empresa, idCache);
        } else if (r && r.ok !== false && (r.via === 'chave-nao-achou' || r.via === 'chave-nota-morta')) {
          marcarFalha(item, empresa, 'chave');   // resposta conclusiva: esfria como na abertura
        }   // 'nao sei' (rede, 429, timeout): nao marca — a proxima abertura tenta de novo
      } catch (e) { /* idem */ }
      await new Promise((ok) => setTimeout(ok, pausaMs));
    }
  })().finally(() => FUNDO.delete(emp));
  FUNDO.set(emp, p);
  return { iniciada: true, pendentes: pend.length, promessa: p };
}
module.exports = { chaveDe, ler, guardar, aplicar, estado, fila, marcarFalha, adiarPouco, esperando, _CACHE: CACHE,
  ligarArmazem, completarChaveEmFundo };
