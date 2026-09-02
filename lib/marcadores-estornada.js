// lib/marcadores-estornada.js
//
// PECA UNICA pros marcadores do card "estornadas sem retorno".
//
// POR QUE ISTO EXISTE: o caso registrado pelo card vai pra fila "Aprovadas",
// e o rascunho e gerado LA — por um card que so tem o que esta no banco. Mas
// a tabela de triagens nao tem coluna pro deposito sugerido nem pra data da
// venda, entao essas informacoes viajam na `problema_descricao`.
//
// O PROBLEMA QUE ISSO CRIOU: eu gravava o marcador e cada painel precisava
// decodificar por conta propria, com regex. Falhou TRES vezes seguidas —
// gravei `[DEFEITO]`, `[SO RASCUNHO]` e `[data:]` e nenhum era lido, porque
// os leitores estavam em 3 arquivos diferentes e eu so lembrava de um.
//
// A SAIDA: quem MONTA e quem LE moram aqui. O servidor decodifica antes de
// mandar pra tela, e os paineis leem campos normais (`d.dep_sugerido`), sem
// regex. Marcador novo = mexer num arquivo so, e os 3 paineis ganham junto.

const TAG = '[ESTORNADA SEM RETORNO]';

/**
 * Monta a descricao do registro criado pelo card.
 * @param {object} d - o caso, como o card manda
 */
function montarDescricao(d = {}) {
  const partes = [TAG, '[SO RASCUNHO]'];

  // deposito: DEFEITO e o padrao. So vai pra Geral quando SABEMOS que a
  // mercadoria voltou — reembolso do TikTok nem popula esse campo, e classe
  // ambigua do Magalu vem null. A secao chama-se "sem retorno": nao saber e
  // motivo pra tratar como se nao tivesse voltado.
  if (d.entrada_estoque !== true) partes.push('[DEFEITO]');

  // a chave da solicitacao, pra nao sumir com os irmaos do mesmo pedido
  const caso = String(d.chave_caso || '').trim();
  if (caso) partes.push('[caso:' + caso + ']');

  // b210.6 (Codex): a SERIE da nota. Sem ela o card da fila nao sabe que a
  // nota e do Full — e nota do Full foi emitida pelo MARKETPLACE, o que
  // muda o tratamento fiscal da devolucao.
  const serie = String(d.nf_serie || '').replace(/\D/g, '');
  if (serie) partes.push('[serie:' + serie.padStart(3, '0') + ']');

  // a data de origem: sem ela o card da fila usaria `criado_em`, que e HOJE
  const data = String(d.nf_emitida_em || d.criado_no_mkt || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(data)) partes.push('[data:' + data + ']');

  return partes.join(' ')
    + ' Registrado a partir do card de estornadas'
    + (d.marketplace ? ' · ' + String(d.marketplace) : '')
    + (d.classe ? ' · ' + String(d.classe) : '')
    + ' · NAO houve bipagem: a mercadoria pode nao ter voltado fisicamente.';
}

/**
 * Le a descricao e devolve os campos decodificados.
 * Linha que nao veio do card devolve tudo neutro — nada muda pra ela.
 */
function ler(descricao) {
  const txt = String(descricao || '');
  if (txt.indexOf(TAG) === -1) return { veio_do_card: false };

  const caso = txt.match(/\[caso:([^\]]+)\]/);
  const data = txt.match(/\[data:(\d{4}-\d{2}-\d{2})\]/);
  const serie = txt.match(/\[serie:(\d{1,3})\]/);
  return {
    veio_do_card: true,
    so_rascunho: txt.indexOf('[SO RASCUNHO]') !== -1,
    // 'defeito' casa com o `ehProblema` dos paineis; '' deixa o padrao deles
    dep_sugerido: txt.indexOf('[DEFEITO]') !== -1 ? 'defeito' : '',
    chave_caso: caso ? caso[1] : null,
    data_origem: data ? data[1] : null,
    serie: serie ? serie[1] : null,
  };
}

/**
 * Enriquece as linhas da fila com os campos decodificados.
 * Os paineis leem `d.dep_sugerido`, `d.so_rascunho`, `d.data_origem` — sem
 * regex e sem saber que existe marcador nenhum.
 */
function enriquecer(linhas) {
  return (linhas || []).map((d) => {
    const m = ler(d && d.problema_descricao);
    if (!m.veio_do_card) return d;
    return {
      ...d,
      veio_do_card: true,
      so_rascunho: m.so_rascunho,
      dep_sugerido: m.dep_sugerido,
      data_origem: m.data_origem,
      nf_serie: m.serie,
    };
  });
}

module.exports = { TAG, montarDescricao, ler, enriquecer };
