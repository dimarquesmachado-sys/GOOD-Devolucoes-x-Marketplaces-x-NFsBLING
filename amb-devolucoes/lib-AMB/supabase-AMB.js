// ============================================================
// amb-devolucoes/lib-AMB/supabase-AMB.js       (AMB Devol. b6)
// ------------------------------------------------------------
// Acesso ao Supabase da AMBTotal.
//
// Usa o MESMO projeto da GOOD, mas tabelas com sufixo _amb
// (devolucoes_amb, espreita_notas_amb, recados_amb,
// pecas_retiradas_amb). Como sao tabelas fisicamente diferentes,
// nao existe risco de um filtro esquecido misturar empresa —
// o isolamento e estrutural, nao depende de lembrar do WHERE.
//
// O nome da tabela NUNCA aparece escrito no meio do codigo: vem
// sempre do config-AMB. Assim, se um dia a AMB ganhar projeto
// proprio, muda so o config.
//
// RLS esta LIGADO nas quatro tabelas, sem politica nenhuma. Como
// o servidor usa a service_role, ele passa por cima do RLS; e
// como nao ha politica, ninguem mais entra — nem com a chave
// anon publica.
// ============================================================

'use strict';

const cfg = require('../config-AMB');

let cliente = null;
let erroInicial = null;

function conectar() {
  if (cliente || erroInicial) return cliente;
  if (!cfg.supabase.url || !cfg.supabase.key) {
    erroInicial = 'AMB_SUPABASE_URL ou AMB_SUPABASE_KEY ausente';
    console.log('[AMB/Supabase] ' + erroInicial);
    return null;
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    cliente = createClient(cfg.supabase.url, cfg.supabase.key, {
      auth: { persistSession: false },
    });
    console.log('[AMB/Supabase] conectado');
  } catch (e) {
    erroInicial = e.message;
    console.error('[AMB/Supabase] falhou:', e.message);
  }
  return cliente;
}

const T = cfg.supabase.tabelas;

/** Testa a conexao contando linhas — barato e prova que da pra ler. */
async function testeDeVida() {
  const db = conectar();
  if (!db) return { ok: false, erro: erroInicial };
  try {
    const r = await db.from(T.devolucoes).select('id', { count: 'exact', head: true });
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true, tabela: T.devolucoes, registros: r.count };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/**
 * Ja foi triado? Procura por qualquer identificador conhecido.
 * Evita o estoquista triar a mesma caixa duas vezes.
 */
async function jaTriado({ orderId, tracking, nfNumero }) {
  const db = conectar();
  if (!db) return { ok: false, erro: erroInicial };

  const filtros = [];
  if (orderId)  filtros.push(`order_id.eq.${orderId}`);
  if (tracking) filtros.push(`tracking.eq.${tracking}`);
  if (nfNumero) filtros.push(`nf_numero.eq.${nfNumero}`);
  if (filtros.length === 0) return { ok: true, triado: false };

  try {
    const r = await db.from(T.devolucoes)
      .select('id, order_id, tracking, nf_numero, status, funcionario, criado_em')
      .or(filtros.join(','))
      .order('criado_em', { ascending: false })
      .limit(1);
    if (r.error) return { ok: false, erro: r.error.message };
    const achado = (r.data || [])[0] || null;
    return { ok: true, triado: !!achado, registro: achado };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/** Grava uma triagem. Devolve o registro criado. */
async function registrarTriagem(dados) {
  const db = conectar();
  if (!db) return { ok: false, erro: erroInicial };

  const linha = {
    marketplace:         dados.marketplace || null,
    order_id:            dados.order_id || null,
    pack_id:             dados.pack_id || null,
    shipment_id:         dados.shipment_id || null,
    tracking:            dados.tracking || null,
    buyer_nome:          dados.buyer_nome || null,
    pedido_bling_numero: dados.pedido_bling_numero || null,
    produto_titulo:      dados.produto_titulo || null,
    produto_sku:         dados.produto_sku || null,
    produto_qtd:         dados.produto_qtd != null ? Number(dados.produto_qtd) : null,
    nf_numero:           dados.nf_numero || null,
    nf_serie:            dados.nf_serie || null,
    nf_chave:            dados.nf_chave || null,
    nf_valor:            dados.nf_valor != null ? Number(dados.nf_valor) : null,
    nf_data_emissao:     dados.nf_data_emissao || null,
    nf_id_bling:         dados.nf_id_bling || null,
    nf_itens:            dados.nf_itens || null,
    tipo:                dados.tipo || 'devolucao',
    status:              dados.status || 'aprovado',
    funcionario:         dados.funcionario || null,
    problema_descricao:  dados.problema_descricao || null,
    localizacao:         dados.localizacao || null,
    defeito_qtd:         dados.defeito_qtd != null ? Number(dados.defeito_qtd) : null,
  };

  try {
    const r = await db.from(T.devolucoes).insert([linha]).select().limit(1);
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true, registro: (r.data || [])[0] || null };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/** Ultimas triagens, pra tela de acompanhamento. */
async function listarRecentes(limite = 30) {
  const db = conectar();
  if (!db) return { ok: false, erro: erroInicial };
  try {
    const r = await db.from(T.devolucoes)
      .select('id, marketplace, order_id, tracking, nf_numero, buyer_nome, produto_sku, tipo, status, funcionario, criado_em')
      .order('criado_em', { ascending: false })
      .limit(Math.min(Number(limite) || 30, 200));
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true, total: (r.data || []).length, registros: r.data || [] };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

/** Recado preso a um identificador (pedido, NF, chave ou rastreio). */
async function recadoDe(identificador) {
  const db = conectar();
  if (!db || !identificador) return { ok: true, recado: null };
  try {
    const r = await db.from(T.recados)
      .select('*')
      .eq('identificador', String(identificador))
      .eq('resolvido', false)
      .order('criado_em', { ascending: false })
      .limit(1);
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true, recado: (r.data || [])[0] || null };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

module.exports = {
  conectar, testeDeVida,
  jaTriado, registrarTriagem, listarRecentes, recadoDe,
  ligado: () => !!conectar(),
  tabelas: T,
};
