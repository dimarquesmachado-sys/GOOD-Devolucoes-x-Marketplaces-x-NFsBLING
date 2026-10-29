// ============================================================

// ⚠️ b372 - O BLING VEM DA EMPRESA, nao a instancia padrao.
//
// Era `require('./bling-AMB')` — a instancia criada com o `config-AMB` fixo.
// A Girassol consultaria o Bling DA AMBTOTAL aqui: veria as notas dela e
// emitiria na conta errada.
//
// amb-devolucoes/lib-AMB/nf-entrada-AMB.js     (AMB Devol. b11)
// ------------------------------------------------------------
// NFs de DEVOLUCAO (entrada) do Bling, indexadas por pedido e
// por nome — pra o painel dizer "a NF de devolucao desta venda
// JA FOI EMITIDA" e a triagem nao mandar emitir duas vezes.
//
// ⚠️ HONESTIDADE SOBRE O `tipo`: a doc do Bling e ambigua e a
// GOOD tem anotacoes CONTRADITORIAS (uma sondagem diz tipo=1 =
// entrada; mas o indice de nomes usa tipo=1 e comprovadamente
// devolve as notas de VENDA — as 4.353 da AMB sao vendas).
// Entao aqui o tipo de ENTRADA e configuravel:
//     AMB_NF_ENTRADA_TIPO   (padrao: 0)
// e existe a rota /amb/nf/entrada/sonda que lista a primeira
// pagina de cada tipo com a NATUREZA DA OPERACAO — um clique e
// o Diego ve qual tipo traz "Devolucao de venda".
// ============================================================

// ⚠️ b364 - VIRA FABRICA: o indice de NF de entrada — notas da outra empresa.
//
// Era instancia unica do processo. Mesma tecnica dos anteriores: envolvo
// SEM REINDENTAR, pra o diff ficar legivel.
//
// ⚠️ As envs com prefixo passam a vir da empresa, com `AMB_` de padrao —
// a AMB le exatamente as mesmas de hoje.
// ⚠️ b377 - sem o cliente da empresa, derruba (mesma razao dos outros 4).
function blingDa(cfg) {
  const c = cfg && cfg.clienteBling;
  if (!c) {
    throw new Error('[nf-entrada-AMB] `clienteBling` nao veio na config da '
      + 'empresa — sem ele eu usaria o Bling da AMBTotal.');
  }
  return c;
}

function criar(cfgEmpresa) {
  // ⚠️ b400 - a etiqueta do log diz QUAL EMPRESA.
  //
  // Era `[AMB/...]` fixo: o Render junta o log das duas no MESMO lugar,
  // e um erro da Girassol apareceria como AMB.
  //
  // 📌 CONST dentro da fábrica, nunca `let` no módulo — foi o erro que
  // cometi no b396: a 2ª empresa sobrescrevia a etiqueta da 1ª.
  const _TAG = String((cfgEmpresa && cfgEmpresa.PREFIXO_ENV) || 'AMB_')
    .replace(/_$/, '');
const _PREFIXO = String((cfgEmpresa && cfgEmpresa.PREFIXO_ENV) || 'AMB_');
'use strict';

// ⚠️ b372: prefere o cliente Bling DESTA empresa
const bling = blingDa(cfgEmpresa || cfg);


// ⚠️ b347 - gaveta: o indice de NF de entrada + o sinalizador.
// Compartilhado, a Girassol veria as notas de entrada da AMB.
// ⚠️ b355 - PASSO 3: fabrica do estado deste modulo.
//
// indice de NF de entrada + sinalizador.
//
// Mesma tecnica das fatias 1 e 2: a gaveta continua existindo com o
// mesmo nome, mas NASCE de uma funcao — entao o passo 3 cria uma por
// empresa em vez de uma por processo. Comportamento identico hoje.
function criarEstadoNfEntrada() {
  return {
    est: { construindo: false },
    idx: { ts: 0, porPedido: {}, porNome: {}, total: 0, erro: null, duracaoSeg: 0 },
  };
}

// ⚠️ a instancia de hoje VEM da fabrica — sem duas fontes do mesmo estado
const _EST = criarEstadoNfEntrada();

// ⚠️ b418 - AGENDADO TAMBEM E OCUPADO (mesma coisa do magalu).
//
// A fila do pre-aquecimento le `ocupado`. Entre agendar e o timer disparar,
// este modulo dizia livre — e a fila soltava o proximo por cima.
//
// 📌 Este NAO foi apontado: achei varrendo os 5 modulos da fila, que e o que
// eu deveria ter feito nas 4 vezes anteriores em vez de olhar so o citado.
let agendado = false;

const EST = _EST.est;
const IDX = _EST.idx;   // b355
// (EST.construindo -> EST.construindo — b347)

const colapsar = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z]/g, '');

const TIPO = () => String(process.env[_PREFIXO + 'NF_ENTRADA_TIPO'] || '0');

// ===== 29/10 — NF DE DEVOLUCAO RECONHECIDA PELA NF DE VENDA QUE ELA DEVOLVE =====
// Dono, 29/10: emitiu a NF de devolucao da tosquiadeira A MAO no Bling. A espreita so reconhecia devolucao pelo
// NUMERO DO PEDIDO (numeroLoja) — e na Girassol nenhuma nota de entrada traz isso (pedidos_indexados: 0). Toda NF
// de devolucao, por regra da SEFAZ, REFERENCIA a chave da NF de venda (<refNFe>) — a mesma prova do vinculo (#499).
// A chave carrega serie (pos. 23-25) e numero (pos. 26-34) da venda. Cada nota e lida UMA vez (resultado conclusivo
// fica guardado; 'nao sei' tenta de novo ate 3 vezes), no ritmo de FUNDO do Bling, com teto por rodada.
// Autorizada: 5, 6, 7 no Bling (autorizada / emitida DANFE / registrada). Outra situacao nao conta — cancelada ou
// pendente nao e devolucao emitida. Na duvida, nao marca: marca errada esconderia uma devolucao pendente.
const SITUACOES_VALIDAS = new Set([5, 6, 7]);
const PROVAS = new Map();    // id da NF de entrada -> { vendas: ['serie:numero'] }   (so resultado CONCLUSIVO)
const TENTOU = new Map();    // id -> quantas vezes deu 'nao sei'
const PROVAS_POR_RODADA = Number(process.env[_PREFIXO + 'NF_ENTRADA_PROVAS_RODADA'] || 120);
let PROVANDO = false;
function naturezasDevolucao() {
  try {
    const f = cfgEmpresa && cfgEmpresa.fiscal;
    const v = (f && typeof f.naturezasDevolucaoIds === 'function') ? f.naturezasDevolucaoIds() : null;
    return String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  } catch (e) { return []; }
}
function chaveVenda(serie, numero) {
  const s = parseInt(String(serie == null ? '' : serie), 10), n = parseInt(String(numero == null ? '' : numero), 10);
  return (Number.isFinite(s) && Number.isFinite(n) && n > 0) ? (s + ':' + n) : null;
}
// { vendas: [...] } quando o XML e de NF-e COMPLETA; null quando nao deu pra conferir (rede, sem XML, corpo truncado)
async function provarUma(reg) {
  const r = await bling.chamarBling('/nfe/' + encodeURIComponent(reg.id), { fundo: true });
  const d = (r && r.ok && r.data && r.data.data) ? r.data.data : null;
  if (!d || !d.xml) return null;
  let txt;
  try {
    const rx = await fetch(d.xml, { signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(8000) : undefined });
    if (!rx.ok) return null;
    txt = await rx.text();
  } catch (e) { return null; }
  if (!/<infNFe[\s>]/.test(txt) || !/<\/NFe>/.test(txt)) return null;
  const emit = (/<emit>[\s\S]*?<CNPJ>(\d{14})<\/CNPJ>/.exec(txt) || [])[1] || null;
  const refs = [...txt.matchAll(/<refNFe>\s*(\d{44})\s*<\/refNFe>/g)].map((m) => m[1]);
  // so referencia a NF do PROPRIO CNPJ (devolucao de venda nossa); sem o CNPJ do emitente, nao arrisca
  const vendas = emit ? refs.filter((c) => c.substr(6, 14) === emit).map((c) => chaveVenda(c.substr(22, 3), c.substr(25, 9))).filter(Boolean) : [];
  return { vendas };
}
function remontarPorVenda() {
  const pv = {};
  for (const reg of (IDX.candidatas || [])) {
    const p = PROVAS.get(reg.id);
    if (!p) continue;
    for (const k of p.vendas) pv[k] = { id: reg.id, numero: reg.numero, dataEmissao: reg.dataEmissao, nome: reg.nome };
  }
  IDX.porVenda = pv;
}
async function provarPendentes() {
  if (PROVANDO) return;
  PROVANDO = true;
  try {
    let feitas = 0;
    for (const reg of (IDX.candidatas || [])) {
      if (PROVAS.has(reg.id) || (TENTOU.get(reg.id) || 0) >= 3) continue;
      if (feitas >= PROVAS_POR_RODADA) break;
      feitas++;
      const p = await provarUma(reg).catch(() => null);
      if (p) PROVAS.set(reg.id, p); else TENTOU.set(reg.id, (TENTOU.get(reg.id) || 0) + 1);
      if (feitas % 20 === 0) remontarPorVenda();
      await new Promise((ok) => setTimeout(ok, 350));
    }
    remontarPorVenda();
  } finally { PROVANDO = false; }
}
async function construirIndice() {
  if (EST.construindo) return IDX;
  EST.construindo = true;
  const t0 = Date.now();
  try {
    const dias = Number(process.env[_PREFIXO + 'NF_ENTRADA_DIAS'] || 180);
    const corte = Date.now() - dias * 864e5;
    const porPedido = {}, porNome = {};
    const candidatas = [];
    const natDev = new Set(naturezasDevolucao());
    let total = 0, erro = null, parou = false;

    for (let pg = 1; pg <= 40; pg++) {
      const r = await bling.chamarBling(`/nfe?limite=100&pagina=${pg}&tipo=${TIPO()}`, { fundo: true });
      if (!r.ok) { erro = `nfe entrada pagina ${pg} HTTP ${r.status}`; break; }
      const lista = (r.data && r.data.data) || [];
      if (!lista.length) break;
      for (const n of lista) {
        const quando = Date.parse(String(n.dataEmissao || '').replace(' ', 'T'));
        if (quando && quando < corte) { parou = true; break; }
        const reg = {
          id: String(n.id), numero: String(n.numero || ''),
          dataEmissao: n.dataEmissao || null,
          nome: (n.contato && n.contato.nome) || '',
          pedido: String(n.numeroLoja || n.numeroPedidoLoja || ''),
          situacao: n.situacao != null ? n.situacao : null,
          natureza: String((n.naturezaOperacao && n.naturezaOperacao.id) || ''),
        };
        if (reg.pedido) porPedido[reg.pedido] = reg;
        // 29/10: candidata a NF de DEVOLUCAO (natureza de devolucao da empresa + autorizada) — a prova pelo XML diz
        // de qual NF de venda ela e (vale tambem pra devolucao feita A MAO no Bling, que nao traz o numero do pedido)
        if (natDev.has(reg.natureza) && SITUACOES_VALIDAS.has(Number(reg.situacao))) candidatas.push(reg);
        const ch = colapsar(reg.nome);
        if (ch.length >= 5) (porNome[ch] = porNome[ch] || []).push(reg);
        total++;
      }
      if (parou || lista.length < 100) break;
      await new Promise(s => setTimeout(s, 320));
    }

    IDX.ts = (erro && total === 0) ? 0 : Date.now();
    IDX.porPedido = porPedido;
    IDX.porNome = porNome;
    // 29/10: lista inteira substitui; lista que parou numa pagina com erro SOMA a anterior (nao apaga o que ja se sabia)
    if (!erro) IDX.candidatas = candidatas;
    else {
      const ids = new Set(candidatas.map((r) => r.id));
      IDX.candidatas = candidatas.concat((IDX.candidatas || []).filter((r) => !ids.has(r.id)));
    }
    remontarPorVenda();
    provarPendentes().catch((e) => console.error(`[${_TAG}/NF-ENTRADA] prova`, e.message));
    IDX.total = total;
    IDX.erro = erro;
    IDX.duracaoSeg = Math.round((Date.now() - t0) / 1000);
    console.log(`[${_TAG}/NF-ENTRADA] ${total} notas de entrada (tipo=${TIPO()}) em ${IDX.duracaoSeg}s`);
    return IDX;
  } finally { EST.construindo = false; }
}

/** A NF de devolucao desta venda ja saiu? Busca por pedido, depois nome. */
function jaEmitida({ pedido, nome, nfVenda, serieVenda }) {
  if (!IDX.ts) return { indice_frio: true, emitida: null };
  if (pedido && IDX.porPedido[String(pedido)]) {
    return { emitida: true, nf: IDX.porPedido[String(pedido)], via: 'pedido' };
  }
  // 29/10: pela NF DE VENDA que a devolucao referencia no XML (serie + numero). Sem a serie, nao chuta.
  const kv = chaveVenda(serieVenda, nfVenda);
  if (kv && IDX.porVenda && IDX.porVenda[kv]) {
    return { emitida: true, nf: IDX.porVenda[kv], via: 'xml' };
  }
  const ch = colapsar(nome);
  if (ch.length >= 5 && IDX.porNome[ch] && IDX.porNome[ch].length) {
    return { emitida: true, nf: IDX.porNome[ch][0], via: 'nome', ambiguo: IDX.porNome[ch].length > 1 };
  }
  return { emitida: false };
}

function statusIndice() {
  return {
    // ⚠️ b347: era o atalho `construindo,` (chave E valor). Com o nome
    // novo, preciso ser explicito: a chave continua `construindo`.
    quente: IDX.ts > 0, construindo: EST.construindo,
    // b418: a fila do pre-aquecimento le isto
    ocupado: !!(agendado || EST.construindo),
    tipo_usado: TIPO(),
    total: IDX.total,
    pedidos_indexados: Object.keys(IDX.porPedido).length,
    // 29/10: NFs de devolucao reconhecidas pela NF de venda (prova do XML)
    devolucoes: {
      candidatas: (IDX.candidatas || []).length,
      provadas: (IDX.candidatas || []).filter((r) => PROVAS.has(r.id)).length,
      vendas_reconhecidas: Object.keys(IDX.porVenda || {}).length,
      provando: PROVANDO,
    },
    erro: IDX.erro,
    duracao_seg: IDX.duracaoSeg || null,
    idade_min: IDX.ts ? Math.round((Date.now() - IDX.ts) / 60000) : null,
  };
}

/**
 * SONDA: primeira pagina de cada tipo, mostrando so numero,
 * natureza da operacao e contato — pra descobrir com um clique
 * qual tipo lista as devolucoes ("Devolucao de venda").
 */
async function sondarTipos() {
  const out = {};
  for (const t of ['0', '1', '2', '3']) {
    const r = await bling.chamarBling(`/nfe?limite=6&pagina=1&tipo=${t}`);
    const lista = (r.ok && r.data && r.data.data) || [];
    out['tipo_' + t] = {
      http: r.status || (r.ok ? 200 : null),
      qtd_na_pagina: lista.length,
      amostra: lista.slice(0, 5).map(n => ({
        numero: n.numero,
        natureza: (n.naturezaOperacao && (n.naturezaOperacao.descricao || n.naturezaOperacao)) || null,
        contato: (n.contato && n.contato.nome) || null,
        data: n.dataEmissao || null,
      })),
    };
    await new Promise(s => setTimeout(s, 250));
  }
  return out;
}

// ⚠️ b414 - ACEITA O ATRASO, pro app poder encadear.
//
// Era fixo aqui dentro. O app agora roda as rotinas UMA DE CADA VEZ e
// precisa disparar com 0 — antes elas esperavam o proprio minuto e
// voltavam a se atropelar, com o encadeamento sem efeito nenhum.
//
// 📌 `!= null` e nao `||`: com `||`, o 0 cairia no padrao e a mudanca
// nao valeria nada — parecendo funcionar.
function preAquecer(atrasoMs) {
  agendado = true;   // b418
  setTimeout(() => { agendado = false; construirIndice().catch(e => console.error(`[${_TAG}/NF-ENTRADA]`, e.message)); }, (atrasoMs != null ? atrasoMs : 6 * 60 * 1000)).unref();
  setInterval(() => { construirIndice().catch(() => {}); }, 45 * 60 * 1000).unref();
}


return { construirIndice, jaEmitida, statusIndice, sondarTipos, preAquecer };
}

// ⚠️ so a fabrica — sem instancia padrao, pra ninguem usar a velha sem notar
module.exports = { criar };
