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

/**
 * b165 - TRIAGENS JA FEITAS de um identificador (a "pre-trava" do bipe).
 *
 * A GOOD tem /api/triagem/status ha tempos; a AMB nunca teve, mas o front
 * dela — copiado da GOOD — CHAMA essa rota. A chamada dava 404, caia no
 * catch do JavaScript e a tela mostrava os botoes de triagem como se o
 * pacote fosse novo. Falha silenciosa: em 29/08 o mesmo pacote foi triado
 * duas vezes na AMB sem nenhum aviso.
 *
 * A tabela da AMB usa outro vocabulario: `criado_em` (nao `created_at`) e
 * `tipo` sempre 'devolucao', com o desfecho no `status`. O front espera o
 * jeito da GOOD, entao a traducao acontece AQUI, num lugar so.
 */
async function triagensDe(identificadores) {
  const db = conectar();
  if (!db) return { ok: false, erro: erroInicial };

  const ids = (Array.isArray(identificadores) ? identificadores : [identificadores])
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (!ids.length) return { ok: true, registros: [] };

  const filtros = [];
  for (const id of ids) {
    // o mesmo saneamento da GOOD: PostgREST separa por virgula e usa aspas
    const seguro = id.replace(/["',()]/g, '');
    if (!seguro) continue;
    filtros.push(`shipment_id.eq.${seguro}`);
    filtros.push(`order_id.eq.${seguro}`);
    // b167 - o PACK amarra IDA e VOLTA da mesma venda. Medido em 29/08 com
    // as duas etiquetas na mao: a da nossa postagem (envio 47501559178) e a
    // que o ML deu pro cliente devolver (47528658744) tem shipments
    // DIFERENTES e o MESMO pack 2000013967364577. Sem procurar por ele, o
    // segundo bipe parecia uma devolucao nova.
    filtros.push(`pack_id.eq.${seguro}`);
    // b166 (Codex): tracking e nf_numero TAMBEM identificam. A rota
    // /api/triagem/registrar aceita e grava os dois, e o jaTriado que ja
    // existia aqui procurava por eles. Sem estas duas linhas, um pacote
    // gravado so por tracking (Correios) ou so pelo numero da NF passava
    // batido e podia ser triado de novo — que e justamente o que esta
    // rota veio impedir.
    filtros.push(`tracking.eq.${seguro}`);
    filtros.push(`nf_numero.eq.${seguro}`);
    if (/^\d{44}$/.test(seguro)) filtros.push(`nf_chave.eq.${seguro}`);
  }
  if (!filtros.length) return { ok: true, registros: [] };

  try {
    const r = await db.from(T.devolucoes)
      .select('id, criado_em, tipo, status, problema_descricao, nf_numero, produto_qtd, funcionario, shipment_id, order_id, pack_id, nf_chave')
      .or(filtros.join(','))
      .order('criado_em', { ascending: false });
    if (r.error) return { ok: false, erro: r.error.message };

    // traduz pro vocabulario que o front (vindo da GOOD) entende
    const registros = (r.data || []).map((x) => ({
      ...x,
      created_at: x.criado_em,
      // na AMB o `tipo` e sempre 'devolucao' e o desfecho mora no status;
      // na GOOD o tipo E o desfecho. Aqui a gente entrega como a GOOD.
      tipo: x.tipo && x.tipo !== 'devolucao' ? x.tipo : (x.status || 'aprovado'),
      status_original: x.status,
      // b166.2 (Codex): a tela agora le o campo `funcionario` direto (vem no
      // select acima), entao nao precisa mais inventar marcador dentro da
      // descricao — o que so funcionava pra nome de uma palavra sem acento.
      // A descricao volta a ser o que e: a descricao.
      problema_descricao: x.problema_descricao,
    }));
    return { ok: true, registros };
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
      // b214/b215 (review do Codex) - TODOS os recados ativos, sem teto: com
      // dois avisos na mesma devolucao o estoquista dava ciencia em um e a
      // triagem DESTRAVAVA. E um teto (era 20) esconderia os mais antigos
      // pra sempre, ja que eles continuam `resolvido = false`.
      ;
    if (r.error) return { ok: false, erro: r.error.message };
    const recados = r.data || [];
    return { ok: true, recados, recado: recados[0] || null };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// b245 - DE-PARA DE SKU (pedido do Diego, 14/08)
//
// O anuncio Full do ML nao deixa trocar o SKU depois que tem vendas, e o
// produto foi RENOMEADO no Bling: a venda carrega `FL-1011-PRETO`, o
// cadastro hoje e `3933398010054`. O Bling nao guarda esse historico (a NF
// so tem texto, sem id do produto — conferido no raio-x), entao a memoria
// fica aqui: quando o sistema esbarrar no SKU antigo, ele passa a valer
// como o atual — inclusive pra NF de devolucao, onde o SKU que comanda e
// o NOVO.
// ═══════════════════════════════════════════════════════════════════
const DEPARA_CACHE = new Map();   // sku_antigo -> { sku_atual, produto_id, ts }

async function resolverSku(skuBruto) {
  const sku = String(skuBruto || '').trim();
  if (!sku) return { sku, trocado: false };
  const emCache = DEPARA_CACHE.get(sku.toUpperCase());
  if (emCache && (Date.now() - emCache.ts) < 30 * 60 * 1000) {
    return { sku: emCache.sku_atual || sku, produto_id: emCache.produto_id || null, trocado: !!emCache.sku_atual, cache: true };
  }
  const db = conectar();
  if (!db) return { sku, trocado: false };
  try {
    const r = await db.from(T.skuDepara).select('*').eq('sku_antigo', sku).limit(1);
    if (r.error) return { sku, trocado: false, erro: r.error.message };
    const linha = (r.data || [])[0] || null;
    if (!linha) { DEPARA_CACHE.set(sku.toUpperCase(), { sku_atual: null, produto_id: null, ts: Date.now() }); return { sku, trocado: false }; }
    DEPARA_CACHE.set(sku.toUpperCase(), { sku_atual: linha.sku_atual, produto_id: linha.produto_id, ts: Date.now() });
    return { sku: linha.sku_atual || sku, produto_id: linha.produto_id || null, trocado: !!linha.sku_atual, de: sku };
  } catch (e) { return { sku, trocado: false, erro: e.message }; }
}

async function salvarDepara({ sku_antigo, sku_atual, produto_id, quem }) {
  const db = conectar();
  if (!db) return { ok: false, erro: erroInicial };
  const antigo = String(sku_antigo || '').trim();
  const atual = String(sku_atual || '').trim();
  if (!antigo || !atual) return { ok: false, erro: 'informe o SKU antigo e o atual' };
  if (antigo.toUpperCase() === atual.toUpperCase()) return { ok: false, erro: 'os dois SKUs sao iguais' };
  try {
    const r = await db.from(T.skuDepara).upsert({
      sku_antigo: antigo, sku_atual: atual,
      produto_id: produto_id || null,
      criado_por: quem || null, criado_em: new Date().toISOString(),
    }, { onConflict: 'sku_antigo' }).select().limit(1);
    if (r.error) return { ok: false, erro: r.error.message };
    DEPARA_CACHE.delete(antigo.toUpperCase());
    return { ok: true, linha: (r.data || [])[0] || null };
  } catch (e) { return { ok: false, erro: e.message }; }
}

// b259 - CORRECAO RETROATIVA: registros gravados ANTES do de-para existir
// ficaram com o codigo aposentado. Sem isto, o historico do produto segue
// partido em dois SKUs e o alerta de canibalizacao nao junta as unidades.
// `aplicar: false` = so a PREVIA (nao escreve nada). Mexer em registro
// gravado sem mostrar o que muda e pedir problema.
async function corrigirSkusAntigos({ aplicar = false } = {}) {
  const db = conectar();
  if (!db) return { ok: false, erro: erroInicial };
  const dp = await listarDepara();
  if (!dp.ok) return { ok: false, erro: dp.erro || 'nao consegui ler o de-para' };
  const ligacoes = (dp.lista || []).filter(x => x && x.sku_antigo && x.sku_atual);
  if (!ligacoes.length) return { ok: true, ligacoes: 0, registros: [], total: 0 };

  const antigos = ligacoes.map(x => String(x.sku_antigo));
  try {
    const r = await db.from(T.devolucoes)
      .select('id, produto_sku, produto_titulo, criado_em, tipo, status')
      .in('produto_sku', antigos)
      .limit(500);
    if (r.error) return { ok: false, erro: r.error.message };
    const alvo = r.data || [];
    const paraQual = {};
    for (const l of ligacoes) paraQual[String(l.sku_antigo).toUpperCase()] = l.sku_atual;
    const registros = alvo.map(x => ({
      id: x.id, de: x.produto_sku,
      para: paraQual[String(x.produto_sku || '').toUpperCase()] || null,
      titulo: x.produto_titulo || null, criado_em: x.criado_em || null,
    })).filter(x => x.para);

    if (!aplicar) return { ok: true, previa: true, total: registros.length, registros: registros.slice(0, 50), ligacoes: ligacoes.length };

    let trocados = 0;
    const falhas = [];
    let semColunaOrigem = false;
    for (const reg of registros) {
      // b262 - GUARDA O CÓDIGO ANTERIOR. A correcao reescreve um registro ja
      // gravado e, ate aqui, era irreversivel pela tela: o codigo antigo
      // sumia. Agora ele fica em `produto_sku_origem` — da pra auditar e
      // desfazer. Tolerante: se a coluna ainda nao existir no banco, grava
      // so o SKU (o conserto principal nao pode depender do ALTER TABLE).
      let u = semColunaOrigem
        ? await db.from(T.devolucoes).update({ produto_sku: reg.para }).eq('id', reg.id)
        : await db.from(T.devolucoes)
            .update({ produto_sku: reg.para, produto_sku_origem: reg.de })
            .eq('id', reg.id);
      if (u.error && !semColunaOrigem && /produto_sku_origem/i.test(u.error.message || '')) {
        semColunaOrigem = true;
        u = await db.from(T.devolucoes).update({ produto_sku: reg.para }).eq('id', reg.id);
      }
      if (u.error) falhas.push({ id: reg.id, erro: u.error.message });
      else trocados++;
    }
    return {
      ok: true, previa: false, total: registros.length, trocados,
      falhas: falhas.slice(0, 10),
      // b262 - avisa se o codigo antigo NAO pode ser guardado
      origem_guardada: !semColunaOrigem,
      aviso: semColunaOrigem
        ? 'a coluna produto_sku_origem nao existe: corrigi os registros, mas o codigo anterior nao ficou guardado'
        : null,
    };
  } catch (e) { return { ok: false, erro: e.message }; }
}

async function listarDepara() {
  const db = conectar();
  if (!db) return { ok: false, erro: erroInicial, lista: [] };
  try {
    const r = await db.from(T.skuDepara).select('*').order('criado_em', { ascending: false }).limit(200);
    if (r.error) return { ok: false, erro: r.error.message, lista: [] };
    return { ok: true, lista: r.data || [] };
  } catch (e) { return { ok: false, erro: e.message, lista: [] }; }
}

async function apagarDepara(skuAntigo) {
  const db = conectar();
  if (!db) return { ok: false, erro: erroInicial };
  try {
    const r = await db.from(T.skuDepara).delete().eq('sku_antigo', String(skuAntigo || '').trim());
    if (r.error) return { ok: false, erro: r.error.message };
    DEPARA_CACHE.delete(String(skuAntigo || '').trim().toUpperCase());
    return { ok: true };
  } catch (e) { return { ok: false, erro: e.message }; }
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

// b219 (pedido do Diego: "tem q dar opcao de eu editar o recado se eu
// quiser tb. caso eu queira adicionar mais dados") - edita o texto e/ou o
// identificador. Nao mexe em ciencia nem em resolvido: quem ja leu, leu.
async function editarRecado(id, { identificador, texto } = {}) {
  const dbc = conectar();
  if (!dbc) return { ok: false, erro: erroInicial };
  const campos = {};
  if (identificador != null && String(identificador).trim()) campos.identificador = String(identificador).trim();
  if (texto != null && String(texto).trim()) campos.texto = String(texto).trim();
  if (!Object.keys(campos).length) return { ok: false, erro: 'nada pra alterar' };
  try {
    // b225.2 (Codex): so zera o ciente se algo MUDOU. "Salvar" sem tocar em
    // nada nao pode botar o recado de volta na frente do estoquista.
    const a = await dbc.from(T.recados).select('identificador, texto').eq('id', id).limit(1);
    const antes = (a.data || [])[0] || {};
    const mudou = (campos.identificador !== undefined && campos.identificador !== antes.identificador)
      || (campos.texto !== undefined && campos.texto !== antes.texto);
    if (!mudou) return { ok: true, recado: antes, sem_mudanca: true };
    // b225.1 (Codex): EDITOU = precisa ser lido de novo
    campos.ciente_em = null;
    campos.ciente_por = null;
    const r = await dbc.from(T.recados).update(campos).eq('id', id).select().limit(1);
    if (r.error) return { ok: false, erro: r.error.message };
    const linha = (r.data || [])[0] || null;
    if (!linha) return { ok: false, erro: 'recado nao encontrado' };
    return { ok: true, recado: linha };
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
      // b278.4 (Codex): o `tipo` cobre o caso NOVO (o codigo atualiza a
      // linha de origem). O caso ANTIGO nao — ali o estado terminal vive
      // so no PEDIDO de recuperacao/descarte, e a linha continua
      // `defeito_estoque`. Por isso preciso das duas exclusoes: esta, e a
      // por `defeito_id` mais abaixo (como o defeitos-ciclo-AMB ja faz
      // com o `porPedido`).
      .not('tipo', 'in', '(recuperado,descartado,defeito_excluido)');

    // b278.2 (Codex): a BUSCA vai ao BANCO, nao filtra em memoria depois.
    //
    // Meu aviso do teto dizia "use a busca por SKU/local" — mas a busca
    // rodava DEPOIS do `.limit(400)`, entao procurar um defeito antigo que
    // ficou de fora nao achava nada. O conselho era inutil justamente no
    // caso que ele veio resolver.
    if (busca) {
      // b278.3 (Codex): NAO tirar pontuacao do termo. `D'Agua` virava
      // `DAgua` e deixava de casar com o valor guardado. O que quebra o
      // PostgREST e a virgula (separa condicoes no `or`) e o parentese —
      // escapo com aspas em vez de apagar.
      const b = String(busca).trim();
      if (b) {
        // b278.4 (Codex): escapar os CURINGAS do ILIKE. `_` e `%` sao
        // padroes no SQL (qualquer caractere / qualquer sequencia) e o `*`
        // vira `%` no PostgREST. Um SKU como `KJBD_179` casaria com
        // `KJBD-179` e dezenas de outros, enchendo as 400 vagas com
        // parecidos MAIS NOVOS — e o exato, mais antigo, ficaria de fora.
        //
        // Escapo com `\` (ESCAPE padrao do LIKE). As aspas continuam,
        // pra virgula e parentese seguirem literais.
        // b278.7 (Codex): a ASPA tambem e conteudo. `Modelo "Pro"` virava
        // `Modelo Pro` e deixava de casar. Dentro de um valor entre aspas o
        // PostgREST aceita `\"` — escapo, nao apago.
        const t = '"*' + b.replace(/([\\%_*])/g, '\\$1').replace(/"/g, '\\"') + '*"';
        q = q.or([
          `produto_sku.ilike.${t}`,
          `localizacao.ilike.${t}`,
          `produto_titulo.ilike.${t}`,
          `nf_numero.ilike.${t}`,
        ].join(','));
      }
    }

    // b278.4 (Codex): os RESOLVIDOS POR PEDIDO. O `defeitos-ciclo-AMB` ja
    // faz isso (`porPedido`, linha 376): pedido autorizado ou concluido =
    // a peca saiu do estoque de defeitos, mesmo que a linha de origem
    // continue marcada como `defeito_estoque`. Sem isso a tela mostra como
    // disponivel algo que ja foi recuperado ou descartado.
    const resolvidosPorPedido = new Set();
    try {
      const rped = await dbc.from('defeito_pedidos_amb')
        .select('defeito_id, status')
        .in('status', ['autorizado', 'concluido']);
      for (const pd of (rped.data || [])) {
        if (pd.defeito_id) resolvidosPorPedido.add(String(pd.defeito_id));
      }
    } catch (e) { /* sem os pedidos, vale so o tipo da linha */ }

    // b278.5 (Codex): EXCLUIR ANTES DO LIMITE. Eu filtrava os resolvidos
    // por pedido DEPOIS da consulta — e ai eles ocupavam vaga dentro das
    // 400, empurrando defeito ativo antigo pra fora. E EXATAMENTE o bug que
    // a GOOD teve (`idsForaDoEstado`, lib/defeitos-ciclo.js) e que eu disse
    // que a AMB nao tinha. Meu conserto anterior criou ele.
    //
    // Mesma saida da GOOD: os ids entram na consulta enquanto couberem na
    // URL; passando disso, a exclusao volta a ser em memoria e o limite
    // CRESCE pelo tanto que sera descartado, pra sobrarem 400 uteis.
    // b278.6 (Codex): com MUITOS resolvidos, nem o teto de 1000 basta —
    // eles ocupam as linhas mais novas e sobram menos de 400 ativos, com o
    // `bateuNoTeto` marcando FALSO (a contagem e feita depois da exclusao).
    // A tela mostraria inventario "completo" faltando defeito antigo.
    //
    // Em vez de paginar (mais chamadas, mais cota), mando a lista em LOTES
    // de 150 ids: `not.in` aceita varios, e assim a exclusao acontece SEMPRE
    // no banco, sem estourar a URL. O limite volta a ser 400 puros.
    // b278.7 (Codex): MEU LOOP DE LOTES NAO CRIAVA REQUISICOES. Cada
    // `q.not(...)` so acrescenta mais um filtro na MESMA URL do GET — os
    // 1.200 ids continuavam numa requisicao so, que era o problema que eu
    // queria evitar. "Lote" sem requisicao separada nao e lote.
    //
    // Volto ao que a GOOD faz e que funciona: UMA lista de ids enquanto
    // couber na URL; passando disso, a exclusao e em memoria e o limite
    // cresce pra compensar. Sem invencao.
    const MAX_IDS_NA_URL = 150;
    const idsResolvidos = [...resolvidosPorPedido];
    if (idsResolvidos.length && idsResolvidos.length <= MAX_IDS_NA_URL) {
      q = q.not('id', 'in', '(' + idsResolvidos.join(',') + ')');
    }
    const sobrouFora = idsResolvidos.length > MAX_IDS_NA_URL ? idsResolvidos.length : 0;
    const limite = sobrouFora > 0 ? Math.min(1000, 400 + sobrouFora) : 400;
    q = q.order('criado_em', { ascending: false }).limit(limite);
    const r = await q;
    if (r.error) return { ok: false, erro: r.error.message };

    let linhas = r.data || [];
    // rede de seguranca: se os ids nao couberam na URL, corta aqui
    linhas = linhas.filter((x) => !resolvidosPorPedido.has(String(x.id)));
    // b278 - AVISAR QUANDO BATE NO TETO, em vez de sumir calado.
    //
    // Medi a GOOD e a AMB lado a lado: a GOOD tinha um sumico causado por
    // itens JA RESOLVIDOS ocupando vaga dentro do limite (consertado la com
    // `idsForaDoEstado`/`limiteDaConsulta`). A AMB NAO tem esse caso — ela
    // filtra por tipo/status direto, sem o historico antigo que gerava o
    // conflito. Portar aquelas funcoes pra ca seria trazer complexidade pra
    // um problema que ela nao tem.
    //
    // O risco que RESTA e outro e mais simples: se passar de 400 ativos, os
    // mais ANTIGOS somem da lista sem ninguem perceber (ordem DESC). Nao
    // aumento o teto no escuro — aviso, e ai da pra decidir com numero.
    // b278.6 (Codex): o teto se mede pelo que SOBROU util. Medir o retorno
    // cru do banco dava falso NEGATIVO quando muitos resolvidos vinham
    // dentro do lote: a tela dizia "completo" faltando defeito antigo.
    const bateuNoTeto = linhas.length >= 400 || (sobrouFora > 0 && linhas.length >= limite - sobrouFora);
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

    // b278.2: busca as pecas retiradas dos itens desta pagina (tabela
    // propria da AMB: `pecas_retiradas_amb`). Uma consulta so, por lote.
    const pecasPorDefeito = {};
    try {
      const ids = linhas.map((x) => x.id).filter(Boolean);
      if (ids.length) {
        const rp = await dbc.from(T.pecasRetiradas)
          .select('defeito_id, peca, quem, criado_em, usada_em')
          .in('defeito_id', ids);
        for (const pc of (rp.data || [])) {
          (pecasPorDefeito[pc.defeito_id] = pecasPorDefeito[pc.defeito_id] || []).push(pc);
        }
      }
    } catch (e) { /* tabela pode nao existir ainda: segue sem o historico */ }

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

    return {
      ok: true,
      total_linhas: linhas.length, aguardando_nf: aguardandoNF, grupos: lista,
      // b278 - ⚠️ A TELA DE DEFEITOS DA AMB ESTAVA MOSTRANDO LISTA VAZIA.
      //
      // `defeitos-AMB.html` e copia da tela da GOOD e le `itens`,
      // `total_registros` e `total_pecas` — que o servidor da AMB NUNCA
      // mandou (ele manda `grupos` e `total_linhas`). Resultado na tela:
      // "undefined registro(s)" e nenhum defeito listado.
      //
      // Achei procurando outra coisa: fui portar um conserto da GOOD e,
      // ao conferir o produtor antes de mexer (regra 4.12), vi que a tela
      // lia campo que ninguem produz. E a mesma classe que o
      // `campo-tem-produtor` pega no server.js — aqui era entre HTML e
      // servidor, que nenhum teste cobria.
      //
      // Mantenho os nomes atuais (alguem pode usar) e acrescento os que a
      // tela espera, com o MESMO significado da GOOD.
      // b278.1 (Codex): `itens` no MOLDE DA TELA, nao os grupos.
      //
      // Meu conserto anterior igualou so os nomes de topo e entregou `lista`
      // (agrupada: `localizacao`, `defeitos[]`, origem MAIUSCULA). A tela le
      // `it.local`, `oc.defeito`, `oc.quando`, `oc.nf` e compara
      // `origem === 'estoque'` minusculo — entao tudo caia em "(sem local)",
      // sem descricao e sem data. Consertei pela metade.
      //
      // Agora e linha a linha, no mesmo formato da GOOD (server.js, rota
      // /api/defeitos) — que e de onde a tela foi copiada.
      //
      // ⚠️ E SO O QUE JA E DEFEITO: `status === 'problema'` sem
      // `defeito_estoque` e devolucao AGUARDANDO NF, que a propria funcao
      // conta em `aguardando_nf`. Mostrar como defeito seria contar duas
      // vezes a mesma peca — numero errado e pior que numero ausente.
      total_registros: linhas.filter((x) => x.tipo === 'defeito_estoque' || x.status === 'concluido').length,
      total_pecas: linhas
        .filter((x) => x.tipo === 'defeito_estoque' || x.status === 'concluido')
        .reduce((a, x) => a + (Number(x.defeito_qtd) || 1), 0),
      itens: linhas
        .filter((x) => x.tipo === 'defeito_estoque' || x.status === 'concluido')
        .map((x) => ({
          // b278.2 (Codex): o historico de PECAS RETIRADAS. A tela mostra
          // "ja retirado daqui" so a partir de `oc.pecas_retiradas` — sem
          // isso o estoquista pega uma peca que ja saiu do item, e o aviso
          // sumia calado. A GOOD ja anexa (server.js:3328); portado.
          pecas_retiradas: (pecasPorDefeito[x.id] || []).map((pc) => ({
            peca: pc.peca, quem: pc.quem, quando: pc.criado_em, usada_em: pc.usada_em,
          })),
          id: x.id,
          quando: x.criado_em || null,
          produto: x.produto_titulo || null,
          sku: x.produto_sku || null,
          nf: x.nf_numero || null,
          local: x.localizacao || null,
          qtd: x.defeito_qtd || null,
          defeito: String(x.problema_descricao || '')
            .replace(/^\[RE-BIPE\]\s*/, '')
            .replace(/^\[Reportado por [^\]]+\]\s*/, '')
            .replace(/^\[LANCADO MANUAL por [^\]]+\]\s*/, ''),
          origem: x.tipo === 'defeito_estoque' ? 'estoque' : 'devolucao',
          status: x.status,
        })),
      // o teto foi atingido — pode haver defeito ANTIGO fora da lista
      teto_atingido: bateuNoTeto || undefined, teto: bateuNoTeto ? 400 : undefined,
    };
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
  triagensDe,
  conectar, testeDeVida,
  jaTriado, registrarTriagem, listarRecentes, recadoDe, recadoDeQualquer,   // b212
  resolverSku, salvarDepara, listarDepara, apagarDepara,   // b245 - de-para de SKU
  corrigirSkusAntigos,   // b259
  editarRecado,   // b219
  listarFila, atualizarTriagem, obterTriagem,
  criarRecado, listarRecados, marcarCiente, resolverRecado,
  listarDefeitos, registrarPecaRetirada, defeitosDoSku,
  notaEspreita, notasEspreita,
  ligado: () => !!conectar(),
  tabelas: T,
  // b191 - expõe o cliente pra rotas que consultam direto (o card de
  // estornadas sem retorno). As funcoes acima continuam sendo o caminho
  // preferido; isto e pra consulta pontual que nao merece funcao propria.
  cliente: () => conectar(),
};
