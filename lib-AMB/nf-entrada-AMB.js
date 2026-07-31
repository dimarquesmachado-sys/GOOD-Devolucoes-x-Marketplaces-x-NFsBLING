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

'use strict';

const bling = require('./bling-AMB');

const IDX = { ts: 0, porPedido: {}, porNome: {}, total: 0, erro: null, duracaoSeg: 0 };
let construindo = false;

const colapsar = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z]/g, '');

const TIPO = () => String(process.env.AMB_NF_ENTRADA_TIPO || '0');

async function construirIndice() {
  if (construindo) return IDX;
  construindo = true;
  const t0 = Date.now();
  try {
    const dias = Number(process.env.AMB_NF_ENTRADA_DIAS || 180);
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
  } finally { construindo = false; }
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
    quente: IDX.ts > 0, construindo,
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

module.exports = { construirIndice, jaEmitida, statusIndice, sondarTipos, preAquecer };
