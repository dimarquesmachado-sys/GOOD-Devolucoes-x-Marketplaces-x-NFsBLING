// ============================================================
// lib/tiktok-ponte.js                                   (b334)
// ------------------------------------------------------------
// Ponte servidor→servidor com o MOVER-PEDIDOS para dados do
// TikTok Shop. Os tokens do TikTok moram LA (arquivo por loja
// no disco daquele servico); duplicar a autorizacao aqui
// criaria DOIS refresh do mesmo app — a mesma armadilha que ja
// mordeu com o ML. Entao este modulo so CONSOME as rotas
// /tiktok/* de la, autenticando com a ADMIN_KEY daquele servico.
//
// Envs (no Render das DEVOLUCOES):
//   MOVER_PEDIDOS_URL  ex.: https://mover-pedidos-aguardando-x-atendido.onrender.com
//   MOVER_PEDIDOS_KEY  = valor da ADMIN_KEY do servico Mover-Pedidos
//                        (NAO a ADMIN_KEY daqui — cada servico tem a sua)
// ============================================================

const axios = require('axios');

// PONTO UNICO empresa→loja (regra da casa: valor especifico nunca
// marcado caso a caso). Empresa desconhecida NAO cai em padrao: o
// Mover-Pedidos troca loja invalida pela padrao (girassol) em
// silencio, e a girassol nem esta no fluxo de devolucoes — recusar
// aqui e mais seguro que consultar a loja errada achando que deu certo.
// b180.1 (Codex): aceita as DUAS formas de chamar a AMB. O resto do
// projeto usa 'amb' (empresa nos módulos, coluna no banco, prefixo da
// rota); só este mapa esperava 'ambtotal'. Passar 'amb' devolvia "empresa
// sem loja mapeada" e a integração inteira falhava calada, antes mesmo de
// chamar a rede.
const LOJA_POR_EMPRESA = { good: 'good', amb: 'amb', ambtotal: 'amb', girassol: 'girassol' };

function lojaDaEmpresa(empresa) {
  return LOJA_POR_EMPRESA[String(empresa || '').trim().toLowerCase()] || null;
}

function configPonte() {
  const url = String(process.env.MOVER_PEDIDOS_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.MOVER_PEDIDOS_KEY || '').trim();
  return { url, key, ok: !!(url && key) };
}

// Chama uma rota /tiktok/* do Mover-Pedidos. Nunca lanca: devolve
// { ok, http, corpo | cru, erro? }. O erro diz O QUE falhou e o que
// foi enviado — foi esse tipo de mensagem que resolveu a cacada dos
// ids fiscais (b322), entao o padrao se repete aqui.
async function chamarMoverPedidos(caminho, params, opts) {
  const cfg = configPonte();
  if (!cfg.ok) {
    return { ok: false, http: 0, erro: 'ponte nao configurada: falta MOVER_PEDIDOS_URL e/ou MOVER_PEDIDOS_KEY no ambiente das Devolucoes' };
  }
  let u = null;
  try {
    u = new URL(cfg.url + caminho);
  } catch (e) {
    return { ok: false, http: 0, erro: 'MOVER_PEDIDOS_URL invalida: "' + cfg.url + '"' };
  }
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && String(v) !== '') u.searchParams.set(k, String(v));
  }
  u.searchParams.set('k', cfg.key);
  let r = null;
  try {
    r = await axios({
      url: u.toString(), method: 'GET',
      timeout: (opts && opts.timeoutMs) || 30000,
      validateStatus: () => true,
      headers: { accept: 'application/json' },
    });
  } catch (e) {
    return { ok: false, http: 0, erro: 'falha ao chamar o Mover-Pedidos (' + caminho + '): ' + String(e.message || e).slice(0, 160) };
  }
  const corpo = (r.data && typeof r.data === 'object') ? r.data : null;
  const cru = corpo ? null : String(r.data == null ? '' : r.data).slice(0, 300);
  // 404 {"error":"not found"} la e o guard da ADMIN_KEY (404 de proposito)
  // OU rota que ainda nao existe naquela versao. Nao da pra distinguir daqui,
  // entao o erro diz as DUAS hipoteses em vez de escolher uma as cegas.
  if (r.status === 404 && corpo && corpo.error === 'not found') {
    return { ok: false, http: 404, corpo, erro: 'Mover-Pedidos respondeu o 404 do guard: ou a MOVER_PEDIDOS_KEY nao bate com a ADMIN_KEY de la, ou a rota ' + caminho + ' nao existe naquela versao (deploy pendente?)' };
  }
  return { ok: r.status >= 200 && r.status < 300, http: r.status, corpo, cru };
}

// SONDA das devolucoes TikTok de uma empresa: opcionalmente coleta
// (?coletar=1&dias=NN, sincrono la) e depois le o CRU — registros
// guardados + uniao dos cru_campos, que e o que responde "a API
// manda rastreio da reversa?" e decide o que da pra bipar.
async function sondaDevolucoes(empresa, q) {
  q = q || {};
  const loja = lojaDaEmpresa(empresa);
  if (!loja) {
    return { ok: false, erro: 'empresa sem loja TikTok mapeada: "' + String(empresa) + '" (mapeadas: ' + Object.keys(LOJA_POR_EMPRESA).join(', ') + ')' };
  }
  const out = { ok: true, empresa: String(empresa), loja_enviada: loja, mover_pedidos: configPonte().url || null };
  if (String(q.coletar) === '1') {
    // b343 - o Mover-Pedidos passou a responder 202 NA HORA e coletar em
    // background (PR #272 de la), justamente por causa do 502 que a coleta
    // de 60 dias dava aqui. Entao `esperar=1` quando quem chamou quiser o
    // resultado antes de ler; sem isso, dispara e segue.
    const esperar = String(q.esperar || '') === '1';
    const c = await chamarMoverPedidos(
      '/tiktok/devolucoes-coletar',
      { loja, dias: q.dias, esperar: esperar ? 1 : undefined },
      { timeoutMs: esperar ? 120000 : 30000 }
    );
    out.coleta = c.corpo || { http: c.http, cru: c.cru };
    if (!c.ok) {
      out.ok = false;
      out.erro = c.erro || ('coleta falhou (HTTP ' + c.http + ')');
      return out;
    }
    // Mesma invariante da leitura, aplicada a COLETA: a resposta tem que dizer
    // em qual loja rodou. Um MP antigo/incompativel poderia ignorar `loja` e
    // coletar a padrao (girassol) em silencio — e o efeito colateral ja teria
    // acontecido; a leitura seguinte ainda viria "certa" e mascararia isso
    // (apontado pelo Codex no PR #77, rodada 2).
    // A invariante da loja continua: nunca aceitar efeito colateral de loja
    // que nao pedi. Mas o 202 e "aceitei o pedido", nao "terminei" — se ele
    // vier sem `loja`, isso agora e AVISO, nao erro, porque a leitura logo
    // abaixo confere a loja de novo e ai sim recusa.
    if (c.corpo && c.corpo.loja && c.corpo.loja !== loja) {
      out.ok = false;
      out.erro = 'coleta respondeu a loja "' + c.corpo.loja + '" quando pedi "' + loja + '"';
      return out;
    }
    // b343.1 (Codex): tolerar falta de `loja` SO no 202. Um endpoint antigo
    // que responda 200 sem `loja` pode ter coletado a loja PADRAO em
    // silencio — e o efeito colateral ja aconteceu. A leitura seguinte viria
    // "certa" e mascararia isso, que e justamente o que o guard original
    // (PR #77) existia pra impedir.
    if (!c.corpo || !c.corpo.loja) {
      if (c.http !== 202) {
        out.ok = false;
        out.erro = 'coleta respondeu ' + c.http + ' SEM identificar a loja — versao antiga/incompativel? '
          + 'pode ter coletado a loja padrao em silencio';
        return out;
      }
      out.aviso_coleta = 'coleta aceita em background (202) sem identificar a loja — confiro na leitura';
    }
    out.coleta_aceita = c.http === 202 ? 'em background' : 'concluida';
    out.coleta_enfileirada = c.http === 202;
  }
  const r = await chamarMoverPedidos('/tiktok/devolucoes-cru', { loja, limite: q.limite });
  if (!r.ok || !r.corpo) {
    out.ok = false;
    out.erro = r.erro || ('leitura do cru falhou (HTTP ' + r.http + ')');
    out.cru_resposta = r.corpo || r.cru || null;
    return out;
  }
  // O Mover-Pedidos troca loja invalida pela padrao EM SILENCIO; se a
  // resposta vier de outra loja, isso e erro AQUI — nunca aceitar dado
  // de loja errada achando que deu certo. E resposta SEM o campo `loja`
  // (versao antiga/incompativel de la) tambem e recusa: a invariante e
  // "so aceitar dado de loja VERIFICADA", nao "recusar so o que divergir"
  // (apontado pelo Codex no PR #77).
  if (r.corpo.loja !== loja) {
    out.ok = false;
    out.erro = r.corpo.loja
      ? 'Mover-Pedidos respondeu a loja "' + r.corpo.loja + '" quando pedi "' + loja + '"'
      : 'Mover-Pedidos respondeu SEM identificar a loja (versao antiga/incompativel?) quando pedi "' + loja + '"';
    return out;
  }
  out.cru = r.corpo;

  // b343 - O CAMPO QUE IMPEDE O SILENCIO.
  //
  // O Mover-Pedidos avisou: "a coleta do TikTok resolve com erro em vez de
  // lancar, entao sem isso voces veriam '0 devolucoes' achando que esta
  // certo". E exatamente o que nos custou uma noite com a Shopee, onde uma
  // rota duplicada devolvia lista vazia e ninguem sabia.
  //
  // Entao: coleta que falhou vira ERRO aqui, mesmo com a leitura tendo dado
  // 200. Lista vazia com coleta ok e um fato ("nao ha devolucoes"); lista
  // vazia com coleta falha e uma mentira.
  const ult = r.corpo.ultima_coleta;

  // b343.1 (Codex): coleta ENFILEIRADA nao pode virar "ok" com dado velho.
  //
  // Quando o 202 acabou de aceitar a coleta, o `ultima_coleta` que chega
  // aqui ainda descreve a rodada ANTERIOR — ou uma pendente que vai falhar
  // daqui a pouco. Reportar ok:true com a lista atual seria a mesma falha
  // silenciosa que este modulo veio matar, so que por outro caminho.
  //
  // Entao: pediu coleta e ela ficou em background sem ?esperar=1 → a
  // resposta diz que o dado e de ANTES, e nao afirma que esta completo.
  // b343.2 (Codex): "esta rodando" tem DUAS origens, e as duas contam.
  //
  //   1. acabei de enfileirar (202 nesta chamada)
  //   2. uma coleta anterior AINDA nao terminou — e o que o proprio dono
  //      viu no teste de 29/08: `estado: "rodando"` com a resposta dizendo
  //      ok:true. Quem segue o conselho de "chame de novo em alguns
  //      minutos" cai exatamente aqui, SEM coletar=1, e veria o dado velho
  //      como se fosse resultado.
  //
  // E o 202 vale mesmo com ?esperar=1: se o outro servico devolveu 202, ele
  // esta dizendo que enfileirou — pode ter limitado a espera ou ignorado o
  // parametro. Confiar no meu pedido em vez da resposta dele era o erro.
  const ESTADOS_RODANDO = ['rodando', 'em_andamento', 'pendente', 'running', 'pending'];
  // b343.3 (Codex): olhar `estado` E `status`, igual ja fazemos pra falha.
  // Sustentar os dois nomes numa checagem e num so na outra deixaria o
  // "rodando" passar batido justamente onde o "falhou" e reconhecido.
  const rodandoEm = (v) => v && ESTADOS_RODANDO.indexOf(String(v).toLowerCase()) !== -1;
  const aindaRodando = ult && (rodandoEm(ult.estado) || rodandoEm(ult.status));

  if (out.coleta_enfileirada || aindaRodando) {
    out.ok = true;
    out.coleta_pendente = true;
    out.aviso = (out.coleta_enfileirada
      ? 'a coleta foi ACEITA mas ainda esta rodando: '
      : 'ha uma coleta AINDA RODANDO (iniciada antes desta chamada): ')
      + 'a lista abaixo e do estado ANTERIOR. Chame de novo em alguns minutos.';
    out.ultima_coleta = ult || null;
    out.cru = r.corpo;
    return out;
  }

  // b343.2 - o campo se chama `estado` na resposta real (medido em 29/08:
  // `estado: "falhou"` com "Expired credentials"). Eu so olhava `status`,
  // entao a falha que o dono viu na tela teria passado como ok aqui. Aceito
  // os dois nomes, e tambem o ok:false, pra nao depender de qual deles o
  // outro servico usa hoje.
  const estadoFalhou = ult && (
    String(ult.estado || '').toLowerCase() === 'falhou'
    || String(ult.status || '').toLowerCase() === 'falhou'
    || ult.ok === false
  );
  if (estadoFalhou) {
    out.ok = false;
    out.erro = 'a ULTIMA COLETA falhou: ' + (ult.erro || ult.motivo || 'motivo nao informado')
      + ' — a lista abaixo pode estar vazia ou velha por causa disso, nao porque nao ha devolucoes';
    out.ultima_coleta = ult;
    return out;
  }
  out.ultima_coleta = ult || null;

  return out;
}

/**
 * A LINHA DO TEMPO das devolucoes — quem esta na janela de risco.
 *
 * A conversa do Checkout descobriu (29/08) o endpoint
 * /return_refund/202309/returns/{id}/records, que traz os eventos datados,
 * e montou /tiktok/devolucoes-eventos pra colher em lote.
 *
 * POR QUE ISTO IMPORTA MAIS QUE O RESTO
 *
 * Os dois prejuizos que o dono conferiu no extrato NAO foram julgamento —
 * foram REVELIA. O evento SELLER_REJECT_RECEIVE_DELIVERED_TIMEOUT diz, em
 * texto: "This refund was approved because it was not reviewed within the
 * required timeframe". O pacote chegou, o prazo correu, ninguem respondeu.
 *
 * E o relogio tem numero: nos dois casos medidos, a revelia caiu **6 e 7
 * dias** depois de o cliente postar (BUYER_SHIPPED). Quem esta postado ha
 * mais que isso, sem desfecho, esta na janela.
 *
 * Um caso perdido custa o produto, o valor, o frete de ida E a comissao —
 * nao so o imposto. Por isso avisar antes vale mais que qualquer conserto
 * depois.
 */
async function eventosDevolucoes(empresa, q) {
  q = q || {};
  const loja = lojaDaEmpresa(empresa);
  if (!loja) {
    return { ok: false, erro: 'empresa sem loja TikTok mapeada: "' + String(empresa) + '"' };
  }

  const r = await chamarMoverPedidos('/tiktok/devolucoes-eventos', { loja, limite: q.limite }, { timeoutMs: 60000 });
  if (!r.ok || !r.corpo) {
    return { ok: false, loja, erro: r.erro || ('leitura dos eventos falhou (HTTP ' + r.http + ')') };
  }

  // b182.1 (Codex): a invariante da loja e "so aceitar dado de loja
  // VERIFICADA", nao "recusar so o que divergir" — foi exatamente assim
  // que ficou nas outras rotas depois do PR #77. Resposta SEM o campo
  // `loja` pode ter vindo da loja padrao (girassol) em silencio, e eu
  // estava aceitando.
  // b183 (Codex): o ERRO DE APLICACAO vem PRIMEIRO.
  //
  // Uma resposta de erro costuma nao trazer o campo `loja` — entao,
  // checando a loja antes, o dono via "respondeu sem identificar a loja"
  // em vez do motivo real ("token expirado", por exemplo). Mensagem que
  // aponta pro lugar errado faz perder tempo; foi o que aconteceu hoje com
  // o 404 do guard, que parecia rota faltando e era chave diferente.
  if (r.corpo.ok === false) {
    return { ok: false, loja, erro: 'os eventos responderam ok:false: ' + (r.corpo.erro || r.corpo.error || 'motivo nao informado') };
  }

  if (!r.corpo.loja) {
    return { ok: false, loja, erro: 'eventos responderam SEM identificar a loja (versao antiga/incompativel?) quando pedi "' + loja + '"' };
  }
  if (r.corpo.loja !== loja) {
    return { ok: false, loja, erro: 'eventos responderam a loja "' + r.corpo.loja + '" quando pedi "' + loja + '"' };
  }

  return { ok: true, loja, corpo: r.corpo };
}

module.exports = { sondaDevolucoes, eventosDevolucoes, chamarMoverPedidos, lojaDaEmpresa, configPonte };
