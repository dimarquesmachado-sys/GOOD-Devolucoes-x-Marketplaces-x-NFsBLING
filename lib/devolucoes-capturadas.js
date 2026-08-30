// ============================================================
// lib/devolucoes-capturadas.js
// ------------------------------------------------------------
// GUARDA o que os marketplaces contam sobre devolucoes, pra que o
// dado esteja AQUI quando o pacote chegar no galpao.
//
// Ideia do dono (29/08/2026):
//
//   "tinha q ter um cron a meia noite pra pegar esses dados
//    previamente, ate pq a devolucao sempre demora mais q 1 dia
//    pra chegar ate nos"
//
// POR QUE ISTO EXISTE
//
// O "a espreita" ja varre ML, Shopee e Magalu — mas remonta tudo do
// zero a cada 3 minutos e vive so em memoria. Reiniciou, perdeu. Tres
// consequencias que ja custaram caro:
//
//   1. DEVOLUCAO SOME. Quando o marketplace para de devolve-la (saiu
//      da janela, mudou de status, a rota quebrou), ela desaparece
//      como se nunca tivesse existido. Foi o que aconteceu em 29/08
//      com a Shopee: uma rota duplicada no servico devolvia lista
//      vazia e NENHUMA etiqueta casava.
//   2. A BANCADA ESPERA. Bipar consulta o marketplace na hora.
//   3. NAO DA PRA OLHAR PRA TRAS. "Quantas devolucoes por motivo no
//      trimestre" e uma pergunta sem resposta hoje.
//
// O QUE ESTE MODULO NAO FAZ
//
// Nao decide nada, nao emite nota, nao mexe na triagem. E espelho:
// grava o que o marketplace disse, com o JSON cru junto. Quem decide
// continua sendo a triagem (tabelas `devolucoes` e `devolucoes_amb`),
// que sao dados FISCAIS e ficam separadas por empresa de proposito.
//
// Esquema e o SQL: docs/TABELA-DEVOLUCOES-CAPTURADAS.md
// ============================================================

const TABELA = 'devolucoes_capturadas';

/**
 * Traduz uma devolucao do formato do "a espreita" para o da tabela.
 *
 * O espreita ja unifica os tres marketplaces num formato comum — e por
 * isso ele e a fonte aqui, em vez de eu reescrever tres integracoes.
 *
 * Devolve null quando nao da pra identificar a devolucao: sem chave nao
 * existe upsert possivel, e gravar linha orfa so suja a tabela.
 */
function traduzir(d, empresa) {
  if (!d || !empresa) return null;

  const marketplace = String(d.marketplace || '').trim().toLowerCase();
  if (!marketplace) return null;

  // A CHAVE e o que identifica esta devolucao NAQUELE marketplace, e e
  // por ela que o upsert decide "e a mesma" — entao tem que ser estavel
  // entre uma madrugada e outra.
  //
  // Ordem pensada: o rastreio da reversa e o mais estavel quando existe
  // (nao muda de status pra status). Sem ele, marketplace+pedido serve,
  // e e o que o proprio espreita ja usa como chave (chaveEspreita).
  // b184.3 (Codex): o ID DA SOLICITACAO vem primeiro quando existe.
  //
  // No TikTok, um pedido pode ter VARIAS solicitacoes (uma por item da
  // nota) e o reembolso puro nao tem rastreio. Caindo no `pedido`, todas
  // as irmas dividiriam a mesma chave unica — e o upsert faria a segunda
  // SOBRESCREVER a primeira. O painel mostraria uma so.
  const chave = String(
    d.id || d.return_id
    || d.shipment_devolucao || d.tracking || d.chave || d.pedido || ''
  ).trim();
  if (!chave) return null;

  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const txt = (v, max) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return max && s.length > max ? s.slice(0, max) : s;
  };

  return {
    empresa: String(empresa).trim().toLowerCase(),
    marketplace,
    chave_marketplace: chave,

    pedido: txt(d.pedido, 80),
    pack: txt(d.pack_id, 80),
    shipment: txt(d.shipment_devolucao || d.shipment, 80),
    // b184.4 (Codex): aceitar os nomes do formato NORMALIZADO do TikTok.
    //
    // tiktokDev.normalizar() entrega `rastreio`, `nf_numero` e `nf_chave`;
    // eu so lia `tracking`, `nf` e `chave_nota`, do espreita. Resultado: a
    // etiqueta do TikTok era gravada SEM rastreio, e bipar o codigo dela
    // nao achava o registro capturado — que e a razao de existir da busca
    // por identificador. A NF ia junto: sem ela, o painel de estornadas
    // calculava o prazo pela devolucao e podia sugerir cancelar uma nota
    // ja intempestiva.
    rastreio: txt(d.rastreio || d.tracking, 120),
    nf_numero: txt(d.nf_numero || d.nf, 40),
    nf_chave: txt(d.nf_chave || d.chave_nota, 60),

    cliente_nome: txt(d.cliente, 200),
    // b184.4 (Codex): o TikTok traz os itens em LISTA (`itens`), o espreita
    // traz escalares. Sem achatar, toda devolucao do TikTok era gravada com
    // produto nulo — e o painel mostrava "-", sem SKU nem quantidade, que e
    // justamente o que o dono precisa pra emitir a NF de devolucao.
    //
    // Com mais de um item, junto os SKUs e somo as quantidades: o registro e
    // da SOLICITACAO, e ela pode cobrir varios itens.
    produto_sku: txt(
      d.sku || (Array.isArray(d.itens) && d.itens.length
        ? d.itens.map((i) => i && i.sku).filter(Boolean).join(', ') : null), 120),
    produto_titulo: txt(
      d.produto || (Array.isArray(d.itens) && d.itens.length
        ? d.itens.map((i) => i && i.nome).filter(Boolean).join(' + ') : null), 400),
    produto_qtd: d.qtd != null ? (parseInt(d.qtd, 10) || null)
      : (Array.isArray(d.itens) && d.itens.length
        ? d.itens.reduce((t, i) => t + (parseInt(i && i.qtd, 10) || 0), 0) || null
        : null),

    // b184.2 (Codex): o TIPO do TikTok vira COLUNA, nao so campo dentro do
    // `cru`. E por ele que o painel de estornadas separa reembolso puro
    // (nunca vira pacote) de devolucao com retorno — e filtrar dentro de
    // jsonb no Supabase e mais fragil e mais lento que uma coluna.
    tipo_tiktok: txt(d.tipo_tiktok || d.tipo, 40),

    status: txt(d.status || d.categoria, 120),
    motivo: txt(d.motivo || d.categoria, 200),
    motivo_texto: txt(d.motivo_texto || d.comentario, 1000),
    valor_refund: num(d.valor),

    // O espreita conta DIAS EM TRANSITO, nao a data de criacao. Como o
    // que interessa e "desde quando esta rolando", converto pra data —
    // assim da pra ordenar e filtrar por periodo depois.
    // b184.3 (Codex): aceitar a data JA PRONTA quando vier.
    //
    // O espreita conta DIAS EM TRANSITO; o TikTok normalizado ja traz
    // `criado_em` como data ISO. Eu so olhava os dias, entao todo registro
    // do TikTok era gravado com data nula — e o painel de estornadas, que
    // filtra por janela, descartaria TODOS eles.
    criado_no_mkt: d.criado_em ? new Date(d.criado_em).toISOString()
      : ((d.dias_em_transito != null && Number.isFinite(Number(d.dias_em_transito)))
        ? new Date(Date.now() - Number(d.dias_em_transito) * 864e5).toISOString()
        : null),
    atualizado_no_mkt: d.atualizado_em ? new Date(d.atualizado_em).toISOString() : null,
    cru: d,
  };
}

/**
 * Grava (ou atualiza) as devolucoes. Uma linha por
 * empresa+marketplace+chave: re-capturar ATUALIZA em vez de duplicar.
 *
 * O `visto_por_ultimo` conta uma historia util: quando ele para de
 * avancar, o marketplace deixou de listar aquela devolucao — mas ela
 * continua aqui, que e exatamente o problema que este modulo resolve.
 */
async function guardar(supabase, linhas) {
  if (!supabase) return { ok: false, erro: 'Supabase nao configurado' };
  const bons = (linhas || []).filter(Boolean);
  if (!bons.length) return { ok: true, gravadas: 0, ignoradas: 0 };

  const agora = new Date().toISOString();
  const comCarimbo = bons.map((l) => ({ ...l, visto_por_ultimo: agora }));

  // Em lotes: um upsert gigante estoura o limite de tamanho da
  // requisicao do PostgREST, e a primeira captura traz meses de uma vez.
  const LOTE = 200;
  let gravadas = 0;
  const erros = [];

  for (let i = 0; i < comCarimbo.length; i += LOTE) {
    const fatia = comCarimbo.slice(i, i + LOTE);
    try {
      const { error } = await supabase
        .from(TABELA)
        .upsert(fatia, { onConflict: 'empresa,marketplace,chave_marketplace' });
      if (error) erros.push(error.message);
      else gravadas += fatia.length;
    } catch (e) {
      erros.push(e.message || String(e));
    }
  }

  return {
    ok: erros.length === 0,
    gravadas,
    ignoradas: (linhas || []).length - bons.length,
    erros: erros.length ? erros.slice(0, 3) : undefined,
  };
}

/**
 * Procura uma devolucao pelos identificadores que a etiqueta traz.
 *
 * Procura por TODAS as portas, pelo mesmo motivo que a pre-trava da
 * triagem: o envio muda entre ida e volta (medido em 29/08 com as duas
 * etiquetas na mao), enquanto pedido, pack e NF nao. Quem so olha o
 * shipment ve duas devolucoes onde existe uma.
 */
async function procurar(supabase, empresa, identificadores) {
  if (!supabase) return { ok: false, erro: 'Supabase nao configurado' };

  const ids = (Array.isArray(identificadores) ? identificadores : [identificadores])
    .map((x) => String(x == null ? '' : x).trim())
    .filter(Boolean);
  if (!ids.length) return { ok: true, achados: [] };

  const ors = [];
  for (const id of ids) {
    // PostgREST separa por virgula e usa aspas: um valor com esses
    // caracteres quebra o filtro inteiro em silencio.
    const seguro = id.replace(/["',()]/g, '');
    if (!seguro) continue;
    for (const campo of ['chave_marketplace', 'pedido', 'pack', 'shipment', 'rastreio', 'nf_numero', 'nf_chave']) {
      ors.push(`${campo}.eq.${seguro}`);
    }
  }
  if (!ors.length) return { ok: true, achados: [] };

  try {
    let sel = supabase.from(TABELA).select('*').or(ors.join(','));
    if (empresa) sel = sel.eq('empresa', String(empresa).toLowerCase());
    const { data, error } = await sel.order('capturado_em', { ascending: false }).limit(20);
    if (error) return { ok: false, erro: error.message };
    return { ok: true, achados: data || [] };
  } catch (e) {
    return { ok: false, erro: e.message || String(e) };
  }
}

/** Quantas linhas, por marketplace — pra saber se a captura esta viva. */
async function resumo(supabase, empresa) {
  if (!supabase) return { ok: false, erro: 'Supabase nao configurado' };
  try {
    let sel = supabase.from(TABELA).select('marketplace, capturado_em, visto_por_ultimo');
    if (empresa) sel = sel.eq('empresa', String(empresa).toLowerCase());
    const { data, error } = await sel.limit(10000);
    if (error) return { ok: false, erro: error.message };

    const porMkt = {};
    let maisRecente = null;
    for (const l of (data || [])) {
      porMkt[l.marketplace] = (porMkt[l.marketplace] || 0) + 1;
      if (!maisRecente || l.visto_por_ultimo > maisRecente) maisRecente = l.visto_por_ultimo;
    }
    return { ok: true, total: (data || []).length, por_marketplace: porMkt, visto_por_ultimo: maisRecente };
  } catch (e) {
    return { ok: false, erro: e.message || String(e) };
  }
}

module.exports = { TABELA, traduzir, guardar, procurar, resumo };
