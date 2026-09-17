// ============================================================
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
function criar(cfgEmpresa) {
const _PREFIXO = String((cfgEmpresa && cfgEmpresa.PREFIXO_ENV) || 'AMB_');
'use strict';

const bling = require('./bling-AMB');

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
const EST = _EST.est;
const IDX = _EST.idx;   // b355
// (EST.construindo -> EST.construindo — b347)

const colapsar = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z]/g, '');

const TIPO = () => String(process.env[_PREFIXO + 'NF_ENTRADA_TIPO'] || '0');

async function construirIndice() {
  if (EST.construindo) return IDX;
  EST.construindo = true;
  const t0 = Date.now();
  try {
    const dias = Number(process.env[_PREFIXO + 'NF_ENTRADA_DIAS'] || 180);
    const corte = Date.now() - dias * 864e5;
    const porPedido = {}, porNome = {};
    let total = 0, erro = null, parou = false;

    for (let pg = 1; pg <= 40; pg++) {
      const r = await bling.chamarBling(`/nfe?limite=100&pagina=${pg}&tipo=${TIPO()}`);
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
        };
        if (reg.pedido) porPedido[reg.pedido] = reg;
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
    IDX.total = total;
    IDX.erro = erro;
    IDX.duracaoSeg = Math.round((Date.now() - t0) / 1000);
    console.log(`[AMB/NF-ENTRADA] ${total} notas de entrada (tipo=${TIPO()}) em ${IDX.duracaoSeg}s`);
    return IDX;
  } finally { EST.construindo = false; }
}

/** A NF de devolucao desta venda ja saiu? Busca por pedido, depois nome. */
function jaEmitida({ pedido, nome }) {
  if (!IDX.ts) return { indice_frio: true, emitida: null };
  if (pedido && IDX.porPedido[String(pedido)]) {
    return { emitida: true, nf: IDX.porPedido[String(pedido)], via: 'pedido' };
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
    tipo_usado: TIPO(),
    total: IDX.total,
    pedidos_indexados: Object.keys(IDX.porPedido).length,
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

function preAquecer() {
  setTimeout(() => { construirIndice().catch(e => console.error('[AMB/NF-ENTRADA]', e.message)); }, 6 * 60 * 1000).unref();
  setInterval(() => { construirIndice().catch(() => {}); }, 45 * 60 * 1000).unref();
}


return { construirIndice, jaEmitida, statusIndice, sondarTipos, preAquecer };
}

// ⚠️ so a fabrica — sem instancia padrao, pra ninguem usar a velha sem notar
module.exports = { criar };
