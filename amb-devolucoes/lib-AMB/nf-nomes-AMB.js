// ============================================================
// amb-devolucoes/lib-AMB/nf-nomes-AMB.js       (AMB Devol. b45-sonda-nffull2)
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

// b44 - SERIE REAL da NF: sai da chave de acesso NF-e (44 digitos),
// posicoes 22-25. É o dado CONSTATADO, emitido na nota. O campo
// nf.serie da listagem /nfe vem vazio/undefined, entao usamos a chave.
// Mapa de series da AMB (so referencia): 1=matriz, 2=ML Full,
// 3=Magalu Full venda, 4=Magalu Full devolucao, 5=Shopee Full.
function serieDaChave(chave, fallback) {
  const ch = String(chave || '').replace(/\D/g, '');
  if (ch.length === 44) {
    const s = ch.slice(22, 25).replace(/^0+/, '');
    if (s) return s;
  }
  return fallback || null;
}

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
    const porPedido = {};
    const porId = {};   // b35 - NF por id do Bling (casa com a venda vinculada)
    const vendasPorLoja = {};   // b34 - numeroLoja GARANTIDO nas vendas
    const porNumero = {};
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
          numero: String(nf.numero || '').replace(/^0+/, ''),   // b41 - sem zeros a esquerda
          serie: serieDaChave(nf.chaveAcesso, String(nf.serie || '').trim() || null),   // b44 - serie REAL da chave de acesso
          nome: nomeOriginal,
          dataEmissao: nf.dataEmissao || null,
          valor: nf.valorNota != null ? nf.valorNota : null,
        };

        // b17 - indice POR PEDIDO: e daqui que o painel puxa o
        // cliente e a NF da venda pra cada devolucao a espreita.
        const nlj = String(nf.numeroLoja || nf.numeroPedidoLoja || '').trim();
        if (nlj) porPedido[nlj] = registro;
        const numN = String(nf.numero || '').replace(/^0+/, '');
        if (numN) porNumero[numN] = registro;
        if (numN) if (nf.id) porId[String(nf.id)] = registro;

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

    // ── b34: PASSE 2 — VENDAS do Bling. /pedidos/vendas traz
    // numeroLoja SEMPRE (mais contato e total) — é a espinha dos
    // checkouts. Cobre Shopee/TikTok/Amazon quando a lista de NFs
    // não casa pelo pedido. Erro aqui NÃO derruba o índice de NFs.
    let vendasLidas = 0, erroVendas = null;
    try {
      for (let pg = 1; pg <= maxPaginas; pg++) {
        // b40 - 429 (rate limit do Bling) na leitura de vendas NAO derruba mais
        // o indice: espera e tenta a MESMA pagina de novo, ate 4x com backoff.
        let r = null;
        for (let tent = 1; tent <= 4; tent++) {
          r = await bling.chamarBling(`/pedidos/vendas?limite=100&pagina=${pg}`);
          if (r.ok) { erroVendas = null; break; }
          if (r.status === 429 || r.status === 503) {
            erroVendas = `vendas pagina ${pg} HTTP ${r.status} (tent ${tent}/4)`;
            await sleep(1500 * tent);   // 1.5s, 3s, 4.5s
            continue;
          }
          erroVendas = `vendas pagina ${pg} HTTP ${r.status}`;
          break;   // erro nao-recuperavel: para
        }
        if (!r || !r.ok) break;   // esgotou as tentativas desta pagina
        const lote = (r.data && r.data.data) || [];
        if (!lote.length) break;
        let velhas = 0;
        for (const v of lote) {
          const quando = Date.parse(v.data || '') || 0;
          if (quando && quando < corte) { velhas++; continue; }
          const loja = String(v.numeroLoja || '').trim();
          if (!loja) continue;
          vendasLidas++;
          const ja = vendasPorLoja[loja];
          if (!ja || (quando && quando > (ja._q || 0))) {
            vendasPorLoja[loja] = {
              nome: (v.contato && v.contato.nome) || null,
              valor: (v.total != null ? v.total : null),
              id_venda: String(v.id || ''),
              numero_venda: String(v.numero || ''),
              _q: quando,
            };
          }
        }
        if (velhas === lote.length) break;   // página inteira antes do corte
        await sleep(350);
      }
    } catch (e) { erroVendas = e.message; }

    // Mesma regra do indice do ML: se falhou e nao veio nada, nao
    // marca como quente — o proximo bipe tenta de novo em vez de
    // confiar num indice vazio por 30 minutos.
    const falhouGeral = !!erroBusca && totalNFs === 0;
    IDX.ts = falhouGeral ? 0 : Date.now();
    IDX.mapa = mapa;
    IDX.porPedido = porPedido;
    IDX.porId = porId;
    IDX.vendasPorLoja = vendasPorLoja;
    IDX.vendasLidas = vendasLidas;
    IDX.erroVendas = erroVendas;
    IDX.porNumero = porNumero;
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
    com_pedido: IDX.porPedido ? Object.keys(IDX.porPedido).length : 0,
    vendas_com_loja: Object.keys(IDX.vendasPorLoja || {}).length,
    nf_por_venda_ok: [...NF_POR_VENDA.values()].filter(e => e.numero).length,
    nf_por_loja_ok: NF_POR_LOJA.size,
    nf_por_venda_nulas: [...NF_POR_VENDA.values()].filter(e => !e.numero).length,
    nf_por_venda_amostra: [...NF_POR_VENDA.entries()].slice(0, 3)
      .map(([id, e]) => ({ id_venda: id, numero: e.numero, http: e.http, tent: e.tent })),
    vendas_lidas: IDX.vendasLidas || 0,
    erro_vendas: IDX.erroVendas || null,
    com_numero: IDX.porNumero ? Object.keys(IDX.porNumero).length : 0,
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

/** Cliente e NF da venda pelo numero do pedido do marketplace. */
// ── b35: NF pela VENDA vinculada. Pros cards em que o ML nega a
// chave (invoice_data 404) e a lista de NFs não casa (com_pedido 0),
// o detalhe da venda (GET /pedidos/vendas/{id}) aponta a NF gerada.
// Cache permanente com retentativa (padrão da ENTREGA_REAL/b30).
const NF_POR_VENDA = new Map();
let _sondaInterno = '';
const NF_POR_LOJA = new Map();   // b39 - numeroLoja -> {numero,serie} (a chave que o card sempre tem)   // id_venda -> { numero, serie, id_nf, tent, http }
let NFV_RODANDO = false;

// SONDA b45 - dado um numeroLoja (order_sn), diz o que o indice tem pra ele
function setSondaInterno(v) { _sondaInterno = String(v || ''); }

async function sondaLoja(numeroLoja) {
  const k = String(numeroLoja || '').trim();
  const venda = IDX.vendasPorLoja && IDX.vendasPorLoja[k];
  const nfLoja = NF_POR_LOJA.get(k);
  const chavesParecidas = Object.keys(IDX.vendasPorLoja || {}).filter(x => x.includes(k) || k.includes(x)).slice(0, 5);

  // SONDA VIVA b45 - bate no Bling AO VIVO por varios caminhos pra achar a
  // venda/NF do Full, que nao entra no indice de /pedidos/vendas normal.
  const aoVivo = {};
  const tentar = async (nome, path) => {
    try {
      const r = await bling.chamarBling(path);
      const arr = (r.ok && r.data && r.data.data) || [];
      aoVivo[nome] = {
        http: r.status, achou: Array.isArray(arr) ? arr.length : 0,
        amostra: (Array.isArray(arr) ? arr : []).slice(0, 3).map(x => ({
          id: x.id, numero: x.numero, numeroLoja: x.numeroLoja || x.numeroPedidoLoja,
          serie: x.serie, chaveAcesso: x.chaveAcesso,
          contato: x.contato && x.contato.nome, situacao: x.situacao,
        })),
      };
    } catch (e) { aoVivo[nome] = { erro: String(e.message || e).slice(0, 100) }; }
  };
  // caminho 1: vendas filtrando por numeroLoja
  await tentar('vendas_por_numeroLoja', `/pedidos/vendas?numeroLoja=${encodeURIComponent(k)}`);
  // caminho 2: NFs filtrando por numeroLoja
  await tentar('nfe_por_numeroLoja', `/nfe?numeroLoja=${encodeURIComponent(k)}`);
  // caminho 3: NFs tipo 1 filtrando por numero da loja (campo alternativo)
  await tentar('nfe_por_numeroPedidoLoja', `/nfe?numeroPedidoLoja=${encodeURIComponent(k)}`);

  // caminho 4 (b45-nffull): a NF do FULL esta na listagem /nfe (XML importado
  // por extensao), NAO como filha de uma venda. VARRER a listagem /nfe AO VIVO
  // procurando o order_sn em qualquer campo. Paginar ate achar (ou ~8 pgs).
  try {
    const nomeAlvo = String(_sondaInterno || '').trim().toLowerCase();   // reuso: ?interno= passa o NOME
    let porOrderSn = [], porNome = [], amostraCampos = null, pgs = 0;
    for (let pg = 1; pg <= 12; pg++) {
      const r = await bling.chamarBling(`/nfe?limite=100&pagina=${pg}&tipo=1`);
      const arr = (r.ok && r.data && r.data.data) || [];
      if (!Array.isArray(arr) || arr.length === 0) break;
      if (!amostraCampos && arr[0]) amostraCampos = Object.keys(arr[0]);
      for (const nf of arr) {
        const alvos = [nf.numeroPedidoLoja, nf.numeroLoja, nf.numero, nf.chaveAcesso].map(x => String(x || ''));
        const reg = {
          id: nf.id, numero: nf.numero, serie: nf.serie,
          numeroPedidoLoja: nf.numeroPedidoLoja, numeroLoja: nf.numeroLoja,
          chaveAcesso: nf.chaveAcesso, contato: nf.contato && nf.contato.nome,
          natureza: nf.naturezaOperacao,
        };
        if (alvos.some(a => a.includes(k))) porOrderSn.push(reg);
        if (nomeAlvo && nf.contato && String(nf.contato.nome || '').toLowerCase().includes(nomeAlvo)) porNome.push(reg);
      }
      pgs = pg;
      if (porOrderSn.length && (!nomeAlvo || porNome.length)) break;
    }
    aoVivo.nfe_listagem = {
      paginas_varridas: pgs,
      por_order_sn: porOrderSn.length,
      por_nome: porNome.length,
      notas_order_sn: porOrderSn.slice(0, 5),
      notas_nome: porNome.slice(0, 8),
      campos_da_nfe: amostraCampos,
    };
  } catch (e) { aoVivo.nfe_listagem = { erro: String(e.message || e).slice(0, 100) }; }

  // procurar o numero (order_sn OU interno) entre TODAS as vendas ja indexadas
  const todas = Object.keys(IDX.vendasPorLoja || {});
  const bateExato = todas.filter(x => x === k);
  // se passaram um 2o numero (interno), procura ele tb
  const interno = String((typeof _sondaInterno !== 'undefined' && _sondaInterno) || '').trim();
  const bateInterno = interno ? todas.filter(x => x === interno) : [];
  const vendaInterno = interno && IDX.vendasPorLoja && IDX.vendasPorLoja[interno] ? IDX.vendasPorLoja[interno] : null;

  return {
    procurado: k,
    interno_procurado: interno || null,
    achou_venda: !!venda,
    venda: venda ? { id_venda: venda.id_venda, numero_venda: venda.numero_venda, nome: venda.nome, valor: venda.valor } : null,
    achou_por_interno: !!vendaInterno,
    venda_por_interno: vendaInterno ? { id_venda: vendaInterno.id_venda, numero_venda: vendaInterno.numero_venda, nome: vendaInterno.nome } : null,
    achou_nf_por_loja: !!nfLoja,
    nf_por_loja: nfLoja || null,
    chaves_parecidas: chavesParecidas,
    total_vendas_indexadas: todas.length,
    ao_vivo: aoVivo,
  };
}

function nfDaLoja(numeroLoja) {
  const e = numeroLoja ? NF_POR_LOJA.get(String(numeroLoja).trim()) : null;
  return (e && e.numero) ? e : null;
}

function nfDaVenda(idVenda) {
  const e = idVenda ? NF_POR_VENDA.get(String(idVenda)) : null;
  return (e && e.numero) ? e : null;
}

function dispararNfPorVenda(pares) {
  if (NFV_RODANDO) return;
  // aceita ['id', ...] (compat) OU [{id, loja}, ...] (b39). Normaliza.
  const norm = (pares || []).map(x => (x && typeof x === 'object') ? { id: String(x.id || ''), loja: String(x.loja || '') } : { id: String(x || ''), loja: '' }).filter(x => x.id);
  const vistos = new Set();
  const fila = norm.filter(x => {
    if (vistos.has(x.id)) return false; vistos.add(x.id);
    const e = NF_POR_VENDA.get(x.id);
    return !e || (!e.numero && (e.tent || 0) < 3);
  }).slice(0, 40);
  if (!fila.length) return;
  NFV_RODANDO = true;
  (async () => {
    for (const item of fila) {
      const id = item.id, loja = item.loja;
      const antes = NF_POR_VENDA.get(id) || { tent: 0 };
      try {
        const r = await bling.chamarBling('/pedidos/vendas/' + id);
        const v = (r.ok && r.data && r.data.data) || null;
        const nfId = v && v.notaFiscal && v.notaFiscal.id ? String(v.notaFiscal.id) : null;
        let numero = null, http = r.status || (r.ok ? 200 : null);
        let serie = null;
        if (nfId) {
          const reg = (IDX.porId && IDX.porId[nfId]) || null;
          if (reg && reg.numero) { numero = String(reg.numero); serie = reg.serie || null; }   // b44 - reg.serie ja vem da chave
          else {
            const rn = await bling.chamarBling('/nfe/' + nfId);
            const nf = (rn.ok && rn.data && rn.data.data) || null;
            if (nf && nf.numero) { numero = String(nf.numero).replace(/^0+/, ''); serie = serieDaChave(nf.chaveAcesso, (nf.serie != null && String(nf.serie).trim()) ? String(nf.serie).trim() : null); }   // b44 - serie da chave
            http = rn.status || http;
          }
        }
        NF_POR_VENDA.set(id, { numero, serie, id_nf: nfId, tent: (antes.tent || 0) + 1, http });
        if (loja && numero) NF_POR_LOJA.set(loja, { numero, serie });
      } catch (e) {
        NF_POR_VENDA.set(id, { numero: null, serie: null, id_nf: null, tent: (antes.tent || 0) + 1, http: 'exc:' + String(e.message).slice(0, 40) });
      }
      await new Promise(rs => setTimeout(rs, 350));
    }
    const ok = [...NF_POR_VENDA.values()].filter(e => e.numero).length;
    console.log('[AMB/NF-NOMES] NFs pela venda: ' + ok + ' de ' + NF_POR_VENDA.size + ' consultadas');
  })().catch(() => {}).finally(() => { NFV_RODANDO = false; });
}

function acharVendaPorLoja(k) {
  const c = String(k || '').trim();
  return (c && IDX.vendasPorLoja && IDX.vendasPorLoja[c]) || null;
}

function acharPorNumero(numero) {
  const k = String(numero || '').replace(/^0+/, '');
  return (k && IDX.porNumero && IDX.porNumero[k]) || null;
}

function acharPorPedido(pedido) {
  const k = String(pedido || '').trim();
  return (k && IDX.porPedido && IDX.porPedido[k]) || null;
}

module.exports = {
  construirIndice, statusIndice, buscarPorNome, acharPorPedido, acharPorNumero, acharVendaPorLoja, nfDaVenda, nfDaLoja, sondaLoja, setSondaInterno, dispararNfPorVenda, preAquecer,
  colapsar, primeiroUltimo,
};
