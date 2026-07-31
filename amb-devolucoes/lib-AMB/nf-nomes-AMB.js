// ============================================================
// amb-devolucoes/lib-AMB/nf-nomes-AMB.js       (AMB Devol. b8)
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
// b5 — PAGINACAO DE VERDADE. Antes a busca cortava em 8 e NAO
// avisava que havia mais: se a NF certa fosse a 9a, ela era
// invisivel. Acontece de verdade em dois casos — cliente que
// comprou 12 vezes em 120 dias, e colisao de nome curto (com
// 3.575 nomes curtos, existe mais de um "JOSESILVA"). Agora a
// busca conta o TOTAL real, devolve a pagina pedida e diz se
// tem mais.
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
 * Busca candidatos pelo nome.
 *
 * Roda as TRES estrategias e junta o resultado, em vez de parar na
 * primeira que da match. Motivo descoberto no teste: "Jose Silva
 * Ramos" vira JOSERAMOS no indice curto, entao uma etiqueta escrita
 * JOSESILVA achava so o "Jose Antonio Silva" e escondia o outro —
 * sendo que JOSESILVA e prefixo de JOSESILVARAMOS. Parar na
 * primeira estrategia custava recall justamente nos casos ambiguos,
 * que sao os que mais precisam de ajuda.
 *
 * A ordem de confianca vira a ordem da lista:
 *   1. nome completo exato    (mais confiavel)
 *   2. primeiro+ultimo nome
 *   3. prefixo / contem       (menos confiavel)
 * Dentro de cada faixa, mais recente primeiro.
 */
async function buscarPorNome(texto, opts = {}) {
  const porPagina = Math.min(Math.max(Number(opts.porPagina) || 8, 1), 50);
  const pagina = Math.max(Number(opts.pagina) || 1, 1);
  const alvo = colapsar(texto);

  const vazio = (aviso) => ({
    alvo, via: null, candidatos: [],
    total: 0, pagina, por_pagina: porPagina, tem_mais: false, aviso,
  });

  if (alvo.length < 5) return vazio('texto curto demais (minimo 5 letras)');

  // ESPERAR SO QUANDO NAO HA ALTERNATIVA.
  // Visto em producao: depois de um restart o indice esfria, e a
  // busca ficava 57s montando com o estoquista e a caixa na mao.
  // Agora: indice VAZIO -> espera (nao ha o que responder).
  // Indice VELHO mas cheio -> responde JA com o que tem e
  // reconstroi por tras. O pior caso vira "a NF de 10 minutos
  // atras ainda nao entrou", e devolucao que chega hoje e de
  // venda de semanas atras — nao atrapalha nada.
  if (!IDX.ts) {
    try { await construirIndice(); } catch (e) { /* segue vazio */ }
  } else if ((Date.now() - IDX.ts) > 30 * 60000) {
    construirIndice().catch(e => console.error('[AMB/NF-NOMES] atualizacao em background falhou:', e.message));
  }

  const jaVi = new Set();
  const hits = [];
  const vias = [];

  const juntar = (lista, forca, nomeVia) => {
    let entrou = 0;
    for (const nf of lista || []) {
      if (jaVi.has(nf.id)) continue;
      jaVi.add(nf.id);
      hits.push({ ...nf, forca, via: nomeVia });
      entrou++;
    }
    if (entrou > 0) vias.push(nomeVia);
  };

  // 1) nome completo exato
  juntar(IDX.mapa[alvo], 1, 'nome completo');

  // 2) primeiro+ultimo nome
  juntar(IDX.mapaCurto[alvo], 2, 'primeiro+ultimo nome');

  // 3) aproximado — sem teto artificial, pra o total nao mentir
  const aprox = [];
  for (const [nome, nfs] of Object.entries(IDX.mapa)) {
    if (nome.startsWith(alvo) || nome.includes(alvo) || alvo.includes(nome)) {
      aprox.push(...nfs);
    }
  }
  juntar(aprox, 3, 'aproximado');

  // confianca primeiro, data depois
  hits.sort((a, b) => (a.forca - b.forca)
    || String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));

  const total = hits.length;
  const inicio = (pagina - 1) * porPagina;
  const fatia = hits.slice(inicio, inicio + porPagina);

  return {
    alvo,
    via: vias[0] || null,
    vias,
    candidatos: fatia,
    total,
    pagina,
    por_pagina: porPagina,
    tem_mais: inicio + fatia.length < total,
    // todas do mesmo cliente: o nome nao desempata, so os itens
    muitos_iguais: total > porPagina && new Set(hits.map(h => h.nome)).size === 1,
    // busca generica demais: buscar "SILVA" trouxe 503 NFs reais.
    // Paginar 63 vezes nao ajuda ninguem — melhor pedir o nome
    // completo do remetente, que e o que esta impresso na caixa.
    generica: total > 50,
  };
}

/** Ordena no lugar: mais recente primeiro. NAO corta mais. */
function ordenar(lista) {
  lista.sort((a, b) => String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));
  return lista;
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
