// ============================================================
// lib/magalu-cancelados.js
// ------------------------------------------------------------
// Traz os cancelamentos do Magalu que deixaram NF emitida, pro mesmo
// card de "Estornadas sem retorno" onde o TikTok ja aparece.
//
// [stated] Pedido do dono (30/08): "essa questao da NF e aqui. tipo o do
// tiktok q vc fez, mas agora sendo um da Magalu. e pode misturar tudo
// junto com os da tiktok no card".
//
// ------------------------------------------------------------
// POR QUE O MAGALU IMPORTA MAIS QUE O TIKTOK AQUI
//
// A conversa do Checkout mediu (mar-ago/2026): a GOOD tem 14 casos de
// `pago_cancelado_com_nf` + 21 de `estornado_apos_envio`, somando
// R$ 12.704 nas tres empresas. O TikTok da GOOD tinha UM caso.
//
// ------------------------------------------------------------
// AS CLASSES, E POR QUE SO DUAS INTERESSAM
//
//   pago_cancelado_com_nf  -> pagou, NF emitida, cancelou sem devolucao
//                             registrada. E O CASO DIRETO: no prazo,
//                             cancela a NF; fora, NF de devolucao.
//   estornado_apos_envio   -> pagou, NF emitida, produto foi e voltou.
//                             Devolucao fisica existe, fluxo normal.
//   pago_cancelado_sem_nf  -> sem NF, sem imposto. Nao gera nada.
//   nao_pago               -> nunca virou faturamento. Nao gera nada.
//
// ⚠️ ARMADILHA QUE ELES MEDIRAM: somar o valor de TODOS os cancelados
// daria R$ 47.978 nas tres empresas — R$ 32 mil de "perda" inventada,
// quase toda de pedido que nunca foi pago. So as duas primeiras contam.
//
// ⚠️ E "sem returns[]" NAO prova que o produto nao saiu: prova que nao
// ha devolucao formal. Quem diz se saiu e a etiqueta do checkout; quem
// diz se voltou e a remessa reversa (rota /api/magalu/reversas-por-pedido).
// Por isso o card marca o caso como "conferir" em vez de afirmar.
// ============================================================

const tiktokPonte = require('./tiktok-ponte');

/** As duas classes que deixam NF emitida — as unicas que geram trabalho. */
// v4.78 - AS CLASSES MUDARAM (conversa do Checkout, 30/08).
//
// A primeira versao tinha 4 classes genericas. Agora sao 5 que DIZEM O QUE
// FAZER, decididas pelos campos de `deliveries[].shipping` — `shipped_at`,
// `delivered_at` (que nem existe quando nao houve entrega) e `cancelled_at`.
//
// Cada uma tem tratamento FISCAL diferente:
const ACAO_POR_CLASSE = {
  // pagou, NF emitida, NUNCA despachado — o produto esta no CD
  //   -> cancelar a NF (se no prazo) ou devolucao SEM entrada de estoque.
  //      Dar entrada DUPLICARIA o inventario: a mercadoria nunca saiu.
  nf_sem_saida: { entra: true, entrada_estoque: false, pode_cancelar: true },

  // despachado, nao entregue (insucesso/recusa) — deve ter voltado
  //   -> conferir no recebimento, devolucao COM entrada
  saiu_e_nao_entregou: { entra: true, entrada_estoque: true, pode_cancelar: false },

  // entregue e cancelado DEPOIS, sem devolucao registrada
  //   -> conferir se houve devolucao fisica antes de dar baixa.
  //      Maior grupo da GOOD em dinheiro: R$ 5.086,08 em 7 casos.
  entregue_e_cancelado: { entra: true, entrada_estoque: null, pode_cancelar: false },

  // entregue DEPOIS do estorno — cliente ficou com a mercadoria E o dinheiro
  //   -> PREJUIZO INTEGRAL. Vale contestar com o Magalu.
  entregue_apos_estorno: { entra: true, entrada_estoque: false, pode_cancelar: false },

  // devolucao registrada apos o envio — fluxo normal
  estornado_apos_envio: { entra: true, entrada_estoque: true, pode_cancelar: false },

  // classes ANTIGAS, mantidas: se a rota deles ainda devolver alguma, nao
  // quero que o caso suma em silencio
  pago_cancelado_com_nf: { entra: true, entrada_estoque: null, pode_cancelar: true },

  // sem NF ou sem venda: nao geram trabalho
  nao_pago: { entra: false },
  pago_cancelado_sem_nf: { entra: false },
  pedido_teste: { entra: false },
};

/** As classes que geram trabalho — derivadas do mapa acima. */
const CLASSES_COM_NF = Object.keys(ACAO_POR_CLASSE).filter((c) => ACAO_POR_CLASSE[c].entra);

/**
 * O numero da NF-e, extraido da chave de 44 digitos.
 *
 * Layout da chave: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) ...
 * O numero fica nas posicoes 25-33 — com zeros a esquerda, que tiro.
 *
 * Conferido com a chave real da NF 002070 da GOOD:
 *   35260764289091000100550010000020701083179280 -> 2070
 */
function numeroDaChave(chave) {
  const d = String(chave || '').replace(/\D/g, '');
  if (d.length !== 44) return null;
  const n = d.slice(25, 34).replace(/^0+/, '');
  return n || null;
}

function notasValidas(linha) {
  const notas = Array.isArray(linha && linha.notas) ? linha.notas : [];
  return notas.filter((n) => n && (n.chave || n.numero));
}

function primeiraNota(linha) {
  return notasValidas(linha)[0] || null;
}

function primeiraDevolucao(linha) {
  const devs = Array.isArray(linha && linha.devolucoes) ? linha.devolucoes : [];
  return devs.find(Boolean) || null;
}

/**
 * Traduz uma linha de /magalu/cancelados pro formato que o card espera —
 * o MESMO do TikTok, pra que os dois convivam na mesma lista.
 *
 * b190.3 (Codex): um pedido pode ter VARIAS notas (envio parcial, ou
 * reemissao). Eu ficava so com a primeira, e as outras sumiam da lista —
 * cada uma com seu proprio imposto a recuperar. Agora devolvo UMA LINHA
 * POR NOTA, que e como o dono age: nota a nota.
 */
function normalizarTodas(linha, empresa) {
  if (!linha) return [];
  const classe = String(linha.classe || '').toLowerCase();
  const regra = ACAO_POR_CLASSE[classe];
  // classe DESCONHECIDA entra: eles podem criar outra, e sumir em silencio
  // seria pior que mostrar um caso a mais pro dono olhar
  if (regra && !regra.entra) return [];

  const notas = notasValidas(linha);
  if (!notas.length) return [];
  return notas.map((nota) => montar(linha, nota, classe, empresa));
}

/** Compatibilidade: a primeira nota, como antes. */
function normalizar(linha, empresa) {
  const todas = normalizarTodas(linha, empresa);
  return todas.length ? todas[0] : null;
}

function montar(linha, nota, classe, empresa) {
  // v4.78 - a regra da classe decide o tratamento fiscal (entrada de
  // estoque, se pode cancelar). Busco aqui pra `montar` ser autossuficiente.
  const regra = ACAO_POR_CLASSE[classe];
  const dev = primeiraDevolucao(linha);

  // b192.1 - calculado uma vez: serve pro id E pro campo nf_numero
  // b194 - A CHAVE MANDA sobre o `numero` da API.
  //
  // O dono viu no painel: "NF 637", "NF 822", "NF 881" — e as notas dele na
  // GOOD estao na casa dos SETENTA MIL (076466, 077321). Todas apareciam
  // como "nao localizada no Bling", e sem o vinculo nao ha botao de gerar.
  //
  // A Magalu manda um numero PROPRIO dela nesse campo, que nao e o numero
  // da NF-e. Conferido: `numero: 637` vindo junto da chave
  // 35260732461988000182550010000764661835887584, cujo nNF e 076466.
  //
  // A chave e o documento fiscal em si — ela nao mente. Uso o numero da
  // API so quando nao ha chave.
  const numeroDaNota = numeroDaChave(nota && nota.chave) || (nota && nota.numero) || null;

  return {
    // com varias notas, o id precisa distinguir uma da outra — senao a
    // segunda sobrescreve a primeira em qualquer mapa por id
    // b192.1 (Codex): usar o numero DERIVADO tambem. Quando a API nao manda
    // `numero` — que e o caso comum no Magalu — o sufixo sumia e as duas
    // notas do mesmo pedido voltavam a colidir, exatamente o que este id
    // veio evitar. A chave sempre distingue, entao ela e o ultimo recurso.
    id: String(linha.order_id || linha.order_code || '')
      + (numeroDaNota
        ? '#' + numeroDaNota
        : ((nota && nota.chave) ? '#' + String(nota.chave).slice(-8) : '')),
    marketplace: 'magalu',
    empresa: String(empresa || '').toLowerCase(),
    pedido: linha.order_code || linha.code || null,

    // b192 - O NUMERO MORA DENTRO DA CHAVE.
    //
    // A API do Magalu entrega a CHAVE da NF-e, nem sempre o numero. Sem o
    // numero eu nao acho a nota no Bling, e o card fica so com o aviso
    // "sem NF vinculada" — sem link, sem botao, sem serventia.
    //
    // A chave de 44 digitos carrega o numero nas posicoes 25-33 (9 digitos,
    // zeros a esquerda). Extraio dali quando o numero nao vier.
    nf_numero: numeroDaNota,
    nf_chave: (nota && nota.chave) || null,
    // a EMISSAO da nota — e o que manda no prazo de cancelamento
    nf_emitida_em: (nota && nota.em) || null,

    // b190.4 (Codex): com VARIAS notas, repetir o valor do PEDIDO em cada
    // linha infla a soma — 2 notas de um pedido de R$ 500 apareceriam como
    // R$ 1.000. Prefiro o valor DA NOTA quando ele existe; sem ele, divido
    // o do pedido pelas notas, que e melhor que repetir inteiro.
    valor: (nota && nota.valor != null) ? Number(nota.valor)
      : (linha.valor != null ? Number((Number(linha.valor) / (notasValidas(linha).length || 1)).toFixed(2)) : null),
    // e digo quando o valor foi RATEADO, pra ninguem tratar como exato
    valor_rateado: (nota && nota.valor == null && linha.valor != null
      && notasValidas(linha).length > 1) || undefined,
    cliente_nome: linha.cliente || null,
    produto_titulo: linha.produto || null,
    produto_sku: linha.sku || null,
    produto_qtd: linha.qtd != null ? Number(linha.qtd) : null,

    // a data do EVENTO (cancelamento/estorno), nao a da compra — foi
    // assim que eles montaram, e e o que interessa pro prazo
    criado_em: linha.data_evento || (dev && dev.em) || null,

    classe,
    // `estornado_apos_envio` TEM devolucao registrada: ali o produto
    // voltou (ou esta voltando), entao nao e "sem retorno" de verdade.
    // Marco pra que o card possa dizer isso em vez de tratar igual.
    // v4.78 - a acao que ELES sugerem, quando vier
    acao_sugerida: linha.acao_sugerida || null,

    // as datas que decidiram a classificacao (de deliveries[].shipping)
    enviado_em: linha.enviado_em || null,
    entregue_em: linha.entregue_em || null,
    cancelado_em: linha.cancelado_em || null,

    // o que a classe implica, pro card orientar sem adivinhar
    entrada_estoque: regra ? regra.entrada_estoque : null,
    classe_permite_cancelar: regra ? !!regra.pode_cancelar : false,

    // ⚠️ `entregue_apos_estorno` e o pior caso: entregue DEPOIS do estorno
    // autorizado. O cliente ficou com a mercadoria E com o dinheiro.
    // 1 caso na GOOD, R$ 1.052,80 (pedido 1545570114294804).
    prejuizo_integral: classe === 'entregue_apos_estorno' || undefined,

    tem_devolucao_registrada: classe === 'estornado_apos_envio' || !!dev,
    devolvido_em: (dev && dev.em) || null,

    motivo_texto: linha.motivo || null,
  };
}

/**
 * Puxa os cancelados do Magalu pela ponte com o Mover-Pedidos.
 *
 * Devolve { ok, itens, erro } — nunca lanca, porque isto alimenta um
 * painel: falha aqui deve virar aviso, nao tela em branco.
 */
async function buscar(empresa, opcoes) {
  const o = opcoes || {};
  const emp = String(empresa || 'good').toLowerCase();

  const r = await tiktokPonte.chamarMoverPedidos('/magalu/cancelados', {
    empresa: emp,
    de: o.de,
    ate: o.ate,
  }, { timeoutMs: 45000 });

  if (!r || !r.ok || !r.corpo) {
    return { ok: false, itens: [], erro: (r && r.erro) || 'ponte indisponivel' };
  }
  if (r.corpo.ok === false) {
    return { ok: false, itens: [], erro: r.corpo.erro || 'a rota respondeu ok:false' };
  }

  const linhas = r.corpo.linhas || r.corpo.itens || [];
  // uma linha POR NOTA: pedido com varias notas tem varios impostos
  const itens = linhas.flatMap((l) => normalizarTodas(l, emp));

  return { ok: true, itens, total_bruto: linhas.length };
}

module.exports = { normalizar, normalizarTodas, buscar, CLASSES_COM_NF, ACAO_POR_CLASSE, numeroDaChave };
