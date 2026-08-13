// ============================================================
// amb-devolucoes/lib-AMB/supabase-AMB.js       (AMB Devol. b20)
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

// b212 (bug real: ele criou o recado pelo numero da venda e, ao bipar a
// mesma devolucao, o estoquista NAO recebeu o aviso) - a mesma venda tem
// VARIOS numeros (order id, pack id, rastreio, NF, chave) e o recado era
// procurado por UM SO. Agora procura por todos de uma vez.
async function recadoDeQualquer(identificadores) {
  const db = conectar();
  const lista = (Array.isArray(identificadores) ? identificadores : [identificadores])
    .map(x => String(x == null ? '' : x).trim())
    .filter(Boolean);
  if (!db || !lista.length) return { ok: true, recado: null };
  try {
    const r = await db.from(T.recados)
      .select('*')
      .in('identificador', Array.from(new Set(lista)))
      .eq('resolvido', false)
      .order('criado_em', { ascending: false })
      .limit(1);
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true, recado: (r.data || [])[0] || null };
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

// ============================================================
// RECADOS — aviso preso a um pedido/NF/rastreio
// ------------------------------------------------------------
// Regra de negocio da GOOD que vale aqui: recado sem ciencia
// TRAVA a triagem. O estoquista precisa clicar "OK, ciente"
// antes de poder aprovar ou reportar. E fica registrado QUEM
// leu — pensando em mais de um estoquista no futuro.
// ============================================================

async function criarRecado({ identificador, texto, criadoPor }) {
  const dbc = conectar();
  if (!dbc) return { ok: false, erro: erroInicial };
  try {
    const r = await dbc.from(T.recados).insert([{
      identificador: String(identificador).trim(),
      texto: String(texto),
      criado_por: criadoPor || null,
    }]).select().limit(1);
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true, recado: (r.data || [])[0] || null };
  } catch (e) { return { ok: false, erro: e.message }; }
}

async function listarRecados({ resolvidos = false, limite = 100 } = {}) {
  const dbc = conectar();
  if (!dbc) return { ok: false, erro: erroInicial };
  try {
    const r = await dbc.from(T.recados)
      .select('*')
      .eq('resolvido', !!resolvidos)
      .order('criado_em', { ascending: false })
      .limit(Math.min(Number(limite) || 100, 300));
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true, total: (r.data || []).length, recados: r.data || [] };
  } catch (e) { return { ok: false, erro: e.message }; }
}

async function marcarCiente(id, quem) {
  const dbc = conectar();
  if (!dbc) return { ok: false, erro: erroInicial };
  try {
    const r = await dbc.from(T.recados)
      .update({ ciente_por: quem, ciente_em: new Date().toISOString() })
      .eq('id', id).select().limit(1);
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true, recado: (r.data || [])[0] || null };
  } catch (e) { return { ok: false, erro: e.message }; }
}

async function resolverRecado(id) {
  const dbc = conectar();
  if (!dbc) return { ok: false, erro: erroInicial };
  try {
    const r = await dbc.from(T.recados).update({ resolvido: true }).eq('id', id);
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true };
  } catch (e) { return { ok: false, erro: e.message }; }
}

// ============================================================
// DEFEITOS — o estoque quebrado, agrupado por onde esta guardado
// ------------------------------------------------------------
// Existem DOIS caminhos, e nao se misturam (regra do Diego na GOOD):
//  1) defeito vindo de DEVOLUCAO  -> tipo 'devolucao', status
//     'problema'. So conta como defeito de verdade depois que a NF
//     e emitida e o item vai pro deposito DEFEITO. Antes disso e
//     so "aguardando NF".
//  2) defeito JA EM ESTOQUE        -> tipo 'defeito_estoque', entra
//     na consulta na hora, sem passar pela fila fiscal.
// ============================================================

async function listarDefeitos({ busca } = {}) {
  const dbc = conectar();
  if (!dbc) return { ok: false, erro: erroInicial };
  try {
    let q = dbc.from(T.devolucoes)
      .select('id, produto_sku, produto_titulo, localizacao, defeito_qtd, problema_descricao, tipo, status, funcionario, nf_numero, criado_em')
      .or('tipo.eq.defeito_estoque,status.eq.problema')
      .order('criado_em', { ascending: false })
      .limit(400);
    const r = await q;
    if (r.error) return { ok: false, erro: r.error.message };

    let linhas = r.data || [];
    if (busca) {
      const b = String(busca).toLowerCase();
      linhas = linhas.filter(x =>
        String(x.produto_sku || '').toLowerCase().includes(b) ||
        String(x.localizacao || '').toLowerCase().includes(b) ||
        String(x.produto_titulo || '').toLowerCase().includes(b) ||
        String(x.nf_numero || '').toLowerCase().includes(b));
    }

    // Agrupa por local + SKU, somando as quantidades — e assim que
    // o estoquista procura: "o que tem na prateleira X".
    const grupos = {};
    let aguardandoNF = 0;
    for (const x of linhas) {
      const contaComoDefeito = x.tipo === 'defeito_estoque' || x.status === 'concluido';
      if (x.status === 'problema' && x.tipo !== 'defeito_estoque') aguardandoNF++;
      const local = x.localizacao || '(sem local)';
      const chave = local + '||' + (x.produto_sku || '?');
      if (!grupos[chave]) {
        grupos[chave] = {
          localizacao: local, sku: x.produto_sku || null,
          produto: x.produto_titulo || null, qtd: 0,
          origem: x.tipo === 'defeito_estoque' ? 'ESTOQUE' : 'DEVOLUCAO',
          defeitos: [], confirmado: contaComoDefeito,
        };
      }
      grupos[chave].qtd += Number(x.defeito_qtd || 1);
      if (x.problema_descricao && grupos[chave].defeitos.length < 6) {
        grupos[chave].defeitos.push(x.problema_descricao);
      }
    }
    const lista = Object.values(grupos).sort((a, b) =>
      String(a.localizacao).localeCompare(String(b.localizacao)));

    return { ok: true, total_linhas: linhas.length, aguardando_nf: aguardandoNF, grupos: lista };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** Peca retirada de uma unidade defeituosa para consertar outra. */
async function registrarPecaRetirada({ defeitoId, peca, usadaEm, quem }) {
  const dbc = conectar();
  if (!dbc) return { ok: false, erro: erroInicial };
  try {
    const r = await dbc.from(T.pecasRetiradas).insert([{
      defeito_id: defeitoId || null,
      peca: peca || null,
      usada_em: usadaEm || null,
      quem: quem || null,
    }]).select().limit(1);
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true, registro: (r.data || [])[0] || null };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** Ha o MESMO SKU guardado em defeito? Base da canibalizacao. */
async function defeitosDoSku(sku) {
  const dbc = conectar();
  if (!dbc || !sku) return { ok: true, unidades: [] };
  try {
    const r = await dbc.from(T.devolucoes)
      .select('id, produto_sku, localizacao, defeito_qtd, problema_descricao, criado_em')
      .eq('produto_sku', String(sku))
      .or('tipo.eq.defeito_estoque,status.eq.problema')
      .order('criado_em', { ascending: false })
      .limit(20);
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true, unidades: r.data || [] };
  } catch (e) { return { ok: false, erro: e.message }; }
}

// ============================================================
// ESPREITA — anotacoes e baixa manual das devolucoes a caminho
// ============================================================

async function notaEspreita({ chave, marketplace, comentario, ticket, baixado }) {
  const dbc = conectar();
  if (!dbc) return { ok: false, erro: erroInicial };
  try {
    const linha = { chave: String(chave), marketplace: marketplace || null, atualizado_em: new Date().toISOString() };
    if (comentario !== undefined) linha.comentario = comentario;
    if (ticket !== undefined) linha.ticket = ticket;
    if (baixado !== undefined) linha.baixado = !!baixado;
    const r = await dbc.from(T.espreitaNotas).upsert([linha], { onConflict: 'chave' }).select().limit(1);
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true, nota: (r.data || [])[0] || null };
  } catch (e) { return { ok: false, erro: e.message }; }
}

async function notasEspreita() {
  const dbc = conectar();
  if (!dbc) return { ok: true, notas: {} };
  try {
    const r = await dbc.from(T.espreitaNotas).select('*').limit(1000);
    if (r.error) return { ok: false, erro: r.error.message };
    const mapa = {};
    for (const n of (r.data || [])) mapa[n.chave] = n;
    return { ok: true, notas: mapa };
  } catch (e) { return { ok: false, erro: e.message }; }
}

// ============================================================
// FILAS DO PAINEL — a triagem dividida como na GOOD:
//   'aprovado' -> Aprovadas, aguardando a NF de devolucao
//   'problema' -> Problemas reportados
//   'finalizado' -> ja concluida (some das filas)
// ============================================================

async function listarFila({ status, limite = 80 } = {}) {
  const dbc = conectar();
  if (!dbc) return { ok: false, erro: erroInicial };
  try {
    const r = await dbc.from(T.devolucoes)
      .select('*')
      .eq('status', String(status))
      .order('criado_em', { ascending: false })
      .limit(Math.min(Number(limite) || 80, 200));
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: true, total: (r.data || []).length, registros: r.data || [] };
  } catch (e) { return { ok: false, erro: e.message }; }
}

async function obterTriagem(id) {
  const dbc = conectar();
  if (!dbc) return { ok: false, erro: erroInicial };
  try {
    const r = await dbc.from(T.devolucoes).select('*').eq('id', id).limit(1);
    if (r.error) return { ok: false, erro: r.error.message };
    if (!r.data || !r.data.length) return { ok: false, erro: 'triagem nao encontrada' };
    return { ok: true, registro: r.data[0] };
  } catch (e) { return { ok: false, erro: e.message }; }
}

/** Atualiza campos de uma triagem (concluir, registrar NF gerada...). */
async function atualizarTriagem(id, campos) {
  const dbc = conectar();
  if (!dbc) return { ok: false, erro: erroInicial };
  try {
    const r = await dbc.from(T.devolucoes)
      .update(campos).eq('id', id).select().limit(1);
    if (r.error) return { ok: false, erro: r.error.message };
    if (!r.data || !r.data.length) return { ok: false, erro: 'triagem nao encontrada' };
    return { ok: true, registro: r.data[0] };
  } catch (e) { return { ok: false, erro: e.message }; }
}

module.exports = {
  conectar, testeDeVida,
  jaTriado, registrarTriagem, listarRecentes, recadoDe, recadoDeQualquer,   // b212
  listarFila, atualizarTriagem, obterTriagem,
  criarRecado, listarRecados, marcarCiente, resolverRecado,
  listarDefeitos, registrarPecaRetirada, defeitosDoSku,
  notaEspreita, notasEspreita,
  ligado: () => !!conectar(),
  tabelas: T,
};
