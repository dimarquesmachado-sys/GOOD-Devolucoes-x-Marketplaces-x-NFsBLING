// ============================================================
// amb-devolucoes/lib-AMB/nf-nomes-AMB.js       (AMB Devol. b4)
// ------------------------------------------------------------
// O PEGA-TUDO: acha a venda pelo NOME DO REMETENTE da etiqueta.
//
// POR QUE ISTO E ESSENCIAL NA AMBTOTAL: ela vende no TikTok Shop,
// que nao tem integracao aqui — e a Amazon comeca em breve. Uma
// caixa desses canais chega no galpao com etiqueta dos Correios e
// NENHUM identificador que o sistema conheca. O unico dado util e
// o nome do cliente impresso no bloco REMETENTE.
//
// O TRUQUE: a etiqueta imprime o nome COLADO ("IANDRAMATIASRIBEIRO").
// Nao da pra separar de volta. Da pra fazer o contrario: COLAPSAR
// tambem o nome que vem do Bling e comparar colapsado com colapsado.
// Match deterministico, sem adivinhacao.
//
// A busca devolve CANDIDATOS. Quem decide e sempre o estoquista,
// conferindo com a caixa na mao — o sistema nunca escolhe sozinho.
//
// ============================================================
// MELHORIA SOBRE A GOOD (pendencia conhecida de la):
// na GOOD, o match exige substring CONTINUA. Entao "MARILIAVEIGA"
// (como sai na etiqueta) NAO acha "Marilia Goncalves De Sousa
// Veiga" — porque no nome completo tem "GONCALVESDESOUSA" no meio.
// Aqui o indice guarda TAMBEM a combinacao primeiro+ultimo nome,
// que e exatamente como a maioria das etiquetas abrevia.
// ============================================================

'use strict';

const cfg = require('../config-AMB');
const bling = require('./bling-AMB');

const IDX = {
  ts: 0,
  mapa: {},        // nome completo colapsado -> [NFs]
  mapaCurto: {},   // primeiro+ultimo nome colapsado -> [NFs]
  totalNFs: 0, nomes: 0, duracaoSeg: 0, erro: null,
};

let construindo = false;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Tira acento, pontuacao e espaco. Sobram so letras maiusculas. */
const colapsar = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z]/g, '');

/**
 * "Marilia Goncalves De Sousa Veiga" -> "MARILIAVEIGA"
 * Ignora as particulas (de, da, dos...) na hora de achar o sobrenome.
 */
const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
function primeiroUltimo(nomeCompleto) {
  const partes = String(nomeCompleto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().split(/\s+/)
    .map(p => p.replace(/[^A-Z]/g, ''))
    .filter(p => p.length > 0 && !PARTICULAS.has(p));
  if (partes.length < 2) return null;
  return partes[0] + partes[partes.length - 1];
}

async function construirIndice(opts = {}) {
  if (construindo) return { ...IDX, jaEmAndamento: true };
  construindo = true;
  const t0 = Date.now();

  try {
    const dias = opts.dias || Number(process.env.AMB_NF_JANELA_DIAS || 120);
    const maxPaginas = opts.maxPaginas || 80;      // teto: 80x100 = 8000 NFs
    const corte = Date.now() - dias * 864e5;
    const mapa = {};
    const mapaCurto = {};
    let totalNFs = 0, erroBusca = null, parouPorData = false;

    // A listagem do Bling vem naturalmente da mais nova pra mais
    // velha. Nao usamos filtro de data de proposito: o Bling anexa a
    // hora atual na data e o filtro de mesmo dia sempre volta zero.
    // Paginamos e cortamos pela data no nosso lado.
    for (let pg = 1; pg <= maxPaginas; pg++) {
      const r = await bling.chamarBling(`/nfe?limite=100&pagina=${pg}&tipo=1`);
      if (!r.ok) { erroBusca = `nfe pagina ${pg} HTTP ${r.status}`; break; }

      const lista = (r.data && r.data.data) || [];
      if (lista.length === 0) break;

      for (const nf of lista) {
        const quando = Date.parse(String(nf.dataEmissao || '').replace(' ', 'T'));
        if (quando && quando < corte) { parouPorData = true; break; }

        const nomeOriginal = (nf.contato && nf.contato.nome) || '';
        const chave = colapsar(nomeOriginal);
        if (!chave || chave.length < 5) continue;

        const registro = {
          id: String(nf.id),
          numero: String(nf.numero || ''),
          serie: String(nf.serie || ''),
          nome: nomeOriginal,
          dataEmissao: nf.dataEmissao || null,
          valor: nf.valorNota != null ? nf.valorNota : null,
        };

        (mapa[chave] = mapa[chave] || []).push(registro);

        // indice extra: primeiro+ultimo nome
        const curto = primeiroUltimo(nomeOriginal);
        if (curto && curto.length >= 5 && curto !== chave) {
          (mapaCurto[curto] = mapaCurto[curto] || []).push(registro);
        }

        totalNFs++;
      }

      if (parouPorData || lista.length < 100) break;
      await sleep(cfg.bling.pausaMs / 2);   // respeita o rate limit do Bling
    }

    // Mesma regra do indice do ML: se falhou e nao veio nada, nao
    // marca como quente — o proximo bipe tenta de novo em vez de
    // confiar num indice vazio por 30 minutos.
    const falhouGeral = !!erroBusca && totalNFs === 0;
    IDX.ts = falhouGeral ? 0 : Date.now();
    IDX.mapa = mapa;
    IDX.mapaCurto = mapaCurto;
    IDX.totalNFs = totalNFs;
    IDX.nomes = Object.keys(mapa).length;
    IDX.duracaoSeg = Math.round((Date.now() - t0) / 1000);
    IDX.erro = erroBusca;

    console.log(`[AMB/NF-NOMES] indice: ${totalNFs} NFs de ${IDX.nomes} nomes (${dias}d) em ${IDX.duracaoSeg}s`);
    return IDX;
  } finally {
    construindo = false;
  }
}

function statusIndice() {
  return {
    quente: IDX.ts > 0,
    construindo,
    idade_min: IDX.ts ? Math.round((Date.now() - IDX.ts) / 60000) : null,
    total_nfs: IDX.totalNFs,
    nomes_distintos: IDX.nomes,
    nomes_curtos: Object.keys(IDX.mapaCurto).length,
    janela_dias: Number(process.env.AMB_NF_JANELA_DIAS || 120),
    duracao_construcao_seg: IDX.duracaoSeg || null,
    erro: IDX.erro,
  };
}

/**
 * Busca candidatos pelo nome. Ordem das tentativas:
 *   1. nome completo exato        (IANDRAMATIASRIBEIRODEFREITAS)
 *   2. primeiro+ultimo nome       (IANDRAFREITAS)  <- novo
 *   3. prefixo ou contem          (nome parcial digitado na mao)
 * Devolve no maximo 8, mais recentes primeiro, com o motivo do match.
 */
async function buscarPorNome(texto) {
  const alvo = colapsar(texto);
  if (alvo.length < 5) {
    return { alvo, via: null, candidatos: [], aviso: 'texto curto demais (minimo 5 letras)' };
  }

  if (!IDX.ts || (Date.now() - IDX.ts) > 30 * 60000) {
    try { await construirIndice(); } catch (e) { /* segue com o que tiver */ }
  }

  // 1) exato
  if (IDX.mapa[alvo]) {
    return { alvo, via: 'nome completo', candidatos: ordenar([...IDX.mapa[alvo]]) };
  }

  // 2) primeiro+ultimo
  if (IDX.mapaCurto[alvo]) {
    return { alvo, via: 'primeiro+ultimo nome', candidatos: ordenar([...IDX.mapaCurto[alvo]]) };
  }

  // 3) prefixo / contem
  const hits = [];
  const jaVi = new Set();
  for (const [nome, nfs] of Object.entries(IDX.mapa)) {
    if (nome.startsWith(alvo) || nome.includes(alvo) || alvo.includes(nome)) {
      for (const nf of nfs) {
        if (jaVi.has(nf.id)) continue;
        jaVi.add(nf.id);
        hits.push(nf);
      }
    }
    if (hits.length >= 24) break;
  }

  return { alvo, via: hits.length ? 'aproximado' : null, candidatos: ordenar(hits) };
}

function ordenar(lista) {
  lista.sort((a, b) => String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));
  return lista.slice(0, 8);
}

/** Pre-aquecimento atrasado, pelo mesmo motivo do indice do ML. */
function preAquecer(atrasoMs) {
  const atraso = atrasoMs != null ? atrasoMs : 4 * 60 * 1000;
  console.log(`[AMB/NF-NOMES] pre-aquecimento agendado para daqui a ${Math.round(atraso / 1000)}s`);
  setTimeout(() => {
    construirIndice().catch(e => console.error('[AMB/NF-NOMES] pre-aquecimento falhou:', e.message));
  }, atraso).unref();
}

module.exports = {
  construirIndice, statusIndice, buscarPorNome, preAquecer,
  colapsar, primeiroUltimo,
};
