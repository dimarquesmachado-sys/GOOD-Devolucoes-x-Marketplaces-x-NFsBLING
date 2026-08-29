// ============================================================
// lib/tiktok-devolucoes.js
// ------------------------------------------------------------
// Reconhece uma devolucao do TikTok a partir do que o estoquista
// bipou, e diz se aquele pacote VAI CHEGAR no galpao.
//
// A ponte (lib/tiktok-ponte.js) traz a lista do Mover-Pedidos, onde
// os tokens moram. Este modulo e a camada de cima: casa o codigo e
// traduz o vocabulario do TikTok pro nosso.
//
// ------------------------------------------------------------
// A DISTINCAO QUE O DONO LEVANTOU (29/08)
//
// Nem toda "devolucao" do TikTok vira pacote de volta. Medido nas 99
// da Girassol: cerca de METADE e reembolso puro — o cliente reclama
// ("pacote nao recebido", "faltou item"), o TikTok aceita, reembolsa
// e COMPENSA a loja. Nunca existe retorno fisico.
//
// Um caso real conferido no painel: pedido 585654590105159643,
// entregue e assinado em 24/08; no dia seguinte o cliente abriu "o
// pacote nao foi recebido", o suporte aceitou, reembolsou R$ 29,90 e
// compensou os mesmos R$ 29,90. Pacote nenhum vai chegar.
//
// Nas palavras dele: "o devoluções precisa identificar então que o
// pedido é ou não um pacote em retorno. pode ser q o tiktok equipe
// tenha só estornado o valor, compensado a loja, e daí a devolução
// nunca vai existir".
//
// Por isso todo resultado carrega `vai_chegar`:
//
//   true      RETURN_AND_REFUND — tem retorno fisico
//   false     REFUND — resolvido sem retorno
//   null      ainda em aberto: pode virar qualquer um dos dois
//
// Sem isso, o "a espreita" ficaria esperando pacote que nunca vem —
// e ninguem saberia se extraviou ou se nunca ia existir.
// ============================================================

// O TikTok manda o tipo em maiusculas. RETURN_AND_REFUND devolve o
// produto; REFUND so estorna.
function vaiChegarPacote(d) {
  const tipo = String(d && d.tipo || d && d.return_type || '').toUpperCase();
  if (tipo.indexOf('RETURN') !== -1) return true;    // RETURN_AND_REFUND
  if (tipo === 'REFUND') return false;
  return null;                                        // nao sei dizer
}

// Status em que o desfecho ainda pode mudar. Enquanto a solicitacao
// esta aberta, "so reembolso" pode virar "devolve e reembolsa".
const STATUS_EM_ABERTO = [
  'RETURN_OR_REFUND_REQUEST_PENDING',
  'AWAITING_BUYER_SHIP',
  'AWAITING_SELLER_CONFIRMATION',
];

function estaEmAberto(d) {
  const s = String(d && (d.status || d.return_status) || '').toUpperCase();
  return STATUS_EM_ABERTO.indexOf(s) !== -1;
}

/**
 * Os identificadores pelos quais esta devolucao pode ser encontrada.
 *
 * Medido no `cru_campos_uniao` das 99 da Girassol:
 *   order_id                99 de 99  — sempre tem
 *   return_id               99 de 99  — o id da solicitacao
 *   return_tracking_number  30 de 99  — SO quando ha retorno fisico
 *
 * O rastreio e o que a etiqueta traz, entao e por ele que o bipe casa
 * na maioria das vezes; os outros servem quando o estoquista digita o
 * pedido, ou quando a etiqueta nao tem codigo legivel.
 */
function chavesDe(d) {
  if (!d) return [];
  const brutos = [
    d.rastreio, d.return_tracking_number, d.tracking,
    d.pedido, d.order_id,
    d.id, d.return_id,
  ];
  const vistos = {};
  return brutos
    .map((x) => String(x == null ? '' : x).trim())
    .filter((x) => x && !vistos[x] && (vistos[x] = true));
}

/** Traduz uma devolucao do TikTok pro formato que o resto do app usa. */
function normalizar(d, empresa) {
  if (!d) return null;
  const vaiChegar = vaiChegarPacote(d);
  const emAberto = estaEmAberto(d);

  return {
    marketplace: 'tiktok',
    empresa: empresa ? String(empresa).toLowerCase() : null,

    // identificadores
    id: String(d.id || d.return_id || ''),
    pedido: d.pedido || d.order_id || null,
    rastreio: d.rastreio || d.return_tracking_number || null,

    // o que o dono pediu pra distinguir
    vai_chegar: emAberto && vaiChegar === false ? null : vaiChegar,
    em_aberto: emAberto,

    // ── o retrato do TRANSPORTE (v2, 29/08) ──────────────────────────
    //
    // O dono conferiu a tela do TikTok e apontou: "aparentemente o melhor
    // sistema de identificacao entre todos marketplaces" — ela mostra
    // rastreio, transportadora, armazem de destino e o trajeto todo.
    //
    // Quase tudo disso ja vinha na coleta e a gente nao usava. Medido nas
    // 99 da Girassol: transportadora e metodo em 45, rastreio em 30,
    // endereco do armazem em 12. Com esses campos, o card diz de onde o
    // pacote veio e por onde — o estoquista confere contra a caixa na
    // bancada, em vez de abrir o painel do marketplace.
    transportadora: d.transportadora || d.return_provider_name || null,
    metodo_devolucao: d.return_method || null,      // ex: RETURN_BY_MAIL
    entrega_tipo: d.shipment_type || null,          // PLATFORM / SELLER
    handover: d.handover_method || null,            // como o cliente postou
    armazem_destino: d.return_warehouse_address || null,

    // os ITENS que deveriam estar na caixa — 99 de 99 tem. E o que o
    // estoquista confere: veio tudo que a devolucao diz?
    itens: Array.isArray(d.return_line_items) ? d.return_line_items.map((it) => ({
      sku: (it && (it.seller_sku || it.sku_id)) || null,
      nome: (it && (it.product_name || it.sku_name)) || null,
      qtd: it && it.quantity != null ? it.quantity : null,
    })) : [],

    // devolucao COMBINADA: mais de um pedido no mesmo retorno. Sem isto o
    // estoquista abriria a caixa esperando um pedido e acharia dois.
    combinada: d.is_combined_return === true || String(d.is_combined_return) === 'true',
    combinada_id: d.combined_return_id || null,

    // ENCADEADA: o cliente abre, cancela, abre de novo. Um pedido da
    // Girassol teve TRES em sequencia. Guardar os elos evita contar o
    // mesmo prejuizo varias vezes depois.
    anterior_id: d.pre_return_id || null,
    proxima_id: d.next_return_id || null,

    // o retrato
    status: d.status || d.return_status || null,
    motivo: d.motivo || d.return_reason || null,
    motivo_texto: d.motivo_texto || d.return_reason_text || null,
    valor: d.valor != null ? Number(d.valor) : (d.refund_amount != null ? Number(d.refund_amount) : null),
    tipo_tiktok: d.tipo || d.return_type || null,

    // datas: o TikTok manda em segundos, nao milissegundos
    criado_em: d.criado_em ? new Date(Number(d.criado_em) * 1000).toISOString() : null,
    atualizado_em: d.atualizado_em ? new Date(Number(d.atualizado_em) * 1000).toISOString() : null,

    cru: d,
  };
}

/**
 * Procura, na lista que a ponte trouxe, a devolucao que corresponde ao
 * codigo bipado. Compara so digitos e letras, em maiusculas: etiqueta
 * impressa costuma trazer separador que o codigo original nao tem.
 */
function acharNaLista(lista, codigo, empresa) {
  const alvo = String(codigo || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (!alvo || !Array.isArray(lista)) return null;

  for (const d of lista) {
    for (const chave of chavesDe(d)) {
      if (chave.replace(/[^0-9A-Za-z]/g, '').toUpperCase() === alvo) {
        return normalizar(d, empresa);
      }
    }
  }
  return null;
}

/**
 * O caminho completo: pergunta pra ponte e procura.
 *
 * Devolve { ok, achado, aviso } — e `aviso` importa: se a coleta de la
 * falhou ou esta rodando, "nao achei" NAO quer dizer "nao existe". A
 * ponte ja distingue os dois casos (b343), entao aqui e so repassar em
 * vez de transformar tudo em nulo.
 */
async function procurar(ponte, empresa, codigo, opcoes) {
  if (!ponte || !codigo) return { ok: false, achado: null };
  try {
    const r = await ponte.sondaDevolucoes(empresa, opcoes || { limite: 200 });
    if (!r || !r.ok) {
      return { ok: false, achado: null, erro: (r && r.erro) || 'ponte indisponivel' };
    }
    const lista = (r.cru && r.cru.devolucoes) || [];
    const achado = acharNaLista(lista, codigo, empresa);
    return {
      ok: true,
      achado,
      // repassa o estado da coleta: sem isso, "nao achei" com coleta
      // pendente pareceria "nao existe"
      coleta_pendente: !!r.coleta_pendente,
      aviso: r.aviso || null,
      total_na_lista: lista.length,
    };
  } catch (e) {
    return { ok: false, achado: null, erro: e.message || String(e) };
  }
}

module.exports = {
  vaiChegarPacote, estaEmAberto, chavesDe, normalizar, acharNaLista, procurar,
  STATUS_EM_ABERTO,
};
